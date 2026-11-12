import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIKISYNC_ARTIKEL_URL, WIKISYNC_ZURUECKNEHMEN_URL, type WikisyncArtikelListe } from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { leseArtikelEingabe, runWikiArtikelJob } from "../src/jobs/wiki-artikel-job.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { erzeugeWikiClient, type WikiClient } from "../src/wiki/transport/client.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { welt as baueWelt, type Welt } from "./support/schreibwege/welt.ts";
import { baueDump, neuerOrdner } from "./support/wiki-dump-fixture.ts";
import { starteTestwiki, type Testwiki } from "./support/wiki-testserver.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { DUMP, ID, legeOrteAn, legeWegeAn, raeumeAb, schreibeKategorienZurWelt } from "./support/wikisync-welt.ts";

/**
 * Die Steuerung des WikiSync (WI-0253 D-2): den Wiki-Teil starten und fortsetzen, den ganzen Lauf zurücknehmen, einen einzelnen Artikel vergleichen. Wegwerf-Cluster mit den Rollen und Rechten
 * des VPS, Fastify als App-Rolle für die Routen, die Aufträge als Jobs-Rolle gegen das Testwiki. 🔴 Kein Test fragt de.wiki-aventurica.de; die Routen reihen nur ein.
 *
 * - **Soll:** Eine Route reiht den Auftrag ein, wenn Recht, Passkey und Voraussetzungen stimmen; der Auftrag tut dann, was die Route gesagt hat (der Wiki-Teil holt die Kategorien, die Rücknahme
 *   stellt alle Bereiche des Laufs her, der Vergleich stellt EINE Anfrage ohne Anmeldung und legt seine Zeilen ab).
 * - **Problemfälle:** lokal gesperrt (409 mit Grund, kein Auftrag), ein Wiki, das nicht antwortet, 429, ein Artikel, den es nicht gibt, kein Objekt am Artikel, ein zweiter Auftrag neben dem ersten,
 *   ein angehaltener Lauf, der sich fortsetzen lässt, kein Titel mit `|`.
 */

const ENV = "wikisyncd2s";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0253-d2-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};

const START = 1_800_000_000_000;

function kontext(input: Record<string, unknown>, jobPublicId: string = randomUUID()): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: jobPublicId, leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    };
}

/** Die Umgebung eines Stage-Prozesses für die Dauer EINES Aufrufs (die harte Sperre `wikiAbrufErlaubt`); danach wie vorher. */
async function alsStage<T>(arbeit: () => Promise<T>): Promise<T> {
    const namen = ["AVESMAPS_ENV", "RELEASE_ID", "WIKI_TAKT_ROOT"] as const;
    const alt = namen.map((name) => process.env[name]);
    process.env["AVESMAPS_ENV"] = "staging";
    process.env["RELEASE_ID"] = "d2-test";
    process.env["WIKI_TAKT_ROOT"] = "C:/d2-test-takt";
    try {
        return await arbeit();
    } finally {
        namen.forEach((name, index) => {
            const wert = alt[index];
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        });
    }
}

describeWithCluster("WikiSync D-2: Steuerung (Wegwerf-Cluster, Rollen wie auf dem VPS)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let welt: Welt;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let taktOrdner = "";
    let zaehler = 0;
    let testwiki: Testwiki;
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;
    const uhr = { jetzt: START };
    const protokoll: string[] = [];

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
    const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);

    function bauClient(): WikiClient {
        return erzeugeWikiClient({
            taktVerzeichnis: taktOrdner,
            apiUrl: testwiki.url,
            jetzt: () => uhr.jetzt,
            schlafe: (ms) => {
                uhr.jetzt += ms;
                return Promise.resolve();
            },
            jitterMaxMs: 0,
            zufall: () => 0,
        });
    }

    async function vorschau(bereiche: readonly string[]): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche }), {
            environment: umgebung,
            ladeZuweisungen: () => ladeZuweisungen(jobs()),
            ladeTafel: async () => {
                const stand = await leseNamespaceTafel(jobs());
                return {
                    revision: stand.revision,
                    quelle: stand.revision === null ? "vorgabe" : "datenbank",
                    namensraeume: stand.namensraeume,
                };
            },
            ablage,
        });
        return (ergebnis["lauf"] as { id: number }).id;
    }

    /** Ein Auftrag der Warteschlange, den eine Person ausgelöst hat (wie die Route ihn einreiht), damit der Auftrag als diese Person handelt. */
    async function auftragVon(personId: string, kind: string): Promise<string> {
        const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue(${kind}, 1::smallint, 'aventuria', ${personId}, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return job!.public_id;
    }

    const wartend = (): Promise<{ kind: string; input_ref: Record<string, unknown>; actor_ref: string }[]> =>
        wert(`SELECT kind, input_ref, actor_ref FROM job WHERE state = 'QUEUED' ORDER BY id`);
    const aufraeumen = (): Promise<unknown> =>
        admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;

    async function neueWelt(bau: (db: Database) => Promise<void>): Promise<void> {
        await raeumeAb(admin());
        await admin()`TRUNCATE wikisync_artikel RESTART IDENTITY`;
        await bau(admin());
        await mkdir((taktOrdner = join(ordner.pfad, `takt${String((zaehler += 1))}`)), { recursive: true });
        uhr.jetzt = START;
        testwiki.anfragen.length = 0;
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-d2s");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        // Die Kategorien-Datei dazu (Ortsgröße, Kontinent; WI-0294): Die Vorschau liest sie neben dem Dump.
        await schreibeKategorienZurWelt(ordner.pfad);
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeWikisyncBereiche: () => wikisyncBereiche(j),
            schreibe: (eingabe) => schreibeLauf(j, eingabe),
            schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(j, eingabe, fehler),
            ausloeser: () => Promise.resolve("jobs-cli"),
        };
        fixture = authFixture(cluster.admin);
        app = buildApp({
            config,
            database: cluster.app,
            logStream: { write: (zeile: string) => void protokoll.push(zeile) },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        welt = baueWelt(cluster, app, fixture, ordner.pfad);
    }, 240_000);
    afterAll(async () => {
        await testwiki?.schliesse();
        await app?.close();
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);
    beforeEach(async () => {
        await testwiki?.schliesse();
        testwiki = await starteTestwiki();
        await aufraeumen();
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Den Wiki-Teil starten und fortsetzen
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Den ganzen Lauf zurücknehmen
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 Ganzen Lauf zurücknehmen: ohne Bereich nimmt die Route alle Bereiche, deren Übernahme noch steht; der Auftrag stellt jeden her; ein Bereich nach dem anderen ist weg", async () => {
        await neueWelt(async (db) => {
            await legeOrteAn(db);
            await legeWegeAn(db);
        });
        const admin2 = await welt.jemand("admin", { frisch: true, passkey: true });
        const editor = await welt.jemand("editor", { frisch: true, passkey: true });
        const laufId = await vorschau(["ort", "weg"]);
        const vorherOrt = await wert<Record<string, unknown>>(
            `SELECT public_id::text, name, subtype FROM place ORDER BY public_id`,
        );
        const vorherWeg = await wert<Record<string, unknown>>(
            `SELECT public_id::text, name FROM path ORDER BY public_id`,
        );
        const ergebnis = (await runWikiUebernehmenJob(kontext({ bereiche: ["ort", "weg"] }), {
            environment: einsatz,
            mitDatenbank: mitJobs,
        })) as { bereiche: { bereich: string; status: string; uebernahme: number | null }[] };
        expect(ergebnis.bereiche.map((b) => b.status)).toEqual(["fertig", "fertig"]);
        expect(await wert(`SELECT name FROM place WHERE public_id = '${ID.gareth}'`)).toEqual([{ name: "Gareth" }]);

        const post = (cookie: string, body: object) =>
            welt.post(WIKISYNC_ZURUECKNEHMEN_URL, cookie, { operationId: randomUUID(), ...body });
        // Rechte: nur ein Admin mit Passkey.
        expect((await post(editor.cookie, { lauf: laufId })).statusCode).toBe(403);
        // Ein Lauf ohne Übernahme: 404.
        expect((await post(admin2.cookie, { lauf: laufId + 99 })).json()).toMatchObject({
            error: { code: "nichts_zurueckzunehmen" },
        });
        await aufraeumen();
        const ok = await post(admin2.cookie, { lauf: laufId });
        expect(ok.statusCode, ok.body).toBe(200);
        const [eingereiht] = await wartend();
        expect(eingereiht).toMatchObject({
            kind: "wiki_zuruecknehmen",
            input_ref: { lauf: laufId, bereiche: ["ort", "weg"] },
            actor_ref: admin2.id,
        });

        // Der Auftrag macht aus „ganz“ eine Rücknahme je Bereich.
        const rueck = (await runWikiZuruecknehmenJob(
            kontext(eingereiht!.input_ref, await auftragVon(admin2.id, "wiki_zuruecknehmen")),
            {
                environment: einsatz,
                mitDatenbank: mitJobs,
            },
        )) as { lauf: number; bereiche: { bereich: string; status: string; operationId: string | null }[] };
        expect(rueck.bereiche.map((b) => [b.bereich, b.status])).toEqual([
            ["ort", "fertig"],
            ["weg", "fertig"],
        ]);
        expect(
            await wert<Record<string, unknown>>(`SELECT public_id::text, name, subtype FROM place ORDER BY public_id`),
        ).toEqual(vorherOrt);
        expect(
            await wert<Record<string, unknown>>(`SELECT public_id::text, name FROM path ORDER BY public_id`),
        ).toEqual(vorherWeg);
        // Zwei Operationen der Quelle wikisync für die Rücknahme (je Bereich eine) und beide Übernahmen als zurückgenommen vermerkt.
        expect(await zahl(`SELECT count(*)::int AS n FROM map_operation WHERE action = 'wikisync.zuruecknehmen'`)).toBe(
            2,
        );
        expect(
            await zahl(
                `SELECT count(*)::int AS n FROM wikisync_uebernahme WHERE art = 'uebernahme' AND zurueckgenommen_am IS NOT NULL`,
            ),
        ).toBe(2);
        // Danach steht nichts mehr, was sich zurücknehmen ließe.
        expect((await post(admin2.cookie, { lauf: laufId })).json()).toMatchObject({
            error: { code: "nichts_zurueckzunehmen" },
        });
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Einen Artikel vergleichen
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    describe("Artikel vergleichen", () => {
        const artikelJob = (titel: string, client?: WikiClient) =>
            runWikiArtikelJob(kontext({ titel, ausgeloestVon: "Edora" }), {
                client: client ?? bauClient(),
                mitDatenbank: mitJobs,
            });
        const vergleiche = () =>
            wert<{
                id: string;
                titel: string;
                wiki_titel: string | null;
                status: string;
                fehler_code: string | null;
                wiki_revision: string | null;
            }>(
                `SELECT a.id::text, a.titel, a.wiki_titel, a.status, a.fehler_code, a.wiki_revision::text FROM wikisync_artikel a ORDER BY a.id`,
            );
        const abdruck = async (): Promise<string> =>
            (
                await wert<{ h: string }>(
                    `SELECT md5(concat((SELECT string_agg(md5(t::text), '' ORDER BY md5(t::text)) FROM place t), (SELECT string_agg(md5(t::text), '' ORDER BY md5(t::text)) FROM place_detail t),
                                      (SELECT string_agg(md5(t::text), '' ORDER BY md5(t::text)) FROM wiki_settlement_snapshot t), (SELECT count(*) FROM map_operation)::text)) AS h`,
                )
            )[0]!.h;

        it("🔴 Der Vergleich stellt EINE Anfrage ohne Anmeldung, legt die Zeilen der Objekte am Artikel ab und schreibt in keine Fachtafel", async () => {
            await neueWelt(legeOrteAn);
            testwiki.texte.set("Gareth", {
                text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n|Region=Garetien\n|Staat=Mittelreich\n}}\nGareth ist die Hauptstadt.",
                revid: 4711,
                zeit: "2026-10-20T10:00:00Z",
            });
            const vorher = await abdruck();
            const ergebnis = await artikelJob("gareth");
            expect(ergebnis).toMatchObject({ status: "fertig", bereiche: ["ort"], objekte: 1 });
            // Eine Anfrage, ein GET, kein Login.
            expect(testwiki.anfragen).toHaveLength(1);
            expect(testwiki.anfragen[0]!.methode).toBe("GET");
            expect(testwiki.anfragen[0]!.abfrage.get("prop")).toBe("revisions");
            expect(testwiki.anfragen[0]!.abfrage.get("assert")).toBeNull();
            expect(JSON.stringify(testwiki.anfragen[0]!.kopf)).not.toMatch(/cookie/iu);

            const [eintrag] = await vergleiche();
            expect(eintrag).toMatchObject({
                titel: "gareth",
                wiki_titel: "Gareth",
                status: "fertig",
                wiki_revision: "4711",
            });
            // Die Zeilen sind die der Vorschau: Der Name folgt dem Wiki (Vermerk) und würde übernommen.
            const liste = (
                await wert<{
                    zeilen: {
                        feld: string | null;
                        neu: string | null;
                        eigentuemer: string;
                        wirkung: string;
                        objektId: string;
                    }[];
                }>(`SELECT zeilen FROM wikisync_artikel`)
            )[0]!.zeilen;
            expect(liste.find((zeile) => zeile.feld === "name")).toMatchObject({
                neu: "Gareth",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                objektId: ID.gareth,
            });
            // Kein Eingriff an der Karte.
            expect(await abdruck()).toBe(vorher);
        });

        it("Eine Weiterleitung wird als solche gezeigt; ein Artikel, den es nicht gibt, ein 429 und ein Artikel ohne Objekt sind Ergebnisse, kein Absturz", async () => {
            await neueWelt(legeOrteAn);
            // Alt Havena leitet auf Havena weiter; beide hängen an Orten der Karte.
            testwiki.seiten.set("Alt Havena", { kategorien: [], weiterleitung: "Havena" });
            testwiki.texte.set("Havena", {
                text: "{{Infobox Siedlung\n|Name=Havena\n|Einwohner=9.000\n}}\nHavena.",
                revid: 12,
                zeit: "2026-10-20T10:00:00Z",
            });
            await artikelJob("Alt Havena");
            const [umgeleitet] = await vergleiche();
            expect(umgeleitet).toMatchObject({ status: "fertig", wiki_titel: "Havena" });
            // Fehlend.
            await artikelJob("Nirgendwo");
            // Der Artikel ist da, aber es hängt kein Objekt der Karte an ihm.
            testwiki.texte.set("Ohne Objekt", {
                text: "{{Infobox Siedlung\n|Name=X\n}}\nText.",
                revid: 1,
                zeit: "2026-10-20T10:00:00Z",
            });
            await artikelJob("Ohne Objekt");
            // 429 zuletzt: Es pausiert den Takt für alle.
            testwiki.antworter = () => ({ status: 429, kopf: { "retry-after": "60" } });
            await artikelJob("Havena");
            testwiki.antworter = null;
            const alle = await vergleiche();
            expect(alle.map((v) => [v.titel, v.status, v.fehler_code])).toEqual([
                ["Alt Havena", "fertig", null],
                ["Nirgendwo", "fehlgeschlagen", "nicht_im_wiki"],
                ["Ohne Objekt", "fehlgeschlagen", "kein_objekt"],
                ["Havena", "fehlgeschlagen", "http_429"],
            ]);
            // Die Weiterleitung steht als Befund da (der Artikel, an dem der Ort hängt, ist umgeleitet), die Felder von Havena als Felder.
            const zeilen = (
                await wert<{ zeilen: { befund: string | null; feld: string | null; objektId: string }[] }>(
                    `SELECT zeilen FROM wikisync_artikel WHERE titel = 'Alt Havena'`,
                )
            )[0]!.zeilen;
            expect(zeilen.find((zeile) => zeile.objektId === ID.altHavena)).toMatchObject({ befund: "umleitung" });
            expect(zeilen.some((zeile) => zeile.objektId === ID.havena && zeile.feld === "einwohner")).toBe(true);
        });

        it("🔴 Lokal gesperrt: Ohne Stage oder Production entsteht kein Client, der Auftrag legt nichts an; ein Titel mit | oder ohne Namen wird abgewiesen; nur die letzten zwanzig bleiben", async () => {
            await neueWelt(legeOrteAn);
            await expect(
                runWikiArtikelJob(kontext({ titel: "Gareth" }), { environment: einsatz, mitDatenbank: mitJobs }),
            ).rejects.toMatchObject({ code: "abruf_gesperrt" });
            expect(await vergleiche()).toEqual([]);
            expect(testwiki.anfragen).toHaveLength(0);
            for (const titel of ["Gareth|Havena", "", "   ", "A#B", "<b>", "x".repeat(201)]) {
                expect(() => leseArtikelEingabe({ titel }), titel).toThrow(JobFailure);
            }
            expect(() => leseArtikelEingabe({ titel: "Gareth", sonst: 1 })).toThrow(JobFailure);
            expect(leseArtikelEingabe({ titel: "  Alt_Havena  " })).toEqual({
                titel: "Alt Havena",
                ausgeloestVon: undefined,
            });

            for (let i = 0; i < 22; i += 1) await artikelJob(`Nirgendwo ${String(i)}`);
            const bleiben = await vergleiche();
            expect(bleiben).toHaveLength(20);
            expect(bleiben[0]!.titel).toBe("Nirgendwo 2");
            expect(bleiben.at(-1)!.titel).toBe("Nirgendwo 21");
        });

        it("🔴 Route: ab Editor ohne Passkey; lokal 409 mit Grund; kein Objekt am Artikel 409; ein Auftrag zur Zeit; der Titel mit | ist 400; die Liste trägt die Zeilen", async () => {
            await neueWelt(legeOrteAn);
            const tester = await welt.jemand("tester");
            const editor = await welt.jemand("editor");
            const post = (cookie: string | undefined, titel: string) =>
                welt.post(WIKISYNC_ARTIKEL_URL, cookie, { operationId: randomUUID(), titel });
            expect((await post(undefined, "Gareth")).statusCode).toBe(401);
            expect((await post(tester.cookie, "Gareth")).statusCode).toBe(403);
            // Lokal: gesperrt, mit dem Grund.
            const lokal = await post(editor.cookie, "Gareth");
            expect(lokal.statusCode).toBe(409);
            expect(lokal.json()).toMatchObject({ error: { code: "abruf_gesperrt", details: { grund: "umgebung" } } });
            expect(await wartend()).toEqual([]);

            await alsStage(async () => {
                expect((await post(editor.cookie, "Gareth|Havena")).statusCode).toBe(400);
                expect((await post(editor.cookie, "Ein Artikel ohne Objekt")).json()).toMatchObject({
                    error: { code: "kein_objekt" },
                });
                const ok = await post(editor.cookie, "gareth");
                expect(ok.statusCode, ok.body).toBe(200);
                expect(await wartend()).toEqual([
                    {
                        kind: "wiki_artikel",
                        input_ref: { titel: "gareth", ausgeloestVon: editor.name },
                        actor_ref: editor.id,
                    },
                ]);
                expect((await post(editor.cookie, "Havena")).json()).toMatchObject({
                    error: { code: "artikel_laeuft" },
                });
            });

            // Der Auftrag läuft (gegen das Testwiki) und legt den Vergleich ab; die Liste nennt ihn mit seinen Zeilen.
            testwiki.texte.set("Gareth", {
                text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n}}\nGareth.",
                revid: 4711,
                zeit: "2026-10-20T10:00:00Z",
            });
            const eingabe = (await wartend())[0]!.input_ref;
            await aufraeumen();
            await runWikiArtikelJob(kontext(eingabe, await auftragVon(editor.id, "wiki_artikel")), {
                client: bauClient(),
                mitDatenbank: mitJobs,
            });
            const antwort = await app.inject({
                method: "GET",
                url: WIKISYNC_ARTIKEL_URL,
                headers: { cookie: tester.cookie, host: "avesmaps.test" },
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const liste = antwort.json<WikisyncArtikelListe>();
            expect(liste.vergleiche).toHaveLength(1);
            expect(liste.vergleiche[0]).toMatchObject({
                titel: "gareth",
                wikiTitel: "Gareth",
                status: "fertig",
                ausgeloestVon: editor.name,
            });
            expect(liste.vergleiche[0]!.zeilen.length).toBeGreaterThan(0);
            expect(liste.vergleiche[0]!.zeilen.every((zeile) => zeile.laufId === liste.vergleiche[0]!.id)).toBe(true);
            // Die Rechte der Jobs-Rolle: schreiben darf sie den Vergleich, die App nicht.
            const codes = await cluster!.codesAs(cluster!.app, [
                "INSERT INTO wikisync_artikel (titel, parser_version) VALUES ('x', 'y')",
                "SELECT 1 FROM wikisync_artikel",
            ]);
            expect(codes).toEqual(["42501", "ok"]);
        });
    });
});

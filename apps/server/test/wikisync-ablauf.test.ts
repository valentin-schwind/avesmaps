import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    WIKISYNC_BEREICHE,
    WIKISYNC_STAND_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    type WikisyncStand,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JobFailure, JobStopped, type JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { leseFolge } from "../src/jobs/wiki-folge.ts";
import { runWikiUebernehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { reiheFolgeNachVorschauEin, reiheUebernahmenEin } from "../src/wiki/abgleich/folge.ts";
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { pruefeUebernahme } from "../src/wiki/abgleich/uebernahme/pruefen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { welt as baueWelt, type Welt } from "./support/schreibwege/welt.ts";
import { baueDump, neuerOrdner } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import {
    DUMP,
    ID,
    legeGebieteAn,
    legeOrteAn,
    legeWegeAn,
    raeumeAb,
    schreibeKategorienZurWelt,
} from "./support/wikisync-welt.ts";

/**
 * Der verkettete Lauf „WikiSync starten“ (WI-0253 §20, Variante A des Ablaufs): EIN Start statt dreier Knöpfe. Die Route reiht die Vorschau mit ihrer Folge ein; die Aufträge reihen den Rest selbst ein.
 *
 * - **Soll:** Alle Bereiche der Folge gehen nach der Vorschau gleich in die Übernahme (seit WI-0294 gibt es keinen Wiki-Teil mehr); die Übernahme läuft als dieselbe Person, die gestartet hat; ein
 *   Legacy-Zug lässt sie warten (kein Fehler).
 * - **Problemfälle:** fehlt die Kategorien-Datei, steht die Übernahme der Bereiche mit Kategorien aus (nichts eingereiht, nichts abgelehnt, nichts halb geschrieben), ein Auftrag, der nach dem Absturz von
 *   vorn beginnt (nichts doppelt), ein zweiter Start neben dem ersten.
 *
 * Wegwerf-Cluster mit den Rollen und Rechten des VPS, Fastify als App-Rolle für die Route, die Aufträge als Jobs-Rolle. 🔴 Kein Test fragt de.wiki-aventurica.de.
 */

describe("Die Folge eines Laufs", () => {
    it("🔴 die Eingabe ist streng: Bereiche mit Übernahme, mindestens einer, ohne Wiederholung, sonst nichts", () => {
        expect(leseFolge(undefined)).toBeUndefined();
        expect(leseFolge({ bereiche: ["weg", "ort"] })).toEqual({ bereiche: ["ort", "weg"] });
        for (const falsch of [
            null,
            "ort",
            {},
            { bereiche: [] },
            { bereiche: "ort" },
            { bereiche: ["ort", "ort"] },
            { bereiche: ["nirgendwo"] },
            { bereiche: ["ort"], uebrig: 1 },
        ]) {
            expect(() => leseFolge(falsch), JSON.stringify(falsch)).toThrow(JobFailure);
        }
    });
});

const ENV = "wikisyncablauf";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0253-ablauf-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};

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
    process.env["RELEASE_ID"] = "ablauf-test";
    process.env["WIKI_TAKT_ROOT"] = "C:/ablauf-test-takt";
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

interface Eingereiht {
    public_id: string;
    kind: string;
    input_ref: Record<string, unknown>;
    actor_ref: string | null;
}

describeWithCluster("WikiSync: der verkettete Lauf (Wegwerf-Cluster, Rollen wie auf dem VPS)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let welt: Welt;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let kategorienPfad = "";
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;
    let ausloeser: string | null = "jobs-cli";
    const protokoll: string[] = [];

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
    const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);

    const wartend = (): Promise<Eingereiht[]> =>
        wert(`SELECT public_id::text, kind, input_ref, actor_ref FROM job WHERE state = 'QUEUED' ORDER BY id`);
    const aufraeumen = (): Promise<unknown> =>
        admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
    /** Ein Auftrag der Warteschlange ist durch (die Tests fahren ihn selbst, der Dirigent fehlt hier). */
    const erledigt = (job: Eingereiht): Promise<unknown> =>
        admin()`UPDATE job SET state = 'SUCCEEDED', finished_at = now() WHERE public_id = ${job.public_id}::uuid`;

    /** Fährt die Vorschau mit der Folge wie der Auftrag: als Jobs-Rolle, mit dem Auslöser aus `ausloeser`. */
    async function vorschauMitFolge(
        bereiche: readonly string[],
    ): Promise<{ id: number; ergebnis: Record<string, unknown> }> {
        const ergebnis = await runWikiVorschauJob(kontext({ folge: { bereiche }, ausgeloestVon: "Edora" }), {
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
        return { id: (ergebnis["lauf"] as { id: number }).id, ergebnis };
    }

    async function uebernimm(job: Eingereiht): Promise<void> {
        await runWikiUebernehmenJob(kontext(job.input_ref, job.public_id), {
            environment: einsatz,
            mitDatenbank: mitJobs,
        });
        await erledigt(job);
    }

    async function neueWelt(bau: (db: Database) => Promise<void>): Promise<void> {
        await raeumeAb(admin());
        await bau(admin());
        await rename(kategorienPfad + ".beiseite", kategorienPfad).catch(() => undefined);
        ausloeser = "jobs-cli";
    }

    const gareth = async (): Promise<string> =>
        (await wert<{ name: string }>(`SELECT name FROM place WHERE public_id = '${ID.gareth}'`))[0]!.name;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-ablauf");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        // Die Kategorien-Datei dazu (Ortsgröße, Kontinent; WI-0294): Die Vorschau liest sie neben dem Dump.
        kategorienPfad = await schreibeKategorienZurWelt(ordner.pfad);
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeWikisyncBereiche: () => wikisyncBereiche(j),
            schreibe: (eingabe) => schreibeLauf(j, eingabe),
            schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(j, eingabe, fehler),
            ausloeser: () => Promise.resolve(ausloeser),
            reiheFolgeEin: (args) => reiheFolgeNachVorschauEin(j, args),
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
        await app?.close();
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);
    beforeEach(async () => {
        await aufraeumen();
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Der Start
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 Start: ein Auftrag (die Vorschau mit der Folge), als die Person, die klickt; Recht und Passkey wie bei der Übernahme", async () => {
        await neueWelt(async (db) => {
            await legeOrteAn(db);
            await legeWegeAn(db);
            await legeGebieteAn(db);
        });
        const tester = await welt.jemand("tester");
        const editorAlt = await welt.jemand("editor");
        const editor = await welt.jemand("editor", { frisch: true, passkey: true });
        const admin2 = await welt.jemand("admin", { frisch: true, passkey: true });
        const post = (cookie: string | undefined, body: object) =>
            welt.post(WIKISYNC_UEBERNEHMEN_URL, cookie, { operationId: randomUUID(), ...body });

        expect((await post(undefined, { bereiche: ["weg"], ablauf: "ganz" })).statusCode).toBe(401);
        expect((await post(tester.cookie, { bereiche: ["weg"], ablauf: "ganz" })).statusCode).toBe(403);
        expect((await post(editorAlt.cookie, { bereiche: ["weg"], ablauf: "ganz" })).json()).toMatchObject({
            error: { code: "reauth_required" },
        });
        // „ablauf“ und „lauf“ schließen sich aus: Die Vorschau entsteht im Lauf.
        expect((await post(editor.cookie, { bereiche: ["weg"], ablauf: "ganz", lauf: 1 })).statusCode).toBe(400);
        // „Alle“ nur ein Admin.
        expect((await post(editor.cookie, { alle: true, ablauf: "ganz" })).statusCode).toBe(403);
        expect(await wartend()).toEqual([]);

        // Seit WI-0294 braucht kein Bereich einen Abruf beim Wiki: Auch lokal geht jeder (die Kategorien liest die Vorschau aus der Datei).
        const lokal = await post(editor.cookie, { bereiche: ["ort", "weg"], ablauf: "ganz" });
        expect(lokal.statusCode, lokal.body).toBe(200);
        expect(await wartend()).toEqual([
            expect.objectContaining({
                kind: "wiki_vorschau",
                input_ref: { folge: { bereiche: ["ort", "weg"] }, ausgeloestVon: editor.name },
                actor_ref: editor.id,
            }),
        ]);
        await aufraeumen();
        // „fortsetzen“ gibt es nicht mehr (es gibt keinen Wiki-Teil, den man fortsetzen könnte): Die Anfrage ist ungültig.
        expect((await post(editor.cookie, { bereiche: ["ort"], ablauf: "fortsetzen" })).statusCode).toBe(400);

        await alsStage(async () => {
            const ok = await post(editor.cookie, { bereiche: ["weg", "ort"], ablauf: "ganz" });
            expect(ok.statusCode, ok.body).toBe(200);
            const eingereiht = await wartend();
            expect(eingereiht).toHaveLength(1);
            expect(eingereiht[0]).toMatchObject({
                kind: "wiki_vorschau",
                // Die Bereiche stehen in der Reihenfolge des Katalogs, nicht der Anfrage.
                input_ref: { folge: { bereiche: ["ort", "weg"] }, ausgeloestVon: editor.name },
                actor_ref: editor.id,
            });
            // Ein zweiter Start neben dem ersten: 409, nichts eingereiht.
            expect((await post(editor.cookie, { bereiche: ["weg"], ablauf: "ganz" })).json()).toMatchObject({
                error: { code: "vorschau_laeuft" },
            });
            expect(await wartend()).toHaveLength(1);
            await aufraeumen();
            // Ein Admin darf „alle“: alle Bereiche, die dem WikiSync gehören (jeder mit angeschlossener Übernahme).
            expect((await post(admin2.cookie, { alle: true, ablauf: "ganz" })).statusCode).toBe(200);
            expect((await wartend())[0]!.input_ref["folge"]).toEqual({ bereiche: [...WIKISYNC_BEREICHE] });
            // Das Ereignis steht im Protokoll der Verwaltung, mit dem Auftrag.
            const ereignisse = await wert<{ action: string }>(
                `SELECT action FROM avesmaps_auth.security_event WHERE action = 'system.wikisync_uebernahme_angestossen' ORDER BY id`,
            );
            expect(ereignisse.length).toBeGreaterThanOrEqual(3);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Die Kette
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 Kette: Alle Bereiche der Folge gehen nach der Vorschau gleich in die Übernahme, als die Person, die gestartet hat; ein Auftrag, der von vorn beginnt, reiht nichts doppelt ein", async () => {
        await neueWelt(async (db) => {
            await legeOrteAn(db);
            await legeWegeAn(db);
            await legeGebieteAn(db);
        });
        const editor = await welt.jemand("editor", { frisch: true, passkey: true });
        ausloeser = editor.id;

        // 1. Die Vorschau rechnet ALLE Bereiche (auch den, der nicht zur Wahl gehört), liest die Kategorien-Datei und reiht die Folge ein: EINE Übernahme für beide Bereiche.
        const { id: vorschau, ergebnis } = await vorschauMitFolge(["ort", "weg"]);
        expect(ergebnis["folge"]).toEqual({ uebernahme: ["ort", "weg"], ausstehend: [] });
        expect(ergebnis["quelle"]).toMatchObject({
            kategorien: { datei: "dump_categorylinks-20261001.sql.gz", stand: "2026-10-01T04:00:00Z" },
        });
        const eingereiht = await wartend();
        expect(eingereiht).toHaveLength(1);
        expect(eingereiht[0]).toMatchObject({
            kind: "wiki_uebernehmen",
            input_ref: { bereiche: ["ort", "weg"], lauf: vorschau },
            actor_ref: editor.id,
        });
        // Der Bereich außerhalb der Wahl (gebiet) ist gerechnet, aber nichts für ihn eingereiht.
        expect(
            await zahl(
                `SELECT count(*)::int AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${String(vorschau)} AND bereich = 'gebiet'`,
            ),
        ).toBeGreaterThan(0);
        // Die Ortsgröße steht in der Vorschau, aus der Datei: Gareth ist eine Metropole.
        expect(
            await wert(
                `SELECT neu FROM wikisync_lauf_zeile WHERE lauf_id = ${String(vorschau)} AND bereich = 'ort' AND feld = 'settlement_class' AND artikel = 'Gareth'`,
            ),
        ).toEqual([{ neu: "metropole" }]);
        expect(await gareth()).toBe("Gareht");

        // 2. Die Übernahme läuft als die Person, die gestartet hat, und übernimmt beide Bereiche.
        await uebernimm(eingereiht[0]!);
        expect(
            await wert(
                `SELECT bereich, status, ausgeloest_von::text AS von, kategorien_datei, kategorien_stand IS NOT NULL AS pin FROM wikisync_uebernahme WHERE art = 'uebernahme' ORDER BY id`,
            ),
        ).toEqual([
            {
                bereich: "ort",
                status: "fertig",
                von: editor.id,
                kategorien_datei: "dump_categorylinks-20261001.sql.gz",
                pin: true,
            },
            {
                bereich: "weg",
                status: "fertig",
                von: editor.id,
                kategorien_datei: "dump_categorylinks-20261001.sql.gz",
                pin: true,
            },
        ]);
        expect(await gareth()).toBe("Gareth");

        // 3. Ein Auftrag, der nach einem Absturz von vorn beginnt, reiht nichts doppelt ein.
        expect(
            await reiheUebernahmenEin(jobs(), {
                vorschauLauf: vorschau,
                bereiche: ["ort", "weg"],
                actorRef: editor.id,
            }),
        ).toEqual([]);
        // Die Übernahme der Wege hat ihre Folgen eingereiht (Profile, Beschriftung); vom WikiSync wartet nichts mehr.
        expect((await wartend()).filter((job) => job.kind.startsWith("wiki_"))).toEqual([]);
    });

    it("🔴 Ohne Kategorien-Datei steht die Übernahme der Bereiche mit Kategorien aus: nichts eingereiht, nichts abgelehnt, nichts geschrieben; die übrigen laufen; mit der Datei geht es weiter", async () => {
        await neueWelt(async (db) => {
            await legeOrteAn(db);
            await legeWegeAn(db);
        });
        const editor = await welt.jemand("editor", { frisch: true, passkey: true });
        ausloeser = editor.id;
        // Die Datei ist nicht da (beiseite gelegt, nicht gelöscht: `neueWelt` legt sie zurück).
        await rename(kategorienPfad, kategorienPfad + ".beiseite");

        // 1. Die Vorschau gelingt, ohne Ortsgröße; die Folge nennt den Bereich als ausstehend, eingereiht wird nur der Weg.
        const { id: vorschau, ergebnis } = await vorschauMitFolge(["ort", "weg"]);
        expect(ergebnis["folge"]).toEqual({ uebernahme: ["weg"], ausstehend: ["ort"] });
        expect(ergebnis["quelle"]).toMatchObject({ kategorien: null });
        expect(ergebnis["befunde"]).toEqual(expect.arrayContaining([{ code: "kategorien_datei_fehlt" }]));
        expect(
            await zahl(
                `SELECT count(*)::int AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${String(vorschau)} AND feld IN ('settlement_class', 'building_type', 'continent')`,
            ),
        ).toBe(0);
        const eingereiht = await wartend();
        expect(eingereiht).toEqual([
            expect.objectContaining({ kind: "wiki_uebernehmen", input_ref: { bereiche: ["weg"], lauf: vorschau } }),
        ]);

        // 2. Auch von Hand (Route, Auftrag) lehnt die Prüfung den Bereich mit klarem Text ab; nichts wird geschrieben.
        const pruefung = await pruefeUebernahme(jobs(), "ort");
        expect(pruefung).toMatchObject({ ok: false, grund: "kategorien_fehlen" });
        expect(await gareth()).toBe("Gareht");
        expect(await zahl(`SELECT count(*)::int AS n FROM wikisync_uebernahme WHERE bereich = 'ort'`)).toBe(0);
        await uebernimm(eingereiht[0]!);

        // 3. Liegt die Datei da, rechnet eine neue Vorschau die Felder, und die Übernahme geht.
        await rename(kategorienPfad + ".beiseite", kategorienPfad);
        await aufraeumen();
        const { id: neu, ergebnis: danach } = await vorschauMitFolge(["ort", "weg"]);
        expect(neu).toBeGreaterThan(vorschau);
        // Zu dieser neuen Vorschau ist noch nichts übernommen: Auch der Weg geht wieder in die Folge.
        expect(danach["folge"]).toEqual({ uebernahme: ["ort", "weg"], ausstehend: [] });
        await uebernimm((await wartend())[0]!);
        expect(await gareth()).toBe("Gareth");
    });

    it("🔴 Die Folge reiht nie doppelt ein: eine wartende Übernahme zählt, und ein Bereich, der übernommen wurde, auch", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        const { id: vorschau } = await vorschauMitFolge(["weg"]);
        const erste = await wartend();
        expect(erste.map((job) => job.kind)).toEqual(["wiki_uebernehmen"]);
        // Zweimal dieselbe Vorschau-Folge: Es bleibt bei einem Auftrag.
        expect(
            await reiheFolgeNachVorschauEin(jobs(), {
                vorschauLauf: vorschau,
                folge: { bereiche: ["weg"] },
                actorRef: editor.id,
                ausgeloestVon: undefined,
                mapDomainId: "aventuria",
            }),
        ).toEqual({ uebernahme: [], ausstehend: [] });
        expect(await wartend()).toHaveLength(1);
        // Eine andere Vorschau ist eine andere Sache.
        expect(
            await reiheUebernahmenEin(jobs(), { vorschauLauf: vorschau + 1, bereiche: ["weg"], actorRef: null }),
        ).toEqual(["weg"]);
        expect(await wartend()).toHaveLength(2);
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Der Legacy-Zug
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 Läuft ein Legacy-Zug, wartet die Übernahme (kein Fehler): Der Stand nennt den Grund und die Bereiche, der Auftrag gibt seinen Platz zurück; danach läuft er von selbst weiter", async () => {
        await neueWelt(legeWegeAn);
        const tester = await welt.jemand("tester");
        const editor = await welt.jemand("editor");
        ausloeser = editor.id;
        await vorschauMitFolge(["weg"]);
        const uebernahme = (await wartend())[0]!;
        expect(uebernahme.kind).toBe("wiki_uebernehmen");
        // Ein Legacy-Zug läuft (eine Zeile mit dem Zustand RUNNING reicht dem Stand und dem Auftrag).
        const [zug] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('legacy_zug', 1::smallint, 'aventuria', ${editor.id}, '{"kategorie":"orte"}'::jsonb, 50::smallint, NULL, 'domain', '{}'::smallint[])
        `;
        await admin()`
            UPDATE job SET state = 'RUNNING', lease_owner = 'test', lease_no = 1, lease_expires_at = now() + interval '1 hour', started_at = now()
             WHERE public_id = ${zug!.public_id}::uuid
        `;

        const antwort = await app.inject({
            method: "GET",
            url: WIKISYNC_STAND_URL,
            headers: { cookie: tester.cookie, host: "avesmaps.test" },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const stand = antwort.json<WikisyncStand>();
        expect(stand.auftraege.find((auftrag) => auftrag.art === "wiki_uebernehmen")).toMatchObject({
            zustand: "QUEUED",
            wartetAuf: "legacy_zug",
            bereiche: ["weg"],
        });
        // Der Auftrag selbst gibt seinen Platz zurück, bevor er etwas anlegt: kein Eintrag im Protokoll, nichts geschrieben.
        await expect(
            runWikiUebernehmenJob(kontext(uebernahme.input_ref, uebernahme.public_id), {
                environment: einsatz,
                mitDatenbank: mitJobs,
            }),
        ).rejects.toBeInstanceOf(JobStopped);
        expect(await zahl(`SELECT count(*)::int AS n FROM wikisync_uebernahme`)).toBe(0);
        // Der Zug ist fertig: Der Auftrag läuft von selbst weiter.
        await admin()`UPDATE job SET state = 'SUCCEEDED', finished_at = now() WHERE public_id = ${zug!.public_id}::uuid`;
        await uebernimm(uebernahme);
        expect(await wert(`SELECT bereich, status FROM wikisync_uebernahme`)).toEqual([
            { bereich: "weg", status: "fertig" },
        ]);
    });

    it("🔴 Ein Auftrag der Vorschau trägt seine Folge im Stand (die Oberfläche zeigt damit die Bereiche des Laufs); eine Vorschau ohne Folge nennt keine", async () => {
        await neueWelt(async (db) => {
            await legeOrteAn(db);
            await legeWegeAn(db);
        });
        const tester = await welt.jemand("tester");
        const editor = await welt.jemand("editor", { frisch: true, passkey: true });
        const lesen = async (): Promise<WikisyncStand> =>
            (
                await app.inject({
                    method: "GET",
                    url: WIKISYNC_STAND_URL,
                    headers: { cookie: tester.cookie, host: "avesmaps.test" },
                })
            ).json<WikisyncStand>();
        await cluster!.app`
            SELECT job_enqueue('wiki_vorschau', 1::smallint, 'aventuria', ${editor.id}, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        const ohne = (await lesen()).auftraege;
        expect(ohne).toHaveLength(1);
        expect(ohne[0]).not.toHaveProperty("bereiche");
        await aufraeumen();
        await alsStage(() =>
            welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, {
                operationId: randomUUID(),
                bereiche: ["weg", "ort"],
                ablauf: "ganz",
            }),
        );
        expect((await lesen()).auftraege).toEqual([
            expect.objectContaining({ art: "wiki_vorschau", zustand: "QUEUED", bereiche: ["ort", "weg"] }),
        ]);
    });
});

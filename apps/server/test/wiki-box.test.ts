import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    editorWikiSyncEditRestoreSeriesPreviewUrl,
    editorWikiSyncEditRestoreSeriesUrl,
    wikiBoxEntfernenUrl,
    wikiBoxSucheUrl,
    wikiBoxSyncUrl,
    wikiBoxUrl,
    wikiBoxZuweisenUrl,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiArtikelJob } from "../src/jobs/wiki-artikel-job.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange } from "../src/editor/history.ts";
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
import {
    DUMP,
    ID,
    legeGebieteAn,
    legeGipfelAn,
    legeLandschaftenAn,
    legeOrteAn,
    legeWegeAn,
    raeumeAb,
    schreibeKategorienZurWelt,
    uuid,
    wiki,
} from "./support/wikisync-welt.ts";

/**
 * Die Wiki-Box im Objekteditor (WI-0253; Entwurf `review/wi-0253/wikifeld-sync-mockup.html`): Stand, Suche, Zuweisen, Entfernen und der Sync am Objekt, am Beispiel des Orts; die übrigen vier Arten (Weg, Herrschaftsgebiet, Landschaft, Kraftlinie) hinten. Wegwerf-Cluster mit den Rollen und Rechten des VPS, Fastify als App-Rolle für die Routen, der Auftrag als Jobs-Rolle gegen das Testwiki. 🔴 Kein Test fragt de.wiki-aventurica.de.
 *
 * - **Soll:** Zuweisen und Entfernen wirken sofort (eine Operation, im Verlauf); Entfernen lässt die Felder als eigene Werte stehen; der Sync holt EINEN Artikel und schreibt nur die wiki-eigenen Felder DIESES
 *   Objekts, hält Zeit, Ergebnis und Auslöser fest und lässt eigene Werte stehen; der Lauf einer Übernahme hinterlässt „automatisch“.
 * - **Problemfälle:** lokal gesperrt (409 mit Grund, kein Auftrag), Artikel ohne Wiki-Stand, ein Sync neben dem anderen, 429 (gesperrt bis zum Ende der Pause), ein Artikel, den es
 *   nicht gibt, Rechte (Reviewer liest, Editor schreibt), ein Zuweisen auf einen Artikel, den es nicht gibt, zweimal Entfernen.
 */

const ENV = "wikiboxs";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0253-box-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    mapEditing: "testwelt",
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
    process.env["RELEASE_ID"] = "box-test";
    process.env["WIKI_TAKT_ROOT"] = "C:/box-test-takt";
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

describeWithCluster("Wiki-Box (Wegwerf-Cluster, Rollen wie auf dem VPS)", () => {
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
    const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);

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

    const get = (url: string, cookie?: string) =>
        app.inject({
            method: "GET",
            url,
            headers: { host: "avesmaps.test", ...(cookie === undefined ? {} : { cookie }) },
        });
    const post = (url: string, cookie: string | undefined, body: object = {}) =>
        welt.post(url, cookie, { operationId: randomUUID(), ...body });

    /** Ein Auftrag der Warteschlange, den eine Person ausgelöst hat, damit der Auftrag als diese Person handelt. */
    async function auftragVon(personId: string): Promise<string> {
        const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('wiki_artikel', 1::smallint, 'aventuria', ${personId}, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return job!.public_id;
    }

    const wartend = (): Promise<{ kind: string; input_ref: Record<string, unknown>; actor_ref: string }[]> =>
        wert(`SELECT kind, input_ref, actor_ref FROM job WHERE state = 'QUEUED' ORDER BY id`);
    const aufraeumen = (): Promise<unknown> =>
        admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;

    async function neueWelt(bau: (db: Database) => Promise<void> = legeOrteAn): Promise<void> {
        await raeumeAb(admin());
        await admin()`TRUNCATE wikisync_artikel, wikisync_objekt, powerline_wiki_assignment, wiki_powerline_snapshot, powerline RESTART IDENTITY CASCADE`;
        await bau(admin());
        // Die Titel der Wiki-Stände (die Welt nennt nur Namen der Infobox).
        await admin()`UPDATE wiki_settlement_snapshot SET wiki_title = CASE wiki_key WHEN 'alt-havena' THEN 'Alt Havena' ELSE initcap(wiki_key) END`;
        await mkdir((taktOrdner = join(ordner.pfad, `takt${String((zaehler += 1))}`)), { recursive: true });
        uhr.jetzt = START;
        testwiki.anfragen.length = 0;
        testwiki.antworter = null;
    }

    /** Der Sync als Auftrag, wie ihn die Route einreiht: derselbe Eingang `wiki_artikel` mit dem Objekt. */
    const syncJob = async (
        personId: string,
        id: string,
        titel: string,
        client?: WikiClient,
        art = "ort",
        ids: string[] = [id],
    ) =>
        runWikiArtikelJob(
            kontext({ titel, ausgeloestVon: "Edora", objekt: { art, id, ids } }, await auftragVon(personId)),
            {
                client: client ?? bauClient(),
                mitDatenbank: mitJobs,
            },
        );

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wiki-box");
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
    // Der Stand und die Suche
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("Der Stand nennt Artikel und Schlüssel, den Grund, warum der Sync nichts tut (lokal, ohne Wiki-Stand), und ist ab Reviewer zu lesen", async () => {
        await neueWelt();
        const tester = await welt.jemand("tester");
        const reviewer = await welt.jemand("reviewer");
        expect((await get(wikiBoxUrl("ort", ID.gareth))).statusCode).toBe(401);
        expect((await get(wikiBoxUrl("ort", ID.gareth), tester.cookie)).statusCode).toBe(403);

        // Lokal: Der Artikel ist da, der Abruf gesperrt.
        const lokal = (await get(wikiBoxUrl("ort", ID.gareth), reviewer.cookie)).json();
        expect(lokal).toMatchObject({
            art: "ort",
            id: ID.gareth,
            name: "Gareht",
            artikel: { key: "gareth", name: "Gareth" },
            sync: { moeglich: false, grund: "abruf_gesperrt", laeuft: false, letzter: null, fehler: null },
        });
        expect(lokal.artikel.url).toContain("/wiki/Gareth");
        await alsStage(async () => {
            const stage = (id: string) => get(wikiBoxUrl("ort", id), reviewer.cookie).then((a) => a.json());
            expect(await stage(ID.gareth)).toMatchObject({ sync: { moeglich: true } });
            // Nur eine Adresse, kein Wiki-Stand.
            expect(await stage(ID.selem)).toMatchObject({ sync: { moeglich: false, grund: "kein_stand" } });
        });
        // Ein Ort, den es nicht gibt, und eine Art, die es nicht gibt.
        expect((await get(wikiBoxUrl("ort", randomUUID()), reviewer.cookie)).statusCode).toBe(404);
        expect((await get(`/api/editor/wiki-box/stern/${ID.gareth}`, reviewer.cookie)).statusCode).toBe(400);
    });

    it("Die Suche findet Artikel nach Name oder Schlüssel (Groß- und Kleinschreibung egal), nennt, woran einer schon hängt, und kennt keine Muster", async () => {
        await neueWelt();
        const reviewer = await welt.jemand("reviewer");
        const suche = async (q?: string) =>
            (
                await get(
                    `${wikiBoxSucheUrl("ort", ID.fasar)}${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
                    reviewer.cookie,
                )
            ).json();
        const alle = await suche();
        expect(alle.articles.map((a: { key: string }) => a.key)).toEqual(
            expect.arrayContaining(["gareth", "havena", "fasar", "alt-havena", "tempelhain", "ludoo"]),
        );
        expect((await suche("HAVENA")).articles.map((a: { key: string }) => a.key)).toEqual(["alt-havena", "havena"]);
        const gareth = (await suche("gareth")).articles[0];
        expect(gareth).toMatchObject({ key: "gareth", name: "Gareth", belegt: "Gareht" });
        // Die Ortsgröße steht nur, wo sie nicht geraten ist (Gareth: geraten, Havena: Stadt).
        expect(gareth.werte).not.toHaveProperty("groesse");
        expect((await suche("havena")).articles.find((a: { key: string }) => a.key === "havena").werte).toMatchObject({
            groesse: "stadt",
        });
        // `%` und `_` sind Zeichen, kein Muster.
        expect((await suche("%")).articles).toEqual([]);
        expect((await suche("_")).articles).toEqual([]);
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Zuweisen und Entfernen: sofort, im Verlauf
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 Zuweisen wirkt sofort: eine Operation im Verlauf, die Zuordnung mit Herkunft editor, die Tafel X2, die Revision zählt; derselbe Aufruf zweimal schreibt einmal; ab Editor", async () => {
        await neueWelt();
        const reviewer = await welt.jemand("reviewer");
        const editor = await welt.jemand("editor");
        const revision = async () =>
            Number(
                (await wert<{ r: number }>(`SELECT revision::int AS r FROM place WHERE public_id = '${ID.fasar}'`))[0]!
                    .r,
            );
        const vorher = await revision();
        const operationId = randomUUID();
        const url = wikiBoxZuweisenUrl("ort", ID.fasar);

        expect((await post(url, undefined, { key: "havena" })).statusCode).toBe(401);
        expect((await post(url, reviewer.cookie, { key: "havena" })).statusCode).toBe(403);
        // Einen Artikel, den es nicht gibt, gibt es nicht.
        expect((await post(url, editor.cookie, { key: "gibtsnicht" })).json()).toMatchObject({
            error: { code: "validation_failed" },
        });
        expect(await revision()).toBe(vorher);

        const ok = await welt.post(url, editor.cookie, { operationId, key: "havena" });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(ok.json()).toMatchObject({ status: "applied", affected: [{ kind: "place", id: ID.fasar }] });
        expect(await revision()).toBe(vorher + 1);
        expect(
            await wert(
                `SELECT a.assignment_state, a.assignment_origin, a.is_active, s.wiki_key FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id
                  LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id WHERE p.public_id = '${ID.fasar}'`,
            ),
        ).toEqual([{ assignment_state: "assigned", assignment_origin: "editor", is_active: true, wiki_key: "havena" }]);
        expect(
            await wert(
                `SELECT wiki_key, wiki_title, source_system, is_active FROM wiki_key_assignment WHERE legacy_art = 'siedlung' AND object_public_id = '${ID.fasar}'`,
            ),
        ).toEqual([{ wiki_key: "wiki:havena", wiki_title: "Havena", source_system: "avesmaps3d", is_active: true }]);
        // Der Verlauf: eine Operation der Quelle editor, der Eintrag nennt den Schlüssel vorher und nachher.
        expect(
            await wert(
                `SELECT action, source, actor_person_id::text FROM map_operation WHERE action = 'wikibox.zuweisen'`,
            ),
        ).toEqual([{ action: "wikibox.zuweisen", source: "editor", actor_person_id: editor.id }]);
        expect(await wert(`SELECT action, changes FROM map_audit_event WHERE place_public_id = '${ID.fasar}'`)).toEqual(
            [
                {
                    action: "place.wiki_zugewiesen",
                    changes: {
                        wiki: { before: "fasar", after: "havena" },
                        // Die Herkunft der Zuordnung vor und nach dem Schreiben (WI-0265 B8d): damit die Rücknahme sie zurückgibt.
                        zuordnung: {
                            before: { zustand: "assigned", herkunft: "legacy_editor", system: "legacy" },
                            after: { zustand: "assigned", herkunft: "editor", system: "avesmaps3d" },
                        },
                    },
                },
            ],
        );

        // Derselbe Aufruf noch einmal: die gespeicherte Quittung, nichts doppelt.
        const noch = await welt.post(url, editor.cookie, { operationId, key: "havena" });
        expect(noch.json()).toMatchObject({ status: "replayed" });
        expect(await revision()).toBe(vorher + 1);
        // Der Stand zeigt den neuen Artikel.
        expect((await get(wikiBoxUrl("ort", ID.fasar), editor.cookie)).json()).toMatchObject({
            artikel: { key: "havena", name: "Havena" },
        });
    });

    it("🔴 Entfernen: die Zuordnung ist „kein Artikel“, die Felder behalten ihre Werte als eigene (auch das, was nur der Leser aus dem Wiki zeigte), der Import überschreibt es nie; zweimal geht nicht", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        const url = wikiBoxEntfernenUrl("ort", ID.gareth);
        // Gareth: Einwohner folgt dem Wiki, die Lage ist eigen, Oberhaupt und Beschreibung sind leer und zeigen den Wiki-Wert; Name und Ortsgröße folgen dem Wiki.
        await admin()`UPDATE wiki_settlement_snapshot SET description = 'Die Hauptstadt.' WHERE wiki_key = 'gareth'`;
        const ok = await post(url, editor.cookie);
        expect(ok.statusCode, ok.body).toBe(200);

        expect(
            await wert(
                `SELECT a.assignment_state, a.assignment_origin, a.wiki_url, a.snapshot_id FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id WHERE p.public_id = '${ID.gareth}'`,
            ),
        ).toEqual([{ assignment_state: "separated", assignment_origin: "editor", wiki_url: null, snapshot_id: null }]);
        expect(
            await wert(
                `SELECT is_active, retired_origin FROM wiki_key_assignment WHERE legacy_art = 'siedlung' AND object_public_id = '${ID.gareth}'`,
            ),
        ).toEqual([]); // Gareth hatte keine X2-Zeile; es entsteht keine.
        expect(
            await wert(
                `SELECT d.einwohner, d.einwohner_origin, d.lage, d.lage_origin, d.oberhaupt, d.oberhaupt_origin, d.description, d.is_active
                   FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.gareth}'`,
            ),
        ).toEqual([
            {
                einwohner: "7.000",
                einwohner_origin: "manual",
                lage: "Mittelreich",
                lage_origin: "manual",
                oberhaupt: "Kaiser Hal",
                oberhaupt_origin: "manual",
                description: "Die Hauptstadt.",
                is_active: true,
            },
        ]);
        expect(
            await wert(
                `SELECT field, origin FROM field_origin WHERE object_kind = 'place' AND object_id = '${ID.gareth}' ORDER BY field`,
            ),
        ).toEqual([
            { field: "name", origin: "manual" },
            { field: "subtype", origin: "manual" },
        ]);
        expect(await wert(`SELECT name, subtype FROM place WHERE public_id = '${ID.gareth}'`)).toEqual([
            { name: "Gareht", subtype: "dorf" },
        ]);
        expect(
            await wert(`SELECT action, changes FROM map_audit_event WHERE place_public_id = '${ID.gareth}'`),
        ).toEqual([
            {
                action: "place.wiki_entfernt",
                changes: {
                    wiki: { before: "gareth", after: null },
                    zuordnung: {
                        before: { zustand: "assigned", herkunft: "legacy_editor", system: "legacy" },
                        after: { zustand: "separated", herkunft: "editor", system: "avesmaps3d" },
                    },
                },
            },
        ]);
        // Der Stand: kein Artikel, der Sync geht nicht.
        expect((await get(wikiBoxUrl("ort", ID.gareth), editor.cookie)).json()).toMatchObject({
            artikel: null,
            sync: { moeglich: false, grund: "kein_artikel" },
        });
        // Zweimal geht nicht.
        expect((await post(url, editor.cookie)).json()).toMatchObject({ error: { code: "kein_artikel" } });
        // Und ein späteres Zuweisen belebt die Zeile wieder.
        expect((await post(wikiBoxZuweisenUrl("ort", ID.gareth), editor.cookie, { key: "gareth" })).statusCode).toBe(
            200,
        );
        expect(
            await wert(
                `SELECT assignment_state, snapshot_id IS NOT NULL AS stand FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id WHERE p.public_id = '${ID.gareth}'`,
            ),
        ).toEqual([{ assignment_state: "assigned", stand: true }]);
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Der Sync
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 Der Sync holt EINE Seite ohne Anmeldung, schreibt die wiki-eigenen Felder DIESES Orts, lässt Eigenes stehen und hält Zeit, Ergebnis und Auslöser fest; der zweite Sync ändert nichts", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        testwiki.texte.set("Gareth", {
            text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n|Region=Garetien\n|Staat=Mittelreich\n|Oberhaupt=Kaiserin Rohaja\n}}\nGareth ist die Hauptstadt.",
            revid: 4711,
            zeit: "2026-10-20T10:00:00Z",
        });
        const andererOrt = await wert(`SELECT name FROM place WHERE public_id = '${ID.havena}'`);

        const ergebnis = await syncJob(editor.id, ID.gareth, "Gareth");
        expect(ergebnis).toMatchObject({ status: "fertig", ergebnis: "uebernommen" });
        expect(testwiki.anfragen).toHaveLength(1);
        expect(testwiki.anfragen[0]!.abfrage.get("assert")).toBeNull();
        // Name und Einwohner folgten dem Wiki und ändern sich; die Lage ist eine eigene Entscheidung und bleibt.
        expect(await wert(`SELECT name FROM place WHERE public_id = '${ID.gareth}'`)).toEqual([{ name: "Gareth" }]);
        expect(
            await wert(
                `SELECT einwohner, einwohner_origin, lage, lage_origin FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.gareth}'`,
            ),
        ).toEqual([{ einwohner: "7.400", einwohner_origin: "wiki", lage: "Mittelreich", lage_origin: "manual" }]);
        // Der Wiki-Stand hinter ↺ ist nachgezogen.
        expect(
            await wert(`SELECT einwohner, oberhaupt FROM wiki_settlement_snapshot WHERE wiki_key = 'gareth'`),
        ).toEqual([{ einwohner: "7.400", oberhaupt: "Kaiserin Rohaja" }]);
        // Ein anderer Ort bleibt, wie er war.
        expect(await wert(`SELECT name FROM place WHERE public_id = '${ID.havena}'`)).toEqual(andererOrt);
        // Eine Operation der Quelle wikisync, unter dem Namen des Editors.
        expect(
            await wert(`SELECT action, source, actor_person_id::text FROM map_operation WHERE source = 'wikisync'`),
        ).toEqual([{ action: "wikisync.objekt_sync", source: "wikisync", actor_person_id: editor.id }]);
        // Der Stand am Objekt.
        const stand = (await get(wikiBoxUrl("ort", ID.gareth), editor.cookie)).json();
        expect(stand.sync.letzter).toMatchObject({ ergebnis: "uebernommen", automatisch: false, wer: editor.name });
        expect(stand.sync.letzter.felder).toEqual(expect.arrayContaining(["name", "einwohner"]));
        expect(stand.sync.letzter.anzahl).toBe(stand.sync.letzter.felder.length);
        expect(
            await wert(
                `SELECT wiki_revision::int AS r FROM wikisync_objekt WHERE art = 'ort' AND objekt_id = '${ID.gareth}'`,
            ),
        ).toEqual([{ r: 4711 }]);

        // Der zweite Sync: nichts Neues, keine zweite Operation, der Stand sagt es.
        const zweiter = await syncJob(editor.id, ID.gareth, "Gareth");
        expect(zweiter).toMatchObject({ status: "fertig", ergebnis: "keine_aenderung" });
        expect(await wert(`SELECT count(*)::int AS n FROM map_operation WHERE source = 'wikisync'`)).toEqual([
            { n: 1 },
        ]);
        expect((await get(wikiBoxUrl("ort", ID.gareth), editor.cookie)).json().sync.letzter).toMatchObject({
            ergebnis: "keine_aenderung",
            felder: [],
            anzahl: 0,
        });
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Der Sync in „Änderungen“ (WI-0265 B8e)
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    describe("B8e: der Sync eines Objekts ist in „Änderungen“ rücknehmbar", () => {
        const hash = (op: string): string => mitgliederHash([op]);
        const vorschauUrl = editorWikiSyncEditRestoreSeriesPreviewUrl;
        const rueckUrl = editorWikiSyncEditRestoreSeriesUrl;
        const vorpruefung = async (op: string, cookie: string) =>
            (await post(vorschauUrl(op), cookie, { members: [op], membersHash: hash(op) })).json();
        const reiter = (op: string, cookie: string | undefined, extra: object = {}) =>
            post(rueckUrl(op), cookie, { members: [op], membersHash: hash(op), ...extra });
        const eintragVon = async (personId: string, op: string) =>
            (await mapChange(cluster!.app, op, { mapDomainId: "aventuria", personId }))!;
        const ortStand = async () =>
            (
                await wert<Record<string, unknown>>(
                    `SELECT p.name, d.einwohner, d.einwohner_origin, d.lage, d.lage_origin FROM place p JOIN place_detail d ON d.place_id = p.id WHERE p.public_id = '${ID.gareth}'`,
                )
            )[0]!;
        const wikiStand = async () =>
            (
                await wert<Record<string, unknown>>(
                    `SELECT to_jsonb(s) - 'updated_at' AS stand FROM wiki_settlement_snapshot s WHERE wiki_key = 'gareth'`,
                )
            )[0]!;
        const syncOperation = async (): Promise<string> =>
            (
                await wert<{ op: string }>(
                    `SELECT operation_id::text AS op FROM map_operation WHERE action = 'wikisync.objekt_sync'`,
                )
            )[0]!.op;
        /** Der Auftrag der Rücknahme, bis er fertig ist; gibt sein Ergebnis zurück. */
        const laufe = async (): Promise<{
            status: string;
            operationId: string | null;
            felder: number;
            befunde: number;
        }> => {
            const [job] = await wert<{ public_id: string; input_ref: Record<string, unknown> }>(
                `SELECT public_id::text, input_ref FROM job WHERE kind = 'wiki_zuruecknehmen' AND state = 'QUEUED'`,
            );
            const ergebnis = (await runWikiZuruecknehmenJob(kontext(job!.input_ref, job!.public_id), {
                mitDatenbank: mitJobs,
            })) as { status: string; operationId: string | null; felder: number; befunde: number };
            await aufraeumen();
            return ergebnis;
        };
        const garethText = {
            text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n|Region=Garetien\n|Staat=Mittelreich\n|Oberhaupt=Kaiserin Rohaja\n}}\nGareth ist die Hauptstadt.",
            revid: 4711,
            zeit: "2026-10-20T10:00:00Z",
        };

        it("🔴 Auftrag: Feld für Feld aus Vorher und Nachher des Protokolls (Wert, Wiki-Stand, Herkunft), mit Recht edit_map_objects; die Rücknahme ist selbst rücknehmbar; Sync-Stand und Wiki-Box lesen weiter wie vorher", async () => {
            await neueWelt();
            const editor = await welt.jemand("editor");
            const leser = await welt.jemand("reviewer");
            testwiki.texte.set("Gareth", garethText);
            const ortVorher = await ortStand();
            const wikiVorher = await wikiStand();
            expect(await syncJob(editor.id, ID.gareth, "Gareth")).toMatchObject({
                status: "fertig",
                ergebnis: "uebernommen",
            });
            const ortNachher = await ortStand();
            const wikiNachher = await wikiStand();
            expect(ortNachher).not.toEqual(ortVorher);
            const sync = await syncOperation();

            // Die Liste: rücknehmbar, Quelle wikisync, Aktion des Syncs.
            expect(await eintragVon(editor.id, sync)).toMatchObject({
                operation: "wikisync.objekt_sync",
                source: "wikisync",
                status: "ruecknehmbar",
            });
            // Die Vorprüfung liest nur; ohne das Recht edit_map_objects forbidden, sonst ok mit der Zahl der Objekte.
            expect((await vorpruefung(sync, leser.cookie)).ergebnis).toBe("forbidden");
            const vor = await vorpruefung(sync, editor.cookie);
            expect(vor.ergebnis).toBe("ok");
            expect(vor.offen).toEqual([sync]);
            expect(vor.folgen).toEqual({ gegenstaende: 1, gelaende: "keines" });
            expect((await reiter(sync, leser.cookie)).statusCode).toBe(403);
            expect((await reiter(sync, undefined)).statusCode).toBe(401);
            expect(await wartend()).toEqual([]);

            // Die Route reiht den Auftrag ein (nichts wird in der Anfrage geschrieben).
            const ok = await reiter(sync, editor.cookie);
            expect(ok.statusCode, ok.body).toBe(200);
            expect(ok.json()).toMatchObject({ status: "applied", reverts: [] });
            expect(ok.json().derivedWork).toMatchObject([{ kind: "wiki_zuruecknehmen", state: "queued" }]);
            expect(await ortStand()).toEqual(ortNachher);
            const eingereiht = (await wartend())[0]!;
            expect(eingereiht.kind).toBe("wiki_zuruecknehmen");
            expect(eingereiht.input_ref).toEqual({ bereich: "ort", objekt: sync });
            expect(eingereiht.actor_ref).toBe(editor.id);
            // Ein zweiter Klick, solange der Auftrag wartet: 409.
            expect((await reiter(sync, editor.cookie)).json()).toMatchObject({ error: { code: "uebernahme_laeuft" } });

            const erste = await laufe();
            expect(erste).toMatchObject({ status: "fertig" });
            const rueck = erste.operationId!;
            expect(erste.felder).toBeGreaterThan(0);
            // Wert, Herkunft und Wiki-Stand stehen wie vor dem Sync da.
            expect(await ortStand()).toEqual(ortVorher);
            expect(await wikiStand()).toEqual(wikiVorher);
            expect(await eintragVon(editor.id, sync)).toMatchObject({
                status: "bereits_zurueckgenommen",
                revertedBy: { operationId: rueck, actor: { kind: "person", id: editor.id } },
            });
            expect(await eintragVon(editor.id, rueck)).toMatchObject({
                operation: "wikisync.objekt_zuruecknehmen",
                source: "wikisync",
                status: "ruecknehmbar",
                reverts: [sync],
            });
            // Die Rücknahme nennt den Sync in ihrer Quittung (die Jobs-Rolle hängt die Link-Tafel nicht an).
            expect(
                await wert(
                    `SELECT a ->> 'id' AS r FROM map_operation o, jsonb_array_elements(o.receipt -> 'affected') a WHERE o.operation_id = '${rueck}' AND a ->> 'kind' = 'wikisync_operation'`,
                ),
            ).toEqual([{ r: sync }]);
            expect(
                await wert(`SELECT 1 AS n FROM map_operation_revert_link WHERE restore_operation_id = '${rueck}'`),
            ).toEqual([]);
            // Der Sync-Stand ist ein Protokoll und bleibt, wie er war; ein zweites ↺ am Sync sagt already_reverted.
            expect((await vorpruefung(sync, editor.cookie)).ergebnis).toBe("already_reverted");
            expect((await reiter(sync, editor.cookie)).statusCode).toBe(409);

            // Die Rücknahme der Rücknahme: der Stand nach dem Sync ist wieder da, der Sync gilt wieder.
            expect((await vorpruefung(rueck, editor.cookie)).ergebnis).toBe("ok");
            expect((await reiter(rueck, editor.cookie)).statusCode).toBe(200);
            const zweite = await laufe();
            expect(zweite).toMatchObject({ status: "fertig" });
            expect(await ortStand()).toEqual(ortNachher);
            expect(await wikiStand()).toEqual(wikiNachher);
            expect((await eintragVon(editor.id, sync)).status).toBe("ruecknehmbar");
            expect(await eintragVon(editor.id, rueck)).toMatchObject({
                status: "bereits_zurueckgenommen",
                revertedBy: { operationId: zweite.operationId },
            });
            expect(await eintragVon(editor.id, zweite.operationId!)).toMatchObject({
                status: "ruecknehmbar",
                reverts: [rueck],
            });
        });

        it("🔴 Feld für Feld: Was seither jemand änderte, bleibt (Befund im Ergebnis); weicht jedes Feld ab, ist es ein Konflikt mit den Feldern und kein Auftrag wird eingereiht", async () => {
            await neueWelt();
            const editor = await welt.jemand("editor");
            testwiki.texte.set("Gareth", garethText);
            const ortVorher = await ortStand();
            await syncJob(editor.id, ID.gareth, "Gareth");
            const sync = await syncOperation();

            // Ein Feld hat jemand seither geändert: Die Rücknahme geht für die übrigen, das eine bleibt.
            await admin()`UPDATE place_detail SET einwohner = '9.999' WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth})`;
            expect((await vorpruefung(sync, editor.cookie)).ergebnis).toBe("ok");
            expect((await reiter(sync, editor.cookie)).statusCode).toBe(200);
            const teilweise = await laufe();
            expect(teilweise).toMatchObject({ status: "fertig" });
            expect(teilweise.felder).toBeGreaterThan(0);
            expect(teilweise.befunde).toBeGreaterThan(0);
            const nach = await ortStand();
            expect(nach["name"]).toBe(ortVorher["name"]);
            expect(nach["einwohner"]).toBe("9.999");

            // Nun weicht alles ab: Name und Einwohner stehen anders da, und der Wiki-Stand ebenso. Vorprüfung und Route sagen Konflikt; es wird nichts eingereiht.
            const zweiter = await syncJob(editor.id, ID.gareth, "Gareth");
            expect(zweiter).toMatchObject({ status: "fertig" });
            const sync2 = (
                await wert<{ op: string }>(
                    `SELECT operation_id::text AS op FROM map_operation WHERE action = 'wikisync.objekt_sync' AND operation_id <> '${sync}' ORDER BY seq DESC LIMIT 1`,
                )
            )[0]?.op;
            expect(sync2).toBeDefined();
            await admin()`UPDATE place SET name = 'Eigener Name' WHERE public_id = ${ID.gareth}`;
            await admin()`UPDATE place_detail SET einwohner = 'Eigene Zahl' WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth})`;
            await admin()`UPDATE wiki_settlement_snapshot SET wiki_name = 'x', einwohner = 'x', oberhaupt = 'x', description = 'x' WHERE wiki_key = 'gareth'`;
            const vor = await vorpruefung(sync2!, editor.cookie);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte[0]).toMatchObject({
                art: "wert",
                kind: "place",
                id: ID.gareth,
                abweichung: { was: "felder" },
            });
            const abgelehnt = await reiter(sync2!, editor.cookie);
            expect(abgelehnt.statusCode).toBe(409);
            expect(abgelehnt.json()).toMatchObject({ error: { code: "edit_conflict" } });
            expect(await wartend()).toEqual([]);
        });
    });

    it("Ein Fehler des Wikis ist ein Ergebnis: 429 sperrt den Sync bis zum Ende der Pause (die Route sagt es mit der Uhrzeit), ein fehlender Artikel steht als Grund da; ein Erfolg löscht den Fehler", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        testwiki.antworter = () => ({ status: 429, kopf: { "retry-after": "60" } });
        const ergebnis = await syncJob(editor.id, ID.havena, "Havena");
        expect(ergebnis).toMatchObject({ status: "fehlgeschlagen", fehlerCode: "http_429" });
        const stand = (await get(wikiBoxUrl("ort", ID.havena), editor.cookie)).json();
        expect(stand.sync.letzter).toBeNull();
        expect(stand.sync.fehler).toMatchObject({ code: "http_429" });
        // Die Pause ist mindestens fünf Minuten lang (der Transport verhängt sie), und die Box nennt ihr Ende.
        const freiAb = new Date(stand.sync.fehler.freiAb).getTime();
        expect(freiAb).toBeGreaterThan(Date.now());
        await alsStage(async () => {
            const gesperrt = await post(wikiBoxSyncUrl("ort", ID.havena), editor.cookie);
            expect(gesperrt.statusCode).toBe(409);
            expect(gesperrt.json()).toMatchObject({
                error: { code: "pausiert", details: { freiAb: stand.sync.fehler.freiAb } },
            });
        });
        expect(await wartend()).toEqual([]);

        // Ein Artikel, den es nicht gibt (nach der Pause): ein Grund, kein Absturz.
        testwiki.antworter = null;
        uhr.jetzt = START + 3_600_000;
        await admin()`UPDATE wikisync_objekt SET frei_ab = now() - interval '1 minute'`;
        const nicht = await syncJob(editor.id, ID.havena, "Nirgendwo");
        expect(nicht).toMatchObject({ status: "fehlgeschlagen", fehlerCode: "nicht_im_wiki" });
        expect((await get(wikiBoxUrl("ort", ID.havena), editor.cookie)).json().sync.fehler).toMatchObject({
            code: "nicht_im_wiki",
            freiAb: null,
        });
        // Ein Erfolg löscht den Fehler.
        testwiki.texte.set("Havena", {
            text: "{{Infobox Siedlung\n|Name=Havena\n|Einwohner=9.000\n}}\nHavena.",
            revid: 12,
            zeit: "2026-10-20T10:00:00Z",
        });
        expect(await syncJob(editor.id, ID.havena, "Havena")).toMatchObject({ status: "fertig" });
        expect((await get(wikiBoxUrl("ort", ID.havena), editor.cookie)).json().sync).toMatchObject({
            fehler: null,
            letzter: { wer: editor.name },
        });
    });

    it("🔴 Die Route reiht den Sync ein (ab Editor, nur wo es geht): Auftrag mit Objekt und Person; lokal 409, ohne Wiki-Stand 409, neben einem wartenden 409; sie fragt das Wiki nie", async () => {
        await neueWelt();
        const reviewer = await welt.jemand("reviewer");
        const editor = await welt.jemand("editor");
        const url = (id: string) => wikiBoxSyncUrl("ort", id);
        expect((await post(url(ID.gareth), reviewer.cookie)).statusCode).toBe(403);
        // Lokal gibt es keinen Abruf.
        expect((await post(url(ID.gareth), editor.cookie)).json()).toMatchObject({
            error: { code: "abruf_gesperrt", details: { grund: "abruf_gesperrt" } },
        });
        expect(await wartend()).toEqual([]);
        await alsStage(async () => {
            expect((await post(url(ID.selem), editor.cookie)).json()).toMatchObject({ error: { code: "kein_stand" } });
            const ok = await post(url(ID.gareth), editor.cookie);
            expect(ok.statusCode, ok.body).toBe(200);
            const [job] = await wartend();
            expect(job).toMatchObject({
                kind: "wiki_artikel",
                actor_ref: editor.id,
                input_ref: {
                    titel: "Gareth",
                    ausgeloestVon: editor.name,
                    objekt: { art: "ort", id: ID.gareth, ids: [ID.gareth] },
                },
            });
            // Der Stand sagt, dass er läuft; ein zweiter Klick wird abgewiesen, ein anderer Ort darf.
            expect((await get(wikiBoxUrl("ort", ID.gareth), editor.cookie)).json().sync).toMatchObject({
                laeuft: true,
            });
            expect((await post(url(ID.gareth), editor.cookie)).json()).toMatchObject({
                error: { code: "sync_laeuft" },
            });
            expect((await post(url(ID.havena), editor.cookie)).statusCode).toBe(200);
        });
        expect(testwiki.anfragen).toEqual([]);
    });

    it("Der Auftrag des Vergleichs bleibt, wie er war: ohne Objekt schreibt er nur seinen Vergleich; ein falsches Objekt in der Eingabe lehnt er ab", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        testwiki.texte.set("Gareth", {
            text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n}}\nX.",
            revid: 1,
            zeit: "2026-10-20T10:00:00Z",
        });
        const vorher = await wert(`SELECT name FROM place WHERE public_id = '${ID.gareth}'`);
        const ergebnis = await runWikiArtikelJob(kontext({ titel: "Gareth" }, await auftragVon(editor.id)), {
            client: bauClient(),
            mitDatenbank: mitJobs,
        });
        expect(ergebnis).toMatchObject({ status: "fertig" });
        expect(await wert(`SELECT name FROM place WHERE public_id = '${ID.gareth}'`)).toEqual(vorher);
        expect(await wert(`SELECT count(*)::int AS n FROM wikisync_artikel`)).toEqual([{ n: 1 }]);
        expect(await wert(`SELECT count(*)::int AS n FROM wikisync_objekt`)).toEqual([{ n: 0 }]);
        for (const objekt of [
            { art: "stern", id: ID.gareth, ids: [ID.gareth] },
            { art: "ort", id: "x", ids: [ID.gareth] },
            { art: "ort", id: ID.gareth, ids: [] },
            { art: "ort", id: ID.gareth, ids: [ID.gareth], zusatz: 1 },
        ]) {
            await expect(
                runWikiArtikelJob(kontext({ titel: "Gareth", objekt }), { client: bauClient(), mitDatenbank: mitJobs }),
            ).rejects.toMatchObject({ code: "input_invalid" });
        }
    });

    it("🔴 Lokal gesperrt: Ohne Stage oder Production entsteht kein Client, der Auftrag legt keinen Stand an", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        await expect(
            runWikiArtikelJob(
                kontext(
                    { titel: "Gareth", objekt: { art: "ort", id: ID.gareth, ids: [ID.gareth] } },
                    await auftragVon(editor.id),
                ),
                { environment: { AVESMAPS_ENV: "test" }, mitDatenbank: mitJobs },
            ),
        ).rejects.toMatchObject({ code: "abruf_gesperrt" });
        expect(await wert(`SELECT count(*)::int AS n FROM wikisync_objekt`)).toEqual([{ n: 0 }]);
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Der Lauf einer Übernahme: „automatisch“
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("Der Lauf einer Übernahme hinterlässt an den berührten Orten „automatisch“ als Auslöser; ein Ort, den er nicht berührt, hat keinen Stand", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["ort"] }), {
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
        expect((ergebnis["lauf"] as { id: number }).id).toBeGreaterThan(0);
        // Die Ortsgröße kommt aus der Kategorien-Datei und steht schon in der Vorschau (WI-0294).
        const bulk = (await runWikiUebernehmenJob(kontext({ bereiche: ["ort"] }, await auftragVon(editor.id)), {
            environment: { AVESMAPS_ENV: "test" },
            mitDatenbank: mitJobs,
        })) as { bereiche: { status: string }[] };
        expect(bulk.bereiche.map((b) => b.status)).toEqual(["fertig"]);
        const stand = await wert<{
            objekt_id: string;
            ergebnis: string;
            automatisch: boolean;
            ausgeloest_von: string | null;
        }>(
            `SELECT objekt_id::text, ergebnis, automatisch, ausgeloest_von::text FROM wikisync_objekt WHERE art = 'ort' ORDER BY objekt_id`,
        );
        expect(stand.length).toBeGreaterThan(0);
        expect(stand.every((zeile) => zeile.automatisch && zeile.ausgeloest_von === null)).toBe(true);
        expect(stand.find((zeile) => zeile.objekt_id === ID.gareth)).toMatchObject({ ergebnis: "uebernommen" });
        const box = (await get(wikiBoxUrl("ort", ID.gareth), editor.cookie)).json();
        expect(box.sync.letzter).toMatchObject({ automatisch: true, wer: null, ergebnis: "uebernommen" });
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Die übrigen Arten: Weg, Herrschaftsgebiet, Landschaft, Kraftlinie
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    const idListe = (ids: readonly string[]): string => `ARRAY['${ids.join("','")}']::uuid[]`;
    const revisionen = async (tabelle: string, ids: readonly string[]): Promise<Record<string, number>> =>
        Object.fromEntries(
            (
                await wert<{ id: string; r: number }>(
                    `SELECT public_id::text AS id, revision::int AS r FROM ${tabelle} WHERE public_id = ANY(${idListe(ids)}) ORDER BY public_id`,
                )
            ).map((zeile) => [zeile.id, zeile.r]),
        );

    it("🔴 Weg: Die Box gehört der Straße (alle Abschnitte), nennt „an n von m Abschnitten“, weist die Hauptzuweisung an ALLEN zu, löst sie an allen", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        const strasse = [ID.mitteQ1, ID.mitteQ2];

        // Nur ein Abschnitt der Straße „Mittelpfad-alt“ hängt am Artikel.
        const stand = (await get(wikiBoxUrl("weg", ID.mitteQ2), editor.cookie)).json();
        expect(stand).toMatchObject({
            art: "weg",
            name: "Mittelpfad-alt",
            artikel: { key: "mittelpfad", name: "Mittelpfad-alt" },
            anteil: { mit: 1, von: 2 },
        });
        // Ein Abschnitt einer anderen Straße gehört nicht dazu.
        expect((await get(wikiBoxUrl("weg", ID.mittelweg), editor.cookie)).json()).toMatchObject({
            name: "Mittelweg",
            artikel: null,
        });

        // Zuweisen: an beiden Abschnitten die Hauptzuweisung (der eine wird belegt, der andere neu angelegt), die Revision zählt an beiden, die Tafel X2 trägt beide.
        const vorher = await revisionen("path", strasse);
        const ok = await post(wikiBoxZuweisenUrl("weg", ID.mitteQ1), editor.cookie, { key: "reichsstrasse-1" });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(
            ok
                .json()
                .affected.map((a: { id: string }) => a.id)
                .sort(),
        ).toEqual([...strasse].sort());
        const nachher = await revisionen("path", strasse);
        for (const id of strasse) expect(nachher[id]).toBe((vorher[id] ?? 0) + 1);
        expect(
            await wert(
                `SELECT p.public_id::text AS id, w.role, w.assignment_origin, s.wiki_key FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                   JOIN wiki_path_snapshot s ON s.id = w.snapshot_id WHERE p.public_id = ANY(${idListe(strasse)}) AND w.is_active ORDER BY p.public_id`,
            ),
        ).toEqual(
            strasse.map((id) => ({ id, role: "main", assignment_origin: "editor", wiki_key: "reichsstrasse-1" })),
        );
        expect(
            await wert(
                `SELECT count(*)::int AS n FROM wiki_key_assignment WHERE legacy_art = 'weg' AND is_active AND wiki_key = 'wiki:reichsstrasse-1' AND object_public_id = ANY(${idListe(strasse)})`,
            ),
        ).toEqual([{ n: 2 }]);
        const danach = (await get(wikiBoxUrl("weg", ID.mitteQ1), editor.cookie)).json();
        expect(danach).toMatchObject({ artikel: { key: "reichsstrasse-1" } });
        expect(danach).not.toHaveProperty("anteil");

        // Eine weitere Zuweisung auf denselben Artikel wird still gelegt, damit die Tafel ihn nicht doppelt hält (der Zweite Weg trägt „Weiterer Weg“ als weitere).
        expect(
            (await post(wikiBoxZuweisenUrl("weg", ID.zwei), editor.cookie, { key: "weiterer-weg" })).statusCode,
        ).toBe(200);
        expect(
            await wert(
                `SELECT w.role, w.is_active, s.wiki_key FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id JOIN wiki_path_snapshot s ON s.id = w.snapshot_id WHERE p.public_id = '${ID.zwei}' ORDER BY w.role`,
            ),
        ).toEqual([
            { role: "further", is_active: false, wiki_key: "weiterer-weg" },
            { role: "main", is_active: true, wiki_key: "weiterer-weg" },
        ]);

        // Entfernen: die Hauptzuweisung der Straße still gelegt, der Name bleibt, der Vermerk wird „manual“.
        const alt = [ID.altA1, ID.altA2, ID.altA3];
        const entfernt = await post(wikiBoxEntfernenUrl("weg", ID.altA2), editor.cookie);
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        expect(
            await wert(
                `SELECT w.is_active, w.retired_origin FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id WHERE p.public_id = ANY(${idListe(alt)})`,
            ),
        ).toEqual(alt.map(() => ({ is_active: false, retired_origin: "editor" })));
        expect(
            await wert(
                `SELECT DISTINCT origin FROM field_origin WHERE object_kind = 'path' AND object_id = ANY(${idListe(alt)})`,
            ),
        ).toEqual([{ origin: "manual" }]);
        expect(await wert(`SELECT DISTINCT name FROM path WHERE public_id = ANY(${idListe(alt)})`)).toEqual([
            { name: "Alte Reichsstrasse" },
        ]);
        expect((await get(wikiBoxUrl("weg", ID.altA1), editor.cookie)).json()).toMatchObject({
            artikel: null,
            sync: { grund: "kein_artikel" },
        });
    });

    it("🔴 Weg, weitere Artikel (WI-0300, OPS-000108): der Stand nennt sie, an einem Teil der Abschnitte mit Anteil; „Entfernen“ lässt sie stehen (seit WI-0302 schreibt die Box sie nicht mehr)", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        const alt = [ID.altA1, ID.altA2, ID.altA3];
        const weitere = async (): Promise<{ key: string; aktiv: number; herkunft: string }[]> =>
            wert(
                `SELECT s.wiki_key AS key, count(*) FILTER (WHERE w.is_active)::int AS aktiv, min(w.assignment_origin) AS herkunft
                   FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                  WHERE p.public_id = ANY(${idListe(alt)}) AND w.role = 'further' GROUP BY s.wiki_key ORDER BY s.wiki_key`,
            );
        const haenge = (key: string, ids: readonly string[]) =>
            wert(
                `INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
                 SELECT p.id, 'further', s.wiki_url, s.id, 'assigned', 'legacy_editor'
                   FROM path p, wiki_path_snapshot s WHERE p.public_id = ANY(${idListe(ids)}) AND s.wiki_key = '${key}'`,
            );

        // Der Stand: eine Straße ohne weitere nennt eine leere Liste, der Zweite Weg seinen aus dem Import.
        expect((await get(wikiBoxUrl("weg", ID.altA1), editor.cookie)).json()).toMatchObject({ weitere: [] });
        expect((await get(wikiBoxUrl("weg", ID.zwei), editor.cookie)).json().weitere).toEqual([
            { key: "weiterer-weg", url: "https://de.wiki-aventurica.de/wiki/Weiterer_Weg", name: "Weiterer Weg" },
        ]);

        // An allen Abschnitten ohne Anteil, an einem Teil mit Anteil; nach Namen geordnet.
        await haenge("mittelpfad", alt);
        await haenge("neuer-weg", [ID.altA1]);
        const stand = (await get(wikiBoxUrl("weg", ID.altA3), editor.cookie)).json();
        expect(stand).toMatchObject({ artikel: { key: "reichsstrasse-1" } });
        expect(stand.weitere).toEqual([
            { key: "mittelpfad", url: "https://de.wiki-aventurica.de/wiki/Mittelpfad", name: "Mittelpfad-alt" },
            {
                key: "neuer-weg",
                url: "https://de.wiki-aventurica.de/wiki/Neuer_Weg",
                name: "Neuer Weg alt",
                anteil: { mit: 1, von: 3 },
            },
        ]);

        // „Entfernen“ (der Hauptartikel) lässt die weiteren stehen.
        expect((await post(wikiBoxEntfernenUrl("weg", ID.altA1), editor.cookie)).statusCode).toBe(200);
        expect((await weitere()).map((zeile) => [zeile.key, zeile.aktiv])).toEqual([
            ["mittelpfad", 3],
            ["neuer-weg", 1],
        ]);
        expect((await get(wikiBoxUrl("weg", ID.altA1), editor.cookie)).json()).toMatchObject({
            artikel: null,
            weitere: [{ key: "mittelpfad" }, { key: "neuer-weg" }],
        });

        // Die Box schreibt keine weiteren mehr (WI-0302: weitere Straßennamen im Wegeditor): Die Routen gibt es nicht.
        for (const richtung of ["zuweisen", "entfernen"])
            expect(
                (await post(`${wikiBoxUrl("weg", ID.altA1)}/weitere/${richtung}`, editor.cookie, { key: "mittelpfad" }))
                    .statusCode,
            ).toBe(404);
    });

    it("Weg-Sync: Die Anfrage gilt dem Artikel der Straße, der Name wird an allen Abschnitten geschrieben, der Stand an allen vermerkt", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        const alt = [ID.altA1, ID.altA2, ID.altA3];
        testwiki.texte.set("Reichsstraße 1", {
            text: "{{Infobox Straße\n|Name=Reichsstraße 1\n|Art=Reichsstraße\n|Regionen=Garetien\n|Länge=120 Meilen\n}}\nDie erste Reichsstraße.",
            revid: 77,
            zeit: "2026-10-20T10:00:00Z",
        });
        const ergebnis = await syncJob(editor.id, ID.altA1, "Reichsstraße 1", undefined, "weg", alt);
        expect(ergebnis).toMatchObject({ status: "fertig", ergebnis: "uebernommen" });
        expect(await wert(`SELECT DISTINCT name FROM path WHERE public_id = ANY(${idListe(alt)})`)).toEqual([
            { name: "Reichsstraße 1" },
        ]);
        // Eine andere Straße bleibt, wie sie war.
        expect(await wert(`SELECT name FROM path WHERE public_id = '${ID.neuR1}'`)).toEqual([
            { name: "Neuer Weg alt" },
        ]);
        expect(
            await wert(
                `SELECT count(*)::int AS n FROM wikisync_objekt WHERE art = 'weg' AND ergebnis = 'uebernommen' AND objekt_id = ANY(${idListe(alt)})`,
            ),
        ).toEqual([{ n: 3 }]);
        // Die Box liest die jüngste Zeile über alle Abschnitte.
        expect((await get(wikiBoxUrl("weg", ID.altA3), editor.cookie)).json().sync.letzter).toMatchObject({
            ergebnis: "uebernommen",
            wer: editor.name,
        });
    });

    it("🔴 Herrschaftsgebiet: Artikel aus Schlüssel und Adresse, Zuweisen und Entfernen am Gebiet; ein Wert, der dem Wiki folgte, wird ein eigener; der Sync ändert nur, was dem Wiki folgt", async () => {
        await neueWelt(legeGebieteAn);
        const editor = await welt.jemand("editor");
        const stand = (await get(wikiBoxUrl("gebiet", ID.weiden), editor.cookie)).json();
        expect(stand).toMatchObject({
            art: "gebiet",
            name: "Herzogtum Weiden",
            artikel: { key: "wiki:herzogtum-weiden", name: "Herzogtum Weiden" },
            sync: { moeglich: false, grund: "abruf_gesperrt" },
        });
        // Die Suche kennt die Artikel des Wiki-Stands; „hängt an“ nennt das andere Gebiet.
        const suche = (await get(`${wikiBoxSucheUrl("gebiet", ID.greifen)}?q=kosch`, editor.cookie)).json();
        expect(suche.articles).toMatchObject([{ key: "wiki:kosch", name: "Kosch", belegt: "Kosch" }]);

        // Sync: der Herrscher folgt dem Wiki und wird übernommen, die Herrschaftsform ist ein Override und bleibt.
        testwiki.texte.set("Herzogtum Weiden", {
            text: "{{Infobox Staat\n|Name=Herzogtum Weiden\n|Herrschaftsform=Herzogtum Neu\n|Oberhaupt=Herzogin Neu\n|Sprache=Garethi\n}}\nWeiden.",
            revid: 5,
            zeit: "2026-10-20T10:00:00Z",
        });
        expect(await syncJob(editor.id, ID.weiden, "Herzogtum Weiden", undefined, "gebiet")).toMatchObject({
            status: "fertig",
            ergebnis: "uebernommen",
        });
        const detail = () =>
            wert(
                `SELECT d.ruler, d.form_of_government FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = '${ID.weiden}'`,
            );
        expect(await detail()).toEqual([{ ruler: "Herzogin Neu", form_of_government: "Herzogtum" }]);
        expect((await get(wikiBoxUrl("gebiet", ID.weiden), editor.cookie)).json().sync.letzter.felder).toContain(
            "ruler",
        );

        // Zuweisen: Greifenfurt bekommt Kosch; Schlüssel und Adresse am Gebiet, die Tafel X2, die Revision zählt.
        const rev = await revisionen("territory", [ID.greifen]);
        const ok = await post(wikiBoxZuweisenUrl("gebiet", ID.greifen), editor.cookie, { key: "wiki:kosch" });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(await wert(`SELECT wiki_key, wiki_url FROM territory WHERE public_id = '${ID.greifen}'`)).toEqual([
            { wiki_key: "wiki:kosch", wiki_url: wiki("Kosch") },
        ]);
        expect((await revisionen("territory", [ID.greifen]))[ID.greifen]).toBe((rev[ID.greifen] ?? 0) + 1);
        expect(
            await wert(
                `SELECT wiki_key FROM wiki_key_assignment WHERE legacy_art = 'gebiet' AND object_public_id = '${ID.greifen}' AND is_active`,
            ),
        ).toEqual([{ wiki_key: "wiki:kosch" }]);

        // Entfernen: die Zuordnung ist weg, die Werte stehen als eigene da.
        const entfernt = await post(wikiBoxEntfernenUrl("gebiet", ID.weiden), editor.cookie);
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        expect(await wert(`SELECT wiki_key, wiki_url FROM territory WHERE public_id = '${ID.weiden}'`)).toEqual([
            { wiki_key: null, wiki_url: null },
        ]);
        expect(
            await wert(
                `SELECT DISTINCT o.origin FROM territory_detail_field_origin o JOIN territory_detail d ON d.id = o.territory_detail_id JOIN territory t ON t.id = d.territory_id WHERE t.public_id = '${ID.weiden}'`,
            ),
        ).toEqual([{ origin: "override" }]);
        expect(await detail()).toEqual([{ ruler: "Herzogin Neu", form_of_government: "Herzogtum" }]);
        expect((await get(wikiBoxUrl("gebiet", ID.weiden), editor.cookie)).json()).toMatchObject({ artikel: null });
    });

    it("🔴 Landschaft: Die Box gehört der Region; Zuweisen setzt Adresse und Schlüssel, Entfernen löst beide und macht den Namen eigen; der Sync schreibt den Namen samt den Beschriftungen, die ihm folgen", async () => {
        await neueWelt(legeLandschaftenAn);
        const editor = await welt.jemand("editor");
        expect((await get(wikiBoxUrl("region", ID.koschberge), editor.cookie)).json()).toMatchObject({
            art: "region",
            name: "Koschberg",
            artikel: { key: "koschberge", name: "Koschberg" },
        });
        testwiki.texte.set("Koschberge", {
            text: "{{Infobox Region\n|Name=Koschberge\n|Art=Hochland\n|Nord=Weiden\n}}\nDie Koschberge.",
            revid: 9,
            zeit: "2026-10-20T10:00:00Z",
        });
        expect(await syncJob(editor.id, ID.koschberge, "Koschberge", undefined, "region")).toMatchObject({
            status: "fertig",
            ergebnis: "uebernommen",
        });
        expect(await wert(`SELECT name FROM region WHERE public_id = '${ID.koschberge}'`)).toEqual([
            { name: "Koschberge" },
        ]);
        expect(await wert(`SELECT name FROM map_label WHERE public_id = '${ID.label1}'`)).toEqual([
            { name: "Koschberge" },
        ]);

        const zuweisen = await post(wikiBoxZuweisenUrl("region", ID.koschberge), editor.cookie, { key: "aventurien" });
        expect(zuweisen.statusCode, zuweisen.body).toBe(200);
        expect(await wert(`SELECT wiki_region_key, wiki_url FROM region WHERE public_id = '${ID.koschberge}'`)).toEqual(
            [{ wiki_region_key: "aventurien", wiki_url: wiki("Aventurien (Kontinent)") }],
        );
        expect(
            (await post(wikiBoxZuweisenUrl("region", ID.koschberge), editor.cookie, { key: "nope" })).statusCode,
        ).toBe(400);

        const entfernt = await post(wikiBoxEntfernenUrl("region", ID.rahmen), editor.cookie);
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        expect(await wert(`SELECT wiki_region_key, wiki_url FROM region WHERE public_id = '${ID.rahmen}'`)).toEqual([
            { wiki_region_key: null, wiki_url: null },
        ]);
        expect(
            await wert(
                `SELECT origin FROM field_origin WHERE object_kind = 'landscape' AND object_id = '${ID.rahmen}' AND field = 'name'`,
            ),
        ).toEqual([{ origin: "manual" }]);
        expect(await wert(`SELECT name FROM region WHERE public_id = '${ID.rahmen}'`)).toEqual([
            { name: "Aventurien" },
        ]);
    });

    it("🔴 Kraftlinie: Die Box gehört der Linie (alle Abschnitte); Zuweisen und Entfernen gelten für jeden Abschnitt, eine leere Beschreibung, die dem Wiki folgte, bekommt den Text des Artikels als eigenen", async () => {
        const abschnitte = [1, 2, 3].map((n) => `c0000000-0000-4000-8000-00000000000${String(n)}`);
        await neueWelt(async (db) => {
            await db`
                INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, staerke, regionen, description)
                VALUES ('weidener-linie', ${wiki("Weidener Linie")}, 'Weidener Linie', 'regional', 'Weiden', 'Text des Artikels'),
                       ('basiliuslinie', ${wiki("Basiliuslinie")}, 'Basiliuslinie', NULL, NULL, NULL)
            `;
            let x = 130;
            for (const id of abschnitte) {
                x += 2;
                const linie = `LINESTRING(${String(x)} 140, ${String(x + 1)} 141)`;
                await db`
                    INSERT INTO powerline (public_id, map_domain_id, name, description, from_public_id, to_public_id, geom, drawn_geom, source_system)
                    VALUES (${id}, 'aventuria', 'Weidener Linie', NULL, ${randomUUID()}, ${randomUUID()},
                            ST_SetSRID(ST_GeomFromText(${linie}), 0), ST_SetSRID(ST_GeomFromText(${linie}), 0), 'legacy')
                `;
            }
            await db`
                INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT p.id, ${wiki("Weidener Linie")}, (SELECT id FROM wiki_powerline_snapshot WHERE wiki_key = 'weidener-linie'), 'assigned', 'legacy_editor'
                  FROM powerline p WHERE p.public_id = ANY(${abschnitte}::uuid[])
            `;
            await db`
                INSERT INTO field_origin (object_kind, object_id, field, origin)
                SELECT 'powerline', t.id, 'name', 'wiki' FROM unnest(${abschnitte}::uuid[]) AS t(id)
            `;
        });
        const editor = await welt.jemand("editor");
        const stand = (await get(wikiBoxUrl("kraftlinie", abschnitte[1]!), editor.cookie)).json();
        expect(stand).toMatchObject({
            art: "kraftlinie",
            name: "Weidener Linie",
            artikel: { key: "weidener-linie", name: "Weidener Linie" },
        });
        expect(stand).not.toHaveProperty("anteil");

        const ok = await post(wikiBoxZuweisenUrl("kraftlinie", abschnitte[0]!), editor.cookie, {
            key: "basiliuslinie",
        });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(
            await wert(
                `SELECT DISTINCT s.wiki_key FROM powerline_wiki_assignment w JOIN wiki_powerline_snapshot s ON s.id = w.snapshot_id WHERE w.is_active`,
            ),
        ).toEqual([{ wiki_key: "basiliuslinie" }]);
        expect(
            await wert(
                `SELECT count(*)::int AS n FROM wiki_key_assignment WHERE legacy_art = 'kraftlinie' AND is_active AND wiki_key = 'wiki:basiliuslinie'`,
            ),
        ).toEqual([{ n: 3 }]);
        // Zurück auf die erste Linie und dann lösen.
        expect(
            (await post(wikiBoxZuweisenUrl("kraftlinie", abschnitte[0]!), editor.cookie, { key: "weidener-linie" }))
                .statusCode,
        ).toBe(200);
        const entfernt = await post(wikiBoxEntfernenUrl("kraftlinie", abschnitte[2]!), editor.cookie);
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        expect(await wert(`SELECT count(*)::int AS n FROM powerline_wiki_assignment WHERE is_active`)).toEqual([
            { n: 0 },
        ]);
        expect(
            await wert(`SELECT DISTINCT description FROM powerline WHERE public_id = ANY(${idListe(abschnitte)})`),
        ).toEqual([{ description: "Text des Artikels" }]);
        expect(
            await wert(
                `SELECT field, origin, count(*)::int AS n FROM field_origin WHERE object_kind = 'powerline' GROUP BY field, origin ORDER BY field`,
            ),
        ).toEqual([
            { field: "description", origin: "manual", n: 3 },
            { field: "name", origin: "manual", n: 3 },
        ]);
        expect((await get(wikiBoxUrl("kraftlinie", abschnitte[0]!), editor.cookie)).json()).toMatchObject({
            artikel: null,
        });
    });

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Gipfel und Landmarken (WI-0271 L4)
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    /** Eine Höhle mit Artikel (ohne Höhe) und ein Fels ganz ohne Zuordnungszeile, neben den Gipfeln aus `legeGipfelAn`. */
    const HOEHLE = uuid("f", 9);
    const FELS = uuid("f", 8);
    async function legeLandmarkenAn(db: Database): Promise<void> {
        await db`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, region_parent)
            VALUES ('blaue-grotte', ${wiki("Blaue Grotte")}, 'Blaue Grotte', 'Höhle|Grotte', 'Kosch')
        `;
        await db`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom)
            VALUES (${HOEHLE}, 'aventuria', 'Blaue Grotte', 'hoehle', ST_SetSRID(ST_MakePoint(900, 120), 0)),
                   (${FELS}, 'aventuria', 'Effarsnadel', 'fels', ST_SetSRID(ST_MakePoint(903, 120), 0))
        `;
        await db`
            INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT tp.id, ${wiki("Blaue Grotte")}, s.id, 'assigned', 'unknown'
              FROM terrain_peak tp, wiki_region_snapshot s WHERE tp.public_id = ${HOEHLE} AND s.wiki_key = 'blaue-grotte'
        `;
    }
    const gipfelWelt = async (db: Database): Promise<void> => {
        await legeGipfelAn(db);
        await legeLandmarkenAn(db);
    };

    it("Gipfel: Der Stand nennt Artikel und Schlüssel (auch ohne Wiki-Stand), die Suche zeigt Wiki-Art und Region und nennt, woran ein Artikel schon hängt; eine Art, die es nicht gibt, ist 400", async () => {
        await neueWelt(gipfelWelt);
        const reviewer = await welt.jemand("reviewer");
        const tester = await welt.jemand("tester");
        expect((await get(wikiBoxUrl("gipfel", ID.ingerimm))).statusCode).toBe(401);
        expect((await get(wikiBoxUrl("gipfel", ID.ingerimm), tester.cookie)).statusCode).toBe(403);

        const lokal = (await get(wikiBoxUrl("gipfel", ID.ingerimm), reviewer.cookie)).json();
        expect(lokal).toMatchObject({
            art: "gipfel",
            id: ID.ingerimm,
            name: "Ingerimmsberg",
            artikel: { key: "ingerimmsberg", name: "Ingerimm alt" },
            sync: { moeglich: false, grund: "abruf_gesperrt", laeuft: false, letzter: null, fehler: null },
        });
        expect(lokal.artikel.url).toContain("/wiki/Ingerimmsberg");
        // Eine Landmarke ohne Gelände trägt dieselbe Box.
        expect((await get(wikiBoxUrl("gipfel", HOEHLE), reviewer.cookie)).json()).toMatchObject({
            art: "gipfel",
            name: "Blaue Grotte",
            artikel: { key: "blaue-grotte" },
        });
        await alsStage(async () => {
            const stage = (id: string) => get(wikiBoxUrl("gipfel", id), reviewer.cookie).then((a) => a.json());
            expect(await stage(ID.ingerimm)).toMatchObject({ sync: { moeglich: true } });
            // Nur eine Adresse, kein Wiki-Stand.
            expect(await stage(ID.nebel)).toMatchObject({
                artikel: { key: "nebelspitze", name: "Nebelspitze" },
                sync: { moeglich: false, grund: "kein_stand" },
            });
            // Ohne Zuordnungszeile: kein Artikel.
            expect(await stage(FELS)).toMatchObject({
                artikel: null,
                sync: { moeglich: false, grund: "kein_artikel" },
            });
        });
        expect((await get(wikiBoxUrl("gipfel", randomUUID()), reviewer.cookie)).statusCode).toBe(404);
        // Ein stillgelegter Gipfel ist für die Box nicht mehr da.
        await admin()`UPDATE terrain_peak SET is_active = FALSE WHERE public_id = ${FELS}`;
        expect((await get(wikiBoxUrl("gipfel", FELS), reviewer.cookie)).statusCode).toBe(404);
        expect((await get(`/api/editor/wiki-box/stern/${ID.ingerimm}`, reviewer.cookie)).statusCode).toBe(400);

        const suche = async (q?: string) =>
            (
                await get(
                    `${wikiBoxSucheUrl("gipfel", ID.ingerimm)}${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
                    reviewer.cookie,
                )
            ).json();
        expect((await suche()).articles.map((a: { key: string }) => a.key)).toEqual(
            expect.arrayContaining(["ingerimmsberg", "rihutu", "blaue-grotte"]),
        );
        // Der eigene Artikel hängt am Gipfel selbst und ist darum nicht „belegt“; Wiki-Art und Region stehen als Werte da.
        const eigener = (await suche("INGERIMM")).articles[0];
        expect(eigener).toMatchObject({
            key: "ingerimmsberg",
            name: "Ingerimm alt",
            werte: { art: "Berggipfel|Felsformation", region: "Kosch" },
        });
        expect(eigener).not.toHaveProperty("belegt");
        // Der Artikel eines anderen Gipfels nennt ihn.
        expect((await suche("rihutu")).articles[0]).toMatchObject({
            key: "rihutu",
            belegt: "Rihutu",
            werte: { art: "Vulkan" },
        });
        expect((await suche("grotte")).articles[0]).toMatchObject({ key: "blaue-grotte", belegt: "Blaue Grotte" });
        // `%` und `_` sind Zeichen, kein Muster.
        expect((await suche("%")).articles).toEqual([]);
        expect((await suche("_")).articles).toEqual([]);
    });

    it("🔴 Gipfel: Zuweisen und Entfernen wirken sofort (Zuordnung, Tafel X2 mit Art region, Revision, Fachprotokoll); die Höhe bleibt beim Entfernen als eigene stehen, eine Landmarke ohne Höhe bleibt ohne; zweimal geht nicht", async () => {
        await neueWelt(gipfelWelt);
        const reviewer = await welt.jemand("reviewer");
        const editor = await welt.jemand("editor");
        const revision = async (id: string) =>
            Number(
                (await wert<{ r: number }>(`SELECT revision::int AS r FROM terrain_peak WHERE public_id = '${id}'`))[0]!
                    .r,
            );
        const zuordnung = (id: string) =>
            wert(
                `SELECT a.assignment_state, a.assignment_origin, a.wiki_url IS NOT NULL AS adresse, s.wiki_key
                   FROM terrain_peak_wiki_assignment a JOIN terrain_peak tp ON tp.id = a.terrain_peak_id
                   LEFT JOIN wiki_region_snapshot s ON s.id = a.snapshot_id WHERE tp.public_id = '${id}' AND a.is_active`,
            );
        const x2 = (id: string) =>
            wert(
                `SELECT wiki_key, wiki_title, source_system, is_active, retired_origin FROM wiki_key_assignment WHERE legacy_art = 'region' AND object_public_id = '${id}'`,
            );
        const protokoll = (id: string) =>
            wert(
                `SELECT action, revision_before::int AS vorher, revision_after::int AS nachher, changes FROM map_audit_event WHERE peak_public_id = '${id}' ORDER BY id`,
            );

        // ── Zuweisen ──
        const vorher = await revision(ID.ingerimm);
        const operationId = randomUUID();
        const url = wikiBoxZuweisenUrl("gipfel", ID.ingerimm);
        expect((await post(url, undefined, { key: "rihutu" })).statusCode).toBe(401);
        expect((await post(url, reviewer.cookie, { key: "rihutu" })).statusCode).toBe(403);
        expect((await post(url, editor.cookie, { key: "gibtsnicht" })).json()).toMatchObject({
            error: { code: "validation_failed" },
        });
        expect(await revision(ID.ingerimm)).toBe(vorher);

        const ok = await welt.post(url, editor.cookie, { operationId, key: "rihutu" });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(ok.json()).toMatchObject({
            status: "applied",
            affected: [{ kind: "peak", id: ID.ingerimm, revision: vorher + 1 }],
        });
        expect(await revision(ID.ingerimm)).toBe(vorher + 1);
        expect(await zuordnung(ID.ingerimm)).toEqual([
            { assignment_state: "assigned", assignment_origin: "editor", adresse: true, wiki_key: "rihutu" },
        ]);
        expect(await x2(ID.ingerimm)).toEqual([
            {
                wiki_key: "wiki:rihutu",
                wiki_title: "Rihutu",
                source_system: "avesmaps3d",
                is_active: true,
                retired_origin: null,
            },
        ]);
        expect(await wert(`SELECT action, source FROM map_operation WHERE action = 'wikibox.zuweisen'`)).toEqual([
            { action: "wikibox.zuweisen", source: "editor" },
        ]);
        expect(await protokoll(ID.ingerimm)).toEqual([
            {
                action: "peak.wiki_zugewiesen",
                vorher,
                nachher: vorher + 1,
                changes: {
                    wiki: { before: "ingerimmsberg", after: "rihutu" },
                    zuordnung: {
                        before: { zustand: "assigned", herkunft: "unknown", system: "legacy" },
                        after: { zustand: "assigned", herkunft: "editor", system: "avesmaps3d" },
                    },
                },
            },
        ]);
        // Derselbe Aufruf noch einmal: die gespeicherte Quittung, nichts doppelt.
        expect((await welt.post(url, editor.cookie, { operationId, key: "rihutu" })).json()).toMatchObject({
            status: "replayed",
        });
        expect(await revision(ID.ingerimm)).toBe(vorher + 1);
        expect((await get(wikiBoxUrl("gipfel", ID.ingerimm), editor.cookie)).json()).toMatchObject({
            artikel: { key: "rihutu", name: "Rihutu" },
        });
        // Die Höhe fasst das Zuweisen nicht an: weder der Wert noch ihr Vermerk.
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.ingerimm}'`)).toEqual([
            { height_schritt: 700 },
        ]);
        expect(await wert(`SELECT count(*)::int AS n FROM field_origin WHERE object_kind = 'peak'`)).toEqual([
            { n: 0 },
        ]);
        // Ein Fels ohne Zuordnungszeile bekommt eine.
        expect(
            (await post(wikiBoxZuweisenUrl("gipfel", FELS), editor.cookie, { key: "blaue-grotte" })).statusCode,
        ).toBe(200);
        expect(await zuordnung(FELS)).toEqual([
            { assignment_state: "assigned", assignment_origin: "editor", adresse: true, wiki_key: "blaue-grotte" },
        ]);
        expect((await x2(FELS))[0]).toMatchObject({ wiki_key: "wiki:blaue-grotte", is_active: true });

        // ── Entfernen ──
        // Die Höhe des Ingerimmsbergs hat keinen Vermerk (folgt dem Wiki), die der Nebelspitze den Vermerk „wiki“.
        await admin()`INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('peak', ${ID.nebel}, 'height', 'wiki')`;
        const davor = await revision(ID.ingerimm);
        const entfernen = (id: string) => post(wikiBoxEntfernenUrl("gipfel", id), editor.cookie);
        expect((await post(wikiBoxEntfernenUrl("gipfel", ID.ingerimm), reviewer.cookie)).statusCode).toBe(403);
        const entfernt = await entfernen(ID.ingerimm);
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        expect(await revision(ID.ingerimm)).toBe(davor + 1);
        expect(
            await wert(
                `SELECT a.assignment_state, a.assignment_origin, a.wiki_url, a.snapshot_id, a.is_active FROM terrain_peak_wiki_assignment a
                   JOIN terrain_peak tp ON tp.id = a.terrain_peak_id WHERE tp.public_id = '${ID.ingerimm}'`,
            ),
        ).toEqual([
            {
                assignment_state: "separated",
                assignment_origin: "editor",
                wiki_url: null,
                snapshot_id: null,
                is_active: true,
            },
        ]);
        expect(await x2(ID.ingerimm)).toEqual([
            {
                wiki_key: "wiki:rihutu",
                wiki_title: "Rihutu",
                source_system: "avesmaps3d",
                is_active: false,
                retired_origin: "editor",
            },
        ]);
        // Die Höhe behält ihren Wert und gehört danach der Redaktion.
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.ingerimm}'`)).toEqual([
            { height_schritt: 700 },
        ]);
        expect(
            await wert(
                `SELECT origin FROM field_origin WHERE object_kind = 'peak' AND object_id = '${ID.ingerimm}' AND field = 'height'`,
            ),
        ).toEqual([{ origin: "manual" }]);
        expect(await protokoll(ID.ingerimm)).toEqual([
            expect.objectContaining({ action: "peak.wiki_zugewiesen" }),
            {
                action: "peak.wiki_entfernt",
                vorher: davor,
                nachher: davor + 1,
                changes: {
                    wiki: { before: "rihutu", after: null },
                    zuordnung: {
                        before: { zustand: "assigned", herkunft: "editor", system: "avesmaps3d" },
                        after: { zustand: "separated", herkunft: "editor", system: "avesmaps3d" },
                    },
                },
            },
        ]);
        expect((await get(wikiBoxUrl("gipfel", ID.ingerimm), editor.cookie)).json()).toMatchObject({ artikel: null });
        // Zweimal geht nicht.
        expect((await entfernen(ID.ingerimm)).json()).toMatchObject({ error: { code: "kein_artikel" } });

        // Der Vermerk „wiki“ wird „manual“, auch an einem Gipfel, der nur eine Adresse trägt (address_only).
        expect((await entfernen(ID.nebel)).statusCode).toBe(200);
        expect(
            await wert(
                `SELECT origin FROM field_origin WHERE object_kind = 'peak' AND object_id = '${ID.nebel}' AND field = 'height'`,
            ),
        ).toEqual([{ origin: "manual" }]);
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.nebel}'`)).toEqual([
            { height_schritt: 3000 },
        ]);

        // Ohne Höhe gibt es nichts zu behalten: ein Vulkan ohne Höhe und eine Höhle (die keine tragen darf) bekommen keinen Vermerk.
        for (const id of [ID.rihutu, HOEHLE]) {
            const zu = await entfernen(id);
            expect(zu.statusCode, zu.body).toBe(200);
            expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${id}'`)).toEqual([
                { height_schritt: null },
            ]);
            expect(await wert(`SELECT count(*)::int AS n FROM field_origin WHERE object_id = '${id}'`)).toEqual([
                { n: 0 },
            ]);
            expect(await zuordnung(id)).toEqual([
                { assignment_state: "separated", assignment_origin: "editor", adresse: false, wiki_key: null },
            ]);
        }

        // Ein späteres Zuweisen belebt die Zeile wieder, und die eigene Höhe bleibt beim Sync stehen (das Wiki sagt 1.100).
        expect((await post(url, editor.cookie, { key: "ingerimmsberg" })).statusCode).toBe(200);
        expect(await zuordnung(ID.ingerimm)).toEqual([
            { assignment_state: "assigned", assignment_origin: "editor", adresse: true, wiki_key: "ingerimmsberg" },
        ]);
        expect(
            await wert(
                `SELECT is_active, retired_origin FROM wiki_key_assignment WHERE legacy_art = 'region' AND object_public_id = '${ID.ingerimm}'`,
            ),
        ).toEqual([{ is_active: true, retired_origin: null }]);
        testwiki.texte.set("Ingerimmsberg", {
            text: "{{Infobox Region\n|Name=Ingerimmsberg\n|Art=Berg\n|Region=Ysilia\n|Höhe=1.100 Schritt\n}}\nEin Berg.",
            revid: 12,
            zeit: "2026-10-20T10:00:00Z",
        });
        expect(await syncJob(editor.id, ID.ingerimm, "Ingerimmsberg", undefined, "gipfel")).toMatchObject({
            status: "fertig",
            ergebnis: "stand",
        });
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.ingerimm}'`)).toEqual([
            { height_schritt: 700 },
        ]);
        expect(await wert(`SELECT height_schritt FROM wiki_region_snapshot WHERE wiki_key = 'ingerimmsberg'`)).toEqual([
            { height_schritt: 1100 },
        ]);
    });

    it("🔴 Gipfel-Sync: Die Route reiht den Auftrag ein; er schreibt die Höhe, die dem Wiki folgt, an DIESEM Gipfel (Geländeart), einer Landmarke ohne Gelände nie", async () => {
        await neueWelt(gipfelWelt);
        const editor = await welt.jemand("editor");
        const url = (id: string) => wikiBoxSyncUrl("gipfel", id);
        // Lokal gibt es keinen Abruf; auf der Stage reiht die Route den Auftrag mit dem Gipfel ein.
        expect((await post(url(ID.ingerimm), editor.cookie)).json()).toMatchObject({
            error: { code: "abruf_gesperrt" },
        });
        await alsStage(async () => {
            expect((await post(url(ID.nebel), editor.cookie)).json()).toMatchObject({ error: { code: "kein_stand" } });
            const ok = await post(url(ID.ingerimm), editor.cookie);
            expect(ok.statusCode, ok.body).toBe(200);
            expect((await wartend())[0]).toMatchObject({
                kind: "wiki_artikel",
                actor_ref: editor.id,
                input_ref: {
                    titel: "Ingerimmsberg",
                    objekt: { art: "gipfel", id: ID.ingerimm, ids: [ID.ingerimm] },
                },
            });
        });
        await aufraeumen();

        // Der Auftrag: Das Wiki sagt 1.100, die Karte 700 (kein Vermerk: folgt dem Wiki).
        testwiki.texte.set("Ingerimmsberg", {
            text: "{{Infobox Region\n|Name=Ingerimmsberg\n|Art=Berg\n|Region=Ysilia\n|Höhe=1.100 Schritt\n}}\nEin Berg.",
            revid: 12,
            zeit: "2026-10-20T10:00:00Z",
        });
        const rihutuVorher = await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.rihutu}'`);
        expect(await syncJob(editor.id, ID.ingerimm, "Ingerimmsberg", undefined, "gipfel")).toMatchObject({
            status: "fertig",
            art: "gipfel",
            ergebnis: "uebernommen",
        });
        expect(testwiki.anfragen).toHaveLength(1);
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.ingerimm}'`)).toEqual([
            { height_schritt: 1100 },
        ]);
        // Ein anderer Gipfel bleibt, wie er war; die Operation gehört dem Editor.
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${ID.rihutu}'`)).toEqual(
            rihutuVorher,
        );
        expect(
            await wert(`SELECT action, source, actor_person_id::text FROM map_operation WHERE source = 'wikisync'`),
        ).toEqual([{ action: "wikisync.objekt_sync", source: "wikisync", actor_person_id: editor.id }]);

        // Eine Höhle: Das Wiki nennt eine Höhe, die Landmarke führt keine; nur der Wiki-Stand zieht nach.
        testwiki.texte.set("Blaue Grotte", {
            text: "{{Infobox Region\n|Name=Blaue Grotte\n|Art=Höhle\n|Region=Kosch\n|Höhe=500\n}}\nEine Höhle.",
            revid: 13,
            zeit: "2026-10-20T11:00:00Z",
        });
        expect(await syncJob(editor.id, HOEHLE, "Blaue Grotte", undefined, "gipfel")).toMatchObject({
            status: "fertig",
        });
        expect(await wert(`SELECT height_schritt FROM terrain_peak WHERE public_id = '${HOEHLE}'`)).toEqual([
            { height_schritt: null },
        ]);
    });
});

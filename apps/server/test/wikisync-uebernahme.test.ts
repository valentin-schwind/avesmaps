import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
    MapHistoryEntry,
    RuecknahmeReceipt,
    WIKISYNC_ANGESCHLOSSEN,
    WIKISYNC_BEREICHE,
    WIKISYNC_BEREICHE_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    WIKISYNC_VORSCHAU_URL,
    WIKISYNC_ZURUECKNEHMEN_URL,
    editorWikiSyncRestoreSeriesPreviewUrl,
    editorWikiSyncRestoreSeriesUrl,
    type RuecknahmePruefung,
    type WikisyncBereiche,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange, mapChanges } from "../src/editor/history.ts";
import { updatePowerlineLine } from "../src/editor/kraftlinien-schreiben.ts";
import { enqueueAbgleich } from "../src/abgleiche/start.ts";
import { importPowerlines } from "../src/migration/powerlines.ts";
import { importSubjectDetails } from "../src/migration/subject-details-import.ts";
import type { LegacyPayload } from "../src/migration/paths.ts";
import type { MapFeaturesPayload } from "../src/migration/map-features.ts";
import { ApiError } from "../src/http/api-error.ts";
import { JOB_HANDLERS, JobCancelled, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG, knowsKind } from "../src/jobs/kinds.ts";
import { LEICHTE_ARTEN, istSchwer } from "../src/jobs/dirigent/plan.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { readSubjectRevision } from "../src/subjects/revision.ts";
import { raeumeAb, schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { SCHREIBER } from "../src/wiki/abgleich/uebernahme/liste.ts";
import { pruefeUebernahme } from "../src/wiki/abgleich/uebernahme/pruefen.ts";
import { legeUebernahmeAn } from "../src/wiki/abgleich/uebernahme/protokoll.ts";
import type { Schreiber } from "../src/wiki/abgleich/uebernahme/schreiber.ts";
import { kraftlinieSchreiber } from "../src/wiki/abgleich/uebernahme/kraftlinie.ts";
import { uebernimmBereich } from "../src/wiki/abgleich/uebernahme/uebernehmen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { welt as baueWelt, type Welt } from "./support/schreibwege/welt.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Scheibe D-1 des WikiSync (WI-0253): der Bereichsschalter je Umgebung, die Übernahme, die Rücknahme und die Routen dazu, am Bereich der Kraftlinien. Gegen einen
 * Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`), also mit der Jobs-Rolle als Schreiberin der Karte und der App-Rolle für die Routen.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung: Die Welt ist eine Handvoll erfundener Kraftlinien in einem eigenen Cluster.
 *
 * Die Welt (siehe `legeWeltAn`): die Weidener Linie (drei Abschnitte, Wiki-eigene Felder ohne eigenen Wert), die Basiliuslinie (zwei Abschnitte: der Name folgt dem Wiki, die
 * Beschreibung ist eigen), die Adresslinie (nur eine Adresse, kein Wiki-Stand), eine getrennte und eine unterdrückte Linie.
 *
 * - **Soll:** Die Übernahme schreibt, was die Vorschau als wiki-eigen sah, ändert nichts Eigenes, nichts Getrenntes und nichts Unterdrücktes, schreibt den Wiki-Wert hinter ↺
 *   immer, ist eine Operation an der Karte (Quelle `wikisync`) und setzt die Leser-Revision; der zweite Lauf ändert nichts; ein offener Entwurf bekommt 409.
 * - **Problemfälle:** ein Wert, der seit der Vorschau anders ist (Befund statt Überschreiben); ein Abbruch oder Fehler vor dem Ende (nichts halb geschrieben); die Rücknahme je
 *   Bereich und Lauf, je Feld nur wo der Istwert noch „nachher“ ist; ein Bereich, der dem Legacy-Zug gehört, wird nicht übernommen, und der Zug lässt einen umgeschalteten aus.
 */

FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const ENV = "wikisyncd1";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0253-d1-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    mapEditing: "testwelt",
    auth: TEST_AUTH,
};

const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const DUMP: FixtureSeite[] = [
    {
        titel: "Weidener Linie",
        ns: 0,
        text: "{{Infobox Kraftlinie\n|Name=Weidener Linie\n|Stärke=überregional\n|Affinität=Humus\n|Verlauf=\n{{Straße|[[Weiden]]}}\n{{Straße|[[Gareth]]}}\n}}\nNeue Beschreibung der Weidener Linie.",
    },
    {
        titel: "Basiliuslinie",
        ns: 0,
        text: "{{Infobox Kraftlinie\n|Name=Basiliuslinie\n|Verlauf=\n{{Straße|[[Gareth]]}}\n{{Straße|[[Angbar]]}}\n}}\nWiki neu.",
    },
    { titel: "Adresslinie", ns: 0, text: "{{Infobox Kraftlinie\n|Name=Adresslinie\n}}\nAdresstext." },
    {
        titel: "Wasserscheide",
        ns: 0,
        text: "{{Infobox Kraftlinie\n|Name=Wasserscheide\n|Stärke=regional\n}}\nDie Wasserscheide ist eine regionale Kraftlinie.",
    },
    { titel: "Getrennte Linie", ns: 0, text: "{{Infobox Kraftlinie\n|Name=Getrennte Linie\n}}\nGetrennter Text." },
    {
        titel: "Unterdrückte Linie",
        ns: 0,
        text: "{{Infobox Kraftlinie\n|Name=Unterdrückte Linie\n}}\nUnterdrückter Text.",
    },
];

const ID = {
    a1: "a1000000-0000-4000-8000-000000000001",
    a2: "a1000000-0000-4000-8000-000000000002",
    a3: "a1000000-0000-4000-8000-000000000003",
    b1: "b1000000-0000-4000-8000-000000000001",
    b2: "b1000000-0000-4000-8000-000000000002",
    c1: "c1000000-0000-4000-8000-000000000001",
    d1: "d1000000-0000-4000-8000-000000000001",
    e1: "e1000000-0000-4000-8000-000000000001",
};
const WEIDEN = [ID.a1, ID.a2, ID.a3];
const BASILIUS = [ID.b1, ID.b2];

/** Räumt die Kraftlinien-Welt ab (alles, was die Fälle schreiben), damit jeder Fall mit derselben Welt beginnt. */
async function raeumeWeltAb(admin: Database): Promise<void> {
    await admin`
        TRUNCATE map_audit_event, map_operation, wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_bereich_setting,
                 field_origin, powerline_wiki_assignment, wiki_powerline_snapshot, wiki_key_assignment, powerline
        RESTART IDENTITY CASCADE
    `;
    await admin`UPDATE wikisync_bereich_state SET revision = 1`;
    await admin`DELETE FROM job`;
}

/** Eine kleine Welt in der Ecke der Karte (x 130 bis 190, y 130 bis 190), mit Zuordnungen, Schnappschüssen und Vermerken. */
async function legeWeltAn(db: Database): Promise<void> {
    await db`
        INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, staerke, affinitaet, laenge, regionen, verlauf, description)
        VALUES ('weidener-linie', ${wiki("Weidener Linie")}, 'Weidener Linie', 'regional', 'Humus', NULL, NULL, NULL, 'Alte Beschreibung'),
               ('basiliuslinie', ${wiki("Basiliuslinie")}, 'Alte Basiliuslinie', NULL, NULL, NULL, NULL, NULL, 'Wiki alt')
    `;
    let x = 130;
    const linie = async (id: string, name: string, beschreibung: string | null): Promise<void> => {
        x += 2;
        await db`
            INSERT INTO powerline (public_id, map_domain_id, name, description, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${id}, 'aventuria', ${name}, ${beschreibung}, ${randomUUID()}, ${randomUUID()},
                    ST_SetSRID(ST_GeomFromText(${`LINESTRING(${String(x)} 130, ${String(x + 1)} 131)`}), 0),
                    ST_SetSRID(ST_GeomFromText(${`LINESTRING(${String(x)} 130, ${String(x + 1)} 131)`}), 0), 'legacy')
        `;
    };
    for (const id of WEIDEN) await linie(id, "Weidener Linie", null);
    for (const id of BASILIUS) await linie(id, "Alte Basiliuslinie", "Meine Beschreibung");
    await linie(ID.c1, "Adresslinie", null);
    await linie(ID.d1, "Getrennte Linie", null);
    await linie(ID.e1, "Unterdrückte Linie", null);

    const zuordnung = async (
        ids: readonly string[],
        zustand: string,
        snapshot: string | null,
        adresse: string | null,
    ): Promise<void> => {
        await db`
            INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, ${adresse}, (SELECT id FROM wiki_powerline_snapshot WHERE wiki_key = ${snapshot}), ${zustand}, 'legacy_editor'
              FROM powerline p WHERE p.public_id = ANY(${[...ids]}::uuid[])
        `;
    };
    await zuordnung(WEIDEN, "assigned", "weidener-linie", wiki("Weidener Linie"));
    await zuordnung(BASILIUS, "assigned", "basiliuslinie", wiki("Basiliuslinie"));
    await zuordnung([ID.c1], "address_only", null, wiki("Adresslinie"));
    await zuordnung([ID.d1], "separated", null, null);
    await zuordnung([ID.e1], "suppressed", null, null);
    // Die Zuordnungstafel X2 trägt die Adresse, die die Redaktion getrennt und unterdrückt hat.
    await db`
        INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns)
        VALUES ('kraftlinie', ${ID.d1}, 'wiki:getrennte-linie', ${wiki("Getrennte Linie")}, 'Getrennte Linie', 0),
               ('kraftlinie', ${ID.e1}, 'wiki:unterdrueckte-linie', ${wiki("Unterdrückte Linie")}, 'Unterdrückte Linie', 0)
    `;
    // Die Basiliuslinie: der Name folgt dem Wiki (Vermerk wiki), die Beschreibung ist eine eigene Entscheidung (manual).
    await db`
        INSERT INTO field_origin (object_kind, object_id, field, origin)
        VALUES ('powerline', ${ID.b1}, 'name', 'wiki'), ('powerline', ${ID.b2}, 'name', 'wiki'),
               ('powerline', ${ID.b1}, 'description', 'manual'), ('powerline', ${ID.b2}, 'description', 'manual')
    `;
}

/** Ein Abdruck jeder Tafel, die die Übernahme berühren könnte: Vorher und nachher gleich heißt, es wurde nichts geschrieben. */
const TAFELN = [
    "powerline",
    "wiki_powerline_snapshot",
    "powerline_wiki_assignment",
    "field_origin",
    "wiki_key_assignment",
    "map_operation",
    "map_audit_event",
] as const;
async function abdruck(db: Database): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};
    for (const name of TAFELN) {
        const [zeile] = await db.unsafe<{ h: string }[]>(
            `SELECT coalesce(md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))), '-') AS h FROM public."${name}" t`,
        );
        hashes[name] = zeile?.h ?? "?";
    }
    return hashes;
}

interface Kontext extends JobContext {
    phasen: string[];
}
function kontext(input: Record<string, unknown>, optionen: { jobPublicId?: string; abbruch?: boolean } = {}): Kontext {
    const phasen: string[] = [];
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: optionen.jobPublicId ?? randomUUID(), leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: (name) => {
            phasen.push(name);
            return Promise.resolve();
        },
        checkpoint: () => {
            if (optionen.abbruch === true) throw new JobCancelled();
        },
        phasen,
    };
}

describeWithCluster(
    "WikiSync D-1: Schalter, Übernahme, Rücknahme und Routen (Wegwerf-Cluster, Rollen wie auf dem VPS)",
    () => {
        let cluster: VpsCluster | undefined;
        let fixture: AuthFixture;
        let app: FastifyInstance;
        let welt: Welt;
        let importer: Database | undefined;
        let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
        let umgebung: NodeJS.ProcessEnv;
        let ablage: VorschauAblage;
        const protokoll: string[] = [];
        const lauf = { id: 0 };

        const jobs = (): Database => cluster!.jobs;
        const admin = (): Database => cluster!.admin;
        const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
        const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, VORLAGEN);
            await seedMapDomains(cluster.migrator);
            ordner = await neuerOrdner("wikisync-uebernahme");
            await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
            umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
            ablage = {
                ladeObjekte: (bereiche) => ladeObjekte(jobs(), bereiche),
                ladeBekannteTitel: () => ladeBekannteTitel(jobs()),
                ladeWikisyncBereiche: () => wikisyncBereiche(jobs()),
                schreibe: (eingabe) => schreibeLauf(jobs(), eingabe),
                schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(jobs(), eingabe, fehler),
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
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
        }, 240_000);

        afterAll(async () => {
            await app?.close();
            await importer?.end({ timeout: 5 });
            await ordner?.weg();
            await cluster?.stop();
        }, 60_000);

        /** Jeder Fall beginnt mit derselben Welt (die Bereiche gehören fest dem WikiSync, einen Schalter gibt es nicht mehr). */
        async function neueWelt(): Promise<void> {
            await raeumeWeltAb(admin());
            await legeWeltAn(admin());
        }

        async function vorschau(bereiche: readonly string[] = ["kraftlinie"]): Promise<number> {
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
            lauf.id = (ergebnis["lauf"] as { id: number }).id;
            return lauf.id;
        }

        /** Ein Auftrag der Warteschlange, den eine Person ausgelöst hat (über die Einreihungsfunktion der App-Rolle, wie die Route). */
        async function auftragVon(personId: string | null, kind = "wiki_uebernehmen"): Promise<string> {
            const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue(${kind}, 1::smallint, 'aventuria', ${personId ?? "cli:test"}, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
            await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
            return job!.public_id;
        }

        async function uebernehmen(
            input: Record<string, unknown> = { bereiche: ["kraftlinie"] },
            optionen: { jobPublicId?: string; abbruch?: boolean } = {},
        ): Promise<{
            bereiche: {
                status: string;
                grund?: string;
                operationId?: string | null;
                zahlen?: Record<string, number>;
                uebernahme: number | null;
            }[];
        }> {
            return (await runWikiUebernehmenJob(kontext(input, optionen), {
                environment: einsatz,
                mitDatenbank: mitJobs,
            })) as never;
        }

        const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
        const beschreibung = async (id: string): Promise<string | null> =>
            (await wert<{ d: string | null }>(`SELECT description AS d FROM powerline WHERE public_id = '${id}'`))[0]
                ?.d ?? null;
        const name = async (id: string): Promise<string> =>
            (await wert<{ n: string }>(`SELECT name AS n FROM powerline WHERE public_id = '${id}'`))[0]!.n;
        const revision = async (id: string): Promise<number> =>
            Number(
                (await wert<{ r: string }>(`SELECT revision::text AS r FROM powerline WHERE public_id = '${id}'`))[0]!
                    .r,
            );
        const snapshot = async (key: string): Promise<Record<string, string | null>> =>
            (
                await wert<Record<string, string | null>>(
                    `SELECT name, staerke, affinitaet, laenge, regionen, verlauf, description FROM wiki_powerline_snapshot WHERE wiki_key = '${key}'`,
                )
            )[0]!;
        const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);
        const befunde = async (): Promise<{ objekt_id: string; feld: string; befund: string; grund: string }[]> =>
            wert(`SELECT objekt_id::text, feld, befund, grund FROM wikisync_uebernahme_befund ORDER BY id`);

        // ----------------------------------------------------------------------------------------------------------------------------
        // Katalog und Einstufung
        // ----------------------------------------------------------------------------------------------------------------------------

        it("🔴 Katalog: wiki_uebernehmen und wiki_zuruecknehmen sind bekannte Arten mit Handler und SCHWER; die angeschlossenen Bereiche sind die mit Schreiber", () => {
            for (const art of ["wiki_uebernehmen", "wiki_zuruecknehmen"]) {
                expect(JOB_KIND_CATALOG[art], art).toMatchObject({
                    kind: art,
                    version: 1,
                    origin: "queued",
                    threads: 1,
                });
                expect(knowsKind(art, 1), art).toBe(true);
                expect(JOB_HANDLERS[art], art).toBeTypeOf("function");
                expect(LEICHTE_ARTEN.has(art), art).toBe(false);
                expect(istSchwer(art), art).toBe(true);
            }
            expect(Object.keys(SCHREIBER).sort()).toEqual([...WIKISYNC_ANGESCHLOSSEN].sort());
            // Die Profile halten sie vom Zug, vom Import und von der Gebietsableitung fern.
            for (const profil of ["staging", "local"]) {
                const paare = JSON.parse(
                    readFileSync(new URL(`../../../config/jobs/${profil}.json`, import.meta.url), "utf8"),
                ).values.exclusivePairs.value as string[][];
                for (const art of ["wiki_uebernehmen", "wiki_zuruecknehmen"]) {
                    for (const partner of ["legacy_zug", "import", "territory_derive"]) {
                        expect(
                            paare.some(([a, b]) => (a === art && b === partner) || (a === partner && b === art)),
                            `${profil}: ${art} / ${partner}`,
                        ).toBe(true);
                    }
                }
            }
        });

        it("🔴 Jede Wiki-Art des Katalogs ist einreihbar (Migration 0239: wiki_dump_einlesen fehlte in der Liste von job_enqueue; die Auftragsbibliothek kannte sie, die Tür der App-Rolle nicht)", async () => {
            const wikiArten = Object.keys(JOB_KIND_CATALOG).filter((art) => art.startsWith("wiki_"));
            expect(wikiArten).toEqual(
                expect.arrayContaining([
                    "wiki_dump_einlesen",
                    "wiki_vorschau",
                    "wiki_artikel",
                    "wiki_uebernehmen",
                    "wiki_zuruecknehmen",
                ]),
            );
            for (const art of wikiArten) {
                const publicId = await auftragVon(null, art);
                expect(publicId, art).toMatch(/^[0-9a-f]{8}-/);
            }
            // Die Tür bleibt zu für eine Art, die sie nicht nennt.
            await expect(auftragVon(null, "wiki_gibt_es_nicht")).rejects.toThrow(/darf die Anwendung nicht einreihen/);
        });

        // ----------------------------------------------------------------------------------------------------------------------------
        // Die Übernahme
        // ----------------------------------------------------------------------------------------------------------------------------

        it("🔴 Übernahme: Wiki-eigene Felder, Wiki-Wert hinter ↺, Eigenes bleibt; eine Operation der Quelle wikisync; die Leser-Revision wechselt", async () => {
            await neueWelt();
            const laufId = await vorschau();
            const bericht = await wert<{
                objekt_id: string | null;
                feld: string | null;
                eigentuemer: string;
                wirkung: string;
                objekte: number;
            }>(
                `SELECT objekt_id::text, feld, eigentuemer, wirkung, objekte FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND bereich = 'kraftlinie' ORDER BY position`,
            );
            // Die Vorschau sagt: Weiden (3 Objekte) trägt wiki-eigene Felder, die Beschreibung der Basiliuslinie ist eigen.
            expect(bericht.find((z) => z.feld === "staerke")).toMatchObject({
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                objekte: 3,
            });
            expect(bericht.find((z) => z.feld === "description" && z.objekte === 2)).toMatchObject({
                eigentuemer: "manual",
                wirkung: "eigen",
            });
            expect(bericht.find((z) => z.feld === "name" && z.objekte === 2)).toMatchObject({
                eigentuemer: "wiki",
                wirkung: "uebernommen",
            });

            const vorherRevision = await readSubjectRevision(cluster!.app);
            const vorherRevisionen = new Map<string, number>();
            for (const id of [...WEIDEN, ...BASILIUS]) vorherRevisionen.set(id, await revision(id));
            const person = await fixture.person("editor", { name: "Edora" });
            const ergebnis = await uebernehmen(undefined, { jobPublicId: await auftragVon(person.id) });

            expect(ergebnis.bereiche).toHaveLength(1);
            expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
            const zahlen = ergebnis.bereiche[0]!.zahlen!;
            expect(zahlen["felder"]).toBeGreaterThan(0);
            expect(zahlen["objekte"]).toBe(5);

            // Die Weidener Linie: der Wiki-Wert hinter ↺ ist der von heute; die eigene Spalte bleibt leer (leer heißt: folgt dem Wiki) und der Vermerk unberührt.
            expect(await snapshot("weidener-linie")).toMatchObject({
                staerke: "überregional",
                verlauf: "Weiden → Gareth",
                description: "Neue Beschreibung der Weidener Linie.",
                affinitaet: "Humus",
            });
            for (const id of WEIDEN) expect(await beschreibung(id)).toBeNull();
            // Die Basiliuslinie: Der Name folgte dem Wiki und folgt ihm jetzt an beiden Abschnitten; die eigene Beschreibung bleibt, ihr Wiki-Wert ist neu.
            for (const id of BASILIUS) {
                expect(await name(id)).toBe("Basiliuslinie");
                expect(await beschreibung(id)).toBe("Meine Beschreibung");
            }
            expect(await snapshot("basiliuslinie")).toMatchObject({
                name: "Basiliuslinie",
                description: "Wiki neu.",
                verlauf: "Gareth → Angbar",
            });
            // Der Vermerk wird nur gelesen, nie geschrieben.
            expect(await zahl(`SELECT count(*)::int AS n FROM field_origin`)).toBe(4);
            expect(await zahl(`SELECT count(*)::int AS n FROM field_origin WHERE origin = 'wiki'`)).toBe(2);
            // Die Adresslinie hat keinen Wiki-Stand, die getrennte und die unterdrückte Linie gehören der Redaktion: Nichts davon wurde angelegt oder geändert.
            expect(await zahl(`SELECT count(*)::int AS n FROM wiki_powerline_snapshot`)).toBe(2);
            expect(
                await zahl(
                    `SELECT count(*)::int AS n FROM powerline_wiki_assignment WHERE assignment_state = 'assigned'`,
                ),
            ).toBe(5);
            expect(await zahl(`SELECT count(*)::int AS n FROM powerline_wiki_assignment`)).toBe(8);
            for (const id of [ID.c1, ID.d1, ID.e1]) expect(await beschreibung(id)).toBeNull();
            // Die Vorschau hat es schon gesagt (kein Wiki-Stand: ein Befund, keine Übernahme); die Übernahme meldet die Adresslinie nicht noch einmal und schreibt nichts daran.
            expect(
                await wert<{ wirkung: string; grund: string }>(
                    `SELECT wirkung, grund FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND objekt_id = '${ID.c1}' AND feld IS NOT NULL`,
                ),
            ).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ wirkung: "befund", grund: expect.stringContaining("kein Wiki-Stand") }),
                ]),
            );
            expect(
                await zahl(
                    `SELECT count(*)::int AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND objekt_id = '${ID.c1}' AND wirkung = 'uebernommen'`,
                ),
            ).toBe(0);
            expect((await befunde()).filter((b) => b.objekt_id === ID.c1)).toEqual([]);

            // Eine Operation an der Karte, aus der Quelle wikisync, mit dem Auslöser; je Objekt ein Eintrag mit Revision vorher und nachher.
            const [operation] = await wert<{
                operation_id: string;
                source: string;
                action: string;
                actor_kind: string;
                actor_person_id: string | null;
                environment: string;
            }>(
                `SELECT operation_id::text, source, action, actor_kind, actor_person_id::text, environment FROM map_operation`,
            );
            expect(operation).toMatchObject({
                source: "wikisync",
                action: "wikisync.uebernehmen",
                actor_kind: "person",
                actor_person_id: person.id,
                environment: "test",
            });
            const eintraege = await wert<{
                powerline_public_id: string;
                action: string;
                revision_before: string;
                revision_after: string;
                changes: Record<string, unknown>;
            }>(
                `SELECT powerline_public_id::text, action, revision_before::text, revision_after::text, changes FROM map_audit_event ORDER BY id`,
            );
            expect(eintraege).toHaveLength(5);
            for (const eintrag of eintraege) {
                expect(eintrag.action).toBe("powerline.wikisync_uebernommen");
                expect(Number(eintrag.revision_after)).toBe(Number(eintrag.revision_before) + 1);
                expect(await revision(eintrag.powerline_public_id)).toBeGreaterThan(
                    vorherRevisionen.get(eintrag.powerline_public_id)!,
                );
            }
            expect(eintraege.find((e) => e.powerline_public_id === ID.b1)!.changes).toMatchObject({
                name: { before: "Alte Basiliuslinie", after: "Basiliuslinie" },
            });
            // Das Protokoll der Übernahme steht da, gebunden an die Operation und den Lauf der Vorschau.
            const [protokollZeile] = await wert<{
                status: string;
                operation_id: string;
                lauf_id: string;
                ausgeloest_von: string;
            }>(`SELECT status, operation_id::text, lauf_id::text, ausgeloest_von::text FROM wikisync_uebernahme`);
            expect(protokollZeile).toMatchObject({
                status: "fertig",
                operation_id: operation!.operation_id,
                lauf_id: String(laufId),
                ausgeloest_von: person.id,
            });
            // Die Leser-Revision (Infobox, Links, Caches) wechselt mit der Operation.
            expect(await readSubjectRevision(cluster!.app)).not.toBe(vorherRevision);
        });

        it("🔴 Ein zweiter Lauf ändert nichts: Die Vorschau meldet kein Feld mehr, die Übernahme schreibt keine Operation, keine Revision, keine Zeile", async () => {
            await neueWelt();
            await vorschau();
            await uebernehmen();
            const nachErsten = await abdruck(admin());
            const operationen = await zahl(`SELECT count(*)::int AS n FROM map_operation`);

            // Dieselbe Vorschau noch einmal: Alles, was wiki-eigen war, steht jetzt auf dem Wiki-Wert.
            const zweiterLauf = await vorschau();
            const uebrig = await wert<{ feld: string }>(
                `SELECT feld FROM wikisync_lauf_zeile WHERE lauf_id = ${String(zweiterLauf)} AND bereich = 'kraftlinie' AND wirkung = 'uebernommen'`,
            );
            // Nichts bleibt übrig: Auch die Adresslinie hat keinen Wiki-Stand, und die Vorschau sagt es als Befund statt als Übernahme (sie nennt nichts „übernommen“, was die Übernahme liegen ließe).
            expect(uebrig).toEqual([]);
            expect(
                await zahl(
                    `SELECT count(*)::int AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${String(zweiterLauf)} AND objekt_id = '${ID.c1}' AND wirkung = 'befund'`,
                ),
            ).toBeGreaterThan(0);
            const noch = await uebernehmen();
            expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });
            expect(noch.bereiche[0]!.zahlen).toMatchObject({ felder: 0, objekte: 0 });
            // Auch die alte Vorschau noch einmal übernommen: Alles steht schon da.
            const altesNoch = await uebernehmen({ bereiche: ["kraftlinie"], lauf: zweiterLauf - 1 });
            expect(altesNoch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });
            expect(await abdruck(admin())).toEqual(nachErsten);
            expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(operationen);
        });

        it("🔴 Der Fall der Stage: eine Linie aus fünf Abschnitten, zwei davon nur mit Adresse – Vorschau und Übernahme sagen dasselbe (keine „2 Übernahmen“, die nichts schreiben)", async () => {
            await neueWelt();
            // Wie „Wasserscheide“: Der Wiki-Stand der Linie gleicht dem Wiki schon, die Beschreibung am Abschnitt ist leer; zwei der fünf Abschnitte haben keinen Stand (address_only).
            await admin()`
                INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, staerke, affinitaet, laenge, regionen, verlauf, description)
                VALUES ('wasserscheide', ${wiki("Wasserscheide")}, 'Wasserscheide', 'regional', NULL, NULL, NULL, NULL,
                        'Die Wasserscheide ist eine regionale Kraftlinie.')
            `;
            const ws = [1, 2, 3, 4, 5].map((n) => `f1000000-0000-4000-8000-00000000000${String(n)}`);
            for (const [n, id] of ws.entries()) {
                const strecke = `LINESTRING(${String(150 + n)} 150, ${String(151 + n)} 151)`;
                await admin()`
                    INSERT INTO powerline (public_id, map_domain_id, name, description, from_public_id, to_public_id, geom, drawn_geom, source_system)
                    VALUES (${id}, 'aventuria', 'Wasserscheide', NULL, ${randomUUID()}, ${randomUUID()},
                            ST_SetSRID(ST_GeomFromText(${strecke}), 0), ST_SetSRID(ST_GeomFromText(${strecke}), 0), 'legacy')
                `;
            }
            const mitStand = ws.slice(0, 3);
            await admin()`
                INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT p.id, ${wiki("Wasserscheide")},
                       CASE WHEN p.public_id = ANY(${mitStand}::uuid[]) THEN (SELECT id FROM wiki_powerline_snapshot WHERE wiki_key = 'wasserscheide') END,
                       CASE WHEN p.public_id = ANY(${mitStand}::uuid[]) THEN 'assigned' ELSE 'address_only' END, 'legacy_editor'
                  FROM powerline p WHERE p.public_id = ANY(${ws}::uuid[])
            `;
            const abdruckLinie = (): Promise<{ id: string; r: string }[]> =>
                wert<{ id: string; r: string }>(
                    `SELECT public_id::text AS id, revision::text AS r FROM powerline WHERE name = 'Wasserscheide' ORDER BY public_id`,
                );
            const vorher = await abdruckLinie();

            const laufId = await vorschau();
            const zeilen = await wert<{ feld: string; wirkung: string; objekte: number }>(
                `SELECT feld, wirkung, objekte FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND bereich = 'kraftlinie' AND objekt_ids && ARRAY[${ws.map((id) => `'${id}'::uuid`).join(",")}]`,
            );
            // Die zwei Abschnitte ohne eigenen Stand erben den ihrer Linie: Es gibt nichts zu übernehmen und nichts zu melden.
            expect(zeilen).toEqual([]);

            const ergebnis = await uebernehmen();
            expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
            // Die Übernahme der übrigen Linien läuft; an der Wasserscheide schreibt sie nichts und meldet nichts (kein kein_schnappschuss).
            expect((await befunde()).filter((b) => ws.includes(b.objekt_id))).toEqual([]);
            expect(await abdruckLinie()).toEqual(vorher);
            expect(await beschreibung(ws[0]!)).toBeNull();
            expect((await snapshot("wasserscheide"))["description"]).toBe(
                "Die Wasserscheide ist eine regionale Kraftlinie.",
            );

            // Eine Vorschau vom alten Stand (die der Stage, die „2 Übernahmen“ zählte) ist keine Grundlage mehr: Die Übernahme verlangt eine neue Vorschau – so startet Vali den Lauf neu.
            await admin()`UPDATE wikisync_lauf SET parser_version = 'wikisync-parser-1' WHERE id = ${laufId}`;
            expect(await pruefeUebernahme(jobs(), "kraftlinie")).toMatchObject({
                ok: false,
                grund: "vorschau_veraltet",
            });
            const neuerLauf = await vorschau();
            expect(await pruefeUebernahme(jobs(), "kraftlinie")).toMatchObject({ ok: true });

            // 🔴 Eine Befundzeile ohne Kennungen hält die Übernahme nicht auf (Stage 2026-10-27, Quellen `ohne_produktseite`); eine schreibende schon.
            const [probe] = await wert<{ id: string }>(
                `SELECT id::text AS id FROM wikisync_lauf_zeile WHERE lauf_id = ${String(neuerLauf)} AND bereich = 'kraftlinie' AND feld IS NOT NULL LIMIT 1`,
            );
            expect(probe).toBeDefined();
            await admin()`
                UPDATE wikisync_lauf_zeile SET objekte = 3, objekt_ids = '{}', eigentuemer = 'unbekannt', wirkung = 'befund'
                 WHERE id = ${probe!.id}::bigint
            `;
            expect(await pruefeUebernahme(jobs(), "kraftlinie")).toMatchObject({ ok: true });
            await admin()`UPDATE wikisync_lauf_zeile SET eigentuemer = 'wiki', wirkung = 'uebernommen' WHERE id = ${probe!.id}::bigint`;
            expect(await pruefeUebernahme(jobs(), "kraftlinie")).toMatchObject({
                ok: false,
                grund: "vorschau_veraltet",
            });
        });

        it("🔴 Manuelle, getrennte und unterdrückte Werte überleben mehrere Läufe", async () => {
            await neueWelt();
            await vorschau();
            await uebernehmen();
            await vorschau();
            await uebernehmen();
            // Eigene Beschreibung samt Vermerk, getrennte und unterdrückte Zuordnung: unberührt.
            for (const id of BASILIUS) expect(await beschreibung(id)).toBe("Meine Beschreibung");
            expect(
                await wert<{ object_id: string; field: string; origin: string }>(
                    `SELECT object_id::text, field, origin FROM field_origin WHERE field = 'description' ORDER BY object_id`,
                ),
            ).toEqual([
                { object_id: ID.b1, field: "description", origin: "manual" },
                { object_id: ID.b2, field: "description", origin: "manual" },
            ]);
            expect(
                await wert<{ assignment_state: string }>(
                    `SELECT a.assignment_state FROM powerline_wiki_assignment a JOIN powerline p ON p.id = a.powerline_id WHERE p.public_id IN ('${ID.d1}', '${ID.e1}') ORDER BY p.public_id`,
                ),
            ).toEqual([{ assignment_state: "separated" }, { assignment_state: "suppressed" }]);
            for (const id of [ID.d1, ID.e1]) expect(await beschreibung(id)).toBeNull();
        });

        it("🔴 Istwert ungleich alt ergibt einen Befund: Ein Wert, den seit der Vorschau jemand änderte, wird nicht überschrieben", async () => {
            await neueWelt();
            // Die Beschreibung der Weidener Linie folgt dem Wiki als eigene Kopie (Vermerk wiki, gleich dem Wiki-Stand von gestern) – dann wird sie wiki-eigen UND schreibbar.
            await admin()`UPDATE powerline SET description = 'Alte Beschreibung' WHERE public_id = ANY(${WEIDEN}::uuid[])`;
            await admin()`
            INSERT INTO field_origin (object_kind, object_id, field, origin)
            SELECT 'powerline', t.id, 'description', 'wiki' FROM unnest(${WEIDEN}::uuid[]) AS t(id)
        `;
            const laufId = await vorschau();
            const zeile = await wert<{
                eigentuemer: string;
                wirkung: string;
                objekte: number;
                alt: string;
                neu: string;
            }>(
                `SELECT eigentuemer, wirkung, objekte, alt, neu FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND bereich = 'kraftlinie' AND feld = 'description' AND objekte = 3`,
            );
            expect(zeile).toEqual([
                {
                    eigentuemer: "wiki",
                    wirkung: "uebernommen",
                    objekte: 3,
                    alt: "Alte Beschreibung",
                    neu: "Neue Beschreibung der Weidener Linie.",
                },
            ]);
            // Nach der Vorschau ändert ein Editor den Wert des zweiten Abschnitts.
            await admin()`UPDATE powerline SET description = 'Editor-Text' WHERE public_id = ${ID.a2}`;
            await admin()`UPDATE field_origin SET origin = 'manual' WHERE object_id = ${ID.a2} AND field = 'description'`;

            const ergebnis = await uebernehmen();
            expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
            // Zwei Abschnitte folgen dem Wiki, der dritte behält seinen Wert und meldet den Befund; der Wiki-Wert hinter ↺ ist trotzdem neu.
            expect(await beschreibung(ID.a1)).toBe("Neue Beschreibung der Weidener Linie.");
            expect(await beschreibung(ID.a3)).toBe("Neue Beschreibung der Weidener Linie.");
            expect(await beschreibung(ID.a2)).toBe("Editor-Text");
            expect((await snapshot("weidener-linie"))["description"]).toBe("Neue Beschreibung der Weidener Linie.");
            expect(await befunde()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        objekt_id: ID.a2,
                        feld: "description",
                        befund: "seit_vorschau_geaendert",
                    }),
                ]),
            );
            expect(
                (await befunde()).filter((b) => b.befund === "seit_vorschau_geaendert").map((b) => b.objekt_id),
            ).toEqual([ID.a2]);
        });

        it("🔴 Der Name bindet die Abschnitte: nie auf den Namen einer anderen Linie, nie nur an einem Teil, nie leer – der Wiki-Wert bleibt trotzdem geschrieben", async () => {
            await neueWelt();
            // Die Weidener Linie heißt schon so, wie das Wiki die Basiliuslinie nennen will: Der neue Name wäre vergeben.
            await admin()`UPDATE powerline SET name = 'Basiliuslinie' WHERE public_id = ANY(${WEIDEN}::uuid[])`;
            await admin()`UPDATE wiki_powerline_snapshot SET name = 'Basiliuslinie' WHERE wiki_key = 'weidener-linie'`;
            await vorschau();
            await uebernehmen();
            expect(await befunde()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ objekt_id: ID.b1, feld: "name", befund: "name_vergeben" }),
                ]),
            );
            for (const id of BASILIUS) expect(await name(id)).toBe("Alte Basiliuslinie");
            // Der Wiki-Wert hinter ↺ ist trotzdem der von heute.
            expect((await snapshot("basiliuslinie"))["name"]).toBe("Basiliuslinie");
        });

        it("🔴 Ein Abbruch vor der Übernahme lässt alles stehen; ein Fehler mitten in der Transaktion rollt ganz zurück", async () => {
            await neueWelt();
            await vorschau();
            const vorher = await abdruck(admin());
            await expect(uebernehmen(undefined, { abbruch: true })).rejects.toBeInstanceOf(JobCancelled);
            expect(await abdruck(admin())).toEqual(vorher);
            expect(await wert<{ status: string }>(`SELECT status FROM wikisync_uebernahme`)).toEqual([
                { status: "abgebrochen" },
            ]);

            // Ein Schreiber, der beim Wiki-Wert scheitert, nachdem die Abschnitte schon geschrieben sind: nichts bleibt.
            const pruefung = await pruefeUebernahme(jobs(), "kraftlinie");
            expect(pruefung.ok).toBe(true);
            if (!pruefung.ok) return;
            const kaputt: Schreiber = {
                ...kraftlinieSchreiber,
                schreibeSchnappschuss: () => Promise.reject(new Error("Platte voll")),
            };
            const id = await legeUebernahmeAn(jobs(), {
                art: "uebernahme",
                bereich: "kraftlinie",
                laufId: pruefung.lauf.id,
                dump: pruefung.lauf.dump,
                jobPublicId: randomUUID(),
                ausgeloestVon: null,
                ausgeloestLabel: "test",
            });
            const operationen = await zahl(`SELECT count(*)::int AS n FROM map_operation`);
            await expect(
                uebernimmBereich({
                    db: jobs(),
                    bereich: "kraftlinie",
                    schreiber: kaputt,
                    lauf: pruefung.lauf,
                    uebernahmeId: id,
                    actor: { kind: "system", label: "test", environment: "test" },
                    mapDomainId: "aventuria",
                    jobPublicId: randomUUID(),
                    vorDemSchreiben: () => undefined,
                }),
            ).rejects.toThrow("Platte voll");
            expect(await abdruck(admin())).toEqual(vorher);
            expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(operationen);
        });

        it("🔴 Ein Editor-Entwurf von vorher bekommt 409, wenn die Übernahme dazwischen schrieb; mit der neuen Revision geht es", async () => {
            await neueWelt();
            const vorherRevisionen = await Promise.all(
                WEIDEN.map(async (id) => ({ id, baseRevision: await revision(id) })),
            );
            await vorschau();
            await uebernehmen();
            const person = await fixture.person("editor", { name: "Edora" });
            const actor = { kind: "person" as const, personId: person.id, environment: "test" as const };
            await expect(
                updatePowerlineLine(cluster!.app, actor, ID.a1, {
                    operationId: randomUUID(),
                    segments: vorherRevisionen,
                    labelVisible: true,
                }),
            ).rejects.toMatchObject({ statusCode: 409, code: "edit_conflict" });
            const neu = await Promise.all(WEIDEN.map(async (id) => ({ id, baseRevision: await revision(id) })));
            await expect(
                updatePowerlineLine(cluster!.app, actor, ID.a1, {
                    operationId: randomUUID(),
                    segments: neu,
                    labelVisible: true,
                }),
            ).resolves.toMatchObject({ status: "applied" });
        });

        it("Der Verlauf der Kraftlinie zeigt die Operation mit der Quelle wikisync (kein 500 am Antwortschema)", async () => {
            await neueWelt();
            await vorschau();
            await uebernehmen();
            const person = await welt.jemand("editor");
            const antwort = await app.inject({
                method: "GET",
                url: `/api/editor/powerlines/${ID.a1}/history`,
                headers: { cookie: person.cookie, host: "avesmaps.test" },
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const eintraege = (
                antwort.json() as { entries: { source: string; operation: string; actor: { kind: string } }[] }
            ).entries;
            expect(eintraege[0]).toMatchObject({ source: "wikisync", operation: "wikisync.uebernehmen" });
        });

        it("🔴 Ohne Kategorien-Datei oder ohne Lauf der Vorschau wird ein Bereich nicht übernommen", async () => {
            await neueWelt();
            await vorschau();
            expect(await pruefeUebernahme(jobs(), "kraftlinie")).toMatchObject({ ok: true });
            // Orte und Gipfel rechnete diese Vorschau nicht: Es gibt keinen Lauf für sie.
            expect(await pruefeUebernahme(jobs(), "ort")).toMatchObject({ ok: false, grund: "kein_lauf" });
            expect(await pruefeUebernahme(jobs(), "gipfel")).toMatchObject({ ok: false, grund: "kein_lauf" });
            // Rechnet eine Vorschau die Orte, ohne dass eine Kategorien-Datei im Dump-Ordner liegt (WI-0294), bleibt die Übernahme der Orte aus; die Gipfel haben keine Kategorien und gehen.
            await vorschau(["ort", "gipfel"]);
            expect(await pruefeUebernahme(jobs(), "ort")).toMatchObject({ ok: false, grund: "kategorien_fehlen" });
            expect(await pruefeUebernahme(jobs(), "gipfel")).toMatchObject({ ok: true });
        });

        // ----------------------------------------------------------------------------------------------------------------------------
        // Die Rücknahme
        // ----------------------------------------------------------------------------------------------------------------------------

        it("🔴 Rücknahme je Bereich und Lauf, je Feld nur wo der Istwert noch „nachher“ ist; nur einmal", async () => {
            await neueWelt();
            await admin()`UPDATE powerline SET description = 'Alte Beschreibung' WHERE public_id = ANY(${WEIDEN}::uuid[])`;
            await admin()`
            INSERT INTO field_origin (object_kind, object_id, field, origin)
            SELECT 'powerline', t.id, 'description', 'wiki' FROM unnest(${WEIDEN}::uuid[]) AS t(id)
        `;
            const laufId = await vorschau();
            const person = await fixture.person("admin", { name: "Ada" });
            const erste = await uebernehmen(undefined, { jobPublicId: await auftragVon(person.id) });
            const uebernahmeId = erste.bereiche[0]!.uebernahme!;
            expect(await beschreibung(ID.a1)).toBe("Neue Beschreibung der Weidener Linie.");
            expect((await snapshot("weidener-linie"))["staerke"]).toBe("überregional");
            // Danach ändert jemand die Beschreibung des zweiten Abschnitts.
            await admin()`UPDATE powerline SET description = 'Später geändert' WHERE public_id = ${ID.a2}`;
            const operationenVorher = await zahl(`SELECT count(*)::int AS n FROM map_operation`);

            const rueck = (await runWikiZuruecknehmenJob(
                kontext(
                    { bereich: "kraftlinie", lauf: laufId, uebernahme: uebernahmeId },
                    { jobPublicId: await auftragVon(person.id, "wiki_zuruecknehmen") },
                ),
                { environment: einsatz, mitDatenbank: mitJobs },
            )) as { status: string; zahlen: Record<string, number>; operationId: string };
            expect(rueck).toMatchObject({ status: "fertig" });
            // Zurück auf Vorher: zwei Abschnitte, der Wiki-Wert hinter ↺ und der Name der Basiliuslinie; der später geänderte Abschnitt bleibt.
            expect(await beschreibung(ID.a1)).toBe("Alte Beschreibung");
            expect(await beschreibung(ID.a3)).toBe("Alte Beschreibung");
            expect(await beschreibung(ID.a2)).toBe("Später geändert");
            expect(await snapshot("weidener-linie")).toMatchObject({
                staerke: "regional",
                verlauf: null,
                description: "Alte Beschreibung",
            });
            for (const id of BASILIUS) {
                expect(await name(id)).toBe("Alte Basiliuslinie");
                expect(await beschreibung(id)).toBe("Meine Beschreibung");
            }
            expect(await snapshot("basiliuslinie")).toMatchObject({
                name: "Alte Basiliuslinie",
                description: "Wiki alt",
                verlauf: null,
            });
            expect((await befunde()).filter((b) => b.befund === "seit_uebernahme_geaendert")).toEqual([
                expect.objectContaining({ objekt_id: ID.a2, feld: "description", befund: "seit_uebernahme_geaendert" }),
            ]);
            // Eine zweite Operation, ebenfalls aus der Quelle wikisync, mit eigenem Eintrag je Objekt.
            expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(operationenVorher + 1);
            const [op] = await wert<{ source: string; action: string }>(
                `SELECT source, action FROM map_operation WHERE operation_id = '${rueck.operationId}'`,
            );
            expect(op).toEqual({ source: "wikisync", action: "wikisync.zuruecknehmen" });
            expect(
                await zahl(
                    `SELECT count(*)::int AS n FROM map_audit_event WHERE operation_id = '${rueck.operationId}' AND action = 'powerline.wikisync_zurueckgenommen'`,
                ),
            ).toBe(5);
            expect(
                await wert<{ zurueckgenommen: boolean }>(
                    `SELECT (zurueckgenommen_am IS NOT NULL) AS zurueckgenommen FROM wikisync_uebernahme WHERE id = ${String(uebernahmeId)}`,
                ),
            ).toEqual([{ zurueckgenommen: true }]);

            // Nur einmal; ein anderer Bereich hat keine Übernahme, die zurückzunehmen wäre.
            await expect(
                runWikiZuruecknehmenJob(kontext({ bereich: "kraftlinie", lauf: laufId, uebernahme: uebernahmeId }), {
                    environment: einsatz,
                    mitDatenbank: mitJobs,
                }),
            ).rejects.toMatchObject({ code: "schon_zurueckgenommen" });
            await expect(
                runWikiZuruecknehmenJob(kontext({ bereich: "gipfel", lauf: laufId, uebernahme: uebernahmeId }), {
                    environment: einsatz,
                    mitDatenbank: mitJobs,
                }),
            ).rejects.toMatchObject({ code: "nichts_zurueckzunehmen" });
            await expect(
                runWikiZuruecknehmenJob(
                    kontext({ bereich: "kraftlinie", lauf: laufId + 99, uebernahme: uebernahmeId }),
                    { environment: einsatz, mitDatenbank: mitJobs },
                ),
            ).rejects.toBeInstanceOf(JobFailure);
        });

        // ----------------------------------------------------------------------------------------------------------------------------
        // Der Legacy-Zug lässt einen umgeschalteten Bereich aus
        // ----------------------------------------------------------------------------------------------------------------------------

        const ZUG_QUELLE = (): LegacyPayload => ({
            ok: true,
            revision: 140205,
            features: [
                {
                    type: "Feature",
                    id: "f1000000-0000-4000-8000-0000000000aa",
                    geometry: { type: "Point", coordinates: [400, 400] },
                    properties: {
                        feature_type: "location",
                        public_id: "f1000000-0000-4000-8000-0000000000aa",
                        name: "Zugort A",
                    },
                },
                {
                    type: "Feature",
                    id: "f1000000-0000-4000-8000-0000000000bb",
                    geometry: { type: "Point", coordinates: [460, 420] },
                    properties: {
                        feature_type: "location",
                        public_id: "f1000000-0000-4000-8000-0000000000bb",
                        name: "Zugort B",
                    },
                },
                {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [400, 400],
                            [460, 420],
                        ],
                    },
                    properties: {
                        feature_type: "powerline",
                        feature_subtype: "powerline",
                        public_id: "f1000000-0000-4000-8000-000000000001",
                        name: "Zuglinie",
                        from_public_id: "f1000000-0000-4000-8000-0000000000aa",
                        to_public_id: "f1000000-0000-4000-8000-0000000000bb",
                        show_label: true,
                    },
                },
            ] as never,
        });

        it("🔴 Der Legacy-Zug lässt die Kraftlinien aus (I8 und ihr Teil von I17), sie gehören fest dem WikiSync", async () => {
            await neueWelt();
            const linienVorher = await zahl(`SELECT count(*)::int AS n FROM powerline`);
            const snapshotVorher = await snapshot("weidener-linie");
            // I8: Die Linie des Zugs entsteht nicht.
            const aus = await importPowerlines(importer!, ZUG_QUELLE());
            expect(aus).toMatchObject({ created: 0, updated: 0, retired: 0 });
            expect(aus.findings.map((f) => f.code)).toContain("bereich_wikisync");
            expect(await zahl(`SELECT count(*)::int AS n FROM powerline`)).toBe(linienVorher);
            // I17: Der Wiki-Stand der Kraftlinie und ihre Zuordnung bleiben, wie WikiSync sie führt.
            const detail: MapFeaturesPayload = {
                ok: true,
                revision: 9001,
                features: [
                    {
                        properties: {
                            feature_type: "powerline",
                            public_id: ID.a1,
                            name: "Weidener Linie",
                            wiki_url: wiki("Weidener Linie"),
                            wiki_powerline: {
                                wiki_key: "weidener-linie",
                                wiki_url: wiki("Weidener Linie"),
                                name: "Weidener Linie",
                                staerke: "VOM-ZUG",
                                affinitaet: "Humus",
                                laenge: "",
                                regionen: "",
                                verlauf: "",
                                description: "Alte Beschreibung",
                            },
                        },
                    },
                ],
            };
            const detailAus = await importSubjectDetails(importer!, detail);
            expect(detailAus.tables.wiki_powerline_snapshot).toMatchObject({ created: 0, updated: 0, retired: 0 });
            expect(detailAus.tables.powerline_wiki_assignment).toMatchObject({ created: 0, updated: 0, retired: 0 });
            expect(detailAus.findings.map((f) => f.code)).toContain("bereich_wikisync");
            expect(await snapshot("weidener-linie")).toEqual(snapshotVorher);
        });

        it("🔴 Der Zug einer Kategorie reiht nicht mehr ein: Jede Kategorie hat Bereiche, die fest dem WikiSync gehören (Start aus der Verwaltung und von Hand)", async () => {
            await neueWelt();
            const einreihen = (quelle: "legacy_orte" | "legacy_wege" | "legacy_landschaften"): Promise<unknown> =>
                cluster!.app.begin((tx) => enqueueAbgleich(tx, { quelle, actorRef: "cli:test" }));
            const erwartet = {
                legacy_orte: { kategorie: "orte", bereiche: ["ort"] },
                legacy_wege: { kategorie: "wege", bereiche: ["weg"] },
                legacy_landschaften: { kategorie: "landschaften", bereiche: ["region", "gipfel"] },
            } as const;
            for (const quelle of Object.keys(erwartet) as (keyof typeof erwartet)[]) {
                const abweisung = await einreihen(quelle).catch((fehler: unknown) => fehler);
                expect(abweisung, quelle).toBeInstanceOf(ApiError);
                expect(abweisung, quelle).toMatchObject({
                    statusCode: 409,
                    code: "bereich_gehoert_wikisync",
                    details: erwartet[quelle],
                });
            }
            expect(await zahl(`SELECT count(*)::int AS n FROM job WHERE kind = 'legacy_zug'`)).toBe(0);
        });

        // ----------------------------------------------------------------------------------------------------------------------------
        // Die Routen
        // ----------------------------------------------------------------------------------------------------------------------------

        it("🔴 Die Bereiche: jeder ist angeschlossen und gehört dem WikiSync; einen Schalter gibt es nicht mehr (POST 404)", async () => {
            await neueWelt();
            const tester = await welt.jemand("tester");
            const antwort = await app.inject({
                method: "GET",
                url: WIKISYNC_BEREICHE_URL,
                headers: { cookie: tester.cookie, host: "avesmaps.test" },
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const bereiche = antwort.json<WikisyncBereiche>();
            expect(bereiche.bereiche.map((b) => b.bereich)).toEqual([...WIKISYNC_BEREICHE]);
            expect(bereiche.bereiche.every((b) => b.angeschlossen)).toBe(true);
            expect(bereiche.bereiche.map((b) => Object.keys(b).sort())[0]).toEqual([
                "angeschlossen",
                "bereich",
                "kategorien",
                "letzteUebernahme",
            ]);
            const operator = await welt.jemand("operator", { frisch: true, passkey: true });
            const schalten = await welt.post(WIKISYNC_BEREICHE_URL, operator.cookie, {
                operationId: randomUUID(),
                baseRevision: 1,
                bereich: "kraftlinie",
                besitzer: "legacy",
            });
            expect(schalten.statusCode).toBe(404);
        });

        it("🔴 Vorschau, Übernehmen, Zurücknehmen: Rechte, Passkey, 409 und die eingereihten Aufträge", async () => {
            await neueWelt();
            const tester = await welt.jemand("tester");
            const editor = await welt.jemand("editor", { frisch: true, passkey: true });
            const editorAlt = await welt.jemand("editor");
            const admin2 = await welt.jemand("admin", { frisch: true, passkey: true });
            const aufraeumen = (): Promise<unknown> =>
                admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
            const jobArten = (): Promise<{ kind: string; input_ref: Record<string, unknown>; actor_ref: string }[]> =>
                wert(`SELECT kind, input_ref, actor_ref FROM job WHERE state = 'QUEUED' ORDER BY id`);

            // Die Vorschau stößt schon ein Tester an; sie liegt in der Warteschlange, ein zweiter Druck sagt 409.
            const vorschauAntwort = await welt.post(WIKISYNC_VORSCHAU_URL, tester.cookie, {
                operationId: randomUUID(),
                bereiche: ["kraftlinie"],
            });
            expect(vorschauAntwort.statusCode, vorschauAntwort.body).toBe(200);
            expect(await jobArten()).toEqual([
                { kind: "wiki_vorschau", input_ref: { bereiche: ["kraftlinie"] }, actor_ref: tester.id },
            ]);
            const nochmal = await welt.post(WIKISYNC_VORSCHAU_URL, tester.cookie, { operationId: randomUUID() });
            expect(nochmal.json()).toMatchObject({ error: { code: "vorschau_laeuft" } });
            expect((await welt.post(WIKISYNC_VORSCHAU_URL, undefined, { operationId: randomUUID() })).statusCode).toBe(
                401,
            );
            await aufraeumen();

            // Übernehmen: ohne Vorschau 409 kein_lauf; dann mit Lauf.
            const uebernehmenBody = (extra: object = {}) => ({
                operationId: randomUUID(),
                bereiche: ["kraftlinie"],
                ...extra,
            });
            expect((await welt.post(WIKISYNC_UEBERNEHMEN_URL, tester.cookie, uebernehmenBody())).statusCode).toBe(403);
            expect(
                (await welt.post(WIKISYNC_UEBERNEHMEN_URL, editorAlt.cookie, uebernehmenBody())).json(),
            ).toMatchObject({ error: { code: "reauth_required" } });
            expect((await welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, uebernehmenBody())).json()).toMatchObject({
                error: { code: "kein_lauf" },
            });
            const laufId = await vorschau();
            const ok = await welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, uebernehmenBody({ lauf: laufId }));
            expect(ok.statusCode, ok.body).toBe(200);
            expect(await jobArten()).toEqual([
                {
                    kind: "wiki_uebernehmen",
                    input_ref: { bereiche: ["kraftlinie"], lauf: laufId },
                    actor_ref: editor.id,
                },
            ]);
            // Läuft schon etwas, was die Karte schreibt: 409.
            expect((await welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, uebernehmenBody())).json()).toMatchObject({
                error: { code: "uebernahme_laeuft" },
            });
            await aufraeumen();
            // Entweder Bereiche oder alle; „alle“ nur ein Admin.
            expect(
                (await welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, { operationId: randomUUID() })).statusCode,
            ).toBe(400);
            expect(
                (await welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, { operationId: randomUUID(), alle: true }))
                    .statusCode,
            ).toBe(403);
            expect(
                (await welt.post(WIKISYNC_UEBERNEHMEN_URL, admin2.cookie, { operationId: randomUUID(), alle: true }))
                    .statusCode,
            ).toBe(200);
            expect((await jobArten())[0]).toMatchObject({
                kind: "wiki_uebernehmen",
                input_ref: { bereiche: ["kraftlinie"] },
            });
            await aufraeumen();
            // Ein Bereich ohne Lauf der Vorschau wird nicht eingereiht.
            const ohneLauf = await welt.post(WIKISYNC_UEBERNEHMEN_URL, editor.cookie, {
                operationId: randomUUID(),
                bereiche: ["weg"],
            });
            expect(ohneLauf.statusCode).toBe(409);
            expect(ohneLauf.json()).toMatchObject({ error: { code: "kein_lauf", details: { bereich: "weg" } } });

            // Zurücknehmen: nur ein Admin mit Passkey; ohne Übernahme 404.
            const rueckBody = (extra: object = {}) => ({
                operationId: randomUUID(),
                lauf: laufId,
                bereich: "kraftlinie",
                ...extra,
            });
            expect((await welt.post(WIKISYNC_ZURUECKNEHMEN_URL, editor.cookie, rueckBody())).statusCode).toBe(403);
            expect((await welt.post(WIKISYNC_ZURUECKNEHMEN_URL, admin2.cookie, rueckBody())).json()).toMatchObject({
                error: { code: "nichts_zurueckzunehmen" },
            });
            await uebernehmen();
            const rueckOk = await welt.post(WIKISYNC_ZURUECKNEHMEN_URL, admin2.cookie, rueckBody());
            expect(rueckOk.statusCode, rueckOk.body).toBe(200);
            expect((await jobArten())[0]).toMatchObject({
                kind: "wiki_zuruecknehmen",
                input_ref: { bereich: "kraftlinie", lauf: laufId },
            });
            await aufraeumen();
            expect(
                (await welt.post(WIKISYNC_ZURUECKNEHMEN_URL, admin2.cookie, rueckBody({ bereich: "gipfel" }))).json(),
            ).toMatchObject({ error: { code: "nichts_zurueckzunehmen" } });
            // Die Ereignisse stehen im Protokoll der Verwaltung, mit dem Auslöser.
            const ereignisse = await wert<{ action: string; actor_person_id: string }>(
                `SELECT action, actor_person_id::text FROM avesmaps_auth.security_event WHERE action LIKE 'system.wikisync\\_%'  ORDER BY id`,
            );
            expect(ereignisse.map((e) => e.action)).toEqual([
                "system.wikisync_vorschau_angestossen",
                "system.wikisync_uebernahme_angestossen",
                "system.wikisync_uebernahme_angestossen",
                "system.wikisync_zurueckgenommen",
            ]);
        });

        it("🔴 Rechte der Rollen: Die Jobs-Rolle schreibt an powerline nur Name, Beschreibung und die Revision, am Wiki-Stand nur Textspalten; die App liest das Protokoll nur", async () => {
            const c = cluster!;
            const codes = await c.codesAs(c.jobs, [
                "UPDATE powerline SET name = name WHERE FALSE",
                "UPDATE powerline SET description = description WHERE FALSE",
                "UPDATE powerline SET revision = revision WHERE FALSE",
                "UPDATE powerline SET label_visible = TRUE WHERE FALSE",
                "UPDATE powerline SET geom = geom WHERE FALSE",
                "UPDATE powerline SET is_active = TRUE WHERE FALSE",
                "DELETE FROM powerline WHERE FALSE",
                "UPDATE wiki_powerline_snapshot SET staerke = staerke WHERE FALSE",
                "UPDATE wiki_powerline_snapshot SET wiki_key = wiki_key WHERE FALSE",
                "UPDATE powerline_wiki_assignment SET wiki_url = wiki_url WHERE FALSE",
                "INSERT INTO field_origin (object_kind, object_id, field, origin) SELECT 'powerline', gen_random_uuid(), 'name', 'wiki' WHERE FALSE",
                "INSERT INTO wikisync_bereich_setting (bereich) SELECT 'ort' WHERE FALSE",
                "SELECT 1 FROM wikisync_bereich_setting",
            ]);
            expect(codes).toEqual([
                "ok",
                "ok",
                "ok",
                "42501",
                "42501",
                "42501",
                "42501",
                "ok",
                "42501",
                "42501",
                "42501",
                "42501",
                "ok",
            ]);
            const appCodes = await c.codesAs(c.app, [
                "INSERT INTO wikisync_uebernahme (art, bereich, lauf_id) VALUES ('uebernahme', 'kraftlinie', 1)",
                "UPDATE wikisync_uebernahme SET grund = 'x'",
                "DELETE FROM wikisync_uebernahme_befund",
                "SELECT 1 FROM wikisync_uebernahme",
                "INSERT INTO wikisync_bereich_setting (bereich) VALUES ('gipfel')",
                "DELETE FROM wikisync_bereich_setting",
                "TRUNCATE wikisync_bereich_setting",
                "DELETE FROM wikisync_bereich_state",
            ]);
            expect(appCodes).toEqual(["42501", "42501", "42501", "ok", "ok", "ok", "42501", "42501"]);
            expect(await c.granted(c.roles.jobs, "wikisync_uebernahme")).toEqual(
                expect.arrayContaining(["SELECT", "INSERT", "UPDATE"]),
            );
            expect(await c.granted(c.roles.jobs, "wikisync_uebernahme")).not.toContain("DELETE");
            expect(await c.granted(c.roles.jobs, "wikisync_bereich_setting")).toEqual(["SELECT"]);
            expect(await raeumeAb(c.jobs)).toBeGreaterThanOrEqual(0);
        });

        // ----------------------------------------------------------------------------------------------------------------------------
        // Das ↺ in „Änderungen“ (WI-0265 B8d): GENAU die Rücknahme des WikiSync, kein zweiter Mechanismus
        // ----------------------------------------------------------------------------------------------------------------------------

        describe("B8d: Übernahmen des WikiSync in „Änderungen“ zurücknehmen", () => {
            const hash = (op: string): string => mitgliederHash([op]);
            const eintragVon = async (personId: string, op: string) =>
                (await mapChange(cluster!.app, op, { mapDomainId: "aventuria", personId }))!;
            const reiter = (op: string, cookie: string | undefined, extra: object = {}) =>
                welt.post(editorWikiSyncRestoreSeriesUrl(op), cookie, {
                    operationId: randomUUID(),
                    members: [op],
                    membersHash: hash(op),
                    ...extra,
                });
            const vorpruefung = async (op: string, cookie: string, members: string[] = [op]) =>
                (
                    await welt.post(editorWikiSyncRestoreSeriesPreviewUrl(op), cookie, {
                        members,
                        membersHash: mitgliederHash(members),
                    })
                ).json() as RuecknahmePruefung;
            const wartend = (): Promise<{ public_id: string; input_ref: Record<string, unknown> }[]> =>
                wert(
                    `SELECT public_id::text, input_ref FROM job WHERE kind = 'wiki_zuruecknehmen' AND state = 'QUEUED'`,
                );

            /** Eine Übernahme des Laufs, ausgelöst von `ausloeser` (Person oder keine); gibt die Operation und den Lauf zurück. */
            async function uebernommen(ausloeser: string | null): Promise<{ op: string; laufId: number }> {
                await neueWelt();
                await admin()`UPDATE powerline SET description = 'Alte Beschreibung' WHERE public_id = ANY(${WEIDEN}::uuid[])`;
                await admin()`
                    INSERT INTO field_origin (object_kind, object_id, field, origin)
                    SELECT 'powerline', t.id, 'description', 'wiki' FROM unnest(${WEIDEN}::uuid[]) AS t(id)
                `;
                const laufId = await vorschau();
                const ergebnis = await uebernehmen(undefined, { jobPublicId: await auftragVon(ausloeser) });
                return { op: ergebnis.bereiche[0]!.operationId!, laufId };
            }

            it("🔴 Übernahme eines Laufs: ruecknehmbar in der Liste; die Vorprüfung sagt ok (kein Konflikt, kein Gelände) und nennt den Satz; ohne das Recht undo_wikisync_run forbidden; die Rücknahme ist ein Auftrag (derselbe wie in der Verwaltung)", async () => {
                const admin2 = await welt.jemand("admin", { frisch: true, passkey: true });
                const editor = await welt.jemand("editor", { frisch: true, passkey: true });
                const { op, laufId } = await uebernommen(admin2.id);

                const zeile = await eintragVon(admin2.id, op);
                expect(zeile).toMatchObject({ source: "wikisync", status: "ruecknehmbar" });
                expect(zeile.series).toBeUndefined();

                const vor = await vorpruefung(op, admin2.cookie);
                expect(vor.ergebnis).toBe("ok");
                expect(vor.offen).toEqual([op]);
                expect(vor.reasonRequired).toBe(false);
                expect(vor.mitglieder[0]).toMatchObject({
                    operation: "wikisync.uebernehmen",
                    source: "wikisync",
                    offen: true,
                });
                expect(vor.folgen.gelaende).toBe("keines");
                expect(vor.folgen.gegenstaende).toBeGreaterThan(0);
                // Ein Editor liest die Vorprüfung, hat aber das Recht der Rücknahme nicht.
                const ohneRecht = await vorpruefung(op, editor.cookie);
                expect(ohneRecht.ergebnis).toBe("forbidden");
                expect(ohneRecht.fehlendeRechte).toEqual(["undo_wikisync_run"]);
                expect((await reiter(op, editor.cookie)).statusCode).toBe(403);
                expect((await reiter(op, undefined)).statusCode).toBe(401);
                // Ohne frischen Passkey fragt der Server nach (wie die Verwaltung).
                const alt = await welt.jemand("admin");
                expect((await reiter(op, alt.cookie)).json()).toMatchObject({ error: { code: "reauth_required" } });
                // Eine zerbrochene Liste und eine Operation, die keine Übernahme ist.
                expect((await reiter(op, admin2.cookie, { membersHash: "0".repeat(64) })).json()).toMatchObject({
                    error: { code: "invalid_members" },
                });
                expect((await reiter(randomUUID(), admin2.cookie)).json()).toMatchObject({
                    error: { code: "invalid_members" },
                });

                const ereignisseVorher = (
                    await wert<{ n: number }>(
                        `SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE action = 'system.wikisync_zurueckgenommen'`,
                    )
                )[0]!.n;
                const operationId = randomUUID();
                const ok = await reiter(op, admin2.cookie, { operationId });
                expect(ok.statusCode, ok.body).toBe(200);
                const quittung = ok.json() as RuecknahmeReceipt;
                expect(quittung).toMatchObject({ status: "applied", operationId, reverts: [] });
                expect(quittung.derivedWork).toMatchObject([{ kind: "wiki_zuruecknehmen", state: "queued" }]);
                expect(quittung.warnings.map((w) => w.code)).toEqual(["wikisync_auftrag"]);
                expect(Value.Check(RuecknahmeReceipt, quittung)).toBe(true);
                // Derselbe Auftrag wie in der Verwaltung: Bereich, Lauf, genau diese Übernahme.
                const uebernahmeId = (
                    await wert<{ id: number }>(
                        `SELECT id::int AS id FROM wikisync_uebernahme WHERE operation_id = '${op}'`,
                    )
                )[0]!.id;
                expect((await wartend()).map((job) => job.input_ref)).toEqual([
                    { bereich: "kraftlinie", lauf: laufId, uebernahme: uebernahmeId },
                ]);
                const ereignisse = (): Promise<{ n: number }[]> =>
                    wert(
                        `SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE action = 'system.wikisync_zurueckgenommen'`,
                    );
                expect((await ereignisse())[0]!.n - ereignisseVorher).toBe(1);
                // Dieselbe Kennung: dieselbe Quittung; ein zweiter Klick, solange der Auftrag wartet: 409.
                expect((await reiter(op, admin2.cookie, { operationId })).json()).toMatchObject({ status: "replayed" });
                const zweiter = await reiter(op, admin2.cookie);
                expect(zweiter.statusCode).toBe(409);
                expect(zweiter.json()).toMatchObject({ error: { code: "uebernahme_laeuft" } });
                // Bis der Auftrag fertig ist, bleibt die Übernahme ruecknehmbar.
                expect((await eintragVon(admin2.id, op)).status).toBe("ruecknehmbar");
                expect(await wartend()).toHaveLength(1);
            });

            it("🔴 Nach dem Auftrag: die Übernahme ist bereits_zurueckgenommen (mit der Rücknahme und ihrem Grund), die Rücknahme selbst ruecknehmbar (B8e) mit reverts; nur einmal; die Felder stehen wie bei der Verwaltung zurück", async () => {
                const ada = await welt.jemand("admin", { frisch: true, passkey: true });
                const bob = await welt.jemand("admin", { frisch: true, passkey: true });
                const { op } = await uebernommen(ada.id);
                // Bob nimmt Adas Übernahme zurück: der Grund ist Pflicht.
                const vor = await vorpruefung(op, bob.cookie);
                expect(vor.ergebnis).toBe("ok");
                expect(vor.reasonRequired).toBe(true);
                expect(vor.fremdePersonen).toMatchObject([{ kind: "person", id: ada.id }]);
                const ohne = await reiter(op, bob.cookie);
                expect(ohne.statusCode).toBe(400);
                expect(ohne.json()).toMatchObject({ error: { code: "reason_required" } });
                expect(await wartend()).toHaveLength(0);

                await admin()`UPDATE powerline SET description = 'Später geändert' WHERE public_id = ${ID.a2}`;
                const ok = await reiter(op, bob.cookie, { reason: "Falscher Lauf" });
                expect(ok.statusCode, ok.body).toBe(200);
                const [job] = await wartend();
                expect(job!.input_ref).toMatchObject({ grund: "Falscher Lauf" });
                const rueck = (await runWikiZuruecknehmenJob(kontext(job!.input_ref, { jobPublicId: job!.public_id }), {
                    environment: einsatz,
                    mitDatenbank: mitJobs,
                })) as { status: string; operationId: string };
                expect(rueck.status).toBe("fertig");
                // Wie in der Verwaltung: Feld für Feld, der später geänderte Abschnitt bleibt und steht als Befund da.
                expect(await beschreibung(ID.a1)).toBe("Alte Beschreibung");
                expect(await beschreibung(ID.a2)).toBe("Später geändert");
                expect((await befunde()).some((b) => b.befund === "seit_uebernahme_geaendert")).toBe(true);

                const zeile = await eintragVon(bob.id, op);
                expect(zeile.status).toBe("bereits_zurueckgenommen");
                expect(zeile.revertedBy).toMatchObject({
                    operationId: rueck.operationId,
                    reason: "Falscher Lauf",
                    actor: { kind: "person", id: bob.id },
                });
                const rueckZeile = await eintragVon(bob.id, rueck.operationId);
                expect(rueckZeile).toMatchObject({
                    operation: "wikisync.zuruecknehmen",
                    source: "wikisync",
                    status: "ruecknehmbar",
                    reverts: [op],
                    reason: "Falscher Lauf",
                });
                // Der Grund steht an jedem Eintrag der Rücknahme (Gate 2).
                const gruende = await wert<{ grund: string }>(
                    `SELECT DISTINCT changes -> 'restoreReason' ->> 'after' AS grund FROM map_audit_event WHERE operation_id = '${rueck.operationId}'`,
                );
                expect(gruende).toEqual([{ grund: "Falscher Lauf" }]);
                expect(Value.Check(MapHistoryEntry, rueckZeile)).toBe(true);

                // Nur einmal: Vorprüfung und Route sagen already_reverted; die Rücknahme selbst lässt sich zurücknehmen (B8e, eigener Test unten).
                expect((await vorpruefung(op, bob.cookie)).ergebnis).toBe("already_reverted");
                expect((await reiter(op, bob.cookie, { reason: "Nochmal" })).statusCode).toBe(409);
                const rueckVor = await vorpruefung(rueck.operationId, bob.cookie);
                expect(rueckVor.ergebnis).toBe("ok");
                expect(rueckVor.offen).toEqual([rueck.operationId]);
                // Der Filter der Liste folgt dem Zustand.
                const filter = async (status: "ruecknehmbar" | "nicht_ruecknehmbar" | "bereits_zurueckgenommen") =>
                    (
                        await mapChanges(cluster!.app, { mapDomainId: "aventuria", personId: bob.id, status })
                    ).entries.map((eintrag) => eintrag.operationId);
                expect(await filter("bereits_zurueckgenommen")).toContain(op);
                expect(await filter("ruecknehmbar")).toContain(rueck.operationId);
                expect(await filter("ruecknehmbar")).not.toContain(op);
            });

            it("🔴 Übernahme von Regelvorschlägen: ruecknehmbar, die Rücknahme läuft in der Anfrage (lore.rules_wikisync_undo) und die Übernahme steht danach als zurückgenommen da; Import und Testwelt bleiben quelle", async () => {
                const ada = await welt.jemand("admin", { frisch: true, passkey: true });
                const op = randomUUID();
                await admin()`
                    INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, summary, environment, actor_kind, actor_person_id)
                    VALUES (${op}, 'aventuria', decode(repeat('ab', 32), 'hex'),
                            ${admin().json({ operationId: op, status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] })},
                            'lore.rules_wikisync', 'wikisync', 'Regeln übernommen', 'test', 'person', ${ada.id})
                `;
                await admin()`INSERT INTO wikisync_regel_uebernahme (operation_id, actor_person_id, actor_label) VALUES (${op}, ${ada.id}, 'Ada')`;
                expect((await eintragVon(ada.id, op)).status).toBe("ruecknehmbar");
                expect((await vorpruefung(op, ada.cookie)).ergebnis).toBe("ok");
                const rueckId = randomUUID();
                const ok = await reiter(op, ada.cookie, { operationId: rueckId });
                expect(ok.statusCode, ok.body).toBe(200);
                expect(ok.json()).toMatchObject({ status: "applied", operationId: rueckId, reverts: [op] });
                const zeile = await eintragVon(ada.id, op);
                expect(zeile.status).toBe("bereits_zurueckgenommen");
                expect(zeile.revertedBy).toMatchObject({ operationId: rueckId });
                // Die Rücknahme der Regelvorschläge ist selbst rücknehmbar (B8e): ihre Gegenrichtung stellt die Übernahme wieder her.
                expect(await eintragVon(ada.id, rueckId)).toMatchObject({
                    operation: "lore.rules_wikisync_undo",
                    status: "ruecknehmbar",
                    reverts: [op],
                });
                // Wiederholung mit derselben Kennung: dieselbe Quittung; eine neue Kennung: schon zurückgenommen.
                expect((await reiter(op, ada.cookie, { operationId: rueckId })).json()).toMatchObject({
                    status: "replayed",
                });
                expect((await reiter(op, ada.cookie)).statusCode).toBe(409);
                // Import und Testwelt: eigene Wege.
                const importOp = randomUUID();
                await admin()`
                    INSERT INTO map_operation (operation_id, map_domain_id, action, source, environment, actor_kind, actor_label)
                    VALUES (${importOp}, 'aventuria', 'place.import', 'import', 'test', 'system', 'import')
                `;
                expect(await eintragVon(ada.id, importOp)).toMatchObject({
                    status: "nicht_ruecknehmbar",
                    statusReason: "quelle",
                });
                // Alles andere, was der WikiSync schreibt, ist keine Art, die „Änderungen“ zurücknimmt (eine Operation, die der Katalog nicht kennt; die Zuweisung einer Fläche ist seit B8e, ihre Rücknahme seit B8e2 rücknehmbar).
                const sync = randomUUID();
                await admin()`
                    INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind, actor_label)
                    VALUES (${sync}, 'aventuria', decode(repeat('ab', 32), 'hex'),
                            ${admin().json({ operationId: sync, status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] })},
                            'wikisync.region_zuweisen', 'wikisync', 'test', 'system', 'wikisync')
                `;
                expect(await eintragVon(ada.id, sync)).toMatchObject({
                    status: "nicht_ruecknehmbar",
                    statusReason: "art",
                });
            });

            it("🔴 B8e: die Rücknahme einer Rücknahme spielt die Werte der Übernahme wieder ein (Umkehrung aus dem Protokoll, derselbe Auftrag, Feld für Feld); die Übernahme gilt wieder; die Kette hält Zustand und Spalten richtig, auch eine Stufe tiefer", async () => {
                const ada = await welt.jemand("admin", { frisch: true, passkey: true });
                const { op } = await uebernommen(ada.id);
                const staende = (): Promise<{ k: string; d: string | null }[]> =>
                    wert(`SELECT wiki_key AS k, description AS d FROM wiki_powerline_snapshot ORDER BY wiki_key`);
                const nachUebernahme = await beschreibung(ID.a1);
                const wikiNachUebernahme = await staende();
                expect(nachUebernahme).not.toBe("Alte Beschreibung");
                const abraeumen = (): Promise<unknown> =>
                    admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
                /** Das ↺ auf eine Operation und der Auftrag dazu, bis er fertig ist; gibt die Operation der Rücknahme zurück. */
                const zuruecknehmenVon = async (id: string): Promise<string> => {
                    const antwort = await reiter(id, ada.cookie);
                    expect(antwort.statusCode, antwort.body).toBe(200);
                    const [job] = await wartend();
                    const ergebnis = (await runWikiZuruecknehmenJob(
                        kontext(job!.input_ref, { jobPublicId: job!.public_id }),
                        { environment: einsatz, mitDatenbank: mitJobs },
                    )) as { status: string; operationId: string | null };
                    await abraeumen();
                    expect(ergebnis.status).toBe("fertig");
                    return ergebnis.operationId!;
                };
                const zeile = (id: string) => eintragVon(ada.id, id);
                const durch = async (): Promise<(number | null)[]> =>
                    (
                        await wert<{ d: number | null }>(
                            `SELECT zurueckgenommen_durch::int AS d FROM wikisync_uebernahme WHERE status = 'fertig' AND operation_id IS NOT NULL ORDER BY id`,
                        )
                    ).map((eine) => eine.d);
                const ids = async (): Promise<number[]> =>
                    (
                        await wert<{ id: number }>(
                            `SELECT id::int AS id FROM wikisync_uebernahme WHERE status = 'fertig' AND operation_id IS NOT NULL ORDER BY id`,
                        )
                    ).map((eine) => eine.id);

                // R1: die Rücknahme der Übernahme. Ein Abschnitt wurde seither geändert und bleibt (Befund).
                await admin()`UPDATE powerline SET description = 'Später geändert' WHERE public_id = ${ID.a2}`;
                const r1 = await zuruecknehmenVon(op);
                expect(await beschreibung(ID.a1)).toBe("Alte Beschreibung");
                expect(await beschreibung(ID.a2)).toBe("Später geändert");
                expect((await zeile(op)).status).toBe("bereits_zurueckgenommen");
                expect(await zeile(r1)).toMatchObject({ status: "ruecknehmbar", reverts: [op] });
                const wikiNachR1 = await staende();
                expect(wikiNachR1).not.toEqual(wikiNachUebernahme);

                // R2: die Rücknahme der Rücknahme. Die Vorprüfung nennt die Operation, das Recht ist das der Verwaltung.
                const vor = await vorpruefung(r1, ada.cookie);
                expect(vor.ergebnis).toBe("ok");
                expect(vor.mitglieder[0]).toMatchObject({ operation: "wikisync.zuruecknehmen", offen: true });
                const r2 = await zuruecknehmenVon(r1);
                // Die Werte der Übernahme sind wieder da (Beschreibung und Wiki-Stand); der später geänderte Abschnitt blieb, wie er war.
                expect(await beschreibung(ID.a1)).toBe(nachUebernahme);
                expect(await beschreibung(ID.a2)).toBe("Später geändert");
                expect(await staende()).toEqual(wikiNachUebernahme);
                // Die Übernahme gilt wieder und ist wieder rücknehmbar, die Rücknahme ist zurückgenommen.
                expect(await zeile(op)).toMatchObject({ status: "ruecknehmbar" });
                expect((await zeile(op)).revertedBy).toBeUndefined();
                expect(await zeile(r1)).toMatchObject({
                    status: "bereits_zurueckgenommen",
                    revertedBy: { operationId: r2 },
                });
                expect(await zeile(r2)).toMatchObject({
                    status: "ruecknehmbar",
                    reverts: [r1],
                    operation: "wikisync.zuruecknehmen",
                });
                expect(Value.Check(MapHistoryEntry, await zeile(r2))).toBe(true);
                const [u, a, b] = await ids();
                expect(await durch()).toEqual([null, b, null]);
                expect([u, a, b].every((id) => typeof id === "number")).toBe(true);
                // Das Protokoll von R2 trägt dieselben Schlüssel mit Heute → Vorher (die Umkehrung), keinen Grund (eigene Übernahme).
                const schritte = await wert<{ c: Record<string, { before: unknown; after: unknown }> }>(
                    `SELECT changes AS c FROM map_audit_event WHERE operation_id = '${r2}' AND changes ? 'description'`,
                );
                expect(schritte[0]!.c["description"]).toEqual({ before: "Alte Beschreibung", after: nachUebernahme });

                // Eine Stufe tiefer: R3 nimmt R2 zurück; die Übernahme ist wieder zurückgenommen, R1 gilt wieder.
                const r3 = await zuruecknehmenVon(r2);
                expect(await beschreibung(ID.a1)).toBe("Alte Beschreibung");
                expect(await staende()).toEqual(wikiNachR1);
                expect((await zeile(op)).status).toBe("bereits_zurueckgenommen");
                expect((await zeile(r1)).status).toBe("ruecknehmbar");
                expect((await zeile(r2)).status).toBe("bereits_zurueckgenommen");
                expect(await zeile(r3)).toMatchObject({ status: "ruecknehmbar", reverts: [r2] });
                const ketten = await ids();
                expect(await durch()).toEqual([ketten[1]!, null, ketten[3]!, null]);

                // Und die Übernahme selbst lässt sich wieder zurücknehmen, wenn sie gilt: zurück auf R2, dann ↺ an der Übernahme.
                const r4 = await zuruecknehmenVon(r3);
                expect(await beschreibung(ID.a1)).toBe(nachUebernahme);
                expect((await zeile(op)).status).toBe("ruecknehmbar");
                const r5 = await zuruecknehmenVon(op);
                expect(await beschreibung(ID.a1)).toBe("Alte Beschreibung");
                expect((await zeile(op)).status).toBe("bereits_zurueckgenommen");
                expect(await zeile(op).then((eine) => eine.revertedBy?.operationId)).toBe(r5);
                expect(await zeile(r4)).toMatchObject({ status: "ruecknehmbar" });
            });

            it("🔴 B8e: weicht jedes Feld ab, wird nichts geschrieben (Befund, keine Operation); eine Rücknahme, die nichts schrieb, lässt die Übernahme zurückgenommen", async () => {
                const ada = await welt.jemand("admin", { frisch: true, passkey: true });
                const { op } = await uebernommen(ada.id);
                const abraeumen = (): Promise<unknown> =>
                    admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
                const lauf = async (id: string): Promise<{ status: string; operationId: string | null }> => {
                    expect((await reiter(id, ada.cookie)).statusCode).toBe(200);
                    const [job] = await wartend();
                    const ergebnis = (await runWikiZuruecknehmenJob(
                        kontext(job!.input_ref, { jobPublicId: job!.public_id }),
                        { environment: einsatz, mitDatenbank: mitJobs },
                    )) as { status: string; operationId: string | null };
                    await abraeumen();
                    return ergebnis;
                };
                const r1 = (await lauf(op)).operationId!;
                // Jemand setzt alle Abschnitte auf einen eigenen Wert: Die Rücknahme der Rücknahme findet kein Feld mehr, das sie zurückschreiben dürfte.
                await admin()`UPDATE powerline SET description = 'Eigener Wert', name = 'Eigener ' || name`;
                await admin()`
                    UPDATE wiki_powerline_snapshot
                       SET name = 'X ' || name, staerke = 'X', affinitaet = 'X', laenge = 'X', regionen = 'X', verlauf = 'X', description = 'X'
                `;
                const r2 = await lauf(r1);
                expect(r2).toMatchObject({ status: "fertig", operationId: null });
                expect(await beschreibung(ID.a1)).toBe("Eigener Wert");
                expect(
                    (await befunde()).filter((eine) => eine.befund === "seit_uebernahme_geaendert").length,
                ).toBeGreaterThan(0);
                // Nichts geschrieben: Die Übernahme bleibt zurückgenommen, die Rücknahme gilt.
                expect((await eintragVon(ada.id, op)).status).toBe("bereits_zurueckgenommen");
                expect((await eintragVon(ada.id, r1)).status).toBe("ruecknehmbar");
            });
        });
    },
);

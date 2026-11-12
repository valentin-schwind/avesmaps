import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIKISYNC_ANGESCHLOSSEN } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { filterMapChanges, type MapActor, type MapAuditEntry } from "../src/editor/map-operation.ts";
import { readEditorPeak, updatePeak } from "../src/editor/peak-update.ts";
import { areaIndex, INPUT_INDEX_VERSION, peakIndex, riverIndex } from "../src/terrain/domain/input-index.ts";
import { JobCancelled, JobStopped, type JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import {
    GRUND_WARTET_LEGACY_ZUG,
    runWikiUebernehmenJob,
    runWikiZuruecknehmenJob,
} from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import {
    ladeBekannteTitel,
    ladeLandmarkenAufDerKarte,
    ladeObjekte,
    ladeObjekteDesLaufs,
} from "../src/wiki/abgleich/lokal.ts";
import { GRUND_KEIN_WIKI_STAND } from "../src/wiki/abgleich/plan.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { leseWikisyncStand } from "../src/wiki/abgleich/stand.ts";
import { SCHREIBER } from "../src/wiki/abgleich/uebernahme/liste.ts";
import { ortSchreiber } from "../src/wiki/abgleich/uebernahme/ort.ts";
import { auditSchluessel, type FeldSchritt } from "../src/wiki/abgleich/uebernahme/schreiber.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import {
    DUMP,
    ID,
    legeGebieteAn,
    legeGipfelAn,
    legeKoschgipfelAn,
    legeLandschaftenAn,
    schreibeKategorienZurWelt,
    legeOrteAn,
    legeWegeAn,
    raeumeAb,
} from "./support/wikisync-welt.ts";

/**
 * Die Übernahme und die Rücknahme des WikiSync für Orte, Wege, Gebiete, Landschaften (WI-0253 D-2) und Gipfel (Scheibe Gipfel) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter
 * `src/db/`) und das Testwiki aus `support/wiki-testserver.ts` für den Wiki-Teil. Die Jobs-Rolle schreibt, die Welt ist erfunden.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung; keiner fragt das Wiki Aventurica.
 *
 * - **Soll je Bereich:** wiki-eigene Felder übernehmen (wirksam, nur mit Vermerk „wiki“; der Wiki-Wert hinter ↺ immer), Eigenes, Unbekanntes und Zuordnungen unberührt, eine Operation der Quelle
 *   `wikisync`, die Ableitung nur, wo ein Wert in sie eingeht, der zweite Lauf ohne Änderung, die Rücknahme stellt alles her (auch die Marken „geraten“ und „unbekannt“).
 * - **Problemfälle:** der Name (leer, vergeben, nur ein Teil der Straße, Stätten am alten Namen, der Rahmen des Geländes), ein schlanker Wiki-Stand und eine weitere Zuweisung am Weg, eine
 *   Ortsgröße, die es nicht gibt, der Satz Einzelheiten ohne Feld (still gelegt und wieder belebt), die Rechte der Jobs-Rolle.
 */

const ENV = "wikisyncd2";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Der Rahmen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function kontext(
    input: Record<string, unknown>,
    optionen: { jobPublicId?: string; abbruch?: boolean } = {},
): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: optionen.jobPublicId ?? randomUUID(), leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => {
            if (optionen.abbruch === true) throw new JobCancelled();
        },
    };
}

describeWithCluster(
    "WikiSync D-2: Übernahme und Rücknahme für Orte, Wege, Gebiete und Landschaften (Wegwerf-Cluster)",
    () => {
        let cluster: VpsCluster | undefined;
        let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
        let umgebung: NodeJS.ProcessEnv;
        let ablage: VorschauAblage;

        const jobs = (): Database => cluster!.jobs;
        const admin = (): Database => cluster!.admin;
        const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
        const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());
        const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
        const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);
        const operationen = (): Promise<number> => zahl(`SELECT count(*)::int AS n FROM map_operation`);

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

        /** Ein Auftrag der Warteschlange, den eine Person ausgelöst hat (über die Einreihungsfunktion der App-Rolle, wie die Route). */
        async function auftragVon(personId: string | null, kind = "wiki_uebernehmen"): Promise<string> {
            const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue(${kind}, 1::smallint, 'aventuria', ${personId ?? "cli:test"}, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
            await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
            return job!.public_id;
        }

        type Ergebnis = {
            bereiche: {
                bereich: string;
                status: string;
                grund?: string;
                operationId?: string | null;
                zahlen?: Record<string, number>;
                uebernahme: number | null;
            }[];
        };
        async function uebernehmen(
            bereiche: readonly string[],
            optionen: { jobPublicId?: string; abbruch?: boolean; lauf?: number } = {},
        ): Promise<Ergebnis> {
            return (await runWikiUebernehmenJob(
                kontext(optionen.lauf === undefined ? { bereiche } : { bereiche, lauf: optionen.lauf }, optionen),
                { environment: einsatz, mitDatenbank: mitJobs },
            )) as never;
        }

        async function zuruecknehmen(
            bereich: string,
            lauf: number,
            uebernahme: number,
        ): Promise<{ status: string; zahlen: Record<string, number>; operationId: string | null }> {
            return (await runWikiZuruecknehmenJob(
                kontext({ bereich, lauf, uebernahme }, { jobPublicId: await auftragVon(null, "wiki_zuruecknehmen") }),
                { environment: einsatz, mitDatenbank: mitJobs },
            )) as never;
        }

        const befunde = (): Promise<{ objekt_id: string; feld: string | null; befund: string; grund: string }[]> =>
            wert(`SELECT objekt_id::text, feld, befund, grund FROM wikisync_uebernahme_befund ORDER BY id`);

        const jobsDerAbleitung = async (): Promise<string[]> =>
            (
                await wert<{ kind: string }>(
                    `SELECT kind FROM job WHERE state = 'QUEUED' AND kind NOT LIKE 'wiki\\_%' ORDER BY kind`,
                )
            ).map((zeile) => zeile.kind);

        async function neueWelt(bau: (db: Database) => Promise<void>): Promise<void> {
            await raeumeAb(admin());
            await bau(admin());
        }

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, VORLAGEN);
            await seedMapDomains(cluster.migrator);
            ordner = await neuerOrdner("wikisync-d2");
            await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
            // Die Kategorien-Datei dazu (Ortsgröße, Kontinent; WI-0294): Die Vorschau liest sie neben dem Dump.
            await schreibeKategorienZurWelt(ordner.pfad);
            umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
            const j = cluster.jobs;
            ablage = {
                ladeObjekte: (bereiche) => ladeObjekteDesLaufs(j, bereiche),
                ladeBekannteTitel: () => ladeBekannteTitel(j),
                ladeLandmarkenAufDerKarte: () => ladeLandmarkenAufDerKarte(j),
                ladeWikisyncBereiche: () => wikisyncBereiche(j),
                schreibe: (eingabe) => schreibeLauf(j, eingabe),
                schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(j, eingabe, fehler),
                ausloeser: () => Promise.resolve("jobs-cli"),
            };
        }, 240_000);
        afterAll(async () => {
            await ordner?.weg();
            await cluster?.stop();
        }, 60_000);

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Katalog
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        it("🔴 Katalog: Orte, Wege, Gebiete, Landschaften, Gipfel, Kraftlinien, Literatur und Quellen sind angeschlossen; jeder Schlüssel, den ein Schreiber ins Fachprotokoll schreibt, steht in der Positivliste", () => {
            expect(Object.keys(SCHREIBER).sort()).toEqual([...WIKISYNC_ANGESCHLOSSEN].sort());
            expect([...WIKISYNC_ANGESCHLOSSEN].sort()).toEqual([
                "gebiet",
                "gipfel",
                "kraftlinie",
                "literatur",
                "ort",
                "quelle",
                "region",
                "sprachen",
                "vorkommen",
                "weg",
            ]);
            for (const schreiber of Object.values(SCHREIBER)) {
                const schluessel = [
                    ...Object.keys(schreiber.wirksameSpalten).map((feld) =>
                        auditSchluessel(feld, "wirksam", schreiber.auditNamen),
                    ),
                    ...Object.keys(schreiber.schnappschussSpalten).map((feld) =>
                        auditSchluessel(feld, "schnappschuss"),
                    ),
                    ...[...(schreiber.unbekanntFelder ?? [])].map((feld) => auditSchluessel(feld, "unbekannt")),
                ];
                const eintrag: MapAuditEntry = {
                    action: `${schreiber.protokollArt}.wikisync_uebernommen`,
                    changes: Object.fromEntries(schluessel.map((name) => [name, { before: null, after: null }])),
                };
                // Wirft in Tests, wenn ein Schlüssel nicht in `MAP_AUDIT_FIELDS` steht.
                expect(
                    Object.keys(filterMapChanges(eintrag.action, eintrag.changes)).sort(),
                    schreiber.bereich,
                ).toEqual([...new Set(schluessel)].sort());
            }
        });

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Orte
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        describe("Orte", () => {
            it("🔴 Übernahme: Name, Ortsgröße und Einzelheiten folgen dem Wiki, wo der Vermerk es sagt; der Wiki-Wert hinter ↺ immer; Eigenes und Unbekanntes bleibt; die Marke „geraten“ fällt", async () => {
                await neueWelt(legeOrteAn);
                const laufId = await vorschau(["ort"]);
                const ergebnis = await uebernehmen(["ort"]);
                expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
                expect(ergebnis.bereiche[0]!.zahlen!["felder"]).toBeGreaterThan(0);

                // Gareth: der Name folgt dem Wiki, die Ortsgröße (aus der Kategorie) ebenso, die Einwohner ebenso; die Lage ist eine eigene Entscheidung.
                const [gareth] = await wert<{
                    name: string;
                    subtype: string;
                    einwohner: string;
                    einwohner_origin: string;
                    lage: string;
                    lage_origin: string;
                }>(
                    `SELECT p.name, p.subtype, d.einwohner, d.einwohner_origin, d.lage, d.lage_origin FROM place p JOIN place_detail d ON d.place_id = p.id WHERE p.public_id = '${ID.gareth}'`,
                );
                expect(gareth).toEqual({
                    name: "Gareth",
                    subtype: "metropole",
                    einwohner: "7.400",
                    einwohner_origin: "wiki",
                    lage: "Mittelreich",
                    lage_origin: "manual",
                });
                // Der Wiki-Wert hinter ↺ ist der von heute; die Ortsgröße ist nicht mehr geraten; das Oberhaupt (kein eigener Wert) steht nur hier.
                const [stand] = await wert<Record<string, string | boolean | null>>(
                    `SELECT wiki_name, einwohner, oberhaupt, region_text, staat_text, settlement_class, settlement_class_guessed, description FROM wiki_settlement_snapshot WHERE wiki_key = 'gareth'`,
                );
                expect(stand).toMatchObject({
                    wiki_name: "Gareth",
                    einwohner: "7.400",
                    oberhaupt: "Kaiserin Rohaja",
                    region_text: "Garetien",
                    staat_text: "Mittelreich",
                    settlement_class: "metropole",
                    settlement_class_guessed: false,
                    description: "Gareth ist die Hauptstadt.",
                });
                // Havena: Der Name hat keinen Vermerk (unbekannt), die Ortsgröße ist eine eigene Entscheidung – beides bleibt; der Wiki-Wert ist neu.
                const [havena] = await wert<{ name: string; subtype: string }>(
                    `SELECT name, subtype FROM place WHERE public_id = '${ID.havena}'`,
                );
                expect(havena).toEqual({ name: "Havena", subtype: "stadt" });
                expect(
                    (
                        await wert<{ settlement_class: string; einwohner: string }>(
                            `SELECT settlement_class, einwohner FROM wiki_settlement_snapshot WHERE wiki_key = 'havena'`,
                        )
                    )[0],
                ).toEqual({ settlement_class: "grossstadt", einwohner: "9.000" });
                // Fasar: kein eigener Wert, nur der Wiki-Stand (das Feld bleibt leer: leer heißt „folgt dem Wiki“).
                expect(
                    await zahl(
                        `SELECT count(*)::int AS n FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.fasar}'`,
                    ),
                ).toBe(0);
                expect(
                    (
                        await wert<{ einwohner: string }>(
                            `SELECT einwohner FROM wiki_settlement_snapshot WHERE wiki_key = 'fasar'`,
                        )
                    )[0]!.einwohner,
                ).toBe("12.000");
                // Selem hat nur eine Adresse, keinen Wiki-Stand: Es wird keiner angelegt (eine Zuordnung ändert die Übernahme nie).
                expect(await zahl(`SELECT count(*)::int AS n FROM wiki_settlement_snapshot`)).toBe(6);
                expect(
                    await zahl(
                        `SELECT count(*)::int AS n FROM place_wiki_assignment WHERE assignment_state = 'address_only'`,
                    ),
                ).toBe(1);
                // Die Herkunft von Name und Ortsgröße wird nur gelesen.
                expect(await zahl(`SELECT count(*)::int AS n FROM field_origin`)).toBe(5);

                // Der Name wird nicht auf einen vergebenen Namen gesetzt; eine Stätte am alten Namen hält ihn fest; der Wiki-Wert ist trotzdem geschrieben.
                expect(
                    (await wert<{ name: string }>(`SELECT name FROM place WHERE public_id = '${ID.altHavena}'`))[0]!
                        .name,
                ).toBe("Alt-Hav");
                expect(
                    (await wert<{ name: string }>(`SELECT name FROM place WHERE public_id = '${ID.tempelort}'`))[0]!
                        .name,
                ).toBe("Tempelort");
                expect(
                    (
                        await wert<{ wiki_name: string }>(
                            `SELECT wiki_name FROM wiki_settlement_snapshot WHERE wiki_key = 'tempelhain'`,
                        )
                    )[0]!.wiki_name,
                ).toBe("Tempelhain");
                const alle = await befunde();
                expect(alle).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ objekt_id: ID.altHavena, feld: "name", befund: "name_vergeben" }),
                        expect.objectContaining({ objekt_id: ID.tempelort, feld: "name", befund: "name_gesperrt" }),
                    ]),
                );

                // Ludoo: Das Wiki nennt die Einwohner nicht mehr; der Satz hatte nur dieses Feld und legt sich still.
                const [ludoo] = await wert<{
                    einwohner: string | null;
                    einwohner_origin: string | null;
                    is_active: boolean;
                    retired_origin: string | null;
                }>(
                    `SELECT d.einwohner, d.einwohner_origin, d.is_active, d.retired_origin FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.ludoo}'`,
                );
                expect(ludoo).toEqual({
                    einwohner: null,
                    einwohner_origin: null,
                    is_active: false,
                    retired_origin: "editor",
                });

                // Eine Operation an der Karte aus der Quelle wikisync; je Ort ein Eintrag mit den Stellen, die sich änderten; Ortsgröße unter ihrem Namen im Fachprotokoll.
                const [operation] = await wert<{ source: string; action: string }>(
                    `SELECT source, action FROM map_operation`,
                );
                expect(operation).toEqual({ source: "wikisync", action: "wikisync.uebernehmen" });
                const [eintrag] = await wert<{
                    action: string;
                    changes: Record<string, { before: unknown; after: unknown }>;
                }>(`SELECT action, changes FROM map_audit_event WHERE place_public_id = '${ID.gareth}'`);
                expect(eintrag!.action).toBe("place.wikisync_uebernommen");
                expect(eintrag!.changes).toMatchObject({
                    name: { before: "Gareht", after: "Gareth" },
                    subtype: { before: "dorf", after: "metropole" },
                    einwohner: { before: "7.000", after: "7.400" },
                    wikiSettlementClass: { before: "dorf", after: "metropole" },
                    wikiSettlementClassUnbekannt: { before: true, after: false },
                });
                // Name und Ortsgröße lösen keinen Auftrag aus.
                expect(await jobsDerAbleitung()).toEqual([]);
                void laufId;
            });

            it("🔴 Der zweite Lauf ändert nichts; die Rücknahme stellt alles her, auch die Marke „geraten“ und den stillgelegten Satz; nur einmal", async () => {
                await neueWelt(legeOrteAn);
                const laufId = await vorschau(["ort"]);
                const vorher = await wert<Record<string, unknown>>(
                    `SELECT p.public_id::text, p.name, p.subtype, d.einwohner, d.einwohner_origin, d.is_active FROM place p LEFT JOIN place_detail d ON d.place_id = p.id ORDER BY p.public_id`,
                );
                const standVorher = await wert<Record<string, unknown>>(
                    `SELECT wiki_key, wiki_name, einwohner, oberhaupt, region_text, staat_text, settlement_class, settlement_class_guessed, description FROM wiki_settlement_snapshot ORDER BY wiki_key`,
                );
                const erste = await uebernehmen(["ort"]);
                const uebernahmeId = erste.bereiche[0]!.uebernahme!;
                expect(await wert(`SELECT p.name FROM place p WHERE p.public_id = '${ID.gareth}'`)).toEqual([
                    { name: "Gareth" },
                ]);

                // Zweiter Lauf: derselbe Dump, dieselbe Kategorie – nichts ist mehr zu übernehmen.
                const zweite = await vorschau(["ort"]);
                const operationen = await zahl(`SELECT count(*)::int AS n FROM map_operation`);
                const noch = await uebernehmen(["ort"]);
                expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });
                expect(noch.bereiche[0]!.zahlen).toMatchObject({ felder: 0, objekte: 0 });
                expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(operationen);
                void zweite;

                // Zurück.
                const rueck = await zuruecknehmen("ort", laufId, uebernahmeId);
                expect(rueck.status).toBe("fertig");
                expect(
                    await wert<Record<string, unknown>>(
                        `SELECT p.public_id::text, p.name, p.subtype, d.einwohner, d.einwohner_origin, d.is_active FROM place p LEFT JOIN place_detail d ON d.place_id = p.id ORDER BY p.public_id`,
                    ),
                ).toEqual(vorher);
                expect(
                    await wert<Record<string, unknown>>(
                        `SELECT wiki_key, wiki_name, einwohner, oberhaupt, region_text, staat_text, settlement_class, settlement_class_guessed, description FROM wiki_settlement_snapshot ORDER BY wiki_key`,
                    ),
                ).toEqual(standVorher);
                // Die Marke „geraten“ ist zurück; Ludoos Satz lebt wieder, mit Herkunft.
                expect(
                    (
                        await wert<{ settlement_class_guessed: boolean }>(
                            `SELECT settlement_class_guessed FROM wiki_settlement_snapshot WHERE wiki_key = 'gareth'`,
                        )
                    )[0]!.settlement_class_guessed,
                ).toBe(true);
                expect(
                    (
                        await wert<{
                            einwohner: string;
                            einwohner_origin: string;
                            is_active: boolean;
                            retired_at: Date | null;
                        }>(
                            `SELECT d.einwohner, d.einwohner_origin, d.is_active, d.retired_at FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.ludoo}'`,
                        )
                    )[0],
                ).toEqual({ einwohner: "100", einwohner_origin: "wiki", is_active: true, retired_at: null });
                await expect(zuruecknehmen("ort", laufId, uebernahmeId)).rejects.toMatchObject({
                    code: "schon_zurueckgenommen",
                });
            });

            it("🔴 Ein Wert, den seit der Vorschau jemand änderte, wird nicht überschrieben; eine Ortsgröße, die es nicht gibt, wird nirgends geschrieben", async () => {
                await neueWelt(legeOrteAn);
                await vorschau(["ort"]);
                // Nach der Vorschau ändert ein Editor die Einwohner von Gareth (und damit den Vermerk).
                await admin()`UPDATE place_detail SET einwohner = 'Editor-Zahl', einwohner_origin = 'manual' WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth})`;
                await uebernehmen(["ort"]);
                expect(
                    (
                        await wert<{ einwohner: string }>(
                            `SELECT d.einwohner FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.gareth}'`,
                        )
                    )[0]!.einwohner,
                ).toBe("Editor-Zahl");
                expect(await befunde()).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            objekt_id: ID.gareth,
                            feld: "einwohner",
                            befund: "seit_vorschau_geaendert",
                        }),
                    ]),
                );

                // Die Prüfung des Schreibers allein: eine Ortsgröße „riesenstadt“ fällt mit Befund, der Name wird nie geleert.
                const objekt = (await ladeObjekte(jobs(), ["ort"])).find((o) => o.id === ID.gareth)!;
                const schritte: FeldSchritt[] = [
                    {
                        objekt,
                        feld: "settlement_class",
                        wirksam: { vorher: "dorf", nachher: "riesenstadt" },
                        schnappschuss: { vorher: "dorf", nachher: "riesenstadt" },
                    },
                    {
                        objekt,
                        feld: "name",
                        wirksam: { vorher: "Gareth", nachher: "  " },
                        schnappschuss: { vorher: "Gareth", nachher: null },
                    },
                ];
                const geprueft = await jobs().begin((tx) => ortSchreiber.pruefe(tx, schritte));
                expect(geprueft.befunde.map((b) => b.befund).sort()).toEqual(["name_leer", "wert_unzulaessig"]);
                // Von der Ortsgröße bleibt nichts; vom Namen nur der Wiki-Wert.
                expect(geprueft.schritte).toEqual([
                    { objekt, feld: "name", schnappschuss: { vorher: "Gareth", nachher: null } },
                ]);
            });
        });

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Wege
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        describe("Wege", () => {
            const nameVon = async (id: string): Promise<string> =>
                (await wert<{ name: string }>(`SELECT name FROM path WHERE public_id = '${id}'`))[0]!.name;
            const standVon = async (schluessel: string): Promise<Record<string, string | boolean | null>> =>
                (
                    await wert<Record<string, string | boolean | null>>(
                        `SELECT name, kind, art, lage, laenge, verlauf, description, is_lean FROM wiki_path_snapshot WHERE wiki_key = '${schluessel}'`,
                    )
                )[0]!;

            it("🔴 Übernahme: Der Name der ganzen Straße folgt dem Wiki, nie nur ein Teil, nie auf eine andere Straße; der Wiki-Wert hinter ↺; eine weitere Zuweisung und ein schlanker Wiki-Stand bleiben; die Wegnamen auf der Karte rechnen neu", async () => {
                await neueWelt((db) => legeWegeAn(db));
                await vorschau(["weg"]);
                const ergebnis = await uebernehmen(["weg"]);
                expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });

                // Die ganze Straße A ist umbenannt; der Wiki-Wert hinter ↺ ist der von heute.
                for (const id of [ID.altA1, ID.altA2, ID.altA3]) expect(await nameVon(id)).toBe("Reichsstraße 1");
                expect(await standVon("reichsstrasse-1")).toMatchObject({
                    name: "Reichsstraße 1",
                    kind: "strasse",
                    art: "Reichsstraße",
                    lage: "Garetien",
                    laenge: "120 Meilen",
                    verlauf: "Gareth → Havena",
                    description: "Die erste Reichsstraße.",
                    is_lean: false,
                });
                // Straße B hat zwei Abschnitte, nur einer hängt am Artikel: Der Name bleibt, der Wiki-Wert ist geschrieben.
                expect(await nameVon(ID.mitteQ1)).toBe("Mittelpfad-alt");
                expect(await nameVon(ID.mitteQ2)).toBe("Mittelpfad-alt");
                expect((await standVon("mittelpfad"))["name"]).toBe("Mittelpfad");
                // Straße C würde „Mittelweg“ heißen, den eine andere Straße trägt (das verschmölze beide).
                expect(await nameVon(ID.neuR1)).toBe("Neuer Weg alt");
                expect(await nameVon(ID.mittelweg)).toBe("Mittelweg");
                expect((await standVon("neuer-weg"))["name"]).toBe("Mittelweg");
                // Der Zweite Weg heißt jetzt so; sein schlanker Artikel als weitere Zuweisung bleibt, wie er ist.
                expect(await nameVon(ID.zwei)).toBe("Zweiter Weg");
                expect(await standVon("weiterer-weg")).toMatchObject({
                    is_lean: true,
                    lage: null,
                    laenge: null,
                    description: null,
                });
                const alle = await befunde();
                expect(alle).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            objekt_id: ID.mitteQ1,
                            feld: "name",
                            befund: "linie_unvollstaendig",
                        }),
                        expect.objectContaining({ objekt_id: ID.neuR1, feld: "name", befund: "name_vergeben" }),
                        expect.objectContaining({ objekt_id: ID.zwei, befund: "weitere_zuweisung" }),
                    ]),
                );
                // Der Name geht in die Wegnamen auf der Karte und das Wegprofil ein: Die Ableitung ist eingereiht (ein Profil, ein Lauf je Kette).
                const abgeleitet = await jobsDerAbleitung();
                expect(abgeleitet).toContain("path_profile");
                expect(abgeleitet.filter((art) => art === "path_label_runs").length).toBeGreaterThanOrEqual(2);
                // Eine Operation der Quelle wikisync; der Eintrag je Abschnitt trägt den Namen vorher und nachher.
                const [eintrag] = await wert<{
                    action: string;
                    changes: Record<string, { before: unknown; after: unknown }>;
                }>(`SELECT action, changes FROM map_audit_event WHERE path_public_id = '${ID.altA1}'`);
                expect(eintrag!.action).toBe("path.wikisync_uebernommen");
                expect(eintrag!.changes).toMatchObject({
                    name: { before: "Alte Reichsstrasse", after: "Reichsstraße 1" },
                    wikiLaenge: { before: "100 Meilen", after: "120 Meilen" },
                });
            });

            it("🔴 Ändert sich nur der Wiki-Wert hinter ↺, löst die Übernahme keine Ableitung aus; der zweite Lauf ändert nichts; die Rücknahme stellt alles her", async () => {
                await neueWelt((db) => legeWegeAn(db, { nurSchnappschuss: true }));
                const laufId = await vorschau(["weg"]);
                const vorher = await wert<Record<string, unknown>>(
                    `SELECT name, kind, art, lage, laenge, verlauf, description, is_lean FROM wiki_path_snapshot ORDER BY wiki_key`,
                );
                const erste = await uebernehmen(["weg"]);
                const uebernahmeId = erste.bereiche[0]!.uebernahme!;
                expect(erste.bereiche[0]!.zahlen!["wirksam"]).toBe(0);
                expect(erste.bereiche[0]!.zahlen!["schnappschuss"]).toBeGreaterThan(0);
                expect(await jobsDerAbleitung()).toEqual([]);
                // Kein Vermerk, kein Namenswechsel: Die Namen sind unverändert.
                expect(await nameVon(ID.altA1)).toBe("Alte Reichsstrasse");

                await vorschau(["weg"]);
                const operationen = await zahl(`SELECT count(*)::int AS n FROM map_operation`);
                const noch = await uebernehmen(["weg"]);
                expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });
                expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(operationen);

                const rueck = await zuruecknehmen("weg", laufId, uebernahmeId);
                expect(rueck.status).toBe("fertig");
                expect(
                    await wert<Record<string, unknown>>(
                        `SELECT name, kind, art, lage, laenge, verlauf, description, is_lean FROM wiki_path_snapshot ORDER BY wiki_key`,
                    ),
                ).toEqual(vorher);
                // Auch die Rücknahme eines reinen Wiki-Werts löst keine Ableitung aus.
                expect(await jobsDerAbleitung()).toEqual([]);
            });

            it("🔴 Die Rücknahme gibt der Straße ihren Namen zurück, nur wo er noch der der Übernahme ist", async () => {
                await neueWelt((db) => legeWegeAn(db));
                const laufId = await vorschau(["weg"]);
                const erste = await uebernehmen(["weg"]);
                const uebernahmeId = erste.bereiche[0]!.uebernahme!;
                // Danach nennt ein Editor den Zweiten Weg anders.
                await admin()`UPDATE path SET name = 'Anderer Name' WHERE public_id = ${ID.zwei}`;
                const rueck = await zuruecknehmen("weg", laufId, uebernahmeId);
                expect(rueck.status).toBe("fertig");
                for (const id of [ID.altA1, ID.altA2, ID.altA3]) expect(await nameVon(id)).toBe("Alte Reichsstrasse");
                expect(await nameVon(ID.zwei)).toBe("Anderer Name");
                expect((await standVon("reichsstrasse-1"))["lage"]).toBe("Alt");
                expect(
                    (await befunde()).filter((b) => b.befund === "seit_uebernahme_geaendert").map((b) => b.objekt_id),
                ).toEqual([ID.zwei]);
            });
        });

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Gebiete
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        describe("Gebiete", () => {
            const detailVon = async (id: string): Promise<Record<string, string | boolean | null> | undefined> =>
                (
                    await wert<Record<string, string | boolean | null>>(
                        `SELECT d.ruler, d.form_of_government, d.continent, d.founder, d.state, d.is_active, d.retired_origin
                       FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = '${id}'`,
                    )
                )[0];
            const herkunftVon = async (id: string): Promise<Record<string, string>> =>
                Object.fromEntries(
                    (
                        await wert<{ field: string; origin: string }>(
                            `SELECT o.field, o.origin FROM territory_detail_field_origin o JOIN territory_detail d ON d.id = o.territory_detail_id
                           JOIN territory t ON t.id = d.territory_id WHERE t.public_id = '${id}'`,
                        )
                    ).map((zeile) => [zeile.field, zeile.origin]),
                );
            const unbekanntVon = async (schluessel: string): Promise<string[]> =>
                (
                    await wert<{ field: string }>(
                        `SELECT u.field FROM wiki_territory_snapshot_unknown u JOIN wiki_territory_snapshot s ON s.id = u.snapshot_id WHERE s.wiki_key = '${schluessel}' ORDER BY u.field`,
                    )
                ).map((zeile) => zeile.field);
            const snapshotVon = async (schluessel: string): Promise<Record<string, string | null>> =>
                (
                    await wert<Record<string, string | null>>(
                        `SELECT ruler, form_of_government, language, continent, founder FROM wiki_territory_snapshot WHERE wiki_key = '${schluessel}'`,
                    )
                )[0]!;

            it("🔴 Übernahme und Rücknahme: Felder mit Vermerk „wiki“ folgen, ein Override bleibt, die Marke „unbekannt“ fällt und kommt zurück, ein Satz ohne Feld legt sich still und lebt wieder auf", async () => {
                await neueWelt(legeGebieteAn);
                const laufId = await vorschau(["gebiet"]);
                const vorher = {
                    weiden: await detailVon(ID.weiden),
                    kosch: await detailVon(ID.kosch),
                    greifen: await detailVon(ID.greifen),
                    snapshots: [
                        await snapshotVon("wiki:herzogtum-weiden"),
                        await snapshotVon("wiki:kosch"),
                        await snapshotVon("wiki:greifenfurt"),
                    ],
                    unbekannt: await unbekanntVon("wiki:herzogtum-weiden"),
                    herkunft: [
                        await herkunftVon(ID.weiden),
                        await herkunftVon(ID.kosch),
                        await herkunftVon(ID.greifen),
                    ],
                };
                expect(vorher.unbekannt).toEqual(["form_of_government"]);
                const ergebnis = await uebernehmen(["gebiet"]);
                expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
                const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

                // Weiden: Der Herrscher folgt dem Wiki, die Herrschaftsform bleibt als Override; der Wiki-Wert hinter ↺ ist da, die Marke „unbekannt“ ist weg.
                expect(await detailVon(ID.weiden)).toMatchObject({
                    ruler: "Herzogin Neu",
                    form_of_government: "Herzogtum",
                });
                expect(await herkunftVon(ID.weiden)).toMatchObject({ ruler: "wiki", form_of_government: "override" });
                expect(await snapshotVon("wiki:herzogtum-weiden")).toMatchObject({
                    ruler: "Herzogin Neu",
                    form_of_government: "Herzogtum Neu",
                    language: "Garethi",
                    continent: "Aventurien",
                });
                expect(await unbekanntVon("wiki:herzogtum-weiden")).toEqual([]);
                // Kosch: Der Kontinent aus den Kategorien.
                expect(await detailVon(ID.kosch)).toMatchObject({ continent: "Aventurien" });
                expect((await snapshotVon("wiki:kosch"))["continent"]).toBe("Aventurien");
                // Greifenfurt: Das Wiki nennt den Gründer nicht mehr; der Satz hatte kein anderes Feld und legt sich still (ohne Vermerk).
                expect(await detailVon(ID.greifen)).toMatchObject({
                    founder: null,
                    is_active: false,
                    state: "retired",
                    retired_origin: "editor",
                });
                expect(await herkunftVon(ID.greifen)).toEqual({});
                // Detailfelder gehen in keine Ableitung ein.
                expect(await jobsDerAbleitung()).toEqual([]);
                const [eintrag] = await wert<{ changes: Record<string, { before: unknown; after: unknown }> }>(
                    `SELECT changes FROM map_audit_event WHERE territory_public_id = '${ID.weiden}'`,
                );
                expect(eintrag!.changes).toMatchObject({
                    ruler: { before: "Herzogin Alt", after: "Herzogin Neu" },
                    wikiFormOfGovernment: { before: null, after: "Herzogtum Neu" },
                    wikiFormOfGovernmentUnbekannt: { before: true, after: false },
                });

                // Der zweite Lauf ändert nichts.
                await vorschau(["gebiet"]);
                const noch = await uebernehmen(["gebiet"]);
                expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });

                // Die Rücknahme stellt alles her.
                const rueck = await zuruecknehmen("gebiet", laufId, uebernahmeId);
                expect(rueck.status).toBe("fertig");
                expect(await detailVon(ID.weiden)).toEqual(vorher.weiden);
                expect(await detailVon(ID.kosch)).toEqual(vorher.kosch);
                expect(await detailVon(ID.greifen)).toEqual(vorher.greifen);
                expect([
                    await snapshotVon("wiki:herzogtum-weiden"),
                    await snapshotVon("wiki:kosch"),
                    await snapshotVon("wiki:greifenfurt"),
                ]).toEqual(vorher.snapshots);
                expect(await unbekanntVon("wiki:herzogtum-weiden")).toEqual(vorher.unbekannt);
                expect([
                    await herkunftVon(ID.weiden),
                    await herkunftVon(ID.kosch),
                    await herkunftVon(ID.greifen),
                ]).toEqual(vorher.herkunft);
            });
        });

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Landschaften
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        describe("Landschaften", () => {
            const regionName = async (id: string): Promise<string> =>
                (await wert<{ name: string }>(`SELECT name FROM region WHERE public_id = '${id}'`))[0]!.name;
            const labels = async (): Promise<Record<string, { name: string; revision: number }>> =>
                Object.fromEntries(
                    (
                        await wert<{ id: string; name: string; revision: string }>(
                            `SELECT public_id::text AS id, name, revision::text AS revision FROM map_label ORDER BY public_id`,
                        )
                    ).map((zeile) => [zeile.id, { name: zeile.name, revision: Number(zeile.revision) }]),
                );
            const nachbarn = async (): Promise<string[]> =>
                (
                    await wert<{ direction: string; position: number; name: string }>(
                        `SELECT n.direction, n.position, n.name FROM wiki_region_snapshot_neighbor n JOIN wiki_region_snapshot s ON s.id = n.snapshot_id
                      WHERE s.wiki_key = 'koschberge' ORDER BY n.direction, n.position`,
                    )
                ).map((zeile) => `${zeile.direction}${String(zeile.position)}:${zeile.name}`);
            const standVon = async (): Promise<Record<string, string | null>> =>
                (
                    await wert<Record<string, string | null>>(
                        `SELECT name, art, continent FROM wiki_region_snapshot WHERE wiki_key = 'koschberge'`,
                    )
                )[0]!;

            it("🔴 Übernahme und Rücknahme: Der Name geht an die Beschriftungen, die ihm folgen (in einer Operation, mit Revision); die Art behält ihren Rest, die Nachbarn werden Zeilen; der Kontinent rahmt das Gelände", async () => {
                await neueWelt(legeLandschaftenAn);
                const laufId = await vorschau(["region"]);
                const vorher = { labels: await labels(), stand: await standVon(), nachbarn: await nachbarn() };
                expect(vorher.nachbarn).toEqual(["N0:Weiden", "O0:Alt1", "O1:Alt2"]);

                const ergebnis = await uebernehmen(["region"]);
                expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
                const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

                expect(await regionName(ID.koschberge)).toBe("Koschberge");
                const danach = await labels();
                expect(danach[ID.label1]).toMatchObject({ name: "Koschberge" });
                expect(danach[ID.label3]).toMatchObject({ name: "Koschberge" });
                // Der eigene Text bleibt.
                expect(danach[ID.label2]).toEqual(vorher.labels[ID.label2]);
                expect(danach[ID.label1]!.revision).toBeGreaterThan(vorher.labels[ID.label1]!.revision);
                expect(danach[ID.label2]!.revision).toBe(vorher.labels[ID.label2]!.revision);
                expect(await standVon()).toEqual({
                    name: "Koschberge",
                    art: "Hochland|Hochland-alt",
                    continent: "Aventurien",
                });
                expect(await nachbarn()).toEqual(["N0:Weiden", "O0:Neu1", "O1:Neu2", "S0:Süd1"]);
                // Der Kontinent, der das Gelände rahmt, behält seinen Namen; sein Wiki-Wert ist geschrieben.
                expect(await regionName(ID.rahmen)).toBe("Aventurien");
                expect(
                    (
                        await wert<{ name: string }>(
                            `SELECT name FROM wiki_region_snapshot WHERE wiki_key = 'aventurien'`,
                        )
                    )[0]!.name,
                ).toBe("Aventurien-Neu");
                expect(await befunde()).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ objekt_id: ID.rahmen, feld: "name", befund: "name_gesperrt" }),
                    ]),
                );
                // Die Schriftläufe der Landschaft rechnen neu; die Beschriftungen stehen als eigene Einträge im Fachprotokoll.
                expect(await jobsDerAbleitung()).toContain("label_runs");
                expect(
                    await zahl(
                        `SELECT count(*)::int AS n FROM map_audit_event WHERE action = 'label.renamed' AND map_label_public_id IS NOT NULL`,
                    ),
                ).toBe(2);

                // Der zweite Lauf ändert nichts.
                await vorschau(["region"]);
                const noch = await uebernehmen(["region"]);
                expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });

                // Die Rücknahme: Name, Beschriftungen (nur, wo der Text noch der der Übernahme ist), Art, Nachbarn, Kontinent.
                await admin()`UPDATE map_label SET name = 'Von Hand' WHERE public_id = ${ID.label3}`;
                const rueck = await zuruecknehmen("region", laufId, uebernahmeId);
                expect(rueck.status).toBe("fertig");
                expect(await regionName(ID.koschberge)).toBe("Koschberg");
                const zurueck = await labels();
                expect(zurueck[ID.label1]).toMatchObject({ name: "Koschberg" });
                expect(zurueck[ID.label3]).toMatchObject({ name: "Von Hand" });
                expect(await standVon()).toEqual(vorher.stand);
                expect(await nachbarn()).toEqual(vorher.nachbarn);
                expect(
                    (await befunde()).filter((b) => b.befund === "seit_uebernahme_geaendert").length,
                ).toBeGreaterThan(0);
            });
        });

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Gipfel und Vulkane
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        describe("Gipfel und Vulkane", () => {
            const redaktion: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
            const gipfelZeile = async (id: string): Promise<Record<string, unknown>> =>
                (
                    await wert<Record<string, unknown>>(
                        `SELECT name, subtype, height_schritt, show_name, revision::int AS revision, updated_at, ST_AsText(geom) AS geom, is_active
                           FROM terrain_peak WHERE public_id = '${id}'`,
                    )
                )[0]!;
            const standVon = async (schluessel: string): Promise<Record<string, string | number | null>> =>
                (
                    await wert<Record<string, string | number | null>>(
                        `SELECT name, art, region_parent, description, height_schritt FROM wiki_region_snapshot WHERE wiki_key = '${schluessel}'`,
                    )
                )[0]!;
            const nachbarnVon = async (schluessel: string): Promise<string[]> =>
                (
                    await wert<{ direction: string; position: number; name: string }>(
                        `SELECT n.direction, n.position, n.name FROM wiki_region_snapshot_neighbor n JOIN wiki_region_snapshot s ON s.id = n.snapshot_id
                          WHERE s.wiki_key = '${schluessel}' ORDER BY n.direction, n.position`,
                    )
                ).map((zeile) => `${zeile.direction}${String(zeile.position)}:${zeile.name}`);

            it("🔴 Übernahme und Rücknahme: Der Wiki-Stand des Artikels folgt dem Wiki (Art mit Rest, Nachbarn als Zeilen, die Höhe), am Gipfel ändert sich nur die Höhe; ohne Wiki-Stand ein Befund, schon in der Vorschau", async () => {
                await neueWelt(legeGipfelAn);
                const laufId = await vorschau(["gipfel"]);
                // Die Vorschau: Felder des Wiki-Stands übernehmen, die Höhe auch (ohne Vermerk folgt sie dem Wiki); die Nebelspitze (nur eine Adresse) ist ein Befund mit Grund, nie eine Übernahme.
                const zeilen = await wert<{
                    objekt_id: string;
                    feld: string | null;
                    wirkung: string;
                    grund: string | null;
                    alt: string | null;
                    neu: string | null;
                }>(
                    `SELECT objekt_id::text, feld, wirkung, grund, alt, neu FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND bereich = 'gipfel' ORDER BY id`,
                );
                expect(zeilen.filter((z) => z.objekt_id === ID.ingerimm).map((z) => [z.feld, z.wirkung])).toEqual([
                    ["name", "uebernommen"],
                    ["region_parent", "uebernommen"],
                    ["nachbar_n", "uebernommen"],
                    ["description", "uebernommen"],
                    ["height", "uebernommen"],
                ]);
                expect(zeilen.find((z) => z.objekt_id === ID.ingerimm && z.feld === "height")).toMatchObject({
                    alt: "700",
                    neu: "1100",
                });
                // Der Vulkan hat keine Höhe: Das Wiki nennt 2.000, die Übernahme füllt sie.
                expect(zeilen.find((z) => z.objekt_id === ID.rihutu && z.feld === "height")).toMatchObject({
                    alt: null,
                    neu: "2000",
                    wirkung: "uebernommen",
                });
                const nebel = zeilen.filter((z) => z.objekt_id === ID.nebel);
                expect(nebel.length).toBeGreaterThan(0);
                expect(nebel.every((z) => z.wirkung === "befund" && z.grund === GRUND_KEIN_WIKI_STAND)).toBe(true);

                const fest = (zeile: Record<string, unknown>): Record<string, unknown> => ({
                    name: zeile["name"],
                    subtype: zeile["subtype"],
                    show_name: zeile["show_name"],
                    geom: zeile["geom"],
                    is_active: zeile["is_active"],
                });
                const vorher = {
                    ingerimm: await gipfelZeile(ID.ingerimm),
                    rihutu: await gipfelZeile(ID.rihutu),
                    nebel: await gipfelZeile(ID.nebel),
                    stand: await standVon("ingerimmsberg"),
                    vulkan: await standVon("rihutu"),
                    nachbarn: await nachbarnVon("ingerimmsberg"),
                };
                const ergebnis = await uebernehmen(["gipfel"]);
                expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
                expect(ergebnis.bereiche[0]!.zahlen!["felder"]).toBeGreaterThan(0);
                const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

                expect(await standVon("ingerimmsberg")).toEqual({
                    name: "Ingerimmsberg",
                    // Die erste Komponente folgt dem Wiki, der Rest der Mehrwertigkeit bleibt.
                    art: "Berggipfel|Felsformation",
                    region_parent: "Ysilia",
                    description: "Der Ingerimmsberg ist ein Berg.",
                    height_schritt: 1100,
                });
                expect(await nachbarnVon("ingerimmsberg")).toEqual(["N0:Neu1"]);
                expect(await standVon("rihutu")).toEqual({
                    name: "Rihutu",
                    art: "Vulkan",
                    region_parent: "Maraskan",
                    description: "Ein Vulkan.",
                    height_schritt: 2000,
                });
                // Am Gipfel nur die Höhe (und mit ihr die Revision, die der Trigger zählt); Name, Art, Lage und Anzeige bleiben, die Nebelspitze ist unberührt.
                const nachher = { ingerimm: await gipfelZeile(ID.ingerimm), rihutu: await gipfelZeile(ID.rihutu) };
                expect(fest(nachher.ingerimm)).toEqual(fest(vorher.ingerimm));
                expect(nachher.ingerimm["height_schritt"]).toBe(1100);
                expect(nachher.ingerimm["revision"]).toBe((vorher.ingerimm["revision"] as number) + 1);
                expect(fest(nachher.rihutu)).toEqual(fest(vorher.rihutu));
                expect(nachher.rihutu["height_schritt"]).toBe(2000);
                expect(nachher.rihutu["revision"]).toBe((vorher.rihutu["revision"] as number) + 1);
                expect(await gipfelZeile(ID.nebel)).toEqual(vorher.nebel);
                expect(
                    await zahl(
                        `SELECT count(*)::int AS n FROM terrain_peak_wiki_assignment a JOIN terrain_peak tp ON tp.id = a.terrain_peak_id WHERE tp.public_id = '${ID.nebel}' AND a.snapshot_id IS NOT NULL`,
                    ),
                ).toBe(0);
                // Eine Übernahme macht die Höhe nicht zur eigenen: kein Vermerk.
                expect(await zahl(`SELECT count(*)::int AS n FROM field_origin WHERE object_kind = 'peak'`)).toBe(0);
                // Eine Operation der Quelle wikisync, ein Eintrag je Gipfel mit der Höhe vorher und nachher und dem Wiki-Wert.
                const [op] = await wert<{ source: string; action: string; operation_id: string }>(
                    `SELECT source, action, operation_id::text FROM map_operation ORDER BY seq DESC LIMIT 1`,
                );
                expect(op).toMatchObject({ source: "wikisync", action: "wikisync.uebernehmen" });
                const eintraege = await wert<{
                    gipfel: string;
                    changes: Record<string, { before: unknown; after: unknown }>;
                }>(
                    `SELECT peak_public_id::text AS gipfel, changes FROM map_audit_event WHERE operation_id = '${op!.operation_id}' AND action = 'peak.wikisync_uebernommen' ORDER BY peak_public_id`,
                );
                expect(eintraege).toHaveLength(2);
                const ingerimmEintrag = eintraege.find((eintrag) => eintrag.gipfel === ID.ingerimm)!;
                expect(ingerimmEintrag.changes["height"]).toEqual({ before: "700", after: "1100" });
                expect(ingerimmEintrag.changes["wikiHeight"]).toEqual({ before: null, after: "1100" });
                // Der zweite Lauf ändert nichts.
                await vorschau(["gipfel"]);
                const noch = await uebernehmen(["gipfel"]);
                expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });
                expect(await gipfelZeile(ID.ingerimm)).toEqual(nachher.ingerimm);
                expect(await operationen()).toBe(1);

                // Die Rücknahme stellt den Wiki-Stand und die Höhe her, nur wo sie noch die der Übernahme sind.
                await admin()`UPDATE wiki_region_snapshot SET description = 'Später von Hand' WHERE wiki_key = 'rihutu'`;
                const rueck = await zuruecknehmen("gipfel", laufId, uebernahmeId);
                expect(rueck.status).toBe("fertig");
                expect(await standVon("ingerimmsberg")).toEqual(vorher.stand);
                expect(await nachbarnVon("ingerimmsberg")).toEqual(vorher.nachbarn);
                expect(await standVon("rihutu")).toEqual({ ...vorher.vulkan, description: "Später von Hand" });
                expect(fest(await gipfelZeile(ID.ingerimm))).toEqual(fest(vorher.ingerimm));
                expect((await gipfelZeile(ID.ingerimm))["height_schritt"]).toBe(700);
                expect((await gipfelZeile(ID.rihutu))["height_schritt"]).toBeNull();
                expect(await befunde()).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            objekt_id: ID.rihutu,
                            feld: "description",
                            befund: "seit_uebernahme_geaendert",
                        }),
                    ]),
                );
            });

            it("🔴 Höhe: Eine Höhe, die eine Hand gesetzt hat, bleibt (Vermerk manual); ohne Vermerk folgt sie dem Wiki; nennt das Wiki keine, bleibt sie; der Editor schreibt den Vermerk nur beim Ändern der Höhe", async () => {
                await neueWelt(async (db) => {
                    await legeGipfelAn(db);
                    await legeLandschaftenAn(db);
                    await legeKoschgipfelAn(db);
                });
                // Die Redaktion setzt die Höhe im Gipfel-Fenster (`peak.update`): 720; das Wiki nennt 1.100.
                const stand = await readEditorPeak(cluster!.app, ID.ingerimm);
                await updatePeak(cluster!.app, redaktion, ID.ingerimm, {
                    operationId: randomUUID(),
                    baseRevision: stand!.revision,
                    changes: { height: 720 },
                });
                const vermerke = (): Promise<{ object_id: string; field: string; origin: string }[]> =>
                    wert(
                        `SELECT object_id::text, field, origin FROM field_origin WHERE object_kind = 'peak' ORDER BY object_id, field`,
                    );
                expect(await vermerke()).toEqual([{ object_id: ID.ingerimm, field: "height", origin: "manual" }]);
                const [protokoll] = await wert<{ changes: Record<string, { before: unknown; after: unknown }> }>(
                    `SELECT changes FROM map_audit_event WHERE action = 'peak.updated' AND peak_public_id = '${ID.ingerimm}'`,
                );
                expect(protokoll!.changes).toMatchObject({
                    height: { before: 700, after: 720 },
                    heightOrigin: { before: null, after: "manual" },
                });
                // Nur den Namen eines Gipfels zu ändern setzt keinen Vermerk: Die Höhe des Vulkans bleibt ohne.
                const vulkan = await readEditorPeak(cluster!.app, ID.rihutu);
                await updatePeak(cluster!.app, redaktion, ID.rihutu, {
                    operationId: randomUUID(),
                    baseRevision: vulkan!.revision,
                    changes: { name: "Rihutu der Zweite" },
                });
                expect(await vermerke()).toEqual([{ object_id: ID.ingerimm, field: "height", origin: "manual" }]);

                await vorschau(["region", "gipfel"]);
                const vorher = {
                    ingerimm: await gipfelZeile(ID.ingerimm),
                    koschgipfel: await gipfelZeile(ID.koschgipfel),
                };
                expect(vorher.ingerimm["height_schritt"]).toBe(720);
                const ergebnis = await uebernehmen(["region", "gipfel"]);
                expect(ergebnis.bereiche.map((b) => b.status)).toEqual(["fertig", "fertig"]);
                // Die eigene Höhe bleibt, samt Revision; der Wiki-Wert hinter ihr steht trotzdem im Stand.
                expect(await gipfelZeile(ID.ingerimm)).toEqual(vorher.ingerimm);
                expect(await standVon("ingerimmsberg")).toMatchObject({ height_schritt: 1100 });
                // Die Höhe des Vulkans ohne Vermerk folgt dem Wiki (leer → 2.000); der Koschgipfel teilt den Artikel der Koschberge, der keine Höhe nennt: Seine Höhe bleibt.
                expect(await gipfelZeile(ID.rihutu)).toMatchObject({ height_schritt: 2000 });
                expect(await gipfelZeile(ID.koschgipfel)).toEqual(vorher.koschgipfel);
                // Eine Höhe, die ein zweites Mal von Hand kommt, behält den Vermerk (keine neue Änderung des Vermerks).
                const jetzt = await readEditorPeak(cluster!.app, ID.ingerimm);
                await updatePeak(cluster!.app, redaktion, ID.ingerimm, {
                    operationId: randomUUID(),
                    baseRevision: jetzt!.revision,
                    changes: { height: 730 },
                });
                const letzte = await wert<{ changes: Record<string, unknown> }>(
                    `SELECT changes FROM map_audit_event WHERE action = 'peak.updated' AND peak_public_id = '${ID.ingerimm}' ORDER BY id DESC LIMIT 1`,
                );
                expect(letzte[0]!.changes).not.toHaveProperty("heightOrigin");
            });

            it("🔴 Gelände: Ändert die Übernahme eine Höhe, reiht sie das Gelände im Umkreis ein (terrain_local, dem Ruhe-Takt folgend, dann dem_publish); die Rücknahme führt zum Stand des Geländes zurück; ein Wiki-Wert allein löst nichts aus; die Jobs-Rolle darf am Gipfel nur die Höhe schreiben", async () => {
                await neueWelt(legeGipfelAn);
                // Der geltende Master des Geländes, mit dem Eingabeindex von heute (wie `gelaende-lokal-ausloeser.test.ts`).
                const m = cluster!.migrator;
                await m`DELETE FROM terrain_dem`;
                await m`DELETE FROM terrain_domain_raster WHERE fingerprint = 'master-wikisync'`;
                const eingabeIndex = async (): Promise<Record<string, unknown>> => ({
                    ...(await areaIndex(m, "aventuria")),
                    ...(await peakIndex(m, "aventuria")),
                    ...(await riverIndex(m, "aventuria")),
                });
                await m`
                    INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report, input_index)
                    VALUES ('aventuria', 'master-wikisync', 'eingaben-wikisync', '19', 4096, decode(repeat('0000', 4096 * 4096), 'hex'), '{}',
                            ${m.json({ v: INPUT_INDEX_VERSION, objects: await eingabeIndex() } as never)})
                `;
                await m`
                    INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
                    VALUES ('a0253a000001', 'aventuria', 'test', 512, 3, 'mapbox', 1, 1, true, 'master-wikisync')
                `;
                try {
                    const laufId = await vorschau(["gipfel"]);
                    const kette = (): Promise<{ kind: string; state: string }[]> =>
                        wert(
                            `SELECT kind, state FROM job WHERE kind IN ('terrain_local', 'dem_publish', 'routing_reload', 'display_heights') ORDER BY id`,
                        );
                    expect(await kette()).toEqual([]);
                    const ergebnis = await uebernehmen(["gipfel"]);
                    expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
                    // Zwei Höhen ändern sich (Ingerimmsberg 700 → 1.100, Rihutu leer → 2.000): EIN wartender Lauf für beide, dann das Veröffentlichen und was daran hängt.
                    expect(await kette()).toEqual([
                        { kind: "terrain_local", state: "QUEUED" },
                        { kind: "dem_publish", state: "QUEUED" },
                        { kind: "routing_reload", state: "QUEUED" },
                        { kind: "display_heights", state: "QUEUED" },
                    ]);
                    const [lokal] = await wert<{ scope_kind: string; scope_tiles: number[] }>(
                        `SELECT scope_kind, scope_tiles::int[] AS scope_tiles FROM job WHERE kind = 'terrain_local'`,
                    );
                    expect(lokal).toMatchObject({ scope_kind: "tiles" });
                    expect(lokal!.scope_tiles.length).toBeGreaterThan(0);
                    const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

                    // Die Rücknahme führt die Höhen zum Stand des Masters zurück: Es ist nichts Neues zu rechnen, der wartende Lauf liest beim Start den heutigen Stand.
                    const rueck = await zuruecknehmen("gipfel", laufId, uebernahmeId);
                    expect(rueck.status).toBe("fertig");
                    expect(await gipfelZeile(ID.ingerimm)).toMatchObject({ height_schritt: 700 });
                    expect((await kette()).filter((auftrag) => auftrag.kind === "terrain_local")).toHaveLength(1);

                    // Ein Wiki-Wert allein (die Höhe stimmt schon) löst nichts aus: zweite Welt, Wiki nennt dieselbe Höhe wie die Karte.
                    await admin()`DELETE FROM job`;
                    await admin()`UPDATE terrain_peak SET height_schritt = 1100 WHERE public_id = ${ID.ingerimm}::uuid`;
                    await admin()`UPDATE terrain_peak SET height_schritt = 2000 WHERE public_id = ${ID.rihutu}::uuid`;
                    await m`
                        UPDATE terrain_domain_raster SET input_index = ${m.json({ v: INPUT_INDEX_VERSION, objects: await eingabeIndex() } as never)}
                         WHERE fingerprint = 'master-wikisync'
                    `;
                    await vorschau(["gipfel"]);
                    const gleich = await uebernehmen(["gipfel"]);
                    expect(gleich.bereiche[0]).toMatchObject({ status: "fertig" });
                    expect(await kette()).toEqual([]);
                    // Nur der Wiki-Stand der übrigen Felder ändert sich; die Höhe stimmt schon, eine Zeile dafür gibt es nicht (der Wiki-Wert steht dort erst, wo die Übernahme eine Höhe schreibt).
                    expect(await standVon("ingerimmsberg")).toMatchObject({
                        name: "Ingerimmsberg",
                        height_schritt: null,
                    });

                    // Die Jobs-Rolle: am Gipfel nur die Höhe, am Stand die Textspalten und die Höhe; nie Vermerk, Zuordnung oder die Revision.
                    const c = cluster!;
                    const codes = await c.codesAs(c.jobs, [
                        "UPDATE terrain_peak SET name = name WHERE FALSE",
                        "UPDATE terrain_peak SET subtype = subtype WHERE FALSE",
                        "UPDATE terrain_peak SET revision = revision WHERE FALSE",
                        "UPDATE terrain_peak SET geom = geom WHERE FALSE",
                        "UPDATE terrain_peak SET show_name = show_name WHERE FALSE",
                        "UPDATE terrain_peak SET is_active = is_active WHERE FALSE",
                        "UPDATE terrain_peak_wiki_assignment SET snapshot_id = snapshot_id WHERE FALSE",
                        "UPDATE wiki_region_snapshot SET wiki_key = wiki_key WHERE FALSE",
                        "INSERT INTO field_origin (object_kind, object_id, field, origin) SELECT 'peak', gen_random_uuid(), 'height', 'manual' WHERE FALSE",
                        "UPDATE field_origin SET origin = origin WHERE FALSE",
                        "DELETE FROM terrain_peak",
                        "UPDATE terrain_peak SET height_schritt = height_schritt WHERE FALSE",
                        "UPDATE wiki_region_snapshot SET description = description, height_schritt = height_schritt WHERE FALSE",
                    ]);
                    expect(codes).toEqual([
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "42501",
                        "ok",
                        "ok",
                    ]);
                } finally {
                    await m`DELETE FROM terrain_dem`;
                    await m`DELETE FROM terrain_domain_raster WHERE fingerprint = 'master-wikisync'`;
                }
            });

            it("🔴 Teilt ein Gipfel den Artikel mit einer Landschaft, schreiben beide Bereiche denselben Wiki-Stand ohne Streit: Wer zweitens kommt, findet ihn geschrieben", async () => {
                await neueWelt(async (db) => {
                    await legeLandschaftenAn(db);
                    await legeKoschgipfelAn(db);
                });
                await vorschau(["region", "gipfel"]);
                const ergebnis = await uebernehmen(["region", "gipfel"]);
                expect(ergebnis.bereiche.map((b) => b.status)).toEqual(["fertig", "fertig"]);
                expect(
                    (
                        await wert<{ name: string; art: string }>(
                            `SELECT name, art FROM wiki_region_snapshot WHERE wiki_key = 'koschberge'`,
                        )
                    )[0],
                ).toEqual({ name: "Koschberge", art: "Hochland|Hochland-alt" });
                // Die Gipfel-Übernahme fand den Stand schon geschrieben: kein Befund zum geteilten Artikel, keine zweite Änderung. Die Zahlen des Bereichs enthalten auch die Kandidaten: Der Ingerimmsberg steht in dieser Welt nicht auf der Karte.
                expect((await befunde()).filter((b) => b.objekt_id === ID.koschgipfel)).toEqual([]);
                expect(
                    await zahl(
                        `SELECT count(*)::int AS n FROM map_audit_event WHERE peak_public_id = '${ID.koschgipfel}'`,
                    ),
                ).toBe(0);
                expect(await gipfelZeile(ID.koschgipfel)).toMatchObject({ name: "Koschgipfel", height_schritt: 2500 });
            });

            it("🔴 Läuft ein Legacy-Zug, wartet die Übernahme, statt zu scheitern: Sie gibt ihren Platz zurück, bevor sie etwas anlegt; hält der Zug die Karte erst mitten im Lauf, steht „wartet“ im Protokoll", async () => {
                await neueWelt(legeGipfelAn);
                await vorschau(["gipfel"]);
                // Ein Zug der Landschaften läuft (Claudios Abholer nahm ihn an der Warteschlange vorbei, nachdem die Übernahme schon lief).
                const [zug] = await admin()<{ public_id: string }[]>`
                    SELECT public_id::text AS public_id
                      FROM job_enqueue('legacy_zug', 1::smallint, 'aventuria', 'cli:test', '{"kategorie":"landschaften"}'::jsonb)
                `;
                await admin()`
                    UPDATE job SET state = 'RUNNING', lease_owner = 'abholer', lease_no = lease_no + 1,
                           lease_expires_at = now() + interval '10 minutes', heartbeat_at = now(), started_at = now()
                     WHERE public_id = ${zug!.public_id}::uuid
                `;
                await expect(uebernehmen(["gipfel"])).rejects.toBeInstanceOf(JobStopped);
                expect(await zahl(`SELECT count(*)::int AS n FROM wikisync_uebernahme`)).toBe(0);
                // Die Oberfläche sagt, worauf ein wartender Auftrag wartet (der Stand liest die Tafel als App-Rolle); ein Zug einer anderen Umgebung kommt aus dem Stand des Dirigenten.
                const [wartend] = await cluster!.app<{ public_id: string }[]>`
                    SELECT public_id::text AS public_id
                      FROM job_enqueue('wiki_uebernehmen', 1::smallint, 'aventuria', 'cli:test', '{"bereiche":["gipfel"]}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
                `;
                expect((await leseWikisyncStand(cluster!.app, new Date(), umgebung)).auftraege).toEqual([
                    expect.objectContaining({ art: "wiki_uebernehmen", zustand: "QUEUED", wartetAuf: "legacy_zug" }),
                ]);
                await admin()`DELETE FROM job WHERE public_id = ${zug!.public_id}::uuid`;
                expect((await leseWikisyncStand(cluster!.app, new Date(), umgebung)).auftraege[0]).not.toHaveProperty(
                    "wartetAuf",
                );
                expect(
                    (await leseWikisyncStand(cluster!.app, new Date(), umgebung, { zugAnderswo: true })).auftraege[0],
                ).toMatchObject({ wartetAuf: "legacy_zug" });
                await admin()`DELETE FROM job WHERE public_id = ${wartend!.public_id}::uuid`;

                // Der Zug hält die Kartendomäne exklusiv (wie `withZugSperre`), ohne dass ein Auftrag in der Tafel steht: Der Bereich rollt zurück, das Protokoll sagt „wartet“.
                const sperre = await admin().reserve();
                try {
                    await sperre`SELECT pg_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
                    await expect(uebernehmen(["gipfel"])).rejects.toBeInstanceOf(JobStopped);
                } finally {
                    await sperre`SELECT pg_advisory_unlock_all()`;
                    sperre.release();
                }
                expect(
                    await wert<{ status: string; grund: string }>(
                        `SELECT status, grund FROM wikisync_uebernahme ORDER BY id`,
                    ),
                ).toEqual([{ status: "abgebrochen", grund: GRUND_WARTET_LEGACY_ZUG }]);
                expect(await standVon("ingerimmsberg")).toMatchObject({ name: "Ingerimm alt" });
                // Danach läuft sie durch.
                expect((await uebernehmen(["gipfel"])).bereiche[0]).toMatchObject({ status: "fertig" });
                expect(await standVon("ingerimmsberg")).toMatchObject({ name: "Ingerimmsberg" });
            });
        });

        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
        // Rechte der Jobs-Rolle
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

        it("🔴 Rechte: Die Jobs-Rolle schreibt an Ort, Weg, Gebiet, Landschaft und Beschriftung nur, was der Editor der Art auch schreibt – keine Lage, keine Zuordnung, keine Herkunft von Name und Größe", async () => {
            const c = cluster!;
            const codes = await c.codesAs(c.jobs, [
                "UPDATE place SET name = name WHERE FALSE",
                "UPDATE place SET subtype = subtype WHERE FALSE",
                "UPDATE place SET geom = geom WHERE FALSE",
                "UPDATE place SET is_active = TRUE WHERE FALSE",
                "UPDATE place_detail SET einwohner = einwohner WHERE FALSE",
                "UPDATE place_detail SET description = description WHERE FALSE",
                "UPDATE place_wiki_assignment SET wiki_url = wiki_url WHERE FALSE",
                "UPDATE wiki_settlement_snapshot SET settlement_class_guessed = settlement_class_guessed WHERE FALSE",
                "UPDATE wiki_settlement_snapshot SET wiki_key = wiki_key WHERE FALSE",
                "UPDATE path SET name = name WHERE FALSE",
                "UPDATE path SET subtype = subtype WHERE FALSE",
                "UPDATE path SET geom = geom WHERE FALSE",
                "UPDATE wiki_path_snapshot SET lage = lage WHERE FALSE",
                "UPDATE wiki_path_snapshot SET is_lean = is_lean WHERE FALSE",
                "UPDATE territory SET revision = revision WHERE FALSE",
                "UPDATE territory SET name = name WHERE FALSE",
                "UPDATE territory_detail SET ruler = ruler WHERE FALSE",
                "UPDATE territory_detail SET territory_id = territory_id WHERE FALSE",
                "DELETE FROM territory_detail_field_origin WHERE FALSE",
                "UPDATE wiki_territory_snapshot SET continent = continent WHERE FALSE",
                "DELETE FROM wiki_territory_snapshot_unknown WHERE FALSE",
                "UPDATE region SET name = name WHERE FALSE",
                "UPDATE region SET region_type = region_type WHERE FALSE",
                "UPDATE map_label SET name = name WHERE FALSE",
                "UPDATE map_label SET geom = geom WHERE FALSE",
                "UPDATE wiki_region_snapshot SET art = art WHERE FALSE",
                "DELETE FROM wiki_region_snapshot_neighbor WHERE FALSE",
                "INSERT INTO field_origin (object_kind, object_id, field, origin) SELECT 'place', gen_random_uuid(), 'name', 'wiki' WHERE FALSE",
                "DELETE FROM place WHERE FALSE",
            ]);
            expect(codes).toEqual([
                "ok",
                "ok",
                "42501",
                "42501",
                "ok",
                "42501",
                "42501",
                "ok",
                "42501",
                "ok",
                "42501",
                "42501",
                "ok",
                "42501",
                "ok",
                "42501",
                "ok",
                "42501",
                "ok",
                "ok",
                "ok",
                "ok",
                "42501",
                "ok",
                "42501",
                "ok",
                "ok",
                "42501",
                "42501",
            ]);
        });
    },
);

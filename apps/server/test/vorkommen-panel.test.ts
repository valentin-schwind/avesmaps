import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    LORE_READING,
    ROUTE_STAGE_LORE_URL,
    ROUTE_UNTERWEGS_URL,
    type LoreRowView,
    type RouteStageLoreResponse,
    type RouteUnterwegsResponse,
    type SubjectLoreSection,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import {
    createSubjectService,
    UnterwegsZeitbudget,
    type DetailRequest,
    type SubjectService,
} from "../src/subjects/service.ts";
import { eintraegeAmPunkt, leereVorkommenSpeicher } from "../src/vorkommen/index.ts";

/**
 * Die Regeltreffer im Infopanel und in den Etappen (WI-0257, S2) gegen echtes PostGIS: Ein Eintrag, dessen Regel den Gegenstand trifft,
 * steht unter „Aus der Region“ (nie „Direkt von hier“), genau einmal, an Ort, Kartenpunkt, Landschaft, Gebiet, Gipfel, Weg und Etappe.
 * Dazu F2 (Vali 2026-10-29): Eine Ortszeile tritt hinter eine genauere Regel DERSELBEN Beziehung zurück, mit dem Schalter
 * `LORE_READING.ortszeileHinterRegel` in beiden Richtungen geprüft, und die Inhaltsschalter je Art an der Etappe.
 *
 * 🔴 **Die Welt** liegt in `[700, 800] × [100, 200]` (die Testdatenbank ist sonst leer) und trägt nur Dinge mit der Kennung `25702000-…`:
 * den Kontinent „Aventurien“ (das Ziel des Links), „Bornland“ (nördliche Hälfte), zwei Wälder (einer in, einer außerhalb von Bornland),
 * einen winzigen Wald (0,8 breit: er prüft den Abstand der Punkte entlang eines Weges) und eine Steppe in Bornland.
 *
 * Die Einträge (Name: Regel; Ortszeile):
 * - Baum: Wald in Aventurien; Kontinentzeile (F2: die Kontinentzeile tritt zurück, der Eintrag fällt aus „Überall in Aventurien“).
 * - Kraut: Steppe in Bornland; Zeile Bornland (F2: tritt zurück) und Zeile am Ort „Offen“ (bleibt).
 * - Doppelt: Wald in Bornland; Zeile am Wald 1 (Ortszeile und Regel treffen denselben Gegenstand: ein Eintrag, nicht zwei).
 * - Anders: Steppe in Bornland; Zeile Bornland in der Beziehung `regionen` (andere Beziehung als die Regel: tritt nicht zurück).
 * - Ohne: Wald in Aventurien ohne Wald in Bornland; Zeile Bornland (ein abgezogenes Glied ersetzt nichts).
 * - Herkunft: Wald in Bornland, Beziehung `herkunft`; keine Zeile (eine Regel gibt nie „Von hier“).
 * - Winzig: nur die Fläche des winzigen Waldes. Überall: nur die Kontinentzeile.
 *
 * Dazu für „Unterwegs“ (S4): ein Wald mit automatischem Namen („Wald-925“, ein Griff, in Bornland) und ein dritter Weg durch ihn.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MAP_DOMAIN = "aventuria";
const PREFIX = "25702000-0000-4000-8000-";
const uuid = (nummer: number): string => `${PREFIX}${String(nummer).padStart(12, "0")}`;
const KEY = "p257p-";
const rechteck = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

const REGIONEN: Record<string, { nummer: number; name: string; ebene: string; art: string; wkt: string }> = {
    kontinent: {
        nummer: 1,
        name: "P257P Aventurien",
        ebene: "derographisch",
        art: "kontinent",
        wkt: rechteck(700, 100, 800, 200),
    },
    bornland: {
        nummer: 2,
        name: "P257P Bornland",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(700, 150, 800, 200),
    },
    wald1: { nummer: 3, name: "P257P Wald 1", ebene: "vegetation", art: "wald", wkt: rechteck(710, 160, 730, 190) },
    wald2: { nummer: 4, name: "P257P Wald 2", ebene: "vegetation", art: "wald", wkt: rechteck(710, 110, 730, 130) },
    wald3: {
        nummer: 5,
        name: "P257P Wald 3 winzig",
        ebene: "vegetation",
        art: "wald",
        wkt: rechteck(740.2, 174.6, 741, 175.4),
    },
    steppe: { nummer: 6, name: "P257P Steppe", ebene: "vegetation", art: "steppe", wkt: rechteck(755, 160, 780, 190) },
    // Ein Wald, der nur einen Griff als Namen trägt: Er darf nie als Gegend eines Eintrags stehen (WI-0257 S4).
    griff: { nummer: 8, name: "Wald-925", ebene: "vegetation", art: "wald", wkt: rechteck(760, 192, 775, 198) },
    // Der Rahmen des Eintrags „Rahmen“: eine Landschaft und ein gleichnamiges Gebiet mit derselben Form, ohne Ort darin.
    insel: { nummer: 7, name: "P257P Insel", ebene: "derographisch", art: "region", wkt: rechteck(785, 105, 800, 115) },
};

const ORTE: Record<string, { nummer: number; name: string; x: number; y: number }> = {
    wald: { nummer: 201, name: "P257P Ort im Wald", x: 720, y: 175 },
    steppe: { nummer: 202, name: "P257P Ort in der Steppe", x: 765, y: 175 },
    offen: { nummer: 203, name: "P257P Ort Offen", x: 790, y: 120 },
};

const GIPFEL = uuid(210);
const GIPFEL_PUNKT = { x: 770, y: 170 };
const GEBIET = uuid(220);
const GEBIET_INSEL = uuid(221);
const WEG1 = uuid(230);
const WEG2 = uuid(231);
/** Läuft durch den Wald mit dem Griff als Namen, sonst nur durch Bornland und den Kontinent. */
const WEG3 = uuid(232);

describeWithDatabase("Regeltreffer im Infopanel und in den Etappen (WI-0257 S2) gegen PostGIS", () => {
    let database: Database;
    let service: SubjectService;
    let app: FastifyInstance | undefined;
    let restoreState: (() => Promise<void>) | undefined;
    const regionId: Record<string, string> = {};
    const ortId: Record<string, string> = {};
    const eintragId: Record<string, string> = {};
    const ortPublic = (name: string): string => uuid((ORTE[name] as { nummer: number }).nummer);
    let regelNummer = 0;

    interface Glied {
        op?: "und" | "oder" | "ohne";
        flaeche?: string;
        arten?: [string, string][];
    }

    async function legeEintrag(name: string, art: string): Promise<void> {
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_entry (wiki_key, kind, name, legacy_origin, source_system)
            VALUES (${KEY + name}, ${art}, ${"P257P " + name}, 'manual', 'test') RETURNING id::text AS id
        `;
        eintragId[name] = (zeile as { id: string }).id;
    }

    async function legeRegel(name: string, beziehung: string, glieder: Glied[]): Promise<void> {
        regelNummer += 1;
        const key = createHash("sha256")
            .update(`${name}|${beziehung}|${String(regelNummer)}`)
            .digest("hex");
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, source_system)
            VALUES (${eintragId[name] as string}, ${key}, ${beziehung}, ${regelNummer}, 'manual', 'test') RETURNING id::text AS id
        `;
        for (const [seq, glied] of glieder.entries()) {
            const [term] = await database<{ id: string }[]>`
                INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id)
                VALUES (${(zeile as { id: string }).id}, ${seq}, ${glied.op ?? "und"},
                        ${glied.flaeche === undefined ? null : (regionId[glied.flaeche] as string)})
                RETURNING id::text AS id
            `;
            for (const [ebene, art] of glied.arten ?? []) {
                await database`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${(term as { id: string }).id}, ${ebene}, ${art})`;
            }
        }
    }

    /** Eine Ortszeile mit genau einem Ziel (Landschaft oder Ort). */
    async function legeZeile(
        name: string,
        schluessel: string,
        beziehung: string,
        ziel: { region: string } | { ort: string },
        kontinent = false,
    ): Promise<void> {
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, legacy_origin, source_system)
            VALUES (${eintragId[name] as string}, ${schluessel}, ${beziehung}, ${schluessel}, 0, ${kontinent ? "continent" : "other"}, 'resolved', 1, 'manual', 'test')
            RETURNING id::text AS id
        `;
        const id = (zeile as { id: string }).id;
        if ("region" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, region_id) VALUES (${id}::bigint, ${regionId[ziel.region] as string}::bigint)`;
        } else {
            await database`INSERT INTO lore_place_target (lore_place_id, place_id) VALUES (${id}::bigint, ${ortId[ziel.ort] as string}::bigint)`;
        }
    }

    async function raeumeAuf(): Promise<void> {
        const meine = `lore_entry_id IN (SELECT id FROM lore_entry WHERE wiki_key LIKE '${KEY}%')`;
        await database.unsafe(
            `DELETE FROM lore_place_target WHERE lore_place_id IN (SELECT id FROM lore_place WHERE ${meine})`,
        );
        await database.unsafe(`DELETE FROM lore_place WHERE ${meine}`);
        await database.unsafe(
            `DELETE FROM lore_rule_term_type WHERE lore_rule_term_id IN (SELECT t.id FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id WHERE r.${meine})`,
        );
        await database.unsafe(
            `DELETE FROM lore_rule_term WHERE lore_rule_id IN (SELECT id FROM lore_rule WHERE ${meine})`,
        );
        await database.unsafe(`DELETE FROM lore_rule WHERE ${meine}`);
        await database.unsafe(`DELETE FROM lore_entry WHERE wiki_key LIKE '${KEY}%'`);
        await database.unsafe(`DELETE FROM wiki_key_assignment WHERE object_public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(
            `DELETE FROM territory_shape WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '${PREFIX}%')`,
        );
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM path WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM terrain_peak WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM region_area WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM region WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '${PREFIX}%'`);
        await database`DELETE FROM content_switch WHERE key = 'panel.lore.flora'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
        await raeumeAuf();
        const [fremd] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM region_area a WHERE a.is_active AND a.geom && ST_MakeEnvelope(690, 90, 810, 210, 0)
        `;
        expect(fremd?.n, "fremde Flächen in der Welt der Testdatei (die Testdatenbank ist nicht leer genug)").toBe(0);

        for (const [name, def] of Object.entries(REGIONEN)) {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (${uuid(def.nummer)}, ${MAP_DOMAIN}, ${def.name}, ${def.ebene}, ${def.art}, TRUE) RETURNING id::text AS id
            `;
            regionId[name] = (zeile as { id: string }).id;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${uuid(def.nummer + 100)}, ${MAP_DOMAIN}, ${regionId[name] as string}, ST_GeomFromText(${def.wkt}, 0), TRUE)
            `;
        }
        // Das Ziel des Links „Überall in Aventurien“: die Landschaft, die den Kontinentschlüssel trägt.
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('landschaft', ${uuid(1)}::uuid, 'wiki:aventurien')
        `;
        for (const [name, def] of Object.entries(ORTE)) {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${uuid(def.nummer)}, ${MAP_DOMAIN}, ${def.name}, 'dorf', ST_SetSRID(ST_MakePoint(${def.x}, ${def.y}), 0), 'test', TRUE)
                RETURNING id::text AS id
            `;
            ortId[name] = (zeile as { id: string }).id;
        }
        await database`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, is_active, source_system)
            VALUES (${GIPFEL}, ${MAP_DOMAIN}, 'P257P Gipfel', 'berggipfel', ST_SetSRID(ST_MakePoint(${GIPFEL_PUNKT.x}, ${GIPFEL_PUNKT.y}), 0), TRUE, 'test')
        `;
        // Zwei Wege: der erste läuft durch Wald 1, den winzigen Wald und die Steppe, der zweite berührt keine Fläche außer dem Kontinent.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${WEG1}, ${MAP_DOMAIN}, 'P257P Weg durch den Wald', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(700, 175), ST_MakePoint(790, 175)), 0), 'test', TRUE),
                   (${WEG2}, ${MAP_DOMAIN}, 'P257P Weg im Freien', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(700, 140), ST_MakePoint(790, 140)), 0), 'test', TRUE),
                   (${WEG3}, ${MAP_DOMAIN}, 'P257P Weg durch den Griffwald', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(755, 195), ST_MakePoint(780, 195)), 0), 'test', TRUE)
        `;
        // Das Gebiet: seine Form liegt im Wald 1 (Punkt der Form: 724/180).
        const [state] = await database<{ derived_revision: string | null; derived_year_bf: number | null }[]>`
            SELECT derived_revision, derived_year_bf FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        if (state === undefined) {
            await database`INSERT INTO territory_state (map_domain_id, derived_revision, derived_year_bf) VALUES (${MAP_DOMAIN}, '000000000257', 1040)`;
            restoreState = async () => {
                await database`DELETE FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN} AND derived_revision = '000000000257'`;
            };
        } else if (state.derived_revision === null || state.derived_year_bf === null) {
            await database`UPDATE territory_state SET derived_revision = '000000000257', derived_year_bf = 1040 WHERE map_domain_id = ${MAP_DOMAIN}`;
        }
        const [gebiet] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_key, is_active, source_system)
            VALUES (${GEBIET}, ${MAP_DOMAIN}, 'P257P Gebiet', '#B2B065', 0.7, NULL, TRUE, 'test') RETURNING id::text AS id
        `;
        await database.unsafe(
            `INSERT INTO territory_shape (band, territory_id, depth, source_count, area, geom, render_geom, label_geom)
             VALUES (8, $1, 0, 1, 1, ST_GeomFromText($2, 0), ST_SetSRID(ST_GeomFromText($2), 3857), ST_SetSRID(ST_MakePoint(724, 180), 0))`,
            [(gebiet as { id: string }).id, rechteck(712, 165, 736, 195)],
        );
        const [gebietInsel] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_key, is_active, source_system)
            VALUES (${GEBIET_INSEL}, ${MAP_DOMAIN}, 'P257P Gebiet Insel', '#B2B065', 0.7, NULL, TRUE, 'test') RETURNING id::text AS id
        `;
        await database.unsafe(
            `INSERT INTO territory_shape (band, territory_id, depth, source_count, area, geom, render_geom, label_geom)
             VALUES (8, $1, 0, 1, 1, ST_GeomFromText($2, 0), ST_SetSRID(ST_GeomFromText($2), 3857), ST_SetSRID(ST_MakePoint(792, 110), 0))`,
            [(gebietInsel as { id: string }).id, rechteck(785, 105, 800, 115)],
        );

        const wald: [string, string][] = [["vegetation", "wald"]];
        const steppe: [string, string][] = [["vegetation", "steppe"]];
        for (const [name, art] of [
            ["Baum", "flora"],
            ["Kraut", "flora"],
            ["Winzig", "flora"],
            ["Überall", "flora"],
            ["Doppelt", "fauna"],
            ["Anders", "spezies"],
            ["Ohne", "ware"],
            ["Herkunft", "ware"],
            ["Rahmen", "flora"],
        ] as const) {
            await legeEintrag(name, art);
        }
        await legeRegel("Baum", "verbreitung", [{ arten: wald, flaeche: "kontinent" }]);
        await legeRegel("Kraut", "verbreitung", [{ arten: steppe, flaeche: "bornland" }]);
        await legeRegel("Doppelt", "verbreitung", [{ arten: wald, flaeche: "bornland" }]);
        await legeRegel("Anders", "verbreitung", [{ arten: steppe, flaeche: "bornland" }]);
        // Eine Regel, die nirgends trifft (keine Tundra): „Rahmen“ steht allein über seine Zeile, die Landschaft UND Gebiet „Insel“ nennt.
        await legeRegel("Rahmen", "verbreitung", [{ arten: [["vegetation", "tundra"]], flaeche: "insel" }]);
        await legeRegel("Ohne", "verbreitung", [
            { arten: wald, flaeche: "kontinent" },
            { op: "ohne", arten: wald, flaeche: "bornland" },
        ]);
        await legeRegel("Herkunft", "herkunft", [{ arten: wald, flaeche: "bornland" }]);
        await legeRegel("Winzig", "verbreitung", [{ flaeche: "wald3" }]);

        await legeZeile("Baum", "aventurien", "verbreitung", { region: "kontinent" }, true);
        await legeZeile("Überall", "aventurien", "verbreitung", { region: "kontinent" }, true);
        await legeZeile("Kraut", "p257p-bornland", "verbreitung", { region: "bornland" });
        await legeZeile("Kraut", "p257p-ort-offen", "verbreitung", { ort: "offen" });
        await legeZeile("Doppelt", "p257p-wald-1", "verbreitung", { region: "wald1" });
        await legeZeile("Anders", "p257p-bornland", "regionen", { region: "bornland" });
        await legeZeile("Ohne", "p257p-bornland", "verbreitung", { region: "bornland" });
        // Eine mehrdeutige Zeile: dieselbe Benennung trifft die Landschaft und das Gebiet (wie „Bornland (Region)“ in den echten Daten).
        const [insel] = await database<{ id: string }[]>`
            INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, legacy_origin, source_system)
            VALUES (${eintragId["Rahmen"] as string}, 'p257p-insel', 'verbreitung', 'p257p-insel', 0, 'other', 'ambiguous', 2, 'manual', 'test')
            RETURNING id::text AS id
        `;
        await database`INSERT INTO lore_place_target (lore_place_id, region_id) VALUES (${(insel as { id: string }).id}::bigint, ${regionId["insel"] as string}::bigint)`;
        await database`INSERT INTO lore_place_target (lore_place_id, territory_id) VALUES (${(insel as { id: string }).id}::bigint, ${(gebietInsel as { id: string }).id}::bigint)`;

        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await app?.close();
        await raeumeAuf();
        await restoreState?.();
        await database.end({ timeout: 5 });
    }, 60_000);

    afterEach(() => {
        LORE_READING.ortszeileHinterRegel = true;
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Hilfen
    // -------------------------------------------------------------------------------------------------------------------

    const kurz = (name: string): string => name.replace("P257P ", "");
    const zeileVon = (rows: readonly LoreRowView[] | undefined, art: string): LoreRowView | undefined =>
        rows?.find((row) => row.kind === art);
    /** Die Namen einer Art, in einer Gruppe oder (ohne Angabe) in allen. */
    const namen = (rows: readonly LoreRowView[] | undefined, art: string, gruppe?: string): string[] =>
        (zeileVon(rows, art)?.groups ?? [])
            .filter((g) => gruppe === undefined || g.group === gruppe)
            .flatMap((g) => g.entries.map((e) => kurz(e.name)))
            .sort();
    const ueberall = (rows: readonly LoreRowView[] | undefined, art: string): number | undefined =>
        zeileVon(rows, art)?.everywhere?.count;
    const sektion = async (request: DetailRequest): Promise<readonly LoreRowView[]> => {
        const section: SubjectLoreSection | null = await service.lore(request);
        return section?.rows ?? [];
    };
    const ort = (name: string): DetailRequest => ({ kind: "place", id: ortPublic(name) });
    const weg = (id: string): DetailRequest => ({ kind: "path", anchor: id });

    /** Kein Name steht in einer Zeile zweimal, auch nicht in zwei Gruppen. */
    const ohneDoppelte = (rows: readonly LoreRowView[]): void => {
        for (const row of rows) {
            const alle = row.groups.flatMap((g) => g.entries.map((e) => e.name));
            expect(new Set(alle).size, `${row.kind}: ${alle.join(", ")}`).toBe(alle.length);
        }
    };

    // -------------------------------------------------------------------------------------------------------------------
    // Ort
    // -------------------------------------------------------------------------------------------------------------------

    describe("Ort", () => {
        it("🔴 ein Ort im Wald: die Regeltreffer stehen unter „Aus der Region“, nie unter „Direkt von hier“", async () => {
            const rows = await sektion(ort("wald"));
            ohneDoppelte(rows);
            expect(namen(rows, "flora", "region")).toEqual(["Baum"]);
            expect(namen(rows, "fauna", "region")).toEqual(["Doppelt"]);
            expect(namen(rows, "spezies", "region")).toEqual(["Anders"]);
            // Herkunft hat eine Regel der Beziehung `herkunft`: sie steht trotzdem in der Region, nie unter „Von hier“.
            expect(namen(rows, "ware", "region")).toEqual(["Herkunft", "Ohne"]);
            for (const row of rows) {
                expect(row.groups.map((g) => g.group).filter((g) => g !== "region")).toEqual([]);
            }
        });

        it("🔴 F2: die Zeile Bornland tritt hinter die Regel „Steppe in Bornland“ zurück - im Wald steht Kraut NICHT", async () => {
            const rows = await sektion(ort("wald"));
            expect(namen(rows, "flora")).not.toContain("Kraut");
        });

        it("🔴 F2 aus: die Zeile Bornland gilt neben den Regeln, Kraut steht auch im Wald", async () => {
            LORE_READING.ortszeileHinterRegel = false;
            const rows = await sektion(ort("wald"));
            ohneDoppelte(rows);
            expect(namen(rows, "flora", "region")).toEqual(["Baum", "Kraut"]);
        });

        it("in der Steppe trifft die Regel: Kraut steht dort, einmal - mit und ohne F2", async () => {
            for (const hinter of [true, false]) {
                LORE_READING.ortszeileHinterRegel = hinter;
                const rows = await sektion(ort("steppe"));
                ohneDoppelte(rows);
                expect(namen(rows, "flora"), `F2 ${String(hinter)}`).toEqual(["Kraut"]);
            }
        });

        it("🔴 alle anderen Ortszeilen gelten weiter: Kraut steht am Ort „Offen“ unter „Direkt von hier“", async () => {
            for (const hinter of [true, false]) {
                LORE_READING.ortszeileHinterRegel = hinter;
                const rows = await sektion(ort("offen"));
                expect(namen(rows, "flora", "here"), `F2 ${String(hinter)}`).toEqual(["Kraut"]);
                expect(namen(rows, "flora", "region")).toEqual([]);
            }
        });

        it("🔴 eine Ortszeile einer anderen Beziehung tritt nicht zurück (Anders: Zeile `regionen`, Regel `verbreitung`)", async () => {
            const rows = await sektion(ort("wald"));
            expect(namen(rows, "spezies", "region")).toEqual(["Anders"]);
        });

        it("🔴 ein abgezogenes Glied (`ohne`) ersetzt nichts: die Zeile Bornland des Eintrags „Ohne“ gilt weiter", async () => {
            // Im Wald trifft seine Regel nicht (Wald in Bornland ist abgezogen), die Zeile Bornland aber gilt.
            expect(namen(await sektion(ort("wald")), "ware", "region")).toContain("Ohne");
        });

        it("🔴 F2 und „Überall in Aventurien“: Baum (Regel „Wald in Aventurien“) fällt aus dem Link und seiner Zahl", async () => {
            // Die Kontinentzeile von Baum tritt zurück; übrig bleibt der Eintrag, der nur die Kontinentzeile hat.
            expect(ueberall(await sektion(ort("offen")), "flora")).toBe(1);
            LORE_READING.ortszeileHinterRegel = false;
            expect(ueberall(await sektion(ort("offen")), "flora")).toBe(2);
        });

        it("🔴 die Zahl im Detail ist die Länge der Listen - Satz und Liste kommen aus einer Rechnung", async () => {
            for (const hinter of [true, false]) {
                LORE_READING.ortszeileHinterRegel = hinter;
                for (const name of ["wald", "steppe", "offen"]) {
                    const detail = await service.detail(ort(name));
                    const rows = await sektion(ort(name));
                    for (const row of rows) {
                        expect(row.count, `${name} ${row.kind} F2 ${String(hinter)}`).toBe(
                            detail?.counts?.lore?.[row.kind],
                        );
                    }
                }
            }
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Landschaft, Gebiet, Gipfel
    // -------------------------------------------------------------------------------------------------------------------

    describe("Landschaft, Gebiet und Gipfel", () => {
        it("🔴 Wald 1: Doppelt gehört der Landschaft (Zeile) UND trifft sie (Regel) - er steht einmal, „Direkt von hier“", async () => {
            const rows = await sektion({ kind: "area", id: uuid(3) });
            ohneDoppelte(rows);
            expect(namen(rows, "fauna", "here")).toEqual(["Doppelt"]);
            expect(namen(rows, "fauna", "region")).toEqual([]);
            // Die Regeln einer Landschaft kommen aus dem Punkt ihrer Fläche und von GRÖSSEREN Landschaften (Bornland, Aventurien).
            expect(namen(rows, "flora", "region")).toEqual(["Baum"]);
            expect(namen(rows, "ware", "region")).toEqual(["Herkunft", "Ohne"]);
        });

        it("🔴 am Rahmen SELBST tritt die Zeile nicht zurück: Bornland behält Kraut unter „Direkt von hier“ - mit und ohne F2", async () => {
            // Der Punkt von Bornland (750/175) liegt in keinem Wald und nicht in der Steppe (755..780): keine Regel trifft ihn. Die Zeile
            // Bornland des Krauts bleibt trotzdem, denn „genauer fassen“ gilt für alles INNERHALB des Rahmens (Entscheid der Leitung).
            for (const hinter of [true, false]) {
                LORE_READING.ortszeileHinterRegel = hinter;
                const rows = await sektion({ kind: "area", id: uuid(2) });
                ohneDoppelte(rows);
                expect(namen(rows, "flora", "here"), `F2 ${String(hinter)}`).toEqual(["Kraut"]);
                expect(namen(rows, "flora", "region")).toEqual([]);
            }
        });

        it("🔴 die Landschaft Aventurien behält ihre Kontinentzeilen (Baum, Regel „Wald in Aventurien“), der Link anderswo zählt ihn nicht", async () => {
            const kontinent = await sektion({ kind: "area", id: uuid(1) });
            expect(namen(kontinent, "flora", "here")).toEqual(["Baum", "Überall"]);
            // An einem anderen Gegenstand ist die Zahl am Link die bereinigte: Baum kommt nicht überall vor.
            expect(ueberall(await sektion(ort("offen")), "flora")).toBe(1);
        });

        it("🔴 ein kleinerer Gegenstand INNERHALB des Rahmens verliert die Zeile: der Ort im Wald hat Kraut nicht, der Kartenpunkt dort auch nicht", async () => {
            expect(namen(await sektion(ort("wald")), "flora")).not.toContain("Kraut");
            expect(namen((await service.mapPoint(720, 175)).lore, "flora")).not.toContain("Kraut");
            // Mit dem Schalter aus stünde er dort.
            LORE_READING.ortszeileHinterRegel = false;
            expect(namen((await service.mapPoint(720, 175)).lore, "flora")).toContain("Kraut");
        });

        it("🔴 der Rahmen als Landschaft UND als Gebiet (eine mehrdeutige Zeile): beide behalten den Eintrag, ein Kartenpunkt darin nicht", async () => {
            for (const hinter of [true, false]) {
                LORE_READING.ortszeileHinterRegel = hinter;
                const landschaft = await sektion({ kind: "area", id: uuid(7) });
                const gebiet = await sektion({ kind: "territory", id: GEBIET_INSEL });
                expect(namen(landschaft, "flora", "here"), `Landschaft, F2 ${String(hinter)}`).toEqual(["Rahmen"]);
                expect(namen(gebiet, "flora", "here"), `Gebiet, F2 ${String(hinter)}`).toEqual(["Rahmen"]);
                // Ein Punkt IN der Insel ist ein kleinerer Gegenstand: F2 nimmt die Zeile, die Regel trifft dort nicht.
                const punkt = await service.mapPoint(790, 110);
                expect(namen(punkt.lore, "flora", "region"), `Kartenpunkt, F2 ${String(hinter)}`).toEqual(
                    hinter ? [] : ["Rahmen"],
                );
            }
        });

        it("🔴 das Gebiet: die Regeln am Punkt seiner Form, „Aus der Region“", async () => {
            const rows = await sektion({ kind: "territory", id: GEBIET });
            ohneDoppelte(rows);
            expect(namen(rows, "flora", "region")).toEqual(["Baum"]);
            expect(namen(rows, "fauna", "region")).toEqual(["Doppelt"]);
            expect(namen(rows, "ware", "region")).toEqual(["Herkunft", "Ohne"]);
        });

        it("🔴 der Gipfel: die Regeln an seinem Punkt (in der Steppe)", async () => {
            const rows = await sektion({ kind: "peak", id: GIPFEL });
            ohneDoppelte(rows);
            expect(namen(rows, "flora", "region")).toEqual(["Kraut"]);
            expect(namen(rows, "spezies", "region")).toEqual(["Anders"]);
            expect(namen(rows, "flora", "here")).toEqual([]);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Kartenpunkt
    // -------------------------------------------------------------------------------------------------------------------

    describe("Kartenpunkt", () => {
        it("🔴 der Kartenpunkt im Wald nennt dasselbe wie der Ort dort - und nichts unter „Direkt von hier“", async () => {
            const punkt = await service.mapPoint(720, 175);
            const ortRows = await sektion(ort("wald"));
            for (const art of ["ware", "fauna", "flora", "spezies"]) {
                expect(namen(punkt.lore, art, "region"), art).toEqual(namen(ortRows, art, "region"));
            }
            expect(punkt.lore?.flatMap((row) => row.groups.map((g) => g.group)).filter((g) => g !== "region")).toEqual(
                [],
            );
        });

        it("🔴 Einheitlichkeit: der Kartenpunkt nennt einen Regeleintrag genau dann, wenn `eintraegeAmPunkt` ihn nennt", async () => {
            leereVorkommenSpeicher();
            // Diese vier haben keine Zeile, die am Kartenpunkt etwas beitrüge (Kraut: die Zeile Bornland tritt zurück).
            const regelEintraege = ["Baum", "Kraut", "Herkunft", "Winzig"];
            let treffer = 0;
            for (let x = 700; x <= 800; x += 10) {
                for (let y = 100; y <= 200; y += 10) {
                    const [punkt, regeln] = await Promise.all([
                        service.mapPoint(x, y),
                        eintraegeAmPunkt(database, { x, y }),
                    ]);
                    const ids = new Set(regeln.eintraege.map((e) => e.id));
                    for (const name of regelEintraege) {
                        const imPanel = (punkt.lore ?? []).some((row) =>
                            row.groups.some((g) => g.entries.some((e) => e.name === `P257P ${name}`)),
                        );
                        expect(imPanel, `${name} bei ${String(x)}/${String(y)}`).toBe(
                            ids.has(eintragId[name] as string),
                        );
                        if (imPanel) treffer += 1;
                    }
                }
            }
            // Die Probe prüft etwas: Es gibt Punkte mit und ohne Treffer.
            expect(treffer).toBeGreaterThan(5);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Weg und Etappe
    // -------------------------------------------------------------------------------------------------------------------

    describe("Weg und Etappe", () => {
        it("🔴 der Weg durch Wald, winzigen Wald und Steppe nennt alles, was er durchquert - auch den winzigen Wald (0,8 breit)", async () => {
            const rows = await sektion(weg(WEG1));
            ohneDoppelte(rows);
            expect(namen(rows, "flora", "region")).toEqual(["Baum", "Kraut", "Winzig"]);
            expect(namen(rows, "fauna", "region")).toEqual(["Doppelt"]);
            expect(namen(rows, "ware", "region")).toEqual(["Herkunft", "Ohne"]);
            expect(namen(rows, "spezies", "region")).toEqual(["Anders"]);
            for (const row of rows) {
                expect(row.groups.map((g) => g.group).filter((g) => g !== "region")).toEqual([]);
            }
        });

        it("der Weg im Freien trifft keine Regel; F2: Baum fällt auch aus seiner Zahl am Link", async () => {
            const rows = await sektion(weg(WEG2));
            expect(namen(rows, "flora")).toEqual([]);
            expect(namen(rows, "fauna")).toEqual([]);
            expect(ueberall(rows, "flora")).toBe(1);
        });

        it("🔴 die Etappe über den Weg antwortet wie der Weg (eine Anfrage, dieselbe Stelle)", async () => {
            const etappe = await service.stageLore([WEG1]);
            const rows = await sektion(weg(WEG1));
            expect(etappe.rows).toEqual(rows);
        });

        it("🔴 eine Etappe OHNE Weg (querfeldein) antwortet mit ihrer Linie wie der Weg auf demselben Verlauf", async () => {
            // Ohne Linie hat so eine Etappe nichts als den Link - obwohl sie durch Wald führt (die erste Etappe der Beispielreise).
            const ohneLinie = await service.stageLore([]);
            expect(namen(ohneLinie.rows, "flora", "region")).toEqual([]);
            const mitLinie = await service.stageLore([], [[700, 175, 790, 175]]);
            ohneDoppelte(mitLinie.rows);
            expect(mitLinie.rows).toEqual((await service.stageLore([WEG1])).rows);
            expect(namen(mitLinie.rows, "flora", "region")).toEqual(["Baum", "Kraut", "Winzig"]);
        });

        it("eine Linie und ein Weg zusammen: die Vereinigung; eine Linie im Freien trägt nichts bei", async () => {
            const freieLinie = await service.stageLore([], [[700, 140, 790, 140]]);
            expect(namen(freieLinie.rows, "flora", "region")).toEqual([]);
            const beide = await service.stageLore([WEG2], [[700, 175, 790, 175]]);
            expect(namen(beide.rows, "flora", "region")).toEqual(["Baum", "Kraut", "Winzig"]);
        });

        it("🔴 zwei Wege in einer Etappe: die Vereinigung, ohne Doppelte", async () => {
            const etappe = await service.stageLore([WEG1, WEG2]);
            ohneDoppelte(etappe.rows);
            expect(namen(etappe.rows, "flora", "region")).toEqual(["Baum", "Kraut", "Winzig"]);
        });

        it("🔴 die Inhaltsschalter je Art gelten an der Etappe: „Flora“ aus, die Zeile fehlt; die übrigen bleiben", async () => {
            app = buildApp({
                config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
                database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            });
            await app.ready();
            const frage = async (): Promise<RouteStageLoreResponse> => {
                const antwort = await (app as FastifyInstance).inject({
                    method: "POST",
                    url: ROUTE_STAGE_LORE_URL,
                    payload: { paths: [WEG1] },
                });
                expect(antwort.statusCode).toBe(200);
                return antwort.json<RouteStageLoreResponse>();
            };
            expect((await frage()).rows.map((row) => row.kind)).toEqual(["ware", "fauna", "flora", "spezies"]);
            await database`INSERT INTO content_switch (key, enabled, changed_by_label) VALUES ('panel.lore.flora', FALSE, 'test')`;
            // Die Anwendung liest den Stand über ihren Store, sobald der Weckruf da ist.
            await expect
                .poll(async () => (await frage()).rows.map((row) => row.kind), { timeout: 15_000, interval: 250 })
                .toEqual(["ware", "fauna", "spezies"]);
            await database`DELETE FROM content_switch WHERE key = 'panel.lore.flora'`;
            await expect
                .poll(async () => (await frage()).rows.map((row) => row.kind), { timeout: 15_000, interval: 250 })
                .toEqual(["ware", "fauna", "flora", "spezies"]);
        }, 60_000);
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Unterwegs (S4)
    // -------------------------------------------------------------------------------------------------------------------

    describe("Unterwegs: die Vorkommen der ganzen Route (WI-0257 S4)", () => {
        interface Stage {
            paths: string[];
            lines?: number[][];
        }
        const ROUTE: Stage[] = [
            { paths: [WEG1] },
            { paths: [WEG2] },
            { paths: [], lines: [[700, 175, 790, 175]] },
            { paths: [WEG3] },
        ];
        const namenImPanel = async (stage: Stage): Promise<Set<string>> => {
            const panel = await service.stageLore(stage.paths, stage.lines);
            return new Set(panel.rows.flatMap((row) => row.groups.flatMap((g) => g.entries.map((e) => e.name))));
        };
        const gegendVon = (antwort: RouteUnterwegsResponse, name: string): string | undefined =>
            antwort.eintraege.find((e) => e.name === `P257P ${name}`)?.gegend?.replace("P257P ", "");

        it("🔴 jeder Eintrag steht im Panel genau der Etappen, die er nennt - und die Reise nennt nichts anderes", async () => {
            const antwort = await service.unterwegs(ROUTE);
            const panels = await Promise.all(ROUTE.map(namenImPanel));
            for (const eintrag of antwort.eintraege) {
                const erwartet = panels.flatMap((namen, at) => (namen.has(eintrag.name) ? [at] : []));
                expect(eintrag.etappen, eintrag.name).toEqual(erwartet);
            }
            expect(new Set(antwort.eintraege.map((e) => e.name))).toEqual(
                new Set(panels.flatMap((namen) => [...namen])),
            );
            // Jeder Eintrag einmal, mit der öffentlichen Kennung (nicht der internen).
            expect(new Set(antwort.eintraege.map((e) => e.id)).size).toBe(antwort.eintraege.length);
            for (const eintrag of antwort.eintraege) expect(eintrag.id).toMatch(/^[0-9a-f-]{36}$/);
        });

        it("🔴 alle Etappen auf einmal gerechnet wie je Panel: Weg und Linie in einer Etappe, leer, doppelter und unbekannter Weg", async () => {
            const route: Stage[] = [
                { paths: [WEG2], lines: [[700, 175, 790, 175]] },
                { paths: [] },
                { paths: [WEG3, WEG3, uuid(299)] },
                { paths: [WEG1] },
            ];
            const antwort = await service.unterwegs(route);
            const panels = await Promise.all(route.map(namenImPanel));
            expect(antwort.eintraege.length).toBeGreaterThan(0);
            for (const eintrag of antwort.eintraege) {
                const erwartet = panels.flatMap((namen, at) => (namen.has(eintrag.name) ? [at] : []));
                expect(eintrag.etappen, eintrag.name).toEqual(erwartet);
            }
            expect(new Set(antwort.eintraege.map((e) => e.name))).toEqual(
                new Set(panels.flatMap((namen) => [...namen])),
            );
        });

        it("geordnet nach Art (Waren, Fauna, Flora, Spezies) und Name; die Etappen aufsteigend", async () => {
            const antwort = await service.unterwegs(ROUTE);
            const rang = ["ware", "fauna", "flora", "spezies"];
            const folge = antwort.eintraege.map((e) => [rang.indexOf(e.kind), e.name] as const);
            expect(folge).toEqual([...folge].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], "de")));
            for (const eintrag of antwort.eintraege) {
                expect(eintrag.etappen).toEqual([...new Set(eintrag.etappen)].sort((a, b) => a - b));
            }
        });

        it("🔴 eine Etappe ohne Weg (querfeldein) und eine mit Weg über denselben Verlauf nennen dieselben Einträge", async () => {
            const antwort = await service.unterwegs([{ paths: [WEG1] }, { paths: [], lines: [[700, 175, 790, 175]] }]);
            expect(antwort.eintraege.length).toBeGreaterThan(0);
            for (const eintrag of antwort.eintraege) expect(eintrag.etappen, eintrag.name).toEqual([0, 1]);
        });

        it("die Gegend: Name der Ortszeile, sonst der getroffenen Gegend - nie der Kontinent", async () => {
            const antwort = await service.unterwegs([{ paths: [WEG1] }]);
            // Eine Ortszeile, die das Ziel nennt (Doppelt: Zeile am Wald 1), und die Zeile Bornland (Anders: andere Beziehung, tritt nicht zurück).
            expect(gegendVon(antwort, "Doppelt")).toBe("Wald 1");
            expect(gegendVon(antwort, "Anders")).toBe("Bornland");
            // Kraut: seine Zeile Bornland tritt hinter die Regel zurück (F2) - die Gegend ist der Rahmen der Regel.
            expect(gegendVon(antwort, "Kraut")).toBe("Bornland");
            // Winzig: die Regel nennt nur die Fläche des winzigen Waldes.
            expect(gegendVon(antwort, "Winzig")).toBe("Wald 3 winzig");
            // Baum: Der Rahmen „Aventurien“ ist keine Gegend; es bleibt der Wald, an dem die Regel trifft.
            expect(gegendVon(antwort, "Baum")).toBe("Wald 1");
            for (const eintrag of antwort.eintraege) expect(eintrag.gegend, eintrag.name).not.toBe("P257P Aventurien");
        });

        it("🔴 nie ein automatischer Name: im Wald „Wald-925“ nennt die Gegend die benannte Landschaft darüber", async () => {
            const antwort = await service.unterwegs([{ paths: [WEG3] }]);
            expect(antwort.eintraege.map((e) => e.name)).toContain("P257P Baum");
            expect(gegendVon(antwort, "Baum")).toBe("Bornland");
            for (const eintrag of antwort.eintraege) expect(eintrag.gegend ?? "", eintrag.name).not.toMatch(/-\d+$/);
        });

        it("die Gegend gilt für die Etappe, in der der Eintrag zum ersten Mal vorkommt", async () => {
            // Baum steht erst in der zweiten (Griffwald) und der dritten Etappe (Wald 1): die Gegend ist die der zweiten.
            const antwort = await service.unterwegs([{ paths: [WEG2] }, { paths: [WEG3] }, { paths: [WEG1] }]);
            const baum = antwort.eintraege.find((e) => e.name === "P257P Baum");
            expect(baum?.etappen).toEqual([1, 2]);
            expect(baum?.gegend).toBe("P257P Bornland");
        });

        it("🔴 ein Zeitbudget je Route: ist es aufgebraucht, gibt es keine halbe Liste, sondern einen Abbruch", async () => {
            await expect(service.unterwegs(ROUTE, 0)).rejects.toBeInstanceOf(UnterwegsZeitbudget);
            // Mit Luft rechnet dieselbe Route.
            expect((await service.unterwegs(ROUTE, 60_000)).eintraege.length).toBeGreaterThan(0);
        });

        it("zwei Etappen über dieselben Wege und Linien rechnen gleich (Hin- und Rückweg)", async () => {
            const antwort = await service.unterwegs([{ paths: [WEG1] }, { paths: [WEG2] }, { paths: [WEG1] }]);
            const baum = antwort.eintraege.find((e) => e.name === "P257P Baum");
            expect(baum?.etappen).toEqual([0, 2]);
        });

        it("🔴 die Inhaltsschalter je Art gelten: „Flora“ aus, ihre Einträge fehlen; die übrigen bleiben", async () => {
            app = buildApp({
                config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
                database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            });
            await app.ready();
            const frage = async (): Promise<string[]> => {
                const antwort = await (app as FastifyInstance).inject({
                    method: "POST",
                    url: ROUTE_UNTERWEGS_URL,
                    payload: { stages: [{ paths: [WEG1] }] },
                });
                expect(antwort.statusCode).toBe(200);
                return [...new Set(antwort.json<RouteUnterwegsResponse>().eintraege.map((e) => e.kind))].sort();
            };
            expect(await frage()).toEqual(["fauna", "flora", "spezies", "ware"]);
            await database`INSERT INTO content_switch (key, enabled, changed_by_label) VALUES ('panel.lore.flora', FALSE, 'test')`;
            await expect.poll(frage, { timeout: 15_000, interval: 250 }).toEqual(["fauna", "spezies", "ware"]);
            await database`DELETE FROM content_switch WHERE key = 'panel.lore.flora'`;
            await expect.poll(frage, { timeout: 15_000, interval: 250 }).toEqual(["fauna", "flora", "spezies", "ware"]);
        }, 60_000);
    });
});

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG, SEARCH_EINTRAG_URL, type SearchEintrag } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { typeImageList } from "../src/media-editor/type-images.ts";
import { eintragFuerPanel } from "../src/search/eintrag.ts";
import { leereSuchSpeicher } from "../src/search/speicher.ts";
import { leereLeuchtenSpeicher, leuchte } from "../src/vorkommen/index.ts";

/**
 * Die Antwort `GET /api/search/eintrag` der neuen Infobox eines Vorkommens (WI-0260) gegen echtes PostGIS: „Wo es vorkommt“ (Gegenden je Name einmal, Orte, auch genannt), die Publikationen,
 * Gegenstandstyp, Kontinent, Kurzbeschreibung und die Zählung der Typbilder.
 *
 * 🔴 **Die Welt** liegt in `[900, 1000] × [900, 1000]` und trägt nur Dinge mit der Kennung `26003000-…` (Namen mit „P260“):
 *
 *     Orkland (Region, [900,950]²) mit 66 Steppen darin (Fläche wächst mit der Nummer)     Thorwal (Region)     Wald-003 (ein Griff)
 *     Nebelmoor: dieselbe Fläche als Region, als Tiefebene und als Sumpf/Moor, also drei Flächen und EIN Name
 *     Grafschaft Sikram (Gebiet)     Radoleth (Stadt, in der Grafschaft)     Feuerberg (Vulkan)
 *
 * Die Einträge (Name: was sie nennen):
 * - Wirsel (Flora, Gras): Orkland, Thorwal, Nebelmoor (EINE Zeile mit drei Zielen), den Griff; dazu „Der Große Fluss“ (zweimal, ohne Ziel), Myranor (Kontinent ohne Träger) und Aventurien (nie „auch genannt“).
 * - Sikram (Ware, Typ Hartwurst, Kontinent Aventurien): Herkunft Grafschaft Sikram und Radoleth, Verbreitung Thorwal; drei Publikationen, eine stillgelegte, eine zu einer stillgelegten Quelle.
 * - Feuertier (Fauna, Kontinent „Myranor / Güldenland“): der Vulkan. - Steppentier (Fauna): Thorwal und die Regel „Steppe in Orkland“. - Nurkontinent (Spezies): nur Aventurien. - Leer (Ware): nichts.
 *
 * 🪤 Die Kurzbeschreibung steht in Migration 0252 (WikiSync-Helfer von WI-0260). Fehlt die Spalte noch, wartet jeder Fall, der den Eintrag liest, darauf (`skip`); die Zählung der Typbilder und die
 * reinen Hilfen laufen auch ohne sie.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MAP_DOMAIN = "aventuria";
const PREFIX = "26003000-0000-4000-8000-";
const uuid = (nummer: number): string => `${PREFIX}${String(nummer).padStart(12, "0")}`;
const KEY = "p260-";
const rechteck = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

/** Wie viele Steppen in Orkland liegen: mehr als die Liste je Beziehung zeigt, damit die Deckelung greift. */
const STEPPEN = SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG + 6;

interface RegionDef {
    nummer: number;
    name: string;
    ebene: string;
    art: string;
    wkt: string;
}

const REGIONEN: Record<string, RegionDef> = {
    orkland: {
        nummer: 1,
        name: "P260 Orkland",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(900, 900, 950, 950),
    },
    thorwal: {
        nummer: 2,
        name: "P260 Thorwal",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(960, 930, 990, 960),
    },
    nebelA: {
        nummer: 3,
        name: "P260 Nebelmoor",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(960, 900, 985, 925),
    },
    nebelB: {
        nummer: 4,
        name: "P260 Nebelmoor",
        ebene: "topographie",
        art: "tiefebene",
        wkt: rechteck(960, 900, 985, 925),
    },
    nebelC: {
        nummer: 5,
        name: "P260 Nebelmoor",
        ebene: "vegetation",
        art: "suempfe_moore",
        wkt: rechteck(960, 900, 985, 925),
    },
    griff: { nummer: 6, name: "Wald-003", ebene: "vegetation", art: "wald", wkt: rechteck(990, 900, 995, 905) },
};

/** Die Steppen von Orkland: ein Raster aus Zellen, jede Steppe etwas größer als die vorige (Nummer 1 ist die kleinste). */
const steppe = (i: number): { nummer: number; name: string; wkt: string } => {
    const spalte = (i - 1) % 9;
    const zeile = Math.floor((i - 1) / 9);
    const x0 = 900.3 + spalte * 5.4;
    const y0 = 900.3 + zeile * 5.4;
    const kante = 1 + (i / STEPPEN) * 4;
    return {
        nummer: 100 + i,
        name: `P260 Steppe ${String(i).padStart(2, "0")}`,
        wkt: rechteck(x0, y0, x0 + kante, y0 + kante),
    };
};

const GEBIET = uuid(300);
const ORT = uuid(310);
const GIPFEL = uuid(320);

/** Gleichnamige Flächen werden nach dem Kartenstand zu einer Gegend; der Test nennt sie beim Namen ohne Vorsilbe. */
const kurz = (name: string): string => name.replace("P260 ", "");

describeWithDatabase("Die Antwort eines Eintrags für die neue Infobox (WI-0260) gegen PostGIS", () => {
    let database: Database;
    let app: FastifyInstance | undefined;
    let spalteDa = false;
    const regionId: Record<string, string> = {};
    const eintragId: Record<string, string> = {};
    const eintragPublic: Record<string, string> = {};
    let gebietId = "";
    let ortId = "";
    let gipfelId = "";
    let regelNummer = 0;
    const regionPublic = (name: string): string => uuid((REGIONEN[name] as RegionDef).nummer);

    async function legeEintrag(
        schluessel: string,
        name: string,
        art: string,
        extra: { gruppe?: string; typ?: string; kontinent?: string; kurz?: string; synonyme?: string } = {},
    ): Promise<void> {
        const [zeile] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO lore_entry (wiki_key, kind, name, gruppe, typ, continent, synonyme, legacy_origin, source_system)
            VALUES (${KEY + schluessel}, ${art}, ${name}, ${extra.gruppe ?? null}, ${extra.typ ?? null}, ${extra.kontinent ?? null},
                    ${extra.synonyme ?? null}, 'manual', 'test')
            RETURNING id::text AS id, public_id::text AS public_id
        `;
        eintragId[schluessel] = (zeile as { id: string }).id;
        eintragPublic[schluessel] = (zeile as { public_id: string }).public_id;
        if (extra.kurz !== undefined && spalteDa) {
            await database`UPDATE lore_entry SET kurzbeschreibung = ${extra.kurz} WHERE id = ${eintragId[schluessel] as string}::bigint`;
        }
    }

    type Ziel = { regionen: string[] } | { gebiet: true } | { ort: true } | { gipfel: true } | { keins: true };

    let zeilenNummer = 0;
    /** Eine Ortszeile mit ihren Zielen (kein Ziel: eine Zeile, die nicht aufgelöst werden konnte). */
    async function legeZeile(
        schluessel: string,
        wiki: string,
        beziehung: string,
        ziel: Ziel,
        extra: { titel?: string; kontinent?: boolean } = {},
    ): Promise<void> {
        zeilenNummer += 1;
        const anzahl = "regionen" in ziel ? ziel.regionen.length : "keins" in ziel ? 0 : 1;
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, legacy_origin, source_system)
            VALUES (${eintragId[schluessel] as string}, ${wiki}, ${beziehung}, ${extra.titel ?? wiki}, ${zeilenNummer},
                    ${extra.kontinent === true ? "continent" : "other"},
                    ${anzahl === 0 ? (extra.kontinent === true ? "unresolved" : "unmatched") : anzahl === 1 ? "resolved" : "ambiguous"},
                    ${anzahl}, 'manual', 'test')
            RETURNING id::text AS id
        `;
        const id = (zeile as { id: string }).id;
        if ("regionen" in ziel) {
            for (const region of ziel.regionen) {
                await database`INSERT INTO lore_place_target (lore_place_id, region_id) VALUES (${id}::bigint, ${regionId[region] as string}::bigint)`;
            }
        } else if ("gebiet" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, territory_id) VALUES (${id}::bigint, ${gebietId}::bigint)`;
        } else if ("ort" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, place_id) VALUES (${id}::bigint, ${ortId}::bigint)`;
        } else if ("gipfel" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, terrain_peak_id) VALUES (${id}::bigint, ${gipfelId}::bigint)`;
        }
    }

    /** Die Regel „Steppe in Orkland“ für einen Eintrag. */
    async function legeSteppenRegel(schluessel: string): Promise<void> {
        regelNummer += 1;
        const key = createHash("sha256")
            .update(`${schluessel}|verbreitung|${String(regelNummer)}`)
            .digest("hex");
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, source_system)
            VALUES (${eintragId[schluessel] as string}, ${key}, 'verbreitung', ${regelNummer}, 'manual', 'test') RETURNING id::text AS id
        `;
        const [term] = await database<{ id: string }[]>`
            INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id)
            VALUES (${(zeile as { id: string }).id}, 0, 'und', ${regionId["orkland"] as string}) RETURNING id::text AS id
        `;
        await database`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${(term as { id: string }).id}, 'vegetation', 'steppe')`;
    }

    interface QuelleDef {
        titel: string;
        art: string;
        offiziell: boolean;
        url?: string;
        bezug: string | null;
        seiten?: string;
        position: number;
        still?: "verknuepfung" | "quelle";
    }

    async function legeQuelle(schluessel: string, def: QuelleDef): Promise<void> {
        const key =
            def.url === undefined
                ? `wikipub:${KEY}${def.titel.toLowerCase().replace(/\s+/gu, "-")}`
                : `url:${createHash("sha256").update(def.url, "utf8").digest("hex")}`;
        const [quelle] = await database<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system, is_active, retired_at, retired_origin)
            VALUES (${key}, 'final', ${def.url ?? null}, ${def.titel}, ${def.art}, ${def.offiziell}, 'test', ${def.still !== "quelle"},
                    ${def.still === "quelle" ? new Date() : null}, ${def.still === "quelle" ? "editor" : null})
            RETURNING id::text AS id
        `;
        const stillgelegt = def.still === "verknuepfung";
        await database`
            INSERT INTO lore_entry_source (lore_entry_id, source_id, reference_kind, pages, legacy_origin, position, state, source_system, is_active, retired_at, retired_origin)
            VALUES (${eintragId[schluessel] as string}, ${(quelle as { id: string }).id}, ${def.bezug}, ${def.seiten ?? null}, 'wiki_publication', ${def.position},
                    ${stillgelegt ? "retired" : "active"}, 'test', ${!stillgelegt}, ${stillgelegt ? new Date() : null}, ${stillgelegt ? "import" : null})
        `;
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
        await database.unsafe(`DELETE FROM lore_entry_source WHERE ${meine}`);
        // Der Wiki-Stand (WI-0299: die Unterseite „Liste“); er hängt ohne Kaskade am Eintrag.
        await database.unsafe(`DELETE FROM wiki_lore_snapshot WHERE ${meine}`);
        await database.unsafe(`DELETE FROM feature_source WHERE source_system = 'test' AND title LIKE 'P260 %'`);
        await database.unsafe(`DELETE FROM lore_entry WHERE wiki_key LIKE '${KEY}%'`);
        await database.unsafe(
            `DELETE FROM territory_shape WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '${PREFIX}%')`,
        );
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM terrain_peak WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM region_area WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM region WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '${PREFIX}%'`);
    }

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await raeumeAuf();
        const [spalte] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'lore_entry' AND column_name = 'kurzbeschreibung'
        `;
        spalteDa = (spalte?.n ?? 0) > 0;
        const [fremd] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM region_area a WHERE a.is_active AND a.geom && ST_MakeEnvelope(890, 890, 1010, 1010, 0)
        `;
        expect(fremd?.n, "fremde Flächen in der Welt der Testdatei (die Testdatenbank ist nicht leer genug)").toBe(0);

        const legeRegion = async (
            name: string,
            nummer: number,
            bezeichnung: string,
            ebene: string,
            art: string,
            wkt: string,
        ) => {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, is_hidden)
                VALUES (${uuid(nummer)}, ${MAP_DOMAIN}, ${bezeichnung}, ${ebene}, ${art}, TRUE, FALSE)
                RETURNING id::text AS id
            `;
            regionId[name] = (zeile as { id: string }).id;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${uuid(nummer + 1000)}, ${MAP_DOMAIN}, ${regionId[name] as string}, ST_GeomFromText(${wkt}, 0), TRUE)
            `;
        };
        for (const [name, def] of Object.entries(REGIONEN)) {
            await legeRegion(name, def.nummer, def.name, def.ebene, def.art, def.wkt);
        }
        for (let i = 1; i <= STEPPEN; i += 1) {
            const s = steppe(i);
            await legeRegion(`steppe${String(i)}`, s.nummer, s.name, "vegetation", "steppe", s.wkt);
        }
        const [ort] = await database<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
            VALUES (${ORT}, ${MAP_DOMAIN}, 'P260 Radoleth', 'stadt', ST_SetSRID(ST_MakePoint(920, 975), 0), 'test', TRUE, FALSE)
            RETURNING id::text AS id
        `;
        ortId = (ort as { id: string }).id;
        const [gipfel] = await database<{ id: string }[]>`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, is_active, source_system)
            VALUES (${GIPFEL}, ${MAP_DOMAIN}, 'P260 Feuerberg', 'vulkan', ST_SetSRID(ST_MakePoint(975, 975), 0), TRUE, 'test')
            RETURNING id::text AS id
        `;
        gipfelId = (gipfel as { id: string }).id;
        const [gebiet] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, territory_type, color, opacity, wiki_key, is_active, source_system)
            VALUES (${GEBIET}, ${MAP_DOMAIN}, 'P260 Grafschaft Sikram', 'Grafschaft', '#B2B065', 0.7, NULL, TRUE, 'test')
            RETURNING id::text AS id
        `;
        gebietId = (gebiet as { id: string }).id;
        await database.unsafe(
            `INSERT INTO territory_shape (band, territory_id, depth, source_count, area, geom, render_geom, label_geom)
             VALUES (8, $1, 0, 1, 1200, ST_GeomFromText($2, 0), ST_SetSRID(ST_GeomFromText($2), 3857), ST_SetSRID(ST_MakePoint(920, 975), 0))`,
            [gebietId, rechteck(900, 960, 940, 990)],
        );

        await legeEintrag("wirsel", "P260 Wirsel", "flora", { gruppe: "[[Gras]]", synonyme: "Wirselmoos" });
        await legeEintrag("sikram", "P260 Sikram", "ware", {
            gruppe: "profan",
            typ: "[[Hartwurst]]",
            kontinent: "Aventurien",
            kurz: "  Eine ''Hartwurst'' aus [[Radoleth|der Stadt]].  ",
        });
        await legeEintrag("feuertier", "P260 Feuertier", "fauna", { kontinent: "Myranor / Güldenland" });
        await legeEintrag("steppentier", "P260 Steppentier", "fauna");
        await legeEintrag("nurkontinent", "P260 Nurkontinent", "spezies");
        await legeEintrag("leer", "P260 Leer", "ware");

        // Wirsel: drei Gegenden (Nebelmoor auf drei Ebenen), ein Griff, drei Orte des Wikis ohne Karte.
        await legeZeile("wirsel", "p260-orkland", "verbreitung", { regionen: ["orkland"] });
        await legeZeile("wirsel", "p260-thorwal", "verbreitung", { regionen: ["thorwal"] });
        await legeZeile("wirsel", "p260-nebelmoor", "verbreitung", { regionen: ["nebelA", "nebelB", "nebelC"] });
        await legeZeile("wirsel", "p260-wald", "verbreitung", { regionen: ["griff"] });
        await legeZeile(
            "wirsel",
            "p260-der-grosse-fluss",
            "verbreitung",
            { keins: true },
            { titel: "Der Große Fluss" },
        );
        await legeZeile("wirsel", "p260-der-grosse-fluss", "regionen", { keins: true }, { titel: "Der Große Fluss" });
        await legeZeile("wirsel", "myranor", "verbreitung", { keins: true }, { titel: "Myranor", kontinent: true });
        await legeZeile(
            "wirsel",
            "aventurien",
            "verbreitung",
            { keins: true },
            { titel: "Aventurien", kontinent: true },
        );
        // Sikram: Herkunft und Verbreitung.
        await legeZeile("sikram", "p260-grafschaft", "herkunft", { gebiet: true });
        await legeZeile("sikram", "p260-radoleth", "herkunft", { ort: true });
        await legeZeile("sikram", "p260-thorwal", "verbreitung", { regionen: ["thorwal"] });
        await legeZeile("feuertier", "p260-feuerberg", "verbreitung", { gipfel: true });
        await legeZeile("steppentier", "p260-thorwal", "verbreitung", { regionen: ["thorwal"] });
        await legeZeile(
            "nurkontinent",
            "aventurien",
            "verbreitung",
            { keins: true },
            { titel: "Aventurien", kontinent: true },
        );
        await legeSteppenRegel("steppentier");

        // Die Publikationen von Sikram in der Reihenfolge des Wikis (`position`), nicht nach Titel.
        await legeQuelle("sikram", {
            titel: "P260 Zeta-Band",
            art: "regionalspielhilfe",
            offiziell: true,
            url: "https://p260test.example/zeta",
            bezug: "ergaenzend",
            seiten: "144",
            position: 2,
        });
        await legeQuelle("sikram", {
            titel: "P260 Alpha-Abenteuer",
            art: "abenteuer",
            offiziell: true,
            bezug: "ausfuehrlich",
            seiten: "9, 10, 69, 70",
            position: 0,
        });
        await legeQuelle("sikram", {
            titel: "P260 Mitte-Roman",
            art: "roman",
            offiziell: false,
            bezug: "erwaehnung",
            position: 1,
        });
        await legeQuelle("sikram", {
            titel: "P260 Von Hand",
            art: "sonstiges",
            offiziell: false,
            bezug: null,
            position: 3,
        });
        await legeQuelle("sikram", {
            titel: "P260 Stillgelegte Verknüpfung",
            art: "regelbuch",
            offiziell: true,
            bezug: "ergaenzend",
            position: 4,
            still: "verknuepfung",
        });
        await legeQuelle("sikram", {
            titel: "P260 Stillgelegte Quelle",
            art: "regelbuch",
            offiziell: true,
            bezug: "ergaenzend",
            position: 5,
            still: "quelle",
        });
        leereSuchSpeicher();
        leereLeuchtenSpeicher();
    }, 600_000);

    afterAll(async () => {
        await app?.close();
        await raeumeAuf();
        leereSuchSpeicher();
        await database.end({ timeout: 5 });
    }, 60_000);

    /** Der Eintrag, wie das Panel ihn bekommt; wartet, bis die Spalte der Kurzbeschreibung da ist (Migration 0252). */
    const antwort = async (schluessel: string, skip: (hinweis?: string) => void): Promise<SearchEintrag> => {
        if (!spalteDa) skip("wartet auf Migration 0252 (lore_entry.kurzbeschreibung)");
        const eintrag = await eintragFuerPanel(database, eintragPublic[schluessel] as string);
        expect(eintrag, schluessel).toBeDefined();
        return eintrag as SearchEintrag;
    };

    // -------------------------------------------------------------------------------------------------------------------
    // Wo es vorkommt
    // -------------------------------------------------------------------------------------------------------------------

    describe("Wo es vorkommt: Gegenden", () => {
        it("🔴 Wirselkraut: drei Gegenden, jede einmal, ohne Zahl, ohne Griff; Nebelmoor liegt auf drei Ebenen und steht einmal", async ({
            skip,
        }) => {
            const e = await antwort("wirsel", skip);
            expect(e.wo.gegenden.map((g) => kurz(g.name))).toEqual(["Nebelmoor", "Orkland", "Thorwal"]);
            // Das Leuchten kennt fünf Flächen (Nebelmoor dreimal) und den Griff; die Liste nennt sie nicht.
            expect(e.gegenden).toBe(6);
            expect(e.wo.gegenden.some((g) => g.name === "Wald-003")).toBe(false);
            expect(e.wo.weitere).toBeUndefined();
            for (const g of e.wo.gegenden) {
                // Keine Zahl an der Gegend: nur Schlüssel, Name, Art, Beziehung und die Anfrage.
                expect(Object.keys(g).sort()).toEqual(["key", "kind", "name", "relation", "typ", "ziel"]);
                expect(g.kind).toBe("landschaft");
                expect(g.relation).toBe("verbreitung");
            }
            const nebel = e.wo.gegenden.find((g) => kurz(g.name) === "Nebelmoor");
            // Die oberste Ebene gibt die Art: Region vor Topographie vor Vegetation.
            expect(nebel?.typ).toBe("region");
            expect(nebel?.key).toBe("landschaft:p260 nebelmoor");
            expect(nebel?.ziel).toEqual({
                eintrag: eintragPublic["wirsel"],
                landschaften: [regionPublic("nebelA"), regionPublic("nebelB"), regionPublic("nebelC")].sort(),
            });
        });

        it("🔴 `ziel` leuchtet nur diese Gegend: dieselbe Anfrage wie der Chip, ganze Nebelmoor-Flächen und sonst nichts", async ({
            skip,
        }) => {
            const e = await antwort("wirsel", skip);
            const ganz = async (name: string): Promise<string[]> => {
                const ziel = e.wo.gegenden.find((g) => kurz(g.name) === name)?.ziel;
                expect(ziel, name).toBeDefined();
                const lit = await leuchte(database, ziel!);
                expect(lit?.pausiert).toBe(false);
                return [...(lit?.ganz ?? []), ...(lit?.angeschnitten ?? []).map((teil) => teil.publicId)].sort();
            };
            expect(await ganz("Orkland")).toEqual([regionPublic("orkland")]);
            expect(await ganz("Thorwal")).toEqual([regionPublic("thorwal")]);
            expect(await ganz("Nebelmoor")).toEqual(
                [regionPublic("nebelA"), regionPublic("nebelB"), regionPublic("nebelC")].sort(),
            );
        });

        it("Orte des Wikis ohne Kartenbezug stehen als Text in `auchGenannt`: einmal, in der Folge des Artikels, ohne Aventurien", async ({
            skip,
        }) => {
            const e = await antwort("wirsel", skip);
            expect(e.wo.auchGenannt).toEqual(["Der Große Fluss", "Myranor"]);
            expect(e.wo.orte).toEqual([]);
            // Die alten Felder bleiben, wie sie waren.
            expect(e.genanntIn).toEqual(
                expect.arrayContaining(["p260-orkland", "Der Große Fluss", "Myranor", "Aventurien"]),
            );
            expect(e.ziele.length).toBeGreaterThan(0);
        });

        it("🔴 eine Ware: die Herkunft steht vor der Verbreitung, das Gebiet trägt seine Art, der genannte Ort seine Klasse", async ({
            skip,
        }) => {
            const e = await antwort("sikram", skip);
            expect(e.wo.gegenden.map((g) => [kurz(g.name), g.kind, g.typ, g.relation])).toEqual([
                ["Grafschaft Sikram", "gebiet", "Grafschaft", "herkunft"],
                ["Thorwal", "landschaft", "region", "verbreitung"],
            ]);
            expect(e.wo.gegenden[0]?.ziel).toEqual({ eintrag: eintragPublic["sikram"], gebiet: GEBIET });
            expect(e.wo.orte).toEqual([
                { ref: { kind: "place", id: ORT }, name: "P260 Radoleth", klasse: "stadt", relation: "herkunft" },
            ]);
            expect(e.wo.auchGenannt).toEqual([]);
        });

        it("ein genannter Gipfel ist ein Ort mit der Art des Gipfels (Vulkan), sein Objektlink ein Gipfel", async ({
            skip,
        }) => {
            const e = await antwort("feuertier", skip);
            expect(e.wo.orte).toEqual([
                {
                    ref: { kind: "peak", id: GIPFEL },
                    name: "P260 Feuerberg",
                    klasse: "vulkan",
                    relation: "verbreitung",
                },
            ]);
            expect(e.wo.gegenden).toEqual([]);
        });

        it("🔴 Gegenden aus einer Regel stehen hinter den genannten, sind gedeckelt (die größten zuerst) und `weitere` zählt den Rest", async ({
            skip,
        }) => {
            const e = await antwort("steppentier", skip);
            const regel = e.wo.gegenden.filter((g) => g.relation === "regel");
            expect(regel).toHaveLength(SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG);
            expect(regel.every((g) => g.typ === "steppe")).toBe(true);
            // Thorwal steht im Wiki und damit vor allen Regeln.
            expect(e.wo.gegenden[0]).toMatchObject({ name: "P260 Thorwal", relation: "verbreitung" });
            // Die kleinsten sechs fallen weg, die übrigen bleiben; zusammen sind es alle, die leuchten.
            const namen = new Set(regel.map((g) => g.name));
            expect(namen.has(steppe(1).name)).toBe(false);
            expect(namen.has(steppe(6).name)).toBe(false);
            expect(namen.has(steppe(7).name)).toBe(true);
            expect(namen.has(steppe(STEPPEN).name)).toBe(true);
            expect(e.wo.weitere).toBe(6);
            expect(e.wo.gegenden.length + (e.wo.weitere ?? 0)).toBe(e.gegenden);
            // Nach Name geordnet innerhalb der Beziehung.
            const folge = regel.map((g) => g.name);
            expect(folge).toEqual([...folge].sort((a, b) => a.localeCompare(b, "de", { numeric: true })));
        }, 60_000);

        it("nennt der Eintrag nur den Kontinent oder nichts, ist `wo` leer", async ({ skip }) => {
            for (const schluessel of ["nurkontinent", "leer"]) {
                const e = await antwort(schluessel, skip);
                expect(e.wo, schluessel).toEqual({ gegenden: [], orte: [], auchGenannt: [] });
            }
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Stammdaten und Publikationen
    // -------------------------------------------------------------------------------------------------------------------

    describe("Gegenstandstyp, Kontinent, Kurzbeschreibung, Publikationen", () => {
        it("🔴 `typ` ohne Wiki-Auszeichnung (nur Waren), `kontinent` ohne Leerraum am Schrägstrich, `kurzbeschreibung` ohne Auszeichnung", async ({
            skip,
        }) => {
            const ware = await antwort("sikram", skip);
            expect(ware.typ).toBe("Hartwurst");
            expect(ware.kontinent).toBe("Aventurien");
            expect(ware.kurzbeschreibung).toBe("Eine Hartwurst aus der Stadt.");
            const tier = await antwort("feuertier", skip);
            expect(tier.typ).toBeNull();
            expect(tier.kontinent).toBe("Myranor/Güldenland");
            expect(tier.kurzbeschreibung).toBeNull();
            const flora = await antwort("wirsel", skip);
            expect([flora.typ, flora.kontinent, flora.kurzbeschreibung]).toEqual([null, null, null]);
        });

        it("🔴 Publikationen in der Reihenfolge des Wikis, mit Art, Bezug und Seiten; stillgelegte fehlen; eine Quelle von Hand hat keinen Bezug", async ({
            skip,
        }) => {
            const e = await antwort("sikram", skip);
            expect(e.publikationen.map((p) => [p.title, p.type, p.referenceKind, p.pages, p.official])).toEqual([
                ["P260 Alpha-Abenteuer", "abenteuer", "ausfuehrlich", "9, 10, 69, 70", true],
                ["P260 Mitte-Roman", "roman", "erwaehnung", undefined, false],
                ["P260 Zeta-Band", "regionalspielhilfe", "ergaenzend", "144", true],
                ["P260 Von Hand", "sonstiges", undefined, undefined, false],
            ]);
            expect(e.publikationen.find((p) => p.title === "P260 Zeta-Band")?.url).toBe(
                "https://p260test.example/zeta",
            );
            expect(e.publikationen.find((p) => p.title === "P260 Alpha-Abenteuer")?.url).toBeUndefined();
            expect((await antwort("leer", skip)).publikationen).toEqual([]);
        });
    });

    describe("Die Unterseite „Liste“ im Wiki (WI-0299)", () => {
        it("🔴 ein Eintrag mit Liste im Wiki-Stand nennt ihre Adresse neben dem Artikel, einer ohne nennt keine; ohne Wiki-Adresse auch keine", async ({
            skip,
        }) => {
            if (!spalteDa) skip("wartet auf Migration 0252 (lore_entry.kurzbeschreibung)");
            const [spalte] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'wiki_lore_snapshot' AND column_name = 'liste'
            `;
            if ((spalte?.n ?? 0) === 0) skip("wartet auf Migration 0334 (wiki_lore_snapshot.liste)");
            const mit = eintragId["feuertier"] as string;
            const ohne = eintragId["sikram"] as string;
            try {
                await database`UPDATE lore_entry SET wiki_url = 'https://de.wiki-aventurica.de/wiki/P260_Langschwert' WHERE id = ${mit}::bigint`;
                await database`UPDATE lore_entry SET wiki_url = 'https://de.wiki-aventurica.de/wiki/P260_Sikrami' WHERE id = ${ohne}::bigint`;
                await database`INSERT INTO wiki_lore_snapshot (lore_entry_id, liste) VALUES (${mit}::bigint, 'P260 Langschwert/Liste')`;
                await database`INSERT INTO wiki_lore_snapshot (lore_entry_id) VALUES (${ohne}::bigint)`;
                const langschwert = await antwort("feuertier", skip);
                expect(langschwert.wiki?.url).toBe("https://de.wiki-aventurica.de/wiki/P260_Langschwert");
                expect(langschwert.liste).toBe("https://de.wiki-aventurica.de/wiki/P260_Langschwert/Liste");
                expect((await antwort("sikram", skip)).liste).toBeUndefined();
                // Ohne Wiki-Adresse kein Wiki und keine Liste, auch wenn der Stand eine kennt.
                await database`UPDATE lore_entry SET wiki_url = NULL WHERE id = ${mit}::bigint`;
                expect((await antwort("feuertier", skip)).liste).toBeUndefined();
            } finally {
                await database`DELETE FROM wiki_lore_snapshot WHERE lore_entry_id IN (${mit}::bigint, ${ohne}::bigint)`;
                await database`UPDATE lore_entry SET wiki_url = NULL WHERE id IN (${mit}::bigint, ${ohne}::bigint)`;
            }
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Die Route
    // -------------------------------------------------------------------------------------------------------------------

    describe("Route", () => {
        const start = async (): Promise<FastifyInstance> => {
            if (app === undefined) {
                app = buildApp({
                    config: {
                        port: 0,
                        host: "127.0.0.1",
                        releaseId: "test",
                        databaseUrl: undefined,
                        tileRoot: undefined,
                    },
                    database: createDatabase(testDatabaseUrl as string, { max: 3 }),
                });
                await app.ready();
            }
            return app;
        };
        const get = async (url: string, headers: Record<string, string> = {}) =>
            (await start()).inject({ method: "GET", url, headers });

        it("🔴 die neuen Felder überstehen das Antwortschema (Gegenden, Orte mit Objektlink, Publikationen)", async ({
            skip,
        }) => {
            if (!spalteDa) skip("wartet auf Migration 0252 (lore_entry.kurzbeschreibung)");
            const ware = await get(`${SEARCH_EINTRAG_URL}?id=${eintragPublic["sikram"] as string}`);
            expect(ware.statusCode).toBe(200);
            const json = ware.json<SearchEintrag>();
            expect(json.typ).toBe("Hartwurst");
            expect(json.wo.gegenden[0]).toMatchObject({ kind: "gebiet", typ: "Grafschaft", relation: "herkunft" });
            expect(json.wo.gegenden[0]?.ziel).toEqual({ eintrag: eintragPublic["sikram"], gebiet: GEBIET });
            expect(json.wo.orte[0]?.ref).toEqual({ kind: "place", id: ORT });
            expect(json.publikationen).toHaveLength(4);
            expect(json.publikationen[0]).toMatchObject({
                title: "P260 Alpha-Abenteuer",
                referenceKind: "ausfuehrlich",
            });
            const tier = await get(`${SEARCH_EINTRAG_URL}?id=${eintragPublic["feuertier"] as string}`);
            expect(tier.json<SearchEintrag>().wo.orte[0]?.ref).toEqual({ kind: "peak", id: GIPFEL });
            expect(tier.json<SearchEintrag>().kurzbeschreibung).toBeNull();
        });

        it("🔴 der ETag folgt den Texten des Eintrags: eine neue Kurzbeschreibung bricht den 304", async ({ skip }) => {
            if (!spalteDa) skip("wartet auf Migration 0252 (lore_entry.kurzbeschreibung)");
            const url = `${SEARCH_EINTRAG_URL}?id=${eintragPublic["leer"] as string}`;
            const erste = await get(url);
            expect(erste.statusCode).toBe(200);
            const etag = erste.headers["etag"] as string;
            expect((await get(url, { "if-none-match": etag })).statusCode).toBe(304);
            await database`UPDATE lore_entry SET kurzbeschreibung = 'Neu vom WikiSync.' WHERE id = ${eintragId["leer"] as string}::bigint`;
            const danach = await get(url, { "if-none-match": etag });
            expect(danach.statusCode).toBe(200);
            expect(danach.headers["etag"]).not.toBe(etag);
            expect(danach.json<SearchEintrag>().kurzbeschreibung).toBe("Neu vom WikiSync.");
            // Eine neue Quelle bricht ihn ebenso.
            await legeQuelle("leer", {
                titel: "P260 Neu",
                art: "abenteuer",
                offiziell: true,
                bezug: "ergaenzend",
                position: 0,
            });
            const nachQuelle = await get(url, { "if-none-match": danach.headers["etag"] as string });
            expect(nachQuelle.statusCode).toBe(200);
            expect(nachQuelle.json<SearchEintrag>().publikationen.map((p) => p.title)).toEqual(["P260 Neu"]);
        });

        it("🔴 die Liste übersteht das Antwortschema, und eine neue Liste im Wiki-Stand bricht den 304 (WI-0299)", async ({
            skip,
        }) => {
            if (!spalteDa) skip("wartet auf Migration 0252 (lore_entry.kurzbeschreibung)");
            const [spalte] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'wiki_lore_snapshot' AND column_name = 'liste'
            `;
            if ((spalte?.n ?? 0) === 0) skip("wartet auf Migration 0334 (wiki_lore_snapshot.liste)");
            const id = eintragId["wirsel"] as string;
            const url = `${SEARCH_EINTRAG_URL}?id=${eintragPublic["wirsel"] as string}`;
            try {
                await database`UPDATE lore_entry SET wiki_url = 'https://de.wiki-aventurica.de/wiki/P260_Wirsel' WHERE id = ${id}::bigint`;
                await database`INSERT INTO wiki_lore_snapshot (lore_entry_id) VALUES (${id}::bigint)`;
                const erste = await get(url);
                expect(erste.statusCode).toBe(200);
                expect(erste.json<SearchEintrag>().liste).toBeUndefined();
                const etag = erste.headers["etag"] as string;
                await database`UPDATE wiki_lore_snapshot SET liste = 'P260 Wirsel/Liste' WHERE lore_entry_id = ${id}::bigint`;
                const danach = await get(url, { "if-none-match": etag });
                expect(danach.statusCode).toBe(200);
                expect(danach.json<SearchEintrag>().liste).toBe("https://de.wiki-aventurica.de/wiki/P260_Wirsel/Liste");
            } finally {
                await database`DELETE FROM wiki_lore_snapshot WHERE lore_entry_id = ${id}::bigint`;
                await database`UPDATE lore_entry SET wiki_url = NULL WHERE id = ${id}::bigint`;
            }
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Typbilder
    // -------------------------------------------------------------------------------------------------------------------

    describe("Typbilder der Vorkommen", () => {
        it("🔴 die Medienverwaltung zählt je Art die aktiven Einträge, für jede Kartendomäne gleich (lore_entry hat keine map_domain_id)", async () => {
            const liste = await typeImageList(database, MAP_DOMAIN);
            const fremd = await typeImageList(database, "eine-andere-domaene");
            for (const art of ["flora", "fauna", "ware", "spezies"]) {
                const [zeile] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM lore_entry WHERE kind = ${art} AND is_active AND state = 'active'
                `;
                const eintrag = liste.items.find((item) => item.category === art);
                expect(eintrag?.count, art).toBe(zeile?.n);
                expect(eintrag?.objects, art).toBe("other");
                expect(fremd.items.find((item) => item.category === art)?.count, `${art} in der fremden Domäne`).toBe(
                    zeile?.n,
                );
            }
            // Mindestens die eigenen Einträge der Testdatei zählen (zwei Waren, zwei Tiere, eine Pflanze, eine Spezies).
            expect(liste.items.find((item) => item.category === "ware")?.count).toBeGreaterThanOrEqual(2);
            expect(liste.items.find((item) => item.category === "fauna")?.count).toBeGreaterThanOrEqual(2);
        });
    });
});

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    LORE_READING,
    SEARCH_BEISPIELE_URL,
    SEARCH_EINTRAG_URL,
    SEARCH_LEUCHTEN_URL,
    SEARCH_VORKOMMEN_SICHTBAR,
    SEARCH_ZAHLEN_URL,
    type InhalteVorkommenArt,
    type SearchBeispiele,
    type SearchEintrag,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
    type SearchResponse,
    type SearchZahlen,
    type SearchZielGruppe,
    type SearchZielHit,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { beispiele } from "../src/search/beispiele.ts";
import { search } from "../src/search/search.ts";
import { leereSuchSpeicher } from "../src/search/speicher.ts";
import { bereinigeWiki, leereVorkommenIndex, zerlegeSynonyme } from "../src/search/vorkommen-index.ts";
import { anfrageGueltig, leereLeuchtenSpeicher, leuchte, zaehle } from "../src/vorkommen/index.ts";

/**
 * Die Vorkommen in der Spotlight-Suche (WI-0257, S3a) gegen echtes PostGIS: die Sektion „Vorkommen“ (Name, weitere Namen, Gruppe, Deckel, Schalter), die Herrschaftsgebiete, die kurzen Anfragen
 * „Begriff Präposition Ziel“ mit jeder Präposition und der Autovervollständigung, das Leuchten (Regeln UND Ortszeilen, F2, `nurKontinent`, Rahmen, Lage) und die Routen.
 *
 * 🔴 **Die Welt** liegt in `[700, 800] × [100, 200]` und trägt nur Dinge mit der Kennung `25703000-…` (Namen mit „P257S“):
 *
 *     Aventurien (Kontinent, die ganze Welt)   Bornland (Norden, y ≥ 150)   Fürstentum Kosch (Gebiet, x ≤ 730)
 *     Waldgrund (Wald in Bornland)   Weitwald (Wald im Süden, im Gebiet)   Randwald (Wald über der Grenze von Bornland)   Wald-925 (ein Griff)
 *     Weite (Steppe in Bornland)   Hochgebirge   Zwillinge (zwei gleichnamige Landschaften)
 *     Orte: Mitte (750/150), Südstadt (720/120, im Weitwald), Nordburg (750/180), Wirtshaus (720/175, im Waldgrund)
 *
 * Die Einträge (Name: Regel; Ortszeilen):
 * - Baum: Wald in Aventurien; Kontinentzeile (F2: tritt hinter die Regel zurück).
 * - Kraut: Steppe in Bornland; Zeile Bornland (F2: tritt zurück), Zeile am Wirtshaus (bleibt).
 * - Wirsel (weitere Namen „Wirselmoos“, „Kleiner Wirsel“; Gruppe Gras): keine Regel; Zeilen Aventurien, Bornland, Fürstentum Kosch, Wirtshaus, eine ohne Ziel.
 * - Nur: nur die Kontinentzeile. Nichts: weder Regel noch Zeile.
 * - Ohne: Wald in Aventurien ohne Wald in Bornland. Klima: eine Regel nur mit Lage (nördlich von Mitte), ohne Landschaftsart.
 * - Skorpion (fauna, Zeile Bornland) und Skorpion (ware, ohne alles): derselbe Name, zwei Arten.
 * - Gipfeltier: Zeile am Gipfel (770/125). Süßer Käfer: Name mit Akzent.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MAP_DOMAIN = "aventuria";
const PREFIX = "25703000-0000-4000-8000-";
const uuid = (nummer: number): string => `${PREFIX}${String(nummer).padStart(12, "0")}`;
const KEY = "p257s-";
const rechteck = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

interface RegionDef {
    nummer: number;
    name: string;
    ebene: string;
    art: string;
    wkt: string;
    verborgen?: boolean;
}

const REGIONEN: Record<string, RegionDef> = {
    kontinent: {
        nummer: 1,
        name: "P257S Aventurien",
        ebene: "derographisch",
        art: "kontinent",
        wkt: rechteck(700, 100, 800, 200),
    },
    bornland: {
        nummer: 2,
        name: "P257S Bornland",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(700, 150, 800, 200),
    },
    waldA: { nummer: 3, name: "P257S Waldgrund", ebene: "vegetation", art: "wald", wkt: rechteck(710, 160, 730, 190) },
    waldB: { nummer: 4, name: "P257S Weitwald", ebene: "vegetation", art: "wald", wkt: rechteck(710, 110, 730, 130) },
    waldC: { nummer: 5, name: "P257S Randwald", ebene: "vegetation", art: "wald", wkt: rechteck(740, 140, 760, 170) },
    steppe: { nummer: 6, name: "P257S Weite", ebene: "vegetation", art: "steppe", wkt: rechteck(770, 160, 795, 190) },
    gebirge: {
        nummer: 7,
        name: "P257S Hochgebirge",
        ebene: "topographie",
        art: "gebirge",
        wkt: rechteck(750, 120, 790, 148),
    },
    zwilling1: {
        nummer: 8,
        name: "P257S Zwillinge",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(790, 105, 800, 115),
    },
    zwilling2: {
        nummer: 9,
        name: "P257S Zwillinge",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(780, 105, 790, 115),
    },
    // Ein Griff ist kein Name: Er leuchtet, wo er trifft, steht aber nie als Ziel da.
    griff: { nummer: 10, name: "Wald-925", ebene: "vegetation", art: "wald", wkt: rechteck(760, 170, 765, 175) },
    verborgen: {
        nummer: 11,
        name: "P257S Versteckt",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(700, 100, 705, 105),
        verborgen: true,
    },
};

const ORTE: Record<string, { nummer: number; name: string; x: number; y: number; verborgen?: boolean }> = {
    mitte: { nummer: 201, name: "P257S Mitte", x: 750, y: 150 },
    suedstadt: { nummer: 202, name: "P257S Südstadt", x: 720, y: 120 },
    nordburg: { nummer: 203, name: "P257S Nordburg", x: 750, y: 180 },
    wirtshaus: { nummer: 204, name: "P257S Wirtshaus", x: 720, y: 175 },
    verborgen: { nummer: 205, name: "P257S Geheimort", x: 780, y: 130, verborgen: true },
};

const GEBIET_KOSCH = uuid(300);
const GEBIET_FORMLOS = uuid(301);
const GIPFEL = uuid(310);

describeWithDatabase("Die Vorkommen in der Spotlight-Suche (WI-0257 S3a) gegen PostGIS", () => {
    let database: Database;
    let app: FastifyInstance | undefined;
    const regionId: Record<string, string> = {};
    const ortId: Record<string, string> = {};
    const eintragId: Record<string, string> = {};
    const eintragPublic: Record<string, string> = {};
    let gebietKoschId = "";
    let gipfelId = "";
    let regelNummer = 0;
    const regionPublic = (name: string): string => uuid((REGIONEN[name] as RegionDef).nummer);
    const ortPublic = (name: string): string => uuid((ORTE[name] as { nummer: number }).nummer);

    interface Glied {
        op?: "und" | "oder" | "ohne";
        flaeche?: string;
        arten?: [string, string][];
        lage?: { richtung: string; ort: string };
    }

    async function legeEintrag(
        schluessel: string,
        name: string,
        art: string,
        extra: { gruppe?: string; synonyme?: string } = {},
    ): Promise<void> {
        const [zeile] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO lore_entry (wiki_key, kind, name, gruppe, synonyme, legacy_origin, source_system)
            VALUES (${KEY + schluessel}, ${art}, ${name}, ${extra.gruppe ?? null}, ${extra.synonyme ?? null}, 'manual', 'test')
            RETURNING id::text AS id, public_id::text AS public_id
        `;
        eintragId[schluessel] = (zeile as { id: string }).id;
        eintragPublic[schluessel] = (zeile as { public_id: string }).public_id;
    }

    async function legeRegel(schluessel: string, beziehung: string, glieder: Glied[]): Promise<void> {
        regelNummer += 1;
        const key = createHash("sha256")
            .update(`${schluessel}|${beziehung}|${String(regelNummer)}`)
            .digest("hex");
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, source_system)
            VALUES (${eintragId[schluessel] as string}, ${key}, ${beziehung}, ${regelNummer}, 'manual', 'test') RETURNING id::text AS id
        `;
        for (const [seq, glied] of glieder.entries()) {
            const [term] = await database<{ id: string }[]>`
                INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id, line_direction, line_place_a_id)
                VALUES (${(zeile as { id: string }).id}, ${seq}, ${glied.op ?? "und"},
                        ${glied.flaeche === undefined ? null : (regionId[glied.flaeche] as string)},
                        ${glied.lage?.richtung ?? null}, ${glied.lage === undefined ? null : (ortId[glied.lage.ort] as string)})
                RETURNING id::text AS id
            `;
            for (const [ebene, art] of glied.arten ?? []) {
                await database`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${(term as { id: string }).id}, ${ebene}, ${art})`;
            }
        }
    }

    type Ziel = { region: string } | { ort: string } | { gebiet: true } | { gipfel: true } | { keins: true };

    /** Eine Ortszeile mit genau einem Ziel (oder keinem: eine Zeile, die nicht aufgelöst werden konnte). */
    async function legeZeile(
        schluessel: string,
        wiki: string,
        beziehung: string,
        ziel: Ziel,
        kontinent = false,
    ): Promise<void> {
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, legacy_origin, source_system)
            VALUES (${eintragId[schluessel] as string}, ${wiki}, ${beziehung}, ${wiki}, 0, ${kontinent ? "continent" : "other"},
                    ${"keins" in ziel ? "unmatched" : "resolved"}, ${"keins" in ziel ? 0 : 1}, 'manual', 'test')
            RETURNING id::text AS id
        `;
        const id = (zeile as { id: string }).id;
        if ("region" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, region_id) VALUES (${id}::bigint, ${regionId[ziel.region] as string}::bigint)`;
        } else if ("ort" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, place_id) VALUES (${id}::bigint, ${ortId[ziel.ort] as string}::bigint)`;
        } else if ("gebiet" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, territory_id) VALUES (${id}::bigint, ${gebietKoschId}::bigint)`;
        } else if ("gipfel" in ziel) {
            await database`INSERT INTO lore_place_target (lore_place_id, terrain_peak_id) VALUES (${id}::bigint, ${gipfelId}::bigint)`;
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
        await database.unsafe(
            `DELETE FROM territory_shape WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '${PREFIX}%')`,
        );
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM terrain_peak WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM region_area WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM region WHERE public_id::text LIKE '${PREFIX}%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '${PREFIX}%'`);
        await database`DELETE FROM content_switch WHERE key = 'panel.lore.flora'`;
    }

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await raeumeAuf();
        const [fremd] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM region_area a WHERE a.is_active AND a.geom && ST_MakeEnvelope(690, 90, 810, 210, 0)
        `;
        expect(fremd?.n, "fremde Flächen in der Welt der Testdatei (die Testdatenbank ist nicht leer genug)").toBe(0);

        for (const [name, def] of Object.entries(REGIONEN)) {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, is_hidden)
                VALUES (${uuid(def.nummer)}, ${MAP_DOMAIN}, ${def.name}, ${def.ebene}, ${def.art}, TRUE, ${def.verborgen ?? false})
                RETURNING id::text AS id
            `;
            regionId[name] = (zeile as { id: string }).id;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${uuid(def.nummer + 100)}, ${MAP_DOMAIN}, ${regionId[name] as string}, ST_GeomFromText(${def.wkt}, 0), TRUE)
            `;
        }
        for (const [name, def] of Object.entries(ORTE)) {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
                VALUES (${uuid(def.nummer)}, ${MAP_DOMAIN}, ${def.name}, 'dorf', ST_SetSRID(ST_MakePoint(${def.x}, ${def.y}), 0), 'test', TRUE, ${def.verborgen ?? false})
                RETURNING id::text AS id
            `;
            ortId[name] = (zeile as { id: string }).id;
        }
        const [gipfel] = await database<{ id: string }[]>`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, is_active, source_system)
            VALUES (${GIPFEL}, ${MAP_DOMAIN}, 'P257S Gipfel', 'berggipfel', ST_SetSRID(ST_MakePoint(770, 125), 0), TRUE, 'test')
            RETURNING id::text AS id
        `;
        gipfelId = (gipfel as { id: string }).id;
        // Ein Gebiet mit Form (der Westen der Welt) und eines ohne: Gebiete ohne Form sind keine Treffer.
        const [kosch] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, territory_type, color, opacity, wiki_key, is_active, source_system)
            VALUES (${GEBIET_KOSCH}, ${MAP_DOMAIN}, 'Fürstentum P257S Kosch', 'Fürstentum', '#B2B065', 0.7, NULL, TRUE, 'test')
            RETURNING id::text AS id
        `;
        gebietKoschId = (kosch as { id: string }).id;
        await database.unsafe(
            `INSERT INTO territory_shape (band, territory_id, depth, source_count, area, geom, render_geom, label_geom)
             VALUES (8, $1, 0, 1, 3000, ST_GeomFromText($2, 0), ST_SetSRID(ST_GeomFromText($2), 3857), ST_SetSRID(ST_MakePoint(715, 150), 0))`,
            [gebietKoschId, rechteck(700, 100, 730, 200)],
        );
        await database`
            INSERT INTO territory (public_id, map_domain_id, name, territory_type, color, opacity, wiki_key, is_active, source_system)
            VALUES (${GEBIET_FORMLOS}, ${MAP_DOMAIN}, 'P257S Formlos', 'Baronie', '#B2B065', 0.7, NULL, TRUE, 'test')
        `;

        const wald: [string, string][] = [["vegetation", "wald"]];
        await legeEintrag("baum", "P257S Baum", "flora");
        await legeEintrag("kraut", "P257S Kraut", "flora");
        await legeEintrag("wirsel", "P257S Wirsel", "flora", {
            gruppe: "[[Gras]]",
            synonyme: "Wirselmoos; ''Kleiner Wirsel'' ([[Tulamidya|tulamidisch]])",
        });
        await legeEintrag("nur", "P257S Nur", "fauna");
        await legeEintrag("nichts", "P257S Nichts", "ware", { gruppe: "profan" });
        await legeEintrag("ohne", "P257S Ohne", "spezies");
        await legeEintrag("klima", "P257S Klima", "flora");
        await legeEintrag("skorpionF", "P257S Skorpion", "fauna");
        await legeEintrag("skorpionW", "P257S Skorpion", "ware");
        await legeEintrag("gipfeltier", "P257S Gipfeltier", "fauna");
        await legeEintrag("kaefer", "P257S Süßer Käfer", "fauna");
        for (let i = 1; i <= 7; i += 1) await legeEintrag(`deckel${String(i)}`, `P257S Deckel ${String(i)}`, "ware");

        await legeRegel("baum", "verbreitung", [{ arten: wald, flaeche: "kontinent" }]);
        await legeRegel("kraut", "verbreitung", [{ arten: [["vegetation", "steppe"]], flaeche: "bornland" }]);
        await legeRegel("ohne", "verbreitung", [
            { arten: wald, flaeche: "kontinent" },
            { op: "ohne", arten: wald, flaeche: "bornland" },
        ]);
        await legeRegel("klima", "verbreitung", [{ lage: { richtung: "nord", ort: "mitte" } }]);

        await legeZeile("baum", "aventurien", "verbreitung", { region: "kontinent" }, true);
        await legeZeile("kraut", "p257s-bornland", "verbreitung", { region: "bornland" });
        await legeZeile("kraut", "p257s-wirtshaus", "verbreitung", { ort: "wirtshaus" });
        await legeZeile("wirsel", "aventurien", "verbreitung", { region: "kontinent" }, true);
        await legeZeile("wirsel", "p257s-bornland", "verbreitung", { region: "bornland" });
        await legeZeile("wirsel", "p257s-kosch", "verbreitung", { gebiet: true });
        await legeZeile("wirsel", "p257s-wirtshaus", "verbreitung", { ort: "wirtshaus" });
        await legeZeile("wirsel", "p257s-unbekannt", "verbreitung", { keins: true });
        await legeZeile("nur", "aventurien", "verbreitung", { region: "kontinent" }, true);
        await legeZeile("skorpionF", "p257s-bornland", "verbreitung", { region: "bornland" });
        await legeZeile("gipfeltier", "p257s-gipfel", "verbreitung", { gipfel: true });
        // Eine verborgene Landschaft und ein verborgener Ort sind keine Ziele einer Zeile.
        await legeZeile("kaefer", "p257s-versteckt", "verbreitung", { region: "verborgen" });
        await legeZeile("kaefer", "p257s-geheimort", "verbreitung", { ort: "verborgen" });
        leereSuchSpeicher();
    }, 180_000);

    afterAll(async () => {
        await app?.close();
        await raeumeAuf();
        leereSuchSpeicher();
        await database.end({ timeout: 5 });
    }, 60_000);

    afterEach(() => {
        LORE_READING.ortszeileHinterRegel = true;
        leereSuchSpeicher();
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Hilfen
    // -------------------------------------------------------------------------------------------------------------------

    const kurz = (name: string): string => name.replace("P257S ", "");
    const ausgeblendet = (...arten: InhalteVorkommenArt[]): ((art: InhalteVorkommenArt) => boolean) => {
        const aus = new Set(arten);
        return (art) => aus.has(art);
    };
    const sucheMit = async (q: string, aus?: (art: InhalteVorkommenArt) => boolean): Promise<SearchResponse> =>
        search(database, q, aus === undefined ? {} : { ausgeblendet: aus });
    const frage = async (anfrage: SearchLeuchtAnfrage, aus?: (art: InhalteVorkommenArt) => boolean) =>
        leuchte(database, anfrage, aus === undefined ? {} : { ausgeblendet: aus });
    const gruppeVon = (antwort: SearchResponse, art: SearchZielGruppe["art"]): SearchZielGruppe | undefined =>
        antwort.anfrage?.ziele?.find((gruppe) => gruppe.art === art);
    const hitNamen = (gruppe: SearchZielGruppe | undefined): string[] =>
        (gruppe?.hits ?? []).map((hit) => kurz(hit.name));
    const hitVon = (gruppe: SearchZielGruppe | undefined, name: string): SearchZielHit | undefined =>
        gruppe?.hits.find((hit) => kurz(hit.name) === name);
    const ganzNamen = (antwort: SearchLeuchten | undefined): string[] => {
        const nachId = new Map(
            Object.keys(REGIONEN).map((name) => [regionPublic(name), kurz((REGIONEN[name] as RegionDef).name)]),
        );
        return (antwort?.ganz ?? []).map((id) => nachId.get(id) ?? id).sort();
    };
    const zugeschnittenNamen = (antwort: SearchLeuchten | undefined): string[] =>
        (antwort?.angeschnitten ?? []).map((teil) => kurz(teil.name)).sort();
    const orteNamen = (antwort: SearchLeuchten | undefined): string[] =>
        (antwort?.orte ?? []).map((ort) => kurz(ort.name)).sort();

    // -------------------------------------------------------------------------------------------------------------------
    // Hilfsfunktionen ohne Datenbank
    // -------------------------------------------------------------------------------------------------------------------

    describe("Wiki-Auszeichnung in Gruppe und weiteren Namen", () => {
        it("nimmt Verweise, Hochkommata, HTML und einzelne Klammern heraus", () => {
            expect(bereinigeWiki("[[Gras]]")).toBe("Gras");
            expect(bereinigeWiki("[[Seeschlange (Wasserschlange)|Seeschlange]]")).toBe("Seeschlange");
            expect(bereinigeWiki("''Anti-Aquamarin'', [[Charyptonithum]]")).toBe("Anti-Aquamarin, Charyptonithum");
            expect(bereinigeWiki("Metall <small>(aus der [[Fünfte Sphäre|Fünften Sphäre]])</small>")).toBe(
                "Metall (aus der Fünften Sphäre)",
            );
            expect(bereinigeWiki("]]")).toBe("");
        });

        it("teilt die weiteren Namen an Komma und Semikolon, aber nie in einer Klammer", () => {
            expect(zerlegeSynonyme("Kra'Drakh (Maraskan), Praiobobote (Uthuria)")).toEqual([
                "Kra'Drakh (Maraskan)",
                "Praiobobote (Uthuria)",
            ]);
            expect(zerlegeSynonyme("A (x, y); B")).toEqual(["A (x, y)", "B"]);
            expect(zerlegeSynonyme("]]")).toEqual([]);
        });
    });

    describe("Die Anfrage an das Leuchten", () => {
        it("verlangt genau eines von Eintrag und Art, eine Art nur mit Rahmen und Orte nur mit Lage", () => {
            const eintrag = uuid(1);
            expect(anfrageGueltig({ eintrag })).toBe(true);
            expect(anfrageGueltig({ eintrag, art: "wald" })).toBe(false);
            expect(anfrageGueltig({})).toBe(false);
            expect(anfrageGueltig({ art: "wald" })).toBe(false);
            expect(anfrageGueltig({ art: "gibtesnicht", gebiet: uuid(300) })).toBe(false);
            expect(anfrageGueltig({ art: "wald", gebiet: uuid(300) })).toBe(true);
            expect(anfrageGueltig({ eintrag, orte: [uuid(201)] })).toBe(false);
            expect(anfrageGueltig({ eintrag, lage: "sued" })).toBe(false);
            expect(anfrageGueltig({ eintrag, lage: "zwischen", orte: [uuid(201)] })).toBe(false);
            expect(anfrageGueltig({ eintrag, lage: "zwischen", orte: [uuid(201), uuid(202)] })).toBe(true);
            expect(anfrageGueltig({ eintrag, lage: "zwischen", orte: [uuid(201), uuid(201)] })).toBe(false);
            expect(anfrageGueltig({ eintrag, lage: "sued", orte: [uuid(201), uuid(202)] })).toBe(false);
            expect(anfrageGueltig({ eintrag: "kein-uuid" })).toBe(false);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Die Sektion „Vorkommen“
    // -------------------------------------------------------------------------------------------------------------------

    describe("Sektion „Vorkommen“", () => {
        it("findet über den Namen, ohne Rücksicht auf Groß und Klein und Akzente", async () => {
            for (const q of [
                "p257s süßer käfer",
                "P257S SUSSER KAFER",
                "p257s susser kafer",
                "süßer käfer",
                "sußer KÄFER",
            ]) {
                const antwort = await sucheMit(q);
                expect(
                    antwort.vorkommen?.hits.map((hit) => kurz(hit.name)),
                    q,
                ).toEqual(["Süßer Käfer"]);
                expect(antwort.vorkommen?.hits[0]).toMatchObject({ gefundenIn: "name", kind: "fauna" });
            }
        });

        it("findet über die weiteren Namen und zeigt den getroffenen, ohne Auszeichnung", async () => {
            const gras = await sucheMit("wirselmoos");
            expect(gras.vorkommen?.hits).toHaveLength(1);
            expect(gras.vorkommen?.hits[0]).toMatchObject({ gefundenIn: "synonym", synonym: "Wirselmoos" });
            expect(kurz(gras.vorkommen?.hits[0]?.name ?? "")).toBe("Wirsel");
            const klein = await sucheMit("kleiner wirsel");
            expect(klein.vorkommen?.hits[0]).toMatchObject({
                gefundenIn: "synonym",
                synonym: "Kleiner Wirsel (tulamidisch)",
            });
        });

        it("findet über die Gruppe, die ohne Auszeichnung dasteht", async () => {
            const antwort = await sucheMit("gras");
            const wirsel = antwort.vorkommen?.hits.find((hit) => kurz(hit.name) === "Wirsel");
            expect(wirsel).toMatchObject({ gefundenIn: "gruppe", gruppe: "Gras" });
            // Nach den Namen: ein Treffer im Namen steht vor einem in der Gruppe.
            const anfang = await sucheMit("p257s wirsel");
            expect(anfang.vorkommen?.hits[0]).toMatchObject({ gefundenIn: "name" });
        });

        it("ordnet: genauer Name vor Anfang vor Wortanfang vor enthaltenem; bei gleicher Güte erst die mit Kartenbezug", async () => {
            const antwort = await sucheMit("p257s skorpion");
            expect(antwort.vorkommen?.hits.map((hit) => [kurz(hit.name), hit.kind, hit.kartenbezug])).toEqual([
                ["Skorpion", "fauna", true],
                ["Skorpion", "ware", false],
            ]);
        });

        it("🔴 höchstens fünf sichtbar, die Gesamtzahl daneben („… und N weitere“)", async () => {
            const antwort = await sucheMit("p257s deckel");
            expect(antwort.vorkommen?.hits).toHaveLength(SEARCH_VORKOMMEN_SICHTBAR);
            expect(antwort.vorkommen?.total).toBe(7);
        });

        it("sagt, ob der Eintrag einen Kartenbezug hat (Regel oder aufgelöste Ortszeile)", async () => {
            const nachName = async (q: string) => (await sucheMit(q)).vorkommen?.hits[0]?.kartenbezug;
            expect(await nachName("p257s baum")).toBe(true);
            expect(await nachName("p257s wirsel")).toBe(true);
            expect(await nachName("p257s nur")).toBe(true);
            expect(await nachName("p257s nichts")).toBe(false);
        });

        it("trägt die Anfrage an das Leuchten", async () => {
            const hit = (await sucheMit("p257s baum")).vorkommen?.hits[0];
            expect(hit?.leuchten).toEqual({ eintrag: eintragPublic["baum"] });
            expect(hit?.id).toBe(eintragPublic["baum"]);
        });

        it("🔴 die Inhaltsschalter je Art gelten: eine ausgeblendete Art fehlt, die Gesamtzahl zählt sie nicht", async () => {
            const alle = await sucheMit("p257s");
            const ohneFlora = await sucheMit("p257s", ausgeblendet("flora"));
            expect(ohneFlora.vorkommen?.hits.some((hit) => hit.kind === "flora")).toBe(false);
            expect(ohneFlora.vorkommen?.total).toBe((alle.vorkommen?.total ?? 0) - 4);
            const nurFlora = await sucheMit("p257s kraut", ausgeblendet("flora"));
            expect(nurFlora.vorkommen).toBeUndefined();
            // Auch als Begriff einer kurzen Anfrage ist sie nicht da.
            const begriff = await sucheMit("p257s kraut in", ausgeblendet("flora"));
            expect(begriff.anfrage).toBeUndefined();
        });

        it("🔴 ein Treffer ohne Vorkommen lässt die Antwort wie vor S3a: keine neuen Felder", async () => {
            const antwort = await sucheMit("qqqqzzzz");
            expect(Object.keys(antwort).sort()).toEqual(["hits", "query", "truncated"]);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Herrschaftsgebiete
    // -------------------------------------------------------------------------------------------------------------------

    describe("Herrschaftsgebiete als Suchtreffer", () => {
        it("findet ein Gebiet mit Form, mit Rahmen für den Flug und dem Punkt seiner Beschriftung", async () => {
            const antwort = await sucheMit("kosch");
            const hit = antwort.gebiete?.hits.find((eintrag) => eintrag.id === GEBIET_KOSCH);
            expect(hit).toMatchObject({ name: "Fürstentum P257S Kosch", typ: "Fürstentum", x: 715, y: 150 });
            expect(hit?.bounds).toEqual([700, 100, 730, 200]);
        });

        it("🔴 ein Gebiet ohne Form ist kein Treffer", async () => {
            const antwort = await sucheMit("p257s formlos");
            expect(antwort.gebiete).toBeUndefined();
        });

        it("steht neben der Trefferliste, nicht in ihr: der gemeinsame Deckel bleibt unberührt", async () => {
            const antwort = await sucheMit("kosch");
            expect(antwort.hits.some((hit) => hit.id === GEBIET_KOSCH)).toBe(false);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Das Leuchten
    // -------------------------------------------------------------------------------------------------------------------

    describe("Leuchten eines Eintrags: Regeln und Ortszeilen zusammen", () => {
        it("🔴 Regel ohne Ortszeile: alle Wälder leuchten ganz, auch der mit Griff (er leuchtet, steht aber nie als Name da)", async () => {
            const antwort = await frage({ eintrag: eintragPublic["baum"] as string });
            expect(ganzNamen(antwort)).toEqual(["Randwald", "Waldgrund", "Weitwald", "Wald-925"].sort());
            expect(antwort?.gegenden).toBe(4);
            expect(antwort?.nurKontinent).toBe(false);
            expect(antwort?.pausiert).toBe(false);
            expect(antwort?.begriff).toMatchObject({ kind: "flora", eintrag: eintragPublic["baum"] });
        });

        it("🔴 F2: die Zeile Bornland tritt hinter die Regel „Steppe in Bornland“ zurück, die Zeile am Wirtshaus bleibt", async () => {
            const antwort = await frage({ eintrag: eintragPublic["kraut"] as string });
            expect(ganzNamen(antwort)).toEqual(["Weite"]);
            expect(orteNamen(antwort)).toEqual(["Wirtshaus"]);
            expect(antwort?.gegenden).toBe(1);
        });

        it("🔴 F2 aus: die Zeile Bornland gilt neben der Regel (Vereinigung)", async () => {
            LORE_READING.ortszeileHinterRegel = false;
            const antwort = await frage({ eintrag: eintragPublic["kraut"] as string });
            expect(ganzNamen(antwort)).toEqual(["Bornland", "Weite"]);
            expect(antwort?.gegenden).toBe(2);
        });

        it("Ortszeilen ohne Regel: Landschaft, Gebiet und Ort leuchten, die Kontinentzeile nicht (D5), eine Zeile ohne Ziel nichts", async () => {
            const antwort = await frage({ eintrag: eintragPublic["wirsel"] as string });
            expect(ganzNamen(antwort)).toEqual(["Bornland"]);
            expect(antwort?.gebiete.ganz).toEqual([GEBIET_KOSCH]);
            expect(orteNamen(antwort)).toEqual(["Wirtshaus"]);
            expect(antwort?.gegenden).toBe(2);
            expect(antwort?.nurKontinent).toBe(false);
            expect(antwort?.kontinent).toBeUndefined();
            // Der Rahmen umfasst alles, was leuchtet: Bornland (y ab 150), das Gebiet (x bis 730), das Wirtshaus.
            expect(antwort?.rahmen).toEqual({ x0: 700, y0: 100, x1: 800, y1: 200 });
        });

        it("🔴 nur die Kontinentzeile: nichts leuchtet gefüllt, `nurKontinent` und der Kontinent als Umriss", async () => {
            const antwort = await frage({ eintrag: eintragPublic["nur"] as string });
            expect(antwort).toMatchObject({
                nurKontinent: true,
                gegenden: 0,
                rahmen: null,
                ganz: [],
                angeschnitten: [],
            });
            expect(antwort?.kontinent).toMatchObject({
                publicId: regionPublic("kontinent"),
                name: "P257S Aventurien",
                rahmen: { x0: 700, y0: 100, x1: 800, y1: 200 },
            });
        });

        it("🔴 nur die Kontinentzeile, aber mit Rahmen: was überall vorkommt, kommt dort vor – der Rahmen leuchtet", async () => {
            const antwort = await frage({
                eintrag: eintragPublic["nur"] as string,
                landschaften: [regionPublic("bornland")],
            });
            expect(antwort?.nurKontinent).toBe(false);
            expect(antwort?.gegenden).toBe(1);
            expect(zugeschnittenNamen(antwort)).toEqual(["Aventurien"]);
            expect(antwort?.rahmen).toEqual({ x0: 700, y0: 150, x1: 800, y1: 200 });
        });

        it("`ohne`: die Regel „Wald in Aventurien ohne Wald in Bornland“ lässt Bornland aus, ein Wald über der Grenze ist angeschnitten", async () => {
            const antwort = await frage({ eintrag: eintragPublic["ohne"] as string });
            expect(ganzNamen(antwort)).toEqual(["Weitwald"]);
            expect(zugeschnittenNamen(antwort)).toEqual(["Randwald"]);
            const rand = antwort?.angeschnitten[0];
            // Der Randwald reicht von y 140 bis 170; der Teil unter der Grenze (y 150) bleibt.
            expect(rand?.rahmen).toEqual({ x0: 740, y0: 140, x1: 760, y1: 150 });
            expect(rand?.form.type).toBe("Polygon");
        });

        it("eine Regel nur mit Lage trifft keine Landschaft: ihr Teil der Karte steht in `rest`", async () => {
            const antwort = await frage({ eintrag: eintragPublic["klima"] as string });
            expect(antwort?.gegenden).toBe(0);
            expect(antwort?.rest?.rahmen.y0).toBeGreaterThanOrEqual(150);
            expect(antwort?.rahmen).not.toBeNull();
        });

        it("ein Gipfel ist ein genannter Ort", async () => {
            const antwort = await frage({ eintrag: eintragPublic["gipfeltier"] as string });
            expect(antwort?.orte).toEqual([{ id: GIPFEL, name: "P257S Gipfel", art: "gipfel", x: 770, y: 125 }]);
        });

        it("eine verborgene Landschaft und ein verborgener Ort leuchten nicht", async () => {
            const antwort = await frage({ eintrag: eintragPublic["kaefer"] as string });
            expect(antwort).toMatchObject({ gegenden: 0, orte: [], ganz: [], nurKontinent: false });
        });

        it("ohne Regel und Zeile leuchtet nichts", async () => {
            const antwort = await frage({ eintrag: eintragPublic["nichts"] as string });
            expect(antwort).toMatchObject({ gegenden: 0, orte: [], rahmen: null, nurKontinent: false });
        });

        it("ein unbekannter Eintrag, Rahmen oder Ort ist `undefined`; eine ungültige Anfrage wirft", async () => {
            expect(await frage({ eintrag: uuid(9999) })).toBeUndefined();
            expect(
                await frage({ eintrag: eintragPublic["baum"] as string, landschaften: [uuid(9999)] }),
            ).toBeUndefined();
            expect(await frage({ eintrag: eintragPublic["baum"] as string, gebiet: GEBIET_FORMLOS })).toBeUndefined();
            expect(
                await frage({ eintrag: eintragPublic["baum"] as string, lage: "sued", orte: [uuid(9999)] }),
            ).toBeUndefined();
            await expect(frage({})).rejects.toThrow();
        });

        it("🔴 die Inhaltsschalter je Art gelten: eine ausgeblendete Art antwortet leer, mit `pausiert` und ohne ihren Namen", async () => {
            const antwort = await frage({ eintrag: eintragPublic["baum"] as string }, ausgeblendet("flora"));
            expect(antwort).toMatchObject({ pausiert: true, titel: "", ganz: [], gegenden: 0, rahmen: null });
            expect(antwort?.begriff).toEqual({ name: "" });
            // Eine andere Art bleibt.
            const fauna = await frage({ eintrag: eintragPublic["skorpionF"] as string }, ausgeblendet("flora"));
            expect(fauna?.pausiert).toBe(false);
        });

        it("kommt aus dem Zwischenspeicher: dasselbe Objekt beim zweiten Abruf", async () => {
            const a = await frage({ eintrag: eintragPublic["baum"] as string });
            const b = await frage({ eintrag: eintragPublic["baum"] as string });
            expect(b).toBe(a);
        });
    });

    describe("Leuchten mit Rahmen und Lage", () => {
        it("🔴 „in Bornland“: ganze Gegenden bleiben ganz, eine über die Grenze wird zugeschnitten, was außerhalb liegt, fällt weg", async () => {
            const antwort = await frage({
                eintrag: eintragPublic["baum"] as string,
                landschaften: [regionPublic("bornland")],
            });
            expect(ganzNamen(antwort)).toEqual(["Waldgrund", "Wald-925"].sort());
            expect(zugeschnittenNamen(antwort)).toEqual(["Randwald"]);
            expect(antwort?.angeschnitten[0]?.rahmen).toEqual({ x0: 740, y0: 150, x1: 760, y1: 170 });
            expect(antwort?.titel).toBe("P257S Baum in P257S Bornland");
            expect(antwort?.gegenden).toBe(3);
        });

        it("🔴 in einem Herrschaftsgebiet: seine feinste Form ist der Rahmen", async () => {
            const antwort = await frage({ eintrag: eintragPublic["baum"] as string, gebiet: GEBIET_KOSCH });
            expect(ganzNamen(antwort)).toEqual(["Waldgrund", "Weitwald"]);
            expect(antwort?.titel).toBe("P257S Baum in Fürstentum P257S Kosch");
        });

        it("auch die Ortszeilen werden zugeschnitten: das Gebiet im Norden angeschnitten, das Wirtshaus bleibt, der Rest fällt", async () => {
            const antwort = await frage({
                eintrag: eintragPublic["wirsel"] as string,
                landschaften: [regionPublic("bornland")],
            });
            expect(ganzNamen(antwort)).toEqual(["Bornland"]);
            expect(antwort?.gebiete.ganz).toEqual([]);
            expect(antwort?.gebiete.angeschnitten.map((teil) => teil.publicId)).toEqual([GEBIET_KOSCH]);
            expect(antwort?.gebiete.angeschnitten[0]?.rahmen).toEqual({ x0: 700, y0: 150, x1: 730, y1: 200 });
            expect(orteNamen(antwort)).toEqual(["Wirtshaus"]);
        });

        it("ein Ort außerhalb des Rahmens fällt weg", async () => {
            const antwort = await frage({
                eintrag: eintragPublic["wirsel"] as string,
                lage: "sued",
                orte: [ortPublic("mitte")],
            });
            expect(orteNamen(antwort)).toEqual([]);
            // Bornland liegt ganz im Norden und berührt die Linie nur: Es leuchtet nicht.
            expect(ganzNamen(antwort)).toEqual([]);
            expect(antwort?.gebiete.angeschnitten.map((teil) => teil.publicId)).toEqual([GEBIET_KOSCH]);
        });

        it("🔴 jede Lage, auf eine Landschaftsart: Halbebene durch den Ort, die Linie gehört dazu", async () => {
            const art = async (lage: "nord" | "sued" | "ost" | "west") =>
                frage({ art: "wald", lage, orte: [ortPublic("mitte")] });
            const nord = await art("nord");
            expect(ganzNamen(nord)).toEqual(["Waldgrund", "Wald-925"].sort());
            expect(zugeschnittenNamen(nord)).toEqual(["Randwald"]);
            const sued = await art("sued");
            expect(ganzNamen(sued)).toEqual(["Weitwald"]);
            expect(zugeschnittenNamen(sued)).toEqual(["Randwald"]);
            const ost = await art("ost");
            expect(ganzNamen(ost)).toEqual(["Wald-925"]);
            expect(zugeschnittenNamen(ost)).toEqual(["Randwald"]);
            const west = await art("west");
            expect(ganzNamen(west)).toEqual(["Waldgrund", "Weitwald"]);
            expect(zugeschnittenNamen(west)).toEqual(["Randwald"]);
            expect(nord?.titel).toBe("Wald nördlich von P257S Mitte");
            expect(nord?.begriff).toEqual({ name: "Wald", art: "wald" });
        });

        it("🔴 „zwischen“ zwei Orten (WI-0253 §27 B): „südlich von A UND nördlich von B“ – der Streifen zwischen den waagerechten Linien; A–B und B–A sind dasselbe", async () => {
            const ab = await frage({
                art: "wald",
                lage: "zwischen",
                orte: [ortPublic("mitte"), ortPublic("nordburg")],
            });
            // Mitte (750/150) und Nordburg (750/180) liegen nord-süd auseinander: der Streifen y 150 bis 180. Der Wald-925 (170–175) liegt ganz darin, der Randwald (140–170) und der Waldgrund (160–190) zum Teil.
            expect(ganzNamen(ab)).toEqual(["Wald-925"]);
            expect(zugeschnittenNamen(ab)).toEqual(["Randwald", "Waldgrund"]);
            const rand = ab?.angeschnitten.find((teil) => teil.name === "P257S Randwald");
            expect(rand?.rahmen).toEqual({ x0: 740, y0: 150, x1: 760, y1: 170 });
            const grund = ab?.angeschnitten.find((teil) => teil.name === "P257S Waldgrund");
            expect(grund?.rahmen).toEqual({ x0: 710, y0: 160, x1: 730, y1: 180 });
            expect(ab?.gegenden).toBe(3);
            expect(ab?.titel).toBe("Wald zwischen P257S Mitte und P257S Nordburg");
            leereSuchSpeicher();
            const ba = await frage({
                art: "wald",
                lage: "zwischen",
                orte: [ortPublic("nordburg"), ortPublic("mitte")],
            });
            expect(ba?.ganz).toEqual(ab?.ganz);
            expect(ba?.angeschnitten.map((teil) => teil.rahmen)).toEqual(ab?.angeschnitten.map((teil) => teil.rahmen));
        });

        it("🔴 „zwischen“, wenn die Orte eher ost-west auseinander liegen: „östlich von A UND westlich von B“ – der Streifen zwischen den senkrechten Linien", async () => {
            // Mitte (750/150) und Wirtshaus (720/175): 30 in x, 25 in y – der Streifen x 720 bis 750.
            for (const orte of [
                [ortPublic("mitte"), ortPublic("wirtshaus")],
                [ortPublic("wirtshaus"), ortPublic("mitte")],
            ]) {
                leereSuchSpeicher();
                const antwort = await frage({ art: "wald", lage: "zwischen", orte });
                expect(ganzNamen(antwort)).toEqual([]);
                expect(zugeschnittenNamen(antwort)).toEqual(["Randwald", "Waldgrund", "Weitwald"]);
                const nachName = (name: string) => antwort?.angeschnitten.find((teil) => teil.name === name)?.rahmen;
                expect(nachName("P257S Randwald")).toEqual({ x0: 740, y0: 140, x1: 750, y1: 170 });
                expect(nachName("P257S Waldgrund")).toEqual({ x0: 720, y0: 160, x1: 730, y1: 190 });
                expect(nachName("P257S Weitwald")).toEqual({ x0: 720, y0: 110, x1: 730, y1: 130 });
            }
        });

        it("„zwischen“ gilt auch für einen Eintrag: seine Ortszeilen und Regeln werden auf den Streifen zugeschnitten", async () => {
            // Der Streifen y 150 bis 180: Das Wirtshaus (y 175) liegt darin, Bornland (ab y 150) leuchtet mit dem Teil bis 180.
            const antwort = await frage({
                eintrag: eintragPublic["wirsel"] as string,
                lage: "zwischen",
                orte: [ortPublic("mitte"), ortPublic("nordburg")],
            });
            expect(orteNamen(antwort)).toEqual(["Wirtshaus"]);
            expect(zugeschnittenNamen(antwort)).toEqual(["Bornland"]);
            expect(antwort?.angeschnitten[0]?.rahmen).toEqual({ x0: 700, y0: 150, x1: 800, y1: 180 });
            expect(antwort?.gebiete.angeschnitten.map((teil) => teil.publicId)).toEqual([GEBIET_KOSCH]);
        });

        it("eine Landschaftsart im Rahmen einer Landschaft und eines Gebiets zugleich: der Schnitt", async () => {
            const antwort = await frage({
                art: "wald",
                landschaften: [regionPublic("bornland")],
                gebiet: GEBIET_KOSCH,
            });
            // Bornland (y ab 150) im Gebiet (x bis 730): nur der Waldgrund.
            expect(ganzNamen(antwort)).toEqual(["Waldgrund"]);
            expect(antwort?.gegenden).toBe(1);
        });

        it("gleichnamige Landschaften sind EIN Ziel: beide leuchten", async () => {
            const antwort = await frage({
                eintrag: eintragPublic["baum"] as string,
                landschaften: [regionPublic("zwilling1"), regionPublic("zwilling2")],
            });
            expect(antwort?.titel).toBe("P257S Baum in P257S Zwillinge");
            expect(antwort?.gegenden).toBe(0);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Zusage: was leuchtet, listet das Panel dort
    // -------------------------------------------------------------------------------------------------------------------

    describe("Zusage: was in der Suche leuchtet, listet das Panel an dieser Stelle, und umgekehrt", () => {
        it("🔴 Regeln und Ortszeilen: an Ort, Landschaft und Gebiet stehen genau die Einträge, die dort leuchten (F2 an und aus)", async () => {
            const { createSubjectService } = await import("../src/subjects/service.ts");
            const service = createSubjectService(database);
            const EINTRAGSNAMEN: Record<string, string> = {
                baum: "P257S Baum",
                kraut: "P257S Kraut",
                wirsel: "P257S Wirsel",
                ohne: "P257S Ohne",
                skorpionF: "P257S Skorpion",
            };
            const eigene = Object.keys(EINTRAGSNAMEN);
            for (const hinter of [true, false]) {
                LORE_READING.ortszeileHinterRegel = hinter;
                leereSuchSpeicher();
                // Gegenstände: ein Ort im Wald (Weitwald), ein Ort im Waldgrund, ein Ort in der Steppe wäre offen – wir nehmen die drei vorhandenen.
                for (const [ort, x, y] of [
                    ["suedstadt", 720, 120],
                    ["wirtshaus", 720, 175],
                    ["nordburg", 750, 180],
                ] as const) {
                    const section = await service.lore({ kind: "place", id: ortPublic(ort) });
                    const imPanel = new Set(
                        (section?.rows ?? []).flatMap((row) =>
                            row.groups.flatMap((gruppe) => gruppe.entries.map((eintrag) => eintrag.name)),
                        ),
                    );
                    for (const name of eigene) {
                        const antwort = await frage({ eintrag: eintragPublic[name] as string });
                        const punkt = await database<{ drin: boolean }[]>`
                            SELECT (
                                EXISTS (SELECT 1 FROM region_area a JOIN region r ON r.id = a.region_id
                                         WHERE r.public_id = ANY(${antwort?.ganz ?? []}::uuid[]) AND a.is_active AND ST_Intersects(a.geom, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)))
                                OR EXISTS (SELECT 1 FROM unnest(${(antwort?.angeschnitten ?? []).map((teil) => JSON.stringify(teil.form))}::text[]) f
                                            WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(f), 0), ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)))
                                OR EXISTS (SELECT 1 FROM territory_shape s JOIN territory t ON t.id = s.territory_id
                                            WHERE t.public_id = ANY(${antwort?.gebiete.ganz ?? []}::uuid[]) AND ST_Intersects(s.geom, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)))
                                OR ${(antwort?.orte ?? []).some((o) => o.x === x && o.y === y)}
                            ) AS drin
                        `;
                        const erwartet = imPanel.has(EINTRAGSNAMEN[name] as string);
                        expect(punkt[0]?.drin, `F2 ${String(hinter)}, ${ort}, ${name}: Suche und Panel`).toBe(erwartet);
                    }
                }
            }
        }, 120_000);
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Zahlen
    // -------------------------------------------------------------------------------------------------------------------

    describe("Zahlen der Sektion", () => {
        it("nennen je Eintrag die Gegenden, die Orte und `nurKontinent`; ein unbekannter oder ausgeblendeter fehlt", async () => {
            const zahlen = await zaehle(database, [
                eintragPublic["baum"] as string,
                eintragPublic["nur"] as string,
                eintragPublic["kraut"] as string,
                uuid(9999),
            ]);
            expect(zahlen).toEqual([
                { id: eintragPublic["baum"], gegenden: 4, orte: 0, nurKontinent: false },
                { id: eintragPublic["nur"], gegenden: 0, orte: 0, nurKontinent: true },
                { id: eintragPublic["kraut"], gegenden: 1, orte: 1, nurKontinent: false },
            ]);
            const ohneFlora = await zaehle(
                database,
                [eintragPublic["baum"] as string, eintragPublic["nur"] as string],
                {
                    ausgeblendet: ausgeblendet("flora"),
                },
            );
            expect(ohneFlora.map((zahl) => zahl.id)).toEqual([eintragPublic["nur"]]);
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Die kurzen Anfragen
    // -------------------------------------------------------------------------------------------------------------------

    describe("Kurze Anfragen: Begriff, Präposition, Ziel", () => {
        it("(a) ein erkannter Begriff schlägt die Präpositionen vor, mit und ohne Leerzeichen am Ende", async () => {
            for (const q of ["p257s wirsel", "p257s wirsel ", "P257S WIRSEL", "wirselmoos"]) {
                const antwort = await sucheMit(q);
                expect(antwort.anfrage?.begriff, q).toMatchObject({ kind: "flora", eintrag: eintragPublic["wirsel"] });
                expect(antwort.anfrage?.praepositionen, q).toEqual([
                    "in",
                    "im",
                    "auf",
                    "nördlich von",
                    "südlich von",
                    "östlich von",
                    "westlich von",
                    "zwischen",
                ]);
                expect(antwort.anfrage?.ziele).toBeUndefined();
            }
        });

        it("(a) ein angefangenes Wort schlägt nur die passenden vor", async () => {
            expect((await sucheMit("p257s wirsel nördl")).anfrage?.praepositionen).toEqual(["nördlich von"]);
            expect((await sucheMit("p257s wirsel norDLich")).anfrage?.praepositionen).toEqual(["nördlich von"]);
            expect((await sucheMit("p257s wirsel i")).anfrage?.praepositionen).toEqual(["in", "im"]);
            expect((await sucheMit("p257s wirsel zw")).anfrage?.praepositionen).toEqual(["zwischen"]);
            expect((await sucheMit("p257s wirsel xyz")).anfrage).toBeUndefined();
        });

        it("🔴 nichts wird geraten: ein Anfang des Namens ist kein Begriff, und ein unbekanntes Wort bleibt eine gewöhnliche Suche", async () => {
            expect((await sucheMit("p257s wirs in bornland")).anfrage).toBeUndefined();
            expect((await sucheMit("p257s unbekannt in p257s bornland")).anfrage).toBeUndefined();
            expect((await sucheMit("in p257s bornland")).anfrage).toBeUndefined();
        });

        it("(b) nach „Begriff in “ stehen die Ziele, an denen er gelistet ist: zuerst die im Wiki genannten, mit der Zahl der Gegenden", async () => {
            const antwort = await sucheMit("p257s wirsel in");
            expect(antwort.anfrage).toMatchObject({ praeposition: "in" });
            const landschaften = gruppeVon(antwort, "landschaft");
            // Die im Wiki genannten stehen vorn und tragen das Kennzeichen; dahinter die Gegenden, in denen der Eintrag ebenfalls gelistet ist (im Bornland liegt der Waldgrund).
            expect(
                landschaften?.hits
                    .filter((hit) => hit.genannt)
                    .map((hit) => kurz(hit.name))
                    .sort(),
            ).toEqual(["Aventurien", "Bornland"]);
            expect(hitNamen(landschaften).slice(0, 2).sort()).toEqual(["Aventurien", "Bornland"]);
            expect(hitNamen(landschaften)).not.toContain("Zwillinge");
            const bornland = hitVon(landschaften, "Bornland");
            expect(bornland).toMatchObject({ genannt: true, genau: false, gegenden: 2, orte: 1 });
            expect(bornland?.leuchten).toEqual({
                eintrag: eintragPublic["wirsel"],
                landschaften: [regionPublic("bornland")],
            });
            expect(bornland?.text).toBe("P257S Wirsel in P257S Bornland");
            const gebiete = gruppeVon(antwort, "gebiet");
            expect(hitNamen(gebiete)).toEqual(["Fürstentum Kosch"]);
            expect(gebiete?.hits[0]).toMatchObject({ genannt: true, typ: "Fürstentum" });
            expect(gebiete?.hits[0]?.leuchten).toEqual({ eintrag: eintragPublic["wirsel"], gebiet: GEBIET_KOSCH });
        });

        it("(b) die Zahl am Ziel ist die der Leuchten-Route: dieselbe Rechnung, dieselbe Zahl", async () => {
            const antwort = await sucheMit("p257s wirsel in");
            for (const gruppe of antwort.anfrage?.ziele ?? []) {
                for (const hit of gruppe.hits) {
                    if (hit.leuchten === undefined) continue;
                    const leuchtet = await frage(hit.leuchten);
                    expect(hit.gegenden, hit.name).toBe(leuchtet?.gegenden);
                    expect(hit.orte, hit.name).toBe(leuchtet?.orte.length);
                }
            }
        });

        it("(b) bei einem Eintrag mit Regel: die Gegenden, in denen die Regeltreffer liegen (der Punkt der Gegend liegt in dem, was leuchtet)", async () => {
            const antwort = await sucheMit("p257s baum in");
            const landschaften = gruppeVon(antwort, "landschaft");
            // Aventurien ist genannt (die Kontinentzeile); sonst nur die Gegenden, deren Punkt in einem Wald liegt – das sind die Wälder selbst. Bornland, die Steppe, das Gebirge und die Zwillinge nicht.
            expect(hitNamen(landschaften).sort()).toEqual(["Aventurien", "Randwald", "Waldgrund", "Weitwald"]);
            expect(hitVon(landschaften, "Aventurien")?.genannt).toBe(true);
            expect(hitVon(landschaften, "Waldgrund")).toMatchObject({ genannt: false, gegenden: 1 });
            // Der Punkt des Gebiets Kosch (715/150) liegt in keinem Wald: Das Panel listet den Baum dort nicht, die Suche schlägt es nicht vor – wer `in Kosch` tippt, bekommt es trotzdem.
            expect(gruppeVon(antwort, "gebiet")?.hits).toEqual([]);
            const getippt = await sucheMit("p257s baum in kosch");
            expect(hitNamen(gruppeVon(getippt, "gebiet"))).toEqual(["Fürstentum Kosch"]);
            expect(gruppeVon(getippt, "gebiet")?.hits[0]).toMatchObject({ gegenden: 2, genannt: false });
        });

        it("🔴 automatische Namen wie „Wald-925“ stehen nie als Ziel da, auch wenn ihre Fläche leuchtet", async () => {
            for (const q of ["p257s baum in", "p257s baum in wald", "wald in", "wald in wald-"]) {
                const antwort = await sucheMit(q);
                const alle = (antwort.anfrage?.ziele ?? []).flatMap((gruppe) => gruppe.hits.map((hit) => hit.name));
                expect(
                    alle.filter((name) => /-\d+$/u.test(name)),
                    q,
                ).toEqual([]);
            }
        });

        it("(b) nach „in “ mit Getipptem: jede Gegend mit Treffern, ohne Rücksicht auf Groß und Klein und Akzente; ohne Treffer bleiben die Gruppen leer", async () => {
            const born = await sucheMit("p257s wirsel in BORN");
            expect(hitNamen(gruppeVon(born, "landschaft"))).toEqual(["Bornland"]);
            expect(hitVon(gruppeVon(born, "landschaft"), "Bornland")?.genannt).toBe(true);
            const genau = await sucheMit("p257s wirsel in p257s bornland");
            expect(hitVon(gruppeVon(genau, "landschaft"), "Bornland")?.genau).toBe(true);
            const keine = await sucheMit("p257s wirsel in zwillinge");
            expect(gruppeVon(keine, "landschaft")?.hits).toEqual([]);
            expect(gruppeVon(keine, "gebiet")?.hits).toEqual([]);
        });

        it("„im“ und „auf“ gelten wie „in“; der Text übernimmt das geschriebene Wort", async () => {
            for (const wort of ["in", "im", "auf"]) {
                const antwort = await sucheMit(`p257s wirsel ${wort} p257s bornland`);
                expect(antwort.anfrage?.praeposition).toBe(wort);
                const hit = hitVon(gruppeVon(antwort, "landschaft"), "Bornland");
                expect(hit?.text).toBe(`P257S Wirsel ${wort} P257S Bornland`);
                expect(hit?.gegenden).toBe(2);
            }
        });

        it("🔴 gleichnamige Landschaften sind EIN Ziel mit allen Kennungen; ein Ziel ohne Treffer fehlt", async () => {
            const antwort = await sucheMit("region in p257s zwillinge");
            const zwillinge = hitVon(gruppeVon(antwort, "landschaft"), "Zwillinge");
            expect(zwillinge).toMatchObject({ gegenden: 2, typ: "region" });
            expect(zwillinge?.leuchten?.landschaften?.slice().sort()).toEqual(
                [regionPublic("zwilling1"), regionPublic("zwilling2")].sort(),
            );
            // Im Süden der Zwillinge steht kein Wald: kein Treffer.
            const keinWald = await sucheMit("wald in p257s zwillinge");
            expect(gruppeVon(keinWald, "landschaft")?.hits).toEqual([]);
            const wald = await sucheMit("wald in p257s");
            expect(hitVon(gruppeVon(wald, "landschaft"), "Bornland")).toMatchObject({ gegenden: 3, typ: "region" });
        });

        it("🔴 Landschaftsart als Begriff: deutscher Name und Schlüssel; „Wald in Bornland“ schneidet zu", async () => {
            for (const q of ["wald in p257s bornland", "Wald in p257s bornland", "WALD in p257s bornland"]) {
                const antwort = await sucheMit(q);
                expect(antwort.anfrage?.begriff, q).toEqual({ name: "Wald", art: "wald" });
                const hit = hitVon(gruppeVon(antwort, "landschaft"), "Bornland");
                expect(hit, q).toMatchObject({ gegenden: 3, text: "Wald in P257S Bornland" });
                expect(hit?.leuchten).toEqual({ art: "wald", landschaften: [regionPublic("bornland")] });
            }
            const schluessel = await sucheMit("suempfe_moore ");
            expect(schluessel.anfrage?.begriff).toEqual({ name: "Sümpfe und Moore", art: "suempfe_moore" });
            const umlaute = await sucheMit("sumpfe und moore");
            expect(umlaute.anfrage?.begriff.art).toBe("suempfe_moore");
        });

        it("jede Richtung: der Ort als Ziel, die Halbebene leuchtet", async () => {
            const richtungen = [
                ["nördlich von", "nord", 3],
                ["südlich von", "sued", 2],
                ["östlich von", "ost", 2],
                ["westlich von", "west", 3],
            ] as const;
            for (const [wort, lage, zahl] of richtungen) {
                const antwort = await sucheMit(`wald ${wort} p257s mitte`);
                expect(antwort.anfrage?.praeposition, wort).toBe(wort);
                const mitte = hitVon(gruppeVon(antwort, "ort"), "Mitte");
                expect(mitte, wort).toMatchObject({ gegenden: zahl, genau: true, typ: "dorf" });
                expect(mitte?.leuchten, wort).toEqual({ art: "wald", lage, orte: [ortPublic("mitte")] });
                expect(mitte?.text).toBe(`Wald ${wort} P257S Mitte`);
            }
            // ohne Akzent und in Großschrift
            const ohneAkzent = await sucheMit("WALD NORDLICH VON p257s mitte");
            expect(ohneAkzent.anfrage?.praeposition).toBe("nördlich von");
        });

        it("(c) nach einer Richtung die Orte wie die gewöhnliche Ortssuche: ein Anfang genügt, ohne Getipptes die bedeutendsten", async () => {
            const anfang = await sucheMit("p257s baum südlich von p257s s");
            expect(hitNamen(gruppeVon(anfang, "ort"))).toContain("Südstadt");
            const leer = await sucheMit("p257s baum südlich von");
            expect(gruppeVon(leer, "ort")?.hits.length).toBeGreaterThan(0);
            // Ein verborgener Ort ist keiner.
            const geheim = await sucheMit("p257s baum südlich von p257s geheimort");
            expect(gruppeVon(geheim, "ort")?.hits).toEqual([]);
        });

        it("„zwischen“ erst A (nur der Text wird ergänzt), dann B mit Zahlen", async () => {
            const a = await sucheMit("wald zwischen p257s mi");
            const mitte = hitVon(gruppeVon(a, "ort"), "Mitte");
            expect(mitte?.leuchten).toBeUndefined();
            expect(mitte?.text).toBe("Wald zwischen P257S Mitte und ");
            const b = await sucheMit("wald zwischen p257s mitte und p257s nord");
            const nordburg = hitVon(gruppeVon(b, "ort"), "Nordburg");
            expect(nordburg).toMatchObject({ gegenden: 3, text: "Wald zwischen P257S Mitte und P257S Nordburg" });
            expect(nordburg?.leuchten).toEqual({
                art: "wald",
                lage: "zwischen",
                orte: [ortPublic("mitte"), ortPublic("nordburg")],
            });
            // B ohne Getipptes: die bedeutendsten Orte, ohne A selbst.
            const leer = await sucheMit("wald zwischen p257s mitte und");
            expect(hitNamen(gruppeVon(leer, "ort"))).not.toContain("Mitte");
            // Auch mit dem Streifen liefern die Ziele nach „und “ Treffer: jedes hat Gegenden und trägt die Anfrage mit beiden Orten.
            expect(gruppeVon(leer, "ort")?.hits.length).toBeGreaterThan(0);
            for (const hit of gruppeVon(leer, "ort")?.hits ?? []) {
                expect(hit.gegenden, hit.name).toBeGreaterThan(0);
                expect(hit.leuchten?.lage, hit.name).toBe("zwischen");
                expect(hit.leuchten?.orte?.[0], hit.name).toBe(ortPublic("mitte"));
            }
            // A unbekannt: keine Vorschläge.
            const unbekannt = await sucheMit("wald zwischen gibtesnicht und p257s mitte");
            expect(gruppeVon(unbekannt, "ort")?.hits).toEqual([]);
        });

        it("ein Begriff, der Eintrag UND Landschaftsart sein könnte, wird der Eintrag; bei gleichem Namen zweier Arten der mit Kartenbezug", async () => {
            const antwort = await sucheMit("p257s skorpion in");
            expect(antwort.anfrage?.begriff).toMatchObject({ kind: "fauna", eintrag: eintragPublic["skorpionF"] });
        });

        it("ein Eintrag ohne Kartenbezug hat einen Begriff, aber keine Ziele", async () => {
            const antwort = await sucheMit("p257s nichts in");
            expect(antwort.anfrage?.begriff).toMatchObject({ kind: "ware" });
            expect(antwort.anfrage?.ziele).toEqual([]);
        });

        it("🔴 keine stille Kappung: `total` zählt die Ziele mit Treffern, `ungeprueft` die passenden, die nicht gerechnet wurden", async () => {
            const antwort = await sucheMit("wald in");
            const landschaften = gruppeVon(antwort, "landschaft");
            expect(landschaften).toBeDefined();
            expect(landschaften?.hits.length).toBeLessThanOrEqual(SEARCH_VORKOMMEN_SICHTBAR);
            expect(landschaften?.total).toBeGreaterThanOrEqual(landschaften?.hits.length ?? 0);
            expect(landschaften?.ungeprueft).toBeGreaterThanOrEqual(0);
        });

        it("🔴 überlastet: die Schranke weist überzählige Rechnungen der Ziele ab (ohne `ziele`), der Rest bleibt heil", async () => {
            // 40 verschiedene Eingaben zugleich: zwei rechnen, sechzehn warten, die übrigen bekommen nur Begriff und Präposition – nicht „keine Treffer“.
            const antworten = await Promise.all(
                Array.from({ length: 40 }, (_, i) => sucheMit(`p257s baum in p257s q${String(i)}`)),
            );
            for (const antwort of antworten) {
                expect(antwort.anfrage?.begriff).toMatchObject({ kind: "flora" });
                expect(antwort.anfrage?.praeposition).toBe("in");
            }
            const ohneZiele = antworten.filter((antwort) => antwort.anfrage?.ziele === undefined).length;
            expect(ohneZiele).toBeGreaterThanOrEqual(1);
            expect(ohneZiele).toBeLessThanOrEqual(40 - 2);
            // Gerechnete Ziele sind vollständig (zwei Gruppen), auch wenn sie leer sind.
            for (const antwort of antworten) {
                if (antwort.anfrage?.ziele !== undefined) expect(antwort.anfrage.ziele).toHaveLength(2);
            }
        });

        it("🔴 die Inhaltsschalter je Art gelten auch für die Ziele", async () => {
            const antwort = await sucheMit("p257s wirsel in", ausgeblendet("flora"));
            expect(antwort.anfrage).toBeUndefined();
        });

        it("🔴 ein Fehler im Vorkommen-Anteil nimmt der Suche ihre eigenen Treffer nicht, wenn die Route ihn abfängt; sonst fällt er durch", async () => {
            const kaputt = (): boolean => {
                throw new Error("Schalterstand unlesbar");
            };
            const meldungen: unknown[] = [];
            const antwort = await search(database, "p257s mitte", {
                ausgeblendet: kaputt,
                onVorkommenFehler: (fehler) => meldungen.push(fehler),
            });
            expect(antwort.hits.some((hit) => kurz(hit.name) === "Mitte")).toBe(true);
            expect(antwort.vorkommen).toBeUndefined();
            expect(meldungen).toHaveLength(1);
            await expect(search(database, "p257s mitte", { ausgeblendet: kaputt })).rejects.toThrow("unlesbar");
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Beispiele für den Platzhalter
    // -------------------------------------------------------------------------------------------------------------------

    describe("Beispiele für den wechselnden Platzhalter", () => {
        it("🔴 jede Anfrage hat wirklich Treffer: dieselbe Suche findet sie", async () => {
            const antwort = await beispiele(database, {}, new Date("2026-10-29T12:00:00Z"));
            expect(antwort.beispiele.length).toBeGreaterThan(0);
            const arten = antwort.beispiele.map((beispiel) => beispiel.art);
            expect(arten).toContain("ort");
            for (const beispiel of antwort.beispiele) {
                const treffer = await sucheMit(beispiel.text);
                if (beispiel.art === "ort") {
                    expect(
                        treffer.hits.some((hit) => hit.kind === "ort" && hit.name === beispiel.text),
                        beispiel.text,
                    ).toBe(true);
                } else if (beispiel.art === "vorkommen") {
                    expect(
                        treffer.vorkommen?.hits.some((hit) => hit.name === beispiel.text),
                        beispiel.text,
                    ).toBe(true);
                    expect(beispiel.gegenden, beispiel.text).toBeGreaterThan(0);
                } else {
                    const alle = (treffer.anfrage?.ziele ?? []).flatMap((gruppe) => gruppe.hits);
                    const passend = alle.find((hit) => hit.text === beispiel.text);
                    expect(passend, beispiel.text).toBeDefined();
                    expect(passend?.gegenden, beispiel.text).toBeGreaterThan(0);
                    expect(passend?.gegenden, beispiel.text).toBe(beispiel.gegenden);
                }
            }
        });

        it("kommt aus dem Speicher, wechselt mit dem Tag und lässt ausgeblendete Arten weg", async () => {
            const heute = new Date("2026-10-29T12:00:00Z");
            const a = await beispiele(database, {}, heute);
            const b = await beispiele(database, {}, heute);
            expect(b).toBe(a);
            const ohneFlora = await beispiele(database, { ausgeblendet: ausgeblendet("flora") }, heute);
            for (const beispiel of ohneFlora.beispiele) {
                expect(beispiel.text, "keine Flora").not.toMatch(/P257S (Baum|Kraut|Wirsel|Klima|Süßer)/u);
            }
        });
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Die Routen
    // -------------------------------------------------------------------------------------------------------------------

    describe("Routen", () => {
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

        it("`GET /api/search` bringt die neuen Teile nur, wo es sie gibt", async () => {
            const antwort = await get("/api/search?q=p257s%20wirsel");
            expect(antwort.statusCode).toBe(200);
            const json = antwort.json<SearchResponse>();
            expect(json.vorkommen?.hits[0]?.name).toBe("P257S Wirsel");
            expect(json.anfrage?.praepositionen).toHaveLength(8);
            const leer = (await get("/api/search?q=qqqqzzzz")).json<SearchResponse>();
            expect(Object.keys(leer).sort()).toEqual(["hits", "query", "truncated"]);
        });

        it("`GET /api/search/leuchten`: öffentlich, mit ETag aus dem Kartenstand; mit `If-None-Match` 304 ohne Rechnung", async () => {
            const url = `${SEARCH_LEUCHTEN_URL}?eintrag=${eintragPublic["kraut"] as string}`;
            const erste = await get(url);
            expect(erste.statusCode).toBe(200);
            expect(erste.headers["cache-control"]).toBe("public, no-cache");
            const etag = erste.headers["etag"] as string;
            expect(etag).toMatch(/^W\/"/u);
            const json = erste.json<SearchLeuchten>();
            expect(json).toMatchObject({ gegenden: 1, pausiert: false, nurKontinent: false });
            const zweite = await get(url, { "if-none-match": etag });
            expect(zweite.statusCode).toBe(304);
            expect(["", "null"]).toContain(zweite.body);
            const andere = await get(`${url}&landschaften=${regionPublic("bornland")}`);
            expect(andere.headers["etag"]).not.toBe(etag);
            // Landschaftsart mit Rahmen und Lage über die flache Adresse.
            const art = await get(
                `${SEARCH_LEUCHTEN_URL}?art=wald&lage=zwischen&orte=${ortPublic("mitte")},${ortPublic("nordburg")}`,
            );
            expect(art.statusCode).toBe(200);
            expect(art.json<SearchLeuchten>().gegenden).toBe(3);
            // Die Formen überstehen die Serialisierung des Antwortschemas (verschachtelte Koordinaten), samt Rahmen.
            const formen = art.json<SearchLeuchten>().angeschnitten;
            expect(formen.map((teil) => teil.name).sort()).toEqual(["P257S Randwald", "P257S Waldgrund"]);
            const rand = formen.find((teil) => teil.name === "P257S Randwald");
            expect(rand?.form.type).toBe("Polygon");
            const ring = (rand?.form.coordinates[0] ?? []) as [number, number][];
            expect(ring.length).toBeGreaterThanOrEqual(4);
            expect(ring.every(([x, y]) => typeof x === "number" && typeof y === "number")).toBe(true);
            expect(rand?.rahmen.x0).toBeGreaterThanOrEqual(740);
        });

        it("`leuchten`: ungültige Angaben 400, Unbekanntes 404 ohne Zwischenspeicher", async () => {
            const eintrag = eintragPublic["baum"] as string;
            for (const url of [
                SEARCH_LEUCHTEN_URL,
                `${SEARCH_LEUCHTEN_URL}?eintrag=${eintrag}&art=wald`,
                `${SEARCH_LEUCHTEN_URL}?art=wald`,
                `${SEARCH_LEUCHTEN_URL}?art=gibtesnicht&gebiet=${GEBIET_KOSCH}`,
                `${SEARCH_LEUCHTEN_URL}?eintrag=${eintrag}&lage=sued`,
                `${SEARCH_LEUCHTEN_URL}?eintrag=${eintrag}&orte=${ortPublic("mitte")}`,
                `${SEARCH_LEUCHTEN_URL}?eintrag=kein-uuid`,
                `${SEARCH_LEUCHTEN_URL}?eintrag=${eintrag}&lage=sonstwo&orte=${ortPublic("mitte")}`,
                `${SEARCH_LEUCHTEN_URL}?eintrag=${eintrag}&landschaften=${uuid(1)},kein-uuid`,
            ]) {
                const antwort = await get(url);
                expect(antwort.statusCode, url).toBe(400);
                expect(antwort.json<{ error: string }>().error, url).toBeTypeOf("string");
            }
            const unbekannt = await get(`${SEARCH_LEUCHTEN_URL}?eintrag=${uuid(9999)}`);
            expect(unbekannt.statusCode).toBe(404);
            expect(unbekannt.headers["cache-control"]).toBe("no-store");
        });

        it("`GET /api/search/zahlen`: bis zu acht Einträge, danach 400", async () => {
            const url = `${SEARCH_ZAHLEN_URL}?ids=${eintragPublic["baum"] as string},${eintragPublic["nur"] as string}`;
            const antwort = await get(url);
            expect(antwort.statusCode).toBe(200);
            expect(antwort.json<SearchZahlen>().zahlen).toEqual([
                { id: eintragPublic["baum"], gegenden: 4, orte: 0, nurKontinent: false },
                { id: eintragPublic["nur"], gegenden: 0, orte: 0, nurKontinent: true },
            ]);
            const zweite = await get(url, { "if-none-match": antwort.headers["etag"] as string });
            expect(zweite.statusCode).toBe(304);
            const neun = Array.from({ length: 9 }, (_, i) => uuid(1000 + i)).join(",");
            expect((await get(`${SEARCH_ZAHLEN_URL}?ids=${neun}`)).statusCode).toBe(400);
            expect((await get(`${SEARCH_ZAHLEN_URL}?ids=kein-uuid`)).statusCode).toBe(400);
            expect((await get(SEARCH_ZAHLEN_URL)).statusCode).toBe(400);
        });

        it("`GET /api/search/beispiele`", async () => {
            const antwort = await get(SEARCH_BEISPIELE_URL);
            expect(antwort.statusCode).toBe(200);
            expect(antwort.headers["cache-control"]).toBe("public, max-age=300");
            expect(antwort.json<SearchBeispiele>().beispiele.length).toBeGreaterThan(0);
        });

        it("`GET /api/search/eintrag`: Stammdaten ohne Auszeichnung, genannte Orte, nur Wiki-Adressen, Chips mit denselben Zahlen wie das Leuchten", async () => {
            const wirsel = eintragPublic["wirsel"] as string;
            await database`
                UPDATE lore_entry SET lebensraum = ${"Wiesen in der [[Bornland|Nähe]] von ''Laubwald''"}, wiki_url = 'https://de.wiki-aventurica.de/wiki/Wirsel', wiki_title = 'Wirsel (Pflanze)'
                 WHERE id = ${eintragId["wirsel"] as string}::bigint
            `;
            leereVorkommenIndex();
            const url = `${SEARCH_EINTRAG_URL}?id=${wirsel}`;
            const antwort = await get(url);
            expect(antwort.statusCode).toBe(200);
            expect(antwort.headers["cache-control"]).toBe("public, no-cache");
            const json = antwort.json<SearchEintrag>();
            expect(json).toMatchObject({
                id: wirsel,
                name: "P257S Wirsel",
                kind: "flora",
                gruppe: "Gras",
                lebensraum: "Wiesen in der Nähe von Laubwald",
                wiki: { title: "Wirsel (Pflanze)", url: "https://de.wiki-aventurica.de/wiki/Wirsel" },
                leuchten: { eintrag: wirsel },
            });
            expect(json.weitereNamen).toEqual(["Wirselmoos", "Kleiner Wirsel (tulamidisch)"]);
            // Die Titel der Ortszeilen, auch der nicht aufgelösten, ohne Doppelte.
            expect(json.genanntIn).toEqual(
                expect.arrayContaining([
                    "aventurien",
                    "p257s-bornland",
                    "p257s-kosch",
                    "p257s-wirtshaus",
                    "p257s-unbekannt",
                ]),
            );
            // Die Chips: nur im Wiki genannte Ziele, jedes mit der Zahl und der Anfrage des Leuchtens, das es beim Wählen auslöst.
            expect(json.ziele.length).toBeGreaterThan(0);
            for (const ziel of json.ziele) {
                expect(ziel.genannt).toBe(true);
                expect(ziel.leuchten).toBeDefined();
                const lit = (
                    await get(
                        `${SEARCH_LEUCHTEN_URL}?eintrag=${wirsel}${
                            ziel.leuchten?.landschaften === undefined
                                ? ""
                                : `&landschaften=${ziel.leuchten.landschaften.join(",")}`
                        }${ziel.leuchten?.gebiet === undefined ? "" : `&gebiet=${ziel.leuchten.gebiet}`}`,
                    )
                ).json<SearchLeuchten>();
                expect(ziel.gegenden, ziel.name).toBe(lit.gegenden);
            }
            expect(json.ziele.map((ziel) => ziel.name)).toEqual(
                expect.arrayContaining(["P257S Bornland", "Fürstentum P257S Kosch"]),
            );
            // Der Kontinent ist kein Chip: „alle“ deckt ihn ab.
            expect(json.ziele.map((ziel) => ziel.name)).not.toContain("P257S Aventurien");
            // Die Zahl des Chips „alle“ ist die des ganzen Eintrags.
            const ganz = (await get(`${SEARCH_LEUCHTEN_URL}?eintrag=${wirsel}`)).json<SearchLeuchten>();
            expect(json.gegenden).toBe(ganz.gegenden);
            expect(json.nurKontinent).toBe(ganz.nurKontinent);
            // ETag aus dem Kartenstand: ein zweiter Abruf mit `If-None-Match` ist 304.
            expect((await get(url, { "if-none-match": antwort.headers["etag"] as string })).statusCode).toBe(304);
            // Eine fremde Adresse gilt nie: Sie bleibt Text und kommt nicht als `wiki` heraus.
            await database`UPDATE lore_entry SET wiki_url = 'https://example.org/wiki/Wirsel' WHERE id = ${eintragId["wirsel"] as string}::bigint`;
            leereVorkommenIndex();
            leereLeuchtenSpeicher();
            const fremd = (await get(url)).json<SearchEintrag>();
            expect(fremd.wiki).toBeUndefined();
        });

        it("`eintrag`: ungültige Kennung 400, unbekannter Eintrag 404 ohne Zwischenspeicher, ausgeblendete Art 404", async () => {
            expect((await get(SEARCH_EINTRAG_URL)).statusCode).toBe(400);
            expect((await get(`${SEARCH_EINTRAG_URL}?id=kein-uuid`)).statusCode).toBe(400);
            const unbekannt = await get(`${SEARCH_EINTRAG_URL}?id=${uuid(9999)}`);
            expect(unbekannt.statusCode).toBe(404);
            expect(unbekannt.headers["cache-control"]).toBe("no-store");
            const baum = `${SEARCH_EINTRAG_URL}?id=${eintragPublic["baum"] as string}`;
            expect((await get(baum)).statusCode).toBe(200);
            await database`INSERT INTO content_switch (key, enabled, changed_by_label) VALUES ('panel.lore.flora', FALSE, 'test')`;
            try {
                await expect
                    .poll(async () => (await get(baum)).statusCode, { timeout: 15_000, interval: 250 })
                    .toBe(404);
            } finally {
                await database`DELETE FROM content_switch WHERE key = 'panel.lore.flora'`;
            }
            await expect.poll(async () => (await get(baum)).statusCode, { timeout: 15_000, interval: 250 }).toBe(200);
        }, 60_000);

        it("🔴 der Inhaltsschalter „Flora“ wirkt über die Routen: Sektion, Leuchten und Zahlen verlieren die Flora, die Fauna bleibt", async () => {
            const zahlenUrl = `${SEARCH_ZAHLEN_URL}?ids=${eintragPublic["baum"] as string},${eintragPublic["skorpionF"] as string}`;
            expect((await get(zahlenUrl)).json<SearchZahlen>().zahlen).toHaveLength(2);
            await database`INSERT INTO content_switch (key, enabled, changed_by_label) VALUES ('panel.lore.flora', FALSE, 'test')`;
            // Die Anwendung liest den Stand über ihren Store, sobald der Weckruf da ist.
            await expect
                .poll(async () => (await get(zahlenUrl)).json<SearchZahlen>().zahlen.map((zahl) => zahl.id), {
                    timeout: 15_000,
                    interval: 250,
                })
                .toEqual([eintragPublic["skorpionF"]]);
            const sektion = (await get("/api/search?q=p257s%20baum")).json<SearchResponse>();
            expect(sektion.vorkommen).toBeUndefined();
            const leuchtet = await get(`${SEARCH_LEUCHTEN_URL}?eintrag=${eintragPublic["baum"] as string}`);
            expect(leuchtet.json<SearchLeuchten>()).toMatchObject({ pausiert: true, titel: "", ganz: [] });
            // Der ETag der pausierten Antwort ist ein anderer als der der freien.
            await database`DELETE FROM content_switch WHERE key = 'panel.lore.flora'`;
            await expect
                .poll(async () => (await get(zahlenUrl)).json<SearchZahlen>().zahlen.length, {
                    timeout: 15_000,
                    interval: 250,
                })
                .toBe(2);
            const wieder = await get(`${SEARCH_LEUCHTEN_URL}?eintrag=${eintragPublic["baum"] as string}`);
            expect(wieder.json<SearchLeuchten>().pausiert).toBe(false);
            expect(wieder.headers["etag"]).not.toBe(leuchtet.headers["etag"]);
        }, 90_000);
    });
});

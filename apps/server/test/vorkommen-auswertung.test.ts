import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { VorkommenAmPunkt, VorkommenPunkt, VorkommenRegelTreffer, VorkommenTreffer } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import {
    eintraegeAmPunkt,
    eintraegeAnFlaechen,
    eintraegeAnPunkten,
    leereVorkommenSpeicher,
    trefferDesEintrags,
} from "../src/vorkommen/index.ts";

/**
 * Die Auswertung der Vorkommensregeln (WI-0257, S1) gegen echtes PostGIS: beide Richtungen auf einer erfundenen Welt, die Zusage „was in A leuchtet, trägt B, und umgekehrt“ an Stichproben.
 *
 * 🔴 **Die Welt** liegt in `[700, 800] × [100, 200]` und besteht nur aus Dingen mit der Kennung `25700000-…`: eine Rahmenfläche „Welt“, ihre Nord- und Westhälfte, drei Wälder (Wald B und C überlappen
 * einander, C kreuzt die Grenze von Nordland), ein Gebirge, eine Steppe, eine Wüste, ein verborgener Wald, ein Wald mit stillgelegter Fläche und ein Tundra-Fleck mit sich selbst schneidender Form.
 * Die Klimabänder sind für die Dauer des Tests zwei (gemäßigt nördlich von `y = 150`, tropisch südlich) und werden danach zurückgestellt.
 *
 * Soll- und Problemfälle (die Namen stehen in den Fällen):
 * - `oder`, `und` (Wald und Gebirge: keine ganze Landschaft, aber Orte im Schnitt), `ohne`, Art leer plus Fläche, Klimaspanne vertauscht, Lage mit einem und mit zwei Orten, wartende Fläche ausgelassen, eine
 *   angeschnittene Landschaft am Rahmenrand, die Fläche eines Eintrags, die es nicht mehr gibt (trifft nichts, schränkt nie ab).
 * - Der Zwischenspeicher: dasselbe Objekt beim zweiten Abruf, neu gerechnet, sobald sich die Karte oder die Regeln ändern.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MAP_DOMAIN = "aventuria";
const uuid = (nummer: number): string => `25700000-0000-4000-8000-${String(nummer).padStart(12, "0")}`;
const KEY = "p257t-";
const rechteck = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

interface RegionDef {
    nummer: number;
    name: string;
    ebene: string;
    art: string;
    wkt: string;
    aktiv?: boolean;
    verborgen?: boolean;
    flaecheAktiv?: boolean;
}

/** Die Landschaften der Welt. */
const REGIONEN: Record<string, RegionDef> = {
    welt: { nummer: 1, name: "P257T Welt", ebene: "derographisch", art: "region", wkt: rechteck(700, 100, 800, 200) },
    nordland: {
        nummer: 2,
        name: "P257T Nordland",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(700, 150, 800, 200),
    },
    westland: {
        nummer: 3,
        name: "P257T Westland",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(700, 100, 750, 200),
    },
    waldA: { nummer: 4, name: "P257T Wald A", ebene: "vegetation", art: "wald", wkt: rechteck(710, 110, 730, 190) },
    waldB: { nummer: 5, name: "P257T Wald B", ebene: "vegetation", art: "wald", wkt: rechteck(740, 110, 790, 150) },
    waldC: { nummer: 6, name: "P257T Wald C", ebene: "vegetation", art: "wald", wkt: rechteck(740, 145, 790, 175) },
    waldD: {
        nummer: 7,
        name: "P257T Wald D verborgen",
        ebene: "vegetation",
        art: "wald",
        wkt: rechteck(760, 110, 780, 125),
        verborgen: true,
    },
    waldE: {
        nummer: 8,
        name: "P257T Wald E ohne Fläche",
        ebene: "vegetation",
        art: "wald",
        wkt: rechteck(710, 100, 720, 108),
        flaecheAktiv: false,
    },
    gebirge: {
        nummer: 9,
        name: "P257T Gebirge",
        ebene: "topographie",
        art: "gebirge",
        wkt: rechteck(720, 130, 760, 170),
    },
    steppe: { nummer: 10, name: "P257T Steppe", ebene: "vegetation", art: "steppe", wkt: rechteck(770, 160, 795, 195) },
    wueste: { nummer: 11, name: "P257T Wüste", ebene: "vegetation", art: "wueste", wkt: rechteck(745, 140, 775, 160) },
    // Zwei Dreiecke, die sich in der Mitte berühren: eine sich selbst schneidende Form, wie 92 der 6.125 Flächen des Bestands.
    tundra: {
        nummer: 12,
        name: "P257T Tundra",
        ebene: "vegetation",
        art: "tundra",
        wkt: "POLYGON((780 100,790 110,790 100,780 110,780 100))",
    },
    altland: {
        nummer: 13,
        name: "P257T Altland",
        ebene: "derographisch",
        art: "region",
        wkt: rechteck(700, 100, 710, 110),
        aktiv: false,
    },
};

/** Die Orte der Welt (Dörfer). */
const ORTE: Record<string, { nummer: number; name: string; x: number; y: number; verborgen?: boolean }> = {
    p1: { nummer: 201, name: "P257T Aa", x: 715, y: 120 },
    p2: { nummer: 202, name: "P257T Bb", x: 725, y: 155 },
    p3: { nummer: 203, name: "P257T Cc", x: 745, y: 125 },
    p4: { nummer: 204, name: "P257T Dd", x: 751, y: 146 },
    p5: { nummer: 205, name: "P257T Ee", x: 785, y: 180 },
    p6: { nummer: 206, name: "P257T Ff", x: 755, y: 165 },
    p7: { nummer: 207, name: "P257T Gg", x: 790, y: 120 },
    p8: { nummer: 208, name: "P257T Hh", x: 705, y: 105 },
    // Die Bezugsorte der Lage liegen auf der Linie und sind verborgen: keine Siedlungen der Auswertung.
    x: { nummer: 211, name: "P257T Bezug X", x: 750, y: 150, verborgen: true },
    y1: { nummer: 212, name: "P257T Bezug Y1", x: 700, y: 120, verborgen: true },
    y2: { nummer: 213, name: "P257T Bezug Y2", x: 800, y: 180, verborgen: true },
};

describeWithDatabase("Die Auswertung der Vorkommensregeln (WI-0257) gegen PostGIS", () => {
    let database: Database;
    const region: Record<string, { id: string; publicId: string }> = {};
    const ort: Record<string, string> = {};
    const eintrag: Record<string, { id: string; publicId: string }> = {};
    const regel: Record<string, string> = {};
    let alteBaender: { type_key: string; ewkb: string; source_fingerprint: string; derived_at: Date }[] = [];
    let regelNummer = 0;

    interface TermDef {
        op?: "und" | "oder" | "ohne";
        flaeche?: string;
        arten?: [string, string][];
        klima?: [string, string];
        lage?: { richtung: string; orte: string[] };
        wiki?: string;
    }

    async function legeEintrag(name: string, art = "flora"): Promise<void> {
        const [zeile] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO lore_entry (wiki_key, kind, name, legacy_origin, source_system)
            VALUES (${KEY + name}, ${art}, ${"P257T " + name}, 'manual', 'test') RETURNING id::text AS id, public_id::text AS public_id
        `;
        eintrag[name] = { id: (zeile as { id: string }).id, publicId: (zeile as { public_id: string }).public_id };
    }

    async function legeRegel(
        name: string,
        eintragName: string,
        terms: TermDef[],
        beziehung = "verbreitung",
    ): Promise<string> {
        regelNummer += 1;
        const key = createHash("sha256")
            .update(`${eintragName}|${beziehung}|${String(regelNummer)}`)
            .digest("hex");
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, source_system)
            VALUES (${(eintrag[eintragName] as { id: string }).id}, ${key}, ${beziehung}, ${regelNummer}, 'manual', 'test') RETURNING id::text AS id
        `;
        const regelId = (zeile as { id: string }).id;
        for (const [seq, term] of terms.entries()) {
            const [t] = await database<{ id: string }[]>`
                INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id, climate_from, climate_to, line_direction, line_place_a_id, line_place_b_id, wiki_area_title)
                VALUES (${regelId}, ${seq}, ${term.op ?? "und"}, ${term.flaeche === undefined ? null : (region[term.flaeche] as { id: string }).id},
                        ${term.klima?.[0] ?? null}, ${term.klima?.[1] ?? null}, ${term.lage?.richtung ?? null},
                        ${term.lage === undefined ? null : (ort[term.lage.orte[0] as string] as string)},
                        ${term.lage?.orte[1] === undefined ? null : (ort[term.lage.orte[1]] as string)}, ${term.wiki ?? null})
                RETURNING id::text AS id
            `;
            for (const [ebene, art] of term.arten ?? []) {
                await database`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${(t as { id: string }).id}, ${ebene}, ${art})`;
            }
        }
        regel[name] = regelId;
        return regelId;
    }

    const wald: [string, string][] = [["vegetation", "wald"]];

    async function raeumeAuf(): Promise<void> {
        await database.unsafe(
            `DELETE FROM lore_rule_term WHERE lore_rule_id IN (SELECT r.id FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.wiki_key LIKE '${KEY}%')`,
        );
        await database.unsafe(
            `DELETE FROM lore_rule WHERE lore_entry_id IN (SELECT id FROM lore_entry WHERE wiki_key LIKE '${KEY}%')`,
        );
        await database.unsafe(`DELETE FROM lore_entry WHERE wiki_key LIKE '${KEY}%'`);
        await database.unsafe(
            `DELETE FROM territory_shape WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '25700000-%')`,
        );
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '25700000-%'`);
        await database.unsafe(`DELETE FROM region_area WHERE public_id::text LIKE '25700000-%'`);
        await database.unsafe(`DELETE FROM region WHERE public_id::text LIKE '25700000-%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '25700000-%'`);
    }

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
        await raeumeAuf();

        // Die Welt muss leer sein, sonst treffen fremde Reste der Testdatenbank die Fälle.
        const [fremd] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM region_area a WHERE a.is_active AND a.geom && ST_MakeEnvelope(690, 90, 810, 210, 0)
        `;
        expect(fremd?.n, "fremde Flächen in der Welt der Testdatei (die Testdatenbank ist nicht leer genug)").toBe(0);

        // Die Klimabänder: abgeleitet und verriegelt (`climate.deriving`), die alten werden gemerkt und danach zurückgestellt.
        alteBaender = await database<typeof alteBaender>`
            SELECT type_key, encode(ST_AsEWKB(geom), 'hex') AS ewkb, source_fingerprint, derived_at FROM climate_band
        `;
        await database.begin(async (tx) => {
            await tx`SELECT set_config('climate.deriving', 'on', true)`;
            await tx`DELETE FROM climate_band`;
            await tx`INSERT INTO climate_band (type_key, geom, source_fingerprint) VALUES ('gemaessigt', ST_GeomFromText(${rechteck(0, 150, 1024, 1024)}, 0), 'p257t')`;
            await tx`INSERT INTO climate_band (type_key, geom, source_fingerprint) VALUES ('tropisch', ST_GeomFromText(${rechteck(0, 0, 1024, 150)}, 0), 'p257t')`;
        });

        for (const [name, def] of Object.entries(REGIONEN)) {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, is_hidden)
                VALUES (${uuid(def.nummer)}, ${MAP_DOMAIN}, ${def.name}, ${def.ebene}, ${def.art}, ${def.aktiv ?? true}, ${def.verborgen ?? false})
                RETURNING id::text AS id
            `;
            const id = (zeile as { id: string }).id;
            region[name] = { id, publicId: uuid(def.nummer) };
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${uuid(def.nummer + 100)}, ${MAP_DOMAIN}, ${id}, ST_GeomFromText(${def.wkt}, 0), ${def.flaecheAktiv ?? true})
            `;
        }
        for (const [name, def] of Object.entries(ORTE)) {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
                VALUES (${uuid(def.nummer)}, ${MAP_DOMAIN}, ${def.name}, 'dorf', ST_SetSRID(ST_MakePoint(${def.x}, ${def.y}), 0), 'test', TRUE, ${def.verborgen ?? false})
                RETURNING id::text AS id
            `;
            ort[name] = (zeile as { id: string }).id;
        }
        // Ein Gebiet mit einer Form im Westen der Welt (für den zusätzlichen Rahmen).
        const [gebiet] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_key, is_active, source_system)
            VALUES (${uuid(300)}, ${MAP_DOMAIN}, 'P257T Gebiet', '#B2B065', 0.7, NULL, TRUE, 'test') RETURNING id::text AS id
        `;
        region["gebietsnummer"] = { id: (gebiet as { id: string }).id, publicId: uuid(300) };
        await database.unsafe(
            `INSERT INTO territory_shape (band, territory_id, depth, source_count, area, geom, render_geom, label_geom)
             VALUES (8, $1, 0, 1, 1, ST_GeomFromText($2, 0), ST_SetSRID(ST_GeomFromText($2), 3857), ST_SetSRID(ST_MakePoint(710, 150), 0))`,
            [(gebiet as { id: string }).id, rechteck(700, 100, 720, 200)],
        );

        // Die Einträge und ihre Regeln.
        for (const name of [
            "oder",
            "und",
            "ohne",
            "flaeche",
            "flaecheohnewald",
            "klima",
            "klimavertauscht",
            "klimagerade",
            "klimasued",
            "lage1",
            "lage2",
            "wartet",
            "wartetteils",
            "verwaist",
            "masketnur",
            "tundra",
            "mehrere",
            "weltselbst",
            "eigenesgebirge",
            "oderteil",
            "ohneteil",
        ]) {
            await legeEintrag(name);
        }
        await legeRegel("oder", "oder", [
            { arten: wald, flaeche: "welt" },
            { op: "oder", arten: [["vegetation", "steppe"]], flaeche: "welt" },
        ]);
        await legeRegel("und", "und", [
            { arten: wald, flaeche: "welt" },
            { op: "und", arten: [["topographie", "gebirge"]] },
        ]);
        await legeRegel("ohne", "ohne", [
            { arten: wald, flaeche: "welt" },
            { op: "ohne", arten: [["vegetation", "wueste"]] },
        ]);
        await legeRegel("flaeche", "flaeche", [{ flaeche: "nordland" }]);
        await legeRegel("flaecheohnewald", "flaecheohnewald", [{ flaeche: "nordland" }, { op: "ohne", arten: wald }]);
        await legeRegel("klima", "klima", [{ arten: wald, flaeche: "welt", klima: ["gemaessigt", "gemaessigt"] }]);
        // Dieselbe Spanne, die Endpunkte vertauscht und weiter gefasst: gemäßigt bis subtropisch ergibt hier nur das gemäßigte Band.
        await legeRegel("klimavertauscht", "klimavertauscht", [
            { arten: wald, flaeche: "welt", klima: ["subtropisch", "gemaessigt"] },
        ]);
        await legeRegel("klimagerade", "klimagerade", [
            { arten: wald, flaeche: "welt", klima: ["gemaessigt", "subtropisch"] },
        ]);
        await legeRegel("klimasued", "klimasued", [{ arten: wald, flaeche: "welt", klima: ["tropisch", "tropisch"] }]);
        await legeRegel("lage1", "lage1", [{ arten: wald, flaeche: "welt", lage: { richtung: "sued", orte: ["x"] } }]);
        await legeRegel("lage2", "lage2", [
            { arten: wald, flaeche: "welt", lage: { richtung: "nord", orte: ["y1", "y2"] } },
        ]);
        await legeRegel("wartet", "wartet", [
            { arten: wald, flaeche: "welt" },
            { op: "oder", wiki: "Irgendwo im Wiki" },
        ]);
        await legeRegel("wartet-teils-a", "wartetteils", [
            { arten: wald, flaeche: "welt" },
            { op: "oder", wiki: "Irgendwo im Wiki" },
        ]);
        await legeRegel("wartet-teils-b", "wartetteils", [{ arten: [["vegetation", "steppe"]], flaeche: "welt" }]);
        await legeRegel("verwaist", "verwaist", [{ arten: wald, flaeche: "altland" }]);
        await legeRegel("masketnur", "masketnur", [{ lage: { richtung: "nord", orte: ["x"] } }]);
        await legeRegel("tundra", "tundra", [{ arten: [["vegetation", "tundra"]], flaeche: "welt" }]);
        await legeRegel("mehrere-a", "mehrere", [{ arten: wald, flaeche: "westland" }]);
        await legeRegel("mehrere-b", "mehrere", [{ arten: [["vegetation", "steppe"]], flaeche: "welt" }]);
        await legeRegel("mehrere-h", "mehrere", [{ arten: [["topographie", "gebirge"]], flaeche: "welt" }], "herkunft");
        await legeRegel("weltselbst", "weltselbst", [{ flaeche: "welt" }]);
        // Zwei angeschnittene Stücke derselben Landschaft, vereinigt beziehungsweise voneinander abgezogen.
        await legeRegel("oderteil", "oderteil", [
            { arten: wald, flaeche: "nordland" },
            { op: "oder", arten: wald, flaeche: "westland" },
        ]);
        await legeRegel("ohneteil", "ohneteil", [
            { arten: wald, flaeche: "westland" },
            { op: "ohne", arten: wald, flaeche: "nordland" },
        ]);
        await legeRegel("eigenesgebirge", "eigenesgebirge", [{ arten: [["topographie", "gebirge"]], flaeche: "welt" }]);
    }, 120_000);

    afterAll(async () => {
        await raeumeAuf();
        await database.begin(async (tx) => {
            await tx`SELECT set_config('climate.deriving', 'on', true)`;
            await tx`DELETE FROM climate_band`;
            for (const band of alteBaender) {
                await tx`INSERT INTO climate_band (type_key, geom, source_fingerprint, derived_at) VALUES (${band.type_key}, ST_GeomFromEWKB(decode(${band.ewkb}, 'hex')), ${band.source_fingerprint}, ${band.derived_at})`;
            }
        });
        await database.end({ timeout: 5 });
    }, 60_000);

    beforeEach(() => {
        leereVorkommenSpeicher();
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Hilfen
    // -------------------------------------------------------------------------------------------------------------------

    const A = async (
        name: string,
        optionen: Parameters<typeof trefferDesEintrags>[2] = {},
    ): Promise<VorkommenTreffer> => {
        const treffer = await trefferDesEintrags(database, (eintrag[name] as { publicId: string }).publicId, optionen);
        if (treffer === undefined) throw new Error(`kein Treffer für ${name}`);
        return treffer;
    };
    const ersteRegel = (treffer: VorkommenTreffer): VorkommenRegelTreffer => {
        const r = treffer.regeln[0];
        if (r === undefined) throw new Error("keine Regel im Treffer");
        return r;
    };
    const namen = (r: VorkommenRegelTreffer, schnitt?: "ganz" | "angeschnitten"): string[] =>
        r.landschaften
            .filter((l) => schnitt === undefined || l.schnitt === schnitt)
            .map((l) => l.name.replace("P257T ", ""))
            .sort();
    /** Die eigenen Orte der Welt, die die Regel trifft (fremde Orte der Testdatenbank zählen nicht). */
    const orteVon = (r: VorkommenRegelTreffer): string[] =>
        r.siedlungen
            .filter((s) => s.publicId.startsWith("25700000-"))
            .map((s) => s.name.replace("P257T ", ""))
            .sort();
    const O = (...schluessel: string[]): string[] =>
        schluessel.map((s) => (ORTE[s] as { name: string }).name.replace("P257T ", "")).sort();

    /** Liegt jeder Punkt in der leuchtenden Geometrie der Regel aus A? Ganze Landschaften über ihre Flächen, angeschnittene und der Rest über ihre Formen. */
    async function leuchtet(r: VorkommenRegelTreffer, punkte: readonly VorkommenPunkt[]): Promise<boolean[]> {
        const ganz = r.landschaften.filter((l) => l.schnitt === "ganz").map((l) => l.regionId);
        const formen = [
            ...r.landschaften.flatMap((l) => (l.form === undefined ? [] : [JSON.stringify(l.form)])),
            ...(r.rest === undefined ? [] : [JSON.stringify(r.rest.form)]),
        ];
        const zeilen = await database.unsafe<{ i: number; lit: boolean }[]>(
            `SELECT u.i::int AS i, (
                EXISTS (SELECT 1 FROM region_area a WHERE a.is_active AND a.region_id::text = ANY($3::text[]) AND a.geom && pt.g AND ST_Intersects(a.geom, pt.g))
                OR EXISTS (SELECT 1 FROM unnest($4::text[]) f WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(f), 0), pt.g))
              ) AS lit
               FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS u(x, y, i)
               CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_MakePoint(u.x, u.y), 0) AS g) pt
              ORDER BY u.i`,
            [punkte.map((p) => p.x), punkte.map((p) => p.y), ganz, formen] as never[],
        );
        return zeilen.map((z) => z.lit);
    }

    /** Die Regeln des Eintrags, die B an jedem Punkt nennt. */
    const trageB = (antworten: readonly VorkommenAmPunkt[], eintragName: string): string[][] =>
        antworten.map((a) =>
            a.eintraege
                .filter((e) => e.id === (eintrag[eintragName] as { id: string }).id)
                .flatMap((e) => e.beziehungen.flatMap((b) => b.regeln.map((x) => x.ruleId)))
                .sort(),
        );

    /** Zufallspunkte (feste Saat) in und um die Welt, dazu Punkte beidseits jeder Kante der Flächen (0,01 daneben). */
    function stichproben(): VorkommenPunkt[] {
        let z = 257;
        const zufall = (): number => {
            z = (z + 0x6d2b79f5) | 0;
            let t = Math.imul(z ^ (z >>> 15), 1 | z);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const punkte: VorkommenPunkt[] = [];
        for (let i = 0; i < 300; i += 1) punkte.push({ x: 692 + zufall() * 116, y: 92 + zufall() * 116 });
        const kanten: [number, number, number, number][] = [
            [700, 100, 800, 200],
            [700, 150, 800, 200],
            [700, 100, 750, 200],
            [710, 110, 730, 190],
            [740, 110, 790, 150],
            [740, 145, 790, 175],
            [720, 130, 760, 170],
            [770, 160, 795, 195],
            [745, 140, 775, 160],
        ];
        for (const [x0, y0, x1, y1] of kanten) {
            const mx = (x0 + x1) / 2 + 0.37;
            const my = (y0 + y1) / 2 + 0.41;
            for (const d of [-0.01, 0.01]) {
                punkte.push({ x: mx, y: y0 + d }, { x: mx, y: y1 + d }, { x: x0 + d, y: my }, { x: x1 + d, y: my });
            }
        }
        // Die Tundra-Form: in den beiden Dreiecken, und dazwischen unten (außerhalb beider).
        punkte.push({ x: 781, y: 104 }, { x: 788, y: 104 }, { x: 785, y: 101 }, { x: 785, y: 109 });
        // Auf der Diagonalen der Lage 2 und auf den Rändern ist ein Punkt kein fairer Fall: weg damit.
        return punkte.filter((p) => {
            const ganz = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-4;
            const abstandDiagonale = Math.abs(0.6 * (p.x - 700) + 120 - p.y) / Math.hypot(0.6, 1);
            return !(ganz(p.x) || ganz(p.y) || abstandDiagonale < 1e-3 || Math.abs(p.y - 150) < 1e-3);
        });
    }

    /** DIE ZUSAGE: Ein Punkt liegt in der leuchtenden Geometrie aus A genau dann, wenn B die Regel nennt. */
    async function pruefeEinheitlichkeit(eintragName: string): Promise<{ punkte: number; treffer: number }> {
        const punkte = stichproben();
        const a = await A(eintragName, { nachkommastellen: 6 });
        const b = trageB(await eintraegeAnPunkten(database, punkte), eintragName);
        let treffer = 0;
        for (const r of a.regeln) {
            const lit = await leuchtet(r, punkte);
            const abweichungen: string[] = [];
            lit.forEach((istLit, i) => {
                const nenntB = (b[i] ?? []).includes(r.ruleId);
                if (nenntB) treffer += 1;
                if (istLit !== nenntB)
                    abweichungen.push(`${JSON.stringify(punkte[i])} A=${String(istLit)} B=${String(nenntB)}`);
            });
            expect(abweichungen, `${eintragName}: A und B weichen ab`).toEqual([]);
            // Die Siedlungen: dieselbe Zusage für die Orte der Welt, über ganz andere Wege (SQL gegen Prozess).
            for (const o of Object.values(ORTE)) {
                if (o.verborgen === true) continue;
                const inA = r.siedlungen.some((s) => s.publicId === uuid(o.nummer));
                const aufOrt = trageB(await eintraegeAnPunkten(database, [{ x: o.x, y: o.y }]), eintragName)[0] ?? [];
                expect(aufOrt.includes(r.ruleId), `${eintragName}: Ort ${o.name}`).toBe(inA);
            }
        }
        return { punkte: punkte.length, treffer };
    }

    // -------------------------------------------------------------------------------------------------------------------
    // Richtung A: Pflichtfälle
    // -------------------------------------------------------------------------------------------------------------------

    it("🔴 oder: Wald und Steppe in der Welt; der verborgene Wald, der Wald ohne Fläche und die Tundra bleiben draußen", async () => {
        const r = ersteRegel(await A("oder"));
        expect(namen(r)).toEqual(["Steppe", "Wald A", "Wald B", "Wald C"]);
        expect(namen(r, "angeschnitten")).toEqual([]);
        expect(orteVon(r)).toEqual(O("p1", "p2", "p3", "p4", "p5", "p6", "p7"));
        expect(r.verwaiste).toBe(0);
        expect(r.beziehung).toBe("verbreitung");
        // Der gemeinsame Rahmen umfasst alle Treffer.
        expect(r.rahmen).toEqual({ x0: 710, y0: 110, x1: 795, y1: 195 });
        for (const l of r.landschaften) {
            expect(l.form).toBeUndefined();
            expect(l.publicId).toMatch(/^25700000-/u);
        }
    });

    it("🔴 und (Wald und Gebirge): keine ganze Landschaft, die Stücke im Schnitt, und die Orte im Schnitt", async () => {
        const r = ersteRegel(await A("und"));
        // Kein Wald liegt ganz im Gebirge: Es gibt keine ganze Landschaft, nur die Stücke der Wälder, die im Gebirge liegen.
        expect(namen(r, "ganz")).toEqual([]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald A", "Wald B", "Wald C"]);
        expect(orteVon(r)).toEqual(O("p2", "p4", "p6"));
        const stueckA = r.landschaften.find((l) => l.name === "P257T Wald A");
        expect(stueckA?.rahmen).toEqual({ x0: 720, y0: 130, x1: 730, y1: 170 });
    });

    it("🔴 ohne (Wald in der Welt ohne Wüste): der Abzug schneidet, was die Wüste überdeckt; der Ort in der Wüste fällt heraus", async () => {
        const r = ersteRegel(await A("ohne"));
        expect(namen(r, "ganz")).toEqual(["Wald A"]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald B", "Wald C"]);
        expect(orteVon(r)).toEqual(O("p1", "p2", "p3", "p6", "p7"));
    });

    it("🔴 oder über zwei Rahmen: die Stücke derselben Landschaft werden vereinigt (Wald C aus Nordland und Westland)", async () => {
        const r = ersteRegel(await A("oderteil"));
        expect(namen(r, "ganz")).toEqual(["Wald A"]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald B", "Wald C"]);
        const stueckC = r.landschaften.find((l) => l.name === "P257T Wald C");
        // Nordland [150, 175] und Westland [740, 750] x [145, 175] zusammen: von x 740 bis 790 und von y 145 bis 175.
        expect(stueckC?.rahmen).toEqual({ x0: 740, y0: 145, x1: 790, y1: 175 });
        expect(orteVon(r)).toEqual(O("p1", "p2", "p3", "p6"));
    });

    it("🔴 ohne über zwei Rahmen: Wald im Westland ohne Wald in Nordland (das Stück, das in Nordland liegt, wird abgezogen)", async () => {
        const r = ersteRegel(await A("ohneteil"));
        expect(namen(r, "ganz")).toEqual([]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald A", "Wald B", "Wald C"]);
        const stueckA = r.landschaften.find((l) => l.name === "P257T Wald A");
        expect(stueckA?.rahmen).toEqual({ x0: 710, y0: 110, x1: 730, y1: 150 });
        const stueckC = r.landschaften.find((l) => l.name === "P257T Wald C");
        expect(stueckC?.rahmen).toEqual({ x0: 740, y0: 145, x1: 750, y1: 150 });
        expect(orteVon(r)).toEqual(O("p1", "p3"));
    });

    it("🔴 Art leer plus Fläche ist die Fläche selbst, nicht ihre Kinder (Nordland, nicht die Wälder darin)", async () => {
        const r = ersteRegel(await A("flaeche"));
        expect(namen(r)).toEqual(["Nordland"]);
        expect(namen(r, "ganz")).toEqual(["Nordland"]);
        expect(orteVon(r)).toEqual(O("p2", "p5", "p6"));
    });

    it("🔴 Fläche ohne Art, davon ab: Nordland ohne Wald ist Nordland mit Löchern", async () => {
        const r = ersteRegel(await A("flaecheohnewald"));
        expect(namen(r, "angeschnitten")).toEqual(["Nordland"]);
        expect(orteVon(r)).toEqual(O("p5"));
    });

    it("🔴 Klima: nur das gemäßigte Band (nördlich von y = 150); der Wald auf der Linie liefert nichts, der Wald über die Linie nur sein Nordstück", async () => {
        const r = ersteRegel(await A("klima"));
        expect(namen(r, "ganz")).toEqual([]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald A", "Wald C"]);
        expect(orteVon(r)).toEqual(O("p2", "p6"));
        const stueckA = r.landschaften.find((l) => l.name === "P257T Wald A");
        expect(stueckA?.rahmen.y0).toBe(150);
    });

    it("🔴 Klimaspanne vertauscht: von subtropisch bis gemäßigt ist dasselbe wie von gemäßigt bis subtropisch", async () => {
        const vertauscht = ersteRegel(await A("klimavertauscht"));
        const gerade = ersteRegel(await A("klimagerade"));
        const ohneTausch = ersteRegel(await A("klima"));
        const wesen = (r: VorkommenRegelTreffer): unknown => ({
            landschaften: r.landschaften.map((l) => [l.name, l.schnitt, l.form, l.rahmen]),
            siedlungen: r.siedlungen.map((s) => s.publicId),
            rahmen: r.rahmen,
        });
        expect(wesen(vertauscht)).toEqual(wesen(gerade));
        // In dieser Welt gibt es nur das gemäßigte und das tropische Band, die Spanne bis subtropisch endet also vor dem tropischen: dasselbe wie nur gemäßigt.
        expect(wesen(vertauscht)).toEqual(wesen(ohneTausch));
        const sued = ersteRegel(await A("klimasued"));
        expect(namen(sued)).toEqual(["Wald A", "Wald B", "Wald C"]);
        expect(orteVon(sued)).toEqual(O("p1", "p3", "p4", "p7"));
    });

    it("🔴 Lage mit einem Ort: südlich von Bezug X (y = 150) gilt die Linie mit, der Wald B ist ganz", async () => {
        const r = ersteRegel(await A("lage1"));
        expect(namen(r, "ganz")).toEqual(["Wald B"]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald A", "Wald C"]);
        expect(orteVon(r)).toEqual(O("p1", "p3", "p4", "p7"));
    });

    it("🔴 Lage mit zwei Orten: nördlich der Linie durch Y1 und Y2 (schräg, y = 120 + 0,6 · (x − 700))", async () => {
        const r = ersteRegel(await A("lage2"));
        expect(namen(r, "ganz")).toEqual([]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald A", "Wald B", "Wald C"]);
        expect(orteVon(r)).toEqual(O("p2", "p6"));
    });

    it("🔴 Eine wartende Fläche lässt die ganze Regel außen vor; die übrigen Regeln des Eintrags gelten", async () => {
        const nur = await A("wartet");
        expect(nur.regeln).toEqual([]);
        expect(nur.rahmen).toBeNull();
        const teils = await A("wartetteils");
        expect(teils.regeln).toHaveLength(1);
        expect(namen(ersteRegel(teils))).toEqual(["Steppe"]);
        const b = await eintraegeAmPunkt(database, { x: 785, y: 180 });
        expect(b.eintraege.some((e) => e.id === (eintrag["wartet"] as { id: string }).id)).toBe(false);
        const imWald = await eintraegeAmPunkt(database, { x: 715, y: 120 });
        expect(imWald.eintraege.some((e) => e.id === (eintrag["wartet"] as { id: string }).id)).toBe(false);
        expect(imWald.eintraege.some((e) => e.id === (eintrag["wartetteils"] as { id: string }).id)).toBe(false);
    });

    it("🔴 Die Fläche einer Bedingung gibt es nicht mehr: sie trifft nichts, sie schränkt nie ab (und wird gezählt)", async () => {
        const r = ersteRegel(await A("verwaist"));
        expect(r.landschaften).toEqual([]);
        expect(r.siedlungen).toEqual([]);
        expect(r.rahmen).toBeNull();
        expect(r.verwaiste).toBe(1);
        // Hätte die Bedingung stillschweigend nichts eingeschränkt, träfe der Wald überall.
        const b = await eintraegeAmPunkt(database, { x: 715, y: 120 });
        expect(b.eintraege.some((e) => e.id === (eintrag["verwaist"] as { id: string }).id)).toBe(false);
    });

    it("🔴 Eine Bedingung nur mit Lage trifft ein Stück der Karte ohne Landschaft: der Rest, mit Rahmen", async () => {
        const r = ersteRegel(await A("masketnur"));
        expect(r.landschaften).toEqual([]);
        expect(r.rest).toBeDefined();
        expect(r.rest?.rahmen.y0).toBe(150);
        expect(r.rest?.rahmen.y1).toBe(1024);
        expect(orteVon(r)).toEqual(O("p2", "p5", "p6"));
        expect(r.rahmen).toEqual(r.rest?.rahmen);
    });

    it("eine sich selbst schneidende Fläche (Tundra) wird beim Lesen repariert und rechnet ohne Fehler", async () => {
        const r = ersteRegel(await A("tundra"));
        expect(namen(r, "ganz")).toEqual(["Tundra"]);
        // Die Form ist in der Tafel ungültig (zwei Dreiecke, die sich in der Mitte berühren); A rechnet auf der reparierten, B fragt die Tafel: in den Dreiecken stimmen beide überein.
        const [links, mitteUnten, rechts] = trageB(
            await eintraegeAnPunkten(database, [
                { x: 781, y: 104 },
                { x: 785, y: 101 },
                { x: 788, y: 104 },
            ]),
            "tundra",
        );
        expect([links?.length, mitteUnten?.length, rechts?.length]).toEqual([1, 0, 1]);
    });

    it("🔴 Ein Eintrag ohne aktive Regel, ein unbekannter und eine verfehlte Kennung: leer oder undefined", async () => {
        const [leer] = await database<{ public_id: string }[]>`
            INSERT INTO lore_entry (wiki_key, kind, name, legacy_origin, source_system) VALUES (${KEY + "leer"}, 'fauna', 'P257T leer', 'manual', 'test') RETURNING public_id::text AS public_id
        `;
        const treffer = await trefferDesEintrags(database, (leer as { public_id: string }).public_id);
        expect(treffer?.regeln).toEqual([]);
        expect(treffer?.rahmen).toBeNull();
        expect(await trefferDesEintrags(database, uuid(999))).toBeUndefined();
        expect(await trefferDesEintrags(database, "kein-uuid")).toBeUndefined();
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Der zusätzliche Rahmen
    // -------------------------------------------------------------------------------------------------------------------

    it("🔴 Der zusätzliche Rahmen schneidet zu: „oder“ im Westland — Wald A ganz, Wald B und C angeschnitten am Rand x = 750, die Steppe fällt weg", async () => {
        const r = ersteRegel(
            await A("oder", { rahmen: { regionIds: [(region["westland"] as { publicId: string }).publicId] } }),
        );
        expect(namen(r, "ganz")).toEqual(["Wald A"]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald B", "Wald C"]);
        for (const l of r.landschaften.filter((x) => x.schnitt === "angeschnitten")) expect(l.rahmen.x1).toBe(750);
        expect(orteVon(r)).toEqual(O("p1", "p2", "p3"));
    });

    it("der zusätzliche Rahmen als Gebiet (feinste Form) und beides zugleich (Schnitt)", async () => {
        const gebiet = Number((region["gebietsnummer"] as { id: string }).id);
        const r = ersteRegel(await A("oder", { rahmen: { territoryId: gebiet } }));
        expect(namen(r)).toEqual(["Wald A"]);
        expect(namen(r, "angeschnitten")).toEqual(["Wald A"]);
        expect(r.rahmen).toEqual({ x0: 710, y0: 110, x1: 720, y1: 190 });
        const beide = ersteRegel(
            await A("oder", {
                rahmen: { territoryId: gebiet, regionIds: [(region["nordland"] as { publicId: string }).publicId] },
            }),
        );
        expect(beide.rahmen).toEqual({ x0: 710, y0: 150, x1: 720, y1: 190 });
        // Ein Rahmen, der nichts trägt, lässt nichts leuchten.
        const keiner = ersteRegel(await A("oder", { rahmen: { regionIds: [uuid(998)] } }));
        expect(keiner.landschaften).toEqual([]);
    });

    // -------------------------------------------------------------------------------------------------------------------
    // Richtung B
    // -------------------------------------------------------------------------------------------------------------------

    it("🔴 B: mehrere Regeln derselben Beziehung sind eine Vereinigung (eine genügt, beide stehen da), andere Beziehungen stehen getrennt", async () => {
        const wald = await eintraegeAmPunkt(database, { x: 715, y: 120 });
        const e = wald.eintraege.find((x) => x.id === (eintrag["mehrere"] as { id: string }).id);
        expect(e?.beziehungen.map((b) => [b.beziehung, b.regeln.map((r) => r.ruleId)])).toEqual([
            ["verbreitung", [regel["mehrere-a"]]],
        ]);
        const steppe = await eintraegeAmPunkt(database, { x: 785, y: 180 });
        expect(
            steppe.eintraege
                .find((x) => x.id === (eintrag["mehrere"] as { id: string }).id)
                ?.beziehungen.map((b) => [b.beziehung, b.regeln.map((r) => r.ruleId)]),
        ).toEqual([["verbreitung", [regel["mehrere-b"]]]]);
        // Im Wald auf dem Gebirge: Verbreitung (Wald im Westland) UND Herkunft (Gebirge in der Welt), je mit ihrer Regel.
        const beides = await eintraegeAmPunkt(database, { x: 725, y: 155 });
        const beide = beides.eintraege.find((x) => x.id === (eintrag["mehrere"] as { id: string }).id);
        expect(beide?.beziehungen.map((b) => b.beziehung).sort()).toEqual(["herkunft", "verbreitung"]);
        expect(beide?.art).toBe("flora");
        expect(beide?.eintragId).toBe((eintrag["mehrere"] as { publicId: string }).publicId);
    });

    it("🔴 B als Bündel: je Punkt dieselbe Antwort wie einzeln, in der Reihenfolge der Eingabe, auch für Punkte ohne Treffer", async () => {
        const punkte = [
            { x: 715, y: 120 },
            { x: 785, y: 180 },
            { x: 10, y: 10 },
            { x: 725, y: 155 },
        ];
        const buendel = await eintraegeAnPunkten(database, punkte);
        expect(buendel.map((a) => a.punkt)).toEqual(punkte);
        for (const [i, punkt] of punkte.entries()) {
            const einzeln = await eintraegeAmPunkt(database, punkt);
            expect(buendel[i]).toEqual(einzeln);
        }
        expect(await eintraegeAnPunkten(database, [])).toEqual([]);
    });

    it("🔴 B für eine Fläche: sie erbt von größeren Landschaften, nie von kleineren — und der Wald trägt sich selbst", async () => {
        const welt = await eintraegeAnFlaechen(database, [(region["welt"] as { publicId: string }).publicId]);
        const idsWelt = (welt?.eintraege ?? []).map((e) => e.id);
        // Die Welt trägt, was „in der Welt“ gilt, aber nicht, was in dem Wald lebt, der zufällig ihren Mittelpunkt überdeckt.
        expect(idsWelt).toContain((eintrag["weltselbst"] as { id: string }).id);
        expect(idsWelt).not.toContain((eintrag["oder"] as { id: string }).id);
        expect(idsWelt).not.toContain((eintrag["flaeche"] as { id: string }).id);
        // Der Wald A ist ein Wald in der Welt: seine eigene Art und die größere Welt tragen.
        const waldA = await eintraegeAnFlaechen(database, [(region["waldA"] as { publicId: string }).publicId]);
        const idsA = (waldA?.eintraege ?? []).map((e) => e.id);
        expect(idsA).toContain((eintrag["oder"] as { id: string }).id);
        expect(idsA).toContain((eintrag["weltselbst"] as { id: string }).id);
        // Nordland liegt in der Welt (größer) und trägt die Weltregel; der Wald in der Welt zählt nicht (der Wald ist kleiner).
        const nordland = await eintraegeAnFlaechen(database, [(region["nordland"] as { publicId: string }).publicId]);
        const idsN = (nordland?.eintraege ?? []).map((e) => e.id);
        expect(idsN).toContain((eintrag["weltselbst"] as { id: string }).id);
        expect(idsN).toContain((eintrag["flaeche"] as { id: string }).id);
        expect(idsN).not.toContain((eintrag["oder"] as { id: string }).id);
        // Unbekannte Fläche: nichts.
        expect(await eintraegeAnFlaechen(database, [uuid(997)])).toBeUndefined();
        expect(await eintraegeAnFlaechen(database, [])).toBeUndefined();
    });

    // -------------------------------------------------------------------------------------------------------------------
    // DIE ZUSAGE: A und B sind dieselbe Auswertung
    // -------------------------------------------------------------------------------------------------------------------

    for (const name of [
        "oder",
        "und",
        "ohne",
        "flaeche",
        "flaecheohnewald",
        "klima",
        "klimavertauscht",
        "klimasued",
        "lage1",
        "lage2",
        "wartetteils",
        "verwaist",
        "masketnur",
        "tundra",
        "mehrere",
        "weltselbst",
        "oderteil",
        "ohneteil",
    ]) {
        it(`🔴 Einheitlichkeit: was in A leuchtet, nennt B — und umgekehrt (${name}, Stichproben im Inneren, am Rand und außerhalb)`, async () => {
            const { punkte, treffer } = await pruefeEinheitlichkeit(name);
            expect(punkte).toBeGreaterThan(300);
            // Ein Fall, der nie trifft, bewiese nichts (außer dem, der nichts treffen soll). Die Tundra ist ein winziger Fleck: Nur die vier festen Punkte liegen darin.
            if (name !== "verwaist")
                expect(treffer, `${name} trifft keinen Punkt`).toBeGreaterThan(name === "tundra" ? 1 : 10);
        }, 60_000);
    }

    // -------------------------------------------------------------------------------------------------------------------
    // Der Zwischenspeicher
    // -------------------------------------------------------------------------------------------------------------------

    it("🔴 Zwischenspeicher: der zweite Abruf liefert dasselbe Objekt; Ändern der Karte und der Regeln rechnet neu", async () => {
        const erste = await A("oder");
        const zweite = await A("oder");
        expect(zweite).toBe(erste);
        // Wald A verbergen: der Stand der Karte ändert sich (die Revision der Region steigt), der Wald ist weg.
        await database`UPDATE region SET is_hidden = TRUE WHERE id = ${(region["waldA"] as { id: string }).id}::bigint`;
        try {
            const ohneA = await A("oder");
            expect(ohneA).not.toBe(erste);
            expect(namen(ersteRegel(ohneA))).toEqual(["Steppe", "Wald B", "Wald C"]);
            const b = trageB(await eintraegeAnPunkten(database, [{ x: 715, y: 120 }]), "oder");
            expect(b[0]).toEqual([]);
        } finally {
            await database`UPDATE region SET is_hidden = FALSE WHERE id = ${(region["waldA"] as { id: string }).id}::bigint`;
        }
        expect(namen(ersteRegel(await A("oder")))).toEqual(["Steppe", "Wald A", "Wald B", "Wald C"]);
        // Eine neue Regel des Eintrags: andere Fingerabdrücke, neues Ergebnis.
        const vorher = await A("eigenesgebirge");
        await legeRegel("eigenesgebirge-zwei", "eigenesgebirge", [
            { arten: [["vegetation", "steppe"]], flaeche: "welt" },
        ]);
        const nachher = await A("eigenesgebirge");
        expect(nachher).not.toBe(vorher);
        expect(nachher.regeln).toHaveLength(2);
        // Die Zahl der Einträge bleibt begrenzt (kein unbegrenztes Wachstum).
    });

    it("Gleichzeitige Fragen nach demselben Eintrag rechnen einmal", async () => {
        const [a, b, c] = await Promise.all([A("oder"), A("oder"), A("oder")]);
        expect(b).toBe(a);
        expect(c).toBe(a);
    });
});

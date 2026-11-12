import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveClimateSmooth } from "../src/areas/smooth.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { CLIMATE_ZONES, importClimate, type LegacyBand } from "../src/migration/climate.ts";

/**
 * Die Klimazonen mit geglätteten Übergängen (WI-0077, Migration 0072; Betreiber 2026-10-04: „klimazonen füllen die ganze
 * karte, ich will nicht, dass die kontrollpunkte and den ränder geglättet werden“).
 *
 * Jeder Teiler wird einmal geglättet und von beiden Zonen benutzt; seine Enden am Kartenrand bleiben, der Kartenrand bleibt
 * gerade, und die Bänder füllen die Karte lückenlos. Die Fixture hat zackige Linien, eine Blase (eine Linie läuft rückwärts,
 * wie Legacy es für die Khôm erlaubt) und zwei Teiler, die ein Stück weit 0,00002 E nebeneinander laufen (wie Steppen- und
 * Wüstengrenze in Legacys Daten): Einzeln geglättet kreuzten sie sich dort. Wie `climate.test.ts` ersetzt der Test die
 * Klimatafeln der Testdatenbank.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MAP = 1024;

/** Sieben zackige Linien von Rand zu Rand, eine davon mit einer Blase. */
function dividers(): { south: string; points: [number, number][] }[] {
    return CLIMATE_ZONES.slice(1).map((zone, index) => {
        const y = 900 - index * 100;
        if (zone === "trockene_subtropen") {
            return {
                south: zone,
                points: [
                    [0, y + 3],
                    [400, y],
                    [420, y - 10],
                    [500, y + 20],
                    [450, y + 40],
                    [520, y + 40],
                    [600, y],
                    [MAP, y - 7],
                ],
            };
        }
        if (zone === "subtropisch") {
            // Läuft zwischen x 390 und 400 um 0,00002 E unter der Steppengrenze (y 500,075 bis 500), wie in Legacys Daten, und knickt
            // danach mit ihr ab: Einzeln geglättet schnitte die Steppengrenze (langes Stück davor) die Wüstengrenze (kurzes Stück).
            return {
                south: zone,
                points: [
                    [0, y + 2],
                    [200, y + 12],
                    [390, 500.075 - 0.00002],
                    [400, 500 - 0.00002],
                    [420, 489],
                    [600, y + 15],
                    [800, y - 5],
                    [MAP, y + 4],
                ],
            };
        }
        return {
            south: zone,
            points: [
                [0, y + 2],
                [200, y + 12],
                [400, y - 10],
                [600, y + 15],
                [800, y - 5],
                [MAP, y + 4],
            ],
        };
    });
}

/** Die acht Bänder, wie Legacy sie gespeichert hätte. */
function bands(): LegacyBand[] {
    const lines = dividers();
    const edge = (y: number): [number, number][] => [
        [0, y],
        [MAP, y],
    ];
    return CLIMATE_ZONES.map((zone, index) => {
        const upper = index === 0 ? edge(MAP) : (lines[index - 1]?.points as [number, number][]);
        const lower = index === CLIMATE_ZONES.length - 1 ? edge(0) : (lines[index]?.points as [number, number][]);
        const ring = [...upper, ...[...lower].reverse(), upper[0] as [number, number]];
        return { typeKey: zone, geoJson: JSON.stringify({ type: "Polygon", coordinates: [ring] }) };
    });
}

describeWithDatabase("Klimazonen mit geglätteten Übergängen (Migration 0072)", () => {
    let database: Database;

    const sourceStamp = async (): Promise<string> => {
        const [row] = await database<{ h: string }[]>`
            SELECT md5(
                (SELECT string_agg(south_type_key || ST_AsEWKB(geom)::text || revision::text, ',' ORDER BY south_type_key) FROM climate_divider)
                || (SELECT string_agg(type_key || ST_AsEWKB(geom)::text || source_fingerprint, ',' ORDER BY type_key) FROM climate_band)
            ) AS h
        `;
        return row?.h ?? "";
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await database.begin(async (transaction) => {
            await transaction`SELECT set_config('climate.deriving', 'on', true)`;
            await transaction`DELETE FROM climate_band_smooth`;
            await transaction`DELETE FROM climate_band`;
            await transaction`DELETE FROM climate_divider`;
        });
        await importClimate(database, bands());
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 rechnet beim ersten Mal, beim zweiten nichts, und die Quelle bleibt, wie sie ist", async () => {
        const before = await sourceStamp();
        const first = await deriveClimateSmooth(database);
        expect(first).toMatchObject({ computed: true, bands: 8, smoothed: 8, fallbacks: 0 });
        expect(first.area).toBeCloseTo(MAP * MAP, 2);
        const second = await deriveClimateSmooth(database);
        expect(second.computed).toBe(false);
        expect(await sourceStamp()).toBe(before);
    });

    it("🔴 die Bänder füllen die ganze Karte: keine Lücke, keine Überlappung", async () => {
        const [row] = await database<{ total: number; overlap: number; missing: number }[]>`
            SELECT (SELECT sum(ST_Area(geom)) FROM climate_band_smooth) AS total,
                   (SELECT COALESCE(sum(ST_Area(ST_Intersection(a.geom, b.geom))), 0)
                    FROM climate_band_smooth a JOIN climate_band_smooth b ON a.type_key < b.type_key AND a.geom && b.geom) AS overlap,
                   (SELECT ST_Area(ST_Difference(ST_MakeEnvelope(0, 0, ${MAP}, ${MAP}, 0), ST_Union(geom))) FROM climate_band_smooth) AS missing
        `;
        expect(row?.total).toBeCloseTo(MAP * MAP, 3);
        expect(row?.overlap).toBeLessThan(1e-6);
        expect(row?.missing).toBeLessThan(1e-6);
    });

    it("🔴 jeder Übergang ist eine Kurve, einmal geglättet: die Grenze zwischen Nord und Süd ist der geglättete Teiler", async () => {
        for (const [index, zone] of CLIMATE_ZONES.slice(1).entries()) {
            const northern = CLIMATE_ZONES.slice(0, index + 1);
            const [row] = await database<
                { smoothed: number; raw: number; distance: number; outside: number; crossed: boolean }[]
            >`
                WITH n AS (SELECT ST_Union(geom) AS g FROM climate_band_smooth WHERE type_key = ANY(${northern})),
                     s AS (SELECT ST_Union(geom) AS g FROM climate_band_smooth WHERE NOT type_key = ANY(${northern})),
                     lines AS (SELECT south_type_key AS k, geom,
                                      ST_SimplifyPreserveTopology(ST_ChaikinSmoothing(geom, 3, true), 0.004) AS g
                               FROM climate_divider),
                     line AS (SELECT * FROM lines WHERE k = ${zone}),
                     border AS (SELECT ST_Intersection(ST_Boundary(n.g), ST_Boundary(s.g)) AS g FROM n, s)
                SELECT ST_Length(line.g) AS smoothed, ST_Length(line.geom) AS raw,
                       ST_HausdorffDistance(border.g, line.g) AS distance,
                       -- Was von der Grenze auf keinem geglätteten Teiler liegt (E): nichts.
                       ST_Length(ST_Difference(border.g, ST_Buffer((SELECT ST_Union(g) FROM lines), 1e-6))) AS outside,
                       EXISTS (SELECT 1 FROM lines o WHERE o.k <> line.k AND ST_Intersects(o.g, line.g)) AS crossed
                FROM line, border
            `;
            // Eine Kurve: kürzer als die zackige Ausgangslinie, und die Grenze liegt nur auf geglätteten Teilern.
            expect(row?.smoothed ?? 0, zone).toBeLessThan(row?.raw ?? 0);
            expect(row?.outside ?? 1, zone).toBeLessThan(1e-6);
            // Wo kein Nachbar den Teiler kreuzt, ist die Grenze Punkt für Punkt der geglättete Teiler, für beide Zonen dieselbe.
            // Wo einer ihn kreuzen würde (Steppen- gegen Wüstengrenze), liegen beide dort aufeinander.
            if (row?.crossed === false) expect(row.distance, zone).toBeLessThan(1e-9);
        }
    });

    it("🔴 wo zwei Teiler fast aufeinander liegen, bleibt jedes Band gültig, und kein Band überlappt ein anderes", async () => {
        // Die Gegenprobe: Die Fixture prüft den Fall wirklich, einzeln geglättet kreuzen sich die beiden Teiler.
        const [cross] = await database<{ crosses: boolean }[]>`
            WITH l AS (SELECT south_type_key AS k, ST_SimplifyPreserveTopology(ST_ChaikinSmoothing(geom, 3, true), 0.004) AS g
                       FROM climate_divider)
            SELECT ST_Intersects(a.g, b.g) AS crosses FROM l a, l b WHERE a.k = 'trockene_subtropen' AND b.k = 'subtropisch'
        `;
        expect(cross?.crosses).toBe(true);
        const rows = await database<{ type_key: string; valid: boolean; parts: number }[]>`
            SELECT type_key, ST_IsValid(geom) AS valid, ST_NumGeometries(geom) AS parts FROM climate_band_smooth ORDER BY type_key
        `;
        expect(rows).toHaveLength(8);
        expect(rows.every((row) => row.valid)).toBe(true);
        // Die Renderansicht liefert jeden Teil als eigene Zeile derselben Zone.
        const [render] = await database<{ n: number; zones: number }[]>`
            SELECT count(*)::int AS n, count(DISTINCT type_key)::int AS zones FROM climate_band_render
        `;
        expect(render).toEqual({ n: rows.reduce((sum, row) => sum + row.parts, 0), zones: 8 });
    });

    it("🔴 die Endpunkte am Kartenrand bleiben exakt liegen, und der Kartenrand bleibt gerade", async () => {
        for (const line of dividers()) {
            const [start, end] = [
                line.points[0] as [number, number],
                line.points[line.points.length - 1] as [number, number],
            ];
            const [row] = await database<{ start: boolean; end: boolean }[]>`
                SELECT bool_and(ST_Intersects(ST_Boundary(geom), ST_SetSRID(ST_MakePoint(${start[0]}, ${start[1]}), 0))) AS start,
                       bool_and(ST_Intersects(ST_Boundary(geom), ST_SetSRID(ST_MakePoint(${end[0]}, ${end[1]}), 0))) AS "end"
                FROM climate_band_smooth
                WHERE type_key IN (${line.south}, (SELECT t.type_key FROM climate_zone_type t
                                                    WHERE t.sort_order < (SELECT sort_order FROM climate_zone_type WHERE type_key = ${line.south})
                                                    ORDER BY t.sort_order DESC LIMIT 1))
            `;
            expect(row, line.south).toEqual({ start: true, end: true });
        }
        // Am Rand liegen keine anderen Punkte als die Enden der Teiler und die Ecken der Karte: Er bleibt gerade.
        const [edge] = await database<{ inner: number; length: number }[]>`
            SELECT count(*) FILTER (WHERE (ST_X(d.geom) IN (0, ${MAP}) OR ST_Y(d.geom) IN (0, ${MAP}))
                                    AND NOT (ST_X(d.geom) IN (0, ${MAP}) AND ST_Y(d.geom) IN (0, ${MAP}))
                                    AND NOT EXISTS (SELECT 1 FROM climate_divider c
                                                    WHERE ST_Equals(ST_StartPoint(c.geom), d.geom) OR ST_Equals(ST_EndPoint(c.geom), d.geom)))::int AS inner,
                   (SELECT sum(ST_Length(ST_Intersection(ST_Boundary(geom), ST_Boundary(ST_MakeEnvelope(0, 0, ${MAP}, ${MAP}, 0)))))
                    FROM climate_band_smooth) AS length
            FROM climate_band_smooth s, LATERAL ST_DumpPoints(s.geom) d
        `;
        expect(edge?.inner).toBe(0);
        expect(edge?.length).toBeCloseTo(4 * MAP, 6);
    });

    it("🔴 die Renderansicht zeigt die geglättete Form, solange sie zum Band passt, sonst das Band", async () => {
        const render = async (): Promise<{ type_key: string; smooth: boolean; raw: boolean }[]> => [
            ...(await database<{ type_key: string; smooth: boolean; raw: boolean }[]>`
                SELECT v.type_key,
                       ST_Equals(v.g, map_domain_to_render('aventuria', s.geom)) AS smooth,
                       ST_Equals(v.g, map_domain_to_render('aventuria', b.geom)) AS raw
                FROM (SELECT type_key, ST_Collect(geom) AS g FROM climate_band_render GROUP BY type_key) v
                JOIN climate_band b ON b.type_key = v.type_key
                JOIN climate_band_smooth s ON s.type_key = v.type_key
                ORDER BY v.type_key
            `),
        ];
        expect((await render()).every((row) => row.smooth && !row.raw)).toBe(true);
        // Ein anderer Fingerabdruck (eine Linie hat sich geändert, die Ableitung ist noch nicht gelaufen): das Band, eckig.
        await database`UPDATE climate_band_smooth SET source_fingerprint = 'veraltet' WHERE type_key = 'boreal'`;
        const stale = await render();
        expect(stale.find((row) => row.type_key === "boreal")).toMatchObject({ smooth: false, raw: true });
        const again = await deriveClimateSmooth(database);
        expect(again.computed).toBe(true);
        expect((await render()).every((row) => row.smooth && !row.raw)).toBe(true);
    });
});

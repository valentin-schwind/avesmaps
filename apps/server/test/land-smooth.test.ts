import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { areaOutlines } from "../src/areas/area-lookup.ts";
import { deriveLandSmooth, landSmoothStale } from "../src/areas/smooth.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Alle Flächen nahtlos geglättet (WI-0055, Migration 0067, Betreiber 2026-10-04: Option A; seit WI-0077, Migration 0072, alle
 * Ebenen in einem Netz, Seen eingeschlossen).
 *
 * 🔴 Gemessen wird gegen die Alternative, die der Betreiber nicht wollte: jede Fläche für sich glätten (Option B,
 * `terrain_water_smooth` je Ring). Sie ist in jedem Fall mitgerechnet, und der Test verlangt, dass sie hier versagt - sonst
 * würde er auch dann bestehen, wenn die Ableitung nichts anderes täte.
 *
 * Eigene Kartendomäne, damit der Test keinen fremden Bestand berührt und niemand seinen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "land-smooth-test";
const SOURCE = "land-smooth-test";

/** Ein Rechteck als WKT. */
const box = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

interface Fixture {
    key: string;
    layer: string;
    type: string;
    wkt: string;
    active?: boolean;
}

/** Eine zackige Grenze von (110,100) nach (110,112), wie Legacy sie zeichnet: Ecken auf einem Raster. */
const SEAM = "110 100,112 103,110 106,113 109,110 112";
/** Dieselbe Grenze an anderen Stellen: Hügelland gegen Wald, See gegen Wald, Küste gegen Meer. */
const SEAM2 = "110 200,112 203,110 206,113 209,110 212";
const SEAM3 = "210 200,212 203,210 206,213 209,210 212";
const SEAM4 = "310 200,312 203,310 206,313 209,310 212";
const reverse = (seam: string): string => seam.split(",").reverse().join(",");

const FIXTURES: Fixture[] = [
    // 1. Naht und Knoten: A und B teilen die zackige Grenze, C liegt über beiden (Knoten bei 110 100, drei Flächen).
    { key: "A", layer: "topographie", type: "gebirge", wkt: `POLYGON((100 100,${SEAM},100 112,100 100))` },
    {
        key: "B",
        layer: "topographie",
        type: "huegelland",
        wkt: `POLYGON((120 100,120 112,110 112,113 109,110 106,112 103,110 100,120 100))`,
    },
    { key: "C", layer: "topographie", type: "hochebene", wkt: box(100, 88, 120, 100) },
    // 2. Verschachtelt: E liegt ganz in D, F teilt ein Stück vom Rand von D.
    { key: "D", layer: "topographie", type: "gebirge", wkt: box(300, 100, 340, 140) },
    { key: "E", layer: "topographie", type: "tal", wkt: box(310, 110, 320, 120) },
    { key: "F", layer: "topographie", type: "hochebene", wkt: box(300, 125, 310, 135) },
    // 3. Echte Überlappung: G und H liegen auf einem Quadrat von 10 mal 10 übereinander.
    { key: "G", layer: "topographie", type: "gebirge", wkt: box(400, 100, 420, 120) },
    { key: "H", layer: "topographie", type: "huegelland", wkt: box(410, 110, 430, 130) },
    // 4. Fast gleiche Grenze: L1 und L2 stoßen bei 510 110 aneinander, R hat eine gerade Westkante 0,0004 daneben und dort keinen Punkt.
    { key: "L1", layer: "topographie", type: "gebirge", wkt: box(500, 100, 510, 110) },
    { key: "L2", layer: "topographie", type: "huegelland", wkt: box(500, 110, 510, 120) },
    { key: "R", layer: "topographie", type: "hochebene", wkt: box(510.0004, 100, 520, 120) },
    // 5. Eine einzelne Insel, 6. eine ungültige Fläche (Schleife).
    {
        key: "M",
        layer: "topographie",
        type: "insel",
        wkt: "POLYGON((600 100,604 100,604 102,602 103,604 104,600 104,600 100))",
    },
    { key: "N", layer: "topographie", type: "tal", wkt: "POLYGON((700 100,710 110,710 100,700 110,700 100))" },
    // 7. Seit WI-0077 Mitglieder: ein Wald, ein See für sich; kein Mitglied ist nur die stillgelegte Fläche.
    { key: "W", layer: "vegetation", type: "wald", wkt: box(800, 100, 810, 110) },
    { key: "S", layer: "topographie", type: "see", wkt: box(820, 100, 830, 110) },
    { key: "T", layer: "topographie", type: "tal", wkt: box(840, 100, 850, 110), active: false },
    // 8. Über Ebenen (WI-0077): Hügelland und Wald teilen eine zackige Grenze, eine derographische Region liegt um beide.
    { key: "HL", layer: "topographie", type: "huegelland", wkt: `POLYGON((100 200,${SEAM2},100 212,100 200))` },
    { key: "WK", layer: "vegetation", type: "wald", wkt: `POLYGON((120 200,120 212,${reverse(SEAM2)},120 200))` },
    { key: "DR", layer: "derographisch", type: "region", wkt: box(95, 195, 125, 217) },
    // 9. Ein See, an dessen Ufer ein Wald grenzt, und 10. eine Küste am Meer (Küsten sind normale Flächen).
    { key: "SE", layer: "topographie", type: "see", wkt: `POLYGON((200 200,${SEAM3},200 212,200 200))` },
    { key: "WS", layer: "vegetation", type: "wald", wkt: `POLYGON((220 200,220 212,${reverse(SEAM3)},220 200))` },
    { key: "KU", layer: "topographie", type: "kueste", wkt: `POLYGON((300 200,${SEAM4},300 212,300 200))` },
    { key: "ME", layer: "topographie", type: "meer", wkt: `POLYGON((320 200,320 212,${reverse(SEAM4)},320 200))` },
    // 11. Ein Meer in der Nordwestecke der Karte (der Rand der Kartendomäne ist 0 … 1024), 0,062 E vor dem Rand wie in Legacy.
    {
        key: "MR",
        layer: "topographie",
        type: "meer",
        wkt: "POLYGON((0.062 1000,20 1000,20 1024,0.062 1024,0.062 1000))",
    },
];

/** Die Mitglieder des Netzes: alle aktiven Flächen. */
const MEMBERS = FIXTURES.filter((fixture) => fixture.active !== false).map((fixture) => fixture.key);

/** Die Paare, die eine zackige Grenze teilen: [links, rechts, Grenze]. */
const SEAMS: [string, string, string][] = [
    ["A", "B", SEAM],
    ["HL", "WK", SEAM2],
    ["SE", "WS", SEAM3],
    ["KU", "ME", SEAM4],
];

describeWithDatabase("Alle Flächen, nahtlos geglättet (Migrationen 0067 und 0072)", () => {
    let database: Database;
    const ids = new Map<string, { areaId: number; publicId: string; regionPublicId: string }>();

    const shapeOf = async (key: string): Promise<string> => {
        const [row] = await database<{ g: string }[]>`
            SELECT ST_AsEWKT(geom) AS g FROM region_area_smooth WHERE region_area_id = ${ids.get(key)?.areaId ?? 0}
        `;
        return row?.g ?? "";
    };
    /** Eine Zahl aus SQL über die Formen der Schlüssel, `s(k)` ist die geglättete Form, `a(k)` die Ausgangsform. */
    const num = async (expression: string): Promise<number> => {
        const names = [...ids.keys()];
        const joins = names
            .map(
                (key) =>
                    `LEFT JOIN region_area_smooth s_${key} ON s_${key}.region_area_id = ${String(ids.get(key)?.areaId)}
                     LEFT JOIN region_area a_${key} ON a_${key}.id = ${String(ids.get(key)?.areaId)}`,
            )
            .join("\n");
        const resolved = expression.replace(
            /\b([sa])\((\w+)\)/g,
            (_all, kind: string, key: string) => `${kind}_${key}.geom`,
        );
        const [row] = await database.unsafe<{ v: number }[]>(
            `SELECT (${resolved})::float8 AS v FROM (SELECT 1) one ${joins}`,
        );
        return Number(row?.v);
    };

    async function cleanup(): Promise<void> {
        await database`DELETE FROM region_area WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM region WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM map_domain WHERE id = ${DOMAIN}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanup();
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: DOMAIN })})).*
            FROM map_domain m WHERE m.id = 'aventuria'
        `;
        for (const fixture of FIXTURES) {
            const [region] = await database<{ id: string; public_id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, source_system)
                VALUES (gen_random_uuid(), ${DOMAIN}, ${`Fläche ${fixture.key}`}, ${fixture.layer}, ${fixture.type}, ${fixture.active ?? true}, ${SOURCE})
                RETURNING id::text, public_id::text
            `;
            const [area] = await database<{ id: string; public_id: string }[]>`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active, source_system)
                VALUES (gen_random_uuid(), ${DOMAIN}, ${Number(region?.id)}, ST_GeomFromText(${fixture.wkt}, 0), ${fixture.active ?? true}, ${SOURCE})
                RETURNING id::text, public_id::text
            `;
            ids.set(fixture.key, {
                areaId: Number(area?.id),
                publicId: area?.public_id ?? "",
                regionPublicId: region?.public_id ?? "",
            });
        }
    });

    afterAll(async () => {
        await cleanup();
        await database.end({ timeout: 5 });
    });

    it("🔴 rechnet beim ersten Mal das ganze Netz und beim zweiten nichts mehr", async () => {
        expect(await landSmoothStale(database, DOMAIN)).toBe(true);
        const first = await deriveLandSmooth(database, { mapDomainId: DOMAIN });
        expect(first.computed).toBe(true);
        expect(first.mode).toBe("voll");
        expect(first.areas).toBe(MEMBERS.length);
        expect(first.written).toBe(MEMBERS.length);
        expect(first.smoothed + Object.values(first.fallbacks).reduce((a, b) => a + b, 0)).toBe(MEMBERS.length);
        // Gemeinsame Ketten über Ebenen: Hügelland gegen Wald, See gegen Wald (Küste und Meer liegen in einer Ebene).
        expect(first.crossLayerEdges).toBeGreaterThanOrEqual(2);
        // Die Klimabänder gehören nur zur Kartendomäne `aventuria`.
        expect(first.climate).toBeUndefined();
        expect(await landSmoothStale(database, DOMAIN)).toBe(false);
        const second = await deriveLandSmooth(database, { mapDomainId: DOMAIN });
        expect(second.computed).toBe(false);
        expect(second.mode).toBe("keine");
        expect(second.areas).toBe(MEMBERS.length);
    });

    it("🔴 schreibt nur die Ableitung: die Flächen der Karte bleiben, wie sie sind (Map Mutation Guard)", async () => {
        const stamp = async (): Promise<string> => {
            const [row] = await database<{ h: string }[]>`
                SELECT md5(string_agg(ST_AsEWKB(geom)::text || updated_at::text || is_active::text, ',' ORDER BY id)) AS h
                FROM region_area WHERE map_domain_id = ${DOMAIN}
            `;
            return row?.h ?? "";
        };
        const before = await stamp();
        await deriveLandSmooth(database, { mapDomainId: DOMAIN, force: true });
        expect(await stamp()).toBe(before);
    });

    it("🔴 Mitglieder sind alle aktiven Flächen aller Ebenen, Seen und Meere eingeschlossen; nur die stillgelegte fehlt", async () => {
        const rows = await database<{ key: string }[]>`
            SELECT regexp_replace(r.name, '^Fläche ', '') AS key
            FROM region_area_smooth s JOIN region_area a ON a.id = s.region_area_id JOIN region r ON r.id = a.region_id
            WHERE a.map_domain_id = ${DOMAIN} ORDER BY 1
        `;
        expect(rows.map((row) => row.key).sort()).toEqual([...MEMBERS].sort());
    });

    it.each(SEAMS)(
        "🔴 %s und %s: die gemeinsame Grenze liegt in beiden als dieselbe Linie, über Ebenen hinweg (kein Spalt, keine Überlappung)",
        async (left, right, seam) => {
            expect(await num(`ST_Area(ST_Intersection(s(${left}), s(${right})))`)).toBeLessThan(1e-9);
            const expected = await num(
                `ST_Length(ST_ChaikinSmoothing(ST_GeomFromText('LINESTRING(${seam})', 0), 3, true))`,
            );
            const shared = await num(`ST_Length(ST_Intersection(ST_Boundary(s(${left})), ST_Boundary(s(${right}))))`);
            expect(Math.abs(shared - expected) / expected).toBeLessThan(0.005);
            // Kein Zwickel: Beide zusammen sind die Summe ihrer Flächen und haben kein Loch.
            expect(
                await num(`ST_Area(ST_Union(s(${left}), s(${right}))) - ST_Area(s(${left})) - ST_Area(s(${right}))`),
            ).toBeCloseTo(0, 6);
            expect(await num(`ST_NumInteriorRings(ST_GeometryN(ST_Union(s(${left}), s(${right})), 1))`)).toBe(0);
        },
    );

    it("🔴 der Kartenrand bleibt gerade: das Meer in der Ecke der Karte behält Ecke und Randkanten", async () => {
        for (const corner of ["0.062 1024", "20 1024", "0.062 1000"]) {
            expect(
                await num(`ST_Distance(ST_Boundary(s(MR)), ST_GeomFromText('POINT(${corner})', 0))`),
                corner,
            ).toBeLessThan(1e-9);
        }
        // Nur die eine Ecke im Inneren rundet sich: Was fehlt, liegt dort, weit weg vom Rand.
        expect(await num("ST_Area(a(MR)) - ST_Area(s(MR))")).toBeGreaterThan(0.5);
        expect(
            await num("ST_Area(ST_Intersection(ST_Difference(a(MR), s(MR)), ST_MakeEnvelope(0, 1010, 10, 1024, 0)))"),
        ).toBeLessThan(1e-9);
    });

    it("🔴 eine Fläche, die nur darüber liegt (Region um Hügelland und Wald), rundet sich für sich und deckt beide", async () => {
        expect(await num("ST_HausdorffDistance(s(DR), terrain_water_smooth(a(DR)))")).toBeLessThan(0.0041);
        expect(await num("ST_Area(ST_Difference(ST_Union(s(HL), s(WK)), s(DR)))")).toBeLessThan(1e-9);
    });

    it("🔴 eine gemeinsame Kante liegt nach dem Glätten identisch in beiden Nachbarn: kein Spalt, keine Überlappung", async () => {
        expect(await num("ST_Area(ST_Intersection(s(A), s(B)))")).toBeLessThan(1e-9);
        // Die gemeinsame Kante ist die einmal geglättete Zackenlinie, Endpunkte fest, auf die Auflösung der Karte vereinfacht:
        // Beide tragen dieselbe Linie, ihre Länge ist die der Rundung bis auf die Vereinfachung (0,004 E).
        const expected = await num(
            `ST_Length(ST_ChaikinSmoothing(ST_GeomFromText('LINESTRING(${SEAM})', 0), 3, true))`,
        );
        const shared = await num("ST_Length(ST_Intersection(ST_Boundary(s(A)), ST_Boundary(s(B))))");
        expect(Math.abs(shared - expected) / expected).toBeLessThan(0.005);
        // Genau dieselbe Linie: Jeder Punkt der Kante von A liegt auf der von B und umgekehrt.
        expect(
            await num(
                "ST_HausdorffDistance(ST_Intersection(ST_Boundary(s(A)), ST_Boundary(s(B))), ST_Intersection(ST_Boundary(s(B)), ST_Boundary(s(A))))",
            ),
        ).toBeLessThan(1e-9);
        // Beide zusammen sind die Summe ihrer Flächen und haben keinen Zwickel: die Vereinigung hat kein Loch.
        expect(await num("ST_Area(ST_Union(s(A), s(B))) - ST_Area(s(A)) - ST_Area(s(B))")).toBeCloseTo(0, 6);
        expect(await num("ST_NumInteriorRings(ST_GeometryN(ST_Union(s(A), s(B)), 1))")).toBe(0);
        // Am Knoten (110 100) fehlt nach dem Glätten nichts von dem, was A und B vorher bedeckten: Die obere Kante von
        // A und B ist gerade und bleibt es, und die Naht beginnt genau im Knoten.
        const window = "ST_MakeEnvelope(105, 100, 115, 104, 0)";
        const loss = await num(
            `ST_Area(ST_Intersection(${window}, ST_Union(a(A), a(B)))) - ST_Area(ST_Intersection(${window}, ST_Union(s(A), s(B))))`,
        );
        expect(Math.abs(loss)).toBeLessThan(1e-6);
        // Die Gegenprobe: jede Fläche für sich geglättet (Option B) schneidet an diesem Knoten die Ecke ab, und es bleibt ein Keil offen.
        const single = await num(
            `ST_Area(ST_Intersection(${window}, ST_Union(a(A), a(B)))) - ST_Area(ST_Intersection(${window}, ST_Union(terrain_water_smooth(a(A)), terrain_water_smooth(a(B)))))`,
        );
        expect(single).toBeGreaterThan(0.05);
    });

    it("🔴 ein Knoten, an dem drei Flächen zusammenstoßen, bleibt fest", async () => {
        for (const key of ["A", "B", "C"]) {
            expect(
                await num(`ST_Distance(ST_Boundary(s(${key})), ST_GeomFromText('POINT(110 100)', 0))`),
                `Fläche ${key}`,
            ).toBeLessThan(1e-9);
        }
        // Ein Knoten bleibt ein Eckpunkt der Kante, nicht nur ein Punkt in der Nähe.
        const vertices = await database<{ n: string }[]>`
            SELECT count(*)::text AS n FROM region_area_smooth s, LATERAL ST_DumpPoints(s.geom) d
            WHERE s.region_area_id = ${ids.get("A")?.areaId ?? 0} AND ST_Equals(d.geom, ST_GeomFromText('POINT(110 100)', 0))
        `;
        expect(Number(vertices[0]?.n)).toBeGreaterThanOrEqual(1);
    });

    it("🔴 verschachtelte Flächen gehen nicht verloren und ragen nicht heraus", async () => {
        const nested = ["D", "E", "F"].map((key) => ids.get(key)?.areaId ?? 0);
        const rows = await database<{ status: string }[]>`
            SELECT status FROM region_area_smooth WHERE region_area_id = ANY(${nested}::bigint[])
        `;
        expect(rows.map((row) => row.status)).toEqual(["smoothed", "smoothed", "smoothed"]);
        // Das Tal liegt im Gebirge, auch geglättet; das Hochland teilt ein Stück vom Rand des Gebirges und ragt nicht heraus.
        expect(await num("ST_Area(ST_Difference(s(E), s(D)))")).toBeLessThan(1e-9);
        expect(await num("ST_Area(ST_Difference(s(F), s(D)))")).toBeLessThan(1e-9);
        // Jede Fläche behält ihre eigene Form, keine wird einer anderen zugeschlagen: Das Tal im Gebirge rundet sich wie eine
        // einzelne Fläche, und das Gebirge verliert durch das Tal nichts.
        expect(await num("ST_HausdorffDistance(s(E), terrain_water_smooth(a(E)))")).toBeLessThan(0.0041);
        expect(await num("ST_Area(s(D)) / ST_Area(terrain_water_smooth(a(D)))")).toBeGreaterThan(0.99);
    });

    it("🔴 echte Überlappungen bleiben Überlappungen: keine Fläche wird der anderen zugeteilt", async () => {
        // Seit WI-0077 teilen Flächen nur, was sie gemeinsam tragen: Zwei Ränder, die sich nur kreuzen, bekommen dort keinen
        // festen Punkt, jede rundet sich wie für sich allein, und nichts wird an der anderen abgeschnitten.
        for (const key of ["G", "H"]) {
            expect(
                await num(`ST_HausdorffDistance(s(${key}), terrain_water_smooth(a(${key})))`),
                `Fläche ${key}`,
            ).toBeLessThan(0.0041);
        }
        // Das Quadrat von 100 E² liegt in beiden, bis auf das, was die Rundung der zwei Ecken darin kostet: so viel wie bei zwei
        // einzeln gerundeten Flächen.
        const overlap = await num("ST_Area(ST_Intersection(s(G), s(H)))");
        const single = await num("ST_Area(ST_Intersection(terrain_water_smooth(a(G)), terrain_water_smooth(a(H))))");
        expect(overlap).toBeGreaterThan(60);
        expect(Math.abs(overlap - single) / single).toBeLessThan(0.01);
    });

    it("🔴 fast gleiche Grenzen mit verschiedenen Punkten werden zusammengeführt: kein Zwickel an der Naht", async () => {
        // Von 510 bis 510,0004 war vorher ein Streifen, den keine Fläche trug (0,004 E²). Mitte der Naht, fern der Enden:
        // alles dort liegt in einer der drei Flächen.
        const inWindow = "ST_MakeEnvelope(509.5, 104, 510.5, 116, 0)";
        const uncovered = await num(`ST_Area(ST_Difference(${inWindow}, ST_Union(ARRAY[s(L1), s(L2), s(R)])))`);
        expect(uncovered).toBeLessThan(1e-6);
        // Und sie überlappen sich nirgends.
        expect(await num("ST_Area(ST_Intersection(s(L1), s(R))) + ST_Area(ST_Intersection(s(L2), s(R)))")).toBeLessThan(
            1e-9,
        );
        // Die Gegenprobe: einzeln geglättet bleibt dort ein Keil offen (R hat an der Ecke von L1 und L2 keinen Punkt).
        const single = await num(
            `ST_Area(ST_Difference(${inWindow}, ST_Union(ARRAY[terrain_water_smooth(a(L1)), terrain_water_smooth(a(L2)), terrain_water_smooth(a(R))])))`,
        );
        expect(single).toBeGreaterThan(0.01);
    });

    it("🔴 eine einzelne Insel rundet sich wie ein Gewässer (Chaikin, drei Durchgänge), bis auf die Auflösung der Karte", async () => {
        // Ohne die Vereinfachung auf einen halben Bildpunkt der größten Zoomstufe (0,004 E) wäre es dieselbe Linie.
        expect(await num("ST_HausdorffDistance(s(M), terrain_water_smooth(a(M)))")).toBeLessThan(0.0041);
        expect(await num("ST_NPoints(s(M)) / ST_NPoints(terrain_water_smooth(a(M)))")).toBeLessThanOrEqual(1);
    });

    it("🔴 eine ungültige Fläche bricht nichts ab und bekommt eine gültige Form", async () => {
        const [row] = await database<{ valid: boolean; status: string }[]>`
            SELECT ST_IsValid(geom) AS valid, status FROM region_area_smooth WHERE region_area_id = ${ids.get("N")?.areaId ?? 0}
        `;
        expect(row?.valid).toBe(true);
        expect(row?.status).toMatch(/^(smoothed|fallback_)/);
        // Die Fläche der Karte ist weiter ungültig: gelesen wird nur, geschrieben nichts.
        expect(await num("ST_IsValid(a(N))::int")).toBe(0);
    });

    it("🔴 dieselben Eingaben, dieselbe Form (auch erzwungen)", async () => {
        const before = new Map<string, string>();
        for (const key of ids.keys()) before.set(key, await shapeOf(key));
        await deriveLandSmooth(database, { mapDomainId: DOMAIN, force: true });
        for (const key of ids.keys()) {
            const now = await shapeOf(key);
            if (before.get(key) === "") continue;
            const [row] = await database<{ same: boolean }[]>`
                SELECT ST_Equals(ST_GeomFromEWKT(${now}), ST_GeomFromEWKT(${before.get(key) ?? ""})) AS same
            `;
            expect(row?.same, `Fläche ${key}`).toBe(true);
        }
    });

    describe("Renderansicht region_area_render", () => {
        const render = async (key: string): Promise<{ equalsSmooth: boolean; equalsRaw: boolean }> => {
            const [row] = await database<{ s: boolean | null; r: boolean }[]>`
                SELECT ST_OrderingEquals(v.geom, map_domain_to_render(${DOMAIN}, s.geom)) AS s,
                       ST_OrderingEquals(v.geom, map_domain_to_render(${DOMAIN}, a.geom)) AS r
                FROM region_area_render v
                JOIN region_area a ON a.public_id = v.public_id
                LEFT JOIN region_area_smooth s ON s.region_area_id = a.id
                WHERE v.public_id = ${ids.get(key)?.publicId ?? ""}
            `;
            return { equalsSmooth: row?.s === true, equalsRaw: row?.r === true };
        };

        it("🔴 zeigt für jede Fläche jeder Ebene die abgeleitete Form, genau einmal, die stillgelegte gar nicht", async () => {
            for (const key of MEMBERS)
                expect(await render(key), `Fläche ${key}`).toEqual({ equalsSmooth: true, equalsRaw: false });
            const [row] = await database<{ n: number; members: number }[]>`
                SELECT count(*)::int AS n, count(DISTINCT v.public_id)::int AS members
                FROM region_area_render v JOIN region_area a ON a.public_id = v.public_id WHERE a.map_domain_id = ${DOMAIN}
            `;
            // Eine Zeile je aktiver Fläche: dieselbe Form in jedem Filter der Karte (Topographie, Vegetation, Derographisch, Alle).
            expect(row).toEqual({ n: MEMBERS.length, members: MEMBERS.length });
        });

        it("🔴 das Wasser hat dasselbe Ufer wie die Fläche daneben: `terrain_water_render` zeigt die Form aus dem Netz", async () => {
            const rows = await database<{ key: string; same: boolean }[]>`
                SELECT regexp_replace(w.name, '^Fläche ', '') AS key, ST_Equals(w.geom, v.geom) AS same
                FROM terrain_water_render w
                JOIN region_area_render v ON v.public_id = w.public_id
                JOIN region_area a ON a.public_id = w.public_id
                WHERE a.map_domain_id = ${DOMAIN} ORDER BY 1
            `;
            expect(rows).toEqual([
                { key: "ME", same: true },
                { key: "MR", same: true },
                { key: "S", same: true },
                { key: "SE", same: true },
            ]);
        });

        it("🔴 die Spalten der Sicht bleiben, wie sie waren (Fläche in E² ist die der Ausgangsform)", async () => {
            const [row] = await database<{ area: number; raw: number }[]>`
                SELECT v.area, round(ST_Area(a.geom)::numeric, 2)::float8 AS raw
                FROM region_area_render v JOIN region_area a ON a.public_id = v.public_id WHERE v.public_id = ${ids.get("A")?.publicId ?? ""}
            `;
            expect(row?.area).toBe(row?.raw);
        });

        it("🔴 eine seither geänderte Fläche steht eckig, bis die Ableitung neu gelaufen ist; die übrigen bleiben geglättet", async () => {
            await database`UPDATE region_area SET updated_at = updated_at + interval '1 second' WHERE id = ${ids.get("G")?.areaId ?? 0}`;
            expect(await landSmoothStale(database, DOMAIN)).toBe(true);
            expect(await render("G")).toEqual({ equalsSmooth: false, equalsRaw: true });
            expect(await render("H")).toEqual({ equalsSmooth: true, equalsRaw: false });
            const report = await deriveLandSmooth(database, { mapDomainId: DOMAIN });
            expect(report.computed).toBe(true);
            expect(await landSmoothStale(database, DOMAIN)).toBe(false);
            expect(await render("G")).toEqual({ equalsSmooth: true, equalsRaw: false });
        });
    });

    describe("Umrisse vom Server (Höhenstufen)", () => {
        it("🔴 mit `smooth` die nahtlos geglättete Form der Landfläche, ohne die Ausgangsform", async () => {
            const publicId = ids.get("A")?.regionPublicId ?? "";
            const smooth = await areaOutlines(database, [publicId], 12, true, DOMAIN);
            const raw = await areaOutlines(database, [publicId], 12, false, DOMAIN);
            expect(smooth.features).toHaveLength(1);
            const points = (outline: typeof smooth): number =>
                JSON.stringify(outline.features[0]?.geometry.coordinates).split("],[").length;
            // Die geglättete Zackenlinie trägt viele Punkte mehr als die Ausgangsform.
            expect(points(smooth)).toBeGreaterThan(points(raw) * 2);
            const [reference] = await database<{ n: string }[]>`
                SELECT ST_NPoints(geom)::text AS n FROM region_area_smooth WHERE region_area_id = ${ids.get("A")?.areaId ?? 0}
            `;
            expect(points(smooth)).toBeLessThanOrEqual(Number(reference?.n));
        });

        it("🔴 seit WI-0077 auch Wald und See: der Umriss mit `smooth` ist die Form aus dem Netz", async () => {
            for (const key of ["WK", "SE"]) {
                const publicId = ids.get(key)?.regionPublicId ?? "";
                const smooth = await areaOutlines(database, [publicId], 12, true, DOMAIN);
                const raw = await areaOutlines(database, [publicId], 12, false, DOMAIN);
                const points = (outline: typeof smooth): number =>
                    JSON.stringify(outline.features[0]?.geometry.coordinates).split("],[").length;
                expect(points(smooth), `Fläche ${key}`).toBeGreaterThan(points(raw) * 2);
                const [row] = await database<{ d: number }[]>`
                    SELECT ST_HausdorffDistance(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(smooth.features[0]?.geometry)}), 0), s.geom) AS d
                    FROM region_area_smooth s WHERE s.region_area_id = ${ids.get(key)?.areaId ?? 0}
                `;
                // Vereinfacht auf einen halben Bildpunkt bei Zoom 12 und auf vier Stellen gerundet: dieselbe Form.
                expect(row?.d, `Fläche ${key}`).toBeLessThan(0.001);
            }
        });
    });

    describe("🔴 eine Änderung rechnet nur die Fläche und ihre Nachbarn (WI-0077, Editor)", () => {
        /** Je Fläche des Testbestands die Bytes ihrer geglätteten Form (Kartenraum und Renderkoordinaten). */
        const fingerprint = async (): Promise<Record<string, string>> => {
            const rows = await database<{ key: string; h: string }[]>`
                SELECT regexp_replace(r.name, '^Fläche ', '') AS key, md5(ST_AsEWKB(s.geom)::text || ST_AsEWKB(s.render_geom)::text) AS h
                FROM region_area_smooth s JOIN region_area a ON a.id = s.region_area_id JOIN region r ON r.id = a.region_id
                WHERE a.map_domain_id = ${DOMAIN}
            `;
            return Object.fromEntries(rows.map((row) => [row.key, row.h]));
        };
        const changedKeys = (before: Record<string, string>, after: Record<string, string>): string[] =>
            [...new Set([...Object.keys(before), ...Object.keys(after)])]
                .filter((key) => before[key] !== after[key])
                .sort();

        it("🔴 eine geänderte Fläche: nur sie und ihr Nachbar werden geschrieben, und das Ergebnis ist das des vollen Laufs", async () => {
            const before = await fingerprint();
            // Der Testbestand (eigene Kartendomäne) bekommt eine geänderte Ecke, wie ein Editor sie setzen würde.
            await database`
                UPDATE region_area SET geom = ST_GeomFromText(${`POLYGON((100 200,${SEAM2},99 213,100 200))`}, 0), updated_at = now()
                WHERE id = ${ids.get("HL")?.areaId ?? 0}
            `;
            const report = await deriveLandSmooth(database, { mapDomainId: DOMAIN });
            expect(report.mode).toBe("lokal");
            // Das Hügelland und der Wald, der eine Kante mit ihm teilt; die Region darum liegt weiter als 0,01 E entfernt.
            expect(report.written).toBe(2);
            expect(report.computedAreas).toBe(2);
            const local = await fingerprint();
            expect(changedKeys(before, local)).toEqual(["HL"]);
            // Der volle Lauf ergibt Byte für Byte dasselbe.
            const full = await deriveLandSmooth(database, { mapDomainId: DOMAIN, force: true });
            expect(full.mode).toBe("voll");
            expect(await fingerprint()).toEqual(local);
        });

        it("🔴 ausdrücklich eine Fläche (`--areas`): sie und ihre Nachbarn, auch ohne Änderung, Ergebnis unverändert", async () => {
            const before = await fingerprint();
            const report = await deriveLandSmooth(database, {
                mapDomainId: DOMAIN,
                areaIds: [ids.get("SE")?.areaId ?? 0],
            });
            expect(report.mode).toBe("lokal");
            expect(report.written).toBe(2);
            expect(await fingerprint()).toEqual(before);
        });

        it("🔴 eine stillgelegte Fläche: ihre Zeile fällt weg, ihr früherer Nachbar rundet die freie Kante für sich", async () => {
            const wald = ids.get("WK")?.areaId ?? 0;
            await database`UPDATE region_area SET is_active = false, updated_at = now() WHERE id = ${wald}`;
            try {
                const report = await deriveLandSmooth(database, { mapDomainId: DOMAIN });
                expect(report.mode).toBe("lokal");
                expect(report.written).toBe(1);
                const [row] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM region_area_smooth WHERE region_area_id = ${wald}
                `;
                expect(row?.n).toBe(0);
                expect(await num("ST_HausdorffDistance(s(HL), terrain_water_smooth(a(HL)))")).toBeLessThan(0.0041);
            } finally {
                await database`UPDATE region_area SET is_active = true, updated_at = now() WHERE id = ${wald}`;
                await deriveLandSmooth(database, { mapDomainId: DOMAIN });
            }
            expect(await landSmoothStale(database, DOMAIN)).toBe(false);
        });
    });
});

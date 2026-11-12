import { describe, expect, it } from "vitest";
import { chaikin, simplify, smoothNet, type NetArea } from "@avesmaps3d/shared";
import { readSurfaceWkb, writeMultiPolygonWkb } from "../src/areas/wkb.ts";

/**
 * Das gemeinsame Kantennetz in TypeScript (WI-0077), ohne Datenbank. Die Fälle mit PostGIS (gültige Formen, Renderansichten,
 * Quelle unverändert, echte Daten) stehen in `land-smooth.test.ts`.
 */

const OPTIONS = { tolerance: 0.001, passes: 3, resolution: 0.004 };

/** Ein Ring aus Punkten, geschlossen. */
function ring(points: [number, number][]): Float64Array {
    const closed = [...points, points[0] as [number, number]];
    return Float64Array.from(closed.flat());
}

function area(id: number, layer: string, points: [number, number][], holes: [number, number][][] = []): NetArea {
    return { id, layer, polygons: [[ring(points), ...holes.map((hole) => ring(hole))]] };
}

/** Die Punkte eines Rings als Menge „x y“ (ohne Schlusspunkt). */
function pointSet(coords: Float64Array): Set<string> {
    const out = new Set<string>();
    for (let q = 0; q + 2 < coords.length; q += 2) out.add(`${String(coords[q])} ${String(coords[q + 1])}`);
    return out;
}

function shellOf(result: ReturnType<typeof smoothNet>, id: number): Float64Array {
    const shape = result.shapes.get(id);
    if (!shape) throw new Error(`keine Form für ${String(id)}`);
    return shape[0]?.[0] as Float64Array;
}

/** Ein Ring in fester Form: Anfang am kleinsten Punkt, gegen den Uhrzeigersinn; zum Vergleich unabhängig vom Anfangspunkt. */
function normalizeRing(coords: Float64Array): string {
    const n = coords.length / 2 - 1;
    const points: [number, number][] = [];
    for (let q = 0; q < n; q += 1) points.push([coords[2 * q] as number, coords[2 * q + 1] as number]);
    let area2 = 0;
    for (let q = 0; q < n; q += 1) {
        const [ax, ay] = points[q] as [number, number];
        const [bx, by] = points[(q + 1) % n] as [number, number];
        area2 += ax * by - bx * ay;
    }
    const ordered = area2 < 0 ? [...points].reverse() : points;
    let min = 0;
    for (let q = 1; q < n; q += 1) {
        const [x, y] = ordered[q] as [number, number];
        const [mx, my] = ordered[min] as [number, number];
        if (x < mx || (x === mx && y < my)) min = q;
    }
    return [...ordered.slice(min), ...ordered.slice(0, min)].map(([x, y]) => `${String(x)} ${String(y)}`).join(",");
}

/** Eine zackige Grenze von (10,0) nach (10,12), wie Legacy sie zeichnet. */
const SEAM: [number, number][] = [
    [10, 0],
    [12, 3],
    [10, 6],
    [13, 9],
    [10, 12],
];

const A = area(1, "topographie", [[0, 0], ...SEAM, [0, 12]]);
const B = area(2, "vegetation", [[20, 0], [20, 12], ...[...SEAM].reverse()]);

describe("Chaikin und Douglas-Peucker wie PostGIS", () => {
    it("ein Durchgang mit festen Enden setzt je Stück die Viertelpunkte, das erste und letzte Stück nur einen", () => {
        const line = Float64Array.from([0, 0, 4, 0, 4, 4]);
        expect([...chaikin(line, 1, true)]).toEqual([0, 0, 3, 0, 4, 1, 4, 4]);
    });

    it("ein Ring rundet jede Ecke und schließt auf seinem neuen Anfang", () => {
        const square = ring([
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
        ]);
        const out = chaikin(square, 1, false);
        expect(out.length / 2).toBe(9);
        expect([out[0], out[1]]).toEqual([1, 0]);
        expect([out[out.length - 2], out[out.length - 1]]).toEqual([1, 0]);
    });

    it("die Vereinfachung behält die Enden und alles, was weiter als die Toleranz absteht", () => {
        const line = Float64Array.from([0, 0, 1, 0.001, 2, 0, 3, 1, 4, 0]);
        expect([...simplify(line, 0.004, 2)]).toEqual([0, 0, 2, 0, 3, 1, 4, 0]);
    });
});

describe("WKB hin und zurück", () => {
    it("liest, was es schreibt, Bit für Bit", () => {
        const polygons = [
            [
                ring([
                    [0.1, 0.2],
                    [1e-12, 3],
                    [1023.999999, 1.5],
                ]),
            ],
        ];
        const back = readSurfaceWkb(writeMultiPolygonWkb(polygons));
        expect(back.map((rings) => rings.map((r) => [...r]))).toEqual(
            polygons.map((rings) => rings.map((r) => [...r])),
        );
    });
});

describe("das gemeinsame Kantennetz", () => {
    it("🔴 eine gemeinsame Kante liegt in beiden Flächen als dieselbe Linie, auch über Ebenen (Wald gegen Hügelland)", () => {
        const result = smoothNet([A, B], OPTIONS);
        const a = pointSet(shellOf(result, 1));
        const b = pointSet(shellOf(result, 2));
        const common = [...a].filter((point) => b.has(point));
        // Die geglättete Naht: Chaikin dreimal mit festen Enden über die fünf Punkte trägt 26 Punkte, vereinfacht weniger.
        expect(common.length).toBeGreaterThan(8);
        // Beide Enden der Naht sind feste Punkte, denn dort wechseln die Eigentümer.
        expect(a.has("10 0") && b.has("10 0") && a.has("10 12") && b.has("10 12")).toBe(true);
        expect(result.stats.sharedChains).toBe(1);
        expect(result.stats.crossLayerChains).toBe(1);
    });

    it("🔴 eine Fläche, die eine andere nur kreuzt, ändert deren Form nicht (kein fester Punkt an der Kreuzung)", () => {
        const crossing = area(3, "derographisch", [
            [5, -5],
            [30, -5],
            [30, 5],
            [5, 5],
        ]);
        const alone = smoothNet([A, B], OPTIONS);
        const withCrossing = smoothNet([A, B, crossing], OPTIONS);
        expect([...shellOf(withCrossing, 1)]).toEqual([...shellOf(alone, 1)]);
        expect([...shellOf(withCrossing, 2)]).toEqual([...shellOf(alone, 2)]);
    });

    it("🔴 eine Fläche ohne Nachbarn rundet sich wie ein Gewässer (Chaikin am geschlossenen Ring), bis auf die Vereinfachung", () => {
        const island: [number, number][] = [
            [100, 100],
            [104, 100],
            [104, 102],
            [102, 103],
            [104, 104],
            [100, 104],
        ];
        const result = smoothNet([area(7, "topographie", island)], OPTIONS);
        const expected = simplify(chaikin(ring(island), 3, false), 0.004, 4);
        expect(normalizeRing(shellOf(result, 7))).toBe(normalizeRing(expected));
    });

    it("🔴 fast gleiche Punkte (0,0004 auseinander) werden einer, ein Punkt neben einem Randstück wird dort eingefügt", () => {
        const left1 = area(11, "topographie", [
            [500, 100],
            [510, 100],
            [510, 110],
            [500, 110],
        ]);
        const left2 = area(12, "topographie", [
            [500, 110],
            [510, 110],
            [510, 120],
            [500, 120],
        ]);
        const right = area(13, "vegetation", [
            [510.0004, 100],
            [520, 100],
            [520, 120],
            [510.0004, 120],
        ]);
        const result = smoothNet([left1, left2, right], OPTIONS);
        expect(result.stats.mergedPoints).toBe(2);
        expect(result.stats.insertedPoints).toBe(1);
        const r = pointSet(shellOf(result, 13));
        // Der Knoten bei (510, 110), an dem L1 und L2 aneinanderstoßen, liegt jetzt auch im Rand von R.
        expect(r.has("510 110")).toBe(true);
        // Die gemeinsame Kante ist gerade und bleibt es: beide Enden liegen in L1 (L2) und in R, als dieselben Punkte.
        const l1 = pointSet(shellOf(result, 11));
        const l2 = pointSet(shellOf(result, 12));
        expect(["510 100", "510 110"].every((point) => l1.has(point) && r.has(point))).toBe(true);
        expect(["510 110", "510 120"].every((point) => l2.has(point) && r.has(point))).toBe(true);
    });

    it("🔴 lokal gleich global: eine Fläche und ihre Nachbarn, mit den Nachbarn der Nachbarn gerechnet, ergeben dasselbe", () => {
        // Ein Feld aus 7 × 7 Flächen mit krummen Grenzen, dazu ein Wald quer darüber, der sie nur kreuzt.
        const zig = (a: number, b: number): number => ((a * 7 + b * 13) % 5) * 0.1;
        const corner = (i: number, j: number): [number, number] => [i * 10 + zig(i, j), j * 10 + zig(j, i)];
        const middle = (i: number, j: number): [number, number] => [i * 10 + 5, j * 10 + zig(i, j) * 2];
        const id = (i: number, j: number): number => 100 + i * 7 + j;
        const areas: NetArea[] = [];
        for (let i = 0; i < 7; i += 1) {
            for (let j = 0; j < 7; j += 1) {
                areas.push(
                    area(id(i, j), "topographie", [
                        corner(i, j),
                        middle(i, j),
                        corner(i + 1, j),
                        corner(i + 1, j + 1),
                        middle(i, j + 1),
                        corner(i, j + 1),
                    ]),
                );
            }
        }
        areas.push(
            area(300, "vegetation", [
                [3, 33],
                [67, 31],
                [64, 43],
                [6, 41],
            ]),
        );
        const full = smoothNet(areas, OPTIONS);
        expect(full.stats.sharedChains).toBeGreaterThan(80);
        // Saat: das Feld (3, 3). Geschrieben: es und seine Nachbarn; mitgerechnet: deren Nachbarn.
        const near =
            (radius: number) =>
            (candidate: NetArea): boolean => {
                if (candidate.id === 300) return true;
                const i = Math.floor((candidate.id - 100) / 7);
                const j = (candidate.id - 100) % 7;
                return Math.abs(i - 3) <= radius && Math.abs(j - 3) <= radius;
            };
        const write = new Set(areas.filter(near(1)).map((candidate) => candidate.id));
        const local = smoothNet(areas.filter(near(2)), OPTIONS, write);
        expect([...local.shapes.keys()].sort()).toEqual([...write].sort());
        for (const written of write) {
            expect(
                local.shapes.get(written)?.map((rings) => rings.map((r) => [...r])),
                `Fläche ${String(written)}`,
            ).toEqual(full.shapes.get(written)?.map((rings) => rings.map((r) => [...r])));
        }
        // Die Gegenprobe: ohne die Nachbarn der Nachbarn weicht der Rand der äußeren Geschriebenen ab.
        const tooSmall = smoothNet(areas.filter(near(1)), OPTIONS, write);
        const differs = [...write].some(
            (written) =>
                JSON.stringify(tooSmall.shapes.get(written)?.map((rings) => rings.map((r) => [...r]))) !==
                JSON.stringify(full.shapes.get(written)?.map((rings) => rings.map((r) => [...r]))),
        );
        expect(differs).toBe(true);
    });

    it("🔴 dieselben Flächen in anderer Reihenfolge und mit anderem Anfangspunkt ergeben dieselbe Form", () => {
        const rotated = area(2, "vegetation", [
            ...[...SEAM].reverse().slice(2),
            [20, 0],
            [20, 12],
            ...[...SEAM].reverse().slice(0, 2),
        ]);
        const one = smoothNet([A, B], OPTIONS);
        const two = smoothNet([rotated, A], OPTIONS);
        expect(normalizeRing(shellOf(two, 2))).toBe(normalizeRing(shellOf(one, 2)));
        expect(normalizeRing(shellOf(two, 1))).toBe(normalizeRing(shellOf(one, 1)));
    });

    it("🔴 der Kartenrand bleibt gerade: Punkte am Rand sind fest, die Ecke der Karte wird nicht abgerundet", () => {
        // Ein Meer in der Nordwestecke der Karte, Legacy-typisch 0,062 E vor dem Rand.
        const sea = area(20, "topographie", [
            [0.062, 900],
            [200, 900],
            [200, 1024],
            [0.062, 1024],
        ]);
        const frame = { minX: 0, minY: 0, maxX: 1024, maxY: 1024, margin: 0.125 };
        const kept = pointSet(shellOf(smoothNet([sea], { ...OPTIONS, frame }), 20));
        for (const corner of ["0.062 900", "200 1024", "0.062 1024"]) expect(kept.has(corner), corner).toBe(true);
        // Die eine Ecke im Inneren rundet sich wie sonst.
        expect(kept.has("200 900")).toBe(false);
        // Ohne die Regel schnitte Chaikin die Ecke der Karte ab.
        const cut = pointSet(shellOf(smoothNet([sea], OPTIONS), 20));
        expect(cut.has("0.062 1024")).toBe(false);
    });

    it("🔴 schreibt nur die verlangten Flächen und rechnet nur deren Ketten", () => {
        const result = smoothNet([A, B], OPTIONS, new Set([1]));
        expect([...result.shapes.keys()]).toEqual([1]);
    });
});

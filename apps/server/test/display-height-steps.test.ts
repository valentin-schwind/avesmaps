import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { bandAreaQuery } from "../src/terrain/display-height/band-area.ts";
import { contourLines, CONTOUR_OPTIONS, type ContourLine } from "../src/terrain/display-height/contours.ts";
import { compareSteps, expectedStep, stepSamples } from "../src/terrain/display-height/verify-steps.ts";
import { LAKE, SEA } from "../src/terrain/hydrology/grid.ts";

/**
 * Befund Höhenstufen 2026-10-03 („das ockergelb für 500 m fehlt beim Finsterkamm“): Auf dem lokalen 8k-Stand zeigte
 * ein Drittel der Landpunkte zwei bis fünf Stufen zu niedrig an. Zwei Ursachen, beide hier festgehalten:
 *
 * 1. Die Vereinfachung (Douglas-Peucker) maß für einen Ring, dessen erster und letzter Punkt zusammenfallen, jeden
 *    Abstand gegen eine „Gerade“ durch einen Punkt und schrumpfte den Ring auf diesen Punkt. Das trifft Ringe, die
 *    durch eine Gitterecke genau auf der Höhe laufen; Anzeigehöhen sind ganzzahlig, das ist oft.
 * 2. `ST_BuildArea` verlangt verknotete Linien; ein Ring, der sich selbst kreuzt, ließ die Fläche der Stufe fallen.
 */

describe("Ringe, die durch Gitterecken auf der Höhe laufen", () => {
    const n = 96;
    const cell = 1024 / n;
    /** Auf volle Hundert gerundet: Sehr viele Gitterecken liegen genau auf einer Schwelle. */
    const terraced = (seed: number): Float32Array =>
        Float32Array.from({ length: n * n }, (_, k) => {
            const x = k % n;
            const y = (k - x) / n;
            const h =
                900 +
                700 * Math.sin(x / (5 + seed)) * Math.cos(y / (7 - seed / 2)) +
                300 * Math.sin((x + y) / (3 + seed / 3));
            return Math.max(0, Math.round(h / 100) * 100);
        });
    const levels = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300];

    /** Gerade-ungerade-Regel über die Ringe einer Höhe: liegt der Punkt in einer ungeraden Zahl von Ringen? */
    function insideRings(rings: readonly ContourLine[], x: number, y: number): boolean {
        let inside = false;
        for (const ring of rings) {
            const c = ring.coords;
            const m = c.length / 2;
            for (let i = 0, j = m - 1; i < m; j = i, i += 1) {
                const yi = c[2 * i + 1] as number;
                const yj = c[2 * j + 1] as number;
                if (
                    yi > y !== yj > y &&
                    x < (((c[2 * j] as number) - (c[2 * i] as number)) * (y - yi)) / (yj - yi) + (c[2 * i] as number)
                ) {
                    inside = !inside;
                }
            }
        }
        return inside;
    }

    it.each([0, 1, 2, 3])(
        "🔴 jede Zelle über der Schwelle liegt in den Ringen, jede darunter außerhalb (Feld %i)",
        (seed) => {
            const field = terraced(seed);
            // Feinere Vereinfachung als die Karte, damit die Zellen am Rand nicht an der Toleranz scheitern.
            const lines = contourLines(field, n, levels, { ...CONTOUR_OPTIONS, simplify: 0.05 });
            let tested = 0;
            let wrong = 0;
            for (const level of levels) {
                const rings = lines.filter((line) => line.ele === level);
                for (let j = 0; j < n; j += 1) {
                    for (let i = 0; i < n; i += 1) {
                        const height = field[j * n + i] as number;
                        // Eine Zelle genau auf der Höhe liegt auf der Linie selbst.
                        if (height === level) continue;
                        tested += 1;
                        if (insideRings(rings, (i + 0.5) * cell, 1024 - (j + 0.5) * cell) !== height > level)
                            wrong += 1;
                    }
                }
            }
            // Vorher fielen ein Drittel der Ringe auf einen Punkt: 8 bis 15 % der Zellen lagen falsch.
            expect(wrong / tested).toBeLessThan(0.001);
        },
    );

    it("🔴 kein Ring schrumpft auf einen Punkt", () => {
        const lines = contourLines(terraced(0), n, levels, { ...CONTOUR_OPTIONS, simplify: 0.05 });
        expect(lines.length).toBeGreaterThan(100);
        for (const line of lines) {
            const distinct = new Set<string>();
            for (let q = 0; q < line.coords.length; q += 2)
                distinct.add(`${String(line.coords[q])},${String(line.coords[q + 1])}`);
            expect(
                distinct.size,
                `Ring ${String(line.ele)} bei ${String(line.coords[0])}/${String(line.coords[1])}`,
            ).toBeGreaterThan(2);
        }
    });
});

describe("Stufe gegen DEM-Höhe (Prüfung)", () => {
    const steps = DESIGN_CANON.topography.heightSteps;

    it("die Stufe einer Höhe ist die höchste Schwelle darunter; auf der Schwelle gilt die untere", () => {
        expect(steps).toEqual([0, 100, 200, 500, 1000, 2000, 3000, 5000]);
        expect([0, 100, 101, 200, 500, 501, 1000, 1001, 2000, 3000, 5000, 5001].map((h) => expectedStep(h))).toEqual([
            0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 6, 7,
        ]);
    });

    it("zählt gleiche, eine Stufe daneben und zwei oder mehr daneben (zu niedrig)", () => {
        const samples = [150, 600, 600, 1500, 2500, 6000].map((height) => ({
            x: 0,
            y: 0,
            height,
            expected: expectedStep(height),
        }));
        // Soll: 1, 3, 3, 4, 5, 7
        expect(compareSteps(samples, [1, 3, 2, 4, 3, 0])).toEqual({
            samples: 6,
            exact: 3,
            oneOff: 1,
            farOff: 2,
            farLow: 2,
        });
        expect(compareSteps(samples, [1, 3, 3, 4, 5, 7])).toEqual({
            samples: 6,
            exact: 6,
            oneOff: 0,
            farOff: 0,
            farLow: 0,
        });
    });

    it("die Stichprobe nimmt Landzellen auf festem Gitter und lässt Meer und Seen aus", () => {
        const n = 128;
        const field = new Float32Array(n * n).fill(700);
        const classes = new Uint8Array(n * n);
        const all = stepSamples(field, classes, n);
        expect(all.length).toBe(4); // 128 / 64 = 2 je Richtung
        expect(all.every((sample) => sample.expected === 3 && sample.height === 700)).toBe(true);
        classes[32 * n + 32] = SEA;
        classes[32 * n + 96] = LAKE;
        expect(stepSamples(field, classes, n).length).toBe(2);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Fläche einer Stufe aus den Ringen gegen PostGIS", () => {
    let database: Database;
    beforeAll(() => {
        database = createDatabase(testDatabaseUrl as string);
    });
    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    const ring = (points: number[][]): ContourLine => ({
        ele: 500,
        level: 1,
        closed: true,
        coords: Float64Array.from(points.flat()),
    });
    const area = async (rings: ContourLine[]): Promise<number> => {
        const [row] = await database<
            { area: number }[]
        >`SELECT coalesce(ST_Area(${bandAreaQuery(database, rings)}), 0)::float8 AS area`;
        return row?.area ?? 0;
    };

    it("🔴 ein Ring, der sich kreuzt, lässt die anderen Flächen der Stufe nicht fallen", async () => {
        const square = ring([
            [200, 0],
            [300, 0],
            [300, 100],
            [200, 100],
            [200, 0],
        ]);
        // Eine Schleife wie nach Vereinfachung und Glättung an einem engen Hals: zwei Dreiecke, ein Kreuzungspunkt.
        const bowtie = ring([
            [0, 0],
            [10, 10],
            [10, 0],
            [0, 10],
            [0, 0],
        ]);
        expect(await area([square])).toBeCloseTo(10000, 3);
        // Vorher (ST_BuildArea ohne Verknoten): 10 000, die Schleife und alles in ihr fehlten.
        expect(await area([square, bowtie])).toBeCloseTo(10050, 3);
    });

    it("ein Ring in einem Ring ist ein Loch, ein dritter darin wieder Fläche (Gerade-ungerade-Regel)", async () => {
        const box = (x: number, size: number): ContourLine =>
            ring([
                [x, x],
                [x + size, x],
                [x + size, x + size],
                [x, x + size],
                [x, x],
            ]);
        expect(await area([box(0, 100), box(20, 60)])).toBeCloseTo(10000 - 3600, 3);
        expect(await area([box(0, 100), box(20, 60), box(40, 20)])).toBeCloseTo(10000 - 3600 + 400, 3);
    });
});

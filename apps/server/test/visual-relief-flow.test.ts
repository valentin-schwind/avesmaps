import { describe, expect, it } from "vitest";
import { CellHeap, directionOf, priorityFlood, receiverOf, rho8 } from "../src/terrain/visual-relief/flow.ts";
import { grid } from "../src/terrain/visual-relief/grid.ts";

describe("Abfluss auf einem glatten diagonalen Hang", () => {
    it("füllt Senken ohne identische Rasterterrassen und behält selbst bei hohen Werten ein positives Gefälle", () => {
        const g = grid(64);
        const surface = new Float32Array(64 * 64);
        for (let i = 0; i < 64; i += 1) {
            surface[i] = surface[63 * 64 + i] = surface[i * 64] = surface[i * 64 + 63] = 50_000;
        }
        const count = priorityFlood(
            g,
            surface,
            new Uint8Array(surface.length),
            0.01,
            new Int32Array(surface.length),
            new CellHeap(4096),
        );
        expect(count).toBe(surface.length);
        const levels = new Set<number>();
        for (let x = 10; x < 54; x += 1) levels.add(surface[10 * 64 + x] as number);
        expect(levels.size).toBeGreaterThan(1);
        expect(surface[32 * 64 + 32]).toBeGreaterThan(50_000);
    });
    it("verzweigt in beide geraden Richtungen statt ausschließlich in parallele Rasterdiagonalen", () => {
        const g = grid(64);
        const heights = Float32Array.from({ length: g.n * g.n }, (_, k) => (k % g.n) + Math.floor(k / g.n));
        const classes = new Uint8Array(heights.length);
        rho8(g, heights, classes, 54054);
        const directions = new Map<number, number>();
        for (let y = 1; y < g.n - 1; y += 1) {
            for (let x = 1; x < g.n - 1; x += 1) {
                const d = directionOf(classes, y * g.n + x);
                directions.set(d, (directions.get(d) ?? 0) + 1);
                expect(heights[receiverOf(g, y * g.n + x, classes)]!).toBeLessThan(heights[y * g.n + x]!);
            }
        }
        for (const d of [1, 3, 7]) expect(directions.get(d) ?? 0).toBeGreaterThan(300);
        expect([...directions.keys()].sort()).toEqual([1, 3, 7]);
        const again = new Uint8Array(heights.length);
        rho8(g, heights, again, 54054);
        expect(again).toEqual(classes);
    });
});

it("branches on axis-aligned slopes as well as diagonal slopes, with downhill receivers only", () => {
    const g = grid(64);
    for (const axis of ["x", "y"] as const) {
        const heights = Float32Array.from({ length: g.n * g.n }, (_, k) =>
            axis === "x" ? k % g.n : Math.floor(k / g.n),
        );
        const classes = new Uint8Array(heights.length);
        rho8(g, heights, classes, 54054);
        const directions = new Map<number, number>();
        for (let y = 1; y < g.n - 1; y++)
            for (let x = 1; x < g.n - 1; x++) {
                const d = directionOf(classes, y * g.n + x);
                directions.set(d, (directions.get(d) ?? 0) + 1);
            }
        expect(directions.size).toBe(3);
        for (const count of directions.values()) expect(count).toBeGreaterThan(300);
        const again = new Uint8Array(classes.length);
        rho8(g, heights, again, 54054);
        expect(again).toEqual(classes);
    }
});

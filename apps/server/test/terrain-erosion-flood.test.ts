import { describe, expect, it } from "vitest";
import { CellHeap, FloodQueue, floodNoise, priorityFlood } from "../src/terrain/hydrology/flow.ts";
import { grid, SEA, type Plane } from "../src/terrain/hydrology/grid.ts";

/**
 * WI-0227: Die Domänenerosion füllt mit `FloodQueue` und vorab gerechnetem Zufall je Zelle. Beides muss bytegleich zur früheren
 * Rechnung bleiben (`CellHeap`, `hash2` je Zelle): dieselbe Füllfolge, dieselbe gefüllte Fläche, dieselbe Zahl der Landzellen.
 */

function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return state / 4294967296;
    };
}

/** Ein Gelände mit Meer am Rand, Senken, Ebenen gleicher Höhe (Gleichstand) und tief eingebrannten Rinnen. */
function terrain(n: number, seed: number): { surface: Float32Array; classes: Uint8Array } {
    const next = random(seed);
    const surface = new Float32Array(n * n);
    const classes = new Uint8Array(n * n);
    for (let y = 0; y < n; y += 1)
        for (let x = 0; x < n; x += 1) {
            const k = y * n + x;
            const d = Math.hypot(x - n / 2, y - n / 2);
            if (d > n * 0.45) classes[k] = SEA;
            const plateau = (x >> 3) % 3 === 0 && (y >> 3) % 2 === 0;
            surface[k] = plateau
                ? 120
                : Math.fround((n * 0.45 - d) * 2 + 40 * Math.sin(x / 5) * Math.cos(y / 7) + next() * 30);
            if (x % 17 === 0 && y > n / 3) surface[k] = -5000 - y * 0.05;
        }
    return { surface, classes };
}

describe("Füllung der Domänenerosion (WI-0227)", () => {
    it("🔴 FloodQueue holt dieselbe Folge wie CellHeap, auch bei Gleichstand", () => {
        const next = random(7);
        const heap = new CellHeap(16);
        const queue = new FloodQueue(16, 64);
        queue.prepare(0, 100);
        let level = 0;
        let cell = 0;
        const keyOf = new Map<number, number>();
        for (let i = 0; i < 500; i += 1) {
            const key = Math.fround(next() * 100);
            keyOf.set(cell, key);
            heap.push(key, cell);
            queue.push(key, cell);
            cell += 1;
        }
        const popped: number[] = [];
        const expected: number[] = [];
        while (heap.size > 0) {
            const a = heap.pop();
            const b = queue.pop();
            expected.push(a);
            popped.push(b);
            // Die Füllung reiht nie unter dem zuletzt geholten ein; Gleichstände kommen oft vor.
            level = Math.max(level, keyOf.get(a) ?? level);
            if (cell < 5000)
                for (let j = 0; j < 2; j += 1) {
                    const key = next() < 0.3 ? level : Math.fround(level + next() * 20);
                    keyOf.set(cell, key);
                    heap.push(key, cell);
                    queue.push(key, cell);
                    cell += 1;
                }
        }
        expect(queue.size).toBe(0);
        expect(popped).toEqual(expected);
    });

    for (const [n, x0, y0] of [
        [128, 0, 0],
        [61, 300, 120],
    ] as const) {
        it(`🔴 priorityFlood mit Schlange und Zufall vorab ist bytegleich: ${String(n)}², Fenster ab ${String(x0)}, ${String(y0)}`, () => {
            const plane: Plane = { width: n, height: n, cell: 0.25, x0, y0 };
            const g = x0 === 0 && y0 === 0 ? grid(n) : plane;
            const before = terrain(n, n);
            const after = terrain(n, n);
            const orderBefore = new Int32Array(n * n);
            const orderAfter = new Int32Array(n * n);
            const sinks = [n * Math.floor(n / 2) + Math.floor(n / 2)];
            const counted = priorityFlood(
                g,
                before.surface,
                before.classes,
                0.05,
                orderBefore,
                new CellHeap(64),
                sinks,
                67001,
            );
            const queue = new FloodQueue(64, 32);
            const noise = floodNoise(g, 67001);
            // Zweimal mit derselben Schlange: Sie muss sich zwischen den Runden selbst leeren.
            for (let round = 0; round < 2; round += 1) {
                const fresh = terrain(n, n);
                after.surface.set(fresh.surface);
                after.classes.set(fresh.classes);
                const count = priorityFlood(
                    g,
                    after.surface,
                    after.classes,
                    0.05,
                    orderAfter,
                    queue,
                    sinks,
                    67001,
                    noise,
                );
                expect(count).toBe(counted);
                expect(Buffer.from(orderAfter.buffer).equals(Buffer.from(orderBefore.buffer))).toBe(true);
                expect(Buffer.from(after.surface.buffer).equals(Buffer.from(before.surface.buffer))).toBe(true);
                expect(Buffer.from(after.classes.buffer).equals(Buffer.from(before.classes.buffer))).toBe(true);
            }
        });
    }
});

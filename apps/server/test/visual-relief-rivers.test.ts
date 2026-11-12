import { describe, expect, it } from "vitest";
import {
    carveValleys,
    generateVisualRelief,
    sparseTerrain,
    VISUAL_RELIEF_PARAMS,
} from "../src/terrain/visual-relief/generate.ts";
import { grid, LAKE, MOUNTAIN } from "../src/terrain/visual-relief/grid.ts";
import { mouthSinks, orientUnknown, riverChains, type RiverChain } from "../src/terrain/visual-relief/rivers.ts";

/**
 * Flüsse im visuellen Relief, Generator 4 (Betreiber 2026-09-28: „im moment gibt es stellen wo flüsse
 * bergauf fließen“, dazu „wenn ein see auf der höhe eines flusses ist, muss der see an dieser höhe sein“).
 */

const g = grid(64);
const n = g.n;
const row = (y: number, from: number, to: number): Int32Array => {
    const cells: number[] = [];
    const step = from <= to ? 1 : -1;
    for (let x = from; x !== to + step; x += step) cells.push(y * n + x);
    return Int32Array.from(cells);
};
const falls = (h: Float32Array, cells: Int32Array): boolean =>
    cells.every((k, i) => i === 0 || (h[k] as number) <= (h[cells[i - 1] as number] as number) + 1e-6);

describe("Läufe ohne Richtung (Regel mit WI-0049)", () => {
    it("(a) erben die Richtung verbundener Läufe, auch über mehrere hinweg", () => {
        const known: RiverChain = { cells: row(10, 5, 10), bach: false };
        // In der Geometrie verkehrt herum; ihr Ende liegt am Ende des bekannten Laufs.
        const first: RiverChain = { cells: row(10, 20, 11), bach: false, unknown: true };
        const second: RiverChain = { cells: row(10, 30, 21), bach: false, unknown: true };
        orientUnknown(g, [known, second, first], new Float32Array(n * n), () => 0);
        expect([first.cells[0], second.cells[0]]).toEqual([10 * n + 11, 10 * n + 21]);
        expect(first.unknown ?? second.unknown).toBeUndefined();
    });

    it("(b) sonst von hoch nach tief im Gelände, (c) bei Gleichstand zur Küste", () => {
        const downhill: RiverChain = { cells: row(20, 5, 15), bach: false, unknown: true };
        const uphill: RiverChain = { cells: row(30, 5, 15), bach: false, unknown: true };
        const flat: RiverChain = { cells: row(40, 5, 15), bach: false, unknown: true };
        const height = (k: number): number => (k === 30 * n + 15 ? 200 : k === 20 * n + 5 ? 200 : 0);
        const coast = new Float32Array(n * n);
        coast[40 * n + 5] = 3;
        coast[40 * n + 15] = 9;
        orientUnknown(g, [downhill, uphill, flat], coast, height);
        expect(downhill.cells[0]).toBe(20 * n + 5);
        expect(uphill.cells[0]).toBe(30 * n + 15);
        // Die Küste liegt am Anfang der Geometrie: dort ist die Mündung.
        expect(flat.cells[0]).toBe(40 * n + 15);
    });

    it("ohne Aufruf bleiben sie in der Reihenfolge der Geometrie", () => {
        const [chain] = riverChains(g, [
            {
                coordinates: [
                    [40, 900],
                    [200, 900],
                ],
                isBach: false,
                flowDirection: null,
            },
        ]);
        expect(chain?.unknown).toBe(true);
        expect((chain?.cells[0] as number) % n).toBeLessThan(((chain?.cells[1] as number) % n) + 1);
    });
});

describe("Böden durch Seen und Gebirge", () => {
    it("🔴 ein See liegt auf Höhe des Flussbetts, der Zufluss nie tiefer, der Abfluss nie höher", () => {
        // Regression WI-0054 Generator 4: Die Gotjasach fiel auf 104 Schritt, der See danach lag bei 995.
        const h = new Float32Array(n * n).fill(900);
        const classes = new Uint8Array(n * n);
        for (let y = 9; y <= 11; y += 1) {
            for (let x = 20; x <= 25; x += 1) {
                classes[y * n + x] = LAKE;
                h[y * n + x] = 500;
            }
        }
        for (let x = 5; x < 20; x += 1) h[10 * n + x] = 100 - x;
        for (let x = 26; x <= 40; x += 1) h[10 * n + x] = 480 - x;
        const chain: RiverChain = { cells: row(10, 5, 40), bach: false };
        carveValleys(g, h, new Float32Array(n * n), classes, [chain], [new Float32Array(chain.cells.length)], {
            ...VISUAL_RELIEF_PARAMS,
        });
        expect(falls(h, chain.cells)).toBe(true);
        const levels = new Set<number>();
        for (let k = 0; k < n * n; k += 1) if ((classes[k] as number) & LAKE) levels.add(h[k] as number);
        expect([...levels]).toEqual([h[10 * n + 19] as number]);
    });

    it("🔴 hinter einem Gebirge fließt ein Lauf nicht höher weiter, als er hineinkam", () => {
        const h = new Float32Array(n * n).fill(900);
        const classes = new Uint8Array(n * n);
        for (let x = 5; x < 15; x += 1) h[10 * n + x] = 200 - x;
        for (let x = 15; x < 20; x += 1) {
            classes[10 * n + x] = MOUNTAIN;
            h[10 * n + x] = 400;
        }
        for (let x = 20; x <= 30; x += 1) h[10 * n + x] = 700 - x;
        const chain: RiverChain = { cells: row(10, 5, 30), bach: false };
        // Ein schmaler Gebirgsrand mit 3 Schritt echtem Gelände auf dem Sockel des Hügellands (400).
        const terrain = (k: number): number => ((classes[k] as number) & MOUNTAIN ? 3 : 0);
        carveValleys(
            g,
            h,
            new Float32Array(n * n),
            classes,
            [chain],
            [new Float32Array(chain.cells.length)],
            { ...VISUAL_RELIEF_PARAMS },
            terrain,
        );
        // 🔴 Regression WI-0054 Generator 4 (Gotjasach an den Drachensteinen, 1.245 statt 64 Schritt): Unter dem
        // Fluss sinkt der Sockel auf den Boden, das echte Gelände bleibt obenauf.
        expect(h[10 * n + 17]).toBe((h[10 * n + 14] as number) + 3);
        // Neben dem Fluss bleibt das Gebirge, wie es ist.
        expect(h[11 * n + 17]).toBe(900);
        for (let x = 20; x <= 30; x += 1) expect(h[10 * n + x] as number).toBeLessThanOrEqual(h[10 * n + 14] as number);
    });
});

describe("Mündungen am Gebirge", () => {
    const classes = new Uint8Array(n * n);
    for (let y = 0; y < n; y += 1) for (let x = 50; x < 60; x += 1) classes[y * n + x] = MOUNTAIN;

    it("nimmt die letzte Zelle vor dem Gebirge, auch kurz davor, aber kein offenes Ende und keinen Zusammenfluss", () => {
        const into: RiverChain = { cells: row(10, 30, 53), bach: false };
        const before: RiverChain = { cells: row(20, 30, 48), bach: false };
        const open: RiverChain = { cells: row(30, 10, 30), bach: false };
        const main: RiverChain = { cells: row(40, 10, 30), bach: false };
        const tributary: RiverChain = {
            cells: Int32Array.from([45 * n + 20, 44 * n + 20, 43 * n + 20, 42 * n + 20, 41 * n + 20]),
            bach: true,
        };
        expect(mouthSinks(g, [into, before, open, main, tributary], classes, 2)).toEqual([10 * n + 49, 20 * n + 48]);
    });
});

describe("Relief zur Mündung am Gebirge", () => {
    /** Eine Insel mit einem Berg im Osten und einem Fluss, der laut Daten an seinem Fuß endet. */
    function world(): Parameters<typeof generateVisualRelief>[0] {
        const cells: number[] = [];
        const heights: number[] = [];
        for (let gy = 0; gy < 4096; gy += 1) {
            const y = 1024 - (gy + 0.5) * 0.25;
            if (Math.abs(y - 512) > 60) continue;
            for (let gx = 0; gx < 4096; gx += 1) {
                const x = (gx + 0.5) * 0.25;
                const d = Math.hypot(x - 700, y - 512);
                if (d >= 60) continue;
                cells.push(gy * 4096 + gx);
                heights.push(3000 * (1 - d / 60));
            }
        }
        const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
        ];
        return {
            terrain: sparseTerrain(Int32Array.from(cells), Float32Array.from(heights)),
            water: [
                {
                    kind: "meer",
                    geometry: { type: "Polygon", coordinates: [square(0, 0, 1024, 1024), square(150, 150, 874, 874)] },
                },
            ],
            rivers: [
                {
                    coordinates: [
                        [300, 512],
                        [645, 512],
                    ],
                    isBach: false,
                    flowDirection: "forward",
                },
            ],
            landscapes: [],
        };
    }

    it("🔴 das Tal fällt zur Mündung hin, statt zu ihr anzusteigen", () => {
        // Regression WI-0054 Generator 4 (Gotjasach an der Roten Sichel): Ohne Abfluss an der Mündung
        // entwässerte das Routing das Tal woandershin, und das Land stieg zur Mündung an.
        const N = 128;
        const { field } = generateVisualRelief(world(), N);
        const at = (x: number, y: number): number =>
            field[Math.floor((1024 - y) / (1024 / N)) * N + Math.floor(x / (1024 / N))] as number;
        // Der Talboden neben dem Fluss, flussauf und kurz vor der Mündung.
        const upstream = (at(320, 530) + at(320, 494)) / 2;
        const mouth = (at(610, 530) + at(610, 494)) / 2;
        expect(mouth).toBeLessThan(upstream);
    });
});

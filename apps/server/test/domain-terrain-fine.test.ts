import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { coarseHeight, composeFine, fineTiles, type FineRecipe } from "../src/terrain/domain/fine.ts";
import { grid, SEA } from "../src/terrain/hydrology/grid.ts";

/** WI-0070: fine stage in overlapping tiles: seamless, deterministic, independent of tile order. */

const FINE: FineRecipe = {
    size: 8192,
    tiles: 4,
    halo: 8,
    blend: 4,
    detail: { amplitude: 60, wavelength: 4, octaves: 2, persistence: 0.5, relief: 0.05 },
    erosion: { iterations: 2, streamPowerK: 0.02, exponent: 0.5, diffusion: 0.1, fill: 0.01, maximumChange: 150 },
};

function coarse(n: number, at: (x: number, y: number) => number): StoredRaster {
    const cell = 1024 / n;
    const samples = new Uint16Array(n * n);
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) samples[j * n + i] = Math.round(at((i + 0.5) * cell, (j + 0.5) * cell));
    return { width: n, height: n, cell, originX: cell / 2, originY: cell / 2, samples };
}

describe("fine tiles", () => {
    it("cover the grid exactly once with their cores and stay inside it with their windows", () => {
        const g = grid(256);
        const owner = new Uint8Array(g.n * g.n);
        for (const tile of fineTiles(g.n, FINE, g.cell)) {
            for (let y = 0; y < tile.size; y++)
                for (let x = 0; x < tile.size; x++) owner[(tile.r0 + y) * g.n + tile.c0 + x]! += 1;
            const w = tile.window;
            expect(w.x0).toBeGreaterThanOrEqual(0);
            expect(w.y0).toBeGreaterThanOrEqual(0);
            expect(w.x0 + w.width).toBeLessThanOrEqual(g.n);
            expect(w.y0 + w.height).toBeLessThanOrEqual(g.n);
            expect(w.x0).toBeLessThanOrEqual(Math.max(0, tile.c0 - FINE.blend));
        }
        expect(owner.every((count) => count === 1)).toBe(true);
    });

    it("interpolates the coarse height without new extremes", () => {
        const c = coarse(64, (x, y) => (x < 512 ? 1000 : 2000) + (y > 512 ? 100 : 0));
        for (let x = 1; x < 1024; x += 7.3)
            for (let y = 1; y < 1024; y += 9.1) {
                const h = coarseHeight(c, x, y);
                expect(h).toBeGreaterThanOrEqual(1000);
                expect(h).toBeLessThanOrEqual(2100);
            }
    });

    it("compose to the plain coarse field where nothing is refined: the cross-fade is a partition of unity", () => {
        const g = grid(256);
        const c = coarse(128, () => 1234);
        const flat = { ...FINE, detail: { ...FINE.detail, amplitude: 0 }, erosion: { ...FINE.erosion, iterations: 0 } };
        const { composite } = composeFine(c, g, new Uint8Array(g.n * g.n), flat, 67001, "test").cache;
        expect(composite.every((h) => h === 1234)).toBe(true);
    });

    // 🪤 Eigene Zeitgrenze, keine Leistungsaussage (WI-0101, Form von `c834621e`): der Fall rechnet
    // `composeFine` über ein 256er-Gitter mit Erosion, und die 5.000 ms der Voreinstellung sind dafür
    // nur ein Rahmen. Gemessen am 2026-10-07 auf dem Entwicklungsrechner unter der üblichen Last
    // mehrerer Sitzungen (5 fremde Testprozesse, CPU 30 bis 82 %), 5 Läufe über `-t`: Median 3.030 ms,
    // Spanne 1.756 bis 3.252 ms. Mit dem für dieselbe Maschine schon gemessenen Faktor 4,2 bei
    // gesättigter CPU (WI-0100) liegt der schlechteste Fall bei rund 13,7 s, also ÜBER der
    // Voreinstellung. 60 s lassen das Vierfache davon Luft; ein echter Hänger endet weiterhin.
    it("leave no seam on refined, eroding terrain and stay deterministic", { timeout: 60_000 }, () => {
        const g = grid(256);
        const c = coarse(128, (x, y) => 800 + 1500 * Math.exp(-((x - 600) ** 2 + (y - 400) ** 2) / 40000));
        const classes = new Uint8Array(g.n * g.n);
        for (let y = 0; y < g.n; y++) for (let x = 0; x < 20; x++) classes[y * g.n + x] = SEA;
        const acc = composeFine(c, g, classes, FINE, 67001, "test").cache.composite;
        expect(composeFine(c, g, classes, FINE, 67001, "test").cache.composite).toEqual(acc);
        // Steps across tile borders are no larger than steps inside the tiles.
        const step = (k: number, d: number) => Math.abs(acc[k + d]! - acc[k]!);
        let border = 0,
            inside = 0;
        const size = g.n / FINE.tiles;
        for (let y = 1; y < g.n - 1; y++)
            for (let x = 21; x < g.n - 1; x++) {
                const s = step(y * g.n + x, 1);
                if ((x + 1) % size === 0) border = Math.max(border, s);
                else inside = Math.max(inside, s);
            }
        expect(border).toBeLessThanOrEqual(inside);
        for (let y = 0; y < g.n; y++) expect(acc[y * g.n + 5]).toBe(0);
    });

    // 🪤 Dieselbe eigene Grenze, derselbe Grund; nur rechnet dieser Fall `composeFine` VIERMAL
    // (erster Lauf, inkrementell, Vollauf zum Vergleich, Leerlauf), ist also der teuerste der Datei.
    // 💣 Er ist der EINZIGE rote Fall des Volllaufs vom 2026-10-07 (364 Dateien, 5.309 grün):
    // „Test timed out in 5000ms" bei sonst grüner Datei. Gemessen, 5 Läufe unter derselben Last:
    // Median 3.864 ms, Spanne 2.014 bis 7.830 ms. Zwei der fünf Läufe lagen schon ÜBER 5.000 ms.
    // 60 s sind das 7,7-Fache des schlechtesten gemessenen Wertes.
    it("recomputes only changed tiles and their neighbours, byte for byte like a full run", { timeout: 60_000 }, () => {
        const g = grid(256);
        const classes = new Uint8Array(g.n * g.n);
        const before = coarse(128, (x, y) => 800 + 1500 * Math.exp(-((x - 600) ** 2 + (y - 400) ** 2) / 40000));
        const first = composeFine(before, g, classes, FINE, 67001, "test");
        expect(first.computed).toBe(16);
        // A new summit in one corner tile.
        const after = coarse(
            128,
            (x, y) =>
                800 +
                1500 * Math.exp(-((x - 600) ** 2 + (y - 400) ** 2) / 40000) +
                900 * Math.exp(-((x - 120) ** 2 + (y - 900) ** 2) / 900),
        );
        const incremental = composeFine(after, g, classes, FINE, 67001, "test", first.cache);
        const full = composeFine(after, g, classes, FINE, 67001, "test");
        expect(incremental.computed).toBeLessThan(16);
        expect(incremental.cache.composite).toEqual(full.cache.composite);
        expect(incremental.cache.fingerprints).toEqual(full.cache.fingerprints);
        const unchanged = composeFine(after, g, classes, FINE, 67001, "test", incremental.cache);
        expect(unchanged.computed).toBe(0);
        expect(unchanged.cache.composite).toEqual(full.cache.composite);
    });
});

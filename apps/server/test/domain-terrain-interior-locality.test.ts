import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { refineMountainInterior } from "../src/terrain/domain/mountain-interior.ts";
import { AVENTURIA_TERRAIN_RECIPE, type TerrainRecipe } from "../src/terrain/domain/recipes.ts";

/** WI-0067 Optimierung P0: die Gebirgsinnen-Verfeinerung ist lokal und verändert nur ihre Innenfläche. */

const N = 256;
const CELL = 1024 / N;

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
        type: "Polygon" as const,
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    };
}

/** Coarse fixtures need resolvable fragments: two cells minimum, as on the real 4096² grid. */
function recipe(halo = 64): TerrainRecipe {
    const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
    Object.assign(value.mountainMorphology.interior, { iterations: 4, inward: 8, halo });
    Object.assign(value.mountainMorphology.interior.fragments, {
        spacing: 12,
        radiusMinimum: 8,
        radiusMaximum: 12,
        lengthMinimum: 8,
        lengthMaximum: 20,
        inward: 4,
    });
    return value;
}

/** Raster in the stored orientation (row 0 south), height from the cell centre in map units. */
function raster(height: (x: number, y: number) => number): StoredRaster {
    const samples = new Uint16Array(N * N);
    for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++)
            samples[j * N + i] = Math.max(0, Math.round(height((i + 0.5) * CELL, (j + 0.5) * CELL)));
    return { width: N, height: N, cell: CELL, originX: CELL / 2, originY: CELL / 2, samples };
}

function domain(extra: Partial<DomainInputs> = {}): DomainInputs {
    const continent = polygon(0, 0, 1024, 1024);
    return {
        continent: { id: "land", fingerprint: "land", geometry: continent },
        land: [continent],
        seeds: [],
        peaks: [],
        fingerprint: "fixture",
        water: [],
        landscapes: [{ layer: "topographie", type: "gebirge", geometry: polygon(200, 200, 360, 360) }],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
        ...extra,
    };
}

const inner = (x: number, y: number): number =>
    1500 + 450 * Math.sin(x / 23) * Math.cos(y / 31) + 250 * Math.sin((x + 2 * y) / 11);

describe("WI-0067 mountain interior locality", () => {
    it("P0.1: distant terrain and landscapes outside the halo cannot change the local mountain result", () => {
        // Window = mountain bbox (200..360 E) plus halo 64 E; everything further out differs.
        const inside = (x: number, y: number) => x > 120 && x < 440 && y > 120 && y < 440;
        const near = raster((x, y) => (inside(x, y) ? inner(x, y) : 40));
        const far = raster((x, y) =>
            inside(x, y) ? inner(x, y) : x > 940 && y < 80 ? 0 : 3200 + 700 * Math.sin(x / 9) - 2 * y,
        );
        const lake = polygon(700, 160, 740, 200);
        const farInput = domain({
            water: [
                { kind: "meer", geometry: polygon(940, 0, 1024, 80) },
                { kind: "see", geometry: lake },
            ],
            landscapes: [
                { layer: "topographie", type: "gebirge", geometry: polygon(200, 200, 360, 360) },
                { layer: "topographie", type: "gebirge", geometry: polygon(600, 600, 900, 900) },
                { layer: "topographie", type: "huegelland", geometry: polygon(560, 560, 640, 900) },
                { layer: "vegetation", type: "wald", geometry: polygon(500, 0, 1024, 1024) },
            ],
            peaks: [{ id: "far-peak", name: "far peak", x: 800, y: 800, h: 4000 }],
            rivers: {
                rivers: [
                    {
                        id: "far-river",
                        name: "far river",
                        bach: false,
                        direction: "forward",
                        coast: null,
                        coordinates: [
                            [520, 980],
                            [980, 520],
                        ],
                    },
                ],
                lakes: [{ id: "far-lake", name: "far lake", geometry: lake }],
                fingerprint: "far-river",
            },
        });
        refineMountainInterior(near, domain(), recipe());
        refineMountainInterior(far, farInput, recipe());
        let changed = 0;
        for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL,
                    y = (j + 0.5) * CELL;
                if (!(x > 136 && x < 424 && y > 136 && y < 424)) continue;
                const k = j * N + i;
                expect(far.samples[k], `cell ${String(i)},${String(j)}`).toBe(near.samples[k]);
                if (x > 200 && x < 360 && y > 200 && y < 360 && near.samples[k] !== Math.round(inner(x, y))) changed++;
            }
        expect(changed).toBeGreaterThan(100);
    });

    it("P0.2: hills, foothills, water banks, river corridors, peaks and all non-mountain cells stay byte-identical", () => {
        const before = raster((x, y) => {
            if (x > 760 && y > 760) return 0;
            if (x > 200 && x < 800 && y > 200 && y < 800) return inner(x, y);
            return 300 + 0.2 * x;
        });
        const peakCells = new Set<number>();
        const peak = { id: "peak", name: "peak", x: 700, y: 300, h: 2500 };
        const px = Math.floor(peak.x / CELL - 0.5),
            py = Math.floor(peak.y / CELL - 0.5);
        for (const dy of [0, 1])
            for (const dx of [0, 1]) {
                peakCells.add((py + dy) * N + px + dx);
                before.samples[(py + dy) * N + px + dx] = peak.h;
            }
        const lake = polygon(600, 600, 616, 616);
        const sea = polygon(760, 760, 1024, 1024);
        const input = domain({
            water: [
                { kind: "see", geometry: lake },
                { kind: "meer", geometry: sea },
            ],
            landscapes: [
                { layer: "topographie", type: "gebirge", geometry: polygon(200, 200, 800, 800) },
                { layer: "topographie", type: "huegelland", geometry: polygon(200, 200, 500, 800) },
            ],
            peaks: [peak],
            rivers: {
                rivers: [
                    {
                        id: "river",
                        name: "river",
                        bach: false,
                        direction: "forward",
                        coast: null,
                        coordinates: [
                            [550, 150],
                            [550, 850],
                        ],
                    },
                ],
                lakes: [],
                fingerprint: "river",
            },
        });
        const after = { ...before, samples: before.samples.slice() };
        expect(refineMountainInterior(after, input, recipe(32))).toBeTruthy();
        const water: [number, number][] = [];
        for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL,
                    y = (j + 0.5) * CELL;
                if ((x > 600 && x < 616 && y > 600 && y < 616) || (x > 760 && y > 760)) water.push([i, j]);
            }
        const river = Math.floor(550 / CELL);
        let changed = 0;
        for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL,
                    y = (j + 0.5) * CELL;
                const k = j * N + i;
                const mountain = x > 200 && x < 800 && y > 200 && y < 800 && x > 500;
                const bank = water.some(([a, b]) => (a - i) ** 2 + (b - j) ** 2 <= 9);
                const corridor = Math.abs(i - river) <= 2 && y > 140 && y < 860;
                const free = mountain && !bank && !corridor && !peakCells.has(k);
                if (!free) expect(after.samples[k], `fixed cell ${String(i)},${String(j)}`).toBe(before.samples[k]);
                else if (after.samples[k] !== before.samples[k]) changed++;
            }
        expect(changed).toBeGreaterThan(500);
    });

    it("joins diagonally touching cells (D8 drains them into each other) and merges overlapping halos only", () => {
        // Two squares meeting at one corner: one 8-connected component.
        const diagonal = refineMountainInterior(
            raster(inner),
            domain({
                landscapes: [
                    { layer: "topographie", type: "gebirge", geometry: polygon(200, 200, 300, 300) },
                    { layer: "topographie", type: "gebirge", geometry: polygon(300, 300, 400, 400) },
                ],
            }),
            recipe(),
        );
        expect(diagonal.components).toBe(1);
        // 40 E apart with halo 64: two components, one computation group. 600 E apart: two groups.
        const near = refineMountainInterior(
            raster(inner),
            domain({
                landscapes: [
                    { layer: "topographie", type: "gebirge", geometry: polygon(200, 200, 300, 300) },
                    { layer: "topographie", type: "gebirge", geometry: polygon(340, 200, 440, 300) },
                ],
            }),
            recipe(),
        );
        expect([near.components, near.groups]).toEqual([2, 1]);
        const far = refineMountainInterior(
            raster(inner),
            domain({
                landscapes: [
                    { layer: "topographie", type: "gebirge", geometry: polygon(100, 100, 200, 200) },
                    { layer: "topographie", type: "gebirge", geometry: polygon(800, 800, 900, 900) },
                ],
            }),
            recipe(),
        );
        expect([far.components, far.groups]).toEqual([2, 2]);
    });

    it("is independent of the order of landscape polygons and deterministic between runs", () => {
        const areas = [
            { layer: "topographie" as const, type: "gebirge", geometry: polygon(200, 200, 360, 360) },
            { layer: "topographie" as const, type: "gebirge", geometry: polygon(380, 380, 600, 560) },
            { layer: "topographie" as const, type: "gebirge", geometry: polygon(700, 100, 900, 300) },
        ];
        const first = raster(inner);
        const second = raster(inner);
        const third = raster(inner);
        refineMountainInterior(first, domain({ landscapes: areas }), recipe());
        refineMountainInterior(second, domain({ landscapes: [...areas].reverse() }), recipe());
        refineMountainInterior(third, domain({ landscapes: areas }), recipe());
        expect(second.samples).toEqual(first.samples);
        expect(third.samples).toEqual(first.samples);
    });
});

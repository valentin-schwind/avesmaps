import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import { formInitialTerrain } from "../src/terrain/domain/initial-terrain.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { refineMountainInterior } from "../src/terrain/domain/mountain-interior.ts";
import { AVENTURIA_TERRAIN_RECIPE, type TerrainRecipe } from "../src/terrain/domain/recipes.ts";
import { deckleRueckennetz, rueckennetzMaske } from "../src/terrain/domain/rueckennetz-flaechen.ts";

/**
 * WI-0247 (Hauptorchestrierung 2026-10-21, „Fix A“): Ein Gebirge mit gezeichneten Kämmen übernimmt seine Saat unverändert; Saat-Glättung,
 * Saatfeld, Bruchstücke und Gebirgsinneres lassen es aus, die Kammhöhe deckelt es. Ohne Rückennetz rechnet alles wie zuvor.
 */

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

const RN = polygon(200, 200, 360, 360);
const V12 = polygon(600, 600, 760, 760);
const rueckennetz = [{ id: "rn", geometry: RN, deckel: 1800 }];

function domain(extra: Partial<DomainInputs> = {}): DomainInputs {
    const continent = polygon(0, 0, 1024, 1024);
    return {
        continent: { id: "land", fingerprint: "land", geometry: continent },
        land: [continent],
        seeds: [],
        peaks: [],
        fingerprint: "fixture",
        water: [],
        landscapes: [
            { layer: "topographie", type: "gebirge", geometry: RN },
            { layer: "topographie", type: "gebirge", geometry: V12 },
        ],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
        ...extra,
    };
}

const N = 256;
const CELL = 1024 / N;
type Box = readonly [number, number, number, number];
const inside = (x: number, y: number, [x0, y0, x1, y1]: Box) => x > x0 && x < x1 && y > y0 && y < y1;
const relief = (x: number, y: number): number =>
    inside(x, y, [200, 200, 360, 360]) || inside(x, y, [600, 600, 760, 760])
        ? 1500 + 450 * Math.sin(x / 23) * Math.cos(y / 31) + 250 * Math.sin((x + 2 * y) / 11)
        : 40;

/** Raster in the stored orientation (row 0 south). */
function raster(height: (x: number, y: number) => number): StoredRaster {
    const samples = new Uint16Array(N * N);
    for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++)
            samples[j * N + i] = Math.max(0, Math.round(height((i + 0.5) * CELL, (j + 0.5) * CELL)));
    return { width: N, height: N, cell: CELL, originX: CELL / 2, originY: CELL / 2, samples };
}

/** Coarse fixtures need resolvable interior fragments (as in `domain-terrain-interior-locality.test.ts`). */
function interiorRecipe(): TerrainRecipe {
    const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
    Object.assign(value.mountainMorphology.interior, { iterations: 4, inward: 8, halo: 64 });
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

/** Changed cells inside a box between two stored rasters. */
function changed(a: StoredRaster, b: StoredRaster, box: Box): number {
    let count = 0;
    for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++)
            if (inside((i + 0.5) * CELL, (j + 0.5) * CELL, box) && a.samples[j * N + i] !== b.samples[j * N + i])
                count++;
    return count;
}

describe("WI-0247: Gebirge aus gezeichneten Kämmen im Gelände", () => {
    it("hat ohne Rückennetz keine Maske und deckelt nichts", () => {
        expect(rueckennetzMaske(grid(N), domain())).toBeUndefined();
        const before = raster(relief);
        const after = raster(relief);
        expect(deckleRueckennetz(after, domain())).toBe(0);
        expect(after.samples).toEqual(before.samples);
    });

    it("lässt das Gebirgsinnere eines Rückennetz-Gebirges unverändert, das des V12-Gebirges nicht", () => {
        const before = raster(relief);
        const plain = raster(relief);
        const marked = raster(relief);
        refineMountainInterior(plain, domain(), interiorRecipe());
        refineMountainInterior(marked, domain({ rueckennetz }), interiorRecipe());
        expect(changed(before, plain, [200, 200, 360, 360])).toBeGreaterThan(100);
        expect(changed(before, marked, [200, 200, 360, 360])).toBe(0);
        expect(changed(before, marked, [600, 600, 760, 760])).toBeGreaterThan(100);
    });

    it("deckelt nur das Rückennetz-Gebirge auf seine Kammhöhe", () => {
        const after = raster(relief);
        const gedeckelt = deckleRueckennetz(after, domain({ rueckennetz }));
        expect(gedeckelt).toBeGreaterThan(0);
        let rn = 0;
        let v12 = 0;
        for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL,
                    y = (j + 0.5) * CELL;
                const h = after.samples[j * N + i]!;
                if (inside(x, y, [200, 200, 360, 360])) rn = Math.max(rn, h);
                if (inside(x, y, [600, 600, 760, 760])) v12 = Math.max(v12, h);
            }
        expect(rn).toBe(1800);
        expect(v12).toBeGreaterThan(1800);
    });

    it("erodiert auch das Rückennetz-Gebirge (Betreiber 2026-10-21: „wir brauchen natürlich die erosion“)", () => {
        // Rücken im Abstand von 16 E auf einem 4-E-Gitter; Saat und Gitter liegen Zelle auf Zelle.
        const seed = (x0: number): StoredRaster => {
            const width = 40;
            const samples = Uint16Array.from({ length: width * width }, (_, k) =>
                Math.round(1600 + 500 * Math.cos(((k % width) * 2 * Math.PI) / 4)),
            );
            return { width, height: width, cell: 4, originX: x0 + 2, originY: x0 + 2, samples };
        };
        const seeds = [seed(200), seed(600)];
        const run = (input: DomainInputs) => generateDomainTerrain(input, AVENTURIA_TERRAIN_RECIPE, 256).raster;
        const plain = run(domain({ seeds }));
        const marked = run(domain({ seeds, rueckennetz: [{ id: "rn", geometry: RN, deckel: 2100 }] }));
        // Mittlere Abweichung von der Saat im Inneren (gespeicherte Ausrichtung, Zeile 0 im Süden).
        const abweichung = (r: StoredRaster, x0: number) => {
            let sum = 0,
                count = 0;
            for (let j = 10; j < 30; j++)
                for (let i = 10; i < 30; i++) {
                    const gx = Math.floor((x0 + 2 + 4 * i) / 4),
                        gy = Math.floor((x0 + 2 + 4 * j) / 4);
                    sum += Math.abs(r.samples[gy * 256 + gx]! - seeds[0]!.samples[j * 40 + i]!);
                    count++;
                }
            return sum / count;
        };
        // Auf dem 4-E-Gitter glättet die Saat-Glättung nichts und das Gebirgsinnere greift nicht: Beide rechnen dieselbe Erosion.
        expect(abweichung(marked, 200)).toBeGreaterThan(50);
        expect(abweichung(marked, 200)).toBeCloseTo(abweichung(plain, 200), -1);
    }, 30_000);

    it("übernimmt die Saat ungeglättet und ohne Bruchstücke, nur im Rückennetz-Gebirge", () => {
        const g = grid(512);
        const recipe = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        recipe.mountainMorphology.seedSmoothing = 4;
        // Je Gebirge eine Saat mit Rücken im Abstand von 8 E, wie die Äste eines Rückennetzes.
        const seed = (x0: number): StoredRaster => {
            const width = 80;
            const samples = Uint16Array.from({ length: width * width }, (_, k) =>
                Math.round(1600 + 600 * Math.cos(((k % width) * 2 * Math.PI) / 4)),
            );
            return { width, height: width, cell: 2, originX: x0 + 1, originY: x0 + 1, samples };
        };
        const at = (input: DomainInputs) => formInitialTerrain(g, input, recipe).height;
        const seeds = [seed(200), seed(600)];
        const plain = at(domain({ seeds }));
        const marked = at(domain({ seeds, rueckennetz }));
        // Grid row 0 is north; the ridge crests lie on every fourth seed column.
        const cell = (x: number, y: number) => Math.floor((1024 - y) / g.cell) * g.n + Math.floor(x / g.cell);
        const amplitude = (h: Float32Array, x0: number) => {
            let crest = 0,
                trough = 0;
            for (let y = x0 + 40; y < x0 + 120; y += 2) {
                crest += h[cell(x0 + 1 + 2 * 40, y)]!;
                trough += h[cell(x0 + 1 + 2 * 42, y)]!;
            }
            return (crest - trough) / 40;
        };
        expect(amplitude(marked, 200)).toBeGreaterThan(1000);
        expect(amplitude(plain, 200)).toBeLessThan(600);
        expect(amplitude(marked, 600)).toBeCloseTo(amplitude(plain, 600), 3);
    });
});

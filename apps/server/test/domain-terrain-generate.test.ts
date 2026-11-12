import { describe, expect, it } from "vitest";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import type { loadDomainInputs } from "../src/terrain/domain/inputs.ts";

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
        type: "Polygon",
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

function input(): Awaited<ReturnType<typeof loadDomainInputs>> {
    const continent = polygon(256, 256, 896, 896);
    return {
        continent: { id: "continent", fingerprint: "fixture", geometry: continent },
        land: [continent],
        water: [{ kind: "meer", geometry: polygon(0, 0, 256, 1024) }],
        seeds: [],
        peaks: [],
        landscapes: [],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
        fingerprint: "fixture",
    };
}

describe("WI-0067: erosive domain prototype", () => {
    it("does not turn a smooth mountain flank into cell-scale erosion ribs", () => {
        const source = input();
        source.seeds = [
            {
                width: 64,
                height: 64,
                cell: 4,
                originX: 402,
                originY: 402,
                samples: Uint16Array.from({ length: 4096 }, (_, k) => 4000 + 30 * (k % 64) + 20 * Math.floor(k / 64)),
            },
        ];
        source.landscapes = [{ layer: "topographie", type: "gebirge", geometry: polygon(400, 400, 656, 656) }];
        const { samples } = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 256).raster;
        const curvature: number[] = [];
        for (let y = 120; y < 145; y += 1) {
            for (let x = 120; x < 145; x += 1) {
                const k = y * 256 + x;
                curvature.push(
                    Math.abs(samples[k - 1]! + samples[k + 1]! - 2 * samples[k]!) +
                        Math.abs(samples[k - 256]! + samples[k + 256]! - 2 * samples[k]!),
                );
            }
        }
        expect(curvature.reduce((a, b) => a + b, 0) / curvature.length).toBeLessThan(50);
        expect(Math.max(...curvature)).toBeLessThan(200);
    });

    it("preserves the fine ridge structure of an unconstrained mountain seed", () => {
        const source = input();
        const width = 64;
        const samples = Uint16Array.from({ length: width * width }, (_, k) =>
            Math.round(
                1800 +
                    250 * Math.cos(((k % width) * Math.PI) / 4) +
                    180 * Math.cos((Math.floor(k / width) * Math.PI) / 4),
            ),
        );
        source.seeds = [{ width, height: width, cell: 4, originX: 402, originY: 402, samples }];
        source.landscapes = [{ layer: "topographie", type: "gebirge", geometry: polygon(400, 400, 656, 656) }];
        const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 256);
        let original = 0;
        let evolved = 0;
        for (let y = 12; y < 52; y += 1) {
            for (let x = 12; x < 52; x += 1) {
                const k = y * width + x;
                const at = (y + 100) * 256 + x + 100;
                original += Math.abs(samples[k - 1]! + samples[k + 1]! - 2 * samples[k]!);
                evolved += Math.abs(
                    result.raster.samples[at - 1]! + result.raster.samples[at + 1]! - 2 * result.raster.samples[at]!,
                );
            }
        }
        expect(evolved / original).toBeGreaterThan(0.7);
    });

    it("retains many small inland summits without any V12 seed or known peak", () => {
        const result = generateDomainTerrain(input(), AVENTURIA_TERRAIN_RECIPE, 256);
        const h = result.raster.samples;
        let summits = 0;
        const heights: number[] = [];
        for (let y = 110; y < 190; y += 1) {
            for (let x = 110; x < 190; x += 1) {
                const k = y * 256 + x;
                heights.push(h[k]!);
                if (h[k]! > h[k - 1]! && h[k]! > h[k + 1]! && h[k]! > h[k - 256]! && h[k]! > h[k + 256]!) summits += 1;
            }
        }
        expect(summits).toBeGreaterThan(30);
        const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
        expect(Math.sqrt(heights.reduce((a, b) => a + (b - mean) ** 2, 0) / heights.length)).toBeGreaterThan(5);
    });

    it("is deterministic, with exact sea zero and conserved iteration mass", () => {
        const result = generateDomainTerrain(input(), AVENTURIA_TERRAIN_RECIPE, 64);
        const repeated = generateDomainTerrain(input(), AVENTURIA_TERRAIN_RECIPE, 64);
        expect(repeated.fingerprint).toBe(result.fingerprint);
        expect(repeated.raster.samples).toEqual(result.raster.samples);
        for (let y = 0; y < 64; y += 1)
            for (let x = 0; x < 16; x += 1) expect(result.raster.samples[y * 64 + x]).toBe(0);
        for (const mass of result.report.masses)
            expect(Math.abs(mass.after - mass.before)).toBeLessThan(mass.before * 1e-6);
    });

    it("ignores a known peak in the sea without land and reports its identity", () => {
        const source = input();
        source.peaks = [{ id: "sea-peak", name: "sea peak", x: 100, y: 100, h: 1000 }];
        const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 64);
        expect(result.report.ignoredPeaks.map((p) => p.id)).toEqual(["sea-peak"]);
        expect(result.fingerprint).toBe(generateDomainTerrain(input(), AVENTURIA_TERRAIN_RECIPE, 64).fingerprint);
    });
    it("keeps a mapped island and its absolute peak when the surrounding sea polygon overlaps it", () => {
        const source = input();
        const island = polygon(64, 64, 192, 192);
        source.land.push(island);
        source.landscapes.push({ layer: "topographie", type: "insel", geometry: island });
        source.peaks = [{ id: "island-peak", name: "island peak", x: 104, y: 104, h: 60 }];
        const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 64);
        expect(result.report.ignoredPeaks).toEqual([]);
        for (const dx of [0, 1])
            for (const dy of [0, 1]) expect(result.raster.samples[(6 + dy) * 64 + 6 + dx]).toBe(60);
        expect(result.raster.samples[0]).toBe(0);
    });

    it("keeps a known free land peak at its absolute sampling core", () => {
        const source = input();
        source.peaks = [{ id: "land-peak", name: "land peak", x: 520, y: 520, h: 1200 }];
        const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 64);
        const i = Math.floor((520 - result.raster.originX) / result.raster.cell);
        const j = Math.floor((520 - result.raster.originY) / result.raster.cell);
        for (const dx of [0, 1])
            for (const dy of [0, 1]) expect(result.raster.samples[(j + dy) * 64 + i + dx]).toBe(1200);
    });

    it.each(["erodibility", "diffusivity", "runoff", "upliftWeight"] as const)(
        "uses spatial %s in the actual erosive height process",
        (parameter) => {
            const source = input();
            source.peaks = [{ id: "land-peak", name: "land peak", x: 520, y: 520, h: 1200 }];
            source.landscapes = [{ layer: "topographie", type: "probe", geometry: polygon(256, 256, 560, 896) }];
            const neutral = structuredClone(AVENTURIA_TERRAIN_RECIPE);
            neutral.topographie["probe"] = {
                upliftWeight: 1,
                erodibility: 1,
                diffusivity: 1,
                runoff: 1,
                channelBias: 0,
            };
            const changed = structuredClone(neutral);
            changed.topographie["probe"]![parameter] = 4;
            const before = generateDomainTerrain(source, neutral, 64);
            const after = generateDomainTerrain(source, changed, 64);
            expect(after.fingerprint).not.toBe(before.fingerprint);
            expect(after.raster.samples).not.toEqual(before.raster.samples);
            for (const mass of after.report.masses)
                expect(Math.abs(mass.after - mass.before)).toBeLessThan(mass.before * 1e-6);
        },
    );
});

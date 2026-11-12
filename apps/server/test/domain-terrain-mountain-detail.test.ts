import { expect, it } from "vitest";
import { relaxMountainSlopes, erodeMountainDetails } from "../src/terrain/domain/mountain-detail.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { refineMountainInterior } from "../src/terrain/domain/mountain-interior.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";

it("spreads a steep summit into movable neighbours without moving its absolute height", () => {
    const g = { n: 64, cell: 0.25 };
    const height = new Float32Array(g.n * g.n).fill(1000);
    const weight = new Float32Array(height.length).fill(1);
    const locked = new Uint8Array(height.length);
    const summit = 32 * g.n + 32;
    height[summit] = 4000;
    locked[summit] = 1;
    relaxMountainSlopes(g, height, weight, locked, 0.7, 80);
    expect(height[summit]).toBe(4000);
    expect((height[summit]! - height[summit + 1]!) / 750).toBeLessThan(0.71);
    expect(height[summit + 2]).toBeGreaterThan(1000);
});

it("preserves hill overlap and bilinear lake-bank samples as well as the water centres", () => {
    const polygon = (a: number, b: number, c: number, d: number) => ({
        type: "Polygon",
        coordinates: [
            [
                [a, b],
                [c, b],
                [c, d],
                [a, d],
                [a, b],
            ],
        ],
    });
    const continent = polygon(0, 0, 1024, 1024);
    const input: DomainInputs = {
        continent: { id: "land", fingerprint: "land", geometry: continent },
        land: [continent],
        seeds: [],
        peaks: [],
        fingerprint: "fixture",
        water: [{ kind: "see", geometry: polygon(600, 600, 616, 616) }],
        landscapes: [
            { layer: "topographie", type: "gebirge", geometry: polygon(200, 200, 800, 800) },
            { layer: "topographie", type: "huegelland", geometry: polygon(200, 200, 500, 800) },
        ],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
    };
    const recipe = structuredClone(AVENTURIA_TERRAIN_RECIPE);
    recipe.mountainMorphology.interior.iterations = 1;
    recipe.mountainMorphology.interior.halo = 16;
    Object.assign(recipe.mountainMorphology.interior.fragments, { spacing: 12, radiusMinimum: 8, radiusMaximum: 12 });
    const raster = {
        width: 256,
        height: 256,
        cell: 4,
        originX: 2,
        originY: 2,
        samples: new Uint16Array(256 ** 2).fill(1000),
    };
    expect(refineMountainInterior(raster, input, recipe).changedCells).toBeGreaterThan(0);
    for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
            const px = x * 4 + 2,
                py = y * 4 + 2;
            const exterior = px < 500 || px > 800 || py < 200 || py > 800;
            const lakeAndBanks = px >= 594 && px <= 622 && py >= 594 && py <= 622;
            if (exterior || lakeAndBanks) expect(raster.samples[y * 256 + x]).toBe(1000);
        }
});

it("evolves mountain details deterministically while leaving the fixed exterior byte-identical", () => {
    const plane = { width: 128, height: 128, cell: 0.25, x0: 0, y0: 0 };
    const base = Float32Array.from({ length: 128 * 128 }, (_, k) => 1000 + 10 * Math.floor(k / 128) + ((k * 37) % 23));
    const weight = Float32Array.from(base, (_, k) => (k % 128 > 32 && k % 128 < 96 ? 1 : 0));
    const locked = new Uint8Array(base.length);
    locked[64 * 128 + 64] = 1;
    const recipe = AVENTURIA_TERRAIN_RECIPE.mountainMorphology.interior;
    const erode = () =>
        erodeMountainDetails(
            { plane, height: base.slice(), weight, locked, classes: new Uint8Array(base.length) },
            recipe,
            67001,
            AVENTURIA_TERRAIN_RECIPE.generator,
        );
    const first = erode();
    expect(first).toEqual(erode());
    expect(first.some((h, k) => weight[k] && h !== base[k])).toBe(true);
    for (let k = 0; k < base.length; k++) {
        if (!weight[k] || locked[k]) expect(first[k]).toBe(base[k]);
    }
    expect(base[0]).toBe(1000);
});

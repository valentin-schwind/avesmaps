import { describe, expect, it } from "vitest";
import { grid } from "../src/terrain/hydrology/grid.ts";
import { composeMaterials } from "../src/terrain/domain/materials.ts";

const g = grid(64);
const land = new Uint8Array(g.n * g.n).fill(1);
const geometry = {
    type: "Polygon",
    coordinates: [
        [
            [0, 0],
            [1024, 0],
            [1024, 1024],
            [0, 1024],
            [0, 0],
        ],
    ],
};
const recipes = {
    topographie: { huegelland: { upliftWeight: 2, erodibility: 0.5, diffusivity: 2, runoff: 1, channelBias: 3 } },
    vegetation: { wald: { upliftWeight: 1, erodibility: 0.5, diffusivity: 1, runoff: 2, channelBias: 2 } },
};
const hill = { layer: "topographie" as const, type: "huegelland", geometry };
const forest = { layer: "vegetation" as const, type: "wald", geometry };

describe("WI-0067: commutative terrain materials", () => {
    it("produces byte-identical fields for every permutation", () => {
        const first = composeMaterials(g, land, [hill, forest], recipes, 0);
        const reversed = composeMaterials(g, land, [forest, hill], recipes, 0);
        expect(reversed).toEqual(first);
        expect(first.erodibility[100]).toBe(0.25);
        expect(first.upliftWeight[100]).toBe(2);
        expect(first.channelBias[100]).toBe(5);
    });

    it("counts overlapping polygons of the same type once", () => {
        expect(composeMaterials(g, land, [hill, hill, forest], recipes, 0)).toEqual(
            composeMaterials(g, land, [hill, forest], recipes, 0),
        );
    });

    it("keeps distance-based influences commutative and deduplicates overlapping type unions", () => {
        const distanceRecipes = structuredClone(recipes);
        Object.assign(distanceRecipes.topographie.huegelland, { influence: { inward: 32, outward: 64 } });
        const partial = {
            ...hill,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [512, 0],
                        [1024, 0],
                        [1024, 1024],
                        [512, 1024],
                        [512, 0],
                    ],
                ],
            },
        };
        const first = composeMaterials(g, land, [partial, forest], distanceRecipes, 0);
        expect(composeMaterials(g, land, [forest, partial, partial], distanceRecipes, 0)).toEqual(first);
        expect(first.upliftWeight[32 * g.n + 30]).toBeGreaterThan(1);
        expect(first.upliftWeight[32 * g.n + 20]).toBe(1);
    });

    it.each([null, "unknown", "constructor", "__proto__"])("keeps unknown type %s neutral", (type) => {
        expect(composeMaterials(g, land, [{ ...hill, type }], recipes, 0)).toEqual(
            composeMaterials(g, land, [], recipes, 0),
        );
    });

    it("smooths membership over land without diluting factors at the sea boundary", () => {
        const coast = new Uint8Array(land.length);
        for (let y = 0; y < g.n; y += 1) {
            for (let x = 32; x < g.n; x += 1) coast[y * g.n + x] = 1;
        }
        const fields = composeMaterials(g, coast, [hill], recipes, 32);
        expect(fields.upliftWeight[32 * g.n + 32]).toBe(2);
        expect(fields.erodibility[32 * g.n + 32]).toBe(0.5);
    });

    it("is byte-identical with smoothing and partial overlapping type coverage", () => {
        const partial = {
            ...hill,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [200, 200],
                        [700, 200],
                        [700, 700],
                        [200, 700],
                        [200, 200],
                    ],
                ],
            },
        };
        const first = composeMaterials(g, land, [partial, forest, hill], recipes, 32);
        expect(composeMaterials(g, land, [hill, forest, partial], recipes, 32)).toEqual(first);
        expect(composeMaterials(g, land, [hill, forest], recipes, 32)).toEqual(first);
    });
});

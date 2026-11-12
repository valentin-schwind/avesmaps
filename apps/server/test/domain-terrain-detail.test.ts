import { describe, expect, it } from "vitest";
import { createLandformSampler, detailHeight } from "../src/terrain/domain/detail.ts";
import { AVENTURIA_TERRAIN_RECIPE as recipe } from "../src/terrain/domain/recipes.ts";
import { composeMaterials } from "../src/terrain/domain/materials.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";

describe("WI-0067: small landforms are part of the initial domain height", () => {
    it("creates many gentle small hills and retains nuances within a broad hill", () => {
        const values = Array.from({ length: 256 }, (_, x) =>
            detailHeight(recipe.generator.detail, 67001, 400 + x / 4, 550, 0.25),
        );
        const peaks = values.filter(
            (h, i) => i > 0 && i < values.length - 1 && h > values[i - 1]! && h > values[i + 1]!,
        );
        expect(peaks.length).toBeGreaterThan(12);
        expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(40);
        expect(Math.max(...values.slice(0, 12)) - Math.min(...values.slice(0, 12))).toBeGreaterThan(5);
        expect(values).toEqual(
            Array.from({ length: 256 }, (_, x) => detailHeight(recipe.generator.detail, 67001, 400 + x / 4, 550, 0.25)),
        );
    });

    it("contributes rounded hills and broadly raised plateaus relative to the surroundings", () => {
        const hills = recipe.topographie.huegelland!.landform!;
        const plateau = recipe.topographie.hochebene!.landform!;
        const sample = (form: typeof hills) => {
            const read = createLandformSampler(form, 67001, 0.25);
            return Array.from({ length: 512 }, (_, x) => read(300 + x / 4, 500));
        };
        const h = sample(hills);
        const p = sample(plateau);
        expect(Math.max(...h)).toBeGreaterThan(hills.maximum * 0.9);
        // Smoothly overlapping caps may exceed one cap's amplitude.
        expect(h.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
        expect(Math.min(...h)).toBeLessThan(Math.max(...h) / 3);
        expect(Math.min(...p)).toBeGreaterThanOrEqual(plateau.minimum);
        expect(Math.max(...p)).toBeLessThanOrEqual(plateau.maximum);
        expect(p.reduce((s, v, i) => s + (i ? Math.abs(v - p[i - 1]!) : 0), 0)).toBeLessThan(
            h.reduce((s, v, i) => s + (i ? Math.abs(v - h[i - 1]!) : 0), 0),
        );
    });

    it("composes duplicate and reordered form polygons only once with smooth membership", () => {
        const g = grid(256);
        const land = new Uint8Array(g.n * g.n).fill(1);
        const geometry = {
            type: "Polygon",
            coordinates: [
                [
                    [300, 300],
                    [700, 300],
                    [700, 700],
                    [300, 700],
                    [300, 300],
                ],
            ],
        };
        const hill = { layer: "topographie" as const, type: "huegelland", geometry };
        const plateau = { ...hill, type: "hochebene" };
        const a = composeMaterials(g, land, [hill, plateau], recipe, 8);
        const b = composeMaterials(g, land, [plateau, hill, hill], recipe, 8);
        expect(a.landforms.length).toBe(2);
        expect(b.landforms).toEqual(a.landforms);
        const weights = a.landforms[0]!.membership;
        expect(weights.some((w) => w > 0 && w < 1)).toBe(true);
        expect(weights[0]).toBe(0);
    });
});

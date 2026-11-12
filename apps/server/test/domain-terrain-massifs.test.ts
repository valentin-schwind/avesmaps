import { describe, expect, it } from "vitest";
import { addMountainFragments } from "../src/terrain/domain/mountain-fragments.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";

describe("mountain initial fragments", () => {
    it("is deterministic, stays in mountains and retains unmodified source arrays", () => {
        const g = { n: 256, cell: 0.25 };
        const base = new Float32Array(g.n * g.n).fill(2000);
        const mask = Uint8Array.from(base, (_, k) => (k % g.n < 128 ? 1 : 0));
        const recipe = AVENTURIA_TERRAIN_RECIPE.mountainMorphology.fragments;
        const a = addMountainFragments(g, base, mask, recipe, 67001);
        const b = addMountainFragments(g, base, mask, recipe, 67001);
        expect(a).toEqual(b);
        expect(base.every((v) => v === 2000)).toBe(true);
        expect(a.some((v) => v > 2100)).toBe(true);
        expect(a.every((v, k) => mask[k] || v === 2000)).toBe(true);
        expect(addMountainFragments(g, base, mask, recipe, 67002)).not.toEqual(a);
    });
});

import { describe, expect, it } from "vitest";
import { renderMountainFragments, type MountainFragments } from "../src/terrain/domain/mountain-fragments.ts";
import { erodeMountainDetails } from "../src/terrain/domain/mountain-detail.ts";
import { AVENTURIA_TERRAIN_RECIPE, parseTerrainRecipe } from "../src/terrain/domain/recipes.ts";

/** WI-0067 Hochgebirge: kantige Grate, facettierte Kleinmassive, weniger Glättung auf Fels. */

const plane = { width: 64, height: 64, cell: 0.25, x0: 0, y0: 0 };

function fragment(ax: number, ay: number, bx: number, by: number, sharpness: number): MountainFragments {
    return {
        count: 1,
        centres: Int32Array.of(0),
        splats: Float64Array.of(ax, ay, 1000, bx, by, 1000, 2, sharpness),
    };
}

function render(fragments: MountainFragments): Float32Array {
    const delta = new Float32Array(64 * 64);
    renderMountainFragments(plane, fragments, delta);
    return delta;
}

describe("alpine crest shapes", () => {
    it("keeps the rounded bell without sharpness and gives a sharp crest a knife edge", () => {
        // Crest along x at y = 8.125 (row 32 centre); look across it at column 32.
        const round = render(fragment(4, 8.125, 12, 8.125, 0));
        const sharp = render(fragment(4, 8.125, 12, 8.125, 1));
        const across = (field: Float32Array, row: number) => field[row * 64 + 32]!;
        expect(across(round, 32)).toBeCloseTo(1000, 3);
        expect(across(round, 33)).toBeCloseTo(1000 * (1 - (0.25 / 2) ** 2) ** 2, 2);
        // The first step down from the crest: almost flat for the bell, steep for the arête.
        expect(across(sharp, 32) - across(sharp, 33)).toBeGreaterThan(3 * (across(round, 32) - across(round, 33)));
        expect(across(sharp, 33)).toBeCloseTo(1000 * (1 - 0.25 / 2), 2);
    });

    it("facets a sharp single massif instead of making a round cone", () => {
        const massif = render(fragment(8.125, 8.125, 8.125, 8.125, 1));
        const ring: number[] = [];
        for (let i = 0; i < 48; i++) {
            const a = (2 * Math.PI * i) / 48;
            const x = Math.round((8.125 + 1.2 * Math.cos(a)) / 0.25 - 0.5),
                y = Math.round((8.125 + 1.2 * Math.sin(a)) / 0.25 - 0.5);
            ring.push(massif[y * 64 + x]!);
        }
        expect(massif[32 * 64 + 32]).toBeCloseTo(1000, 3);
        expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(150);
    });
});

describe("alpine refinement", () => {
    it("lets bare rock keep its crest: no creep where the alpine weight is full and its diffusion 0", () => {
        const recipe = structuredClone(AVENTURIA_TERRAIN_RECIPE.mountainMorphology.interior);
        Object.assign(recipe, { iterations: 1, streamPowerK: 1e-9, maximumGrade: 1, relaxationSteps: 1 });
        Object.assign(recipe.alpine, { diffusion: 0, maximumGrade: 2 });
        const p = { width: 32, height: 32, cell: 0.25, x0: 0, y0: 0 };
        const crest = (k: number) => 3000 - 400 * Math.abs((k % 32) - 16);
        const run = (alpine: boolean) => {
            const height = Float32Array.from({ length: 32 * 32 }, (_, k) => crest(k));
            const weight = new Float32Array(height.length);
            for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) weight[y * 32 + x] = 1;
            erodeMountainDetails(
                {
                    plane: p,
                    height,
                    weight,
                    locked: new Uint8Array(height.length),
                    classes: new Uint8Array(height.length),
                    ...(alpine
                        ? { alpine: { weight: new Float32Array(height.length).fill(1), grade: 2, summits: [] } }
                        : {}),
                },
                recipe,
                67001,
                AVENTURIA_TERRAIN_RECIPE.generator,
            );
            return height[16 * 32 + 16]!;
        };
        expect(run(true)).toBeGreaterThan(run(false) + 20);
        expect(Math.abs(run(true) - 3000)).toBeLessThan(5);
    });

    it("rejects a reversed alpine height range", () => {
        const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        value.mountainMorphology.interior.alpine.to = value.mountainMorphology.interior.alpine.from;
        expect(() => parseTerrainRecipe(value)).toThrow(/alpine/);
    });
});

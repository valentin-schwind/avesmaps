import { describe, expect, it } from "vitest";
import { createHillField, hillCap } from "../src/terrain/domain/hills.ts";
import { hillFacing } from "../src/terrain/domain/hill-facing.ts";
import { composeMaterials } from "../src/terrain/domain/materials.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";

describe("flanking foothills", () => {
    it("makes a cap steeper toward its mountain without making a ridge or moving its summit", () => {
        const cap = { x: 0, y: 0, radius: 4, height: 300, facing: { dx: 1, dy: 0, amount: 0.4 } };
        expect(hillCap(cap, 0, 0)).toBe(300);
        expect(hillCap(cap, 2, 0)).toBeLessThan(hillCap(cap, -2, 0));
        expect(hillCap(cap, 4, 0)).toBe(0);
        expect(hillCap(cap, -4.5, 0)).toBeGreaterThan(0);
        expect(hillCap(cap, -6, 0)).toBe(0);
    });
    it("blends primary erosion without double-counting mountain overlaps or vegetation", () => {
        const g = grid(256),
            land = new Uint8Array(g.n * g.n).fill(1);
        const box = (x: number) => ({
            type: "Polygon",
            coordinates: [
                [
                    [x, 0],
                    [1024, 0],
                    [1024, 1024],
                    [x, 1024],
                    [x, 0],
                ],
            ],
        });
        const mountain = { layer: "topographie" as const, type: "gebirge", geometry: box(512) };
        const hill = { layer: "topographie" as const, type: "huegelland", geometry: box(0) };
        const forest = { layer: "vegetation" as const, type: "wald", geometry: box(0) };
        const recipe = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        const a = composeMaterials(g, land, [mountain, hill], recipe, 0);
        const b = composeMaterials(g, land, [forest, hill, mountain, mountain], recipe, 0);
        const at = (x: number) => 128 * g.n + x;
        expect(a.erodibility[at(140)]).toBeCloseTo(recipe.topographie.gebirge!.erodibility);
        expect(a.erodibility[at(100)]).toBeCloseTo(recipe.topographie.huegelland!.erodibility);
        expect(a.erodibility[at(124)]).toBeLessThan(a.erodibility[at(126)]!);
        expect(a.erodibility[at(124)]).toBeLessThan(a.erodibility[at(100)]!);
        expect(b.erodibility[at(124)]).toBeCloseTo(a.erodibility[at(124)]! * recipe.vegetation.wald!.erodibility);
        expect(composeMaterials(g, land, [hill, mountain, forest], recipe, 0)).toEqual(b);
        const facing = hillFacing(a, 498, 512)!;
        expect(facing.dx).toBeCloseTo(1);
        expect(facing.dy).toBeCloseTo(0);
        expect(facing.amount).toBeGreaterThan(0);
        expect(hillFacing(a, 300, 512)).toBeUndefined();
    });
    it("keeps hill centres and finds all expanded outer flanks across search buckets", () => {
        const recipe = AVENTURIA_TERRAIN_RECIPE.topographie.huegelland!.landform!;
        const radial = createHillField(recipe, 73, 32);
        const directed = createHillField(recipe, 73, 32, () => ({ dx: 1, dy: 0, amount: 0.4 }));
        expect(directed.centres.map(({ x, y, height, radius }) => ({ x, y, height, radius }))).toEqual(radial.centres);
        for (let y = 0; y < 32; y += 4) {
            for (let x = 0; x < 32; x += 4) {
                const sum = directed.centres.reduce(
                    (value, cap) => value + hillCap(cap, x, y) ** recipe.hills!.overlapPower,
                    0,
                );
                expect(directed.sample(x, y)).toBeCloseTo(sum ** (1 / recipe.hills!.overlapPower), 8);
            }
        }
    });
});

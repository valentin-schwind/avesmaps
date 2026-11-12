import { describe, expect, it } from "vitest";
import { terrainRecipeCoverage } from "../src/terrain/domain/coverage.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";

describe("terrain recipe inventory", () => {
    it("reports missing and unused types, counts duplicates and identifies hard water constraints", () => {
        const areas = [
            { layer: "topographie" as const, type: "gebirge" },
            { layer: "topographie" as const, type: "gebirge" },
            { layer: "topographie" as const, type: "meer" },
            { layer: "topographie" as const, type: "see" },
            { layer: "topographie" as const, type: null },
            { layer: "vegetation" as const, type: "constructor" },
        ];
        const report = terrainRecipeCoverage(areas, AVENTURIA_TERRAIN_RECIPE);
        expect(report.active).toContainEqual({ layer: "topographie", type: "gebirge", count: 2, handling: "recipe" });
        expect(report.active).toContainEqual({
            layer: "topographie",
            type: "meer",
            count: 1,
            handling: "water-constraint",
        });
        expect(report.missing).toEqual([
            { layer: "topographie", type: null, count: 1, handling: "neutral-unmapped" },
            { layer: "vegetation", type: "constructor", count: 1, handling: "neutral-unmapped" },
        ]);
        expect(report.unused).toContain("topographie/schlucht");
        expect(report.unused).not.toContain("topographie/gebirge");
        expect(terrainRecipeCoverage([...areas].reverse(), AVENTURIA_TERRAIN_RECIPE)).toEqual(report);
    });
});

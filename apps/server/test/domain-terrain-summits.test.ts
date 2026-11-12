import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { SCHRITT_PER_UNIT } from "../src/terrain/hydrology/grid.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { projectSummits } from "../src/terrain/domain/summits.ts";
import { raiseToSummit, restoreShare, summitCap, summitFor, summitHeight } from "../src/terrain/domain/summit-shape.ts";

/** WI-0067 Gipfelregel: one rule for every mountain summit, one for every volcano, drawn per seed and position. */

const INTERIOR = AVENTURIA_TERRAIN_RECIPE.mountainMorphology.interior;
const SEED = 67001;
const N = 64;
const CELL = 0.25;

function flat(height: number): StoredRaster {
    return {
        width: N,
        height: N,
        cell: CELL,
        originX: CELL / 2,
        originY: CELL / 2,
        samples: new Uint16Array(N * N).fill(height),
    };
}
const at = (r: StoredRaster, i: number, j: number) => r.samples[j * N + i]!;

describe("summit rule", () => {
    it("draws every value within the recipe ranges, deterministically per seed and position", () => {
        const ridges = new Set<number>();
        const grades = new Set<number>();
        for (let i = 0; i < 40; i++) {
            const summit = summitFor(INTERIOR, SEED, 100 + i * 7.3, 200 + i * 3.1, 3000);
            expect(summitFor(INTERIOR, SEED, 100 + i * 7.3, 200 + i * 3.1, 3000)).toEqual(summit);
            const shape = summit.natural!;
            const { summit: rule } = INTERIOR.alpine;
            expect(shape.ridges).toBeGreaterThanOrEqual(rule.ridges.minimum);
            expect(shape.ridges).toBeLessThanOrEqual(rule.ridges.maximum);
            const grade = 3000 / (shape.radius * SCHRITT_PER_UNIT);
            expect(grade).toBeGreaterThanOrEqual(rule.grade.minimum - 1e-9);
            expect(grade).toBeLessThanOrEqual(rule.grade.maximum + 1e-9);
            expect(summit.restore.full).toBeLessThan(summit.restore.none);
            ridges.add(shape.ridges);
            grades.add(Math.round(grade * 100));
        }
        expect(ridges.size).toBeGreaterThan(2);
        expect(grades.size).toBeGreaterThan(10);
        expect(summitFor(INTERIOR, SEED + 1, 100, 200, 3000)).not.toEqual(summitFor(INTERIOR, SEED, 100, 200, 3000));
    });

    it("makes a mountain highest at its summit, irregular around it and gone beyond its reach", () => {
        const summit = summitFor(INTERIOR, SEED, 500, 500, 5000);
        expect(summitHeight(summit, 500, 500)).toBeCloseTo(5000, 6);
        const radius = summit.natural!.radius;
        const ring = Array.from({ length: 72 }, (_, i) =>
            summitHeight(summit, 500 + 0.5 * radius * Math.cos(i / 11.46), 500 + 0.5 * radius * Math.sin(i / 11.46)),
        );
        expect(Math.max(...ring)).toBeLessThan(5000);
        expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(300);
        expect(summitHeight(summit, 500 + summit.reach + 0.01, 500)).toBe(0);
    });

    it("gives every volcano a flat top at its height and a round cone below it", () => {
        const volcano = summitFor(INTERIOR, SEED, 500, 500, 5000, true);
        const { plateau, grade } = volcano.volcano!;
        expect(summitHeight(volcano, 500 + plateau * 0.9, 500)).toBe(5000);
        const d = plateau + 0.5;
        const around = [0, 1, 2, 3].map((q) =>
            summitHeight(volcano, 500 + d * Math.cos(q * 1.3), 500 + d * Math.sin(q * 1.3)),
        );
        for (const h of around) expect(h).toBeCloseTo(5000 - grade * 0.5 * SCHRITT_PER_UNIT, 6);
        expect(restoreShare(volcano, 100)).toBe(1);
    });

    it("restores a mountain from the top and fades out towards the foot", () => {
        const summit = summitFor(INTERIOR, SEED, 500, 500, 5000);
        const { full, none } = summit.restore;
        expect(restoreShare(summit, 5000 * (1 - full / 2))).toBe(1);
        expect(restoreShare(summit, 5000 * (1 - (full + none) / 2))).toBeGreaterThan(0);
        expect(restoreShare(summit, 5000 * (1 - (full + none) / 2))).toBeLessThan(1);
        expect(restoreShare(summit, 5000 * (1 - none) - 1)).toBe(0);
    });

    it("raises towards the shape within its reach, fading out, and never lowers", () => {
        const summit = summitFor(INTERIOR, SEED, 500, 500, 4000);
        expect(raiseToSummit(summit, 500.1, 500, 100)).toBeGreaterThan(3000);
        expect(raiseToSummit(summit, 500 + summit.reach + 0.1, 500, 100)).toBe(100);
        expect(raiseToSummit(summit, 500.5, 500, 3990)).toBeGreaterThanOrEqual(3990);
    });

    it("keeps every lower core a local maximum on a higher summit's flank", () => {
        const high = summitFor(INTERIOR, SEED, 500, 500, 5000);
        const low = summitFor(INTERIOR, SEED, 501, 500, 2000);
        expect(summitCap([high, low], 501, 500)).toBe(2000);
        expect(summitCap([high, low], 501.25, 500)).toBeCloseTo(2000 + 0.25 * SCHRITT_PER_UNIT, 6);
    });
});

describe("final summit projection", () => {
    it("sets the four sampling cells of every known summit exactly and nothing else", () => {
        const raster = flat(1000);
        const report = projectSummits(raster, [
            { id: "s", name: "Summit", x: 8.05, y: 8.05, h: 3000 },
            { id: "n", name: "Nameless", x: 12.05, y: 8.05, h: null },
        ]);
        for (const [i, j] of [
            [31, 31],
            [32, 31],
            [31, 32],
            [32, 32],
        ])
            expect(at(raster, i!, j!)).toBe(3000);
        expect(report.exactCells).toBe(4);
        expect(at(raster, 33, 31)).toBe(1000);
        expect(at(raster, 47, 31)).toBe(1000);
    });
});

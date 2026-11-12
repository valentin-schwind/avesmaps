import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { domainSummits, restoreSummits, seedPeaks } from "../src/terrain/domain/peak-seed.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { summitHeight } from "../src/terrain/domain/summit-shape.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";

/** WI-0067 Gipfelregel: every summit by the same rule, seeded before erosion and restored after the river burn. */

const INTERIOR = AVENTURIA_TERRAIN_RECIPE.mountainMorphology.interior;
const g = grid(2048);
const peak = { id: "peak", name: "Peak", x: 512, y: 512, h: 5000 };
const land = new Uint8Array(g.n * g.n).fill(1);
const mountain = {
    layer: "topographie" as const,
    type: "gebirge",
    geometry: {
        type: "Polygon" as const,
        coordinates: [
            [
                [400, 400],
                [600, 400],
                [600, 600],
                [400, 600],
                [400, 400],
            ],
        ],
    },
};

describe("summits by one rule", () => {
    it("shapes a mountain peak exactly like a free one; only a free peak without a height takes 1.000", () => {
        const inside = domainSummits([peak], [mountain], INTERIOR, 67001);
        expect(inside).toEqual(domainSummits([peak], [], INTERIOR, 67001));
        const nameless = { ...peak, h: null };
        expect(domainSummits([nameless], [mountain], INTERIOR, 67001)).toEqual([]);
        expect(domainSummits([nameless], [], INTERIOR, 67001)[0]!.height).toBe(1000);
    });

    it("seeds a reproducible, non-circular shape and never lowers", () => {
        const summits = domainSummits([peak], [], INTERIOR, 67001);
        const height = new Float32Array(land.length).fill(300);
        seedPeaks(g, land, height, summits);
        // Four cells about 1.4 E from the summit (cell 0.5 E): a round dome would be equal on all of them.
        const ring = [
            height[1022 * 2048 + 1022]!,
            height[1022 * 2048 + 1026]!,
            height[1026 * 2048 + 1022]!,
            height[1026 * 2048 + 1026]!,
        ];
        expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(100);
        const repeat = new Float32Array(land.length).fill(300);
        seedPeaks(g, land, repeat, summits);
        expect(Buffer.compare(Buffer.from(repeat.buffer), Buffer.from(height.buffer))).toBe(0);
        expect(height[0]).toBe(300);
        expect(height.every((h) => h >= 300)).toBe(true);
    });
});

describe("restoring summits after the river burn", () => {
    const N = 256,
        CELL = 0.25;
    const raster = (h: number): StoredRaster => ({
        width: N,
        height: N,
        cell: CELL,
        originX: CELL / 2,
        originY: CELL / 2,
        samples: new Uint16Array(N * N).fill(h),
    });
    const centre = { id: "c", name: "Centre", x: 32.05, y: 32.05, h: 4000 };

    it("raises a worn summit back from the top, never lowers, never the core, the sea or a guarded cell", () => {
        const r = raster(500);
        const i0 = Math.floor((centre.x - CELL / 2) / CELL),
            j0 = Math.floor((centre.y - CELL / 2) / CELL);
        r.samples[(j0 + 3) * N + i0] = 0; // sea
        const allowed = new Uint8Array(N * N).fill(1);
        allowed[(N - 1 - (j0 - 3)) * N + i0] = 0; // river corridor, grid orientation
        const summits = domainSummits([centre], [], INTERIOR, 67001);
        expect(restoreSummits(r, summits, allowed)).toBeGreaterThan(0);
        expect(r.samples[j0 * N + i0]).toBe(500);
        expect(r.samples[(j0 + 3) * N + i0]).toBe(0);
        expect(r.samples[(j0 - 3) * N + i0]).toBe(500);
        expect(Math.max(...r.samples)).toBeGreaterThan(3000);
        expect(Math.min(...r.samples.filter((h) => h > 0))).toBe(500);
        // Near the summit the shape is fully back; the far foot keeps the eroded ground.
        const summit = summits[0]!;
        const near = r.samples[(j0 + 1) * N + i0 + 3]!;
        expect(near).toBeGreaterThan(summitHeight(summit, centre.x + 0.75, centre.y + 0.25) - 400);
        const foot = Math.round((summit.reach * 0.98) / CELL);
        expect(r.samples[j0 * N + i0 + foot]).toBeLessThan(1000);
    });

    it("keeps the summit the highest cell of its surroundings with `dominance` (WI-0249 P2); without it ridges rise above it", () => {
        // Eroded ground with sharp spurs next to the core: the restore adds `detail` × relief on top of the shape.
        const eroded = (): StoredRaster => {
            const r = raster(500);
            for (let j = 0; j < N; j++)
                for (let i = 0; i < N; i++)
                    if ((i + j) % 4 === 0) r.samples[j * N + i] = Math.round(3600 + 200 * Math.cos(i / 3));
            return r;
        };
        const summits = domainSummits([centre], [], INTERIOR, 67001);
        const hoechste = (r: StoredRaster) => {
            let max = 0;
            const i0 = Math.floor((centre.x - CELL / 2) / CELL),
                j0 = Math.floor((centre.y - CELL / 2) / CELL);
            for (let j = j0 - 8; j <= j0 + 9; j++)
                for (let i = i0 - 8; i <= i0 + 9; i++)
                    if (!((j === j0 || j === j0 + 1) && (i === i0 || i === i0 + 1)))
                        max = Math.max(max, r.samples[j * N + i]!);
            return max;
        };
        const alt = eroded();
        restoreSummits(alt, summits);
        expect(hoechste(alt)).toBeGreaterThan(centre.h);
        const neu = eroded();
        restoreSummits(neu, summits, undefined, 0.1);
        // Raised cells stay below the summit; untouched ground (here at most 3.800) keeps what erosion left.
        expect(hoechste(neu)).toBeLessThan(centre.h);
        expect(restoreSummits(eroded(), summits, undefined, 0.1)).toBeGreaterThan(0);
    });

    it("restores a volcano's whole cone", () => {
        const r = raster(500);
        const volcano = domainSummits([{ ...centre, volcano: true }], [], INTERIOR, 67001);
        restoreSummits(r, volcano);
        const cone = volcano[0]!;
        const d = cone.volcano!.plateau + 1.5;
        const i = Math.floor((centre.x + d - CELL / 2) / CELL),
            j = Math.floor((centre.y - CELL / 2) / CELL);
        expect(r.samples[j * N + i]).toBeGreaterThan(summitHeight(cone, centre.x + d, centre.y) - 300);
    });
});

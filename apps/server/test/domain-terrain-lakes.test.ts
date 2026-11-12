import { describe, expect, it } from "vitest";
import { flattenDomainLakes } from "../src/terrain/domain/lakes.ts";
import { lakeBodies } from "../src/terrain/domain/lake-bodies.ts";
import { domainWaterClasses } from "../src/terrain/domain/constraints.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { WaterArea } from "../src/terrain/hydrology/water.ts";

const lake = (left: number, right: number): WaterArea => ({
    kind: "see",
    geometry: {
        type: "Polygon",
        coordinates: [
            [
                [left, 0],
                [right, 0],
                [right, 1024],
                [left, 1024],
                [left, 0],
            ],
        ],
    },
});
const raster = (): StoredRaster => ({
    cell: 16,
    originX: 8,
    originY: 8,
    width: 64,
    height: 64,
    samples: new Uint16Array(4096).fill(300),
});
describe("Domain lake constraint repair", () => {
    it("levels overlapping lakes to the level most of their cells have, independent of source order, and is idempotent", () => {
        const a = raster();
        const b = raster();
        // Lowered cells of a river valley: a minority of the lake. They do not pull the whole lake down.
        for (const r of [a, b]) for (const k of [42, 43, 106, 107]) r.samples[k] = 80;
        const water = [lake(256, 640), lake(512, 768)];
        expect(flattenDomainLakes(a, water, []).changedCells).toBe(4);
        flattenDomainLakes(b, water.toReversed(), []);
        expect(a.samples).toEqual(b.samples);
        for (let x = 16; x < 48; x += 1) expect(a.samples[x]).toBe(300);
        expect(flattenDomainLakes(a, water, []).changedCells).toBe(0);
    });
    it("never changes a protected peak sampling core", () => {
        const a = raster();
        for (let j = 0; j < 64; j += 1) for (let i = 16; i < 48; i += 1) a.samples[j * 64 + i] = 80;
        for (const dx of [0, 1]) for (const dy of [0, 1]) a.samples[(32 + dy) * 64 + 32 + dx] = 300;
        flattenDomainLakes(a, [lake(256, 768)], [{ x: 520, y: 520 }]);
        for (const dx of [0, 1]) for (const dy of [0, 1]) expect(a.samples[(32 + dy) * 64 + 32 + dx]).toBe(300);
        expect(a.samples[35]).toBe(80);
    });
    it("treats every part of a multi-part area as its own lake with its own level", () => {
        const water: WaterArea[] = [
            {
                kind: "see",
                geometry: {
                    type: "MultiPolygon",
                    coordinates: [
                        [
                            [
                                [64, 64],
                                [192, 64],
                                [192, 192],
                                [64, 192],
                                [64, 64],
                            ],
                        ],
                        [
                            [
                                [640, 640],
                                [768, 640],
                                [768, 768],
                                [640, 768],
                                [640, 640],
                            ],
                        ],
                    ],
                },
            },
        ];
        const g = grid(64);
        const bodies = lakeBodies(g, water, domainWaterClasses(g, water, [], []));
        expect(bodies.map((body) => [body.area, body.part])).toEqual([
            [0, 0],
            [0, 1],
        ]);
        const a = raster();
        // 64 cells of 16 E: columns 4..11 / rows 4..11 hold the first part, rows 40..47 the second (row 0 south).
        for (let j = 4; j < 12; j += 1) for (let i = 4; i < 12; i += 1) a.samples[j * 64 + i] = 120;
        for (let j = 40; j < 48; j += 1) for (let i = 40; i < 48; i += 1) a.samples[j * 64 + i] = 700;
        expect(flattenDomainLakes(a, water, []).changedCells).toBe(0);
        expect(a.samples[5 * 64 + 5]).toBe(120);
        expect(a.samples[41 * 64 + 41]).toBe(700);
    });
    it("keeps lakes that only touch apart: they share no cell, so they stay two lakes", () => {
        const water = [lake(0, 512), lake(512, 1024)];
        const g = grid(64);
        expect(lakeBodies(g, water, domainWaterClasses(g, water, [], [])).length).toBe(2);
        const a = raster();
        for (let j = 0; j < 64; j += 1) for (let i = 0; i < 32; i += 1) a.samples[j * 64 + i] = 100;
        expect(flattenDomainLakes(a, water, []).changedCells).toBe(0);
    });
});

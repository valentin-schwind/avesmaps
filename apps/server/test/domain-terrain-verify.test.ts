import { describe, expect, it } from "vitest";
import { verifyDomainRaster } from "../src/terrain/domain/verify.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";

const rectangle = (x0: number, x1: number) => ({
    type: "Polygon",
    coordinates: [
        [
            [x0, 0],
            [x1, 0],
            [x1, 1024],
            [x0, 1024],
            [x0, 0],
        ],
    ],
});
function fixture(): { input: DomainInputs; raster: StoredRaster } {
    const continent = rectangle(256, 1024);
    const samples = new Uint16Array(64 * 64);
    for (let y = 0; y < 64; y += 1) for (let x = 16; x < 64; x += 1) samples[y * 64 + x] = 80;
    return {
        input: {
            continent: { id: "continent", fingerprint: "fixture", geometry: continent },
            land: [continent],
            water: [
                { kind: "meer", geometry: rectangle(0, 256) },
                { kind: "see", geometry: rectangle(512, 640) },
            ],
            landscapes: [],
            seeds: [],
            peaks: [],
            rivers: { rivers: [], lakes: [], fingerprint: "fixture" },
            fingerprint: "fixture",
        },
        raster: { cell: 16, originX: 8, originY: 8, width: 64, height: 64, samples },
    };
}
describe("WI-0067 independent final raster constraints", () => {
    it("accepts exact sea and flat lakes", () => {
        const { input, raster } = fixture();
        expect(verifyDomainRaster(raster, input).errors).toEqual([]);
    });
    it("detects a sea cell raised after generation", () => {
        const { input, raster } = fixture();
        raster.samples[4] = 1;
        expect(verifyDomainRaster(raster, input).errors).toContain("sea:1");
    });
    it("detects a non-flat lake after river burn", () => {
        const { input, raster } = fixture();
        raster.samples[32] = 79;
        expect(verifyDomainRaster(raster, input).errors.some((error) => error.startsWith("lake:"))).toBe(true);
    });
    it("checks all four absolute peak sampling cells", () => {
        const { input, raster } = fixture();
        input.peaks = [{ id: "peak", name: "peak", x: 808, y: 808, h: 1200 }];
        expect(verifyDomainRaster(raster, input).errors).toContain("peak:peak");
        for (const dx of [0, 1]) for (const dy of [0, 1]) raster.samples[(50 + dy) * 64 + 50 + dx] = 1200;
        expect(verifyDomainRaster(raster, input).errors).toEqual([]);
    });
    it("rejects a formerly ignored sea peak that now has land", () => {
        const { input, raster } = fixture();
        const peak = { id: "corrected-peak", name: "corrected peak", x: 808, y: 808, h: 1200 };
        input.peaks = [peak];
        const result = verifyDomainRaster(raster, input, [peak]);
        expect(result.errors).toContain("ignored-peak:corrected-peak");
        expect(result.errors).toContain("peak:corrected-peak");
    });
});

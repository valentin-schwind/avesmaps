import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMountainRaster, rasterSamples } from "@avesmaps3d/shared";
import { FIXTURE_FLACH, FIXTURE_GRAT, FIXTURE_MITTELACHSE } from "../../../scripts/dev/terrain-oracle/v12-fixtures.ts";

/**
 * Die Übertragung von Legacys Gebirgsrechnung V12 (WI-0049 S3) an drei erfundenen Gebirgen.
 *
 * Die erwarteten Prüfsummen hat Legacys eigenes Modul gerechnet, geladen aus dem Discovery-Mirror
 * (`avesmaps@aff0449a5`), am 2026-09-27 mit `node scripts/dev/terrain-oracle/fixture-hashes.mjs`.
 * Dasselbe Skript bestätigte `h` bitgleich. Der Test selbst braucht weder Mirror noch Datenbank.
 * Die Parität an allen Gebirgen des Snapshots prüft `scripts/dev/terrain-oracle/compare-v12.mjs`.
 */

function sha256(samples: Uint16Array): string {
    return createHash("sha256")
        .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
        .digest("hex");
}

describe("V12 bitgenau wie Legacy", () => {
    it("rechnet ein Gebirge mit Gipfeln, Bach, See und gesetzten Reglern wie Legacy", () => {
        const raster = buildMountainRaster(FIXTURE_GRAT);
        expect([raster.w, raster.hh, raster.cell, raster.leer]).toEqual([79, 60, 0.25, false]);
        expect(sha256(rasterSamples(raster))).toBe("afbfbcb201157468c44f11494429e5d670a52cc1acbdd5849b8558c9415a2fcc");
    });

    it("legt ohne Gipfel den Kamm auf die Mittelachse wie Legacy", () => {
        const raster = buildMountainRaster(FIXTURE_MITTELACHSE);
        expect([raster.w, raster.hh, raster.leer]).toEqual([81, 49, false]);
        expect(sha256(rasterSamples(raster))).toBe("6d21be1f36ba8b0e83a0340c95af215d688c4cc9eb80741601aa6e9e153a3196");
    });

    it("lässt eine Fläche ohne Gipfel und ohne Maximalhöhe flach und leer", () => {
        const raster = buildMountainRaster(FIXTURE_FLACH);
        expect(raster.leer).toBe(true);
        expect(rasterSamples(raster).every((value) => value === 0)).toBe(true);
        expect(sha256(rasterSamples(raster))).toBe("c3d47046a6fddad2cce4e490b3ed539138dcbb6c50bf4d3e31e121fe892be03d");
    });
});

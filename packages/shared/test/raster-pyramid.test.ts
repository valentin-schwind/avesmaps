import { describe, expect, it } from "vitest";
import { parseRasterPointer, rasterPointerUrl, rasterTileTemplate } from "../src/index.ts";

const pointer = {
    schemaVersion: 1,
    series: "original",
    revision: "3f2a9c01be47",
    manifest: "3f2a9c01be475d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c",
    format: "webp",
    tileSize: 512,
    maxNativeZoom: 6,
};

describe("Rasterzeiger (ADR-0008)", () => {
    it("führt zur Kachelvorlage der Revision", () => {
        const parsed = parseRasterPointer(pointer, "original");
        expect(rasterPointerUrl("original")).toBe("/tiles/raster/original/current.json");
        expect(rasterTileTemplate(parsed)).toBe("/tiles/raster/original/3f2a9c01be47/{z}/{x}/{y}.webp");
    });

    it("🪤 nimmt keinen Zeiger einer anderen Serie an", () => {
        expect(() => parseRasterPointer(pointer, "modern")).toThrow(/gehört zur Serie original/);
    });

    it("🪤 nimmt keinen Zeiger, dessen Revision nicht zu seinem Manifest passt", () => {
        expect(() => parseRasterPointer({ ...pointer, revision: "000000000000" }, "original")).toThrow(
            /sein Manifest aber nicht/,
        );
    });

    it.each([
        ["Revision zu kurz", { ...pointer, revision: "3f2a9c01be4" }],
        ["Revision in Großbuchstaben", { ...pointer, revision: "3F2A9C01BE47" }],
        ["Revision als Pfad", { ...pointer, revision: "../../etc/xx" }],
        ["PNG", { ...pointer, format: "png" }],
        ["zusätzliches Feld", { ...pointer, builtAt: "2026-09-23" }],
        ["ohne Manifest", { ...pointer, manifest: undefined }],
        ["kein Objekt", "<!doctype html>"],
    ])("verwirft %s", (_, candidate) => {
        expect(() => parseRasterPointer(candidate, "original")).toThrow(/ungültiger Rasterzeiger/);
    });
});

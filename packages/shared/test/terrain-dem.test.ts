import { describe, expect, it } from "vitest";
import {
    changedTerrainTiles,
    parseTerrainPointer,
    TERRAIN_POINTER_URL,
    terrainTileKey,
    terrainTileTemplate,
    terrainTileUrl,
    type TerrainDemPointer,
} from "../src/index.ts";

/** Derselbe Zeiger ohne Manifest (ein Server vor WI-0125). */
function withoutTiles(pointer: TerrainDemPointer): TerrainDemPointer {
    const copy = { ...pointer };
    delete copy.tiles;
    return copy;
}

const pointer = { schemaVersion: 1, revision: "3b0c38980fef", tileSize: 512, maxNativeZoom: 3, encoding: "mapbox" };

describe("Geländezeiger (WI-0049, ADR-0008)", () => {
    it("führt zur Kachelvorlage der Revision", () => {
        expect(TERRAIN_POINTER_URL).toBe("/tiles/terrain/dem/current.json");
        expect(terrainTileTemplate(parseTerrainPointer(pointer))).toBe(
            "/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.png",
        );
    });

    it("🔴 ein Zeiger ohne Format meint PNG (Zeiger von vor WI-0073), mit Format führt er zur passenden Endung", () => {
        expect(terrainTileTemplate(parseTerrainPointer({ ...pointer, format: "png" }))).toBe(
            "/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.png",
        );
        expect(terrainTileTemplate(parseTerrainPointer({ ...pointer, format: "webp" }))).toBe(
            "/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.webp",
        );
        expect(parseTerrainPointer({ ...pointer, format: "webp" }).format).toBe("webp");
    });

    it("🔴 mit Manifest liegt jede Kachel unter ihrer eigenen Revision, ohne Eintrag unter der Pyramidenrevision (WI-0125)", () => {
        const withTiles = parseTerrainPointer({
            ...pointer,
            format: "webp",
            tiles: { "0/0/0": "0123456789abcdef", "1/1/0": "fedcba9876543210" },
        });
        expect(terrainTileUrl(withTiles, { z: 1, x: 1, y: 0 })).toBe(
            "/tiles/terrain/dem/k/fedcba9876543210/1/1/0.webp",
        );
        expect(terrainTileUrl(withTiles, { z: 1, x: 0, y: 0 })).toBe("/tiles/terrain/dem/3b0c38980fef/1/0/0.webp");
        expect(terrainTileKey({ z: 4, x: 15, y: 3 })).toBe("4/15/3");
    });

    it("🔴 geändert sind genau die Kacheln, deren Adresse sich ändert (WI-0125)", () => {
        const before = parseTerrainPointer({
            ...pointer,
            maxNativeZoom: 1,
            format: "webp",
            tiles: {
                "0/0/0": "0000000000000000",
                "1/0/0": "1000000000000000",
                "1/1/0": "1100000000000000",
                "1/0/1": "1010000000000000",
                "1/1/1": "1110000000000000",
            },
        });
        const after = parseTerrainPointer({
            ...before,
            revision: "aaaaaaaaaaaa",
            tiles: { ...before.tiles, "0/0/0": "0000000000000001", "1/1/0": "1100000000000001" },
        });
        expect(changedTerrainTiles(before, after)).toEqual({
            all: false,
            tiles: [
                { z: 0, x: 0, y: 0 },
                { z: 1, x: 1, y: 0 },
            ],
        });
        expect(changedTerrainTiles(after, after)).toEqual({ all: false, tiles: [] });
        // Ohne Manifest auf einer Seite: jede Kachel, sobald die Revision der Pyramide eine andere ist.
        const plain = withoutTiles(after);
        expect(changedTerrainTiles(before, plain)).toEqual({ all: true, tiles: [] });
        expect(changedTerrainTiles(plain, plain)).toEqual({ all: false, tiles: [] });
    });

    it.each([
        ["Kachelrevision zu kurz", { ...pointer, tiles: { "0/0/0": "0123456789abcde" } }],
        ["Kachelrevision als Pfad", { ...pointer, tiles: { "0/0/0": "../../../etc/pwd" } }],
        ["Kachelschlüssel ohne Stufe", { ...pointer, tiles: { "0/0": "0123456789abcdef" } }],
        ["unbekanntes Format", { ...pointer, format: "jpeg" }],
        ["verlustbehaftetes Format ohne Namen im Vertrag", { ...pointer, format: "webp-lossy" }],
        ["Revision zu kurz", { ...pointer, revision: "3b0c38980fe" }],
        ["Revision als Pfad", { ...pointer, revision: "../../etc/xx" }],
        ["andere Kodierung", { ...pointer, encoding: "terrarium" }],
        ["zusätzliches Feld", { ...pointer, series: "original" }],
        ["ohne Kachelgröße", { ...pointer, tileSize: undefined }],
        ["kein Objekt", "<!doctype html>"],
    ])("verwirft %s", (_, candidate) => {
        expect(() => parseTerrainPointer(candidate)).toThrow(/ungültiger Geländezeiger/);
    });
});

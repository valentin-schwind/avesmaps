import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRasterPointer } from "../src/map/basemap.ts";
import { loadDisplayHeightPointer } from "../src/map/terrain/display-height-pointer.ts";
import { loadTerrainPointer } from "../src/map/terrain/terrain-pointer.ts";
import { loadTerritoryPointer } from "../src/map/territory-pointer.ts";

/**
 * 🔴 Der Client liest Zeiger tolerant, der Server prüft sie streng (WI-0075 R5b, Rollout-Antwort E3).
 *
 * Anlass: Das neue Feld `format` der Höhenkacheln (WI-0073) machte einen noch geladenen Client blind, weil sein Schema
 * kein unbekanntes Feld duldete und der Zeiger als ungültig galt - die Karte blieb flach. Blue/Green lässt alte Tabs
 * neben einem neuen Server leben; deshalb liest die Karte, was sie kennt, und ignoriert den Rest. Die Prüfung des
 * Servers (`parse*Pointer`, `additionalProperties: false`) bleibt streng und ist in `packages/shared` getestet.
 */

const answer =
    (body: unknown): typeof fetch =>
    () =>
        Promise.resolve(
            new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
        );

const TERRAIN = { schemaVersion: 1, revision: "3b0c38980fef", tileSize: 512, maxNativeZoom: 3, encoding: "mapbox" };
const DISPLAY_HEIGHT = { schemaVersion: 1, revision: "28c982f14ab2", demRevision: "7a7dbe454996" };
const TERRITORY = { schemaVersion: 1, revision: "abcdef012345", displayYearBf: 1049 };
const RASTER = {
    schemaVersion: 1,
    series: "original",
    revision: "3f2a9c01be47",
    manifest: "3f2a9c01be475d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c",
    format: "webp",
    tileSize: 512,
    maxNativeZoom: 6,
};

describe("🔴 die vier Leser ignorieren ein neues Feld des Servers", () => {
    const newer = { neuesFeld: "kommt mit einem späteren Release" };

    it("Gelände", async () => {
        await expect(loadTerrainPointer(answer({ ...TERRAIN, ...newer }))).resolves.toEqual(TERRAIN);
    });

    it("Anzeigehöhen", async () => {
        await expect(loadDisplayHeightPointer(answer({ ...DISPLAY_HEIGHT, ...newer }))).resolves.toEqual(
            DISPLAY_HEIGHT,
        );
    });

    it("Herrschaftsgebiete", async () => {
        await expect(loadTerritoryPointer(answer({ ...TERRITORY, ...newer }))).resolves.toEqual(TERRITORY);
    });

    it("Grundkarte", async () => {
        await expect(loadRasterPointer("original", answer({ ...RASTER, ...newer }))).resolves.toEqual(RASTER);
    });

    it("was die Karte kennt, prüft sie weiter streng, auch neben einem neuen Feld", async () => {
        await expect(loadTerrainPointer(answer({ ...TERRAIN, ...newer, revision: "zu-kurz" }))).rejects.toThrow(
            /Geländezeiger/,
        );
        await expect(loadDisplayHeightPointer(answer({ ...DISPLAY_HEIGHT, ...newer, demRevision: 7 }))).rejects.toThrow(
            /Höhenzeiger/,
        );
        await expect(loadTerritoryPointer(answer({ ...TERRITORY, ...newer, displayYearBf: "heute" }))).rejects.toThrow(
            /Gebietszeiger/,
        );
        await expect(loadRasterPointer("original", answer({ ...RASTER, ...newer, series: "modern" }))).rejects.toThrow(
            /gehört zur Serie modern/,
        );
    });
});

/** Alle Quelldateien der Oberfläche. */
function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(?:ts|vue)$/.test(name) ? [path] : [];
    });
}

describe("🪤 die Oberfläche benutzt nie die strenge Prüfung des Servers", () => {
    it("kein parse*Pointer in apps/web/src: Zeiger liest sie mit read*Pointer", () => {
        const root = fileURLToPath(new URL("../src", import.meta.url));
        const files = sourceFiles(root);
        expect(files.length).toBeGreaterThan(50);
        const offenders = files.filter((file) =>
            /\bparse(?:Terrain|DisplayHeight|Territory|Raster)Pointer\b/.test(
                readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""),
            ),
        );
        expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
    });
});

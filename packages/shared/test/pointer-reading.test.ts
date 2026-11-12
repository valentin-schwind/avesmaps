import { describe, expect, it } from "vitest";
import {
    parseDisplayHeightPointer,
    parseRasterPointer,
    parseTerrainPointer,
    parseTerritoryPointer,
    readDisplayHeightPointer,
    readRasterPointer,
    readTerrainPointer,
    readTerritoryPointer,
} from "../src/index.ts";

/**
 * Der Server prüft Zeiger streng, der Client liest sie tolerant (WI-0075 R5b, Rollout-Antwort E3). Anlass: Das neue
 * Feld `format` der Höhenkacheln (WI-0073) machte einen noch geladenen Client blind, weil sein Schema
 * `additionalProperties: false` trug und der Zeiger deshalb als ungültig galt.
 */

const terrain = { schemaVersion: 1, revision: "3b0c38980fef", tileSize: 512, maxNativeZoom: 3, encoding: "mapbox" };
const displayHeight = { schemaVersion: 1, revision: "28c982f14ab2", demRevision: "7a7dbe454996" };
const territory = { schemaVersion: 1, revision: "abcdef012345", displayYearBf: 1049 };
const raster = {
    schemaVersion: 1,
    series: "original",
    revision: "3f2a9c01be47",
    manifest: "3f2a9c01be475d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c",
    format: "webp",
    tileSize: 512,
    maxNativeZoom: 6,
};

/** Je Zeiger: ein gültiges Beispiel, der strenge Leser (Server) und der tolerante (Client). */
const POINTERS = [
    { name: "Geländezeiger", pointer: terrain, strict: parseTerrainPointer, tolerant: readTerrainPointer },
    {
        name: "Höhenzeiger",
        pointer: displayHeight,
        strict: parseDisplayHeightPointer,
        tolerant: readDisplayHeightPointer,
    },
    { name: "Gebietszeiger", pointer: territory, strict: parseTerritoryPointer, tolerant: readTerritoryPointer },
    {
        name: "Rasterzeiger",
        pointer: raster,
        strict: (candidate: unknown) => parseRasterPointer(candidate, "original"),
        tolerant: (candidate: unknown) => readRasterPointer(candidate, "original"),
    },
] as const;

describe.each(POINTERS)("$name: Server streng, Client tolerant", ({ name, pointer, strict, tolerant }) => {
    it("🔴 ein Zeiger mit einem NEUEN Feld wird vom Client gelesen und vom Server-Schema abgelehnt", () => {
        const newer = { ...pointer, neuesFeld: "kommt mit einem späteren Release", verschachtelt: { a: 1 } };
        // Der Client liest ihn und reicht das unbekannte Feld nicht weiter.
        expect(tolerant(newer)).toEqual(pointer);
        expect(Object.keys(tolerant(newer))).not.toContain("neuesFeld");
        // Der Server sendet keinen Zeiger mit einem Feld, das sein Schema nicht kennt.
        expect(() => strict(newer)).toThrow(new RegExp(`ungültiger ${name}`));
    });

    it("beide lesen den heutigen Zeiger gleich", () => {
        expect(strict(pointer)).toEqual(pointer);
        expect(tolerant(pointer)).toEqual(pointer);
    });

    it("🔴 tolerant heißt nicht lax: ein bekanntes Feld mit falschem Wert, ein fehlendes und ein Nicht-Objekt scheitern laut", () => {
        const first = Object.keys(pointer).find((key) => key !== "schemaVersion") as string;
        expect(() => tolerant({ ...pointer, schemaVersion: 2 })).toThrow(new RegExp(`ungültiger ${name}`));
        const without: Record<string, unknown> = { ...pointer };
        delete without[first];
        expect(() => tolerant(without)).toThrow(new RegExp(`ungültiger ${name}`));
        expect(() => tolerant({ ...pointer, revision: "../../etc/xx" })).toThrow(new RegExp(`ungültiger ${name}`));
        for (const candidate of ["<!doctype html>", null, undefined, 42, [pointer]]) {
            expect(() => tolerant(candidate)).toThrow(new RegExp(`ungültiger ${name}`));
        }
    });

    it("ein neues Feld mit dem Namen eines Objektprototyps richtet nichts an", () => {
        const hostile = JSON.parse(`{"__proto__":{"revision":"000000000000"},"constructor":1}`) as object;
        expect(tolerant({ ...pointer, ...hostile })).toEqual(pointer);
    });
});

describe("Rasterzeiger: die Prüfungen über das Schema hinaus gelten auch für den toleranten Leser", () => {
    it("🪤 ein Zeiger einer anderen Serie bleibt ein Fehler, ein neues Feld ändert daran nichts", () => {
        expect(() => readRasterPointer({ ...raster, neuesFeld: 1 }, "modern")).toThrow(/gehört zur Serie original/);
    });

    it("🪤 Revision und Manifest müssen zusammenpassen", () => {
        expect(() => readRasterPointer({ ...raster, revision: "000000000000", neuesFeld: 1 }, "original")).toThrow(
            /sein Manifest aber nicht/,
        );
    });
});

describe("Geländezeiger: das Format kommt, und ein noch neueres Feld stört nicht", () => {
    it("🔴 der Zeiger aus WI-0073 (format) und ein künftiger lesen sich beide", () => {
        expect(readTerrainPointer({ ...terrain, format: "webp" }).format).toBe("webp");
        expect(readTerrainPointer({ ...terrain, format: "webp", lod: 2 }).format).toBe("webp");
        // Ein Format, das der Client nicht kennt, ist kein „unbekanntes Feld“, sondern ein falscher Wert.
        expect(() => readTerrainPointer({ ...terrain, format: "avif" })).toThrow(/ungültiger Geländezeiger/);
    });
});

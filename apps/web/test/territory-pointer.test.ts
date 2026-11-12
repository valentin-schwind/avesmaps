import { describe, expect, it } from "vitest";
import { territoryMaxBand } from "../src/map/territory-band.ts";
import { loadTerritoryPointer } from "../src/map/territory-pointer.ts";

/**
 * Der Zeiger der Herrschaftsgebiete (WI-0062): „keine Gebiete“ ist ein Zustand, alles andere scheitert laut - wie bei
 * den Anzeigehöhen. Die Revision steht danach in der Kachel-Adresse.
 */

const antwort = (status: number, body: string, type = "application/json"): typeof fetch =>
    (() =>
        Promise.resolve(new Response(body, { status, headers: { "content-type": type } }))) as unknown as typeof fetch;

const ZEIGER = { schemaVersion: 1, revision: "abcdef012345", displayYearBf: 1049 };

describe("loadTerritoryPointer", () => {
    it("liest den Zeiger", async () => {
        await expect(loadTerritoryPointer(antwort(200, JSON.stringify(ZEIGER)))).resolves.toEqual(ZEIGER);
    });

    it("🔴 404 (nichts abgeleitet oder entwertet) heißt keine Gebiete, statt alter", async () => {
        await expect(
            loadTerritoryPointer(antwort(404, JSON.stringify({ error: { code: "no_territories" } }))),
        ).resolves.toBeUndefined();
    });

    it("eine HTML-Seite (Nginx kennt den Pfad nicht) heißt ebenfalls keine Gebiete", async () => {
        await expect(
            loadTerritoryPointer(antwort(200, "<html></html>", "text/html; charset=utf-8")),
        ).resolves.toBeUndefined();
    });

    it("🔴 WI-0188 A8: der Zeiger sagt, bis zu welchem Band abgeleitet ist, und die Bandwahl der Karte merkt es sich", async () => {
        await expect(loadTerritoryPointer(antwort(200, JSON.stringify({ ...ZEIGER, maxBand: 8 })))).resolves.toEqual({
            ...ZEIGER,
            maxBand: 8,
        });
        expect(territoryMaxBand()).toBe(8);
        // Ein Server vor WI-0188 sagt es nicht: dann gilt Legacys 6, so weit reichte jede frühere Ableitung.
        await loadTerritoryPointer(antwort(200, JSON.stringify(ZEIGER)));
        expect(territoryMaxBand()).toBe(6);
        await loadTerritoryPointer(antwort(200, JSON.stringify({ ...ZEIGER, maxBand: 7 })));
        expect(territoryMaxBand()).toBe(7);
        // Keine Gebiete: wieder Legacys 6.
        await loadTerritoryPointer(antwort(404, JSON.stringify({ error: { code: "no_territories" } })));
        expect(territoryMaxBand()).toBe(6);
    });

    it("💣 alles andere scheitert laut: 5xx, kaputtes JSON, falsches Schema", async () => {
        await expect(loadTerritoryPointer(antwort(503, "{}"))).rejects.toThrow(/antwortet 503/);
        await expect(loadTerritoryPointer(antwort(500, ""))).rejects.toThrow(/antwortet 500/);
        await expect(loadTerritoryPointer(antwort(200, "kein json"))).rejects.toThrow(/kein JSON/);
        await expect(
            loadTerritoryPointer(antwort(200, JSON.stringify({ ...ZEIGER, revision: "zu-kurz" }))),
        ).rejects.toThrow(/Gebietszeiger/);
        await expect(loadTerritoryPointer(antwort(200, JSON.stringify({ ...ZEIGER, maxBand: 9 })))).rejects.toThrow(
            /Gebietszeiger/,
        );
    });
});

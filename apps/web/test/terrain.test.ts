import { describe, expect, it } from "vitest";
import { validateStyleMin, type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { TerrainDemPointer } from "@avesmaps3d/shared";
import {
    GELAENDE,
    HILLSHADE_LAYER_ID,
    HILLSHADE_SOURCE_ID,
    TERRAIN_SOURCE_ID,
    terrainShare,
    withTerrain,
} from "../src/map/terrain/terrain.ts";
import { loadTerrainPointer } from "../src/map/terrain/terrain-pointer.ts";
import { detectSoftwareRendering, isSoftwareRenderer } from "../src/map/terrain/software-rendering.ts";
import { findLayer } from "./style-spec.ts";

/**
 * Das Gelände der geneigten Karte (WI-0049 S4), ohne Browser: Stil, Wachsen und Zeiger.
 */

const POINTER: TerrainDemPointer = {
    schemaVersion: 1,
    revision: "3b0c38980fef",
    tileSize: 512,
    maxNativeZoom: 3,
    encoding: "mapbox",
};

const STIL: StyleSpecification = {
    version: 8,
    sources: { basemap: { type: "raster", tiles: ["/tiles/raster/original/x/{z}/{x}/{y}.webp"], tileSize: 512 } },
    layers: [
        { id: "background", type: "background" },
        { id: "basemap", type: "raster", source: "basemap" },
        { id: "orte", type: "background" },
    ],
};

function answer(status: number, body: string, type = "application/json"): typeof fetch {
    return async () =>
        new Response(status === 204 || status === 404 ? null : body, { status, headers: { "content-type": type } });
}

describe("Wachsen mit der Neigung", () => {
    it("D1: flach gibt es kein Gelände; bis 30° wachsen die Gebirge, darüber stehen sie voll", () => {
        expect(terrainShare(0)).toBe(0);
        expect(terrainShare(0.1), "ein Hauch Neigung ist noch flach").toBe(0);
        expect(terrainShare(15)).toBeCloseTo(0.5, 12);
        expect(terrainShare(GELAENDE.wachsenBisGrad)).toBe(1);
        expect(terrainShare(60)).toBe(1);
    });
});

describe("Stil", () => {
    it("ohne Zeiger bleibt der Stil, wie er war: die Karte ist flach", () => {
        expect(withTerrain(STIL, undefined, 1)).toBe(STIL);
    });

    it("flach: Quellen da, Schattierung unsichtbar, kein Gelände", () => {
        const stil = withTerrain(STIL, POINTER, 0);
        expect(stil.terrain).toBeUndefined();
        expect(findLayer(stil.layers, HILLSHADE_LAYER_ID, "hillshade")?.layout?.visibility).toBe("none");
        expect(validateStyleMin(stil)).toEqual([]);
    });

    it("geneigt: Gelände mit VOLLER Überhöhung im Stil, Schattierung mit dem Anteil", () => {
        const stil = withTerrain(STIL, POINTER, 0.5);
        // 🔴 Das Wachsen stellt installTerrain am Gelände selbst; der Stil nennt immer die volle
        // Überhöhung, sonst baute jedes setStyle mit diff das Gelände neu auf.
        expect(stil.terrain).toEqual({ source: TERRAIN_SOURCE_ID, exaggeration: 1 });
        const schatten = findLayer(stil.layers, HILLSHADE_LAYER_ID, "hillshade");
        expect(schatten?.layout?.visibility).toBe("visible");
        expect(schatten?.paint?.["hillshade-exaggeration"]).toBeCloseTo(0.3, 12);
        expect(validateStyleMin(stil)).toEqual([]);
    });

    it("Schatten 40 %, Glanz 20 %, Licht Nordwest, kein Akzent (S1, Blatt 4)", () => {
        const paint = findLayer(withTerrain(STIL, POINTER, 1).layers, HILLSHADE_LAYER_ID, "hillshade")?.paint;
        expect(paint?.["hillshade-shadow-color"]).toBe("rgba(45, 32, 18, 0.4)");
        expect(paint?.["hillshade-highlight-color"]).toBe("rgba(255, 250, 238, 0.2)");
        expect(paint?.["hillshade-illumination-direction"]).toBe(315);
        expect(paint?.["hillshade-accent-color"]).toBe("rgba(0, 0, 0, 0)");
        expect(paint?.["hillshade-exaggeration"]).toBe(0.6);
    });

    it("🪤 Gelände und Schattierung lesen je eine eigene Quelle derselben Revision", () => {
        const stil = withTerrain(STIL, POINTER, 1);
        const kachel = "/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.png";
        for (const id of [TERRAIN_SOURCE_ID, HILLSHADE_SOURCE_ID]) {
            expect(stil.sources[id]).toEqual({
                type: "raster-dem",
                tiles: [kachel],
                tileSize: 512,
                maxzoom: 3,
                encoding: "mapbox",
            });
        }
        expect(findLayer(stil.layers, HILLSHADE_LAYER_ID, "hillshade")?.source).toBe(HILLSHADE_SOURCE_ID);
    });

    it("🔴 WebP-Kacheln (WI-0073): beide Quellen lesen .webp, sonst bleibt alles gleich", () => {
        const stil = withTerrain(STIL, { ...POINTER, format: "webp" }, 1);
        const kachel = "/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.webp";
        for (const id of [TERRAIN_SOURCE_ID, HILLSHADE_SOURCE_ID]) {
            expect(stil.sources[id]).toEqual({
                type: "raster-dem",
                tiles: [kachel],
                tileSize: 512,
                maxzoom: 3,
                encoding: "mapbox",
            });
        }
        expect(validateStyleMin(stil)).toEqual([]);
    });

    it("die Schattierung liegt direkt über der Grundkarte, unter allem anderen", () => {
        const ids = withTerrain(STIL, POINTER, 1).layers.map((layer) => layer.id);
        expect(ids).toEqual(["background", "basemap", HILLSHADE_LAYER_ID, "orte"]);
    });

    it("ohne Grundkarte liegt sie über dem Hintergrund, nicht darunter", () => {
        const ohne = { ...STIL, layers: STIL.layers.filter((layer) => layer.id !== "basemap") };
        const ids = withTerrain(ohne, POINTER, 1).layers.map((layer) => layer.id);
        expect(ids).toEqual(["background", HILLSHADE_LAYER_ID, "orte"]);
    });
});

describe("Zeiger lesen", () => {
    it("liefert die geltende Revision", async () => {
        await expect(loadTerrainPointer(answer(200, JSON.stringify(POINTER)))).resolves.toEqual(POINTER);
    });

    it("🔴 liest das Format der Kacheln mit (WI-0073); ein Zeiger ohne Format bleibt gültig", async () => {
        const webp = { ...POINTER, format: "webp" };
        await expect(loadTerrainPointer(answer(200, JSON.stringify(webp)))).resolves.toEqual(webp);
        await expect(loadTerrainPointer(answer(200, JSON.stringify({ ...POINTER, format: "gif" })))).rejects.toThrow();
    });

    it("404 heißt: kein Gelände abgeleitet, die Karte bleibt flach", async () => {
        await expect(loadTerrainPointer(answer(404, ""))).resolves.toBeUndefined();
    });

    it("💣 ein 204 ist kein Zeiger, auch wenn er `ok` ist", async () => {
        await expect(loadTerrainPointer(answer(204, ""))).rejects.toThrow(/antwortet 204/);
    });

    it("🔴 200 mit HTML heißt: kein Ort für das Gelände (Nginx liefert die App-Seite), die Karte bleibt flach", async () => {
        // So auf Stage und Production, bis das Gelände dort ankommt (Koordination 2026-09-27).
        await expect(
            loadTerrainPointer(answer(200, "<!doctype html><title>Avesmaps3D</title>", "text/html; charset=utf-8")),
        ).resolves.toBeUndefined();
    });

    it("💣 echte Fehler bleiben Fehler: 5xx, kaputtes JSON, falsches Schema", async () => {
        await expect(loadTerrainPointer(answer(503, "{}"))).rejects.toThrow(/antwortet 503/);
        await expect(loadTerrainPointer(answer(200, "<!doctype html>"))).rejects.toThrow(/kein JSON/);
        await expect(loadTerrainPointer(answer(200, "{nicht json"))).rejects.toThrow(/kein JSON/);
        await expect(
            loadTerrainPointer(answer(200, JSON.stringify({ ...POINTER, revision: "zu-kurz" }))),
        ).rejects.toThrow();
    });
});

describe("Ohne Grafikkarte bleibt die Karte flach (Betreiber 2026-09-27, „3: A“)", () => {
    it.each([
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
        "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "llvmpipe (LLVM 15.0.7, 256 bits)",
        "Apple Software Renderer",
    ])("erkennt den Software-Rasterer in %s", (kennung) => {
        expect(isSoftwareRenderer(kennung)).toBe(true);
    });

    it.each([
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "Apple GPU",
        "Adreno (TM) 740",
    ])("lässt die Grafikkarte %s zeichnen", (kennung) => {
        expect(isSoftwareRenderer(kennung)).toBe(false);
    });

    function dokument(gl: unknown): Document {
        return { createElement: () => ({ getContext: () => gl }) } as unknown as Document;
    }

    it("verweigert der Browser die schnelle Fläche, gilt das als Software", () => {
        expect(detectSoftwareRendering(dokument(null))).toMatch(/failIfMajorPerformanceCaveat/);
    });

    it("liest die Kennung und gibt die Prüffläche wieder frei", () => {
        let freigegeben = false;
        const gl = (kennung: string): unknown => ({
            RENDERER: 7937,
            getParameter: () => kennung,
            getExtension: (name: string) =>
                name === "WEBGL_lose_context"
                    ? {
                          loseContext: () => {
                              freigegeben = true;
                          },
                      }
                    : null,
        });
        expect(detectSoftwareRendering(dokument(gl("llvmpipe (LLVM 15)")))).toBe("llvmpipe (LLVM 15)");
        expect(freigegeben).toBe(true);
        expect(detectSoftwareRendering(dokument(gl("Apple GPU")))).toBeUndefined();
    });

    it("ohne Dokument (Server, Test) keine Aussage", () => {
        expect(detectSoftwareRendering(undefined)).toBeUndefined();
    });
});

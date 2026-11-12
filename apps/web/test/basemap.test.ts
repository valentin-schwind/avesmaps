import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { DEFAULT_LANDSCAPE_SELECTION, type RasterPyramidPointer } from "@avesmaps3d/shared";
import { loadRasterPointer } from "../src/map/basemap.ts";
import { BASEMAP_SOURCE_ID, buildPlaceStyle } from "../src/map/place-layers.ts";

/**
 * Die Grundkarte liegt unter einer Revision, und `current.json` sagt, welche gilt (ADR-0008).
 */

const POINTER: RasterPyramidPointer = {
    schemaVersion: 1,
    series: "original",
    revision: "3f2a9c01be47",
    manifest: "3f2a9c01be475d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c",
    format: "webp",
    tileSize: 512,
    maxNativeZoom: 6,
};

function answer(status: number, body: string): typeof fetch {
    return async () => new Response(status === 204 || status === 304 ? null : body, { status });
}

describe("Zeiger lesen", () => {
    it("liefert die geltende Revision", async () => {
        await expect(loadRasterPointer("original", answer(200, JSON.stringify(POINTER)))).resolves.toEqual(POINTER);
    });

    it("💣 ein 204 ist kein Zeiger, auch wenn er `ok` ist", async () => {
        // Genau das antwortet Nginx auf Staging für jede fehlende Datei unter /tiles/raster/.
        await expect(loadRasterPointer("original", answer(204, ""))).rejects.toThrow(/antwortet 204/);
    });

    it("🪤 ein SPA-Fallback mit 200 und HTML ist kein Zeiger", async () => {
        await expect(loadRasterPointer("original", answer(200, "<!doctype html>"))).rejects.toThrow(/kein JSON/);
    });

    it("nimmt keinen Zeiger einer anderen Serie", async () => {
        await expect(loadRasterPointer("modern", answer(200, JSON.stringify(POINTER)))).rejects.toThrow(
            /gehört zur Serie original/,
        );
    });

    it("sagt, wenn die Pyramide fehlt", async () => {
        await expect(loadRasterPointer("original", answer(404, "{}"))).rejects.toThrow(/antwortet 404/);
    });
});

function style(options: {
    basemap: RasterPyramidPointer | undefined;
    seriesId?: string;
    view?: "standard" | "landscapes";
}) {
    return buildPlaceStyle({
        tileUrl: "/v/place/{z}/{x}/{y}",
        landscapeUrl: "/v/landscape/{z}/{x}/{y}",
        landscapeRunUrl: "/v/run/{z}/{x}/{y}",
        mapLabelUrl: "/v/label/{z}/{x}/{y}",
        climateUrl: "/v/climate/{z}/{x}/{y}",
        pathUrl: "/v/path/{z}/{x}/{y}",
        pathLabelUrl: "/v/path-label/{z}/{x}/{y}",
        powerlineUrl: "/v/powerline/{z}/{x}/{y}",
        leyNodeUrl: "/v/ley-node/{z}/{x}/{y}",
        basemap: options.basemap,
        seriesId: options.seriesId ?? "original",
        view: options.view ?? "standard",
        landscapeSelection: DEFAULT_LANDSCAPE_SELECTION,
    });
}

describe("Grundkarte im Stil", () => {
    it("fragt die Kacheln unter der Revision an, mit Raster und Stufen aus dem Zeiger", () => {
        const built = style({ basemap: { ...POINTER, tileSize: 256, maxNativeZoom: 7 } });
        const source = built.sources[BASEMAP_SOURCE_ID];

        expect(source).toMatchObject({
            type: "raster",
            tiles: ["/tiles/raster/original/3f2a9c01be47/{z}/{x}/{y}.webp"],
            tileSize: 256,
            maxzoom: 7,
        });
        expect(built.layers.map((layer) => layer.id)).toContain("basemap");
        expect(validateStyleMin(built)).toEqual([]);
    });

    it("🔴 ohne Zeiger bleibt der Stil gültig: keine Quelle, kein Layer, der ins Leere zeigt", () => {
        const built = style({ basemap: undefined });

        expect(built.sources[BASEMAP_SOURCE_ID]).toBeUndefined();
        expect(built.layers.map((layer) => layer.id)).not.toContain("basemap");
        expect(validateStyleMin(built)).toEqual([]);
    });

    it("🪤 der Zeiger einer anderen Serie wird nicht gezeichnet", () => {
        const built = style({ basemap: POINTER, seriesId: "modern" });

        expect(built.sources[BASEMAP_SOURCE_ID]).toBeUndefined();
        expect(validateStyleMin(built)).toEqual([]);
    });

    it("die Landschaftsansicht lässt das Gelände weg, auch mit Zeiger", () => {
        const built = style({ basemap: POINTER, view: "landscapes" });

        expect(built.layers.map((layer) => layer.id)).not.toContain("basemap");
        expect(validateStyleMin(built)).toEqual([]);
    });
});

import { describe, expect, it } from "vitest";
import { validateStyleMin, type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { TerrainDemPointer } from "@avesmaps3d/shared";
import { HILLSHADE_LAYER_ID, HILLSHADE_SOURCE_ID, TERRAIN_SOURCE_ID, withTerrain } from "../src/map/terrain/terrain.ts";
import { findLayer } from "./style-spec.ts";

/**
 * Das visuelle Relief in der Karte (WI-0054), ohne Browser: nur Landschaften, nur Schattierung, nie
 * Gelände, und nur zur passenden Geländerevision.
 */

const TERRAIN: TerrainDemPointer = {
    schemaVersion: 1,
    revision: "3b0c38980fef",
    tileSize: 512,
    maxNativeZoom: 3,
    encoding: "mapbox",
};
const LANDSCHAFTEN: StyleSpecification = {
    version: 8,
    sources: { landscapes: { type: "vector", tiles: ["/tiles/vector/{z}/{x}/{y}"] } },
    layers: [
        { id: "background", type: "background" },
        { id: "landscape-fill-topographie", type: "fill", source: "landscapes", "source-layer": "r" },
        { id: "landscape-line-topographie", type: "line", source: "landscapes", "source-layer": "r" },
        { id: "landscape-fill-vegetation", type: "fill", source: "landscapes", "source-layer": "r" },
        { id: "orte", type: "background" },
    ],
};

describe("Stil mit Relief", () => {
    const stil = withTerrain(LANDSCHAFTEN, TERRAIN, 1, true);

    it("🔴 Gelände und Landschaftsschattierung lesen dasselbe Domain-DEM", () => {
        expect(stil.terrain).toEqual({ source: TERRAIN_SOURCE_ID, exaggeration: 1 });
        expect(stil.sources[TERRAIN_SOURCE_ID]).toMatchObject({
            tiles: ["/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.png"],
        });
        expect(stil.sources[HILLSHADE_SOURCE_ID]).toEqual({
            type: "raster-dem",
            tiles: ["/tiles/terrain/dem/3b0c38980fef/{z}/{x}/{y}.png"],
            tileSize: 512,
            maxzoom: 3,
            encoding: "mapbox",
        });
        // Die Schattierung ersetzt die der Gebirge, statt sich darüberzulegen.
        expect(stil.sources["gelaende-relief-dem"]).toBeUndefined();
        expect(findLayer(stil.layers, HILLSHADE_LAYER_ID, "hillshade")?.source).toBe(HILLSHADE_SOURCE_ID);
        expect(stil.layers.filter((layer) => layer.type === "hillshade")).toHaveLength(1);
        expect(validateStyleMin(stil)).toEqual([]);
    });

    it("R3: Licht aus drei Richtungen, gleiche Farben je Licht", () => {
        const paint = findLayer(stil.layers, HILLSHADE_LAYER_ID, "hillshade")?.paint;
        expect(paint?.["hillshade-method"]).toBe("multidirectional");
        expect(paint?.["hillshade-illumination-direction"]).toEqual([270, 315, 0]);
        expect(paint?.["hillshade-shadow-color"]).toHaveLength(3);
        expect(paint?.["hillshade-highlight-color"]).toHaveLength(3);
        expect(paint?.["hillshade-exaggeration"]).toBe(0.5);
    });

    it("liegt über der untersten Landschaftsfläche, unter ihrer Kante", () => {
        expect(stil.layers.map((layer) => layer.id)).toEqual([
            "background",
            "landscape-fill-topographie",
            HILLSHADE_LAYER_ID,
            "landscape-line-topographie",
            "landscape-fill-vegetation",
            "orte",
        ]);
    });

    it("flach (2D) unsichtbar: MapLibre lädt dann keine Kachel der Quelle", () => {
        const flach = withTerrain(LANDSCHAFTEN, TERRAIN, 0, true);
        expect(findLayer(flach.layers, HILLSHADE_LAYER_ID, "hillshade")?.layout?.visibility).toBe("none");
        expect(flach.terrain).toBeUndefined();
    });

    it("ohne Relief bleibt der Stil genau wie vor WI-0054", () => {
        expect(withTerrain(LANDSCHAFTEN, TERRAIN, 1, undefined)).toEqual(withTerrain(LANDSCHAFTEN, TERRAIN, 1));
    });
});

import type { GeoJSONSourceSpecification, LineLayerSpecification } from "maplibre-gl";
import { AVENTURIA, DESIGN_CANON, canonColour, toRenderLngLat } from "@avesmaps3d/shared";

/**
 * Das Rechenraster des Höhenmodells (WI-0070): Das 8k-Gelände entsteht aus `tiles` × `tiles` Kacheln. Für
 * Editoren blendet das Anzeige-Menü dessen Grenzen ein, damit man weiß, wo man nach Nähten suchen muss
 * (Betreiber 2026-10-03: „siehst du die kacheln?“). Gerade Linien bei Vielfachen von 1024 / `tiles` E; in
 * der Kartenprojektion bleiben sie gerade, zwei Punkte je Linie reichen.
 */
export const TILE_GRID_SOURCE_ID = "tile-grid";
export const TILE_GRID_LAYER_ID = "tile-grid-lines";
/** So viele Rechenkacheln je Seite hat das Domain-Gelände (`generator.fine.tiles`). */
export const TERRAIN_TILES = 8;

const EXTENT = 1024;

export function buildTileGridSource(tiles: number = TERRAIN_TILES): GeoJSONSourceSpecification {
    const point = (x: number, y: number): [number, number] => {
        const at = toRenderLngLat(AVENTURIA.coordinateSpace, { x, y });
        return [at.lng, at.lat];
    };
    const features = [];
    for (let i = 1; i < tiles; i += 1) {
        const c = (i * EXTENT) / tiles;
        features.push(
            {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: [point(c, 0), point(c, EXTENT)] },
            },
            {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: [point(0, c), point(EXTENT, c)] },
            },
        );
    }
    return { type: "geojson", data: { type: "FeatureCollection", features } };
}

export function buildTileGridLayer(): LineLayerSpecification {
    return {
        id: TILE_GRID_LAYER_ID,
        type: "line",
        source: TILE_GRID_SOURCE_ID,
        layout: { "line-cap": "butt" },
        paint: {
            "line-color": canonColour("mapSelection"),
            "line-width": DESIGN_CANON.mapSelection.lineWidth,
            "line-dasharray": [4, 3],
        },
    };
}

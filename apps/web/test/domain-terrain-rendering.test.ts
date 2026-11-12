import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { HILLSHADE_SOURCE_ID, TERRAIN_SOURCE_ID, withTerrain } from "../src/map/terrain/terrain.ts";

describe("WI-0067: one domain DEM for terrain and hillshade", () => {
    it("uses identical domain tiles in independent sources, also in landscapes", () => {
        const style: StyleSpecification = {
            version: 8,
            sources: {},
            layers: [{ id: "background", type: "background" }],
        };
        const pointer = {
            schemaVersion: 1 as const,
            revision: "4afe8e41524c",
            tileSize: 512,
            maxNativeZoom: 3,
            encoding: "mapbox" as const,
        };
        const rendered = withTerrain(style, pointer, 1, true);
        expect(rendered.sources[TERRAIN_SOURCE_ID]).toEqual(rendered.sources[HILLSHADE_SOURCE_ID]);
        expect(rendered.sources[HILLSHADE_SOURCE_ID]).toMatchObject({
            tiles: ["/tiles/terrain/dem/4afe8e41524c/{z}/{x}/{y}.png"],
        });
        expect(rendered.sources["gelaende-relief-dem"]).toBeUndefined();
        expect(rendered.layers.find((layer) => layer.type === "hillshade")?.source).toBe(HILLSHADE_SOURCE_ID);
    });
});

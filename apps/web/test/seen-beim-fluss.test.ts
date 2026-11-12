import { describe, expect, it } from "vitest";
import type { LandscapeSelection, MapView } from "@avesmaps3d/shared";
import { EDITOR_SEEN_EBENE, WATER_FILL_LAYER_ID, WATER_SOURCE_ID } from "../src/map/landscape-layers.ts";
import { displayDefaults, type MapDisplay } from "../src/map/map-display.ts";
import { PATH_SOURCE_ID } from "../src/map/path-layers.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";

/**
 * Die Seen beim Bearbeiten eines Flusses (OPS-000116): In der Standardansicht zeichnet die Karte keine eigenen Seen. Steht ein Wege-Fenster
 * an einem Fluss, kommen sie aus der geglätteten Quelle dazu, unter den Wegen, damit Zu- und Abflüsse an den See passen. Problemfälle: die
 * Seen fehlen beim Bearbeiten; sie bleiben nach dem Schließen stehen; sie liegen über dem Fluss; sie stehen doppelt, wo die Karte sie schon
 * zeichnet.
 */

const WATER_TILES = "/tiles/vector/terrain_water_render/{z}/{x}/{y}";

function style(
    view: MapView,
    selection: LandscapeSelection,
    seenBeimFluss: boolean,
    display: Partial<MapDisplay> = {},
) {
    return buildPlaceStyle({
        tileUrl: "/p/{z}/{x}/{y}",
        landscapeUrl: "/l/{z}/{x}/{y}",
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        pathUrl: "/w/{z}/{x}/{y}",
        pathLabelUrl: "/wl/{z}/{x}/{y}",
        powerlineUrl: "/k/{z}/{x}/{y}",
        leyNodeUrl: "/n/{z}/{x}/{y}",
        waterUrl: WATER_TILES,
        seenBeimFluss,
        basemap: undefined,
        seriesId: "original",
        view,
        landscapeSelection: selection,
        display: { ...displayDefaults(view), ...display },
    });
}

const ids = (s: ReturnType<typeof style>): string[] => s.layers.map((layer) => layer.id);

describe("Seen beim Bearbeiten eines Flusses (OPS-000116)", () => {
    it("🔴 Standardansicht: mit offenem Fluss die Seen aus der geglätteten Quelle, unter den Wegen", () => {
        const s = style("standard", "alle", true, { rivers: true });
        expect(s.sources[WATER_SOURCE_ID]).toMatchObject({ tiles: [WATER_TILES] });
        expect(ids(s)).toContain(EDITOR_SEEN_EBENE);
        const see = s.layers.findIndex((layer) => layer.id === EDITOR_SEEN_EBENE);
        const ersterWeg = s.layers.findIndex((layer) => "source" in layer && layer.source === PATH_SOURCE_ID);
        expect(ersterWeg, "Wege stehen im Stil").toBeGreaterThan(-1);
        expect(see, "der See liegt unter dem Fluss").toBeLessThan(ersterWeg);
    });

    it("🔴 Standardansicht: ohne offenen Fluss keine Seen und keine Wasserquelle", () => {
        const s = style("standard", "alle", false, { rivers: true });
        expect(ids(s)).not.toContain(EDITOR_SEEN_EBENE);
        expect(s.sources[WATER_SOURCE_ID]).toBeUndefined();
    });

    it("🔴 Landschaften: Wo die Karte die Seen schon zeichnet, stehen sie nicht doppelt", () => {
        const s = style("landscapes", "alle", true);
        expect(ids(s)).toContain(WATER_FILL_LAYER_ID);
        expect(ids(s)).not.toContain(EDITOR_SEEN_EBENE);
    });

    it("Landschaften mit „Flüsse und Seen“ aus: beim Bearbeiten eines Flusses kommen die Seen dazu", () => {
        const s = style("landscapes", "alle", true, { rivers: false });
        expect(ids(s)).not.toContain(WATER_FILL_LAYER_ID);
        expect(ids(s)).toContain(EDITOR_SEEN_EBENE);
    });
});

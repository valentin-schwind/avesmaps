import { describe, expect, it, vi } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { composeView, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import {
    AREA_PREVIEW_OUTLINE_LAYER_ID,
    AREA_PREVIEW_OUTLINE_SOURCE_ID,
    AREA_SELECTION_FILL_LAYER_ID,
    AREA_SELECTION_GLOW_LAYER_ID,
    AREA_SELECTION_LINE_LAYER_ID,
} from "../src/map/area-selection.ts";
import { outlineArea } from "../src/map/area-selection-input.ts";
import { LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER, WATER_SOURCE_ID } from "../src/map/landscape-layers.ts";
import { displayDefaults } from "../src/map/map-display.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";

/**
 * Die Flächen sind nahtlos geglättet (WI-0055, Betreiber 2026-10-04: Option A, Migration 0067; seit WI-0077, Migration 0072,
 * alle Ebenen in einem Netz).
 *
 * 🔴 Die geglättete Form liefert die Renderansicht `region_area_render` selbst (für jede Fläche mit frischer Ableitung die
 * abgeleitete Form, sonst die Ausgangsform). Der Stil liest deshalb weiter dieselbe Quelle, und gerade das ist die Zusicherung:
 * Füllung, Kante, die Kontur beim Überfahren und das Leuchten beim Wählen einer Landfläche lesen alle diese EINE Kachel
 * (`landscapes`, Schicht `region_area_render`). Käme die Füllung aus einer zweiten Quelle, zeigten Vorschau und Auswahl
 * (Filter an der Landschaftsquelle, die Form der Vorschau aus ihren Kacheln) weiter die eckige Form neben der runden.
 *
 * 🪤 Eine zweite Quelle für die Landflächen verlangte eine Änderung an `area-selection-input.ts` (die Vorschau des
 * Überfahrens liest die Kacheln dieser Quelle), und das ist die Stelle, an der sich der Vorrang der Karteninteraktion entscheidet. Dieser
 * Test hält die einfache Lösung fest.
 */

type Layer = {
    id: string;
    type: string;
    source?: string;
    "source-layer"?: string;
    filter?: unknown;
    paint?: Record<string, unknown>;
};

const WATER_TILES = "/tiles/vector/terrain_water_render/{z}/{x}/{y}";

function style(
    view: MapView,
    selection: LandscapeSelection,
    options: { topography?: "hoehenlinien" | "hoehenstufen"; area?: { type: string } } = {},
) {
    return buildPlaceStyle({
        tileUrl: "/p/{z}/{x}/{y}",
        landscapeUrl: `/tiles/vector/${LANDSCAPE_SOURCE_LAYER}/{z}/{x}/{y}`,
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        pathUrl: "/w/{z}/{x}/{y}",
        pathLabelUrl: "/wl/{z}/{x}/{y}",
        powerlineUrl: "/k/{z}/{x}/{y}",
        leyNodeUrl: "/n/{z}/{x}/{y}",
        waterUrl: WATER_TILES,
        basemap: undefined,
        seriesId: "original",
        view,
        landscapeSelection: selection,
        ...(options.topography ? { topography: options.topography } : {}),
        display: { ...displayDefaults(view) },
        ...(options.area
            ? {
                  areaSelection: {
                      kind: "landscape" as const,
                      id: "gebirge-1",
                      name: "Trollzacken",
                      type: options.area.type,
                      anchor: { x: 597.8, y: 549 },
                      label: "Trollzacken",
                  },
              }
            : {}),
    });
}

const layersOf = (s: ReturnType<typeof style>): Layer[] => s.layers as Layer[];

function passes(layer: Layer, properties: Record<string, unknown>): boolean {
    if (layer.filter === undefined) return true;
    return featureFilter(layer.filter as never, "filter").filter(
        { zoom: 4 },
        { type: 3, properties } as never,
        undefined as never,
    );
}

const TOPOGRAPHY_LAND = [
    "gebirge",
    "huegelland",
    "hochebene",
    "tal",
    "tiefebene",
    "insel",
    "kueste",
    "wadi",
    "flussdelta",
];

describe("Die Landflächen der Topographie lesen die abgeleitete Form aus der Renderansicht", () => {
    it("🔴 die Quelle der Landschaften ist die Renderansicht `region_area_render`, mit der Region als stabiler Kennung", () => {
        expect(LANDSCAPE_SOURCE_LAYER).toBe("region_area_render");
        const s = style("landscapes", "alle");
        expect(s.sources[LANDSCAPE_SOURCE_ID]).toMatchObject({
            tiles: ["/tiles/vector/region_area_render/{z}/{x}/{y}"],
            promoteId: { region_area_render: "region_public_id" },
        });
    });

    it.each([
        ["alle", undefined],
        ["topographie", "hoehenlinien"],
    ] as const)(
        "🔴 %s: Füllung und Kante der Topographie lesen dieselbe Quelle und Schicht",
        (selection, topography) => {
            const s = style("landscapes", selection, topography ? { topography } : {});
            const fill = layersOf(s).find((layer) => layer.id === "landscape-fill-topographie") as Layer;
            const line = layersOf(s).find((layer) => layer.id === "landscape-line-topographie") as Layer;
            for (const layer of [fill, line]) {
                expect(layer, "die Ebene Topographie steht im Stil").toBeDefined();
                expect(layer.source).toBe(LANDSCAPE_SOURCE_ID);
                expect(layer["source-layer"]).toBe(LANDSCAPE_SOURCE_LAYER);
                for (const type of TOPOGRAPHY_LAND) {
                    expect(
                        passes(layer, { region_layer: "topographie", region_type: type }),
                        `${layer.id} ${type}`,
                    ).toBe(true);
                }
            }
        },
    );

    it("🔴 die Kontur beim Überfahren steht an derselben Quelle: sie folgt der Form, die die Füllung zeigt", () => {
        const s = style("landscapes", "topographie", { topography: "hoehenlinien" });
        const fill = layersOf(s).find((layer) => layer.id === "landscape-fill-topographie") as Layer;
        // Die Vorschau ist EINE Ebene an einer kleinen eigenen Quelle (WI-0266), keine unsichtbare Ebene mehr an den Landschaftskacheln ...
        const preview = layersOf(s).find((layer) => layer.id === AREA_PREVIEW_OUTLINE_LAYER_ID) as Layer;
        expect(preview.source).toBe(AREA_PREVIEW_OUTLINE_SOURCE_ID);
        expect(s.sources[AREA_PREVIEW_OUTLINE_SOURCE_ID]).toMatchObject({ type: "geojson" });
        expect(layersOf(s).filter((layer) => layer.id.startsWith("area-preview") && layer.id !== preview.id)).toEqual(
            [],
        );
        // ... ihre Form liest die Eingabe aber aus derselben Quelle und Schicht wie die Füllung: dieselbe Kachel, dieselbe weiche Form.
        const gefragt = vi.fn(() => []);
        const karte = {
            on: () => undefined,
            getLayer: (id: string) => (s.layers.some((layer) => layer.id === id) ? {} : undefined),
            getSource: (id: string) =>
                id === AREA_PREVIEW_OUTLINE_SOURCE_ID ? { setData: () => undefined } : id in s.sources ? {} : undefined,
            getZoom: () => 4,
            querySourceFeatures: gefragt,
        } as unknown as MapLibreMap;
        outlineArea(karte, { kind: "landscape", id: "gebirge-1", name: "Trollzacken", type: "gebirge", area: 1 });
        expect(gefragt).toHaveBeenCalledTimes(1);
        expect(gefragt).toHaveBeenCalledWith(
            fill.source,
            expect.objectContaining({ sourceLayer: fill["source-layer"] }),
        );
        expect(fill.source).toBe(LANDSCAPE_SOURCE_ID);
        expect(fill["source-layer"]).toBe(LANDSCAPE_SOURCE_LAYER);
    });

    it.each(TOPOGRAPHY_LAND)(
        "🔴 eine gewählte Landfläche (%s) leuchtet an der Quelle der Füllung, nicht an der des Wassers",
        (type) => {
            const s = style("landscapes", "topographie", { topography: "hoehenlinien", area: { type } });
            const selection = layersOf(s).filter((layer) =>
                [AREA_SELECTION_FILL_LAYER_ID, AREA_SELECTION_GLOW_LAYER_ID, AREA_SELECTION_LINE_LAYER_ID].includes(
                    layer.id,
                ),
            );
            expect(selection.map((layer) => layer.id)).toEqual([
                AREA_SELECTION_FILL_LAYER_ID,
                AREA_SELECTION_GLOW_LAYER_ID,
                AREA_SELECTION_LINE_LAYER_ID,
            ]);
            for (const layer of selection) {
                expect(layer.source, layer.id).toBe(LANDSCAPE_SOURCE_ID);
                expect(layer["source-layer"], layer.id).toBe(LANDSCAPE_SOURCE_LAYER);
                expect(layer.source, layer.id).not.toBe(WATER_SOURCE_ID);
            }
        },
    );

    it("🔴 in der Topographie bleibt das Wasser, wie es war: das Land aus der Renderansicht, die Gewässer aus ihrer Sicht", () => {
        const s = style("landscapes", "topographie", { topography: "hoehenlinien" });
        const fill = layersOf(s).find((layer) => layer.id === "landscape-fill-topographie") as Layer;
        // Seen und Meere zeichnet `terrain_water_render` (die Höhenlinien enden an genau dieser Form), nicht die Landfläche.
        expect(passes(fill, { region_layer: "topographie", region_type: "see" })).toBe(false);
        expect(passes(fill, { region_layer: "topographie", region_type: "meer" })).toBe(false);
        expect(layersOf(s).some((layer) => layer.source === WATER_SOURCE_ID)).toBe(true);
    });

    it("🔴 keine andere Quelle des Stils trägt die Flächen der Landschaften", () => {
        // Eine zweite Kachelquelle mit denselben Flächen (etwa eine „geglättete Landquelle“) ließe eine eckige Form neben der
        // runden stehen. Gewässer und Klima haben ihre eigenen Sichten; Landschaftsflächen kommen nur aus `landscapes`.
        const s = style("landscapes", "alle");
        const fills = layersOf(s).filter(
            (layer) => layer.id.startsWith("landscape-fill-") || layer.id.startsWith("landscape-line-"),
        );
        expect(fills.length).toBeGreaterThan(0);
        expect(new Set(fills.map((layer) => layer.source))).toEqual(new Set([LANDSCAPE_SOURCE_ID]));
        const composition = composeView("landscapes", "alle");
        expect(composition.landscapeLayers).toContain("topographie");
    });
});

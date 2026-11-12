import { describe, expect, it, vi } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA_PATH_CARTOGRAPHY, composeView, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import {
    AREA_PREVIEW_OUTLINE_LAYER_ID,
    AREA_PREVIEW_OUTLINE_SOURCE_ID,
    AREA_SELECTION_FILL_LAYER_ID,
} from "../src/map/area-selection.ts";
import { outlineArea } from "../src/map/area-selection-input.ts";
import {
    CLIMATE_FILL_LAYER_ID,
    LAKE_FILL_LAYER_ID,
    LANDSCAPE_SOURCE_ID,
    smoothWaterFor,
    WATER_FILL_LAYER_ID,
    WATER_LINE_LAYER_ID,
    WATER_SEA_FILL_LAYER_ID,
    WATER_SOURCE_ID,
    WATER_SOURCE_LAYER,
} from "../src/map/landscape-layers.ts";
import { displayDefaults, effectiveDisplay, type MapDisplay } from "../src/map/map-display.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";

/**
 * Seen sind überall geglättet, wo die Karte sie als Fläche zeichnet (Betreiber 2026-10-04: „der see wird angezeigt, aber
 * ungeglättet“; die Topographie tat es seit 2026-09-28). Eine Quelle für die Form: die Sicht `terrain_water_render`.
 * Die eckige Fläche des Sees aus den Landschaftskacheln steht dann nicht mehr im Stil - sie schiene unter der weichen
 * Form hervor.
 */

const WATER = AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"]?.center;
const WATER_TILES = "/tiles/vector/terrain_water_render/{z}/{x}/{y}";

type Layer = {
    id: string;
    type: string;
    source?: string;
    filter?: unknown;
    paint?: Record<string, unknown>;
};

function style(
    view: MapView,
    selection: LandscapeSelection,
    options: { display?: Partial<MapDisplay>; withWater?: boolean; lake?: boolean; topography?: "hoehenlinien" } = {},
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
        ...(options.withWater === false ? {} : { waterUrl: WATER_TILES }),
        basemap: undefined,
        seriesId: "original",
        view,
        landscapeSelection: selection,
        ...(options.topography ? { topography: options.topography } : {}),
        display: { ...displayDefaults(view), ...options.display },
        ...(options.lake
            ? {
                  areaSelection: {
                      kind: "landscape" as const,
                      id: "see-1",
                      name: "Ochsenwasser",
                      type: "see",
                      anchor: { x: 597.8, y: 549 },
                      label: "Ochsenwasser",
                  },
              }
            : {}),
    });
}

const layersOf = (s: ReturnType<typeof style>): Layer[] => s.layers as Layer[];
const ids = (s: ReturnType<typeof style>): string[] => s.layers.map((layer) => layer.id);

/** Lässt der Filter eine Fläche dieser Art und Ebene durch? Ein Layer ohne Filter lässt alles durch. */
function passes(layer: Layer, properties: Record<string, unknown>): boolean {
    if (layer.filter === undefined) return true;
    return featureFilter(layer.filter as never, "filter").filter(
        { zoom: 4 },
        { type: 3, properties } as never,
        undefined as never,
    );
}

const OTHER_SELECTIONS: LandscapeSelection[] = ["alle", "vegetation", "derographisch", "klima"];
/**
 * 🔴 Seit dem Nachtrag zu WI-0083 (Betreiber 2026-10-05: „in alle normal blau“) kommen Seen UND Meere in JEDER
 * Landschaftsansicht aus der geglätteten Quelle - ein Blau, eine Form. „Alle“ war die letzte Ausnahme: Dort malte die
 * Füllung der Ebene Topographie das Meer als Lasur, also blasser und in der eckigen Form der Landschaftskacheln.
 */
const WITH_SEAS: LandscapeSelection[] = ["alle", "vegetation", "derographisch", "klima"];

describe("Der See kommt aus der geglätteten Quelle", () => {
    it.each(OTHER_SELECTIONS)("🔴 %s: die weiche Form steht im Stil, die eckige Seefläche nicht", (selection) => {
        const s = style("landscapes", selection);
        expect(s.sources[WATER_SOURCE_ID]).toMatchObject({ tiles: [WATER_TILES] });
        expect(ids(s)).toContain(WATER_FILL_LAYER_ID);
        expect(ids(s), "keine zweite Seefläche aus den Landschaftskacheln").not.toContain(LAKE_FILL_LAYER_ID);
        const fill = layersOf(s).find((layer) => layer.id === WATER_FILL_LAYER_ID) as Layer;
        expect(passes(fill, { region_type: "see" })).toBe(true);
        // 🔴 Das Meer steht in JEDER Landschaftsansicht hier (WI-0083 samt Nachtrag), samt seiner Küstenlinie - seit dem
        // Nachtrag „Inselkanten“ aber als GRUND in einem eigenen Layer, unter den Landschaftsfüllungen.
        expect(passes(fill, { region_type: "meer" }), "der See trägt das Meer nicht mehr").toBe(false);
        const ground = layersOf(s).find((layer) => layer.id === WATER_SEA_FILL_LAYER_ID) as Layer;
        expect(passes(ground, { region_type: "meer" })).toBe(true);
        expect(passes(ground, { region_type: "see" }), "der Grund trägt den See nicht").toBe(false);
        expect(ids(s), "die Küste des Meeres").toContain(WATER_LINE_LAYER_ID);
        // In der Wasserfarbe, als Ausdruck und nicht als Konstante (`fill-painter-order.test.ts`).
        expect((fill.paint?.["fill-color"] as unknown[])?.slice(0, 4)).toEqual([
            "match",
            ["get", "region_type"],
            "see",
            WATER,
        ]);
        expect(fill.paint?.["fill-opacity"]).toBe(1);
    });

    // Klima hat keine Landschaftsflächen: seine Bänder kommen aus einer eigenen Quelle ohne Seen.
    it.each(["alle", "vegetation", "derographisch"] as const)(
        "🔴 %s: keine Landschaftsfläche und keine Kante zeichnet einen See mit",
        (selection) => {
            const s = style("landscapes", selection);
            const landscape = layersOf(s).filter(
                (layer) => layer.id.startsWith("landscape-fill-") || layer.id.startsWith("landscape-line-"),
            );
            expect(landscape.length).toBeGreaterThan(0);
            for (const layer of landscape) {
                for (const region_layer of ["topographie", "vegetation", "derographisch"]) {
                    expect(passes(layer, { region_layer, region_type: "see" }), `${layer.id} zeichnet den See`).toBe(
                        false,
                    );
                }
            }
        },
    );

    it("🔴 das Meer ist in „Alle“ KEINE Landschaftsfläche mehr: dasselbe Blau wie sonst", () => {
        // Überholt den Stand vom 2026-10-05 („das Meer bleibt in ‚Alle‘ eine Landschaftsfläche“): Der Betreiber hat die
        // Vereinheitlichung entschieden („in alle normal blau“). Vorher Lasur der Ebene Topographie (30 %), jetzt deckend
        // aus der geglätteten Quelle wie in Topographie, Vegetation, Derographisch und den Klimazonen.
        const alle = style("landscapes", "alle");
        const topography = layersOf(alle).find((layer) => layer.id === "landscape-fill-topographie") as Layer;
        expect(passes(topography, { region_layer: "topographie", region_type: "meer" })).toBe(false);
        const fill = layersOf(alle).find((layer) => layer.id === WATER_SEA_FILL_LAYER_ID) as Layer;
        expect(fill.paint?.["fill-opacity"]).toBe(1);
        // Buchstäblich dasselbe Blau und dieselbe Küste wie in der Topographie: derselbe Layer, Wert für Wert.
        const topographie = layersOf(style("landscapes", "topographie", { topography: "hoehenlinien" }));
        for (const id of [WATER_SEA_FILL_LAYER_ID, WATER_FILL_LAYER_ID, WATER_LINE_LAYER_ID]) {
            expect(
                layersOf(alle).find((layer) => layer.id === id),
                id,
            ).toEqual(topographie.find((layer) => layer.id === id));
        }
    });

    it("🔴 der See liegt über allen Landschaftsflächen und -kanten und unter den Wegen", () => {
        const order = ids(style("landscapes", "alle"));
        const water = order.indexOf(WATER_FILL_LAYER_ID);
        const lastLandscape = Math.max(
            ...order.map((id, at) => (id.startsWith("landscape-fill-") || id.startsWith("landscape-line-") ? at : -1)),
        );
        expect(water).toBeGreaterThan(lastLandscape);
        expect(order.indexOf(WATER_LINE_LAYER_ID), "die Küstenlinie bleibt oben").toBeGreaterThan(lastLandscape);
        const firstPath = order.findIndex((id) => id.startsWith("path-"));
        if (firstPath >= 0) {
            expect(water).toBeLessThan(firstPath);
        }
    });

    /**
     * 🔴 Der Nachtrag „Inselkanten“ (Betreiber 2026-10-05: „ja wenns geht, ansonsten schneiden wir die aus“): Das Meer
     * ist der GRUND. Über ihm liegt jede Landschaftsfüllung und jede Landschaftskante - also auch die gestrichelte Kante
     * einer Inselgruppe, die über offenem Wasser verläuft, und jede Fläche, die ganz im Meerpolygon liegt.
     */
    it.each(["alle", "topographie", "vegetation", "derographisch"] as const)(
        "🔴 %s: das Meer ist der Grund - jede Landschaftsfläche und -kante liegt darüber",
        (selection) => {
            const order = ids(style("landscapes", selection));
            const ground = order.indexOf(WATER_SEA_FILL_LAYER_ID);
            expect(ground, "das Meer steht im Stil").toBeGreaterThanOrEqual(0);
            const landscape = order
                .map((id, at) => (id.startsWith("landscape-fill-") || id.startsWith("landscape-line-") ? at : -1))
                .filter((at) => at >= 0);
            expect(landscape.length).toBeGreaterThan(0);
            for (const at of landscape) {
                expect(at, `${order[at] ?? ""} liegt über dem Meer`).toBeGreaterThan(ground);
            }
            // Und über dem Klimaband und den Höhenstufen bleibt es: nichts darunter außer Grundkarte, Band und Höhe.
            const climate = order.indexOf(CLIMATE_FILL_LAYER_ID);
            if (climate >= 0) expect(ground).toBeGreaterThan(climate);
        },
    );

    it("🔴 Klimazonen: auch die Meere, aus derselben Quelle und mit derselben Küste wie die Topographie, über den Bändern", () => {
        // Betreiber 2026-10-05: „kannst du neben see und flüsse auch die meere in der klimazonenansicht zeigen?“
        const s = style("landscapes", "klima");
        const ground = layersOf(s).find((layer) => layer.id === WATER_SEA_FILL_LAYER_ID) as Layer;
        expect(passes(ground, { region_type: "meer" })).toBe(true);
        expect(ids(s)).toContain(WATER_FILL_LAYER_ID);
        expect(ids(s)).toContain(WATER_LINE_LAYER_ID);
        const topographie = layersOf(style("landscapes", "topographie", { topography: "hoehenlinien" }));
        const same = (id: string): void =>
            expect(layersOf(s).find((layer) => layer.id === id)).toEqual(topographie.find((layer) => layer.id === id));
        same(WATER_SEA_FILL_LAYER_ID);
        same(WATER_FILL_LAYER_ID);
        same(WATER_LINE_LAYER_ID);
        const order = ids(s);
        expect(order.indexOf(WATER_SEA_FILL_LAYER_ID)).toBeGreaterThan(order.indexOf(CLIMATE_FILL_LAYER_ID));
        expect(order.indexOf(WATER_SEA_FILL_LAYER_ID)).toBeGreaterThan(order.indexOf("climate-line"));
    });

    it("Topographie: Seen und Meere aus derselben Quelle wie bisher, mit der Kante des Meeres", () => {
        const s = style("landscapes", "topographie", { topography: "hoehenlinien" });
        const fill = layersOf(s).find((layer) => layer.id === WATER_FILL_LAYER_ID) as Layer;
        expect(passes(fill, { region_type: "see" })).toBe(true);
        const ground = layersOf(s).find((layer) => layer.id === WATER_SEA_FILL_LAYER_ID) as Layer;
        expect(passes(ground, { region_type: "meer" })).toBe(true);
        expect(ids(s)).toContain(WATER_LINE_LAYER_ID);
        expect(ids(s)).not.toContain(LAKE_FILL_LAYER_ID);
    });

    it("„Flüsse und Seen“ aus: kein See, das Meer bleibt", () => {
        // 🔴 Der Schalter gilt Flüssen und Seen, nicht dem Meer (WI-0083) - und das Meer kommt jetzt überall von der
        // geglätteten Quelle, also bleibt sie in jeder Landschaftsansicht im Stil. Seit dem Nachtrag „Inselkanten“ hat
        // es einen eigenen Layer: Fällt der See weg, fällt genau SEIN Layer weg.
        for (const selection of WITH_SEAS) {
            const s = style("landscapes", selection, { display: { rivers: false } });
            const ground = layersOf(s).find((layer) => layer.id === WATER_SEA_FILL_LAYER_ID) as Layer;
            expect(passes(ground, { region_type: "meer" }), selection).toBe(true);
            expect(ids(s), selection).not.toContain(WATER_FILL_LAYER_ID);
            expect(ids(s), selection).not.toContain(LAKE_FILL_LAYER_ID);
        }
    });

    it("„Ebenen“ aus: keine Landschaftsfläche, also auch kein See als Fläche", () => {
        const s = style("landscapes", "alle", { display: { layers: false } });
        expect(s.sources).not.toHaveProperty(WATER_SOURCE_ID);
        expect(ids(s)).not.toContain(WATER_FILL_LAYER_ID);
        expect(ids(s)).not.toContain(WATER_SEA_FILL_LAYER_ID);
    });

    it("🔴 wo die Karte keine Landschaftsfläche zeichnet, ist der See ins Kachelbild gemalt und hier kein Thema", () => {
        for (const view of ["standard", "political", "none", "powerlines"] as const) {
            const s = style(view, "alle");
            expect(s.sources, view).not.toHaveProperty(WATER_SOURCE_ID);
            expect(ids(s), view).not.toContain(WATER_FILL_LAYER_ID);
            expect(ids(s), view).not.toContain(WATER_SEA_FILL_LAYER_ID);
            expect(ids(s), view).not.toContain(LAKE_FILL_LAYER_ID);
        }
    });

    it("🪤 ohne Kachelpfad bleibt die eckige Fläche der Rückfall: der See steht genau einmal im Stil", () => {
        const s = style("landscapes", "alle", { withWater: false });
        expect(s.sources).not.toHaveProperty(WATER_SOURCE_ID);
        expect(ids(s)).toContain(LAKE_FILL_LAYER_ID);
        expect(ids(s)).not.toContain(WATER_FILL_LAYER_ID);
        expect(ids(s)).not.toContain(WATER_SEA_FILL_LAYER_ID);
    });
});

describe("Hervorhebung und Umriss folgen der weichen Form", () => {
    it("🔴 ein gewählter See leuchtet in der geglätteten Form, auch in „Alle“", () => {
        const s = style("landscapes", "alle", { lake: true });
        const fill = layersOf(s).find((layer) => layer.id === AREA_SELECTION_FILL_LAYER_ID) as Layer & {
            source: string;
            filter: unknown;
        };
        expect(fill.source).toBe(WATER_SOURCE_ID);
        expect(JSON.stringify(fill.filter)).toContain("see-1");
    });

    /**
     * Die Karte, wie die Eingabe der Vorschau (`outlineArea`) sie über den gebauten Stil sieht: Welche Ebene und Quelle der Stil trägt,
     * entscheidet dort, welche Kachelquelle sie nach der Form fragt (WI-0266). `gefragt` sammelt die Aufrufe von `querySourceFeatures`.
     */
    function karteDesStils(s: ReturnType<typeof style>, gefragt: ReturnType<typeof vi.fn>): MapLibreMap {
        return {
            on: () => undefined,
            getLayer: (id: string) => (s.layers.some((layer) => layer.id === id) ? {} : undefined),
            getSource: (id: string) =>
                id === AREA_PREVIEW_OUTLINE_SOURCE_ID ? { setData: () => undefined } : id in s.sources ? {} : undefined,
            getZoom: () => 4,
            querySourceFeatures: gefragt,
        } as unknown as MapLibreMap;
    }
    const gebiet = (type: string) => ({ kind: "landscape" as const, id: "x-1", name: "X", type, area: 1 });

    it("🔴 die Vorschau beim Zeigen hat ihre Kontur an der weichen Form (die Eingabe wählt sie, wo diese Ebene steht)", () => {
        const s = style("landscapes", "alle");
        // EINE Vorschau-Ebene an einer kleinen eigenen Quelle: keine unsichtbare Ebene mehr an den Kachelquellen (WI-0266).
        const preview = layersOf(s).find((layer) => layer.id === AREA_PREVIEW_OUTLINE_LAYER_ID) as Layer;
        expect(preview.source).toBe(AREA_PREVIEW_OUTLINE_SOURCE_ID);
        expect(s.sources[AREA_PREVIEW_OUTLINE_SOURCE_ID]).toMatchObject({ type: "geojson" });
        // Wo die weiche Ebene im Stil steht, liest die Eingabe die Form des Sees aus den Kacheln des Wassers ...
        expect(ids(s)).toContain(WATER_FILL_LAYER_ID);
        const see = vi.fn(() => []);
        outlineArea(karteDesStils(s, see), gebiet("see"));
        expect(see).toHaveBeenCalledTimes(1);
        expect(see).toHaveBeenCalledWith(WATER_SOURCE_ID, expect.objectContaining({ sourceLayer: WATER_SOURCE_LAYER }));
        // ... die übrigen Landschaftsflächen bleiben an den Kacheln der Landschaften.
        const wald = vi.fn(() => []);
        outlineArea(karteDesStils(s, wald), gebiet("wald"));
        expect(wald).toHaveBeenCalledTimes(1);
        expect(wald).toHaveBeenCalledWith(LANDSCAPE_SOURCE_ID, expect.anything());
    });

    it("ohne weiche Quelle leuchtet der See, wie er gezeichnet ist: aus den Landschaftskacheln", () => {
        const s = style("landscapes", "alle", { lake: true, withWater: false });
        const fill = layersOf(s).find((layer) => layer.id === AREA_SELECTION_FILL_LAYER_ID) as Layer;
        expect(fill.source).not.toBe(WATER_SOURCE_ID);
        // Auch die Vorschau umreißt den See dann an der Form der Landschaftskacheln, nicht an einer Quelle, die es nicht gibt.
        expect(s.sources).not.toHaveProperty(WATER_SOURCE_ID);
        const see = vi.fn(() => []);
        outlineArea(karteDesStils(s, see), gebiet("see"));
        expect(see).toHaveBeenCalledTimes(1);
        expect(see).toHaveBeenCalledWith(LANDSCAPE_SOURCE_ID, expect.anything());
    });
});

describe("smoothWaterFor: wer zeichnet welches Wasser", () => {
    const water = (view: MapView, selection: LandscapeSelection, display?: Partial<MapDisplay>) => {
        const composition = composeView(view, selection);
        return smoothWaterFor(
            composition,
            effectiveDisplay(view, composition, { ...displayDefaults(view), ...display }),
        );
    };

    it("Topographie: Seen und Meere; ohne „Flüsse und Seen“ nur das Meer", () => {
        expect(water("landscapes", "topographie")).toEqual({ lakes: true, seas: true });
        expect(water("landscapes", "topographie", { rivers: false })).toEqual({ lakes: false, seas: true });
        // „Ebenen“ aus nimmt die Landschaftsflächen weg, nicht das Wasser der Topographie.
        expect(water("landscapes", "topographie", { layers: false })).toEqual({ lakes: true, seas: true });
    });

    it("🔴 „Alle“: Seen UND Meere, wie überall - das Meer auch ohne „Flüsse und Seen“ (Nachtrag zu WI-0083)", () => {
        // Betreiber 2026-10-05: „in alle normal blau“. Vorher kam das Meer dort aus der Füllung der Ebene Topographie.
        expect(water("landscapes", "alle")).toEqual({ lakes: true, seas: true });
        expect(water("landscapes", "alle", { rivers: false })).toEqual({ lakes: false, seas: true });
        // „Ebenen“ aus heißt keine Landschaftsansicht: dann auch kein Wasser von hier.
        expect(water("landscapes", "alle", { layers: false })).toBeUndefined();
    });

    it("🔴 Vegetation und Derographisch: Seen UND Meere, das Meer auch ohne „Flüsse und Seen“ (WI-0083)", () => {
        for (const selection of ["vegetation", "derographisch"] as const) {
            expect(water("landscapes", selection), selection).toEqual({ lakes: true, seas: true });
            expect(water("landscapes", selection, { rivers: false }), selection).toEqual({ lakes: false, seas: true });
            // „Ebenen“ aus heißt keine Landschaftsansicht: dann auch kein Wasser von hier.
            expect(water("landscapes", selection, { layers: false }), selection).toBeUndefined();
        }
    });

    it("Klimazonen: Seen und Meere; ohne „Flüsse und Seen“ nur das Meer, ohne Flächen (keine Bänder) nichts", () => {
        expect(water("landscapes", "klima")).toEqual({ lakes: true, seas: true });
        expect(water("landscapes", "klima", { rivers: false })).toEqual({ lakes: false, seas: true });
        expect(water("landscapes", "klima", { layers: false })).toBeUndefined();
    });

    it("Standard, Politisch, Nur Karte und Kraftlinien: keines", () => {
        for (const view of ["standard", "political", "none", "powerlines"] as const) {
            expect(water(view, "alle"), view).toBeUndefined();
        }
    });
});

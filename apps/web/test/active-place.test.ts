import { describe, expect, it } from "vitest";
import { featureFilter, createPropertyExpression, type LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { composeView, DEFAULT_LANDSCAPE_SELECTION, AVENTURIA_ZOOM_BANDS } from "@avesmaps3d/shared";
import {
    buildPlaceLayers,
    PLACE_ACTIVE_LABEL_LAYER_IDS,
    NODIX_LABEL_LAYER_IDS,
    PLACE_LABEL_LAYER_IDS,
    placeActiveLabelLayerId,
} from "../src/map/place-layers.ts";
import { displayOfComposition } from "../src/map/map-display.ts";
import { propertySpec } from "./style-spec.ts";

const composition = composeView("standard", DEFAULT_LANDSCAPE_SELECTION);
const place = { public_id: "selected", subtype: "dorf", name: "Ausgewähltes Dorf", is_hidden: false };
const layers = (activePlaceId?: string) =>
    buildPlaceLayers({
        labels: true,
        composition,
        activePlaceId,
        display: { ...displayOfComposition(composition), placeClasses: ["metropole"] },
    });
const admits = (layer: LayerSpecification, zoom: number, properties = place) =>
    zoom >= (layer.minzoom ?? 0) &&
    zoom < (layer.maxzoom ?? 24) &&
    featureFilter("filter" in layer ? layer.filter : undefined, "filter").filter(
        { zoom },
        { type: 1, properties } as never,
        undefined as never,
    );

describe("temporär sichtbarer markierter Ort", () => {
    it("überlebt Klassenfilter und Erscheinungsband, aber nur solange er markiert ist", () => {
        for (const zoom of [0, 4, 8]) {
            const marked = layers("selected").find((layer) => layer.id === "place-marker")!;
            expect(admits(marked, zoom)).toBe(true);
            expect(admits(marked, zoom, { ...place, public_id: "other" })).toBe(false);
            expect(
                admits(
                    layers().find((layer) => layer.id === "place-marker")!,
                    zoom,
                ),
            ).toBe(false);
            if (marked.type !== "circle") throw new Error("marker missing");
            const compiled = createPropertyExpression(
                marked.paint?.["circle-radius"],
                "circle-radius",
                propertySpec("paint_circle", "circle-radius"),
            );
            expect(compiled.result).toBe("success");
            if (compiled.result === "success")
                expect(
                    compiled.value.evaluate({ zoom }, { type: "Point", properties: place } as never),
                ).toBeGreaterThan(0);
        }
    });

    it("hat genau einen kollisionsfesten Namen; verborgene Namen bleiben verborgen", () => {
        const named = layers("selected").filter(
            (layer) => layer.type === "symbol" && layer.id.startsWith("place-") && layer.layout?.["text-field"],
        );
        expect(named.filter((layer) => admits(layer, 0))).toHaveLength(1);
        const selected = named.find((layer) => layer.id === placeActiveLabelLayerId(place.subtype));
        expect(selected?.type).toBe("symbol");
        if (selected?.type !== "symbol") throw new Error("selected name missing");
        expect(selected.layout?.["text-allow-overlap"]).toBe(true);
        expect(admits(selected, 8, { ...place, is_hidden: true })).toBe(false);
        expect(layers().some((layer) => PLACE_ACTIVE_LABEL_LAYER_IDS.includes(layer.id))).toBe(false);
    });

    it("lässt jede Ortsklasse in jeder Ansicht erscheinen, ohne fremde Orte mitzunehmen", () => {
        for (const view of ["standard", "none", "landscapes", "political", "powerlines"] as const) {
            const ownComposition = composeView(view, DEFAULT_LANDSCAPE_SELECTION);
            const style = buildPlaceLayers({
                labels: true,
                composition: ownComposition,
                activePlaceId: "selected",
                display: { ...displayOfComposition(ownComposition), placeClasses: [] },
            });
            const markers = style.filter((layer) => ["place-marker", "place-marker-structure"].includes(layer.id));
            const names = style.filter(
                (layer) =>
                    PLACE_LABEL_LAYER_IDS.includes(layer.id) ||
                    PLACE_ACTIVE_LABEL_LAYER_IDS.includes(layer.id) ||
                    NODIX_LABEL_LAYER_IDS.includes(layer.id),
            );
            for (const subtype of Object.keys(AVENTURIA_ZOOM_BANDS.marker)) {
                for (const zoom of [0, 4, 8]) {
                    const selected = { ...place, subtype };
                    expect(
                        markers.filter((layer) => admits(layer, zoom, selected)),
                        `${view}/${subtype}/${zoom}`,
                    ).toHaveLength(1);
                    expect(names.filter((layer) => admits(layer, zoom, selected))).toHaveLength(1);
                    expect(markers.some((layer) => admits(layer, zoom, { ...selected, public_id: "other" }))).toBe(
                        false,
                    );
                }
            }
        }
    });

    it("ändert weder zugelassene fremde Marker noch ihre Namen", () => {
        const plain = buildPlaceLayers({ labels: true, composition });
        const active = buildPlaceLayers({ labels: true, composition, activePlaceId: "selected" });
        for (const subtype of Object.keys(AVENTURIA_ZOOM_BANDS.marker)) {
            for (const zoom of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
                const properties = { ...place, subtype, public_id: "other" };
                for (const id of ["place-marker", ...PLACE_LABEL_LAYER_IDS]) {
                    const before = plain.find((layer) => layer.id === id)!;
                    const after = active.find((layer) => layer.id === id)!;
                    expect(admits(after, zoom, properties)).toBe(admits(before, zoom, properties));
                    if (!admits(before, zoom, properties)) continue;
                    const property = id === "place-marker" ? "circle-radius" : "text-size";
                    const group = id === "place-marker" ? "paint_circle" : "layout_symbol";
                    const value = (layer: LayerSpecification) => {
                        const raw =
                            layer.type === "circle"
                                ? layer.paint?.["circle-radius"]
                                : layer.type === "symbol"
                                  ? layer.layout?.["text-size"]
                                  : undefined;
                        const expression = createPropertyExpression(raw, property, propertySpec(group, property));
                        if (expression.result !== "success") throw new Error("invalid expression");
                        return expression.value.evaluate({ zoom }, { type: "Point", properties } as never);
                    };
                    expect(value(after)).toEqual(value(before));
                }
            }
        }
    });
});

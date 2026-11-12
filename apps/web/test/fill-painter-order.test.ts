import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import {
    composeView,
    LANDSCAPE_SELECTIONS,
    MAP_VIEWS,
    TOPOGRAPHY_VARIANTS,
    type LandscapeSelection,
    type MapView,
    type TopographyVariant,
} from "@avesmaps3d/shared";
import { displayDefaults, effectiveDisplay, type MapDisplay } from "../src/map/map-display.ts";
import { smoothWaterFor } from "../src/map/landscape-layers.ts";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { propertySpec } from "./style-spec.ts";

/**
 * Keine Füllung des Stils hängt vom Tiefenpuffer ab (Betreiber 2026-10-04: „seen auf dem handy (iphone) nicht
 * angezeigt“).
 *
 * MapLibre malt eine Füllung mit konstanter, deckender Farbe und Deckkraft 1 im Opaque-Pass, mit Tiefenpuffer, VOR allen
 * anderen Flächen (`drawFill`, `fillEligibleForOpaque`). Die Flächen darunter im Stil verlieren dann gegen diese Tiefe.
 * Greift der Tiefentest nicht, liegen sie darüber. Der See war genau so eine Füllung: Auf einem solchen Gerät blieb von
 * ihm nur die Kante, während Flüsse, Orte und alles übrige stand. Jede Füllung hier muss deshalb in der Reihenfolge des
 * Stils gemalt werden, nicht nach Tiefe: ihre Farbe oder ihre Deckkraft ist keine Konstante, oder sie trägt ein Muster.
 *
 * 🪤 Die Probe liest MapLibres eigene Regel (`kind === "constant"`), nicht eine Nachschrift davon. Dass der Browser
 * wirklich ohne Tiefentest den See zeichnet, misst `e2e/lakes-without-depth.spec.ts`.
 */

type Fill = { id: string; type: string; paint?: Record<string, unknown> };

/** Der Wert einer Eigenschaft, wenn MapLibre sie als Konstante führt (`constantOr`); sonst `undefined`. */
function constantValue(layer: Fill, property: string, fallback: unknown): unknown {
    const value = layer.paint?.[property] ?? fallback;
    const compiled = createPropertyExpression(value, property, propertySpec("paint_fill", property));
    if (compiled.result !== "success") {
        throw new Error(`${layer.id}.${property} ist kein gültiger Ausdruck: ${JSON.stringify(compiled.value)}`);
    }
    return compiled.value.kind === "constant" ? compiled.value.evaluate({ zoom: 0 }) : undefined;
}

/**
 * MapLibres Bedingung für den Opaque-Pass einer Füllung (`draw_fill.ts`): Farbe konstant und deckend, Deckkraft
 * konstant 1, kein Muster. Fehlt die Angabe, gilt MapLibres Vorgabe (Schwarz, Deckkraft 1).
 */
function opaquePassEligible(layer: Fill): boolean {
    if (layer.type !== "fill" || layer.paint?.["fill-pattern"] !== undefined) {
        return false;
    }
    const colour = constantValue(layer, "fill-color", "#000000") as { a: number } | undefined;
    return colour?.a === 1 && constantValue(layer, "fill-opacity", 1) === 1;
}

function fillLayers(
    view: MapView,
    selection: LandscapeSelection,
    topography: TopographyVariant,
    display: MapDisplay,
    smooth: boolean,
): Fill[] {
    const composition = composeView(view, selection, topography);
    const zeige = effectiveDisplay(view, composition, display);
    return buildPlaceLayers({
        labels: false,
        composition,
        display: zeige,
        territoryData: true,
        areaSelection: undefined,
        // Mit der geglätteten Wasserquelle (die App) und ohne (der Rückfall: der See aus den Landschaftskacheln).
        smoothWater: smooth ? smoothWaterFor(composition, zeige) : undefined,
        topography: {
            contours: composition.contours,
            contourDetail: composition.contours,
            heightTint: composition.heightTints,
            peaks: composition.peaks,
            locale: "de",
        },
    }).filter((layer) => layer.type === "fill") as Fill[];
}

describe("jede Füllung wird in der Reihenfolge des Stils gemalt", () => {
    it("🔴 keine Füllung ist für MapLibres Opaque-Pass geeignet, in keiner Ansicht und keiner Schalterstellung", () => {
        let geprueft = 0;
        const seen = new Set<string>();
        for (const view of MAP_VIEWS) {
            const vorgabe = displayDefaults(view);
            const stellungen: MapDisplay[] = [
                vorgabe,
                { ...vorgabe, rivers: !vorgabe.rivers },
                { ...vorgabe, layers: !vorgabe.layers },
                { ...vorgabe, rivers: true, layers: true, labels: true, paths: true, borders: true },
            ];
            for (const selection of LANDSCAPE_SELECTIONS) {
                for (const topography of TOPOGRAPHY_VARIANTS) {
                    for (const display of stellungen) {
                        for (const smooth of [true, false]) {
                            for (const layer of fillLayers(view, selection, topography, display, smooth)) {
                                geprueft += 1;
                                seen.add(layer.id);
                                expect(
                                    opaquePassEligible(layer),
                                    `${layer.id} (${view}/${selection}/${topography}, geglättet: ${String(smooth)}) hängt vom Tiefenpuffer ab`,
                                ).toBe(false);
                            }
                        }
                    }
                }
            }
        }
        // Die Probe prüft etwas: der See, das Wasser der Topographie und die Landschaftsflächen sind dabei.
        expect(geprueft).toBeGreaterThan(100);
        for (const id of ["landscape-fill-see", "gewaesser-flaeche", "landscape-fill-vegetation"]) {
            expect(seen.has(id), `${id} kam in keiner Stellung vor`).toBe(true);
        }
    });

    it("die Probe erkennt eine Füllung, die vom Tiefenpuffer abhängt", () => {
        const konstant: Fill = { id: "x", type: "fill", paint: { "fill-color": "#4c89c6", "fill-opacity": 1 } };
        expect(opaquePassEligible(konstant)).toBe(true);
        expect(opaquePassEligible({ ...konstant, paint: { "fill-color": "#4c89c6" } })).toBe(true);
        expect(opaquePassEligible({ ...konstant, paint: { "fill-color": "#4c89c6", "fill-opacity": 0.5 } })).toBe(
            false,
        );
        expect(
            opaquePassEligible({
                ...konstant,
                paint: {
                    "fill-color": ["match", ["get", "region_type"], "see", "#4c89c6", "#4c89c6"],
                    "fill-opacity": 1,
                },
            }),
        ).toBe(false);
        expect(
            opaquePassEligible({
                ...konstant,
                paint: { "fill-color": "#4c89c6", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 1] },
            }),
        ).toBe(false);
    });
});

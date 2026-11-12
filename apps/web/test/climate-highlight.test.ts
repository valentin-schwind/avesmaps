import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import { AVENTURIA_CARTOGRAPHY, composeView, DESIGN_CANON } from "@avesmaps3d/shared";
import { CLIMATE_SOURCE_ID } from "../src/map/landscape-layers.ts";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Die gewählte Klimazone (Klick, Suche, Objektlink) steht kräftiger als die übrigen (Betreiberwunsch 2026-09-23:
 * „weniger Transparenz“; seit 2026-10-05 deckend, die übrigen zu 50 %), bis eine andere Auswahl kommt.
 *
 * 🪤 Gemessen wird die Deckkraft, die MapLibres eigener Auswerter für ein Band ausrechnet, nicht
 * die Form des Ausdrucks.
 */

/** Die Deckkraft, mit der `climate-fill` die Zone `zone` zeichnet. */
function deckkraft(hervorgehoben: string | undefined, zone: string): number {
    const layers = buildPlaceLayers({
        labels: true,
        composition: composeView("landscapes", "klima"),
        highlightedClimateZone: hervorgehoben,
    });
    const layer = findLayer(layers, "climate-fill", "fill");
    if (!layer) {
        throw new Error("climate-fill fehlt in der Klimaansicht");
    }
    const compiled = createPropertyExpression(
        layer.paint?.["fill-opacity"],
        "fill-opacity",
        propertySpec("paint_fill", "fill-opacity"),
    );
    if (compiled.result !== "success") {
        throw new Error("fill-opacity ungültig");
    }
    return compiled.value.evaluate({ zoom: 2 }, { type: "Polygon", properties: { type_key: zone } } as never) as number;
}

describe("Die gewählte Klimazone", () => {
    it("🔴 50 % normal, 100 % die gewählte (Betreiber 2026-10-05: „also 50% normal, 100% bei einem klick“)", () => {
        expect(deckkraft(undefined, "subtropisch")).toBe(0.5);
        expect(deckkraft("trockene_subtropen", "subtropisch")).toBe(0.5);
        expect(deckkraft("trockene_subtropen", "trockene_subtropen")).toBe(1);
        // Die Zahlen stehen in den Tafeln, nicht im Bauteil.
        expect(AVENTURIA_CARTOGRAPHY.layers["klima"]?.fillOpacity).toBe(0.5);
        // Eine Deckkraft: Klima steht nur in seiner eigenen Ebene („Alle“ zeigt es nicht, Betreiber 2026-10-05).
        expect(AVENTURIA_CARTOGRAPHY.layers["klima"]?.fillOpacityAlone).toBeUndefined();
        expect(DESIGN_CANON.mapSelection.bandOpacity).toBe(1);
    });

    it("🔴 steht kräftiger als ihre Nachbarn", () => {
        expect(deckkraft("trockene_subtropen", "trockene_subtropen")).toBeGreaterThan(
            deckkraft("trockene_subtropen", "subtropisch"),
        );
    });

    it("🪤 lässt die übrigen Zonen so, wie sie ohne Auswahl stehen", () => {
        expect(deckkraft("trockene_subtropen", "subtropisch")).toBe(deckkraft(undefined, "subtropisch"));
        // Ohne Auswahl sind alle gleich: nach dem Klick ist nichts mehr hervorgehoben.
        expect(deckkraft(undefined, "trockene_subtropen")).toBe(deckkraft(undefined, "subtropisch"));
    });

    it("💣 legt auf der Standardkarte nichts darüber: die Ansicht wechselt stattdessen", () => {
        // Betreiberentscheidung 2026-09-23: kein Band über dem Gelände. Die Suche schaltet auf die
        // Klimaansicht; die Hervorhebung allein fügt keiner Ansicht eine Ebene hinzu.
        const layers = buildPlaceLayers({
            labels: true,
            composition: composeView("standard", "alle"),
            highlightedClimateZone: "trockene_subtropen",
        });
        expect(layers.filter((layer) => "source" in layer && layer.source === CLIMATE_SOURCE_ID)).toEqual([]);
    });
});

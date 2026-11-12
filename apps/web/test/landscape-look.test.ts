import { describe, expect, it } from "vitest";
import { AVENTURIA_PATH_CARTOGRAPHY, composeView, type LandscapeSelection } from "@avesmaps3d/shared";
import { buildPlaceLayers } from "../src/map/place-layers.ts";

/**
 * Wie die Landschaftsansichten ihre Flächen zeichnen (Betreiber 2026-09-28):
 * 1. Seen ohne Transparenz, wie Flüsse;
 * 2. Vegetation in ihrer eigenen Ansicht wirklich sichtbar;
 * 3. Klimazonen in ihrer eigenen Ansicht deutlich weniger transparent;
 * 4. derographische Flächen gestrichelt umrandet.
 */

type Layer = { id: string; paint?: Record<string, unknown> };

function layers(selection: LandscapeSelection, rivers = true): Layer[] {
    const composition = composeView("landscapes", selection);
    return buildPlaceLayers({
        labels: false,
        composition,
        display: {
            landscapeAreas: true,
            placeClasses: [],
            landPaths: false,
            rivers,
            flow: false,
            riverNames: false,
            territories: false,
            territoryCapitals: false,
            borders: undefined,
            borderNames: false,
            claimHatch: false,
            mapLabels: false,
            labelLayers: [],
            hideLakes: !rivers,
        },
    }) as Layer[];
}
const paint = (all: Layer[], id: string, key: string): unknown => all.find((layer) => layer.id === id)?.paint?.[key];

describe("Aussehen der Landschaftsansichten", () => {
    it("zeichnet Seen deckend in der Wasserfarbe, in jeder Auswahl über allen Flächen", () => {
        const water = AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"]?.center;
        for (const selection of ["alle", "topographie", "vegetation", "klima", "derographisch"] as const) {
            const all = layers(selection);
            // Die Farbe ist ein Ausdruck, keine Konstante: So bleibt der See in der Zeichenreihenfolge und hängt nicht vom
            // Tiefenpuffer ab (`fill-painter-order.test.ts`). Gleiche Farbe für jede Art, auch für den Auffangwert.
            expect(paint(all, "landscape-fill-see", "fill-color"), selection).toEqual([
                "match",
                ["get", "region_type"],
                "see",
                water,
                water,
            ]);
            expect(paint(all, "landscape-fill-see", "fill-opacity"), selection).toBe(1);
            const fills = all.map((layer) => layer.id).filter((id) => id.startsWith("landscape-fill-"));
            expect(fills[fills.length - 1], selection).toBe("landscape-fill-see");
        }
        // Der Schalter „Flüsse und Seen“ nimmt sie weg, und außerhalb der Landschaften malt sie das Kachelbild.
        expect(layers("alle", false).some((layer) => layer.id === "landscape-fill-see")).toBe(false);
        const standard = buildPlaceLayers({ labels: false, composition: composeView("standard", "alle") }) as Layer[];
        expect(standard.some((layer) => layer.id === "landscape-fill-see")).toBe(false);
    });

    it("🔴 stellt die Vegetation allein und in „Alle“ zu 60 %, damit ihre Arten unterscheidbar bleiben (OPS-000072, Betreiber 2026-10-30)", () => {
        // „0,6 passt“ und „du kannst auch in "alle" 0,6 für die vegetation machen“; bei 0,26 lagen Wald und Aue farblich kaum auseinander.
        const allein = paint(layers("vegetation"), "landscape-fill-vegetation", "fill-opacity");
        expect(allein).toBe(0.6);
        expect(paint(layers("alle"), "landscape-fill-vegetation", "fill-opacity")).toBe(0.6);
    });

    it("zeichnet die Klimazonen nur in ihrer eigenen Ebene, dort zu 50 %; „Alle“ zeigt keine (Betreiber 2026-10-05)", () => {
        // „Wenn ich auf "Alle" klick, sollen keine klimazonen mehr angezeigt werden“; „also 50% normal, 100% bei einem klick“
        // (die Auswahl: `climate-highlight.test.ts`).
        expect(paint(layers("klima"), "climate-fill", "fill-opacity")).toBe(0.5);
        const alle = layers("alle").map((layer) => layer.id);
        for (const id of ["climate-fill", "climate-line", "climate-label"]) expect(alle, id).not.toContain(id);
        expect(composeView("landscapes", "alle").landscapeLayers).not.toContain("klima");
    });

    it("🔴 OPS-000039: Topographie und Vegetation haben eine kräftige Kante, 1,5 px deckend; keine Ebene hat einen Saum (WI-0266)", () => {
        // Thomas über den Betreiber 2026-10-19: „kräftige kante“ (Probierseite „Topographie über dem Untergrund“); für die Vegetation
        // wählte der Betreiber 2026-10-20 „A Ja, wie Topographie (Empfehlung)“. Den hellen Saum darunter nahm er am 2026-10-31 heraus: „ganz weg“.
        for (const [auswahl, ebene] of [
            ["topographie", "topographie"],
            ["alle", "topographie"],
            ["vegetation", "vegetation"],
            ["alle", "vegetation"],
        ] as const) {
            const stil = layers(auswahl);
            expect(paint(stil, `landscape-line-${ebene}`, "line-width")).toBe(1.5);
            expect(paint(stil, `landscape-line-${ebene}`, "line-opacity")).toBe(1);
            expect(stil.map((layer) => layer.id).filter((id) => id.startsWith("landscape-saum-"))).toEqual([]);
        }
    });

    it("strichelt die Kanten der derographischen Flächen", () => {
        expect(paint(layers("derographisch"), "landscape-line-derographisch", "line-dasharray")).toBeInstanceOf(Array);
        expect(paint(layers("vegetation"), "landscape-line-vegetation", "line-dasharray")).toBeUndefined();
    });
});

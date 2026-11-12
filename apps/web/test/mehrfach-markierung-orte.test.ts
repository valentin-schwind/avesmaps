import { describe, expect, it } from "vitest";
import type { CircleLayerSpecification } from "maplibre-gl";
import { DEFAULT_LANDSCAPE_SELECTION } from "@avesmaps3d/shared";
import type { Mehrfachmarkierung } from "../src/map/mehrfach-markierung";
import { buildPlaceStyle, PLACE_SELECTION_LAYER_ID } from "../src/map/place-layers";

/**
 * Angehakte Orte auf der Karte (Betreiber 2026-10-20: „auf der karte, gelb markier wär auch toll“; WI-0243): Sie bekommen den gelben
 * Kreis der Einzelauswahl (`place-selection`), auch zusammen mit dem gewählten Ort. Problemfälle: Ein angehakter Ort leuchtet nicht oder in
 * einer zweiten Ebene mit anderer Farbe; ohne Haken und ohne Wahl steht der Kreis trotzdem.
 */
const GRATENFELS = "11111111-0000-4000-8000-000000000001";
const FERDOK = "11111111-0000-4000-8000-000000000002";
const ANGBAR = "11111111-0000-4000-8000-000000000003";

function kreis(activePlaceId: string | undefined, mehrfach: readonly Mehrfachmarkierung[]) {
    const stil = buildPlaceStyle({
        tileUrl: "/v/place/{z}/{x}/{y}",
        landscapeUrl: "/v/landscape/{z}/{x}/{y}",
        landscapeRunUrl: "/v/run/{z}/{x}/{y}",
        mapLabelUrl: "/v/label/{z}/{x}/{y}",
        climateUrl: "/v/climate/{z}/{x}/{y}",
        pathUrl: "/v/path/{z}/{x}/{y}",
        pathLabelUrl: "/v/path-label/{z}/{x}/{y}",
        powerlineUrl: "/v/powerline/{z}/{x}/{y}",
        leyNodeUrl: "/v/ley-node/{z}/{x}/{y}",
        basemap: undefined,
        seriesId: "original",
        view: "standard",
        landscapeSelection: DEFAULT_LANDSCAPE_SELECTION,
        activePlaceId,
        mehrfachMarkierung: mehrfach,
    });
    return stil.layers.find((ebene) => ebene.id === PLACE_SELECTION_LAYER_ID) as CircleLayerSpecification | undefined;
}

describe("Mehrfachmarkierung der Orte (WI-0243)", () => {
    it("🔴 angehakte Orte stehen im Kreis der Einzelauswahl, zusammen mit dem gewählten; ohne beides kein Kreis", () => {
        expect(kreis(undefined, [])).toBeUndefined();
        const einzeln = kreis(GRATENFELS, []);
        const drei = kreis(undefined, [{ art: "place", ids: [GRATENFELS, FERDOK, ANGBAR] }]);
        expect(drei).toBeDefined();
        expect(JSON.stringify(drei!.filter)).toContain(FERDOK);
        expect(JSON.stringify(drei!.filter)).toContain(ANGBAR);
        // Dieselbe Farbe und Form wie der einzeln gewählte.
        expect(drei!.paint).toEqual(einzeln!.paint);
        const beides = kreis(GRATENFELS, [{ art: "place", ids: [FERDOK] }]);
        expect(JSON.stringify(beides!.filter)).toContain(GRATENFELS);
        expect(JSON.stringify(beides!.filter)).toContain(FERDOK);
    });
});

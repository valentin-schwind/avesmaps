import type { LayerSpecification, LineLayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { canonColour } from "@avesmaps3d/shared";
import { AREA_SELECTION_LINE_LAYER_ID, buildAreaSelectionLayers } from "./area-selection";

/**
 * Die Fläche, die im Untermenü von „Flächen vereinigen ›“ gerade gezeigt wird, auf der Karte (WI-0252): ihr Umriss leuchtet Knallrot
 * (`editEdge`) auf weißem Saum, wie ein gezeigter Abschnitt im Untermenü der Wege (`wegeditor/abschnitte-leuchten.ts`). Die gewählten
 * stehen ohnehin golden (Mehrfachauswahl); so sieht man, welche davon die Vorlage würde.
 *
 * Gezeichnet wird aus den Kacheln der Flächen über dieselbe Quelle und denselben Filter wie die Auswahl (`buildAreaSelectionLayers`,
 * beim Gebiet nur das Band der Ansicht): keine zweite Geometrie, kein Server. Liegt die Kachelquelle nicht im Stil, leuchtet nichts.
 */

const SAUM = "flaechen-vereinigen-saum";
const HERVOR = "flaechen-vereinigen-hervor";

export interface FlaechenBild {
    readonly art: "landscape" | "territory";
    /** Die gezeigte Fläche (Landschaft oder Gebiet); leer: nichts. */
    readonly hervor: readonly string[];
}

export interface FlaechenLeuchten {
    zeige(bild: FlaechenBild | undefined): void;
}

export function createFlaechenLeuchten(karte: () => MapLibreMap | undefined): FlaechenLeuchten {
    let gezeigt = "";
    return {
        zeige(bild) {
            const map = karte();
            const schluessel =
                bild === undefined || bild.hervor.length === 0 ? "" : `${bild.art}:${bild.hervor.join(",")}`;
            if (map === undefined || schluessel === gezeigt) return;
            for (const id of [HERVOR, SAUM]) if (map.getLayer(id) !== undefined) map.removeLayer(id);
            gezeigt = "";
            if (bild === undefined || bild.hervor.length === 0) return;
            const linie = buildAreaSelectionLayers({
                kind: bild.art,
                id: bild.hervor[0]!,
                group: bild.hervor,
                name: null,
                type: "",
                anchor: { x: 0, y: 0 },
            }).find((ebene): ebene is LineLayerSpecification => ebene.id === AREA_SELECTION_LINE_LAYER_ID);
            if (linie === undefined || map.getSource(linie.source) === undefined) return;
            const herkunft = {
                source: linie.source,
                ...(linie["source-layer"] === undefined ? {} : { "source-layer": linie["source-layer"] }),
                ...(linie.filter === undefined ? {} : { filter: linie.filter }),
            };
            const ebenen: LayerSpecification[] = [
                {
                    id: SAUM,
                    type: "line",
                    ...herkunft,
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: {
                        "line-color": canonColour("routeHalo"),
                        "line-width": 9,
                        "line-blur": 3,
                        "line-opacity": 0.9,
                    },
                },
                {
                    id: HERVOR,
                    type: "line",
                    ...herkunft,
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: { "line-color": canonColour("editEdge"), "line-width": 3.5 },
                },
            ];
            for (const ebene of ebenen) map.addLayer(ebene);
            gezeigt = schluessel;
        },
    };
}

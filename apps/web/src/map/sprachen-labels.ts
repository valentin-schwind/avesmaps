import type { Map as MapLibreMap } from "maplibre-gl";

import type { Insets } from "./camera/visible-area";
import { installAreaLabels, type AreaLabels, type AreaLabelSpec } from "./area-labels";
import {
    SPRACHE_FILL_LAYER_ID,
    SPRACHE_LABEL_LAYER_ID,
    SPRACHE_LABEL_SOURCE_ID,
    SPRACHE_SOURCE_ID,
    SPRACHE_SOURCE_LAYER,
    sprachNamensFarben,
} from "./sprachen-layers";

/**
 * Die Namen der Sprachen auf der Karte (WI-0261 S5a, E5: „die labels der flächen können bei den sprachen auch so angezeigt werden
 * wie bei den klimazonen“): dieselbe Mechanik wie die Klimazonen (`area-labels.ts`). Schlüssel, Name und Farbe kommen aus der
 * Kachel der Sprachfläche (`schluessel`, `name`, `farbe`); die Farben des Namens rechnet `sprachNamensFarben`.
 *
 * 🔴 Anders als Klimazonen überlappen Sprachen (E2): Ein Name, der auf einen schon gesetzten träfe, rückt im eigenen sichtbaren
 * Teil an die nächste freie Stelle, statt wegzufallen, und braucht auch in der Breite Platz (`ausweichen`; Bauvorlage
 * `namenZiele`).
 */
const FARBE = /^#[0-9a-f]{6}$/u;

export const SPRACH_LABELS: AreaLabelSpec = {
    sourceId: SPRACHE_SOURCE_ID,
    sourceLayer: SPRACHE_SOURCE_LAYER,
    fillLayerId: SPRACHE_FILL_LAYER_ID,
    labelSourceId: SPRACHE_LABEL_SOURCE_ID,
    labelLayerId: SPRACHE_LABEL_LAYER_ID,
    bandOf(properties) {
        const key = properties["schluessel"];
        const name = properties["name"];
        if (typeof key !== "string" || key === "" || typeof name !== "string" || name.trim() === "") return undefined;
        const farbe = properties["farbe"];
        return {
            key,
            name,
            ...(typeof farbe === "string" && FARBE.test(farbe) ? { properties: sprachNamensFarben(farbe) } : {}),
        };
    },
    ausweichen: true,
};

export function installSprachLabels(map: MapLibreMap, options: { insets: () => Partial<Insets> }): AreaLabels {
    return installAreaLabels(map, SPRACH_LABELS, options);
}

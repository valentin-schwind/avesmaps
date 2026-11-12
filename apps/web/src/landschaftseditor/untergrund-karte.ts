import { watch } from "vue";
import { BASEMAP_LAYER_ID, untergrundDeckkraft } from "../map/place-layers";
import { HEIGHT_TINT_LAYER_ID } from "../map/topography-layers";
import { untergrund } from "./untergrund";

/**
 * Wie der Regler „Untergrund“ (WI-0178 T47) die Karte erreicht. Was eine Ansicht zeigt, entscheidet weiter allein `composeView`; hier
 * steht nur, wann der Wert dorthin geht und wie ein neuer Wert ohne Neuzeichnen ankommt.
 *
 * - **Im Stil** nur für Editoren am Rechner, wo der Regler steht (Ebenenleiste, Leiste von „Neue Fläche“). Am Telefon und für Besucher
 *   bleibt der Untergrund in der Derographie aus wie bisher.
 * - **Beim Ziehen** stellt ein neuer Wert nur die Deckkraft der Rasterebene (Legacy `applyEcosystemUndergroundOpacity`,
 *   `map-features-ecosystem-layer-switch.js#L716-760`), über den Höhenstufen mit derselben Mischung wie beim Bau (`untergrundDeckkraft`).
 *   Kommt der Untergrund erst dazu oder geht er (0 %: keine Ebene, keine Kacheln), baut der Stil neu.
 */
export function untergrundImStil(editor: boolean, telefon: boolean): number | undefined {
    return editor && !telefon ? untergrund.value : undefined;
}

interface Karte {
    getLayer(id: string): unknown;
    setPaintProperty(layer: string, name: string, value: unknown): unknown;
}

export function beobachteUntergrund(karte: () => Karte | undefined, ansicht: () => string, neuBauen: () => void): void {
    watch(untergrund, (wert, vorher) => {
        if (ansicht() !== "landscapes") return;
        const jetzt = karte();
        if (jetzt === undefined) return;
        if (wert > 0 && vorher > 0 && jetzt.getLayer(BASEMAP_LAYER_ID) !== undefined) {
            const ueberStufen = jetzt.getLayer(HEIGHT_TINT_LAYER_ID) !== undefined;
            jetzt.setPaintProperty(BASEMAP_LAYER_ID, "raster-opacity", untergrundDeckkraft(wert / 100, ueberStufen));
            return;
        }
        neuBauen();
    });
}

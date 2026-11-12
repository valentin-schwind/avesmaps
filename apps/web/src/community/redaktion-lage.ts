import { watch } from "vue";
import type { GeoJSONSource, GeoJSONSourceSpecification, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { nachStilwechsel, styleTakesChanges, whenStyleTakesChanges } from "../map/style-ready";
import { lageDaten, lageEbenen } from "./lage-vorschlag";
import type { Redaktion } from "./redaktion";

/**
 * Der Geist der vorgeschlagenen Lage im Vorgangsfenster der Redaktion (WI-0268 C3; Bedienkonzept §2.2 Nr. 3): derselbe Geist mit gestrichelter Linie wie im Meldeformular der Besucher
 * (`lage-vorschlag.ts`: dieselben Daten, dieselben Ebenen, dieselben Töne), nur zum ANZEIGEN. Die Karte ändert sich nie (`map_mutation = false`); übernommen wird eine Lage allein im Editor.
 *
 * - 🔴 **Eigene Quelle, eigene Ebenen** (`community-vorgang-lage…`), damit der Geist eines offenen Meldeformulars und der eines Vorgangs einander nicht überschreiben; nicht anklickbar, kein Name steht in
 *   einer Liste des Koordinators, die Klicks gehen durch.
 * - Ein Stilwechsel nimmt Quelle und Ebenen mit; sie kommen im nächsten Bild wieder (`nachStilwechsel`).
 */

const QUELLE = "community-vorgang-lage";
const VORLAGE_QUELLE = "community-lage";

/** Die Ebenen des Besuchergeists unter anderem Namen, auf die eigene Quelle gelegt. */
export function vorgangEbenen(): LayerSpecification[] {
    return lageEbenen().map(
        (ebene) =>
            ({
                ...ebene,
                id: ebene.id.replace(VORLAGE_QUELLE, QUELLE),
                source: QUELLE,
            }) as LayerSpecification,
    );
}

export interface VorgangLageKarte {
    destroy(): void;
}

export function installVorgangLage(
    map: MapLibreMap,
    umfeld: { readonly steuerung: Pick<Redaktion, "vorschlag"> },
): VorgangLageKarte {
    const ebenen = vorgangEbenen();
    const nimmWeg = (): void => {
        if (!styleTakesChanges(map)) return;
        for (const ebene of ebenen) if (map.getLayer(ebene.id) !== undefined) map.removeLayer(ebene.id);
        if (map.getSource(QUELLE) !== undefined) map.removeSource(QUELLE);
    };
    const lege = (): void => {
        if (!styleTakesChanges(map)) return;
        const daten = lageDaten(umfeld.steuerung.vorschlag.value);
        if (daten.features.length === 0) {
            nimmWeg();
            return;
        }
        const inhalt = daten as unknown as GeoJSONSourceSpecification["data"];
        const quelle = map.getSource(QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(QUELLE, { type: "geojson", data: inhalt });
        else quelle.setData(inhalt as Parameters<GeoJSONSource["setData"]>[0]);
        for (const ebene of ebenen) if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
    };
    const stopVorschlag = watch(umfeld.steuerung.vorschlag, () => whenStyleTakesChanges(map, lege), {
        immediate: true,
        flush: "sync",
    });
    const stopStil = nachStilwechsel(map, lege);
    let ab = false;
    const destroy = (): void => {
        if (ab) return;
        ab = true;
        stopVorschlag();
        stopStil();
        nimmWeg();
    };
    map.once("remove", destroy);
    return { destroy };
}

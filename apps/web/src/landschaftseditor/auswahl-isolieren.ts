import { computed, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { WATER_AREA_TYPES } from "@avesmaps3d/shared";
import {
    CLIMATE_LABEL_SOURCE_ID,
    CLIMATE_SOURCE_ID,
    LANDSCAPE_RUN_SOURCE_ID,
    LANDSCAPE_SOURCE_ID,
    MAP_LABEL_SOURCE_ID,
} from "../map/landscape-layers";

/**
 * „Auswahl isolieren“ in der Leiste „Ecken bearbeiten“ (WI-0178, Vali 2026-11-09, wörtlich: „einen kleinen button "Auswahl
 * isolieren" einfügen, der temporär (solange nicht fertig) für den editor alle anderen flächen ausblendet (und wieder einblendet) und
 * wieder einblendet wenn fertig“).
 *
 * - **Nur die Darstellung:** Der Stil der Karte zeichnet von den Flächen der Derographie (Regionen, Vegetation, Topographie, Klimazonen)
 *   nur noch die bearbeitete (`isoliereStil`), ebenso ihre Namen. Seen und Meere bleiben samt Namen (Wasser wie die Flüsse, Betreiber
 *   2026-09-28; Stage-Probe 2026-11-09: „Rickensee“ verlor sonst seinen Namen), ebenso Flüsse, Wege, Orte und Gipfel. Dazu nimmt die
 *   Seite die übrigen Zeichnungen von Flächen auf dieselbe Fläche zurück (`nurIsolierte`): die für Besucher verborgenen, die Schraffur
 *   fremder Sperren und Flächen im Entwurf.
 * - 🔴 **Andocken bleibt:** Die Andockziele des Modus kommen vom Server, nach den Ebenen, die die Karte zeigt (`ecken-anbindung.ts`,
 *   `ebenen`). Das Isolieren ändert keine Ebene, also rasten Ecken weiter an Nachbarn ein, und gemeinsame Kanten ziehen mit; die
 *   mitgezogenen Nachbarn zeichnet der Modus wie immer gestrichelt.
 * - **Nur solange der Modus läuft:** Endet „Ecken bearbeiten“ (Fertig, Esc, Fenster abgelegt, ein anderer Modus) oder wechselt er zu
 *   einer anderen Fläche, ist der Knopf wieder aus. „Verwerfen“ lässt den Modus stehen (F20) und schaltet ihn ebenfalls aus
 *   (`aus`, von der Leiste). Nichts wird gespeichert, weder in Einstellungen noch in der Adresse.
 * - **Taste I** schaltet um, solange der Modus läuft; nicht in Eingabefeldern und nicht mit Strg, Alt oder Umschalt.
 */

/** Die Quellen der Flächen der Derographie und ihrer Namen; jede ihrer Ebenen zeigt beim Isolieren nur die bearbeitete Fläche. */
const FLAECHEN_QUELLEN: ReadonlySet<string> = new Set([
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_RUN_SOURCE_ID,
    MAP_LABEL_SOURCE_ID,
    CLIMATE_SOURCE_ID,
    CLIMATE_LABEL_SOURCE_ID,
]);
/**
 * Der Stil mit nur dieser Fläche aus den Quellen der Derographie; ohne Fläche unverändert. Der eigene Filter jeder Ebene bleibt und
 * bekommt die Kennung dazu, ihre Zoombänder und Ebenenwahl gelten weiter.
 */
export function isoliereStil(stil: StyleSpecification, flaeche: string | undefined): StyleSpecification {
    if (flaeche === undefined) return stil;
    // Die bearbeitete Fläche und alles Wasser (See, Meer) samt Namen; was keine Art trägt (Klimazonen), geht.
    const nurSie = [
        "any",
        ["==", ["get", "region_public_id"], flaeche],
        ["in", ["coalesce", ["get", "region_type"], ""], ["literal", [...WATER_AREA_TYPES]]],
    ];
    const layers = stil.layers.map((layer) => {
        if (!("source" in layer) || !FLAECHEN_QUELLEN.has(layer.source)) return layer;
        const eigener = (layer as { filter?: unknown }).filter;
        return { ...layer, filter: eigener === undefined ? nurSie : ["all", eigener, nurSie] } as LayerSpecification;
    });
    return { ...stil, layers };
}

/** Von einer Liste gezeichneter Flächen nur die isolierte; ohne Isolieren alle. */
export function nurIsolierte<T>(zeilen: readonly T[], flaeche: string | undefined, kennung: (zeile: T) => string): T[] {
    return flaeche === undefined ? [...zeilen] : zeilen.filter((zeile) => kennung(zeile) === flaeche);
}

export interface AuswahlIsolieren {
    /** Ist der Knopf gedrückt? */
    readonly an: Readonly<Ref<boolean>>;
    /** Die Fläche, die allein steht; ohne Isolieren keine. */
    readonly flaeche: ComputedRef<string | undefined>;
    umschalten(): void;
    aus(): void;
    destroy(): void;
}

type Tasten = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export function createAuswahlIsolieren(optionen: {
    /** Die Landschaft des laufenden Modus „Ecken bearbeiten“; ohne Modus keine. */
    laufend: () => string | undefined;
    /** Wo die Taste I gehört wird; ohne Angabe nirgends. */
    tasten?: Tasten | undefined;
}): AuswahlIsolieren {
    const an = shallowRef(false);
    const flaeche = computed(() => (an.value ? optionen.laufend() : undefined));
    const umschalten = (): void => {
        if (optionen.laufend() !== undefined) an.value = !an.value;
    };

    // 🪤 In der Capture-Phase wie R („Rundung“, `map/geometrie/modus.ts`): Ein Kürzel der Seite bekäme die Taste sonst zuerst.
    const taste = (event: Event): void => {
        const k = event as KeyboardEvent;
        if (typeof k.key !== "string" || k.key.toLowerCase() !== "i") return;
        if (k.ctrlKey || k.metaKey || k.altKey || k.shiftKey) return;
        const ziel = k.target as Partial<Pick<Element, "closest">> | null;
        if (ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        k.preventDefault();
        if (k.repeat) return;
        umschalten();
    };
    let hoert = false;
    const hoere = (ja: boolean): void => {
        if (optionen.tasten === undefined || ja === hoert) return;
        hoert = ja;
        if (ja) optionen.tasten.addEventListener("keydown", taste, { capture: true });
        else optionen.tasten.removeEventListener("keydown", taste, { capture: true });
    };

    // Ein Ende des Modus oder eine andere Fläche: aus. Synchron, damit nie eine fremde Fläche für einen Takt allein steht.
    const stop = watch(
        optionen.laufend,
        (jetzt, vorher) => {
            if (jetzt !== vorher) an.value = false;
            hoere(jetzt !== undefined);
        },
        { flush: "sync", immediate: true },
    );

    return {
        an,
        flaeche,
        umschalten,
        aus: () => {
            an.value = false;
        },
        destroy: () => {
            stop();
            hoere(false);
        },
    };
}

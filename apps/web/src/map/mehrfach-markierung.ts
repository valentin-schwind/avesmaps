import { computed, shallowRef, watch, type ComputedRef, type WatchStopHandle } from "vue";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { alsMehrfachauswahl } from "../editor-liste/mehrfachauswahl";
import { DESIGN_CANON, canonColour } from "@avesmaps3d/shared";
import { buildAreaSelectionLayers, pathSelectionWidth, type AreaKind } from "./area-selection";
import { PATH_SOURCE_ID, PATH_SOURCE_LAYER } from "./path-layers";
import { PEAK_SOURCE_ID, PEAK_SOURCE_LAYER } from "./topography-layers";

/**
 * Die Mehrfachauswahl auf der Karte (Betreiber 2026-10-20 zur Mehrfachauswahl, wörtlich: „man sieht nur bei den eigenschaften was mehrfach
 * selektiert wurde -> auf der karte, gelb markier wär auch toll“): Alles, was in der Liste eines Editors angehakt ist, leuchtet gelb, in
 * derselben Farbe und Form wie ein einzeln gewähltes Objekt (`area-selection.ts`, Kanonfarbe `mapSelection` = `--color-map-selection`).
 *
 * - **Melden:** Jeder Editor meldet seine angehakten Objekte unter seiner Quelle (`setze`, oder `folgeMehrfachauswahl` an seinen Refs).
 *   Abhaken nimmt die Markierung weg; ausgeschaltet meldet er `[]`, und gelb bleibt nur die gewöhnliche Einzelauswahl.
 * - **Zeichnen:** Der Stil (`place-layers.ts`) legt je Art eigene Ebenen über die Einzelauswahl (`buildMehrfachMarkierungLayers`).
 * - **Umschalt-Klick auf der Karte** (Betreiber 2026-10-20: „die mehrfach auswahl könnte übrigens auch durch gedrückte shift-taste
 *   unterstützt werden“): Ein Editor meldet je Art sein Ziel (`ziel`); `umschalteAufKarte(art, id)` gibt den Klick ihm, wenn es bereit
 *   ist, und sagt, ob er genommen wurde. Gefragt wird über `umschalt` der Besitzer von Ort, Gipfel, Kraftlinie und Fläche (Gebiete,
 *   Landschaften: `area-selection-input.ts`, `umschaltKlick`). Nimmt kein offenes Fenster das oberste Objekt, fällt der Klick im
 *   Koordinator durch zum nächsten darunter; nimmt keins, bleibt er ein gewöhnlicher Klick (Editor-Orchestrierung 2026-10-20 „A“). In
 *   Zeichen- und Formmodi nimmt der Modus den Klick vorher (Rang `geometry-edit`), Umschalt-Ziehen bleibt der Rechteck-Zoom von MapLibre.
 * - **Eine neue Art** (Landschaft, Gipfel, Ort, Kraftlinie): die Art in `MarkierungsArt`, eine Zeile in `MEHRFACH_EBENEN`, die aus den
 *   Kennungen ihre Ebenen baut (Flächen wie `wieAuswahl`), ihre Kachelquelle im Stil, solange etwas angehakt ist (wie
 *   `territorySelected` in `place-layers.ts`), und der Aufruf aus der eigenen Steuerung. Seit WI-0252 auch der Weg.
 * - 🔴 **Aufheben an EINER Stelle** (Betreiber 2026-10-24, wörtlich: „ESC soll in allen fällen mehrfachauswahlen wieder aufheben, auch ein
 *   klick ins leere oder woanders muss eine mehrfachauswahl aufheben.“): Jedes Ziel sagt, wie es seine Mehrfachauswahl aufhebt
 *   (`aufheben`); `hebeAuf` fragt alle. `app.vue` ruft es aus der Escape-Kaskade (Stufe `multi-selection`, nach Menüs, Aktionen und dem
 *   Menü am Objekt) und bei jedem Klick ohne Umschalt in die Karte, solange kein Modus läuft; ein Klick auf ein Objekt wählt danach nur
 *   dieses. Ein Klick im Fenster selbst ist kein Klick in die Karte und hebt nichts auf.
 */

/**
 * Die Arten, die mehrfach markiert werden können: je eine Zeile in `MEHRFACH_EBENEN`. Gebiete, Landschaften und Gipfel (Derographie,
 * 2026-10-20) haben eigene Ebenen. Eine Kraftlinie (`powerline`, Kennung: ihr Anker) hat keine: Wie die einzeln gewählte glüht sie in den
 * Bögen (`powerline-arcs.ts`, `highlight`); `app.vue` liest dafür `stand`. Ein Ort (`place`, Kennung: `public_id`) bekommt den gelben
 * Kreis der Einzelauswahl in `place-layers.ts` (`PLACE_SELECTION_LAYER_ID`) (WI-0243).
 */
export type MarkierungsArt = Extract<AreaKind, "territory" | "landscape"> | "peak" | "powerline" | "place" | "path";

/** Was auf der Karte mehrfach leuchtet: eine Art und ihre Kennungen. */
export interface Mehrfachmarkierung {
    readonly art: MarkierungsArt;
    readonly ids: readonly string[];
}

/** Was eine Art zum Zeichnen braucht: Liegen die Gebietskacheln im Stil, liegen die Gipfelkacheln im Stil? */
export interface MarkierungsUmfeld {
    readonly territoryData: boolean;
    readonly peakData?: boolean;
}

/** Die Ebenen einer Fläche wie die der Einzelauswahl, unter eigenen Kennungen (`mehrfach-<art>-…`). */
export function wieAuswahl(kind: AreaKind, ids: readonly string[]): LayerSpecification[] {
    const flaeche = { kind, id: ids[0]!, group: ids, name: null, type: "", anchor: { x: 0, y: 0 } };
    return buildAreaSelectionLayers(flaeche).map((ebene) => ({
        ...ebene,
        id: ebene.id.replace(/^area-selection/, `mehrfach-${kind}`),
    }));
}

/** Je Art die Ebenen aus den Kennungen; eine neue Art trägt hier ihre Zeile ein. */
export const MEHRFACH_EBENEN: Record<
    MarkierungsArt,
    (ids: readonly string[], umfeld: MarkierungsUmfeld) => LayerSpecification[]
> = {
    // Ein Gebiet leuchtet nur, wo seine Kachelquelle im Stil steht (wie die Einzelauswahl).
    territory: (ids, umfeld) => (umfeld.territoryData ? wieAuswahl("territory", ids) : []),
    // Eine Landschaft wie ihre Einzelauswahl; die Landschaftskacheln stehen immer im Stil.
    landscape: (ids) => wieAuswahl("landscape", ids),
    // Ein Gipfel hat keine Fläche: ein gelber Hof unter seinem Dreieck, in der Farbe der Auswahl, nur wo die Gipfelkacheln liegen.
    peak: (ids, umfeld) => (umfeld.peakData === true ? gipfelHof(ids) : []),
    // Eine Kraftlinie glüht in den Bögen wie die einzeln gewählte (gelb-orange, `TAFEL.auswahl`), nicht in einer Ebene.
    powerline: () => [],
    // Ein Ort leuchtet im Kreis der Einzelauswahl (`place-layers.ts` nimmt die angehakten dort mit), nicht in einer eigenen Ebene.
    place: () => [],
    // Ein Weg wie seine Einzelauswahl: die goldene Linie über allen seinen Abschnitten (WI-0252, Marken wie `WEG_NAME_MARKE`).
    path: (ids) => wegEbenen(ids),
};

/** Die Vorsilbe einer Wegmarke mit echtem Namen; ohne sie ist die Marke die Kennung des Abschnitts (ein Weg ohne Namen für sich). */
export const WEG_NAME_MARKE = "name:";

/**
 * Die Ebene der angehakten Wege (WI-0252): Ein Weg ist sein Name (WI-0177 Schritt 2b), also alle Abschnitte dieses Namens; ein namenloser
 * Abschnitt ist nur er selbst (`public_id`). Breite je Wegtyp wie die Einzelauswahl (`pathSelectionWidth`).
 */
function wegEbenen(ids: readonly string[]): LayerSpecification[] {
    const namen = ids.filter((id) => id.startsWith(WEG_NAME_MARKE)).map((id) => id.slice(WEG_NAME_MARKE.length));
    const kennungen = ids.filter((id) => !id.startsWith(WEG_NAME_MARKE));
    const look = DESIGN_CANON.mapSelection;
    const arten = Object.keys(look.pathWidthByType);
    const breite =
        arten.length === 0
            ? look.pathWidth
            : ([
                  "match",
                  ["get", "subtype"],
                  ...arten.flatMap((art) => [art, pathSelectionWidth(art)]),
                  look.pathWidth,
              ] as unknown as ExpressionSpecification);
    return [
        {
            id: "mehrfach-path",
            type: "line",
            source: PATH_SOURCE_ID,
            "source-layer": PATH_SOURCE_LAYER,
            filter: [
                "any",
                ["in", ["get", "name"], ["literal", namen]],
                ["in", ["get", "public_id"], ["literal", kennungen]],
            ],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": canonColour("mapSelection"),
                "line-opacity": look.pathOpacity,
                "line-width": breite,
            },
        },
    ];
}

/** Der Hof eines angehakten Gipfels (Kachel `terrain_peak_render`, Kennung `public_id`). */
function gipfelHof(ids: readonly string[]): LayerSpecification[] {
    const look = DESIGN_CANON.mapSelection;
    return [
        {
            id: "mehrfach-peak-hof",
            type: "circle",
            source: PEAK_SOURCE_ID,
            "source-layer": PEAK_SOURCE_LAYER,
            filter: ["in", ["get", "public_id"], ["literal", [...ids]]],
            paint: {
                "circle-radius": 11,
                "circle-color": canonColour("mapSelection"),
                "circle-opacity": look.fillOpacity,
                "circle-stroke-color": canonColour("mapSelection"),
                "circle-stroke-width": look.lineWidth,
                "circle-blur": 0.15,
            },
        },
    ];
}

/** Die Kennungen, die für diese Art gerade markiert sind. */
export const markiert = (stand: readonly Mehrfachmarkierung[], art: MarkierungsArt): readonly string[] =>
    stand.find((m) => m.art === art)?.ids ?? [];

/** Die Ebenen aller Mehrfachmarkierungen, in der Folge der Meldungen; leere Mengen zeichnen nichts. */
export function buildMehrfachMarkierungLayers(
    markierungen: readonly Mehrfachmarkierung[],
    umfeld: MarkierungsUmfeld,
): LayerSpecification[] {
    return markierungen.flatMap((m) => (m.ids.length === 0 ? [] : MEHRFACH_EBENEN[m.art](m.ids, umfeld)));
}

/** Wohin ein Umschalt-Klick auf der Karte geht: der Editor einer Art. */
export interface MehrfachZiel {
    /** Nimmt er ihn gerade (sein Fenster ist offen, kein Modus läuft)? Sonst ist der Klick ein gewöhnlicher. */
    bereit(): boolean;
    /** Aufnehmen oder herausnehmen; aus schaltet er die Mehrfachauswahl ein, mit dem bisher gewählten als erstem (`umschalteAufKarte` in
     * `editor-liste/mehrfachauswahl.ts`). */
    umschalten(id: string): void;
    /** Die Mehrfachauswahl ausschalten und die Haken lösen; `true`, wenn eine an war (Esc, Klick in die Karte). */
    aufheben?(): boolean;
}

export interface MehrfachMarkierung {
    /** Was leuchtet, je Art vereinigt über alle Quellen (ohne doppelte Kennungen). */
    readonly stand: ComputedRef<readonly Mehrfachmarkierung[]>;
    /** Eine Quelle (ein Editor) meldet ihre angehakten Objekte; `[]` nimmt ihre Markierung weg. */
    setze(quelle: string, art: MarkierungsArt, ids: readonly string[]): void;
    /** Ein Editor meldet sein Ziel für den Umschalt-Klick seiner Art; gibt den Abbau zurück. */
    ziel(art: string, ziel: MehrfachZiel): () => void;
    /** Ein Umschalt-Klick auf ein Objekt dieser Art: `true`, wenn ein bereites Ziel ihn genommen hat. */
    umschalteAufKarte(art: string, id: string): boolean;
    /** Jede Mehrfachauswahl aufheben, über alle Arten und Ziele; `true`, wenn eine an war. */
    hebeAuf(): boolean;
}

export function createMehrfachMarkierung(): MehrfachMarkierung {
    const quellen = shallowRef<ReadonlyMap<string, Mehrfachmarkierung>>(new Map());
    const stand = computed((): readonly Mehrfachmarkierung[] => {
        const jeArt = new Map<MarkierungsArt, Set<string>>();
        for (const { art, ids } of quellen.value.values()) {
            const menge = jeArt.get(art) ?? new Set<string>();
            for (const id of ids) menge.add(id);
            jeArt.set(art, menge);
        }
        return [...jeArt].map(([art, ids]) => ({ art, ids: [...ids] }));
    });
    // Je Art alle gemeldeten Ziele: Ein Editor mit mehreren Fenstern meldet jedes (Landschaften, Orte); abgelegte sind nicht bereit. Es gilt
    // das jüngste bereite (gemessen: Mit nur EINEM Ziel je Art meldete sich zuletzt ein abgelegtes Fenster, und der Klick fiel durch).
    const ziele = new Map<string, MehrfachZiel[]>();
    return {
        stand,
        ziel(art, ziel) {
            ziele.set(art, [...(ziele.get(art) ?? []), ziel]);
            return () => {
                const rest = (ziele.get(art) ?? []).filter((z) => z !== ziel);
                if (rest.length === 0) ziele.delete(art);
                else ziele.set(art, rest);
            };
        },
        hebeAuf() {
            let war = false;
            // Alle fragen, nicht beim ersten aufhören: Zwei Editoren können zugleich eine Mehrfachauswahl halten.
            for (const liste of [...ziele.values()])
                for (const ziel of [...liste]) war = ziel.aufheben?.() === true || war;
            return war;
        },
        umschalteAufKarte(art, id) {
            const ziel = [...(ziele.get(art) ?? [])].reverse().find((z) => z.bereit());
            if (ziel === undefined) return false;
            alsMehrfachauswahl(() => ziel.umschalten(id));
            return true;
        },
        setze(quelle, art, ids) {
            const vorher = quellen.value.get(quelle);
            if (vorher === undefined && ids.length === 0) return;
            if (vorher?.art === art && vorher.ids.length === ids.length && vorher.ids.every((id, i) => id === ids[i]))
                return;
            const neu = new Map(quellen.value);
            if (ids.length === 0) neu.delete(quelle);
            else neu.set(quelle, { art, ids: [...ids] });
            quellen.value = neu;
        },
    };
}

/**
 * Die Anbindung eines Editors an seine Liste: an, solange die Mehrfachauswahl an ist, die angehakten Kennungen; aus `[]`. Gibt den
 * Abbau zurück (er nimmt die Markierung weg).
 */
export function folgeMehrfachauswahl(
    markierung: Pick<MehrfachMarkierung, "setze">,
    quelle: string,
    art: MarkierungsArt,
    an: () => boolean,
    angehakt: () => readonly string[],
): WatchStopHandle {
    const stop = watch(
        () => (an() ? angehakt() : []),
        (ids) => markierung.setze(quelle, art, ids),
        { immediate: true },
    );
    return () => {
        stop();
        markierung.setze(quelle, art, []);
    };
}

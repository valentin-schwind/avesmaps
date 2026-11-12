import type { Map as MapLibreMap } from "maplibre-gl";
import { computed, nextTick, watch, type ComputedRef, type Ref } from "vue";
import {
    AVENTURIA,
    EDITOR_LANDSCAPE_LAYERS,
    fromRenderLngLat,
    toRenderLngLat,
    type EditorLandscapeLayer,
    type LandscapeSelection,
    type MapView,
} from "@avesmaps3d/shared";
import { showToast } from "../../feedback/toast";
import { t, type MessageKey } from "../../i18n/i18n";
import type { MapInteractionCoordinator } from "../interaction/types";
import { startansicht } from "../start-view";
import { installAnlegenModus } from "./anlegen-modus";
import {
    createNeueFlaeche,
    type NeueFlaeche,
    type NeueFlaecheAndockung,
    type NeueFlaecheAuftrag,
    type NeueFlaecheKarte,
} from "./neue-flaeche";
import { neueFlaecheMeldungText, neueFlaecheSchild } from "./neue-flaeche-texte";

/**
 * „Neue Fläche“ für die Seite (C3, `neue-flaeche.ts`): der Ablauf mit Karte, Ansicht und Fangradius verbunden, damit `app.vue` nur die
 * Griffe reicht (`app-vue` schmal einhängen), wie `wegeditor/neuer-weg-anbindung.ts`.
 *
 * - **Ansicht** (`NeueFlaecheSeite.view`, `.layer`: `mapView` und `landscapeSelection` der Seite): Umschalten setzt sie; gesperrt
 *   nimmt jeder Wechsel von außen (Kartenfächer, Reiter, Kurzlink) sich selbst gleich wieder zurück, und ein Hinweis sagt es („Erst
 *   fertig zeichnen oder mit Esc abbrechen.“). Eine Stelle für alle Wege in die Ansicht, kein Eingriff in Fächer oder Leisten.
 * - **Gezeichnet:** Nach dem Umschalten wartet der Ablauf, bis die Karte in der neuen Ansicht zur Ruhe gekommen ist (`idle`), damit die
 *   Andockung an der ersten Ecke liest, was dort zu sehen ist.
 * - **Ziele** jedes Mal neu, wenn die Karte zur Ruhe kommt (`moveend`), nie während einer Geste.
 * - **Tasten** (R5, keine neue): Enter ist „Fertig“, ⌫ die letzte Ecke zurück, Strg+Z und Strg+Y (Mac ⌘, auch Strg+Umschalt+Z) zurück
 *   und wieder; nie in einem Textfeld. Esc hängt die Seite in ihre Kaskade (Stufe `action`).
 * - **Leertaste halten** (OPS-000040, Thomas; Betreiber „A unbedingt“, „gabs schon in legacy“: `map-features-ecosystem-draw.js`):
 *   Solange sie gehalten wird, setzt jeder Klick eine Ecke, auch zwei schnelle dicht beieinander, kein Doppelklick schließt die
 *   Fläche (`einzeln`), und die Karte verschiebt sich nicht (Legacy; Register 2026-10-19 „A beim doppelklick“). Auch ein Druck, bei dem die Hand weiterzieht, ist
 *   eine Ecke, gesetzt beim Loslassen (`anlegen-modus.ts`). Beenden geht weiter mit der ersten Ecke, Enter, „Fertig“ oder einem Doppelklick ohne Leertaste. Gehalten wie beim
 *   Malen (`landschaftseditor/flaeche-malen-anbindung.ts`): keydown und keyup, ein Fokusverlust löst sie, in einem Textfeld wirkt sie
 *   nicht. Für Landschaften und Gebiete gleich.
 * - **Meldungen** und ein Grund, warum `starte` nicht beginnt, erscheinen als Hinweis unten; das Schild am Ziel nennt Ecke oder Kante.
 * - **Testeinstieg:** Im Entwicklungsbuild liegt die Steuerung als `globalThis.avesmapsNeueFlaeche`.
 */

export interface NeueFlaecheSeite {
    karte(): MapLibreMap | undefined;
    interaction(): MapInteractionCoordinator | undefined;
    readonly view: Ref<MapView>;
    readonly layer: Ref<LandscapeSelection>;
    /** Rechte und `MAP_EDITING` der Seite für diese Andockung (die Rechte hängen am Fach); ohne Grund geht es. */
    grund?(andockung: NeueFlaecheAndockung): MessageKey | undefined;
    /** Nach dem Speichern: die Karte mit der Revision der Quittung neu. */
    geaendert(revision: number): void;
}

export type NeueFlaecheFuerSeite = NeueFlaeche & {
    readonly schild: ComputedRef<{ x: number; y: number; name: string; tut: string } | undefined>;
};

const space = AVENTURIA.coordinateSpace;

function taste(neueFlaeche: NeueFlaeche, event: KeyboardEvent): boolean {
    const lauf = neueFlaeche.laufend.value;
    if (lauf?.phase !== "bereit" || lauf.frage) return false;
    const ziel = event.target as HTMLElement | null;
    if (ziel?.closest("input, textarea, select, [contenteditable='true']")) return false;
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        neueFlaeche.fertig();
        return true;
    }
    if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        neueFlaeche.zurueck();
        return true;
    }
    if (!(event.ctrlKey || event.metaKey)) return false;
    const k = event.key.toLowerCase();
    if (k !== "z" && k !== "y") return false;
    if (k === "y" || event.shiftKey) neueFlaeche.wieder();
    else neueFlaeche.zurueck();
    return true;
}

/**
 * So lange wartet der Ablauf höchstens auf die Ruhe der Karte. 🪤 Auf der Stage (Thomas 4.2, 2026-10-19) kam `idle` nie: Kacheln, die
 * MapLibre bei einer neuen Kachelrevision (`setTiles`) mitten im Laden traf, blieben für immer „loading“, die Karte galt nie als
 * geladen, und „Neue Fläche“ hing nach dem Umschalten der Ansicht in „lädt“, ohne Leiste und ohne erste Ecke. Die Ziele kommen vom
 * Server, nicht aus den Kacheln; nach der Frist geht es weiter.
 */
export const RUHE_HOECHSTENS_MS = 1500;

/** Bis die Karte nach dem Umschalten gezeichnet und zur Ruhe gekommen ist, höchstens `RUHE_HOECHSTENS_MS`; ohne Karte sofort. */
export async function gezeichnet(
    map: Pick<MapLibreMap, "on" | "off" | "triggerRepaint"> | undefined,
    frist = RUHE_HOECHSTENS_MS,
): Promise<void> {
    // Die Seite setzt den Stil der Ansicht in ihren Beobachtern; die laufen vor dem nächsten Takt.
    await nextTick();
    await nextTick();
    if (map === undefined) return;
    await new Promise<void>((fertig) => {
        const ende = (): void => {
            clearTimeout(uhr);
            map.off("idle", ende);
            fertig();
        };
        const uhr = setTimeout(ende, frist);
        map.on("idle", ende);
        map.triggerRepaint();
    });
}

/**
 * Die Ebenen, deren Flächen beim Ziehen Ziele sind (EDIT-0003 T27 (1): nur, was man sieht): in der Derographie die gewählte oder alle
 * drei, in jeder anderen Ansicht alle drei. Dieselbe Regel für „Ecken bearbeiten“ und für Flüsse (Wegkurve, „Neuer Fluss/Bach“;
 * Vali 2026-11-08).
 */
export function sichtbareEbenen(view: string, auswahl: string): EditorLandscapeLayer[] {
    return EDITOR_LANDSCAPE_LAYERS.filter((ebene) => view !== "landscapes" || auswahl === "alle" || auswahl === ebene);
}

/**
 * Die Ansicht der Seite für den Ablauf: lesen, umschalten, sperren. Gesperrt nimmt ein Wechsel von außen sich sofort selbst zurück
 * (`flush: "sync"`, damit kein Beobachter den Zwischenstand sieht), und `gesperrt` meldet es; `stop` löst den Beobachter.
 */
export function ansichtDerSeite(
    view: Ref<MapView>,
    layer: Ref<LandscapeSelection>,
    gesperrtGemeldet: () => void,
): Pick<NeueFlaecheKarte, "ansicht" | "stelle" | "sperreAnsicht"> & { stop(): void } {
    let gesperrt: { readonly view: MapView; readonly layer: LandscapeSelection } | undefined;
    const stop = watch(
        [view, layer],
        ([jetzt, ebene]) => {
            if (gesperrt === undefined || (jetzt === gesperrt.view && ebene === gesperrt.layer)) return;
            view.value = gesperrt.view;
            layer.value = gesperrt.layer;
            gesperrtGemeldet();
        },
        { flush: "sync" },
    );
    return {
        ansicht: () => ({ view: view.value, layer: layer.value }),
        stelle(ansicht) {
            view.value = ansicht.view;
            if (ansicht.layer !== undefined) layer.value = ansicht.layer;
        },
        sperreAnsicht(an) {
            gesperrt = an ? { view: view.value, layer: layer.value } : undefined;
        },
        stop,
    };
}

/**
 * Die gehaltene Leertaste, solange `laeuft` (Kopf oben): runter, hoch, Fokusverlust; nie in einem Textfeld. `sperre` hält dabei die
 * Karte fest (Legacy `beginEcosystemDrawLock`), `loese` gibt sie frei, wenn der Ablauf mit gehaltener Taste endet.
 */
/** Wohin `halteLeertaste` hört: das Dokument (Tasten) und das Fenster (Fokusverlust); im Test Attrappen wie Legacys. */
export interface LeertastenQuellen {
    readonly dokument: Pick<EventTarget, "addEventListener" | "removeEventListener">;
    readonly fenster: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

export function halteLeertaste(
    laeuft: () => boolean,
    sperre: { an(): void; aus(): void },
    quellen: LeertastenQuellen = { dokument: document, fenster: globalThis as unknown as EventTarget },
): { gehalten(): boolean; loese(): void; destroy(): void } {
    let gehalten = false;
    const inEingabe = (event: Event): boolean =>
        Boolean((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']"));
    const loese = (): void => {
        if (!gehalten) return;
        gehalten = false;
        sperre.aus();
    };
    const istLeertaste = (event: KeyboardEvent): boolean => event.key === " " || event.code === "Space";
    function runter(event: KeyboardEvent): void {
        if (!istLeertaste(event) || !laeuft() || inEingabe(event)) return;
        // Sonst rollt die Seite oder drückt den Knopf, der gerade den Fokus hat.
        event.preventDefault();
        if (gehalten) return;
        gehalten = true;
        sperre.an();
    }
    function hoch(event: KeyboardEvent): void {
        if (istLeertaste(event)) loese();
    }
    const { dokument, fenster } = quellen;
    // 🪤 In der Capture-Phase, also vor den Tastenkürzeln (`keyboard/install-keyboard.ts`, auch am Dokument): Die Leertaste ist sonst
    // zugleich ein Kürzel, ohne Recht zum Fixieren „Suche“, mit ihm „Auswahl fixieren“ (`shortcuts.ts`). Die Suche legte sich über die
    // Karte, ihr Schleier schließt bei `mousedown`, und der erste Klick ging verloren (Browserfall OPS-000040). Abgefangen
    // (`preventDefault`) überspringt das Kürzel sie.
    dokument.addEventListener("keydown", runter as EventListener, { capture: true });
    dokument.addEventListener("keyup", hoch as EventListener);
    // 🪤 Alt-Tab mit gehaltener Leertaste liefert kein keyup (Legacy): sonst bliebe die Karte für immer fest.
    fenster.addEventListener("blur", loese);
    return {
        gehalten: () => gehalten && laeuft(),
        loese,
        destroy() {
            loese();
            dokument.removeEventListener("keydown", runter as EventListener, { capture: true });
            dokument.removeEventListener("keyup", hoch as EventListener);
            fenster.removeEventListener("blur", loese);
        },
    };
}

export function createNeueFlaecheFuerSeite(seite: NeueFlaecheSeite): NeueFlaecheFuerSeite {
    const ansicht = ansichtDerSeite(seite.view, seite.layer, () =>
        showToast(t("neueFlaeche.ansichtGesperrt"), "warning"),
    );
    // Die Leertaste fragt den Ablauf erst, wenn er steht (`neueFlaeche` unten); gehalten steht die Karte (Legacy, Betreiber „A“).
    let gezogen: { map: MapLibreMap; vorher: boolean } | undefined;
    const leertaste = halteLeertaste(() => neueFlaeche.laufend.value?.phase === "bereit", {
        an() {
            const map = seite.karte();
            if (map === undefined) return;
            gezogen = { map, vorher: map.dragPan.isEnabled() };
            map.dragPan.disable();
        },
        aus() {
            if (gezogen?.vorher) gezogen.map.dragPan.enable();
            gezogen = undefined;
        },
    });
    const neueFlaeche = createNeueFlaeche({
        einzeln: () => leertaste.gehalten(),
        fangradius: () => startansicht().fangradius,
        grund: (andockung) => seite.grund?.(andockung),
        karte: {
            ein(eingabe) {
                const map = seite.karte();
                const interaction = seite.interaction();
                return map && interaction ? installAnlegenModus(map, interaction, eingabe) : undefined;
            },
            sichtbar() {
                const map = seite.karte();
                if (!map) return undefined;
                const kasten = map.getBounds();
                const a = fromRenderLngLat(space, kasten.getSouthWest());
                const b = fromRenderLngLat(space, kasten.getNorthEast());
                return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
            },
            schirm(p) {
                const map = seite.karte();
                const render = toRenderLngLat(space, p);
                return map ? map.project([render.lng, render.lat]) : { x: 0, y: 0 };
            },
            ansicht: ansicht.ansicht,
            stelle: ansicht.stelle,
            sperreAnsicht: ansicht.sperreAnsicht,
            gezeichnet: () => gezeichnet(seite.karte()),
            geaendert: (revision) => {
                if (revision !== undefined) seite.geaendert(revision);
            },
        },
    });
    const tasten = (event: KeyboardEvent): void => {
        if (taste(neueFlaeche, event)) event.preventDefault();
    };
    document.addEventListener("keydown", tasten);
    // Die Ziele folgen dem Ausschnitt, sobald die Karte zur Ruhe kommt; während einer Geste fragt niemand den Server.
    let karte: MapLibreMap | undefined;
    const ruhe = (): void => void neueFlaeche.ladeZiele();
    // Endet der Ablauf mit gehaltener Leertaste (Enter, Fertig, Esc), bleibt die Karte nicht fest.
    const stopLeertaste = watch(
        () => neueFlaeche.laufend.value?.phase === "bereit",
        (bereit) => {
            if (!bereit) leertaste.loese();
        },
    );
    const stopLauf = watch(
        () => neueFlaeche.laufend.value !== undefined,
        (laeuft) => {
            if (laeuft && karte === undefined) {
                karte = seite.karte();
                karte?.on("moveend", ruhe);
            } else if (!laeuft && karte !== undefined) {
                karte.off("moveend", ruhe);
                karte = undefined;
            }
        },
    );
    const stopMeldung = watch(neueFlaeche.meldung, (meldung) => {
        if (meldung === undefined) return;
        const ton = meldung.art === "gespeichert" ? "success" : meldung.art === "verworfen" ? "normal" : "warning";
        showToast(neueFlaecheMeldungText(meldung), ton);
    });
    const schild = computed(() => {
        const zeiger = neueFlaeche.zeiger.value;
        return zeiger === undefined ? undefined : { ...zeiger.schirm, ...neueFlaecheSchild(zeiger) };
    });
    const fuerSeite: NeueFlaecheFuerSeite = {
        ...neueFlaeche,
        schild,
        async starte(auftrag: NeueFlaecheAuftrag) {
            const start = await neueFlaeche.starte(auftrag);
            if (start !== "laeuft") showToast(t(start), "warning");
            return start;
        },
        destroy() {
            stopLeertaste();
            leertaste.destroy();
            document.removeEventListener("keydown", tasten);
            karte?.off("moveend", ruhe);
            stopLauf();
            stopMeldung();
            neueFlaeche.destroy();
            ansicht.stop();
        },
    };
    if (import.meta.env.DEV)
        (globalThis as unknown as { avesmapsNeueFlaeche?: NeueFlaeche }).avesmapsNeueFlaeche = fuerSeite;
    return fuerSeite;
}

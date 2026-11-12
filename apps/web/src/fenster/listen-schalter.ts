import { ref, watch, type WatchStopHandle } from "vue";
import type { Speicher } from "../editor-panel/editor-panel-nav";

/**
 * Der Schalter der Liste eines Werkzeugfensters (WI-0128 P1; Betreiberpräzisierung 2026-10-13): Die Liste links wird von ihrer LINKEN
 * Kante her nach rechts eingezogen, bis sie verschwunden ist. 🔴 Die rechte Fensterkante, die Trennlinie mit dem Pfeilknopf und die
 * Spalte der Eigenschaften stehen dabei still; nur die linke Fensterkante wandert, und die Karte gewinnt genau die Listenbreite.
 *
 * - **Je Fenster ein Schalter** (mehrere Fenster sind unabhängig), aber **eine** `ListenEinstellung` je Editor für Suche, Filter und
 *   Sortierung: Der Schalter ist Sicht, kein Inhalt.
 * - **Vorgabe neuer Fenster** ist der zuletzt gelegte Schalter DIESES Werkzeugs, gemerkt im Browser (`try/catch`; ohne Speicher
 *   zunächst offen). Keine neue Spalte in der Datenbank: Das ist Oberflächenzustand.
 * - **Für jedes Werkzeugfenster mit Liste** (EDIT-0003, Entscheidung der Orchestrierung zu Kraftlinien K6/K8, Regel 7; welche das
 *   sind, sagt `app.vue`). Zwei Fälle stellen ihn, ohne die Vorgabe zu ändern (`vorlaeufig`, `modus`):
 *   - **Öffnet ein Klick auf die Karte einen Editor**, steht das Fenster mit eingeklappter Liste, nur die Eigenschaften (Variante A);
 *     über das Verb im Editorpanel gilt die Vorgabe.
 *   - **Startet ein Modus der Form aus einem angedockten Fenster**, klappt es seine Liste ein und stellt sie am Ende wieder her
 *     (`listeImModus`); wer sie währenddessen selbst aufklappt, behält sie offen.
 * - **Die Breite kommt aus dem Kanon** (`fenster.spalten.inspektor`), nicht aus einer zweiten Zahl im Quelltext: Fensterbreite,
 *   Spaltenbreite, Laschen und die freie Kartenfläche lesen dieselbe Quelle.
 */

/** Unter diesem Schlüssel merkt der Browser, wie das nächste Fenster dieses Werkzeugs aufgeht. */
export const listenSchluessel = (werkzeug: string): string => `avesmaps3d.${werkzeug}.liste-zu`;

/** Der Schlüssel des Ortseditors (seit WI-0128 P1 unverändert). */
export const LISTEN_SCHLUESSEL = listenSchluessel("ortseditor");

/** Das Werkzeug eines Fensters, das sich ohne Angabe meldet: der Ortseditor, für den der Schalter entstand. */
const ORTSEDITOR = "ortseditor";

/** Die Kanonbreite der Liste in Pixeln; ohne Stilblatt 0 (dann zieht nichts ein, statt dass eine Zahl rät). */
export function listenBreite(): number {
    const kanon = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--avm-fenster-inspektor"),
    );
    return Number.isFinite(kanon) && kanon > 0 ? kanon : 0;
}

export interface ListenSchalter {
    /** Ist die Liste dieses Fensters eingezogen? Ein unbekanntes Fenster antwortet mit der Vorgabe seines Werkzeugs. */
    zu(fensterId: string | undefined, werkzeug?: string): boolean;
    /**
     * Ein Fenster ist da: Es übernimmt EINMAL die geltende Vorgabe seines Werkzeugs und behält sie danach. 🔴 Ohne das klappte ein
     * offenes Fenster mit, sobald ein anderes seinen Schalter legt - die Vorgabe gilt nur für NEUE Fenster.
     */
    melde(fensterId: string, werkzeug?: string): void;
    /** Den Schalter eines Fensters legen (der Pfeilknopf); die Stellung wird die Vorgabe des nächsten Fensters desselben Werkzeugs. */
    schalte(fensterId: string, zu: boolean): void;
    /** Den Schalter eines Fensters stellen, ohne die Vorgabe zu ändern: geöffnet von der Karte (nur die Eigenschaften). */
    vorlaeufig(fensterId: string, zu: boolean, werkzeug?: string): void;
    /**
     * Ein Modus der Form beginnt (`true`) oder endet (`false`) in diesem Fenster: Beim Start zieht eine offene Liste ein, am Ende kommt
     * sie wieder, außer jemand hat sie inzwischen selbst aufgeklappt. Eine schon eingezogene Liste bleibt, wie sie ist.
     */
    modus(fensterId: string, laeuft: boolean): void;
    /** Um wie viele Pixel die linke Fensterkante eingezogen ist (0, solange die Liste offen steht). */
    einzug(fensterId: string | undefined, werkzeug?: string): number;
}

function lies(speicher: Speicher | undefined, werkzeug: string): boolean {
    try {
        return speicher?.getItem(listenSchluessel(werkzeug)) === "zu";
    } catch {
        // Ohne Speicher steht die Liste offen.
        return false;
    }
}

function schreib(speicher: Speicher | undefined, werkzeug: string, zu: boolean): void {
    try {
        speicher?.setItem(listenSchluessel(werkzeug), zu ? "zu" : "offen");
    } catch {
        // Ohne Speicher gilt die Stellung bis zum Neuladen.
    }
}

interface Stellung {
    readonly zu: boolean;
    readonly werkzeug: string;
}

export function createListenSchalter(speicher: Speicher | undefined): ListenSchalter {
    /** Die Vorgabe je Werkzeug, beim ersten Fragen aus dem Speicher gelesen. */
    const vorgaben = ref(new Map<string, boolean>());
    const jeFenster = ref(new Map<string, Stellung>());
    /** Die Fenster, deren Liste ein Modus eingezogen hat (und am Ende wieder öffnet). */
    const imModus = new Set<string>();

    const vorgabe = (werkzeug: string): boolean => vorgaben.value.get(werkzeug) ?? lies(speicher, werkzeug);
    const zu = (fensterId: string | undefined, werkzeug = ORTSEDITOR): boolean =>
        (fensterId === undefined ? undefined : jeFenster.value.get(fensterId)?.zu) ?? vorgabe(werkzeug);

    const setze = (fensterId: string, ja: boolean, werkzeug?: string): void => {
        const naechste = new Map(jeFenster.value);
        naechste.set(fensterId, {
            zu: ja,
            werkzeug: werkzeug ?? jeFenster.value.get(fensterId)?.werkzeug ?? ORTSEDITOR,
        });
        jeFenster.value = naechste;
    };

    return {
        zu,
        melde(fensterId, werkzeug = ORTSEDITOR) {
            if (!jeFenster.value.has(fensterId)) setze(fensterId, vorgabe(werkzeug), werkzeug);
        },
        schalte(fensterId, ja) {
            setze(fensterId, ja);
            imModus.delete(fensterId);
            const werkzeug = jeFenster.value.get(fensterId)?.werkzeug ?? ORTSEDITOR;
            const naechste = new Map(vorgaben.value);
            naechste.set(werkzeug, ja);
            vorgaben.value = naechste;
            schreib(speicher, werkzeug, ja);
        },
        vorlaeufig(fensterId, ja, werkzeug) {
            setze(fensterId, ja, werkzeug);
        },
        modus(fensterId, laeuft) {
            if (laeuft) {
                if (zu(fensterId)) return;
                imModus.add(fensterId);
                setze(fensterId, true);
                return;
            }
            if (!imModus.delete(fensterId)) return;
            if (zu(fensterId)) setze(fensterId, false);
        },
        einzug: (fensterId, werkzeug) => (zu(fensterId, werkzeug) ? listenBreite() : 0),
    };
}

/**
 * Hält die Liste eingezogen, solange in einem angedockten Fenster ein Modus der Form läuft (EDIT-0003, Regel 7). `fensterImModus` nennt
 * das Fenster des Editors, in dem gerade ein Modus der Form läuft (oder nichts); ein abgedocktes oder abgelegtes Fenster lässt seine Liste.
 */
export function listeImModus(
    schalter: ListenSchalter,
    fensterImModus: () => string | undefined,
    angedockt: (fensterId: string) => boolean,
): WatchStopHandle {
    let laufend: string | undefined;
    return watch(
        () => {
            const id = fensterImModus();
            return id !== undefined && (id === laufend || angedockt(id)) ? id : undefined;
        },
        (id) => {
            if (laufend !== undefined && laufend !== id) schalter.modus(laufend, false);
            if (id !== undefined && id !== laufend) schalter.modus(id, true);
            laufend = id;
        },
        { immediate: true },
    );
}

import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { istAbbruch } from "../medien/medien-client";

/**
 * Eine entprellte Suche mit Abbruch; ein jüngerer Wunsch löst den älteren ab. `mindest` sind die Zeichen, ab denen gesucht wird (zwei; die Ortssuche der Lage sucht schon ohne Text). `anstossen` sucht sofort
 * mit dem Text, der gerade dasteht, wenn er sich nicht ändert (ein Feld, das den Fokus bekommt, ohne dass jemand tippt) und noch nichts gefunden ist.
 *
 * Herausgelöst aus der Steuerung des Reiters „Vorkommen“ (WI-0254 §12), damit die Quellen der Karteneditoren (`traeger-quellen-steuerung.ts`) dieselbe Suche nutzen. Gleiches Verhalten, kein zweiter Weg.
 */
export function createTextSuche<T>(
    lade: (text: string, signal: AbortSignal) => Promise<readonly T[]>,
    entprellMs: number,
    mindest = 2,
): {
    text: Ref<string>;
    treffer: ShallowRef<readonly T[]>;
    laedt: Ref<boolean>;
    leere(): void;
    anstossen(): void;
} {
    const text = ref("");
    const treffer = shallowRef<readonly T[]>([]);
    const laedt = ref(false);
    let abbruchSteuer: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Der Text, zu dem zuletzt eine Suche geplant wurde. */
    let geplant: string | undefined;
    function leere(): void {
        abbruchSteuer?.abort();
        text.value = "";
        treffer.value = [];
    }
    function plane(wert: string, wartMs: number): void {
        geplant = wert;
        if (timer !== undefined) clearTimeout(timer);
        abbruchSteuer?.abort();
        if (wert.trim().length < mindest) {
            treffer.value = [];
            laedt.value = false;
            return;
        }
        timer = setTimeout(async () => {
            const abbruch = new AbortController();
            abbruchSteuer = abbruch;
            laedt.value = true;
            try {
                const antwort = await lade(wert, abbruch.signal);
                if (!abbruch.signal.aborted) treffer.value = antwort;
            } catch (fehler) {
                if (!istAbbruch(fehler, abbruch.signal)) treffer.value = [];
            } finally {
                if (abbruchSteuer === abbruch) laedt.value = false;
            }
        }, wartMs);
    }
    watch(text, (wert) => plane(wert, entprellMs));
    function anstossen(): void {
        // Hat der Text sich geändert, plant der Beobachter gleich selbst; wo schon etwas da ist oder kommt, bleibt es.
        if (geplant !== undefined && geplant !== text.value) return;
        if (treffer.value.length > 0 || laedt.value) return;
        plane(text.value, 0);
    }
    onScopeDispose(() => {
        abbruchSteuer?.abort();
        if (timer !== undefined) clearTimeout(timer);
    });
    return { text, treffer, laedt, leere, anstossen };
}

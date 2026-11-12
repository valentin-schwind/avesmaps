import { ref, watch } from "vue";

/**
 * Der Schalter „Steuerring auch am Handy“ (WI-0016, D10, WCAG 2.5.1).
 *
 * Am Finger gibt es keinen Ring, zwei Finger machen alles (Betreiber 2026-09-23). Wer aber nicht
 * mit zwei Fingern drehen oder herauszoomen kann - zitternde Hand, nur eine Hand frei, Kopfmaus -,
 * braucht dafür Knöpfe. Dieser Schalter unter Hinweise → Bedienung holt den Ring zurück; die
 * Vorgabe ist aus (Betreiber 2026-09-23: „Schalter wie empfohlen“).
 *
 * 🪤 Gespeichert im Browser, nicht im Link: es ist eine Eigenschaft der Person, nicht der Ansicht.
 */
const STORAGE_KEY = "avesmaps3d.steuerring-handy";

/** Bedient wird mit dem Finger, nicht mit der Maus: dort gilt die Bedienung ohne Ring. */
export const coarsePointer =
    typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(pointer: coarse)").matches;

function readStored(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === "an";
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe: kein Ring am Finger.
        return false;
    }
}

/** `true`, wenn der Steuerring auch am Finger stehen soll. */
export const ringOnTouch = ref(readStored());

watch(ringOnTouch, (on) => {
    try {
        if (on) {
            globalThis.localStorage?.setItem(STORAGE_KEY, "an");
        } else {
            globalThis.localStorage?.removeItem(STORAGE_KEY);
        }
    } catch {
        // siehe readStored
    }
});

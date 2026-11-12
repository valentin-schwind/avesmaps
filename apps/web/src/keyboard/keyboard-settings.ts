import { ref, watch } from "vue";

/**
 * Der Schalter „Tastenkürzel aus" (WI-0016, AC5, WCAG 2.1.4).
 *
 * Einzeltasten-Kürzel stören Menschen, die per Sprache steuern: ein gesprochenes Wort wird zu
 * Tastendrücken, und jedes „w" oder „0" darin bewegt die Karte. Wer das nicht will, schaltet die
 * Zeichentasten ab; die Pfeiltasten bleiben (`isCharacterKey`).
 *
 * 🪤 Gespeichert im Browser, nicht im Link: es ist eine Eigenschaft der Person, nicht der Ansicht.
 */
const STORAGE_KEY = "avesmaps3d.tastenkuerzel";

function readStored(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === "aus";
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe: Kürzel an.
        return false;
    }
}

/** `true`, wenn die Zeichentasten-Kürzel abgeschaltet sind. */
export const characterShortcutsOff = ref(readStored());

watch(characterShortcutsOff, (off) => {
    try {
        if (off) {
            globalThis.localStorage?.setItem(STORAGE_KEY, "aus");
        } else {
            globalThis.localStorage?.removeItem(STORAGE_KEY);
        }
    } catch {
        // siehe readStored
    }
});

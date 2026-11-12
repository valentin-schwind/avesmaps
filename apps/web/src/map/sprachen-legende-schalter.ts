import { ref, watch } from "vue";

/**
 * Der Schalter „Sprachenlegende“ im Anzeigemenü (WI-0261; Betreiber 2026-10-31: „die legende bei sprachen brauchst du nicht
 * standardmäßig einblenden, blende die klappbox aus (die sprachengebiete sind ja eindeutig auf dem bildschirm zu sehen) und stelle
 * sie nur ein, wenn in "Anzeige" das "auge" für "Sprachenlegende" gesetzt wird.“).
 *
 * - **Aus ist die Vorgabe.** Die Zeile steht im Auge nur, solange die Ebene Sprachen gewählt ist, wie „Höhenlinien“ bei der
 *   Topographie (`hoehenlinien-schalter.ts`).
 * - **Gemerkt je Browser** wie die Höhenlinien: eine Gewohnheit der Person, nicht der Ansicht und nicht des Links.
 */
const STORAGE_KEY = "avesmaps3d.sprachenlegende";

function liesGemerkt(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === "an";
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe: aus.
        return false;
    }
}

/** Steht die Legende der Sprachen auf der Karte? */
export const sprachenLegendeZeigen = ref(liesGemerkt());

watch(sprachenLegendeZeigen, (an) => {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, an ? "an" : "aus");
    } catch {
        // siehe liesGemerkt
    }
});

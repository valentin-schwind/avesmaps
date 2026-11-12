import { ref, watch } from "vue";

/**
 * Der Umschalter „Höhen beschriften“ der Kamm-Leiste (WI-0249 P9; Betreiber 2026-10-24: „cool wärs wenn im editor die punkte mit den höhen
 * beschriftet werden können. also ein togglebutton entscheidet, ob die höhen über den kammpunkten sichtbar sind“): An steht über jedem Punkt
 * des Kammeditors (Kamm- und Talstützpunkte, Nebengipfel, Mulden) seine Höhe, eine Zahl je Punkt (`hoehenBeschriftung`). 🔴 Gemerkt je Browser wie
 * die Höhenlinien (`hoehenlinien-schalter.ts`): eine Gewohnheit der Person, nicht des Gebirges. Vorgabe aus.
 */
const STORAGE_KEY = "avesmaps3d.kammhoehen";

function liesGemerkt(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === "an";
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe: aus.
        return false;
    }
}

/** Stehen die Höhen über den Punkten des Kammeditors? */
export const kammHoehenZeigen = ref(liesGemerkt());

watch(kammHoehenZeigen, (an) => {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, an ? "an" : "aus");
    } catch {
        // siehe liesGemerkt
    }
});

import { ref, watch } from "vue";

/**
 * Der Wert des Reglers „Untergrund“ (WI-0178 T47; Betreiber 2026-10-18: „Untergrund-Regler in der Ebenenleiste: mit dem symbol und
 * regler -> schön, das machen“): wie stark Editoren in der Derographie die Karte darunter sehen, 0 bis 100 %. Besucher sehen dort nie
 * einen Untergrund (`composeView`, Legacy-Profil `untergrund: 0`, Owner 2026-09-09).
 *
 * - **Vorgabe 50 %, Schritt 5** wie Legacy (`map-features-ecosystem-layer-switch.js#L338-370`, Owner 2026-07-26: „Half is where the
 *   terrain still guides the pen“); beide stehen in der Regler-Meldeliste.
 * - 🔴 **Gemerkt je Browser**, wie Legacy (`avesmaps.ecosystem.undergroundOpacity`): eine Gewohnheit der Person, nicht der Ansicht und
 *   nicht des Links.
 * - 🪤 **Leerer Speicher ist nicht 0** (Legacy `#L351-354`: `Number(null)` gab einem neuen Editor eine leere Karte): Was nicht lesbar
 *   ist, gilt als Vorgabe.
 */
export const UNTERGRUND_VORGABE = 50;
export const UNTERGRUND_SCHRITT = 5;
const STORAGE_KEY = "avesmaps3d.untergrund";

/** Auf den Schritt gerundet und auf 0 bis 100 begrenzt; was keine Zahl ist, wird die Vorgabe. */
export function untergrundWert(roh: unknown): number {
    const zahl =
        typeof roh === "string" && roh.trim() !== "" ? Number(roh) : typeof roh === "number" ? roh : Number.NaN;
    if (!Number.isFinite(zahl)) return UNTERGRUND_VORGABE;
    return Math.min(100, Math.max(0, Math.round(zahl / UNTERGRUND_SCHRITT) * UNTERGRUND_SCHRITT));
}

function liesGemerkt(): number {
    try {
        return untergrundWert(globalThis.localStorage?.getItem(STORAGE_KEY) ?? undefined);
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe.
        return UNTERGRUND_VORGABE;
    }
}

/** Der Wert in Prozent; ein Wert ändert die Karte sofort (`app.vue`). */
export const untergrund = ref(liesGemerkt());

watch(untergrund, (wert) => {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, String(wert));
    } catch {
        // siehe liesGemerkt
    }
});

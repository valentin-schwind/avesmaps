import { ref } from "vue";

/**
 * Die EINE Antwort auf „ist das ein Telefon?" (Legacy `runtime-state.js`, `avesmapsIsPhoneViewport`):
 * ein grober Zeiger und eine kurze Bildschirmseite bis 600 px. Gemessen wird die KURZSEITE, damit ein
 * quer gehaltenes Telefon ein Telefon bleibt; ein Tablet oder ein schmal gezogenes Rechnerfenster
 * wird keins (der Zeiger bleibt fein).
 *
 * 🪤 Keine zweite Fassung als Media-Query: `(pointer: coarse) and (max-width: 600px)` wäre schon
 * nicht dasselbe - sie träfe das quer gehaltene Telefon nicht.
 */
export const PHONE_SHORT_SIDE_MAX = 600;

export function isPhoneViewport(): boolean {
    if (typeof globalThis.matchMedia !== "function") return false;
    const coarse = globalThis.matchMedia("(pointer: coarse)").matches;
    const shortest = Math.min(globalThis.innerWidth || 9999, globalThis.innerHeight || 9999);
    return coarse && shortest <= PHONE_SHORT_SIDE_MAX;
}

/** Nachgezogen bei Größenänderung und Drehung. */
export const phoneViewport = ref(isPhoneViewport());

if (typeof globalThis.addEventListener === "function") {
    const sync = (): void => {
        phoneViewport.value = isPhoneViewport();
    };
    globalThis.addEventListener("resize", sync);
    globalThis.addEventListener("orientationchange", sync);
}

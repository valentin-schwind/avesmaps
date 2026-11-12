import { ref } from "vue";
import { DESIGN_CANON } from "@avesmaps3d/shared";

/**
 * Hell oder dunkel (WI-0032, Guide §23; Legacy `js/app/theme-toggle.js`, avesmaps@770c80e).
 *
 * - **Ein Attribut schaltet alles:** `data-theme="dark"` an `<html>` legt die Dunkelwerte des Kanons
 *   über die hellen (`canon.css`). Die Karte bleibt hell - sie hat keinen Dunkelwert (Guide §23.1).
 * - **Die Wahl bleibt** unter Legacys Schlüssel `avesmaps-theme`, und ein Skript im Kopf der Seite
 *   (`index.html`) setzt sie vor dem ersten Bild - sonst blitzte die Seite hell auf.
 * - **Ohne eigene Wahl wie das Betriebssystem** (Betreiber 2026-09-24, wie Legacy seit 13.07.2026),
 *   und zwar laufend: Stellt jemand sein System um, zieht die Seite mit. Wer einmal selbst gewählt
 *   hat, behält seine Wahl.
 */

export type Theme = "light" | "dark";

/** Legacys Schlüssel - wer dort dunkel gewählt hat, braucht es hier nicht noch einmal zu tun. */
export const THEME_STORAGE_KEY = "avesmaps-theme";

const root = (): HTMLElement | undefined => globalThis.document?.documentElement;

function readTheme(): Theme {
    return root()?.dataset["theme"] === "dark" ? "dark" : "light";
}

/** Das Thema, wie es gerade gilt - der Kopf der Seite hat es schon gesetzt. */
export const theme = ref<Theme>(readTheme());

/** Setzt das Attribut und die Farbe der Browserleiste am Telefon (Legacy `meta theme-color`). */
export function applyTheme(next: Theme): void {
    const element = root();
    if (!element) return;
    element.dataset["theme"] = next;
    const colour = next === "dark" ? DESIGN_CANON.colourDark?.["browserBar"] : DESIGN_CANON.colour["browserBar"];
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.append(meta);
    }
    if (colour) meta.content = colour;
}

export function setTheme(next: Theme): void {
    theme.value = next;
    applyTheme(next);
    try {
        globalThis.localStorage?.setItem(THEME_STORAGE_KEY, next);
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Wahl bis zum Neuladen.
    }
}

export function toggleTheme(): void {
    setTheme(theme.value === "dark" ? "light" : "dark");
}

/** Die eigene Wahl aus dem Speicher - oder nichts, wenn es keine gibt. */
function storedTheme(): Theme | null {
    try {
        const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
        return value === "dark" || value === "light" ? value : null;
    } catch {
        return null;
    }
}

/**
 * Folgt dem Betriebssystem, solange es keine eigene Wahl gibt (Legacy `theme-toggle.js`: „follow
 * the browser/OS colour scheme LIVE, but only while the user has NOT made an explicit choice“).
 */
export function followSystemTheme(): void {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    query?.addEventListener("change", (event) => {
        if (storedTheme() !== null) return;
        theme.value = event.matches ? "dark" : "light";
        applyTheme(theme.value);
    });
}

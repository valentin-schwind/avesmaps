import {
    WETTER_URL,
    wetterDatenAus,
    wetterDatenVorgaben,
    type WetterDaten,
    type Wettermodellwerte,
} from "@avesmaps3d/shared";

/**
 * Der Leseweg des Wetters im Browser (WI-0288 Stufe 2): Presets, Icons und Wettermodell aus `GET /api/wetter`, beim Einschalten des Wetters
 * gelesen. Dieses Modul liegt im nachgeladenen Chunk (`wetter-ebene.ts`): Solange keine Wetter-Option an ist, fragt niemand.
 *
 * - **Die Konstanten bleiben die Vorgaben** (`packages/shared/src/wetter/`): Ohne Antwort, mit einem Fehler oder nach der Wartezeit gelten
 *   sie, so wie in Stufe 1. Einzelne unsinnige Werte ersetzt `wetterDatenAus` durch ihre Vorgabe.
 * - `cache: "no-cache"` wie bei den Zoombändern: Der Server antwortet mit ETag, ein unveränderter Stand kostet ein 304.
 * - Schreiben gibt es hier nicht; das kommt mit dem Wetter-Editor (Stufe 3) und dem Reiter „Wettermodell“ (Stufe 4).
 */

export const WETTER_DATEN_WARTEN_MS = 2_500;

export async function ladeWetterDaten(
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    waitMs: number = WETTER_DATEN_WARTEN_MS,
): Promise<WetterDaten> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
        const response = await fetcher(WETTER_URL, { signal: controller.signal, cache: "no-cache" });
        if (!response.ok) return wetterDatenVorgaben();
        return wetterDatenAus(await response.json());
    } catch {
        return wetterDatenVorgaben();
    } finally {
        clearTimeout(timer);
    }
}

/** Die Werte des Wettermodells in der Form der Engine (`cfg`): Die Wolkenauflösung 0 heißt dort `"auto"`. */
export function modellFuerEngine(modell: Wettermodellwerte): Record<string, number | "auto"> {
    const res = modell["res"] ?? 0;
    return { ...modell, res: res === 0 ? "auto" : res };
}

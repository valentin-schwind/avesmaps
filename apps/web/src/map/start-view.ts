import {
    MAP_SETTINGS_URL,
    karteneinstellung,
    karteneinstellungImRahmen,
    karteneinstellungVorgaben,
    wegfindungImBrowserAus,
    type KartenEinstellungen,
    type WegfindungswerteImBrowser,
} from "@avesmaps3d/shared";

/**
 * Die Startansicht der Karte aus den Karteneinstellungen (WI-0166): wohin die Karte schaut, wenn die Adresse nichts sagt. Die
 * Systemsteuerung stellt sie ein (Reiter „Karteneinstellungen“), `GET /api/map-settings` liefert sie, und `main.ts` liest sie
 * VOR dem Start der Anwendung, neben der Sitzung — die Karte entsteht mit ihrem ersten Blick, sie springt nicht hinterher.
 *
 * - **Fehlerrichtung:** Ohne Antwort (Netz, Zeitgrenze, älterer Server ohne den Weg) gelten die Vorgaben der Tafel, nie ein
 *   Fehler. Höchstens so lange wie die Sitzung (`SESSION_WAIT_MS`), und weil beide gleichzeitig laufen, kostet es keine Zeit.
 * - 🔴 **Tolerant lesen** (AGENTS.md „Migrationen“, Punkt 4): Unbekannte Felder werden übergangen, ein Feld, das nicht in Art und
 *   Grenzen seiner Einstellung passt, fällt auf die Vorgabe zurück. Der Server sendet streng.
 */

export const START_VIEW_WAIT_MS = 2_500;

let geladen: KartenEinstellungen | null = null;
let wegfindungGeladen: WegfindungswerteImBrowser | null = null;

/** Liest eine Antwort tolerant: je Einstellung der gelieferte Wert, wenn er passt, sonst die Vorgabe. */
export function leseKartenEinstellungen(body: unknown): KartenEinstellungen {
    const werte: Record<string, unknown> = { ...karteneinstellungVorgaben() };
    if (typeof body === "object" && body !== null) {
        for (const [id, wert] of Object.entries(body as Record<string, unknown>)) {
            const einstellung = karteneinstellung(id);
            if (einstellung !== undefined && karteneinstellungImRahmen(einstellung, wert)) werte[id] = wert;
        }
    }
    return werte as unknown as KartenEinstellungen;
}

/** Einmal vor dem Start lesen. Scheitert es, bleibt es bei den Vorgaben. */
export async function ladeStartansicht(
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    waitMs: number = START_VIEW_WAIT_MS,
): Promise<KartenEinstellungen> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
        const response = await fetcher(MAP_SETTINGS_URL, { signal: controller.signal, cache: "no-cache" });
        if (response.ok) {
            const body = (await response.json()) as unknown;
            geladen = leseKartenEinstellungen(body);
            wegfindungGeladen = wegfindungImBrowserAus((body as { wegfindung?: unknown } | null)?.wegfindung);
        }
    } catch {
        // Ohne Antwort gelten die Vorgaben.
    } finally {
        clearTimeout(timer);
    }
    return startansicht();
}

/** Die Werte, mit denen die Karte startet: gelesen, sonst die Vorgaben der Tafel. */
export function startansicht(): KartenEinstellungen {
    return geladen ?? karteneinstellungVorgaben();
}

/**
 * Die Werte der Wegfindung, die der Planer selbst anwendet (WI-0214): Grenze der Wegpunkte und der Kartenpunkte, kleinste
 * genannte Landschaft. Sie kommen mit derselben Antwort wie die Startansicht; ohne Antwort die Vorgaben des Registers.
 */
export function wegfindungImBrowserWerte(): WegfindungswerteImBrowser {
    return wegfindungGeladen ?? wegfindungImBrowserAus(undefined);
}

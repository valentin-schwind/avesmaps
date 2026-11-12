import { shallowRef } from "vue";
import { Value } from "@sinclair/typebox/value";
import {
    AVENTURIA_SERIES,
    KARTENSERIE_THUMB_VORGABE,
    MAP_SERIES_URL,
    MapSeriesCatalog,
    type MapSeries,
    type MapSeriesThumb,
} from "@avesmaps3d/shared";

/**
 * Der Katalog der Kartenserien im Browser (WI-0220): was die Systemsteuerung eingestellt hat, gelesen über `GET /api/map-series`,
 * statt der beim Bauen gebündelten JSON. `main.ts` liest ihn VOR dem Start, neben Sitzung und Startansicht; die Karte entsteht
 * mit der richtigen Vorgabe-Serie und springt nicht hinterher.
 *
 * - **Fehlerrichtung:** Ohne Antwort (Netz, Zeitgrenze, älterer Server ohne den Weg) gilt die gebündelte Vorgabe, nie ein Fehler.
 * - 🔴 **Tolerant lesen** (AGENTS.md „Migrationen“, Punkt 4): Eine Antwort, die nicht zum Schema passt, wird verworfen, die Vorgabe
 *   bleibt. Ein Katalog ohne Serie auch.
 * - Reaktiv (`shallowRef`): Speichert der Reiter „Kartenserien“, liest er neu, und Fächer und Karte folgen ohne Neuladen.
 */

export const KARTENSERIEN_WAIT_MS = 2_500;

const katalog = shallowRef<MapSeriesCatalog>(AVENTURIA_SERIES);
let etag: string | null = null;

/** Prüft eine Antwort; passt sie nicht, `undefined`. */
export function leseKatalog(body: unknown): MapSeriesCatalog | undefined {
    if (!Value.Check(MapSeriesCatalog, body)) return undefined;
    if (body.series.length === 0 || !body.series.some((s) => s.id === body.defaultSeries)) return undefined;
    return body;
}

/** Einmal vor dem Start lesen, danach nach jedem Speichern im Reiter. Scheitert es, bleibt der bisherige Stand. */
export async function ladeKartenserien(
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    waitMs: number = KARTENSERIEN_WAIT_MS,
): Promise<MapSeriesCatalog> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
        const response = await fetcher(MAP_SERIES_URL, {
            signal: controller.signal,
            cache: "no-cache",
            ...(etag === null ? {} : { headers: { "if-none-match": etag } }),
        });
        if (response.ok) {
            const gelesen = leseKatalog((await response.json()) as unknown);
            if (gelesen !== undefined) {
                katalog.value = gelesen;
                etag = response.headers.get("etag");
            }
        }
    } catch {
        // Ohne Antwort bleibt der bisherige Stand.
    } finally {
        clearTimeout(timer);
    }
    return katalog.value;
}

/** Der wirksame Katalog (reaktiv). */
export function kartenserienKatalog(): MapSeriesCatalog {
    return katalog.value;
}

/** Eine Serie des Katalogs; eine unbekannte Kennung (alter Link, gelöschte Serie) fällt auf die Vorgabe-Serie zurück. */
export function kartenserie(id: string): MapSeries {
    const stand = katalog.value;
    return (
        stand.series.find((s) => s.id === id) ??
        stand.series.find((s) => s.id === stand.defaultSeries) ??
        stand.series[0]!
    );
}

/** Das Bild einer Serie im Fächermenü: ihre gewählte Kachel der Stufe 5, sonst Gareth. */
export function kartenserieThumb(serie: Pick<MapSeries, "thumb">): MapSeriesThumb {
    return serie.thumb ?? KARTENSERIE_THUMB_VORGABE;
}

/** Nur für Tests: zurück auf die gebündelte Vorgabe. */
export function kartenserienZuruecksetzen(): void {
    katalog.value = AVENTURIA_SERIES;
    etag = null;
}

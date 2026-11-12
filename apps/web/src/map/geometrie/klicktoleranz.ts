import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Die höhere Klicktoleranz der Zeichenmodi (EDIT-0003 G13; Legacy `AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX` in
 * `js/map-features/map-features.js`, Mirror 5ff58118): Ein verwackelter Klick setzt einen Punkt, statt die Karte zu schieben. Legacy
 * hebt dafür die Toleranz des Leaflet-Ziehens an; MapLibre kennt `clickTolerance` nur beim Bau der Karte und liest es danach aus drei
 * Feldern: das Klick-Ereignis (`mapEvent`), das Ziehen mit der Maus und mit dem Finger. Die drei werden für die Dauer des Modus gesetzt
 * und danach zurückgestellt.
 *
 * 🪤 Das sind innere Felder von MapLibre (6.10). Fehlt eines nach einem Update, bleibt es still bei der Toleranz der Karte; der
 * Browsertest der Wegzeichnung („verwackelter Klick“) fällt dann und zeigt es.
 */

/** Wie Legacy: 12 statt der 3 Bildpunkte der Karte. */
export const ZEICHEN_KLICKTOLERANZ_PX = 12;

interface MitToleranz {
    _clickTolerance?: unknown;
}

interface Innen {
    _handlers?: { _handlersById?: Record<string, MitToleranz | undefined> };
    dragPan?: { _mousePan?: MitToleranz; _touchPan?: MitToleranz };
}

/** MapLibres Vorgabe (`clickTolerance`); gilt nur, falls das innere Feld nach einem Update fehlt. */
const KARTEN_KLICKTOLERANZ_PX = 3;

/** Die Toleranz, die gerade für Klicks gilt: das Feld, das MapLibres Klick-Ereignis prüft und `hebeKlicktoleranz` hebt. */
export function klicktoleranz(map: MapLibreMap): number {
    const wert = (map as unknown as Innen)._handlers?._handlersById?.["mapEvent"]?._clickTolerance;
    return typeof wert === "number" ? wert : KARTEN_KLICKTOLERANZ_PX;
}

/** Setzt die Toleranz auf `px` und gibt zurück, was sie wieder herstellt. */
export function hebeKlicktoleranz(map: MapLibreMap, px: number = ZEICHEN_KLICKTOLERANZ_PX): () => void {
    const innen = map as unknown as Innen;
    const ziele = [innen._handlers?._handlersById?.["mapEvent"], innen.dragPan?._mousePan, innen.dragPan?._touchPan];
    const vorher: [MitToleranz, number][] = [];
    for (const ziel of ziele) {
        if (ziel === undefined || typeof ziel._clickTolerance !== "number") continue;
        vorher.push([ziel, ziel._clickTolerance]);
        ziel._clickTolerance = Math.max(ziel._clickTolerance, px);
    }
    return () => {
        for (const [ziel, wert] of vorher) ziel._clickTolerance = wert;
    };
}

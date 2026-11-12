import { DAYS_PER_YEAR } from "../calendar.ts";

// Eigenes Modul, weil die Wetterschalter im Startpaket es brauchen (`apps/web/src/map/wetter/wetter-schalter.ts`) und `jahr.ts` mit seinen Tafeln
// erst mit dem Wetter nachlädt (Besucherpaket, WI-0235).

/**
 * Das Datum des Wetters (WI-0288 Stufe 5) als Tag im Jahr mit Bruchteil, von 1 bis unter 366: der Reisebeginn, während eines Replays plus
 * die vergangenen Reisetage samt Rast (`JourneyPosition.days`). 365,5 ist der Mittag des 5. Namenlosen Tags, eine halbe Stunde nach
 * Mitternacht folgt der 1. Praios mit 1,02. Ohne Reisebeginn `null` (unbestimmt), auch im Replay: Ohne Anfang gibt es kein Reisedatum.
 */
export function wetterReisetag(beginn: number | null, tage: number | null | undefined = 0): number | null {
    if (beginn === null) return null;
    const vergangen = typeof tage === "number" && Number.isFinite(tage) ? Math.max(0, tage) : 0;
    return ((((beginn - 1 + vergangen) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) + 1;
}

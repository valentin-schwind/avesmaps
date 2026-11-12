import type { Box } from "../map/camera/visible-area";

/**
 * Wo der einmalige Kamera-Hinweis steht (Editor-Orchestrierung 2026-10-19, nach den Funden der Gebiete an ortseditor.spec): immer GANZ in
 * der freien Fläche, wie die Ziele der Kamera. Er verdeckt nichts (vorher lag er beim ersten Besuch über dem Kopf des angedockten
 * Fensters) und wird von nichts verdeckt (danach lag der Planer über „Verstanden“, neue Nutzer wurden ihn nicht los).
 *
 * - **Oben rechts in der freien Fläche**, mit Rand: Das ist links neben dem Kameraring, der als Zieldeckung aus der Fläche fällt.
 * - **So breit, wie die Fläche es zulässt**, höchstens die Breite des Hinweises.
 * - **Passt er nicht** (keine Lücke zwischen Planer und Fenster, oder schmaler als `HINWEIS_MIN_BREITE`), steht er nicht da und kommt,
 *   sobald die Fläche reicht, etwa nach dem Schließen des Fensters. Er bleibt bis „Verstanden“ gemerkt.
 */
export interface HinweisPlatz {
    /** Abstand von oben im Fenster des Browsers, in Pixeln (`position: fixed`). */
    readonly top: number;
    /** Abstand vom rechten Rand des Browserfensters. */
    readonly right: number;
    readonly maxWidth: number;
}

/** Schmaler bricht der Satz zu oft um; dann wartet der Hinweis auf mehr Platz. */
export const HINWEIS_MIN_BREITE = 200;
/** Abstand zum Rand der freien Fläche. */
export const HINWEIS_RAND = 12;

/**
 * `frei`: die freie Fläche in Bildpunkten der Karte (`freieFlaeche`), ohne Lücke `undefined`. `karte`: die linke obere Ecke der Karte im
 * Browserfenster. `fensterBreite`: die Breite des Browserfensters.
 */
export function hinweisPlatz(
    frei: Box | undefined,
    karte: { left: number; top: number },
    fensterBreite: number,
): HinweisPlatz | null {
    if (frei === undefined || frei.width - 2 * HINWEIS_RAND < HINWEIS_MIN_BREITE) return null;
    return {
        top: Math.round(karte.top + frei.top + HINWEIS_RAND),
        right: Math.round(fensterBreite - (karte.left + frei.left + frei.width) + HINWEIS_RAND),
        maxWidth: Math.floor(frei.width - 2 * HINWEIS_RAND),
    };
}

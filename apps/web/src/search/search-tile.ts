/**
 * Die Suchkachel am Finger (WI-0026): drei Zahlen, aus denen Legacys Bewegung „die Lupe wächst zum
 * Feld" entsteht (`js/ui/spotlight-search.js`). Jede wird GEMESSEN, keine gerechnet - die Lage
 * aus Bundabstand und Reihenhöhen zu rechnen, hat Legacy den Suchknopf einmal 8 px danebengesetzt.
 */

/** So weit steht die Unterkante der Kachel über dem unteren Bildrand; dort sitzt das Suchfenster. */
export function distanceAboveBottom(viewportHeight: number, tileBottom: number): number {
    return Math.round(Math.max(0, viewportHeight - tileBottom));
}

/**
 * So viel verdeckt die Bildschirmtastatur.
 *
 * 💣 iOS schrumpft den Layout-Viewport NICHT, wenn sie aufgeht: der untere Rand zeigt weiter auf den
 * Bildschirmrand, und ein unten verankertes Feld verschwände dahinter. Die tatsächlich sichtbare
 * Höhe kennt nur `visualViewport`.
 */
export function keyboardCover(viewportHeight: number, visible: { height: number; offsetTop: number }): number {
    return Math.round(Math.max(0, viewportHeight - visible.height - visible.offsetTop));
}

/**
 * So viel des Fensters ist im ersten Bild noch verdeckt: offen steht nur die Kachel an seinem
 * rechten Ende, der Rest wird nach links freigegeben.
 */
export function revealStart(cardWidth: number, tileWidth: number): number {
    return Math.round(Math.max(0, cardWidth - Math.min(tileWidth, cardWidth)));
}

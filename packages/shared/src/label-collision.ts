/**
 * Wie der Style den Kollisionsrang liest (WI-0007).
 *
 * ⭐ DIE FORMEL STEHT NICHT HIER. Sie steht in der Datenbank (`label_collision_rank`, Migration
 * 0017), weil die Klassenordnung zur Laufzeit pflegbar sein soll — Betreiberpräzisierung vom
 * 2026-09-21: die globale Klassenpriorität ist nicht pro Objekt überschreibbar, soll aber auch
 * nicht als feste Systemkonstante im Code liegen. Ein `match`-Ausdruck im Frontend-Bundle ist genau
 * so eine Konstante; er ändert sich nur durch ein Release.
 *
 * Diese Datei ist deshalb bewusst dünn. Sie hält den Namen der Eigenschaft und die Leserichtung an
 * einer Stelle fest, damit nicht drei Layer dieselbe Zeile leicht verschieden schreiben.
 *
 * 💣 Vorher stand an den drei Stellen dreierlei: die Ortsnamen sortierten über ein Klassenliteral
 * im Frontend, Kurven- und Punktlabels über den ROHEN `label_priority`. Letzteres war verkehrt
 * herum — Legacy sortiert absteigend (`right.priority - left.priority`), MapLibre platziert den
 * niedrigeren Wert zuerst. Das Label mit Priorität 1 gewann also alles, die mit Priorität 4
 * verloren. Die Spiegelung passiert jetzt einmal, in SQL.
 */

/** Die Eigenschaft, die jede Renderrelation fertig ausliefert. */
export const COLLISION_RANK_PROPERTY = "collision_rank";

/**
 * Der `symbol-sort-key` für jeden Beschriftungslayer: klein gewinnt, wie MapLibre ihn liest.
 *
 * 🪤 Der Rückfallwert ist absichtlich HOCH und nicht 0. Ein Feature ohne Rang ist ein Fehler in der
 * Kachel; es soll dann hinten anstehen, statt alle anderen zu verdrängen.
 */
export const MISSING_RANK = 99_999;

export function collisionSortKey(): unknown[] {
    // 🪤 Die Reihenfolge ist entscheidend und war im ersten Entwurf falsch herum. `to-number`
    // macht aus einer fehlenden Eigenschaft eine 0, BEVOR `coalesce` sie sehen kann - der
    // Rückfallwert wäre nie zum Zug gekommen, und ein Feature ohne Rang hätte alle anderen
    // verdrängt. Erst auffangen, dann umwandeln. Ein Unit-Test hat das gemeldet, kein Blick.
    return ["to-number", ["coalesce", ["get", COLLISION_RANK_PROPERTY], MISSING_RANK]];
}

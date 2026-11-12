/**
 * Wo das Menü steht (WI-0063 P9): am angeklickten Punkt, ein Stück daneben, damit das Objekt, das man eben anklickte, sichtbar bleibt.
 * Reine Rechnung in Fensterkoordinaten, ohne DOM - gemessen wird die Größe, die das Menü hat, sobald es steht.
 *
 * - **Rechts und unterhalb** des Punktes, ein Abstand dazwischen. Reicht der Platz dort nicht, klappt es zur anderen Seite (links, oben),
 *   wie das Kartenmenü.
 * - **Nur auf der freien Karte:** Der Platz ist das Fenster ohne die Panels, die die Karte decken (`bounds`, aus `data-map-overlay`).
 *   Der Klick, der das Menü öffnet, schiebt auch das Infopanel herein; ein Menü, das darüber läge, deckte dessen Aktionen.
 * - **Nie über den Rand:** Danach gilt der Rand dieses Platzes, auch wenn das Menü zu groß ist.
 */

export interface MenuPoint {
    x: number;
    y: number;
}

export interface MenuSize {
    width: number;
    height: number;
}

/** Der freie Platz in Fensterkoordinaten. */
export interface MenuBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Abstand zum Rand des freien Platzes, wie das Kartenmenü (`controls/map-context-menu.vue`). */
export const MENU_EDGE = 8;
/** Abstand zum angeklickten Punkt: Ein Ortszeichen und sein goldener Kern bleiben daneben zu sehen. */
export const MENU_GAP = 12;

/** Eine Achse: hinter den Punkt, sonst davor, und danach in den Platz geklemmt. */
function along(anchor: number, length: number, from: number, to: number): number {
    const low = from + MENU_EDGE;
    const high = to - MENU_EDGE;
    const after = anchor + MENU_GAP;
    const start = after + length > high ? anchor - MENU_GAP - length : after;
    return Math.max(low, Math.min(start, high - length));
}

export function placeMenu(anchor: MenuPoint, size: MenuSize, bounds: MenuBounds): MenuPoint {
    return {
        x: along(anchor.x, size.width, bounds.left, bounds.right),
        y: along(anchor.y, size.height, bounds.top, bounds.bottom),
    };
}

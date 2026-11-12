/**
 * Wo das Kartenmenü aufgeht: neben dem Zeiger, nicht unter dem Finger (WI-0108 Nachtrag, Betreiber 2026-10-11: „du kannst auch
 * einen kleinen zeiger |\ bauen und das menü mit einem kleinen offset daneben aufgehen lassen“).
 *
 * - **Knapp neben dem Fadenkreuz**: 12 px nach rechts, 10 px nach unten, mit Maus und Finger gleich (Betreiber 2026-10-11 zu
 *   Blatt 2: „prima, schönes symbol - der abstand zum menü kann ruhig etwas geringer sein“). Legacy versetzt um 18 / 14 px
 *   (`MAP_CONTEXT_MENU_OFFSET_X/Y`, `js/config.js:267-268`) neben seinem kleineren Punkt. So bleibt die Menüecke rund 6 px vom
 *   Ring (Radius 7,5 plus Saum), und die Striche (bis 12 plus Saum) liegen neben dem Menü, nie darunter. Vorher lag die Ecke genau
 *   am Druckpunkt, und die Fingerkuppe deckte „Was ist hier?“ (WI-0108 §B1). 🔴 FESTGEHALTEN (Betreiber 2026-10-11: „12 / 10 ist
 *   hübsch, genau das ist schön“): nicht an Legacys 18 / 14 angleichen.
 * - **Am Rand klappt es um**, wie bisher, jetzt mit demselben Versatz zur anderen Seite: Der Punkt bleibt frei, der Zeiger
 *   bleibt an ihm. Legacy klemmt nur ins Fenster; das Umklappen ist unsere Regel aus WI-0108 und bleibt.
 * - **8 px Rand** zum Fenster (`MAP_CONTEXT_MENU_VIEWPORT_PADDING`, `js/config.js:266`), wenn keine Seite reicht.
 */
export const MENU_OFFSET = { x: 12, y: 10 } as const;
export const MENU_EDGE = 8;

export interface MenuPlacement {
    left: number;
    top: number;
    /** Steht das Menü links vom Punkt? */
    flipX: boolean;
    /** Steht das Menü über dem Punkt? */
    flipY: boolean;
}

export function menuPlacement(
    at: { x: number; y: number },
    box: { width: number; height: number },
    view: { width: number; height: number },
): MenuPlacement {
    const flipX = at.x + MENU_OFFSET.x + box.width > view.width - MENU_EDGE;
    const flipY = at.y + MENU_OFFSET.y + box.height > view.height - MENU_EDGE;
    const left = flipX ? at.x - MENU_OFFSET.x - box.width : at.x + MENU_OFFSET.x;
    const top = flipY ? at.y - MENU_OFFSET.y - box.height : at.y + MENU_OFFSET.y;
    const clamp = (value: number, size: number, room: number): number =>
        Math.max(MENU_EDGE, Math.min(value, room - size - MENU_EDGE));
    return { left: clamp(left, box.width, view.width), top: clamp(top, box.height, view.height), flipX, flipY };
}

/**
 * Zwei Karten (EDIT-0003 R7, T27 (4); Betreiber zum Probierblatt Landschaften 2026-10-16: „Die untermenüs unter "hier liegen 4 flächen"
 * und das in kombination mit dem 2-karten-menü, gefällt mir sehr gut“, und „das obere menü blatt und das untere menüblatt näher
 * zusammen (generell)“): Für Editoren steht der Abschnitt der Editoren als eigene Karte ÜBER dem Punkt, die Karte der Besucher darunter.
 *
 * - **Waagrecht wie das eine Menü:** 12 px rechts vom Punkt (`MENU_OFFSET.x`, festgehalten), am rechten Rand links mit demselben
 *   Versatz; dann schließt jede Karte mit ihrer eigenen rechten Kante 12 px vor dem Punkt ab.
 * - **Senkrecht eng:** 6 px über und unter dem Punkt (`KARTEN_ABSTAND`), also 12 px zwischen den Karten, wie im Probierblatt
 *   abgenommen. Das Fadenkreuz bleibt frei: Seine Striche enden 12 px neben dem Punkt, die Karten beginnen dort.
 * - **Ohne Platz oben** rückt die obere Karte an den Rand (8 px) und die untere unter sie; ohne Platz unten rückt der Stapel als
 *   Ganzes hoch. Die Lücke zwischen den Karten bleibt immer.
 * - **Reicht die Höhe nicht für beide übereinander** (T41, Editor-Orchestrierung 2026-10-18, Variante a: das flache „Verbergen“
 *   machte die Karte einer Fläche bei 1280 × 720 zu hoch), stehen sie nebeneinander, oben bündig 10 px unter dem Punkt (wie das eine
 *   Menü) und ins Fenster gerückt: die Editoren 12 px rechts vom Punkt, die Besucher rechts daneben; am rechten Rand die Editoren
 *   12 px links vom Punkt und die Besucher links davon. Die Lücke ist dieselbe (12 px).
 * - **Reicht auch die Breite nicht**, stehen sie übereinander, und die Karte der Editoren rollt (`editorHoehe`): letzter Rückfall.
 *   Am Telefon gilt das Blatt von unten, nicht diese Lage.
 */
export const KARTEN_ABSTAND = 6;

export interface ZweiKartenLage {
    editor: { left: number; top: number };
    besucher: { left: number; top: number };
    flipX: boolean;
    /** Nebeneinander, weil die Höhe nicht für beide übereinander reicht. */
    nebeneinander?: true;
    /** Letzter Rückfall: So hoch ist die Karte der Editoren, sie rollt. */
    editorHoehe?: number;
}

export function zweiKartenLage(
    at: { x: number; y: number },
    editor: { width: number; height: number },
    besucher: { width: number; height: number },
    view: { width: number; height: number },
): ZweiKartenLage {
    const breite = Math.max(editor.width, besucher.width);
    const flipX = at.x + MENU_OFFSET.x + breite > view.width - MENU_EDGE;
    const links = (width: number): number =>
        Math.max(
            MENU_EDGE,
            Math.min(flipX ? at.x - MENU_OFFSET.x - width : at.x + MENU_OFFSET.x, view.width - width - MENU_EDGE),
        );
    const luecke = 2 * KARTEN_ABSTAND;
    if (editor.height + luecke + besucher.height > view.height - 2 * MENU_EDGE) {
        const hoch = Math.max(editor.height, besucher.height);
        const paar = editor.width + luecke + besucher.width;
        const rechts = view.width - MENU_EDGE - (at.x + MENU_OFFSET.x) >= paar;
        const linksVomPunkt = at.x - MENU_OFFSET.x - MENU_EDGE >= paar;
        if (hoch <= view.height - 2 * MENU_EDGE && (rechts || linksVomPunkt)) {
            const top = Math.max(MENU_EDGE, Math.min(at.y + MENU_OFFSET.y, view.height - MENU_EDGE - hoch));
            const editorLeft = rechts ? at.x + MENU_OFFSET.x : at.x - MENU_OFFSET.x - editor.width;
            return {
                editor: { left: editorLeft, top },
                besucher: {
                    left: rechts ? editorLeft + editor.width + luecke : editorLeft - luecke - besucher.width,
                    top,
                },
                flipX: !rechts,
                nebeneinander: true,
            };
        }
        const editorHoehe = Math.max(0, view.height - 2 * MENU_EDGE - luecke - besucher.height);
        return {
            editor: { left: links(editor.width), top: MENU_EDGE },
            besucher: { left: links(besucher.width), top: MENU_EDGE + editorHoehe + luecke },
            flipX,
            editorHoehe,
        };
    }
    let editorTop = at.y - KARTEN_ABSTAND - editor.height;
    let besucherTop = at.y + KARTEN_ABSTAND;
    const darunter = (): number => editorTop + editor.height + 2 * KARTEN_ABSTAND;
    if (editorTop < MENU_EDGE) {
        editorTop = MENU_EDGE;
        besucherTop = Math.max(besucherTop, darunter());
    }
    if (besucherTop + besucher.height > view.height - MENU_EDGE) {
        // Der Stapel rückt als Ganzes hoch, so weit es oben geht; die Lücke zwischen den Karten bleibt.
        editorTop = Math.max(MENU_EDGE, view.height - MENU_EDGE - besucher.height - 2 * KARTEN_ABSTAND - editor.height);
        besucherTop = darunter();
    }
    return {
        editor: { left: links(editor.width), top: editorTop },
        besucher: { left: links(besucher.width), top: besucherTop },
        flipX,
    };
}

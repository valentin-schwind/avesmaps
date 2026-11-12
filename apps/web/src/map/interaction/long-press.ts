/**
 * Der lange Druck mit EINEM Finger auf die Karte - am Telefon das, was am Rechner der Rechtsklick ist
 * (Kontextmenü). iOS kennt kein `contextmenu`-Ereignis, deshalb misst die Karte selbst.
 *
 * Er gilt, wenn der Finger 550 ms fast still liegt (höchstens 10 px) und kein zweiter dazukommt -
 * sonst war es Schieben, Zoomen oder Drehen, und das gehört der Karte. Seit M8 misst der Koordinator ihn; seit
 * WI-0108 verteilt er ihn als `contextmenu`, also über denselben Weg wie die rechte Maustaste (Betreiber
 * 2026-10-08: „langer tap ist rechtsklick“). Wer den Finger erfasst (`capture`), bricht ihn ab, und jede
 * Kartenbewegung tut es auch.
 *
 * 🪤 **Die 10 px sind am Finger selten die entscheidende Zahl**, gemessen am 2026-10-08 im Telefonprofil:
 * Chromium liefert `touchmove` erst, wenn der Finger den Tippradius der Plattform verlässt (auf Android
 * 15 CSS-px, dieselbe Zahl, die Leaflet in Legacy als `tapTolerance` setzt). Bis dahin kommt gar kein
 * Bewegungsereignis an - gemessen: 14 px halten den Druck, 16 px verwerfen ihn. Die 10 px greifen also auf
 * Engines mit kleinerem Radius; die obere Schranke setzt die Plattform.
 */
export const LONG_PRESS_MS = 550;
export const LONG_PRESS_TOLERANCE_PX = 10;

/**
 * Wie lange nach dem Loslassen eines langen Drucks der Riegel gegen den Klick des Browsers gilt (Koordinator, `swallowClick`). Der Klick, den ein Browser aus dem Loslassen
 * macht, kommt mit dem Loslassen, nie später; wer ihn nimmt (`preventDefault` auf dem `touchend`), schickt keinen, und dann darf der Riegel nicht stehen bleiben: Er
 * verschluckte den nächsten echten Klick auf die Karte, den ohne neuen Touch (Maus, Stift, ein synthetischer Tipp), und am Telefon ließe sich eine Stelle nicht neu wählen.
 */
export const LONG_PRESS_RELEASE_CLICK_MS = 500;

export interface LongPress<E> {
    /** Ein Finger ist aufgesetzt (`touches`: wie viele liegen). */
    start(event: E, touches: readonly { clientX: number; clientY: number }[]): void;
    /** Ein Finger hat sich bewegt. */
    move(touches: readonly { clientX: number; clientY: number }[]): void;
    /** Der Druck ist vorbei oder gehört jemand anderem. */
    cancel(): void;
}

interface Timers {
    set: (callback: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
}

/**
 * @param onPress - der Druck hat gedauert: bekommt das Ereignis vom Beginn des Drucks.
 */
export function createLongPress<E>(onPress: (event: E) => void, timers: Timers): LongPress<E> {
    let timer: unknown;
    let start: { x: number; y: number } | undefined;

    const cancel = (): void => {
        if (timer !== undefined) timers.clear(timer);
        timer = undefined;
        start = undefined;
    };

    return {
        start(event, touches) {
            cancel();
            const touch = touches[0];
            if (touches.length !== 1 || !touch) return;
            start = { x: touch.clientX, y: touch.clientY };
            timer = timers.set(() => {
                timer = undefined;
                start = undefined;
                onPress(event);
            }, LONG_PRESS_MS);
        },
        move(touches) {
            const touch = touches[0];
            if (!start || !touch || touches.length !== 1) return cancel();
            if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > LONG_PRESS_TOLERANCE_PX) cancel();
        },
        cancel,
    };
}

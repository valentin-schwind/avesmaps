import type { Box } from "../map/camera/visible-area";

/**
 * Ein Klick in der Wege-Liste holt den Weg in die freie Fläche, wenn er ganz oder fast ganz verdeckt ist (WI-0177; Betreiber 2026-10-19
 * „Ja, wenn verdeckt (Empfehlung)“). Sonst gilt weiter EDIT-0001 D17 (G3, seine Antwort „A“): Der Einfachklick wählt und öffnet, die
 * Karte steht, erst der Doppelklick fliegt. Anlass: Er klickte den Breitenstieg an und sah keine Nummern, weil der Weg unter dem
 * angedockten Fenster lag.
 *
 * „Fast ganz verdeckt“ misst der Rahmen des Wegs in Bildpunkten: Liegt weniger als `VERDECKT_UNTER` seiner Fläche in der freien Fläche,
 * fliegt die Kamera.
 */

/** Unter diesem Anteil des Rahmens in der freien Fläche gilt ein Weg als verdeckt. */
export const VERDECKT_UNTER = 0.25;

/** Ein Rahmen in Bildpunkten der Karte. */
export interface Rahmen {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/**
 * Wie viel vom Rahmen in der freien Fläche liegt, 0 bis 1. Ein waagrechter oder senkrechter Weg hat einen Rahmen ohne Höhe oder Breite;
 * er zählt mit mindestens einem Bildpunkt, damit er nicht als verdeckt gilt, nur weil er flach ist.
 */
export function sichtbarerAnteil(rahmen: Rahmen, frei: Box): number {
    const breite = Math.max(1, rahmen.right - rahmen.left);
    const hoehe = Math.max(1, rahmen.bottom - rahmen.top);
    const links = Math.max(rahmen.left, frei.left);
    const rechts = Math.min(rahmen.left + breite, frei.left + frei.width);
    const oben = Math.max(rahmen.top, frei.top);
    const unten = Math.min(rahmen.top + hoehe, frei.top + frei.height);
    return (Math.max(0, rechts - links) * Math.max(0, unten - oben)) / (breite * hoehe);
}

/** Ist der Weg ganz oder fast ganz verdeckt? */
export const istVerdeckt = (rahmen: Rahmen, frei: Box): boolean => sichtbarerAnteil(rahmen, frei) < VERDECKT_UNTER;

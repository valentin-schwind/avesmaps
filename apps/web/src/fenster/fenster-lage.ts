/**
 * Die Lagen eines Werkzeugfensters (WI-0128 E6, EDIT-0001 §4.1, D14): was die Hülle (`avm-fenster.vue`) und die Fensterverwaltung des
 * Editorpanels gemeinsam rechnen. Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * - `modal` ist jedes bisherige Fenster: mittig, mit Schleier, in der obersten Ebene.
 * - `angedockt`, `geloest`, `versenkt` sind die Lagen eines Werkzeugs neben der Karte.
 */

export type FensterHuellenLage = "modal" | "angedockt" | "geloest" | "versenkt";

export interface FensterBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** Die Mindestgröße eines gelösten Fensters (EDIT-0001 §4.1). */
export const MINDEST = { width: 520, height: 240 } as const;

/**
 * Wo ein gelöstes Fenster zuerst erscheint, solange keine Box gemerkt ist: links unten (WI-0150) oder mittig über der Karte (die Fenster der Besucher,
 * Betreiber 2026-10-31: „popups … im frontend standardmäßig abgedockt … und zentriert, erst der ‚andocken‘ dockt es an. angedockt bleibt standard im backend“).
 * `oben-mitte` ist die Mitte am oberen Rand: der schmale Balken eines eingeklappten Fensters während eines Modus auf der Karte (Reisebilder, „Stelle ändern“, WI-0272 Entwurf 8), damit die
 * Karte in der Mitte zum Tippen frei bleibt.
 */
export type FensterVorgabeEcke = "links-unten" | "mitte" | "oben-mitte";

/**
 * Die Klasse für die Vorgabe-Ecke, oder `undefined` — dann steht das Fenster wie bisher.
 *
 * 🔴 **Eine gemerkte Box schlägt die Ecke.** Die Ecke ist nur der erste Platz; wer das Fenster einmal verschoben hat,
 * findet es dort wieder (`werkzeugfenster.ts` merkt Lage und Box). Und sie gilt nur gelöst: Angedockt, versenkt und modal
 * stellt die Lage selbst (WI-0150, Kanal OPS-000002, Thomas: „Links unten immer sichtbar (im Editormodus)").
 *
 * 🪤 Als Klasse, nicht als Zahlenbox: Pixel, die niemand gezogen hat, müssten bei jeder Fenstergröße nachgerechnet werden —
 * `begrenzeBox` greift nur während eines Zugs, eine zu große Box stünde sonst außerhalb des Bildes.
 */
export function vorgabeEckeKlasse(
    lage: FensterHuellenLage,
    box: FensterBox | undefined,
    ecke: FensterVorgabeEcke | undefined,
): string | undefined {
    if (ecke === undefined || lage !== "geloest" || box !== undefined) return undefined;
    return `avm-fenster--${ecke}`;
}

/**
 * Die Höhe, die ein Fenster mit `stabil` für eine Ansicht hält (WI-0272, Entwurf 8; Betreiber 2026-11-01: „die abmessungen des dialogs müssen stabil bleiben sonst verschwindet der
 * upload button unten“): das Gemessene plus etwas Luft für das, was später dazukommt, höchstens so hoch wie `deckel` (die Ansicht davor: eine Bestätigung ist nie höher als das Formular),
 * auf eine gerade Zahl gerundet (steht das Fenster mit `translate` in der Mitte, setzt eine ungerade Höhe es auf halbe Bildpunkte, und die Schrift wird weich).
 */
export function stabileHoehe(gemessen: number, luft: number, deckel?: number): number {
    const mitLuft = gemessen + Math.max(0, luft);
    // Ein Deckel gilt hart und nach unten gerundet (nie höher als die Ansicht davor); sonst wird auf die nächste gerade Zahl gerundet.
    const hoehe = deckel !== undefined && mitLuft > deckel ? Math.floor(deckel / 2) * 2 : Math.round(mitLuft / 2) * 2;
    return Math.max(0, hoehe);
}

/** Ab so vielen Pixeln Zug am Kopf löst sich ein angedocktes Fenster (EDIT-0001 §7.1 T6.1). */
export const LOESEN_AB = 6;

/** Löst dieser Zug ein angedocktes Fenster? */
export const loestSich = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= LOESEN_AB;

/**
 * Hält eine Box in ihrem Elternteil und über der Mindestgröße; ist das Elternteil kleiner, füllt sie es.
 *
 * `mindest` übergibt ein Fenster, dessen Inhalt kleiner ist als die Vorgabe für Werkzeugfenster — die Messwerte brauchen
 * keine 240 px Höhe, und was darüber liegt, ist leere Fläche (Betreiber 2026-10-14: „die kleinst möglichen abmessungen
 * und weniger leerraum nach unten“).
 */
export function begrenzeBox(
    box: FensterBox,
    bild: { width: number; height: number },
    mindest: { width: number; height: number } = MINDEST,
): FensterBox {
    const width = Math.min(Math.max(mindest.width, box.width), Math.max(mindest.width, bild.width));
    const height = Math.min(Math.max(mindest.height, box.height), Math.max(mindest.height, bild.height));
    const left = Math.min(Math.max(box.left, 0), Math.max(0, bild.width - width));
    const top = Math.min(Math.max(box.top, 0), Math.max(0, bild.height - height));
    return { left, top, width, height };
}

/** Eine Box aus einem Rechteck, gemessen in den Koordinaten des Elternteils. */
export function boxIn(rechteck: DOMRectReadOnly | FensterBox, eltern: { left: number; top: number }): FensterBox {
    return {
        left: rechteck.left - eltern.left,
        top: rechteck.top - eltern.top,
        width: rechteck.width,
        height: rechteck.height,
    };
}

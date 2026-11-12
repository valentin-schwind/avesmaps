/**
 * Was die Bildansicht rechnet (`avm-bildansicht.vue`, Betreiber 2026-10-11). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 */

/** Ein Bild der Ansicht. Maße, wo bekannt (sonst misst der Browser beim Laden); Titel und Nennung stehen darunter. */
export interface AnsichtBild {
    url: string;
    breite?: number | null | undefined;
    hoehe?: number | null | undefined;
    titel?: string | null | undefined;
    /** Die Nennung, wo eine Freigabe sie verlangt: Sie gehört zum Bild, auch groß. */
    nennung?: string | null | undefined;
    /** Ein KI-Bild: Was das heißt, zeichnet der Aufrufer in den Slot `nennung-zusatz` (ein Reisebild, `info-header.vue`). */
    ki?: boolean | undefined;
}

export interface Masse {
    breite: number;
    hoehe: number;
}

/** Höchstens so viel größer als das Original: darüber wird ein kleines Bild nur noch weich. */
export const HOECHSTENS_VERGROESSERT = 2;

/**
 * Die Größe auf dem Schirm: so groß wie der Platz erlaubt, Seitenverhältnis unverändert, nie über das Doppelte des Originals. Ohne
 * bekannte Maße oder ohne Platz `undefined` (dann gilt die natürliche Größe, begrenzt auf den Platz).
 */
export function einpassen(bild: Partial<Masse>, platz: Masse): Masse | undefined {
    const { breite, hoehe } = bild;
    if (breite === undefined || hoehe === undefined || breite <= 0 || hoehe <= 0) return undefined;
    if (platz.breite <= 0 || platz.hoehe <= 0) return undefined;
    const faktor = Math.min(platz.breite / breite, platz.hoehe / hoehe, HOECHSTENS_VERGROESSERT);
    return { breite: Math.floor(breite * faktor), hoehe: Math.floor(hoehe * faktor) };
}

/** Blättern im Kreis: nach dem letzten kommt das erste. `null`, wenn es nichts zu blättern gibt. */
export function blaettern(stelle: number, schritt: number, anzahl: number): number | null {
    if (anzahl < 2) return null;
    return (((stelle + schritt) % anzahl) + anzahl) % anzahl;
}

/** Die Taste zur neuen Stelle: ← → blättern, Pos1 und Ende springen an die Ränder. `null` für jede andere Taste. */
export function stelleNachTaste(taste: string, stelle: number, anzahl: number): number | null {
    if (taste === "ArrowRight") return blaettern(stelle, 1, anzahl);
    if (taste === "ArrowLeft") return blaettern(stelle, -1, anzahl);
    if (anzahl < 2) return null;
    if (taste === "Home") return 0;
    if (taste === "End") return anzahl - 1;
    return null;
}

/** Eine Wischgeste: weit genug und mehr waagerecht als senkrecht. +1 nach links gewischt (weiter), −1 nach rechts (zurück). */
export const WISCHEN_AB = 48;
export function wischRichtung(dx: number, dy: number): 1 | -1 | 0 {
    if (Math.abs(dx) < WISCHEN_AB || Math.abs(dx) <= Math.abs(dy)) return 0;
    return dx < 0 ? 1 : -1;
}

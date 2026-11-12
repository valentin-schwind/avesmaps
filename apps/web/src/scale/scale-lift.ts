/**
 * Wie weit die Maßstabsleiste über ihre Ruhelage steigt (WI-0096), ohne Browser gerechnet.
 *
 * - **Gemessen wird das Ding darüber,** nicht ausgerechnet (Legacy `syncMapScaleBandLift`): Oberkante plus 6 px Luft.
 * - 🔴 **Waagerecht zählt der GANZE Platz der Leiste,** nicht ihre heutige Breite. Die Leiste wächst und schrumpft mit
 *   jedem Zoomschritt; an ihrer heutigen Breite gemessen schnitt sie die Knöpfe am unteren Rand einmal und einmal nicht und
 *   sprang beim Zoomen am Telefon auf und ab (Vali 2026-11-10: „verrutscht ständig“). Ihr Deckel (`span`) ändert sich
 *   nur mit der Kartenbreite.
 * - 🔴 **Die Leiste der Reisebilder geht nach ihrer gemeldeten Höhe** (`leisteUnten`), nicht nach dem DOM: Zugeklappt ist
 *   sie nur weggeschoben (`translateY(100%)`), und ihre Lage ohne Verschiebung stand voll im Bild. Die Maßstabsleiste blieb
 *   danach 98 px hoch stehen, mitten in der Karte. Offen steht sie über die ganze Breite und schneidet immer.
 */

/** Ein Ding am unteren Rand, gemessen ohne `transform` (`top`) und waagerecht so, wie es gezeichnet ist. */
export interface Hindernis {
    readonly left: number;
    readonly right: number;
    readonly top: number;
}

export interface HubLage {
    /** Die waagerechte Mitte der Leiste im Fenster. */
    readonly mitte: number;
    /** Die größte Breite, die die Leiste hier annehmen kann (ihr Deckel), dazu die Beschriftung. */
    readonly breite: number;
    /** Die Höhe des Fensters. */
    readonly fensterHoehe: number;
    /** Die gemeldete Höhe der offenen Reisebilder-Leiste; 0, wenn sie zu ist. */
    readonly leisteUnten: number;
    readonly hindernisse: readonly Hindernis[];
    /** Luft über dem Hindernis (Legacy: 6 px). */
    readonly luft: number;
}

export function massstabHub(lage: HubLage): number {
    const links = lage.mitte - lage.breite / 2;
    const rechts = lage.mitte + lage.breite / 2;
    let noetig = lage.leisteUnten > 0 ? lage.leisteUnten + lage.luft : 0;
    for (const ding of lage.hindernisse) {
        if (rechts <= ding.left || ding.right <= links) continue;
        noetig = Math.max(noetig, lage.fensterHoehe - ding.top + lage.luft);
    }
    return Math.max(0, Math.round(noetig));
}

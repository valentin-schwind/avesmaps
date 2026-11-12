/**
 * Die reinen Teile von Knopf und Leiste der Reisebilder (WI-0272 S4, Aufgabe 28), ohne Vue und ohne DOM, damit Vitest sie ohne Browser prüft.
 *
 * - **Der Knopf** nennt die Zahl der Bilder im Ausschnitt: bei 0 keine Zahl, bei einer gekappten Antwort „500+“ (der Server kennt nur eine stabile Auswahl, nicht alle).
 * - **Die Leiste** ist sichtbar, wenn sie offen ist, die Karte in der Standardansicht steht und nichts sie verdeckt (am Telefon ein offenes Panel). Ihre Höhe zählt für Eckbund, Maßstab, Toast und die
 *   Panels nur, wenn sie sichtbar ist; sonst 0.
 */

/** Die größte Zahl, die der Server ausliefert (`REISEBILD_AUSSCHNITT_MAX`); bei einer gekappten Antwort steht der Knopf auf „500+“. */
export const KNOPF_ZAHL_MAX = 500;

/** Der Text der Zahl im Knopf; leer, wenn keine Zahl stehen soll. */
export function knopfZahl(anzahl: number, gekappt: boolean): string {
    if (gekappt) return `${String(KNOPF_ZAHL_MAX)}+`;
    return anzahl > 0 ? String(anzahl) : "";
}

export interface LeisteLage {
    readonly offen: boolean;
    readonly standard: boolean;
    readonly verdeckt: boolean;
}

/** Steht die Leiste auf der Karte? */
export function leisteSichtbar(lage: LeisteLage): boolean {
    return lage.offen && lage.standard && !lage.verdeckt;
}

/** Wie viel Höhe die Leiste unten belegt (Bildpunkte), wenn sie `gemessen` hoch ist: sichtbar die Höhe, sonst 0. */
export function leisteHoehe(lage: LeisteLage, gemessen: number): number {
    return leisteSichtbar(lage) ? Math.max(0, Math.round(gemessen)) : 0;
}

/**
 * Welche Kachel in die Mitte der Leiste soll, wenn eine Markierung neu ist: die erste markierte in der Reihenfolge der Leiste; `undefined`, wenn keine markiert ist.
 */
export function ersteMarkierte(reihenfolge: readonly string[], markiert: ReadonlySet<string>): string | undefined {
    return reihenfolge.find((id) => markiert.has(id));
}

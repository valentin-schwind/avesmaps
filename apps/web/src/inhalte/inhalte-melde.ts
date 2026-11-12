import { shallowRef } from "vue";

/**
 * Was mit Inhalten geschah, ohne dass ein Fenster „Inhalte bearbeiten“ es selbst schrieb (WI-0265 B6g1): Der Reiter „Änderungen“ nimmt Quellen, Werke und Korpora über den Server zurück, ein
 * offenes Inhalte-Fenster hält aber die Revision vom letzten Lesen und schriebe beim nächsten „Speichern“ gegen einen Stand, den es nicht mehr gibt (409). Die Meldung ist das Gegenstück zu
 * `spracheditor/sprache-melde.ts`, `landschaftseditor/landschaft-melde.ts` und `wegeditor/weg-melde.ts`: Der Reiter meldet, was die Rücknahme berührte (`affected` ihrer Quittung), und der gemeinsame
 * Kern der Reiter (`inhalte-katalog-steuerung.ts`) liest die Liste neu und, wenn der Reiter ein berührtes Dokument zeigt, auch dieses. Ein Entwurf mit Änderungen behält sie: Das Dokument wird dann nicht
 * ersetzt, und das nächste „Speichern“ ist ein gewöhnlicher Konflikt (`edit_conflict`) mit der Frage, wie es weitergeht. Eine eigene Oberfläche (einen Verlauf) bekommt das Fenster dafür nicht.
 */

/** Die Arten der Inhalte, die ein Fenster „Inhalte bearbeiten“ zeigt (Quelle, Werk, Vorkommen, Korpus). */
export const INHALTE_ARTEN: readonly string[] = ["source", "work", "lore", "corpus"];

export interface InhalteMeldung {
    /** Die berührten Inhalte: Art (wie die Quittung sie nennt) und öffentliche Kennung. */
    readonly betroffen: readonly { readonly kind: string; readonly id: string }[];
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

let zaehler = 0;
export const inhalteMeldung = shallowRef<InhalteMeldung | undefined>(undefined);

/**
 * Meldet, was eine Rücknahme berührte: nur Inhalte; alles andere (Orte, Wege, Flächen, Sprachen …) melden ihre eigenen Wege. Nennt die Quittung nichts davon, entsteht keine Meldung.
 */
export function meldeInhalte(betroffen: readonly { readonly kind: string; readonly id: string }[]): void {
    const meine = betroffen.filter((eines) => INHALTE_ARTEN.includes(eines.kind));
    if (meine.length === 0) return;
    zaehler += 1;
    inhalteMeldung.value = { betroffen: meine.map(({ kind, id }) => ({ kind, id })), nr: zaehler };
}

import { shallowRef } from "vue";

/**
 * Was mit Sprachen geschah, ohne dass ein Sprachfenster es selbst schrieb (WI-0265 B6e): Der Reiter „Änderungen“ nimmt Sprachen über den Server zurück, ein offenes Sprachfenster hält aber
 * die Revisionen vom letzten Lesen und schriebe beim nächsten „Fertig“ gegen einen Stand, den es nicht mehr gibt (409). Die Meldung ist das Gegenstück zu
 * `landschaftseditor/landschaft-melde.ts` (Derographie) und `wegeditor/weg-melde.ts` (Wege): Der Reiter meldet, was die Rücknahme berührte, und die Steuerung der Sprachfenster
 * (`spracheditor-steuerung.ts`) zieht die Kacheln nach, liest die Liste neu und lässt jedes betroffene Fenster seine Sprache samt Verlauf neu lesen. Ungeschriebenes bleibt, wie es ist
 * (`nachlesen`: mit laufender Bearbeitung nur als Nebenstand).
 */
export interface SprachMeldung {
    /** Die Sprachen, die die Rücknahme berührte (auch die, deren Teilfläche sich änderte: Die Quittung nennt die Sprache jeder Teilfläche mit). */
    readonly sprachen: readonly string[];
    /** Die Teilflächen, die die Rücknahme schrieb. */
    readonly flaechen: readonly string[];
    /** Die Revision der Karte nach der Rücknahme, wenn die Quittung sie nannte. */
    readonly mapRevision: number | undefined;
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

let zaehler = 0;
export const sprachMeldung = shallowRef<SprachMeldung | undefined>(undefined);

/**
 * Meldet, was eine Rücknahme berührte (`affected` ihrer Quittung): Sprachen und ihre Teilflächen; alles andere (Orte, Wege, Flächen der Derographie …) melden ihre eigenen Wege. Nennt die
 * Quittung nichts davon, entsteht keine Meldung.
 */
export function meldeSprachen(
    betroffen: readonly { readonly kind: string; readonly id: string }[],
    mapRevision: number | undefined,
): void {
    const sprachen = betroffen.filter((x) => x.kind === "sprache").map((x) => x.id);
    const flaechen = betroffen.filter((x) => x.kind === "sprache_flaeche").map((x) => x.id);
    if (sprachen.length === 0 && flaechen.length === 0) return;
    zaehler += 1;
    sprachMeldung.value = { sprachen, flaechen, mapRevision, nr: zaehler };
}

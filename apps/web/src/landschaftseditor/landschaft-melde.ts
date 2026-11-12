import { shallowRef } from "vue";

/**
 * Was mit Flächen der Derographie und mit Gipfeln geschah, ohne dass ein Landschaftsfenster es selbst schrieb (WI-0265 B6c2): Der Reiter „Änderungen“ nimmt sie über den Server zurück, ein
 * offenes Landschafts- oder Gipfelfenster hält aber seine Revisionen vom letzten Lesen und schriebe beim nächsten „Fertig“ gegen einen Stand, den es nicht mehr gibt (409). Die Meldung ist
 * das Gegenstück zu `wegeditor/weg-melde.ts` (Wege) und `ortseditor/ort-entfernen.ts` (`melde`, Orte): Der Reiter meldet, was die Rücknahme berührte, und die Steuerung der Landschaftsfenster
 * (`landschaftseditor-steuerung.ts`) zieht die Kacheln nach, liest die Liste neu und lässt jedes betroffene Fenster seine Fläche oder seinen Gipfel samt Verlauf neu lesen. Ungeschriebenes
 * bleibt, wie es ist (`Bearbeitung.neuLesen`: nur ohne laufende Bearbeitung).
 */
export interface LandschaftMeldung {
    /** Die Landschaften, die die Rücknahme berührte, und was in ihnen liegt: ihre Teilflächen, Beschriftungen und Gebirgswerte (die Quittung nennt sie je nach Art der Änderung). */
    readonly flaechen: readonly string[];
    /** Die Gipfel, die die Rücknahme berührte. */
    readonly gipfel: readonly string[];
    /** Die Revision der Karte nach der Rücknahme, wenn die Quittung sie nannte. */
    readonly mapRevision: number | undefined;
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

/** Die Arten in `affected` einer Quittung, die zu einer Landschaft gehören: sie selbst, Teilfläche, Beschriftung und die Gebirgswerte einer Teilfläche (`terrain_control`, ihre Adresse ist die Teilfläche). */
const FLAECHEN_ARTEN: readonly string[] = ["landscape", "area", "label", "terrain_control"];
const GIPFEL_ART = "peak";

let zaehler = 0;
export const landschaftMeldung = shallowRef<LandschaftMeldung | undefined>(undefined);

/**
 * Meldet, was eine Rücknahme berührte (`affected` ihrer Quittung): Flächen und Gipfel; alles andere (Orte, Wege, Gebiete, Kraftlinien) melden ihre eigenen Wege. Nennt die Quittung
 * nichts davon, entsteht keine Meldung.
 */
export function meldeLandschaften(
    betroffen: readonly { readonly kind: string; readonly id: string }[],
    mapRevision: number | undefined,
): void {
    const flaechen = betroffen.filter((x) => FLAECHEN_ARTEN.includes(x.kind)).map((x) => x.id);
    const gipfel = betroffen.filter((x) => x.kind === GIPFEL_ART).map((x) => x.id);
    if (flaechen.length === 0 && gipfel.length === 0) return;
    zaehler += 1;
    landschaftMeldung.value = { flaechen, gipfel, mapRevision, nr: zaehler };
}

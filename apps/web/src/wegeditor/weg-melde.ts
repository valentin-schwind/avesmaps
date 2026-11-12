import { shallowRef } from "vue";

/**
 * Was mit Wegen geschah, ohne dass ein Wege-Fenster es selbst schrieb (WI-0265 B6a2): Der Reiter „Änderungen“ nimmt Wege über den Server zurück, ein offenes Wege-Fenster hält
 * aber seine Revisionen vom letzten Lesen. Die Meldung ist das Gegenstück zu `ortseditor/ort-entfernen.ts` (`melde`): Der Reiter meldet die berührten Abschnitte und die Revision der
 * Karte, die Steuerung der Wege-Fenster (`wegeditor-steuerung.ts`) zieht die Kacheln nach und liest Liste und Straßen ohne laufende Bearbeitung neu. Ungeschriebenes bleibt, wie es ist.
 */
export interface WegMeldung {
    /** Die Abschnitte, die die Rücknahme berührte. */
    readonly ids: readonly string[];
    /** Die Revision der Karte nach der Rücknahme, wenn die Quittung sie nannte. */
    readonly mapRevision: number | undefined;
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

let zaehler = 0;
export const wegMeldung = shallowRef<WegMeldung | undefined>(undefined);

export function meldeWege(ids: readonly string[], mapRevision: number | undefined): void {
    zaehler += 1;
    wegMeldung.value = { ids, mapRevision, nr: zaehler };
}

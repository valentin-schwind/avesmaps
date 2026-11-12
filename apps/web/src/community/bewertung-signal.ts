import { shallowRef } from "vue";

/**
 * Eine Bewertung wurde geschrieben (WI-0269 C10): Das Formular der Besucher meldet den Ort, das Panel dieses Orts (`info-panel/bewertungen-quelle.ts`) lädt seine Bewertungen daraufhin frisch,
 * am Zwischenspeicher vorbei. Eine Zählung (`nr`), damit auch ein zweiter Eingang am selben Ort auffällt.
 */
export const bewertungGeschrieben = shallowRef<{ ort: string; nr: number } | undefined>(undefined);

let zaehler = 0;

export function meldeBewertungGeschrieben(ort: string): void {
    zaehler += 1;
    bewertungGeschrieben.value = { ort, nr: zaehler };
}

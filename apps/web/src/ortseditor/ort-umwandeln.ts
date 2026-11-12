import { shallowRef } from "vue";

/**
 * „In Landmarke umwandeln …“ am Ort (WI-0271 L8): Das Menü bittet (`bitteUmwandeln`), die Rückfrage im Editorpanel fragt und schreibt (`ort-umwandeln-fenster.vue`), und `umwandelnMeldung` sagt der Steuerung, welche
 * Landmarke sie öffnen soll: Dort legt der Editor die Art fest.
 */

let zaehler = 0;

export const umwandelnBitte = shallowRef<{ readonly publicId: string; readonly nr: number } | undefined>(undefined);
export function bitteUmwandeln(publicId: string): void {
    zaehler += 1;
    umwandelnBitte.value = { publicId, nr: zaehler };
}

export interface UmwandelnMeldung {
    readonly peakId: string;
    readonly name: string;
    readonly nr: number;
}
export const umwandelnMeldung = shallowRef<UmwandelnMeldung | undefined>(undefined);
export function meldeUmgewandelt(peakId: string, name: string): void {
    zaehler += 1;
    umwandelnMeldung.value = { peakId, name, nr: zaehler };
}

import { shallowRef } from "vue";

/**
 * Was mit Herrschaftsgebieten geschah, ohne dass ein Gebietsfenster es selbst schrieb (WI-0265 B6h): Der Server nimmt Gebiete zurück (Reiter „Änderungen“ oder Verlauf eines Gebiets,
 * `aenderungen/aenderung-ruecknahme.vue`), ein offenes Gebietsfenster hält aber die Revisionen vom letzten Lesen und schriebe beim nächsten „Fertig“ gegen einen Stand, den es nicht mehr gibt
 * (409). Die Meldung ist das Gegenstück zu `landschaftseditor/landschaft-melde.ts` (Landschaften), `wegeditor/weg-melde.ts` (Wege) und `ortseditor/ort-entfernen.ts` (`melde`, Orte): Die
 * Rücknahme meldet, was sie berührte, und die Steuerung der Gebietsfenster (`gebietseditor-steuerung.ts`) zieht die Kacheln nach, liest Liste und Hierarchie neu und lässt jedes betroffene
 * Fenster sein Gebiet samt Verlauf neu lesen. Ungeschriebenes bleibt, wie es ist (`Bearbeitung.neuLesen`: nur ohne laufende Bearbeitung).
 */
export interface GebietMeldung {
    /** Die Gebiete, die die Rücknahme berührte. */
    readonly gebiete: readonly string[];
    /** Ihre Flächen (Zoomspanne, Entfernen, Vereinigen berühren auch sie); ein Gebietsfenster trägt sie in `areas`. */
    readonly flaechen: readonly string[];
    /** Die Revision der Karte nach der Rücknahme, wenn die Quittung sie nannte. */
    readonly mapRevision: number | undefined;
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

/** Die Arten in `affected` einer Quittung: das Gebiet (`GEBIET_ART`) und seine Fläche (`GEBIETSFLAECHE_ART`, `apps/server/src/editor/map-operation.ts`). */
const GEBIET_ART = "territory";
const FLAECHE_ART = "territory_area";

let zaehler = 0;
export const gebietMeldung = shallowRef<GebietMeldung | undefined>(undefined);

/**
 * Meldet, was eine Rücknahme berührte (`affected` ihrer Quittung): Gebiete und ihre Flächen; alles andere (Orte, Wege, Landschaften, Kraftlinien) melden ihre eigenen Wege. Nennt die Quittung
 * nichts davon, entsteht keine Meldung.
 */
export function meldeGebiete(
    betroffen: readonly { readonly kind: string; readonly id: string }[],
    mapRevision: number | undefined,
): void {
    const gebiete = betroffen.filter((x) => x.kind === GEBIET_ART).map((x) => x.id);
    const flaechen = betroffen.filter((x) => x.kind === FLAECHE_ART).map((x) => x.id);
    if (gebiete.length === 0 && flaechen.length === 0) return;
    zaehler += 1;
    gebietMeldung.value = { gebiete, flaechen, mapRevision, nr: zaehler };
}

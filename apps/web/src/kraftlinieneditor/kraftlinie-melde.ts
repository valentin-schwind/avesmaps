import { shallowRef } from "vue";

/**
 * Was mit Kraftlinien geschah, ohne dass ein Kraftlinienfenster es selbst schrieb (WI-0265 B6h): Der Server nimmt Kraftlinien zurück (Reiter „Änderungen“ oder Verlauf der Linie,
 * `aenderungen/aenderung-ruecknahme.vue`), ein offenes Kraftlinienfenster hält aber die Revisionen seiner Abschnitte vom letzten Lesen und schriebe beim nächsten „Fertig“ gegen einen Stand,
 * den es nicht mehr gibt (409). Die Meldung ist das Gegenstück zu `gebietseditor/gebiet-melde.ts` (Gebiete), `landschaftseditor/landschaft-melde.ts` (Landschaften) und
 * `wegeditor/weg-melde.ts` (Wege): Die Rücknahme meldet, was sie berührte, und die Steuerung der Kraftlinienfenster (`kraftlinieneditor-steuerung.ts`) zieht die Kacheln nach, liest die Liste
 * neu und lässt jedes betroffene Fenster seine Linie samt Verlauf neu lesen. Ungeschriebenes bleibt, wie es ist (`Bearbeitung.neuLesen`: nur ohne laufende Bearbeitung).
 */
export interface KraftlinieMeldung {
    /** Die Abschnitte, die die Rücknahme berührte: Die Quittung nennt die Abschnitte, die die Linie danach hat (auch angefügte und zurückgekommene), keine Linie als Ganzes. */
    readonly abschnitte: readonly string[];
    /** Die Kraftlinienpunkte, die die Rücknahme berührte (WI-0265 B8b: Anlegen, Verschieben, Entfernen); ein Fenster, dessen Linie dort endet, liest neu. */
    readonly knoten: readonly string[];
    /** Die Revision der Karte nach der Rücknahme, wenn die Quittung sie nannte. */
    readonly mapRevision: number | undefined;
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

/** Die Arten in `affected` einer Quittung: der Abschnitt einer Kraftlinie und ein Kraftlinienpunkt. */
const ABSCHNITT_ART = "powerline";
const KNOTEN_ART = "nodix";

let zaehler = 0;
export const kraftlinieMeldung = shallowRef<KraftlinieMeldung | undefined>(undefined);

/** Meldet, was eine Rücknahme berührte (`affected` ihrer Quittung): Abschnitte von Kraftlinien und Kraftlinienpunkte; nennt die Quittung keinen, entsteht keine Meldung. */
export function meldeKraftlinien(
    betroffen: readonly { readonly kind: string; readonly id: string }[],
    mapRevision: number | undefined,
): void {
    const abschnitte = betroffen.filter((x) => x.kind === ABSCHNITT_ART).map((x) => x.id);
    const knoten = betroffen.filter((x) => x.kind === KNOTEN_ART).map((x) => x.id);
    if (abschnitte.length === 0 && knoten.length === 0) return;
    zaehler += 1;
    kraftlinieMeldung.value = { abschnitte, knoten, mapRevision, nr: zaehler };
}

import { shallowRef, watch, type ShallowRef } from "vue";
import type { KartenBild } from "./aenderung-karte-modell";

/**
 * Was „⊕ Auf der Karte zeigen“ aus dem Detail an die Karte weitergibt (WI-0265 B5b; Probierseite `review/wi-0265/aenderungen.html`, Szene 2 und 4).
 * Das Detail (Reiter „Änderungen“, Objektverlauf, Serie) und die Überlagerung auf der Karte (`map/aenderungen-overlay.ts`) sind eigene Bauteile, die sich
 * nicht kennen; sie verabreden sich über diese kleine Ablage, wie der Sprung zwischen Reiter und Verlauf (`sprung.ts`).
 *
 * - **Ein Wunsch, ein Besitzer.** Wer zeigt, legt seinen Wunsch ab (das Bild, das die Karte zeichnen soll) und heißt `besitzer` (die `operationId` oder die
 *   Serie). Ein zweites Zeigen löst das erste ab. Schließt ein Detail, nimmt es nur seinen eigenen Wunsch zurück (`schliesseKarteFuer`): Das Schließen eines
 *   anderen Details lässt die Überlagerung stehen.
 * - **Die Anzeige** (Beide, Vorher, Nachher) gehört der Überlagerung und gilt für das, was gerade steht; ein neuer Wunsch beginnt wieder bei „Beide“.
 * - Die Karte liest den Wunsch (`kartenWunsch`) und räumt nichts auf, was sie nicht selbst anlegte; ob sie schon da ist, merkt die Ablage nicht (ein
 *   Wunsch ohne Karte, etwa im Besucher-Modus, verfällt mit dem Detail).
 */

export const KARTEN_ANZEIGEN = ["beide", "vorher", "nachher"] as const;
export type KartenAnzeige = (typeof KARTEN_ANZEIGEN)[number];

/** Wohin der Rückweg am Telefon führt (`‹ Zum Detail` / `‹ Zur Liste`): dorthin, von wo die Karte gerufen wurde. */
export type KartenRueckweg = "detail" | "liste";

export interface KartenWunsch {
    /** Wer zeigt: die `operationId` einer Änderung oder `serie:<Kennung>`. */
    readonly besitzer: string;
    readonly bild: KartenBild;
    /** Von wo die Karte gerufen wurde (B9: auch aus der Zeile der Liste, ohne offenes Detail). */
    readonly rueckweg: KartenRueckweg;
}

const wunsch: ShallowRef<KartenWunsch | undefined> = shallowRef(undefined);
const anzeige: ShallowRef<KartenAnzeige> = shallowRef("beide");

export const kartenWunsch: Readonly<ShallowRef<KartenWunsch | undefined>> = wunsch;
export const kartenAnzeige: Readonly<ShallowRef<KartenAnzeige>> = anzeige;

/** Das Bild auf die Karte legen; ein früheres Bild geht dabei weg. */
export function zeigeAufKarte(besitzer: string, bild: KartenBild, rueckweg: KartenRueckweg = "detail"): void {
    anzeige.value = "beide";
    wunsch.value = { besitzer, bild, rueckweg };
}

/** Die Überlagerung entfernen (Esc, ✕ an der Leiste, Schließen des Details). */
export function schliesseKarte(): void {
    wunsch.value = undefined;
}

/** Nur schließen, wenn diese Überlagerung die eigene ist. */
export function schliesseKarteFuer(besitzer: string): void {
    if (wunsch.value?.besitzer === besitzer) wunsch.value = undefined;
}

export function setzeKartenAnzeige(neu: KartenAnzeige): void {
    anzeige.value = neu;
}

/** Zeigt diese Überlagerung gerade das Bild von `besitzer`? */
export const zeigtKarte = (besitzer: string): boolean => wunsch.value?.besitzer === besitzer;

/** Wartet, bis die Bedingung gilt (etwa: bis das Detail seine Werte geladen hat); gilt sie schon, gleich. */
export function warteBis(bedingung: () => boolean): Promise<void> {
    return new Promise((fertig) => {
        if (bedingung()) {
            fertig();
            return;
        }
        const stop = watch(bedingung, (gilt) => {
            if (!gilt) return;
            stop();
            fertig();
        });
    });
}

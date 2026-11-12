/**
 * Die Tafel „Feld · − vorher · + nachher“ je Gegenstand im Detail einer Änderung (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`), ohne Vue: was sie zeigt, wenn eine Änderung viele Gegenstände hat.
 * Ein Wiki-Lauf nennt tausende; das Detail zeigt die ersten fünf und dann „n weitere ▸“, je Druck zehn mehr.
 */

export interface TafelZeile {
    readonly feld: string;
    /** Der Name des Felds, wie Menschen ihn lesen. */
    readonly bezeichnung: string;
    /** Der Schlüssel des Protokolls (Tooltip); fehlt, wo der Name aus dem Verlauf der Art stammt. */
    readonly schluessel: string | undefined;
    readonly vorher: string | undefined;
    readonly nachher: string | undefined;
    readonly formFehlt: boolean;
    readonly laedt: boolean;
    readonly hinweis: string | undefined;
}

export interface TafelGegenstand {
    readonly schluessel: string;
    /** Die Art („Ort“, „Weg“) als Etikett; fehlt, wo der Verlauf eines Objekts nur seine Felder zeigt. */
    readonly art: string | undefined;
    readonly name: string | undefined;
    /** „Revision 8 → 9“. */
    readonly revision: string | undefined;
    readonly zeilen: readonly TafelZeile[];
}

/** So viele Gegenstände zeigt die Tafel zuerst. */
export const TAFEL_ERSTE = 5;
/** So viele kommen mit jedem Druck auf „n weitere“ dazu. */
export const TAFEL_SCHRITT = 10;

/** Die Gegenstände, die bei `gezeigt` Schritten (0 am Anfang) zu sehen sind, und wie viele noch fehlen. */
export function sichtbareGegenstaende<T>(
    gegenstaende: readonly T[],
    schritte: number,
): { readonly sichtbar: readonly T[]; readonly weitere: number } {
    const anzahl = Math.min(gegenstaende.length, TAFEL_ERSTE + schritte * TAFEL_SCHRITT);
    return { sichtbar: gegenstaende.slice(0, anzahl), weitere: gegenstaende.length - anzahl };
}

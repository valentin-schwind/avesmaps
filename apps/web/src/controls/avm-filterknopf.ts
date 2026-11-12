/**
 * Die Regeln des Filterknopfs (`avm-filterknopf.vue`), ohne Vue und ohne Browser: was ein Abschnitt ist, was die Zahl im Knopf zählt
 * und wie ein Klick die Wahl eines Abschnitts ändert.
 */

/** Ein Wert eines Abschnitts; `zahl` ist die Zahl der Treffer, die er hätte (Ortsliste), wo die Liste sie kennt. */
export interface FilterWert {
    wert: string;
    text: string;
    zahl?: number;
}

/** Ein Bereich von–bis (`art: "bereich"`): die Grenzen der Daten als Platzhalter, `von` und `bis` die gesetzten Kanten. */
export interface FilterBereich {
    min: number;
    max: number;
    von: number | null;
    bis: number | null;
}

/**
 * Ein Abschnitt des Blatts. `eins`: genau ein Wert oder „alle“ (Medienverwaltung, ein Wert je Filter im Vertrag); `mehrere`: Kästchen,
 * beliebig viele (Ortsliste, Legacy `filter-menu.js`); `bereich`: zwei Zahlenfelder von–bis, etwa ein Zeitraum (Kataloge, Legacy
 * `advFiltersMarkup`), mit `bereich` statt `werte`.
 */
export interface FilterAbschnitt {
    id: string;
    titel: string;
    art: "eins" | "mehrere" | "bereich";
    werte: readonly FilterWert[];
    bereich?: FilterBereich | undefined;
}

/** Die gesetzten Werte je Abschnitt; ein fehlender oder leerer Eintrag heißt „alle“. */
export type FilterWahl = Readonly<Record<string, readonly string[] | undefined>>;

/** Die Zahl im Knopf: alle gesetzten Werte über alle Abschnitte. Bei Abschnitten mit einer Wahl ist das die Zahl der Filter. */
export function filterZahl(wahl: FilterWahl): number {
    return Object.values(wahl).reduce((summe, werte) => summe + (werte?.length ?? 0), 0);
}

/** Ein Abschnitt ohne Werte erscheint nicht (Legacy, Ortsliste: etwa „Kontinent“, solange die Daten keinen kennen); ein Bereich, wenn er Grenzen hat. */
export function sichtbareAbschnitte(abschnitte: readonly FilterAbschnitt[]): FilterAbschnitt[] {
    return abschnitte.filter((abschnitt) =>
        abschnitt.art === "bereich" ? abschnitt.bereich !== undefined : abschnitt.werte.length > 0,
    );
}

/**
 * Ab wie vielen Werten ein Abschnitt lang ist (WI-0206, EDIT-0003 T36): Er darf dann im Blatt über das Ende einer Spalte in die
 * nächste weiterlaufen; ein kurzer bleibt ganz in seiner Spalte. Gemessen an der Ortsliste: „Art“ hat 302 Werte, die übrigen 2 bis 7.
 */
export const LANGER_ABSCHNITT = 12;

/** Darf dieser Abschnitt über eine Spalte hinauslaufen? Ein Bereich nie: seine zwei Felder stehen auf einer Zeile. */
export function istLang(abschnitt: FilterAbschnitt): boolean {
    return abschnitt.art !== "bereich" && abschnitt.werte.length > LANGER_ABSCHNITT;
}

/** Die Zahl im Knopf samt Bereichen: ein Bereich zählt als EIN Filter, sobald eine seiner Kanten steht. */
export function gesetzteFilter(abschnitte: readonly FilterAbschnitt[], wahl: FilterWahl): number {
    const bereiche = abschnitte.filter(
        (abschnitt) =>
            abschnitt.art === "bereich" && (abschnitt.bereich?.von != null || abschnitt.bereich?.bis != null),
    ).length;
    return filterZahl(wahl) + bereiche;
}

/** Eine Eingabe in ein Feld des Bereichs: eine ganze Zahl, oder leer (`null`) für keine Kante. */
export function zahlEingabe(roh: string): number | null {
    const zahl = Number.parseInt(roh.trim(), 10);
    return Number.isFinite(zahl) ? zahl : null;
}

/**
 * Die neue Wahl eines Abschnitts nach einem Klick. `wert` undefined ist „alle“ und leert ihn. Bei `eins` ersetzt ein Wert den vorigen;
 * bei `mehrere` setzt oder löst er sein Kästchen, und die Wahl bleibt in der Reihenfolge des Abschnitts.
 */
export function neueWahl(
    abschnitt: FilterAbschnitt,
    bisher: readonly string[],
    wert: string | undefined,
    an: boolean,
): string[] {
    if (wert === undefined) return [];
    if (abschnitt.art === "eins") return an ? [wert] : [];
    const gesetzt = new Set(bisher);
    if (an) gesetzt.add(wert);
    else gesetzt.delete(wert);
    return abschnitt.werte.map((eintrag) => eintrag.wert).filter((eintrag) => gesetzt.has(eintrag));
}

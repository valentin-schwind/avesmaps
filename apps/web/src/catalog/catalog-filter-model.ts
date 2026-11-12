/**
 * Die Filterleiste der Katalogfenster als reines Modell (WI-0118; Legacy `avesmapsFilterBarMarkup`, `js/ui/filter-bar.js`, Mirror
 * `cbe278210`): EINE Grammatik für „Kartensammlung“ und „Literatur“ - ein Etikett, Chips, Auswahlfelder, ein Zeitraum, Schalter -,
 * deren Dimensionen die beiden Fenster selbst nennen. Hier steht nur, was beide teilen; das Zeichnen übernimmt
 * `catalog-filter-bar.vue`, das Entscheiden jedes Fenster für sich.
 *
 * 🔴 **Ein Filter erscheint nur, wenn er DIESE Liste wirklich teilt** (Legacy Spec §4.1: „sonst stehen 13 Steuerelemente über einer
 * Zeile“, 168 von 245 Orten haben genau eine Karte). „Teilen“ heißt: Es gibt mindestens eine Zeile, die den Wert trägt, und
 * mindestens eine, die ihn nicht trägt. Ein Wert, den ALLE Zeilen tragen, schränkt nichts ein und steht nicht zur Wahl.
 * Der Schalter „Spoiler“ ist kein Filter, er blendet nichts aus: Er nimmt die Deckel weg und steht, sobald ein einziger Eintrag
 * verdeckt ist (Legacy: bei 3 von 3 verdeckten Karten trennt er nichts und ist trotzdem am nötigsten).
 */

export interface FilterOption {
    value: string;
    label: string;
}

/** Eine Gruppe der Leiste, so wie sie gezeichnet wird. */
export type FilterGroup =
    | { kind: "chips"; id: string; options: (FilterOption & { active: boolean })[] }
    | { kind: "select"; id: string; placeholder: string; options: FilterOption[]; value: string }
    | {
          kind: "years";
          id: string;
          label: string;
          fromPlaceholder: string;
          toPlaceholder: string;
          /** Die bekannten Grenzen: Sie stehen als Platzhalter im Feld und sagen die Spanne, ohne vorzufiltern. */
          range: { min: number; max: number };
          from: number | null;
          to: number | null;
      }
    | { kind: "toggle"; id: string; label: string; active: boolean }
    | { kind: "sort"; id: string; label: string; options: (FilterOption & { active: boolean })[] }
    | { kind: "divider" };

/** Eine Eingabe des Lesers an der Leiste; das Fenster reicht sie an seine Reduktion weiter. */
export type FilterChange =
    | { kind: "toggle"; id: string }
    | { kind: "chip"; id: string; value: string }
    | { kind: "select"; id: string; value: string }
    | { kind: "year"; id: string; edge: "from" | "to"; value: number | null }
    | { kind: "sort"; id: string; value: string };

/** Die Werte, die die Menge teilen: mindestens eine Zeile trägt sie, mindestens eine nicht. */
export function splittingValues<Row>(rows: readonly Row[], valuesOf: (row: Row) => readonly string[]): string[] {
    const count = new Map<string, number>();
    for (const row of rows) {
        for (const value of new Set(valuesOf(row))) count.set(value, (count.get(value) ?? 0) + 1);
    }
    return [...count].filter(([, carriers]) => carriers < rows.length).map(([value]) => value);
}

/** Teilt eine Ja-Nein-Frage die Menge? Trifft sie auf einige zu, aber nicht auf alle? */
export function splits<Row>(rows: readonly Row[], test: (row: Row) => boolean): boolean {
    const hits = rows.filter(test).length;
    return hits > 0 && hits < rows.length;
}

export interface YearSpan {
    from: number | null;
    to: number | null;
}

/** Das offene Ende der Quelle (`valid_to_bf`); eine Grenze, keine Jahreszahl für den Leser (Legacy: „9999“). */
export const OPEN_END_BF = 9999;

/** Die Grenze eines Zeitraums als Jahr; 9999 und alles Unbrauchbare ist KEINE Grenze. */
export function knownYear(value: number | null | undefined): number | null {
    return value === null || value === undefined || !Number.isFinite(value) || value <= 0 || value === OPEN_END_BF
        ? null
        : value;
}

/**
 * Teilt der Zeitraum die Menge? (Legacy `avesmapsCitymapActiveFacets`) Zwei Einträge MIT Jahr und unterschiedliche Jahre. Ein Eintrag
 * mit einer Spanne liefert zwar zwei Zahlen, aber nichts zu filtern.
 */
export function yearFacet(spans: readonly YearSpan[]): { shown: boolean; min: number; max: number } {
    const years = new Set<number>();
    let dated = 0;
    for (const span of spans) {
        const own = [knownYear(span.from), knownYear(span.to)].filter((year): year is number => year !== null);
        for (const year of own) years.add(year);
        if (own.length > 0) dated += 1;
    }
    const list = [...years];
    return {
        shown: dated >= 2 && list.length >= 2,
        min: list.length === 0 ? 0 : Math.min(...list),
        max: list.length === 0 ? 0 : Math.max(...list),
    };
}

/**
 * Überschneidet sich der Zeitraum des Eintrags mit dem gewählten? (Legacy: „die Karten, die irgendwann in dieser Spanne galten“,
 * kein Enthaltensein.) Eine bekannte Grenze genügt, die fehlende Seite ist unbegrenzt - „gültig ab 1030, Ende nicht erfasst“ heißt
 * „ab 1030, soweit bekannt“, nicht „nur 1030“. Ein Eintrag ohne jede Angabe passt auf keinen Zeitraum (unbekannt matcht nichts).
 */
export function overlapsYears(span: YearSpan, from: number | null, to: number | null): boolean {
    if (from === null && to === null) return true;
    const lowest = span.from === null ? null : span.from;
    // 9999 ist das offene Ende: für die Überschneidung unbegrenzt, nicht die Jahreszahl.
    const highest = span.to === null || span.to === OPEN_END_BF ? null : span.to;
    if (lowest === null && highest === null && span.to !== OPEN_END_BF) return false;
    const low = lowest ?? Number.NEGATIVE_INFINITY;
    const high = highest ?? Number.POSITIVE_INFINITY;
    if (from !== null && high < from) return false;
    if (to !== null && low > to) return false;
    return true;
}

/** Ein Zahlenfeld der Leiste: leer oder unbrauchbar heißt „keine Grenze“. */
export function yearInput(raw: string): number | null {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

/** Die Freitextsuche der Kataloge ist die jeder Liste (`controls/avm-listenleiste.ts`). */
export { suchtreffer } from "../controls/avm-listenleiste";

import { LORE_GROUP_LID_MIN, type LoreGroupModel, type LoreLetterBlock } from "./lore-model";

/**
 * Die Suche in einer langen Klappliste (WI-0122, Betreiber 2026-10-09: „ja, B (A + Suchfeld) bauen“): Stätten und Vorkommen
 * teilen dieselbe Komponente (`info-lore-row.vue`), also teilen sie auch diese Suche. Reine Funktionen ohne Vue.
 *
 * 🔴 **Die Schwelle ist keine neue Zahl.** Das Feld steht genau dann, wenn die Zeile so lang ist, dass ihre Gruppen
 * zugeklappt starten würden: {@link LORE_GROUP_LID_MIN} Namen in der ZEILE (25). Gezählt wird die Zeile, nicht die Zahl der
 * Gruppen - auch eine einzige Gruppe mit 445 Pflanzen (Landschaft „Aventurien“) bekommt das Feld, obwohl sie nichts klappt.
 *
 * 🔴 **Verglichen wird ohne Groß/klein und ohne Akzente** („aquadukt“ findet „Aquädukt“, „strasse“ findet „Straße“). Die
 * Faltung läuft Zeichen für Zeichen und merkt sich, woher jedes gefaltete Zeichen kommt: Nur so lässt sich der Treffer im
 * ORIGINAL markieren, auch wenn „ß“ zu zwei Zeichen wird oder ein Name zerlegte Akzente trägt.
 *
 * Gesucht wird, was DASTEHT: die Namen, die Art einer Stätte samt ihrem Kennzeichen („Hauptsitz“) - und nie eine
 * Gliederungsüberschrift wie „Von hier“. Die sagt, woher etwas kommt, nicht, was es ist.
 */

/** Ein Stück Text und ob es zum Treffer gehört. */
export interface MarkedPart {
    text: string;
    hit: boolean;
}

/** Die gefaltete Fassung eines Textes: je gefaltetem Zeichen Anfang und Ende des Zeichens im Original. */
interface Folded {
    text: string;
    from: number[];
    to: number[];
}

const COMBINING = /[̀-ͯ]/g;

function foldChar(char: string): string {
    return char.normalize("NFD").replace(COMBINING, "").toLowerCase().replace(/ß/g, "ss");
}

function foldOf(source: string): Folded {
    let text = "";
    const from: number[] = [];
    const to: number[] = [];
    let at = 0;
    for (const char of source) {
        const folded = foldChar(char);
        for (let index = 0; index < folded.length; index++) {
            from.push(at);
            to.push(at + char.length);
        }
        text += folded;
        at += char.length;
    }
    return { text, from, to };
}

/** Das Suchwort, wie verglichen wird: gefaltet und ohne Rand. Leer heißt: keine Suche. */
export const searchNeedle = (query: string): string => foldOf(query.trim()).text;

/** Trifft das Suchwort diesen Text? Ein leeres Suchwort trifft nichts. */
export function textMatches(text: string, needle: string): boolean {
    return needle !== "" && foldOf(text).text.includes(needle);
}

/**
 * Der Text in Stücken, die Treffer markiert. Ohne Suchwort ein einziges Stück ohne Treffer - die Anzeige braucht dann
 * keinen zweiten Weg.
 */
export function markedParts(text: string, needle: string): MarkedPart[] {
    if (needle === "") return [{ text, hit: false }];
    const folded = foldOf(text);
    const parts: MarkedPart[] = [];
    let last = 0;
    for (let at = folded.text.indexOf(needle); at !== -1; at = folded.text.indexOf(needle, at + needle.length)) {
        const start = folded.from[at] ?? last;
        const end = folded.to[at + needle.length - 1] ?? start;
        if (start < last) continue;
        if (start > last) parts.push({ text: text.slice(last, start), hit: false });
        parts.push({ text: text.slice(start, end), hit: true });
        last = end;
    }
    if (last < text.length) parts.push({ text: text.slice(last), hit: false });
    return parts.length === 0 ? [{ text, hit: false }] : parts;
}

/** Steht die Zeile so lang da, dass sie ein Suchfeld bekommt? Dieselbe Schwelle, ab der ihre Gruppen klappen. */
export const lineSearchable = (groups: readonly LoreGroupModel[]): boolean =>
    groups.reduce((sum, group) => sum + group.count, 0) >= LORE_GROUP_LID_MIN;

/** Das Ergebnis einer Suche über die Gruppen einer Zeile. */
export interface LoreSearchResult {
    /** Nur die Gruppen mit Treffern, jede offen und mit ihrer ungefilterten Zahl in `total`. */
    groups: LoreGroupModel[];
    /** Wie viele Namen stehen. */
    hits: number;
    /** In wie vielen ARTEN sie stehen: eine je Art-Gruppe, eine je Zeile der Sammelgruppe; Vorkommen zählen keine. */
    types: number;
}

/** Ein Block, gefiltert: trifft sein Kopf (die Art einer Zeile), bleibt er ganz, sonst nur die Namen, die treffen. */
function filterBlock(block: LoreLetterBlock, needle: string, labelHits: boolean): LoreLetterBlock | undefined {
    const label = block.label;
    const labelMatches =
        labelHits &&
        label !== undefined &&
        (textMatches(label.text, needle) || (label.mark !== undefined && textMatches(label.mark, needle)));
    const entries = labelMatches ? block.entries : block.entries.filter((entry) => textMatches(entry.text, needle));
    return entries.length === 0 ? undefined : { ...block, entries };
}

/**
 * Filtert die Gruppen einer Zeile nach dem Suchwort.
 *
 * - **Art-Gruppe** (`art`): Trifft die Art oder ihr Kennzeichen, steht die ganze Gruppe; sonst nur die Namen, die treffen.
 * - **Sammelgruppe** (`collected`, Form `rows`): je Zeile dasselbe - trifft die Art, steht die Zeile, auch wenn der Name nicht
 *   trifft; trifft der Name, steht die Zeile samt ihrer Art.
 * - **Vorkommen**: nur die Namen; die Überschrift („Von hier“) ist Gliederung, kein Gegenstand.
 *
 * Jede Gruppe mit Treffern steht OFFEN da und trägt in `total` ihre ungefilterte Zahl („1 von 3“). Ohne Suchwort kommen die
 * Gruppen unverändert zurück.
 */
export function searchGroups(groups: readonly LoreGroupModel[], query: string): LoreSearchResult {
    const needle = searchNeedle(query);
    if (needle === "") {
        const hits = groups.reduce((sum, group) => sum + group.count, 0);
        return { groups: [...groups], hits, types: 0 };
    }
    const shown: LoreGroupModel[] = [];
    let hits = 0;
    let types = 0;
    for (const group of groups) {
        const headMatches =
            group.art === true &&
            (textMatches(group.heading, needle) || (group.mark !== undefined && textMatches(group.mark, needle)));
        const blocks = headMatches
            ? group.names.blocks
            : group.names.blocks.flatMap((block) => filterBlock(block, needle, group.collected === true) ?? []);
        if (blocks.length === 0) continue;
        const names = blocks.reduce((sum, block) => sum + block.entries.length, 0);
        const count = group.collected === true ? blocks.length : names;
        shown.push({ ...group, names: { ...group.names, blocks }, count, total: group.count, open: true });
        hits += names;
        if (group.collected === true) types += blocks.length;
        else if (group.art === true) types += 1;
    }
    return { groups: shown, hits, types };
}

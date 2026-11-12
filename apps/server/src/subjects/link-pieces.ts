import type { SubjectFactLink, SubjectListLink } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { lookupWikiKey, type WikiKeyLookup } from "./wiki-key-lookup.ts";

/**
 * Die Linkziele eines Wiki-Artikels an der Stelle, an der ein Feld sie zeigt (WI-0063 27.12, Legacy-Export X1, Migration 0073).
 *
 * 🔴 Zuordnung NUR über den Wiki-Key, nie über den Namen (Betreiber 2026-10-05, AGENTS.md „Karteninteraktion“): Ein Teilstück eines Feldwertes wird
 * ein Link, wenn der Quelltext für GENAU dieses Teilstück ein Linkziel nennt (`[[Reichsstraße 2|2]]`: „2“ → `wiki:reichsstrasse-2`) und dieser
 * kanonische Key im Lookup genau ein Objekt der Karte trägt. Der Anzeigetext sagt nur, WO im angezeigten Text der Link steht; er ist nie Schlüssel.
 *
 * Wie ein Link an seine Stelle kommt: Die Links eines Feldes stehen in der Reihenfolge des Quelltextes. Der angezeigte Feldtext ist aber der
 * bereinigte (Links und Vorlagen zu Klartext) und kann Teile nennen, die der Export nicht als Link führt (Vorlagen), oder - beim Verlauf - Ziele,
 * die zu anderen Wegen gehören. Darum läuft ein Zeiger von links nach rechts: Jedes Teilstück, dessen Anzeigetext von der Zeigerstelle an im
 * Text steht, rückt den Zeiger hinter sich (auch eines, das kein Objekt trifft, sonst fände ein späterer Link denselben Text „Gareth“ schon in
 * „Alt-Gareth“); ein Teilstück, dessen Anzeigetext nicht mehr im Text steht, fällt weg. Ein Treffer steht auf einer Wortgrenze: „Weiden“ ist nicht
 * in „Weidener“ und nicht in „Alt-Weiden“.
 */

/** Ein Link des Quelltextes: der Anzeigetext und der kanonische Key seines Ziels. */
export interface LinkPiece {
    text: string;
    key: string;
}

/** Die Linkziele der Artikel eines Subjects (je Infobox-Feld in der Reihenfolge des Quelltextes) und der Lookup, der ihre Keys auflöst. */
export interface LinkSource {
    lookup: WikiKeyLookup;
    /** Name des Infobox-Feldes (Legacys Positivliste) → die Links des Feldes. */
    pages: ReadonlyMap<string, readonly LinkPiece[]>;
}

/** Lädt die Links der Artikel (aktive Seiten) zu diesen Keys; mehrere Keys ergeben je Feld die Links nacheinander in der Reihenfolge der Keys. */
export async function loadLinkSource(
    database: Queryable,
    lookup: WikiKeyLookup,
    pageKeys: readonly string[],
): Promise<LinkSource> {
    const pages = new Map<string, LinkPiece[]>();
    if (pageKeys.length === 0) return { lookup, pages };
    const rows = await database<{ field: string; text: string; key: string }[]>`
        SELECT t.field, t.display_text AS text, t.target_key AS key
        FROM wiki_link_page p
        JOIN wiki_link_target t ON t.page_id = p.id
        WHERE p.is_active AND p.page_key = ANY(${[...pageKeys]}::text[])
        ORDER BY array_position(${[...pageKeys]}::text[], p.page_key), t.field, t.position
    `;
    for (const row of rows) {
        const list = pages.get(row.field);
        if (list === undefined) pages.set(row.field, [{ text: row.text, key: row.key }]);
        else list.push({ text: row.text, key: row.key });
    }
    return { lookup, pages };
}

const WORD = /[\p{L}\p{N}]/u;
/** Zeichen, die zwischen zwei Buchstaben zum Wort gehören („Alt-Gareth“, „Al'Anfa“). */
const JOINERS = new Set(["-", "'", "’"]);

/** Das Zeichen an `index`; außerhalb des Textes keins (`String.at` zählte negative Stellen von hinten). */
function charAt(text: string, index: number): string | undefined {
    return index < 0 ? undefined : text.at(index);
}

/** Ist das Zeichen an `index` ein Buchstabe oder eine Ziffer? Außerhalb des Textes nie. */
function isWordAt(text: string, index: number): boolean {
    const char = charAt(text, index);
    return char !== undefined && WORD.test(char);
}

/** Steht ein Treffer auf einer Wortgrenze? Nur eine Kante, die selbst ein Buchstabe oder eine Ziffer ist, braucht sie. */
function onBoundary(text: string, at: number, length: number): boolean {
    if (isWordAt(text, at)) {
        const before = charAt(text, at - 1);
        if (isWordAt(text, at - 1)) return false;
        if (before !== undefined && JOINERS.has(before) && isWordAt(text, at - 2)) return false;
    }
    const last = at + length - 1;
    if (isWordAt(text, last)) {
        const after = charAt(text, last + 1);
        if (isWordAt(text, last + 1)) return false;
        if (after !== undefined && JOINERS.has(after) && isWordAt(text, last + 2)) return false;
    }
    return true;
}

/** Die erste Stelle von `needle` ab `from`, die auf einer Wortgrenze steht; -1, wenn es keine gibt. */
function findPiece(text: string, needle: string, from: number): number {
    let at = text.indexOf(needle, from);
    while (at >= 0) {
        if (onBoundary(text, at, needle.length)) return at;
        at = text.indexOf(needle, at + 1);
    }
    return -1;
}

/**
 * Die Verweise eines Textes (ein Feld eines Infopanels): `fields` sind die Felder des Artikels, aus denen der angezeigte Text besteht, in der Reihenfolge,
 * in der er sie zusammensetzt (die Lage eines Ortes ist Region, dann Staat). Ohne Quelle, ohne Teilstücke oder ohne Text gibt es keine Verweise.
 */
export function textLinks(
    source: LinkSource | undefined,
    fields: readonly string[],
    text: string | null,
): SubjectFactLink[] {
    if (source === undefined || text === null || text === "") return [];
    const links: SubjectFactLink[] = [];
    let cursor = 0;
    for (const field of fields) {
        for (const piece of source.pages.get(field) ?? []) {
            const at = findPiece(text, piece.text, cursor);
            if (at < 0) continue;
            cursor = at + piece.text.length;
            const match = lookupWikiKey(source.lookup, piece.key);
            if (match.kind === "one") links.push({ text: piece.text, ref: match.ref, at });
        }
    }
    return links;
}

/**
 * Die Verweise einer Liste (die Nachbarn einer Himmelsrichtung): jeder Wert ist ein eigener Text, der Zeiger rückt von Wert zu Wert. `at` ist der Anfang
 * des Textes IM WERT; ein Wert kann mehrere Namen tragen („Winhaller Land / Farindelwald“) und einen Zusatz („Svalltermoor (Region)“).
 */
export function listValueLinks(
    source: LinkSource | undefined,
    field: string,
    values: readonly string[],
): SubjectListLink[] {
    if (source === undefined || values.length === 0) return [];
    const links: SubjectListLink[] = [];
    let value = 0;
    let cursor = 0;
    for (const piece of source.pages.get(field) ?? []) {
        let found: { value: number; at: number } | null = null;
        for (let candidate = value, from = cursor; candidate < values.length; candidate += 1, from = 0) {
            const at = findPiece(values[candidate] as string, piece.text, from);
            if (at >= 0) {
                found = { value: candidate, at };
                break;
            }
        }
        if (found === null) continue;
        value = found.value;
        cursor = found.at + piece.text.length;
        const match = lookupWikiKey(source.lookup, piece.key);
        if (match.kind === "one") links.push({ value: found.value, text: piece.text, ref: match.ref, at: found.at });
    }
    return links;
}

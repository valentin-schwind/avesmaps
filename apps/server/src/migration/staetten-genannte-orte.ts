import type { Queryable } from "../database.ts";

/**
 * Die genannten Orte einer Kette als ZAHL im Bericht (WI-0134 §4): welche Linkziele über ihren Key genau eine Siedlung treffen, welche
 * mehrere, welche keine. Nur lesend, nie geschrieben.
 *
 * 🔴 **Das ist Evidenz, keine Bindung.** Ein Linkziel NENNT einen Ort; ob die Stätte darin liegt oder nur dabei, sagt der Text. Diese
 * Zählung erzeugt keine Beziehung und speichert nichts (Regel 3); eine offene Zuordnung ist eine Zahl, kein Fehler und kein Tor.
 * Ein Key wird zum Ort nur über die Zuordnung X2 (`wiki_key_assignment`, Legacys Art `siedlung`) und nur auf aktive Siedlungen (Dorf bis
 * Metropole), wie die Gegenprüfung gemessen hat (`wi-0128-gegenpruefung-2026-10-10.md` §1.2). Kein Name, keine Faltung.
 */

/** Die Siedlungsgrößen, die als „Ort“ zählen (ohne Gebäude und Stadtviertel). */
export const SETTLEMENT_SUBTYPES = ["dorf", "kleinstadt", "stadt", "grossstadt", "metropole"] as const;

/** Key → Kennungen der aktiven Siedlungen, denen X2 diesen Key zuweist. */
export async function readSettlementKeyIndex(database: Queryable): Promise<Map<string, string[]>> {
    const rows = await database<{ key: string; id: string }[]>`
        SELECT a.wiki_key AS key, p.public_id::text AS id
          FROM wiki_key_assignment a
          JOIN place p ON p.public_id = a.object_public_id
         WHERE a.is_active AND a.legacy_art = 'siedlung' AND p.is_active
           AND p.subtype = ANY(${[...SETTLEMENT_SUBTYPES]}::text[])
         ORDER BY a.wiki_key, p.public_id
    `;
    const index = new Map<string, string[]>();
    for (const row of rows) {
        const list = index.get(row.key);
        if (list === undefined) index.set(row.key, [row.id]);
        else list.push(row.id);
    }
    return index;
}

/** Wie die Kette einer Stätte ihre Orte nennt. */
export type NamedPlaceClass = "eindeutig" | "mehrdeutig" | "ohne_ort" | "ohne_key" | "ohne_link";

export interface NamedPlaceCounts {
    /** Genau eine Siedlung über die Keys der Kette. */
    eindeutig: number;
    /** Mehrere Siedlungen (zwei Orte in der Kette, oder ein Key, den zwei Orte tragen). */
    mehrdeutig: number;
    /** Keys, aber keiner trifft eine Siedlung (Gebiet, Gebäude, Artikel ohne Ort). */
    ohne_ort: number;
    /** Linkziele, aber keines trägt einen Key. */
    ohne_key: number;
    /** Keine Linkziele. */
    ohne_link: number;
}

export const emptyNamedPlaceCounts = (): NamedPlaceCounts => ({
    eindeutig: 0,
    mehrdeutig: 0,
    ohne_ort: 0,
    ohne_key: 0,
    ohne_link: 0,
});

/** Die Klasse einer Kette, nur aus ihren Keys. */
export function classifyNamedPlaces(
    keys: readonly (string | null)[],
    index: ReadonlyMap<string, readonly string[]>,
): NamedPlaceClass {
    if (keys.length === 0) return "ohne_link";
    const present = keys.filter((key): key is string => key !== null);
    if (present.length === 0) return "ohne_key";
    const places = new Set(present.flatMap((key) => index.get(key) ?? []));
    if (places.size === 0) return "ohne_ort";
    return places.size === 1 ? "eindeutig" : "mehrdeutig";
}

/** Die Zahlen über viele Ketten. */
export function countNamedPlaces(
    chains: Iterable<readonly (string | null)[]>,
    index: ReadonlyMap<string, readonly string[]>,
): NamedPlaceCounts {
    const counts = emptyNamedPlaceCounts();
    for (const keys of chains) counts[classifyNamedPlaces(keys, index)] += 1;
    return counts;
}

/** Die Zahlen als ein Satz für Bericht und Log. */
export const describeNamedPlaces = (counts: NamedPlaceCounts): string =>
    `genannter Ort eindeutig ${String(counts.eindeutig)}, mehrdeutig ${String(counts.mehrdeutig)}, Key ohne Siedlung ${String(counts.ohne_ort)}, ` +
    `ohne Key ${String(counts.ohne_key)}, ohne Link ${String(counts.ohne_link)}`;

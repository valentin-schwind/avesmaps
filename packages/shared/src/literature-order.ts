/**
 * Die Reihenfolge der Spielliteratur (Legacy `avesmapsGameLiteratureEditionSortKey`, `avesmapsCompareGameLiteratureRecency`, Mirror
 * `cbe278210`, `js/map-features/map-features-game-literature.js`) - EINE Definition für den Server, der die Sektion so ordnet, und
 * das Fenster „Literatur zu …“, dessen Sortierung „neueste zuerst“ und „nach Edition“ sie braucht (WI-0118). Zwei Abschriften
 * einer Rangregel liefen auseinander; Legacy hat es einmal bezahlt.
 */

/**
 * Legacys Sortierschlüssel der Edition, aufsteigend sortiert = neueste zuerst: `DSA<n>(.<m>)` wird `-n` (DSA4.1 → −4,1 vor DSA4 → −4),
 * ein Nicht-DSA-Regelwerk 1000, eine fehlende Edition 1001. Gerechnet wird mit der ERSTEN Zahl im Text („DSA4.1 Basis“ → −4,1,
 * „DSA1-Ausbau“ → −1, „DSA4/DSA5“ → −4).
 */
export function editionSortKey(edition: string | null | undefined): number {
    const text = (edition ?? "").trim();
    if (text === "") return 1001;
    const match = /DSA\s*(\d+(?:\.\d+)?)/i.exec(text);
    return match?.[1] === undefined ? 1000 : -Number.parseFloat(match[1]);
}

/** Was der Vergleich „neueste zuerst“ von einem Werk liest. */
export interface RecencyKey {
    edition?: string | null | undefined;
    /** Das Jahr als Zahl (`bf_year`); ohne Jahr 0. */
    year?: number | null | undefined;
    title: string;
}

/**
 * „Neueste zuerst“ (Legacy `avesmapsCompareGameLiteratureRecency`), Schlüssel in dieser Reihenfolge: (1) die EDITION (DSA5 → DSA1,
 * Unbekanntes ans Ende) - die einzige Achse, die wirklich gefüllt ist; (2) das Jahr absteigend, wo eines da ist (`bf_year` trägt
 * sechs von 2.003 Werken); (3) der Titel, damit ein Gleichstand deterministisch bricht statt in die Eingangsreihenfolge zu fallen.
 * Die ROLLE geht bewusst NICHT ein: ein Spoiler steht an seinem Sortierplatz, nicht als Block am Ende.
 */
export function compareRecency(left: RecencyKey, right: RecencyKey): number {
    return (
        editionSortKey(left.edition) - editionSortKey(right.edition) ||
        (right.year ?? 0) - (left.year ?? 0) ||
        left.title.localeCompare(right.title, "de")
    );
}

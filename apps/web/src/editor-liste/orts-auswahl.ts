import type { EditorPlaceRow } from "@avesmaps3d/shared";

/**
 * Welche Orte eine Ortsauswahl im Editor anbietet (WI-0128 E10b, „Verlagern …“ einer Stätte): eine Suche über die Ortsliste des
 * Editors, reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * 🔴 **Nur Orte mit Kartenzeile** (`origin: "karte"`). Eine Stätte hängt an `place.id` (0099); ein Ort ohne Lage hat keine, ein
 * Wiki-Eintrag (`wiki:…`) ist gar kein Ort. Der Server lehnt beides ab - die Auswahl bietet es darum gar nicht erst an.
 *
 * 🪤 Die Liste kommt als Ganzes (`ladeOrte`, mit ETag) und wird hier gefiltert. Eine eigene Suchroute wäre eine zweite Wahrheit
 * darüber, was ein Ort ist.
 */

export interface OrtsWahl {
    /** Die `public_id` des Orts. */
    id: string;
    name: string;
    /** Was unter dem Namen steht: Art und Lage, soweit bekannt; leer, wenn nichts bekannt ist. */
    unterzeile: string;
}

/** Wie viele Zeilen die Auswahl höchstens zeigt; mehr verlangt eine engere Suche. */
export const ORTS_AUSWAHL_GRENZE = 50;

const passt = (row: EditorPlaceRow, q: string, ausser: ReadonlySet<string>): boolean =>
    row.origin === "karte" && !ausser.has(row.key) && (q === "" || row.name.toLocaleLowerCase("de-DE").includes(q));

/** Die wählbaren Orte zu einer Sucheingabe, höchstens `ORTS_AUSWAHL_GRENZE`; `treffer` zählt alle. */
export function ortsAuswahl(
    rows: readonly EditorPlaceRow[],
    suche: string,
    ausser: ReadonlySet<string> = new Set(),
): { zeilen: OrtsWahl[]; treffer: number } {
    const q = suche.trim().toLocaleLowerCase("de-DE");
    const zeilen: OrtsWahl[] = [];
    let treffer = 0;
    for (const row of rows) {
        if (!passt(row, q, ausser)) continue;
        treffer += 1;
        if (zeilen.length >= ORTS_AUSWAHL_GRENZE) continue;
        const teile = [row.kind ?? row.subtype, row.region].filter(
            (teil): teil is string => teil !== undefined && teil.trim() !== "",
        );
        zeilen.push({ id: row.key, name: row.name, unterzeile: teile.join(" · ") });
    }
    return { zeilen, treffer };
}

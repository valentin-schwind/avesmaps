import type { LandscapeSelection, MapView, SearchHit } from "@avesmaps3d/shared";

/**
 * Was ein Suchtreffer an der Karte umstellt, außer der Kamera (Betreiberentscheidungen 2026-09-23).
 *
 * 🔴 „Jede Suchklasse braucht ihre bevorzugte Ansicht.“ Ein Treffer schaltet die Karte in die
 * Ansicht, in der er zu sehen ist. Die Standardkarte zeigt keine Klimabänder, die Klimaansicht keine
 * Orte. Ohne den Wechsel landete der Sprung richtig und zeigte nichts. Legacy macht es genauso
 * (`spotlight-search-focus.js`: „Without this the highlight would sit on top of an empty map.“).
 *
 * 🪤 Die Kamera steht nicht hier: wohin sie fährt, sagt der Treffer selbst (x, y, zoom).
 */
export interface SearchFocus {
    /** Die Ansicht, in der der Treffer zu sehen ist. */
    view: MapView;
    /** Die Landschaftsebene, nur wo die Ansicht eine braucht. Sonst bleibt die gewählte stehen. */
    landscape?: LandscapeSelection;
    /** Die Klimazone, die kräftiger steht, bis man in die Karte klickt. */
    climateZone?: string;
}

/**
 * Die bevorzugte Ansicht je Suchklasse.
 *
 * 💣 Ein `Record` über ALLE Klassen: Kommt eine neue dazu (politische Gebiete, Kraftlinien), bricht
 * die Typprüfung hier, bis sie ihre Ansicht hat. Ein `default`-Zweig ließe sie still auf irgendeiner
 * Ansicht landen.
 *
 * Landschaftsnamen gehören auf die Standardkarte: Unsere Landschaftstreffer sind Beschriftungen, und
 * die stehen dort vollständig. Legacy schaltet für eine Beschriftung ebenso auf die Standardkarte.
 */
const BEVORZUGTE_ANSICHT: Record<SearchHit["kind"], (hit: SearchHit) => SearchFocus> = {
    ort: () => ({ view: "standard" }),
    weg: () => ({ view: "standard" }),
    landschaft: () => ({ view: "standard" }),
    klima: (hit) => ({ view: "landscapes", landscape: "klima", climateZone: hit.id }),
};

export function focusForHit(hit: SearchHit): SearchFocus {
    return BEVORZUGTE_ANSICHT[hit.kind](hit);
}

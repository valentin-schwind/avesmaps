import type { WikisyncBereich } from "@avesmaps3d/shared";

/**
 * Die festen Größen der Kategorien (WI-0253 C-2; seit WI-0294 aus der Datei `dump_categorylinks.sql.gz`, nicht mehr aus der API). Was erst eine VORLAGE im Wiki setzt, steht nicht im
 * Dump-Text: die Ortsgröße (`settlement_class`), die Bauwerkart (`building_type`) und der Kontinent (`continent`). Die Regeln sind Legacys (`api/_internal/wiki/dump-category-layer.php`,
 * Stand a7f2dac86). Die Namen mit „Wiki-Teil“ stammen aus der Zeit der API-Abfragen und bleiben (Bereiche und Formen der Kategorien).
 */

/** Die drei Formen. */
export const WIKI_TEIL_FORMEN = ["ortsgroesse", "bauwerkart", "kontinent"] as const;
export type WikiTeilForm = (typeof WIKI_TEIL_FORMEN)[number];

/** Die Bereiche mit Kategorien und ihre Formen. Ein Test hält die Bereiche gleich `WIKISYNC_MIT_KATEGORIEN`. */
export const WIKI_TEIL_FORMEN_JE_BEREICH = {
    ort: ["ortsgroesse", "bauwerkart"],
    gebiet: ["kontinent"],
    region: ["kontinent"],
} as const satisfies Partial<Record<WikisyncBereich, readonly WikiTeilForm[]>>;
export type WikiTeilBereich = keyof typeof WIKI_TEIL_FORMEN_JE_BEREICH;
export const WIKI_TEIL_BEREICHE = Object.keys(WIKI_TEIL_FORMEN_JE_BEREICH) as WikiTeilBereich[];

export const istWikiTeilBereich = (bereich: string): bereich is WikiTeilBereich =>
    Object.hasOwn(WIKI_TEIL_FORMEN_JE_BEREICH, bereich);

/** Das Feld des Plans, das eine Form trägt, je Bereich (`wikisync_lauf_zeile.feld`). */
export const FELD_JE_FORM: Readonly<Record<WikiTeilBereich, Readonly<Record<string, string>>>> = {
    ort: { ortsgroesse: "settlement_class", bauwerkart: "building_type" },
    gebiet: { kontinent: "continent" },
    region: { kontinent: "continent" },
};

/** Die gelesenen Werte eines Bereichs je Form, nach dem Schlüssel des Titels (`titelSchluessel`): Klasse, Art oder Kontinent. */
export type Ergebnisse = Partial<Record<WikiTeilForm, ReadonlyMap<string, string>>>;

/**
 * Die Siedlungsgrößen: Kategorie im Wiki → Klasse (Legacy `AVESMAPS_WIKI_CATEGORY_TO_CLASS`, `locations.php`). 🔴 Die Reihenfolge ist tragend (der erste
 * Treffer gewinnt) und bleibt die von Legacy. Die mittelgroße Stadt heißt im Wiki „Mittelgroße Stadt“, nicht „Stadt“ oder „Mittlere Stadt“.
 */
export const ORTSGROESSE_KATEGORIEN: readonly { readonly kategorie: string; readonly klasse: string }[] = [
    { kategorie: "Dorf", klasse: "dorf" },
    { kategorie: "Kleinstadt", klasse: "kleinstadt" },
    { kategorie: "Mittelgroße Stadt", klasse: "stadt" },
    { kategorie: "Großstadt", klasse: "grossstadt" },
    { kategorie: "Metropole (Siedlungsgröße)", klasse: "metropole" },
];

/** Die Oberkategorie der Bauwerksarten; ihre Unterkategorien sind die Arten (Legacy `avesmapsWikiDumpCategoryFetchBuildingTypes`). */
export const BAUWERK_OBERKATEGORIE = "Bauwerk nach Art";

/** Linien und Mauerwerk sind Wege oder Anlagen, keine Punkte der Karte (Legacy `avesmapsWikiSettlementIsExcludedBuildingType`), gefaltet verglichen. */
export const BAUWERK_AUSGESCHLOSSEN: ReadonlySet<string> = new Set([
    "strasse",
    "reichsstrasse",
    "mauer",
    "damm",
    "deich",
    "kanalisation",
    "aequadukt",
]);

/** Der Kontinent, wenn weder Titel noch Kategorien einen nennen (Legacy `AVESMAPS_POLITICAL_DEFAULT_CONTINENT`). */
export const KONTINENT_VORGABE = "Aventurien";

import type { SubjectDetailKind, SubjectFactField } from "@avesmaps3d/shared";

/**
 * Die Datentabelle „wie Legacy“ (WI-0063 27.7/27.8, Betreiber 2026-10-04: „aussehn wie legacy“): welche Zeilen in welcher
 * Reihenfolge, je Art des Subjects. Quelle ist Legacys Code (Mirror `b9657635a`):
 *
 * - Ort: `settlementWikiInfoboxMarkup` (`js/map-features/map-features-location-marker-entry.js`): Beschreibung (erster Satz),
 *   Oberhaupt, Einwohner, Verkehrswege (verlinkt), Handelszone, Bevölkerung, Tempel, Stätten, [Waren/Fauna/Flora], Klimazone.
 *   🔴 Die `lage` und das Bauwerk des Wiki-Nests sind KEINE Zeilen: Legacy zeigt die Lage nirgends in der Tabelle und
 *   die Art im Untertitel.
 * - Landschaft und Gipfel (ein Label mit Wiki-Zuweisung): `labelWikiInfoboxMarkup` (`map-features-labels.js`): Lage, Staat,
 *   Einwohner, Sprache, Vegetation, Beschreibung, [Waren/Fauna/Flora], Klimazone.
 * - Weg: `pathWikiInfoboxMarkup` (`map-features-path-rendering.js`): Lage, Länge, Führt durch, Verlauf (als Deckel), Beschreibung.
 * - Kraftlinie: `powerlineInfoboxMarkup` (`map-features-powerlines.js`): Verbindet, Verläuft über, Abschnitte, Stärke, Affinität,
 *   Länge, Regionen, Beschreibung (voll).
 * - Gebiet: `createRegionWikiInfoBoxMarkup` (`map-features-region-info-markup.js`): Wiki-Eintrag, Status, Umstritten mit,
 *   Herrschaftsform, Oberhaupt, Gründung, Auflösung, Gründer, Obergebiet, Hauptstadt, Herrschaftssitz, Sprache, Währung, Einwohnerzahl,
 *   Handelszone, Geographisch, Kartenzeitraum, Handelswaren, Lore, Klimazone - was unser Server trägt, steht hier in dieser Reihenfolge
 *   (P7 und, mit den Feldern des Gebietsexports E4, WI-0063 27.18; „Obergebiet“ ist die Treppe „Liegt in“, „Wiki-Eintrag“ die Wikizeile
 *   des Quellenkastens).
 *
 * Was hier fehlt, ist ein Zusatzfeld: Der Server liefert es mit, das Panel zeigt es nur, wenn es freigegeben ist
 * (`PANEL_APPROVED_EXTRAS` in `@avesmaps3d/shared`) oder der Entwicklerschalter „alle Zusatzfelder“ es zeigt (`panel-extras.ts`).
 */

/**
 * Ein Platz in der Tabelle: eine Faktenzeile, eine Zeile aus dem räumlichen Kontext, eine der Anspruchsteller („Umstritten mit“) oder eine
 * aus der Gestalt einer Kraftlinie („Verbindet“, „Verläuft über“, „Abschnitte“).
 */
export type RowSlot =
    | SubjectFactField
    | "ctx:landscapes"
    | "ctx:climate"
    | "ctx:rivers"
    | "claimants"
    /** Weg (WI-0302): die anderen Straßen, mit denen er Abschnitte teilt („Gemeinsam mit“). */
    | "gemeinsam"
    | "shape:ends"
    | "shape:via"
    | "shape:segments"
    /** Die vier Vorkommenszeilen (D5, WI-0091): je ein Deckel mit dem Zählsatz, die Namen kommen beim Aufklappen. */
    | "lore"
    /**
     * Die Zeile „Stätten“ eines Ortes (D7, WI-0109): ein Deckel mit dem Zählsatz, die Namen nach Art gegliedert kommen beim
     * Aufklappen. Sie steht ÜBER den Vorkommen (Owner 2026-08-15: „tu die stätten über Waren“).
     */
    | "staetten";

/** Die Tabelle je Art, in Legacys Reihenfolge. */
export const LEGACY_ROWS: Readonly<Record<SubjectDetailKind, readonly RowSlot[]>> = {
    place: [
        "description",
        "oberhaupt",
        "einwohner",
        "verkehrswege",
        "handelszone",
        "bevoelkerung",
        "tempel",
        // WI-0109 und `staetten.yaml` -> `panelbezug.platz`: die Stätten stehen nach Tempel und VOR den Vorkommen
        // (Owner 2026-08-15: „tu die stätten über Waren“). Nur der Ort hat sie - eine Stätte liegt innerhalb einer Siedlung.
        "staetten",
        // WI-0063 27.7 und `lore.yaml` -> `panelbezug.platz`: die Vorkommen stehen nach Tempel und Stätten und VOR der Klimazone.
        "lore",
        "ctx:climate",
    ],
    // 🔴 Nicht Legacy, sondern WI-0063 5.1/14: Eine Landschaft ohne eigenen Artikel (ein See, „Hügel der Brinaskquelle“) darf nicht
    // als leere Titelbox stehen - sie zeigt ihren räumlichen Kontext (Ebenen der Landschaft, Klima, Herrschaft als Treppe).
    // 🔍 Die Landschaft ist der HAUPTträger der Vorkommen, nicht der Ort (WI-0091 gemessen: 253 Landschaften mit 2.427 Einträgen
    // gegen 141 Orte mit 383). Gipfel tragen welche, aber nur fünf.
    area: [
        "regionParent",
        "affiliationStaat",
        "einwohner",
        "sprache",
        "vegetation",
        "description",
        "ctx:landscapes",
        "lore",
        "ctx:climate",
    ],
    peak: [
        "regionParent",
        "affiliationStaat",
        "einwohner",
        "sprache",
        "vegetation",
        "description",
        "ctx:landscapes",
        "lore",
        "ctx:climate",
    ],
    // 🔴 Die vier Vorkommenszeilen stehen am Weg AM ENDE, und das ist eine eigene Wahl, kein Legacy-Platz: Legacy zeigt am Weg
    // gar keine (WI-0103, Betreiber 2026-10-07: „Wege sollen abgeleitete Vorkommen haben“). Vor „Lage“ und „Verlauf“ zu gehen
    // hieße, Legacys Wikifelder auseinanderzureißen; hinter ihnen stehen sie wie am Ort hinter den redaktionellen Feldern - dort
    // folgt nur noch die Klimazone, die ein Weg nicht hat.
    // 🔴 „Gemeinsam mit“ (WI-0302, Entwurf „Weitere Straßennamen“, Ansicht Infopanel) ist kein Legacy-Platz: Legacy zeigte die weiteren
    // Straßennamen nirgends. Die Zeile steht nach „Verlauf“, wo sie den Verlauf ergänzt, und vor der Beschreibung.
    path: ["lage", "laenge", "ctx:landscapes", "verlauf", "gemeinsam", "description", "lore"],
    // `powerlineInfoboxMarkup`: Verbindet, Verläuft über, Abschnitte, Stärke, Affinität, Länge, Regionen, Beschreibung.
    powerline: [
        "shape:ends",
        "shape:via",
        "shape:segments",
        "staerke",
        "affinitaet",
        "laenge",
        "regionen",
        "description",
    ],
    // `createRegionWikiInfoBoxMarkup` (Mirror `6fafd5c2f`): Status, Umstritten mit, Herrschaftsform, Oberhaupt, Gründung, Auflösung, Gründer,
    // Obergebiet (die Treppe „Liegt in“, über der Tabelle), Hauptstadt, Herrschaftssitz, Sprache, Währung, Einwohnerzahl, Handelszone,
    // Geographisch, Kartenzeitraum, Handelswaren, Lore, Klimazone. Die Felder von Herrschaftsform bis Geographisch sind die des
    // Gebietsexports E4 (WI-0063 27.18). Der Platz der Lore ist seit WI-0091 besetzt: vier Zeilen nach „Kartenzeitraum“, vor der
    // Klimazone (`lore.yaml` -> `panelbezug.platz`).
    // 🪤 „Handelswaren“ steht hier als eigene Zeile, wo Legacy sie streicht, sobald die Waren-Zeile greift: Dort geht der Freitext in die Liste der
    // Vorkommen ein, bei uns (noch) nicht - ohne die Zeile wäre er unsichtbar (WI-0063 27.18 Regel 3).
    territory: [
        "status",
        "claimants",
        "herrschaftsform",
        "oberhaupt",
        "gruendung",
        "aufloesung",
        "gruender",
        "capital",
        "seat",
        "sprache",
        "waehrung",
        "einwohnerzahl",
        "handelszone",
        "geographisch",
        "validity",
        "handelswaren",
        "lore",
        "ctx:climate",
    ],
};

/**
 * Wo die Herrschaftskette als Treppe „Liegt in“ steht, solange nichts anderes freigegeben ist: am Ort (Legacy), an der freien
 * Kartenstelle (Legacy „Was ist hier?“), am Gebiet und an der Fläche (WI-0063 14: räumlicher Kontext statt leerer Box). Ein
 * Weg und eine Kraftlinie laufen durch Dutzende Gebiete; Legacy zeigt dort keine, sie sind ein Zusatz.
 */
export const LEGACY_STAIRCASE: ReadonlySet<SubjectDetailKind | "mapPoint"> = new Set([
    "place",
    "area",
    "peak",
    "territory",
    "mapPoint",
]);

/**
 * Die Zeilen der freien Kartenstelle. Legacy „Was ist hier?“ zeigt Derographie, Topographie, Vegetation, **dann die vier
 * Vorkommenszeilen**, dann die Klimazone; die Flüsse im Umkreis sind unser Zusatz und stehen dahinter.
 *
 * 🔴 **Der Platz der Vorkommen ist Legacys, nicht geraten** (WI-0110, Mirror `6fafd5c2f`):
 * `js/map-features/map-features-what-is-here.js` baut die drei Landschaftszeilen, ruft dann `buildLoreMarkup` (denselben
 * Container wie an einer Siedlung) und erst danach `avesmapsClimateRowMarkup`. Legacys eigener Prüffall
 * `js/map-features/__tests__/what-is-here-panel.test.js` hält beides fest: „das Panel schreibt keine Lore-Zeile selbst --
 * buildLoreMarkup baut alle drei“ und „🔴 ‚Klimazone‘ steht IMMER direkt unter Flora (Owner 2026-08-03)“. Es ist damit auch
 * die Reihenfolge des Hauses - dieselbe wie an Landschaft und Gipfel (`ctx:landscapes`, `lore`, `ctx:climate`).
 */
export const MAP_POINT_ROWS: readonly RowSlot[] = ["ctx:landscapes", "lore", "ctx:climate", "ctx:rivers"];

/** Ein Platz, der keine Faktenzeile ist: Kontext, Anspruchsteller, die Gestalt einer Kraftlinie oder die Vorkommen. */
export const isDerivedSlot = (slot: RowSlot): boolean =>
    slot.startsWith("ctx:") ||
    slot.startsWith("shape:") ||
    slot === "claimants" ||
    slot === "gemeinsam" ||
    slot === "lore" ||
    slot === "staetten";

/** Alle Plätze, die eine Art in der Legacy-Tabelle hat (Zusatzfelder stehen dahinter). */
export const legacyFields = (kind: SubjectDetailKind): readonly SubjectFactField[] =>
    LEGACY_ROWS[kind].filter((slot): slot is SubjectFactField => !isDerivedSlot(slot));

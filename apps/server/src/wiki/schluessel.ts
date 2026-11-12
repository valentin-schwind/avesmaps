import { normalisiereTitel, phpTrim } from "./infobox/text.ts";

/**
 * Legacys Wiki-Schlüssel eines Seitentitels, Zeichen für Zeichen nachgebaut (WI-0253, Scheiben Ortslisten und Quellen). Er ist die Identität, über die Legacy einen
 * Artikel mit einem Objekt verbindet: `wiki:` + Slug in der Zuordnung X2 (`wiki_key_assignment`, der Lookup `subjects/wiki-key-lookup.ts`) und `wikipub:` + Slug für
 * eine Publikation ohne Shop-Adresse (`feature_source.source_key`). Vorbild (Legacy-Mirror a7f2dac86):
 *
 * - `avesmapsPoliticalSlug` (`api/_internal/political/territory.php`): klein (`mb_strtolower`), `ß` zu `ss`, `avesmapsFoldToAscii` (`api/_internal/text/ascii-fold.php`:
 *   die lateinischen Ligaturen ausgeschrieben, JEDES andere Nicht-ASCII-Zeichen ein `?`), jede Folge von Zeichen außer `a-z0-9` ein `-`, `-` an den Rändern weg,
 *   „marktgrafschaft“ zu „markgrafschaft“, 180 Zeichen;
 * - `avesmapsWikiSyncMonitorNormalizeTitle` (`api/_internal/wiki/sync-monitor.php`): `_` zu Leerzeichen, ein Abschnitt (`#…`) fällt weg.
 *
 * 🔴 Verlustbehaftet, absichtlich: „Fürstentum Kosch“ wird `f-rstentum-kosch`, nicht `fuerstentum-kosch`. So stehen die Schlüssel in Legacys Daten; ein „schönerer“
 * Faltungssatz bräche jede Verknüpfung still. Gemessen gegen die echten PHP-Funktionen (`scripts/dev/wiki-schluessel-orakel.php`, Test `wiki-schluessel.test.ts`).
 */

/** Die Zeichen, deren Faltung Buchstaben ergibt (`AVESMAPS_ASCII_FOLD_LIGATURES`); jedes andere Nicht-ASCII-Zeichen wird ein `?`. */
const LIGATUREN: Readonly<Record<string, string>> = {
    ß: "ss",
    æ: "ae",
    Æ: "AE",
    œ: "oe",
    Œ: "OE",
    ﬀ: "ff",
    ﬁ: "fi",
    ﬂ: "fl",
    ﬃ: "ffi",
    ﬄ: "ffl",
};

/** Legacy `avesmapsFoldToAscii`: ASCII bleibt, eine Ligatur wird ausgeschrieben, jedes andere Zeichen (je Codepunkt) ein `?`. */
export function faltAscii(wert: string): string {
    let aus = "";
    for (const zeichen of wert) aus += (zeichen.codePointAt(0) ?? 0) < 0x80 ? zeichen : (LIGATUREN[zeichen] ?? "?");
    return aus;
}

/** Legacy `avesmapsPoliticalSlug`. */
export function legacySlug(wert: string): string {
    const klein = phpTrim(wert).toLowerCase().replaceAll("ß", "ss");
    const slug = faltAscii(klein)
        .replace(/[^a-z0-9]+/giu, "-")
        .replace(/^-+|-+$/gu, "")
        .replaceAll("marktgrafschaft", "markgrafschaft");
    return slug.slice(0, 180);
}

/** Legacy `avesmapsWikiSyncMonitorNormalizeTitle` steht schon bei den Lesern (`infobox/text.ts`); hier nur weitergereicht. */
export { normalisiereTitel };

/** Der Schlüssel eines Artikels in der Zuordnung X2 (Legacy `avesmapsGameLiteratureCanonicalKeyForName`): `wiki:` + Slug; leer, wenn der Slug leer ist. */
export function wikiSchluesselFuerTitel(titel: string): string {
    const slug = legacySlug(phpTrim(titel));
    return slug === "" ? "" : `wiki:${slug}`;
}

/** Der Schlüssel einer Publikation (Legacy `avesmapsPublicationCatalogWikiKeyForTitle`): der Slug des normalisierten Titels, ohne Präfix. */
export function publikationsSchluessel(titel: string): string {
    return legacySlug(normalisiereTitel(titel));
}

/**
 * Der Schlüssel, unter dem Legacys Tafel der Aliase (`wiki_redirect_alias`) das ZIEL einer Weiterleitung führt, ohne das Präfix `wiki:` (`avesmapsWikiDumpCanonicalWikiKeyForTitle` mit
 * `avesmapsPublicationStripWikiKeyPrefix`). Legacy baut aus dem Titel die Adresse der Seite und liest den Schlüssel aus ihrem Pfad: Alles bis zum LETZTEN `/wiki/` fällt weg, ein
 * Abschnitt (`#`) fällt NICHT weg (er steht in der Adresse kodiert und wird ein `-` im Slug; anders als beim Titel der Weiterleitung selbst, `normalisiereTitel`). Ergibt der Pfad
 * keinen Slug, gilt der Slug des Titels (`name:`).
 */
export function weiterleitungsZiel(ziel: string): string {
    const titel = phpTrim(ziel);
    if (titel === "") return "";
    const roh = titel.replaceAll(" ", "_");
    const ab = roh.lastIndexOf("/wiki/");
    const slug = legacySlug((ab < 0 ? roh : roh.slice(ab + "/wiki/".length)).replaceAll("_", " "));
    return slug !== "" ? slug : legacySlug(titel);
}

import type { CitymapEntry, SubjectCitymapsSection } from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t, type MessageKey } from "../i18n/i18n";
import type { CardImage } from "../info-panel/catalog-model";
import type { RowModel } from "../info-panel/panel-types";
import {
    overlapsYears,
    OPEN_END_BF,
    splits,
    yearFacet,
    type FilterChange,
    type FilterGroup,
} from "./catalog-filter-model";
import { hasFreeWay, linkLinesOf, type LinkLine } from "./catalog-link-model";

/**
 * Das Fenster „Kartensammlung von …“ als reines Modell (WI-0118; Legacy `buildCityMapRowMarkup`, `cityMapRowFacts`, `cityMapBandLabel`,
 * `avesmapsCitymapActiveFacets`, `avesmapsCitymapMatchesFilter`, Mirror `cbe278210`): die Zeilen, ihre Filter und der vergrößerte
 * Eintrag. Reine Funktionen ohne Vue - sie lassen sich prüfen, ohne den Browser zu öffnen.
 *
 * 🔴 Unbekannt FEHLT. Ein Wert, den niemand erfasst hat, steht nicht als „nein“ oder „unbekannt“ da (Legacy §3.1: „unbekannte
 * Eigenschaften werden ausgelassen, nicht als ‚unbekannt‘ ausgeschrieben“), und er trifft keinen Filter - nur „alle“.
 */

/** So heißt die Beschriftung einer Kartenart; ein unbekannter Schlüssel bleibt, wie er ist (Legacy `avesmapsCitymapTypeLabel`). */
function wordOf(prefix: string, key: string): string {
    const full = `${prefix}${key.toLowerCase()}`;
    return isMessageKey(full) ? t(full as MessageKey) : key;
}

export const typeLabel = (key: string): string => wordOf("catalog.citymaps.type.", key);
export const artLabel = (key: string): string => wordOf("catalog.citymaps.art.", key);
export const colourLabel = (key: string): string => wordOf("catalog.citymaps.colour.", key);

/**
 * Der Name einer Zeile im Fenster (Legacy `cityMapBandLabel`): 86 % der Titel sind die Formel „{Typ} von {Ort} ({Quelle})“, und in einem
 * Fenster namens „Kartensammlung von Gareth“ ist alles daran redundant AUSSER der Klammer. Die erste Quelle kommt zuerst, weil sie ein
 * strukturiertes Feld mit 87 % Abdeckung ist; die Klammer ist geraten und nur der Rückfall.
 */
export function bandLabel(entry: Pick<CitymapEntry, "band" | "title">): string {
    if (entry.band !== undefined && entry.band.trim() !== "") return entry.band.trim();
    const title = entry.title.trim();
    if (!title.endsWith(")")) return title;
    // Rückwärts bis zur BALANCIERENDEN Klammer, nicht bis zur ersten: „Umgebungskarte von Gareth (Abenteuer Basis-Spiel (DSA3))“ ist
    // echt, und die erste Klammer lieferte dort „DSA3“.
    let depth = 0;
    for (let at = title.length - 1; at >= 0; at -= 1) {
        const char = title.charAt(at);
        if (char === ")") depth += 1;
        else if (char === "(") {
            depth -= 1;
            if (depth === 0) return title.slice(at + 1, -1).trim() || title;
        }
    }
    return title;
}

/** „1027–1045 BF“ | „seit 1027 BF“ | „bis 1045 BF“ | „“ (Legacy `cityMapValidityLabel`); 9999 ist das offene Ende und liest sich „seit“. */
export function validityLabel(entry: Pick<CitymapEntry, "validFrom" | "validTo">): string {
    const from = entry.validFrom ?? null;
    const to = entry.validTo === undefined || entry.validTo === OPEN_END_BF ? null : entry.validTo;
    if (from !== null && to !== null) return `${String(from)}–${String(to)} BF`;
    if (from !== null) return t("catalog.citymaps.since", { year: from });
    if (to !== null) return t("catalog.citymaps.until", { year: to });
    return "";
}

/** Typ und Farbe: die graue Fortsetzung der Titelzeile (Legacy `cityMapRowSuffix`). Sie ersetzt die Typ-Gruppen und die Farb-Spalte. */
export function suffixOf(entry: Pick<CitymapEntry, "types" | "colorMode">): string {
    const parts: string[] = [];
    if (entry.types !== undefined && entry.types.length > 0) parts.push(entry.types.map(typeLabel).join(" & "));
    if (entry.colorMode !== undefined) parts.push(colourLabel(entry.colorMode));
    return parts.join(" · ");
}

const yesNo = (value: boolean): string => t(value ? "catalog.yes" : "catalog.no");

/**
 * ALLE Angaben, die der Bestand zu dieser Karte führt (der vergrößerte Eintrag; Legacy `cityMapRowFacts` zeigt nur die bejahten):
 * Hier steht auch ein ausdrückliches NEIN - es ist eine Aussage, die jemand getroffen hat. Was niemand erfasst hat, hat keine Zeile.
 */
export function factsOf(entry: CitymapEntry): RowModel[] {
    const rows: RowModel[] = [];
    const add = (key: string, label: MessageKey, text: string | undefined): void => {
        if (text !== undefined && text !== "") rows.push({ key, label: t(label), value: { kind: "text", text } });
    };
    // WI-0287: Mehr als eine Publikation heißt „Bände“, alle in der Reihenfolge am Eintrag (die erste ist `band`); sonst „Band“ wie bisher.
    if (entry.bands !== undefined && entry.bands.length > 1) {
        add("bands", "catalog.citymaps.fact.bands", entry.bands.join(" · "));
    } else {
        add("band", "catalog.citymaps.fact.band", entry.band);
    }
    add("art", "catalog.citymaps.fact.art", entry.art === undefined ? undefined : artLabel(entry.art));
    add(
        "types",
        "catalog.citymaps.fact.types",
        entry.types === undefined ? undefined : entry.types.map(typeLabel).join(", "),
    );
    add(
        "colour",
        "catalog.citymaps.fact.colour",
        entry.colorMode === undefined ? undefined : colourLabel(entry.colorMode),
    );
    add("official", "catalog.citymaps.fact.official", entry.official === undefined ? undefined : yesNo(entry.official));
    add("labeled", "catalog.citymaps.fact.labeled", entry.labeled === undefined ? undefined : yesNo(entry.labeled));
    add(
        "multilevel",
        "catalog.citymaps.fact.multilevel",
        entry.multilevel === undefined ? undefined : yesNo(entry.multilevel),
    );
    add("scale", "catalog.citymaps.fact.scale", entry.hasScale === undefined ? undefined : yesNo(entry.hasScale));
    add("validity", "catalog.citymaps.fact.validity", validityLabel(entry));
    add("format", "catalog.citymaps.fact.format", entry.format);
    add("author", "catalog.citymaps.fact.author", entry.author);
    add("publisher", "catalog.citymaps.fact.publisher", entry.publisher);
    add(
        "resolution",
        "catalog.citymaps.fact.resolution",
        entry.widthPx !== undefined && entry.heightPx !== undefined
            ? `${formatNumber(entry.widthPx, 0)} × ${formatNumber(entry.heightPx, 0)} px`
            : undefined,
    );
    add("note", "catalog.citymaps.fact.note", entry.note);
    return rows;
}

const imageOf = (view: { url: string; width: number; height: number } | undefined): CardImage | undefined =>
    view === undefined ? undefined : { url: view.url, width: view.width, height: view.height };

/** Eine Version der Karte im vergrößerten Eintrag (WI-0287 Stufe 2): ihr Reiter und ihr Vollbild, wo es öffentlich ist (sonst zeigt der Eintrag die Vorschau). */
export interface CitymapVersion {
    /** Die Bezeichnung („Spielerversion“), ohne sie „Version n“. */
    name: string;
    full: CardImage | undefined;
}

/** Die Versionen einer Karte, ab zwei (Reiter); bei einer oder keiner leer, dann gilt `full` wie bisher. */
export function versionsOf(entry: Pick<CitymapEntry, "fulls">): CitymapVersion[] {
    const fulls = entry.fulls ?? [];
    if (fulls.length < 2) return [];
    return fulls.map((version, index) => ({
        name: version.label?.trim() || t("catalog.citymaps.version", { n: index + 1 }),
        full: imageOf(version.view),
    }));
}

/** Eine Zeile des Fensters. */
export interface CitymapRow {
    id: string;
    /** Der volle Titel: die Überschrift des vergrößerten Eintrags. */
    title: string;
    /** Worin die Freitextsuche sucht: Titel, Zeichner und Verlag. */
    suchtext: string;
    /** Der Name der zugeklappten Zeile (`bandLabel`). */
    band: string;
    /** Typ und Farbe, grau dahinter; leer, wo beides fehlt. */
    suffix: string;
    spoiler: boolean;
    /** Die Vorschau (höchstens 400 px, nie hochskaliert) - fehlt, wo der Media Core keine freigibt. */
    preview: CardImage | undefined;
    /** Das Vollbild; fehlt fast überall. Wo es da ist, wird es groß gezeigt und öffnet in voller Größe. */
    full: CardImage | undefined;
    /** WI-0287 Stufe 2: die Versionen der Karte ab zwei, als Reiter im vergrößerten Eintrag; sonst leer. */
    versions: CitymapVersion[];
    facts: RowModel[];
    links: LinkLine[];
    /** Wohin ein Klick auf das große Bild führt, wenn es kein Vollbild gibt: die erste Fundstelle. */
    bestLink: string | undefined;
    // --- Was die Filter lesen ---
    colour: boolean;
    official: boolean;
    free: boolean;
    from: number | null;
    to: number | null;
    /** Die Sortierung (Legacy): erst der erste Typ, dann der Name der Zeile. */
    sortType: string;
}

export function citymapRowOf(entry: CitymapEntry): CitymapRow {
    const links = linkLinesOf(entry.links);
    return {
        id: entry.id,
        title: entry.title,
        suchtext: [entry.title, entry.author ?? "", entry.publisher ?? ""].join(" "),
        band: bandLabel(entry),
        suffix: suffixOf(entry),
        spoiler: entry.spoiler === true,
        preview: imageOf(entry.preview),
        full: imageOf(entry.full),
        versions: versionsOf(entry),
        facts: factsOf(entry),
        links,
        bestLink: links[0]?.url,
        colour: entry.colorMode === "farbig",
        official: entry.official === true,
        free: hasFreeWay(entry.links),
        from: entry.validFrom ?? null,
        to: entry.validTo ?? null,
        sortType: entry.types?.[0] ?? "",
    };
}

/**
 * Die Zeilen in der Ordnung des Fensters (Legacy): nach Typ, dann nach Band. Ohne Gruppenüberschriften, aber die Reihenfolge hält die
 * Farbe-Schwarzweiß-Paare nebeneinander - so lesen sie sich als Paar statt als Dublette.
 */
export function citymapRowsOf(section: SubjectCitymapsSection): CitymapRow[] {
    return section.maps
        .map(citymapRowOf)
        .sort((a, b) => a.sortType.localeCompare(b.sortType, "de") || a.band.localeCompare(b.band, "de"));
}

// ---------------------------------------------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------------------------------------------

export interface CitymapFilter {
    colourOnly: boolean;
    officialOnly: boolean;
    freeOnly: boolean;
    yearFrom: number | null;
    yearTo: number | null;
    /** Kein Filter: der Sammelschalter für die Deckel. `false` ist der Startzustand - es zeigt nie ungefragt, was verdeckt ist. */
    spoilers: boolean;
}

export const emptyCitymapFilter = (): CitymapFilter => ({
    colourOnly: false,
    officialOnly: false,
    freeOnly: false,
    yearFrom: null,
    yearTo: null,
    spoilers: false,
});

/** Welche Filter diese Menge teilen (Legacy `avesmapsCitymapActiveFacets`). */
export interface CitymapFacets {
    colour: boolean;
    free: boolean;
    official: boolean;
    years: { shown: boolean; min: number; max: number };
    spoiler: boolean;
}

export function citymapFacets(rows: readonly CitymapRow[]): CitymapFacets {
    return {
        colour: splits(rows, (row) => row.colour),
        free: splits(rows, (row) => row.free),
        official: splits(rows, (row) => row.official),
        years: yearFacet(rows),
        spoiler: rows.some((row) => row.spoiler),
    };
}

export function citymapMatches(row: CitymapRow, filter: CitymapFilter): boolean {
    if (filter.colourOnly && !row.colour) return false;
    if (filter.officialOnly && !row.official) return false;
    if (filter.freeOnly && !row.free) return false;
    return overlapsYears(row, filter.yearFrom, filter.yearTo);
}

/** Die Leiste zu Filter und Facetten (Legacy `citymapFiltersMarkup`): Farbe, kostenlos, Zeitraum, dann - getrennt - offiziell und Spoiler. */
export function citymapFilterGroups(facets: CitymapFacets, filter: CitymapFilter): FilterGroup[] {
    const own: FilterGroup[] = [];
    if (facets.colour) {
        own.push({
            kind: "toggle",
            id: "colour",
            label: t("catalog.citymaps.filter.colour"),
            active: filter.colourOnly,
        });
    }
    if (facets.free) {
        own.push({ kind: "toggle", id: "free", label: t("catalog.citymaps.filter.free"), active: filter.freeOnly });
    }
    if (facets.years.shown) {
        own.push({
            kind: "years",
            id: "years",
            label: t("catalog.filter.period"),
            fromPlaceholder: t("catalog.filter.from"),
            toPlaceholder: t("catalog.filter.to"),
            range: { min: facets.years.min, max: facets.years.max },
            from: filter.yearFrom,
            to: filter.yearTo,
        });
    }
    const shared: FilterGroup[] = [];
    if (facets.official) {
        shared.push({
            kind: "toggle",
            id: "official",
            label: t("catalog.filter.official"),
            active: filter.officialOnly,
        });
    }
    if (facets.spoiler) {
        shared.push({
            kind: "toggle",
            id: "spoiler",
            label: t("catalog.citymaps.filter.spoiler"),
            active: filter.spoilers,
        });
    }
    // Der Trenner gehört VOR die geteilten Schalter und fällt mit ihnen weg, sonst stünde eine Linie am Leistenende.
    return shared.length > 0 && own.length > 0 ? [...own, { kind: "divider" }, ...shared] : [...own, ...shared];
}

/** Was eine Eingabe an der Leiste mit dem Filter macht. */
export function citymapFilterReduce(filter: CitymapFilter, change: FilterChange): CitymapFilter {
    if (change.kind === "toggle") {
        switch (change.id) {
            case "colour":
                return { ...filter, colourOnly: !filter.colourOnly };
            case "free":
                return { ...filter, freeOnly: !filter.freeOnly };
            case "official":
                return { ...filter, officialOnly: !filter.officialOnly };
            case "spoiler":
                return { ...filter, spoilers: !filter.spoilers };
        }
    }
    if (change.kind === "year") {
        return change.edge === "from" ? { ...filter, yearFrom: change.value } : { ...filter, yearTo: change.value };
    }
    return filter;
}

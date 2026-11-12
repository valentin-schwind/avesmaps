import {
    compareRecency,
    editionSortKey,
    type LiteratureEntry,
    type LiteratureRole,
    type SubjectLiteratureSection,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { literatureTypeLabel, type CardImage } from "../info-panel/catalog-model";
import type { RowModel } from "../info-panel/panel-types";
import {
    overlapsYears,
    splits,
    splittingValues,
    yearFacet,
    type FilterChange,
    type FilterGroup,
} from "./catalog-filter-model";
import { linkLinesOf, type LinkLine } from "./catalog-link-model";

/**
 * Das Fenster „Literatur zu …“ als reines Modell (WI-0118; Legacy `buildGameLiteratureRowMarkup`, `buildDialogControls`,
 * `advFiltersMarkup`, `avesmapsGameLiteratureFacetOptions`, `avesmapsGameLiteratureMatchesFilter`, Mirror `cbe278210`): die Zeilen, ihre
 * Filter, die Sortierung und der vergrößerte Eintrag. Reine Funktionen ohne Vue.
 *
 * 🔴 Genre wird am Komma getrennt, nicht als ganzer Text verglichen: „Stadtabenteuer, Kriegsszenario“ sind zwei Schlagworte, und wer
 * nach „Stadtabenteuer“ sucht, will auch dieses Werk (Legacy verglich den ganzen Text und bot 977 Werke in mehreren hundert
 * Spielarten an, von denen jede höchstens ein Werk fand).
 */

/** Wie das Werk an diesem Gegenstand steht (Legacy: „beginnt hier“, „spielt hier“, „beschreibt“). */
export const roleLabel = (role: LiteratureRole): string => t(`catalog.literature.role.${role}`);

/** „DSA5 · 1047 BF · Gruppenabenteuer“ (Legacy: die erste Metazeile der Zeile). */
export function metaLine(entry: Pick<LiteratureEntry, "edition" | "year" | "productType">): string {
    return [entry.edition, entry.year, literatureTypeLabel(entry.productType)]
        .filter((part): part is string => part !== undefined && part !== "")
        .join(" · ");
}

/**
 * Die Schwierigkeit, wie sie gezeigt wird: Freitext aus der Infobox von Wiki Aventurica (KompM, KompSp), den Legacy ungeglättet übernimmt
 * (`publication-parsing.php:531-532` an avesmaps@13d0183ab). Befund 2026-10-11: Die Wiki-Auszeichnung stand wörtlich mit Tags da
 * („Hoch <small>(lt. Klappentext)</small>“); Legacy setzt den Text als HTML ein, wir zeigen ihn als Text und lassen die Tags weg.
 */
export function schwierigkeitText(roh: string | undefined): string {
    return (roh ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/s+/g, " ")
        .trim();
}

/** Schreibweisen, die sich nur in Groß- und Kleinschreibung unterscheiden, sind dieselbe Schwierigkeit (Befund 2026-10-11). */
const schwierigkeitSchluessel = (text: string): string => text.toLocaleLowerCase("de");

/** Schlagworte und Schwierigkeit (Legacy: die zweite Metazeile). */
export function factLine(entry: Pick<LiteratureEntry, "genres" | "complexity">): string {
    const schwierigkeit = schwierigkeitText(entry.complexity);
    return [...(entry.genres ?? []), ...(schwierigkeit === "" ? [] : [schwierigkeit])].join(" · ");
}

/** ALLE Angaben, die der Bestand zu diesem Werk führt (der vergrößerte Eintrag). */
export function workFacts(entry: LiteratureEntry): RowModel[] {
    const rows: RowModel[] = [];
    const add = (key: string, label: Parameters<typeof t>[0], text: string | undefined): void => {
        if (text !== undefined && text !== "") rows.push({ key, label: t(label), value: { kind: "text", text } });
    };
    add("edition", "catalog.literature.fact.edition", entry.edition);
    add("year", "catalog.literature.fact.year", entry.year);
    add("type", "catalog.literature.fact.type", literatureTypeLabel(entry.productType));
    add("containedIn", "catalog.literature.fact.containedIn", entry.containedIn);
    add("genres", "catalog.literature.fact.genres", entry.genres === undefined ? undefined : entry.genres.join(", "));
    add("complexity", "catalog.literature.fact.complexity", schwierigkeitText(entry.complexity));
    add("role", "catalog.literature.fact.role", roleLabel(entry.role));
    return rows;
}

const imageOf = (view: { url: string; width: number; height: number } | undefined): CardImage | undefined =>
    view === undefined ? undefined : { url: view.url, width: view.width, height: view.height };

export interface WorkRow {
    id: string;
    title: string;
    /** Worin die Freitextsuche sucht: Titel und Reihe (`containedIn`); Autoren führt der Bestand nicht. */
    suchtext: string;
    /** Die Rolle `play` IST der Spoiler (`literature.yaml`). */
    spoiler: boolean;
    cover: CardImage | undefined;
    /** „DSA5 · 1047 BF · Gruppenabenteuer“; leer, wo alles fehlt. */
    meta: string;
    /** „Schlagworte · Schwierigkeit“; leer, wo beides fehlt. */
    facts: string;
    /** „enthalten in: …“; leer ohne Sammelwerk. */
    containedIn: string;
    detail: RowModel[];
    links: LinkLine[];
    // --- Was die Filter und die Sortierung lesen ---
    type: string;
    edition: string;
    complexity: string;
    genres: readonly string[];
    year: number;
    official: boolean;
}

export function workRowOf(entry: LiteratureEntry): WorkRow {
    return {
        id: entry.id,
        title: entry.title,
        suchtext: [entry.title, entry.containedIn ?? ""].join(" "),
        spoiler: entry.role === "play",
        cover: imageOf(entry.cover),
        meta: metaLine(entry),
        facts: factLine(entry),
        containedIn:
            entry.containedIn === undefined ? "" : t("infoPanel.literature.containedIn", { name: entry.containedIn }),
        detail: workFacts(entry),
        links: linkLinesOf(entry.links),
        type: literatureTypeLabel(entry.productType),
        edition: entry.edition ?? "",
        complexity: schwierigkeitText(entry.complexity),
        genres: entry.genres ?? [],
        year: entry.bfYear ?? 0,
        official: entry.official === true,
    };
}

export const workRowsOf = (section: SubjectLiteratureSection): WorkRow[] => section.works.map(workRowOf);

/** Wie viele OFFEN dastehen: Ein verdeckter Eintrag zählt nicht mit, sonst verriete die Zahl, wie viel hier gespielt wird. */
export const openWorks = (rows: readonly WorkRow[]): number => rows.filter((row) => !row.spoiler).length;

// ---------------------------------------------------------------------------------------------------------------
// Filter und Sortierung
// ---------------------------------------------------------------------------------------------------------------

export const SORT_MODES = ["newest", "type", "edition", "alpha"] as const;
export type SortMode = (typeof SORT_MODES)[number];

export interface LiteratureFilter {
    types: ReadonlySet<string>;
    edition: string;
    complexity: string;
    genre: string;
    yearFrom: number | null;
    yearTo: number | null;
    officialOnly: boolean;
    /** Kein Filter: der Sammelschalter für die Deckel (siehe `citymap-window-model.ts`). */
    spoilers: boolean;
    sort: SortMode;
}

export const emptyLiteratureFilter = (): LiteratureFilter => ({
    types: new Set(),
    edition: "",
    complexity: "",
    genre: "",
    yearFrom: null,
    yearTo: null,
    officialOnly: false,
    spoilers: false,
    sort: "newest",
});

export interface LiteratureFacets {
    types: string[];
    editions: string[];
    complexities: string[];
    genres: string[];
    years: { shown: boolean; min: number; max: number };
    official: boolean;
    spoiler: boolean;
}

const sorted = (values: string[]): string[] => values.sort((a, b) => a.localeCompare(b, "de"));

/** Die Form, in der eine zusammengefasste Schwierigkeit gezeigt wird: die häufigste ihrer Schreibweisen, bei Gleichstand die erste. */
function haeufigsteForm(rows: readonly WorkRow[], schluessel: string): string {
    const zahl = new Map<string, number>();
    for (const row of rows) {
        if (row.complexity !== "" && schwierigkeitSchluessel(row.complexity) === schluessel) {
            zahl.set(row.complexity, (zahl.get(row.complexity) ?? 0) + 1);
        }
    }
    return [...zahl].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))[0]?.[0] ?? schluessel;
}

/** Welche Filter diese Menge teilen (Legacy `avesmapsGameLiteratureFacetOptions`, dazu die Teilungsregel). */
export function literatureFacets(rows: readonly WorkRow[]): LiteratureFacets {
    return {
        types: sorted(splittingValues(rows, (row) => [row.type].filter((value) => value !== ""))),
        editions: sorted(splittingValues(rows, (row) => [row.edition].filter((value) => value !== ""))),
        complexities: sorted(
            splittingValues(rows, (row) =>
                [row.complexity].filter((value) => value !== "").map(schwierigkeitSchluessel),
            ).map((schluessel) => haeufigsteForm(rows, schluessel)),
        ),
        genres: sorted(splittingValues(rows, (row) => row.genres)),
        years: yearFacet(
            rows.map((row) => ({ from: row.year > 0 ? row.year : null, to: row.year > 0 ? row.year : null })),
        ),
        official: splits(rows, (row) => row.official),
        spoiler: rows.some((row) => row.spoiler),
    };
}

export function literatureMatches(row: WorkRow, filter: LiteratureFilter): boolean {
    if (filter.types.size > 0 && !filter.types.has(row.type)) return false;
    if (filter.edition !== "" && row.edition !== filter.edition) return false;
    if (
        filter.complexity !== "" &&
        schwierigkeitSchluessel(row.complexity) !== schwierigkeitSchluessel(filter.complexity)
    )
        return false;
    if (filter.genre !== "" && !row.genres.includes(filter.genre)) return false;
    if (filter.officialOnly && !row.official) return false;
    // Ein Werk ohne Jahr passt auf keinen Zeitraum (Legacy: „ein Jahr 0 = undatiert, ausgeschlossen, sobald eine Grenze steht“).
    if (filter.yearFrom !== null || filter.yearTo !== null) {
        if (row.year <= 0) return false;
        return overlapsYears({ from: row.year, to: row.year }, filter.yearFrom, filter.yearTo);
    }
    return true;
}

/** Die vier Ordnungen der Liste (Legacy `.avesmaps-adv__sort`). Die Rolle geht nie ein: ein Spoiler steht an seinem Platz. */
export function sortWorks(rows: readonly WorkRow[], mode: SortMode): WorkRow[] {
    const byTitle = (a: WorkRow, b: WorkRow): number => a.title.localeCompare(b.title, "de");
    const newest = (a: WorkRow, b: WorkRow): number =>
        compareRecency(
            { edition: a.edition, year: a.year, title: a.title },
            { edition: b.edition, year: b.year, title: b.title },
        );
    const order: Record<SortMode, (a: WorkRow, b: WorkRow) => number> = {
        newest,
        alpha: byTitle,
        type: (a, b) => a.type.localeCompare(b.type, "de") || b.year - a.year || byTitle(a, b),
        edition: (a, b) => editionSortKey(a.edition) - editionSortKey(b.edition) || byTitle(a, b),
    };
    return [...rows].sort(order[mode]);
}

const SORT_LABELS: Record<SortMode, Parameters<typeof t>[0]> = {
    newest: "catalog.literature.sort.newest",
    type: "catalog.literature.sort.type",
    edition: "catalog.literature.sort.edition",
    alpha: "catalog.literature.sort.alpha",
};

/** Die Leiste zu Filter und Facetten (Legacy `advFiltersMarkup`): Art, Version, Schwierigkeit, Genre, Zeitraum, dann offiziell und Spoiler. */
export function literatureFilterGroups(
    facets: LiteratureFacets,
    filter: LiteratureFilter,
    count: number,
): FilterGroup[] {
    const own: FilterGroup[] = [];
    if (facets.types.length > 0) {
        own.push({
            kind: "chips",
            id: "type",
            options: facets.types.map((value) => ({ value, label: value, active: filter.types.has(value) })),
        });
    }
    const select = (id: string, placeholder: Parameters<typeof t>[0], values: string[], value: string): void => {
        if (values.length > 0) {
            own.push({
                kind: "select",
                id,
                placeholder: t(placeholder),
                options: values.map((entry) => ({ value: entry, label: entry })),
                value,
            });
        }
    };
    select("edition", "catalog.literature.filter.edition", facets.editions, filter.edition);
    select("complexity", "catalog.literature.filter.complexity", facets.complexities, filter.complexity);
    select("genre", "catalog.literature.filter.genre", facets.genres, filter.genre);
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
            label: t("catalog.literature.filter.spoiler"),
            active: filter.spoilers,
        });
    }
    const groups: FilterGroup[] =
        shared.length > 0 && own.length > 0 ? [...own, { kind: "divider" }, ...shared] : [...own, ...shared];
    // Sortieren lohnt erst ab zwei Einträgen.
    if (count >= 2) {
        groups.push({
            kind: "sort",
            id: "sort",
            label: t("catalog.literature.sort.label"),
            options: SORT_MODES.map((mode) => ({
                value: mode,
                label: t(SORT_LABELS[mode]),
                active: filter.sort === mode,
            })),
        });
    }
    return groups;
}

export function literatureFilterReduce(filter: LiteratureFilter, change: FilterChange): LiteratureFilter {
    switch (change.kind) {
        case "toggle":
            if (change.id === "official") return { ...filter, officialOnly: !filter.officialOnly };
            if (change.id === "spoiler") return { ...filter, spoilers: !filter.spoilers };
            return filter;
        case "chip": {
            if (change.id !== "type") return filter;
            const types = new Set(filter.types);
            if (!types.delete(change.value)) types.add(change.value);
            return { ...filter, types };
        }
        case "select":
            if (change.id === "edition") return { ...filter, edition: change.value };
            if (change.id === "complexity") return { ...filter, complexity: change.value };
            if (change.id === "genre") return { ...filter, genre: change.value };
            return filter;
        case "year":
            return change.edge === "from" ? { ...filter, yearFrom: change.value } : { ...filter, yearTo: change.value };
        case "sort":
            return (SORT_MODES as readonly string[]).includes(change.value)
                ? { ...filter, sort: change.value as SortMode }
                : filter;
    }
}

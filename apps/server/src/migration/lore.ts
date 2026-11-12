import { createHash } from "node:crypto";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import type { WikiKeyLookup } from "../subjects/wiki-key-lookup.ts";
import type { TargetIndex } from "./catalog-places.ts";
import {
    LORE_KINDS,
    LORE_RELATIONS,
    RULE_LAYERS,
    bareLoreKey,
    hitKindLabel,
    resolveLorePlace,
    resolveLorePlaceByCarriers,
    ruleKeyOf,
    type LoreCarrierIds,
    type LoreHit,
    type LoreKind,
    type LoreRelation,
    type LoreTargetState,
    type RuleLayer,
    type RuleTermKeyInput,
} from "./lore-keys.ts";
import { hasWikitextResidue, textOf } from "./subject-details.ts";
import { catalogSourceIdentity, urlHash } from "./sources.ts";
import type { SourceState } from "./sync-table.ts";

/**
 * Lore und Vorkommen: die reine Umwandlung der Antwort von `lore-export.php` (Legacy E2 und E2+) in Einträge, Ortszeilen, Regeln,
 * Herkunftsvermerke und Quellenverknüpfungen (WI-0063 P3, Vertrag `project-control/migration/contracts/lore.yaml`, D5).
 *
 * Diese Datei kennt weder Datenbank noch Netz; was sie über die Träger wissen muss, bekommt sie als `LoreLookups`. Der Prüfer rechnet
 * dieselbe Funktion noch einmal.
 *
 * 🔴 Alles verbatim, nichts geparst; ein leerer Text ist NULL. Die Reihenfolge der Ortszeilen und der Bedingungen ist Aussage und wird
 * nie neu sortiert. Aufgelöst wird NUR über den Wiki-Schlüssel (`lore-keys.ts`), nie über einen Namen.
 * 🔴 Nichts blockiert (AGENTS.md, „Blockierende Prüfungen im Betrieb“): Ist die Antwort unbrauchbar, leer, abgeschaltet oder passen die
 * Kopfzähler nicht zu den Listen, schreibt der Schritt nichts, legt nichts still und meldet `source_block_missing`,
 * `source_empty_catalog`, `source_switched_off` beziehungsweise `source_counts_disagree`; der Lauf geht weiter. Alle anderen Codes melden nur.
 * 🔴 Der Notaus je Art (`kinds_enabled`) gehört Legacy: Eine abgeschaltete Art geht samt Ortszeilen, Regeln und Quellen NICHT hinaus.
 * Das ist kein „alles entfernt“: die Zeilen dieser Art bleiben unberührt (`withheldKinds`).
 * 🔴 `created_by` und jede andere Personenspalte liest der Import nie; steht eine in der Antwort, nennt der Befund nur den Schlüsselnamen.
 */

export const LORE_CONTRACT_VERSION = "1";

/** Legacys Obergrenzen (Spaltenbreiten): Ein längerer Text wird unverändert gespeichert und als Befund gemeldet. */
const LIMITS = {
    wiki_key: 190,
    name: 300,
    wiki_title: 300,
    wiki_url: 500,
    gruppe: 300,
    typ: 300,
    lebensraum: 500,
    synonyme: 500,
    continent: 120,
    match_key: 300,
    place_wiki_key: 190,
    place_title: 300,
    pages: 120,
    note: 200,
} as const;

/** Legacys Obergrenze der Bedingungen je Regel (`AVESMAPS_LORE_RULE_MAX_TERMS`). */
export const RULE_MAX_TERMS = 25;

/** Die Felder, für die Legacy je Eintrag eine Herkunft führt (`AVESMAPS_LORE_WIKI_FIELDS`); `merkmale_json` heißt hier `merkmale`. */
export const ENTRY_FIELD_ORIGIN_FIELDS = [
    "kind",
    "wiki_title",
    "wiki_url",
    "name",
    "gruppe",
    "typ",
    "lebensraum",
    "synonyme",
    "merkmale",
    "continent",
] as const;

/** Die Schlüssel, die eine Personenkennung tragen würden; der Import liest sie nie. */
const PERSONAL_KEYS = ["created_by", "updated_by", "uploaded_by", "user_id", "author"] as const;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type EntryOrigin = "wiki" | "manual" | "unknown";
export type RuleOrigin = "manual" | "wiki_verbreitung" | "unknown";
export type LinkOrigin = "wiki_publication" | "manual" | "unknown";

/** Was Avesmaps3D an Zielen, Flächen, Klimazonen und Quellen kennt (aus den Tabellen gelesen, `readLoreLookups`). */
export interface LoreLookups {
    /** Der Lookup „Wiki-Key → Subject“ der Oberfläche (aus Legacys Zuordnung X2): die EINE Quelle der Ortsauflösung. */
    wikiKeys: WikiKeyLookup;
    /** Die internen Ids der Träger zu den öffentlichen IDs, mit denen der Lookup arbeitet. */
    carrierIds: LoreCarrierIds;
    /** Die Träger über D6 und `territory.wiki_key`: nur das Vergleichsmaß für den Befund `place_target_differs_from_carriers`, nie die Quelle. */
    targets: TargetIndex;
    /** `region.public_id` (klein) → Id und Aktivität. */
    regions: ReadonlyMap<string, { id: string; active: boolean }>;
    /** `<region_layer>|<region_type>` der AKTIVEN Regionen. */
    regionTypes: ReadonlySet<string>;
    /** `climate_zone_type.type_key`. */
    climateKeys: ReadonlySet<string>;
    /** `feature_source.source_key` der AKTIVEN Katalogzeilen → Id. */
    sources: ReadonlyMap<string, string>;
}

export interface EntryRow {
    wikiKey: string;
    kind: LoreKind;
    name: string;
    wikiTitle: string | null;
    wikiUrl: string | null;
    gruppe: string | null;
    typ: string | null;
    lebensraum: string | null;
    synonyme: string | null;
    continent: string | null;
    matchKey: string | null;
    legacyOrigin: EntryOrigin;
    /** Der Zustand, in dem die Quelle den Eintrag führt (active, suppressed, retired). */
    state: SourceState;
    fieldOrigins: { field: string; origin: "wiki" | "manual" }[];
}

export interface PlaceRow {
    entryWikiKey: string;
    entryName: string;
    placeWikiKey: string;
    relation: LoreRelation;
    placeTitle: string | null;
    sortOrder: number;
    keyClass: "continent" | "other";
    targetState: LoreTargetState;
    hits: LoreHit[];
    legacyOrigin: EntryOrigin;
    state: SourceState;
}

export interface TermRow {
    seq: number;
    joinOp: "und" | "oder";
    areaRegionId: string | null;
    legacyAreaPublicId: string | null;
    climateFrom: string | null;
    climateTo: string | null;
    legacyClimateFrom: string | null;
    legacyClimateTo: string | null;
    types: { layer: RuleLayer; type: string }[];
}

export interface RuleRow {
    entryWikiKey: string;
    entryName: string;
    ruleKey: string;
    relation: LoreRelation;
    sortOrder: number;
    legacyOrigin: RuleOrigin;
    terms: TermRow[];
}

export interface LinkRow {
    entryWikiKey: string;
    entryName: string;
    /** `feature_source.id`. */
    sourceId: string;
    referenceKind: "ausfuehrlich" | "ergaenzend" | "erwaehnung" | null;
    pages: string | null;
    note: string | null;
    legacyOrigin: LinkOrigin;
    position: number;
    state: SourceState;
}

export interface LoreTransform {
    /** `true`: die Antwort ist unbrauchbar, leer, abgeschaltet oder widerspricht ihren Zählern; der Aufrufer schreibt nichts. */
    skipped: boolean;
    /** Legacys Stempel der Antwort (für das Journal). */
    revision: { map: number | null; lore: string | null };
    /** Arten, die Legacy abgeschaltet hat: ihre Zeilen bleiben unberührt. */
    withheldKinds: LoreKind[];
    entries: EntryRow[];
    places: PlaceRow[];
    rules: RuleRow[];
    links: LinkRow[];
    totals: {
        places: Record<LoreTargetState, number>;
        targets: number;
    };
    findings: Finding[];
}

function skip(findings: Finding[], withheldKinds: LoreKind[] = []): LoreTransform {
    return {
        skipped: true,
        revision: { map: null, lore: null },
        withheldKinds,
        entries: [],
        places: [],
        rules: [],
        links: [],
        totals: { places: { resolved: 0, ambiguous: 0, unresolved: 0, unmatched: 0 }, targets: 0 },
        findings,
    };
}

const ENTRY_ORIGINS: readonly string[] = ["wiki", "manual"];
const RULE_ORIGINS: readonly string[] = ["manual", "wiki_verbreitung"];
const LINK_ORIGINS: readonly string[] = ["wiki_publication", "manual"];
const REFERENCE_KINDS: readonly string[] = ["ausfuehrlich", "ergaenzend", "erwaehnung"];

function entryObject(row: { wikiKey: string; name: string }): FindingObject {
    return { table: "lore_entry", publicId: row.wikiKey, name: row.name };
}

/** Eine Ganzzahl aus Zahl oder Zahlentext, sonst `null`. */
function integerOf(value: unknown): number | null {
    if (typeof value === "number") return Number.isInteger(value) ? value : null;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
    return null;
}

/** Eine JSON-Spalte, wie die Antwort sie trägt: als Objekt, oder (ältere Form) als JSON-Text. */
function bagOf(value: unknown): Bag | null {
    if (isBag(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        try {
            const parsed: unknown = JSON.parse(value);
            return isBag(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of items) {
        const key = keyOf(item);
        result[key] = (result[key] ?? 0) + 1;
    }
    return result;
}

/** Die häufigsten Schlüssel als Textzeilen „Schlüssel: n“. */
function topLines(counts: Readonly<Record<string, number>>, limit: number): string[] {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([key, n]) => `${key}: ${String(n)}`);
}

/** Ob ein Schlüsselwort der Negation im Rohtext steht (Information über Legacys Wiki-Text, nie ein Eingriff). */
const NEGATION = /\b(au(?:ß|ss)er|ausgenommen|abgesehen von|nicht|ohne|mit Ausnahme)\b/i;
/** Zwei Wikilinks ohne Trenner, durch ein Wortstück verbunden (`[[Schaf]]s[[wolle]]`). */
const DOUBLE_LINK = /\]\][\p{L}]+\[\[/u;
const ORT_FELDER = ["verbreitung", "herkunft", "regionen"] as const;

/**
 * Wandelt die Antwort um. `mapRevision` ist die Revision der `map-features.json` desselben Zuges (oder `null`): weicht sie ab, laufen
 * die Quellennummern der Verknüpfungen womöglich auseinander (Befund `source_revision_differs`, Information).
 */
export function transformLore(
    payload: unknown,
    lookups: LoreLookups,
    mapRevision: number | null = null,
): LoreTransform {
    const bag = isBag(payload) ? payload : null;
    const entryList = bag?.["entries"];
    const placeList = bag?.["places"];
    const ruleList = bag?.["rules"];
    const sourceList = bag?.["sources"];
    const linkList = bag?.["links"];
    if (
        bag === null ||
        bag["ok"] !== true ||
        !Array.isArray(entryList) ||
        !Array.isArray(placeList) ||
        !Array.isArray(ruleList) ||
        !Array.isArray(sourceList) ||
        !Array.isArray(linkList)
    ) {
        const reason =
            bag === null
                ? "kein Objekt"
                : bag["ok"] !== true
                  ? "ok nicht true"
                  : "entries, places, rules, sources oder links keine Liste";
        return skip([
            createFinding(
                "source_block_missing",
                `Die Antwort von lore-export.php ist unbrauchbar (${reason}); der Schritt schreibt nichts und legt nichts still, der Lauf geht weiter`,
                { grund: reason },
            ),
        ]);
    }

    // ---- Notaus je Art und Kopfzähler ---------------------------------------------------------------------------------------
    const kindsEnabled = isBag(bag["kinds_enabled"]) ? bag["kinds_enabled"] : {};
    const withheldKinds = LORE_KINDS.filter((kind) => kindsEnabled[kind] === false);
    const counts = isBag(bag["counts"]) ? bag["counts"] : null;
    const withheldEntries = counts === null ? 0 : (integerOf(counts["withheld_entries"]) ?? 0);
    if (entryList.length === 0) {
        return skip(
            [
                withheldKinds.length > 0 || withheldEntries > 0
                    ? createFinding(
                          "source_switched_off",
                          `Alle ausgelieferten Arten sind in Legacy abgeschaltet (kinds_enabled, ${String(withheldEntries)} Einträge zurückgehalten): kein Stand, nichts wird stillgelegt; ein leerer Export ist hier nicht „alles entfernt“`,
                          { zurueckgehalten: withheldEntries, arten: withheldKinds.join(", ") },
                      )
                    : createFinding(
                          "source_empty_catalog",
                          "Die Antwort trägt keinen einzigen Eintrag, ohne dass Legacy eine Art abgeschaltet meldet; der Schritt schreibt nichts und legt nichts still",
                          {},
                      ),
            ],
            withheldKinds,
        );
    }
    const termTotal = ruleList.reduce<number>(
        (sum, rule) => sum + (isBag(rule) && Array.isArray(rule["terms"]) ? rule["terms"].length : 0),
        0,
    );
    const typeTotal = ruleList.reduce<number>(
        (sum, rule) =>
            sum +
            (isBag(rule) && Array.isArray(rule["terms"])
                ? rule["terms"].reduce<number>(
                      (inner, term) =>
                          inner +
                          (isBag(term) && Array.isArray(term["region_types"]) ? term["region_types"].length : 0),
                      0,
                  )
                : 0),
        0,
    );
    const stated: Record<string, number | null> =
        counts === null
            ? {}
            : {
                  entries: integerOf(counts["entries"]),
                  places: integerOf(counts["places"]),
                  rules: integerOf(counts["rules"]),
                  rule_terms: integerOf(counts["rule_terms"]),
                  rule_term_types: integerOf(counts["rule_term_types"]),
                  sources: integerOf(counts["sources"]),
                  links: integerOf(counts["links"]),
              };
    const delivered: Record<string, number> = {
        entries: entryList.length,
        places: placeList.length,
        rules: ruleList.length,
        rule_terms: termTotal,
        rule_term_types: typeTotal,
        sources: sourceList.length,
        links: linkList.length,
    };
    const disagreements = Object.keys(delivered)
        .filter((name) => stated[name] !== delivered[name])
        .map((name) => `${name}: Kopf ${String(stated[name] ?? "fehlt")}, Liste ${String(delivered[name])}`);
    if (disagreements.length > 0) {
        return skip(
            [
                createFinding(
                    "source_counts_disagree",
                    `Die Kopfzähler der Antwort passen nicht zu den gelieferten Listen (${disagreements.join("; ")}): die Quelle ist unvollständig, der Schritt schreibt nichts und legt nichts still, der Lauf geht weiter`,
                    { abweichungen: disagreements.length },
                    [],
                    0,
                    disagreements,
                ),
            ],
            withheldKinds,
        );
    }

    const findings: Finding[] = [];
    const revision = {
        map: integerOf(bag["map_revision"]),
        lore: typeof bag["lore_revision"] === "string" ? bag["lore_revision"] : null,
    };
    if (mapRevision !== null && revision.map !== null && revision.map !== mapRevision) {
        findings.push(
            createFinding(
                "source_revision_differs",
                `Die Revision der Lore-Antwort (${String(revision.map)}) weicht von der der map-features.json desselben Zuges (${String(mapRevision)}) ab: die Quellennummern der Verknüpfungen können auseinanderlaufen (Information)`,
                { lore: revision.map, karte: mapRevision },
            ),
        );
    }
    if (withheldKinds.length > 0 || withheldEntries > 0) {
        findings.push(
            createFinding(
                "kind_withheld",
                `Legacy hat ${withheldKinds.length > 0 ? `die Art(en) ${withheldKinds.join(", ")}` : "Arten"} abgeschaltet (Notaus je Art): ${String(withheldEntries)} Einträge samt Ortszeilen, Regeln und Quellen gehen nicht hinaus; die vorhandenen Zeilen dieser Art bleiben unberührt, nichts wird stillgelegt (Information; wer sie migrieren will, schaltet sie in Legacy an)`,
                { zurueckgehalten: withheldEntries, arten: withheldKinds.join(", ") },
            ),
        );
    }
    // 🔴 Eine Personenspalte liest der Import nie; der Befund nennt nur den Namen des Schlüssels.
    const personal = new Set<string>();
    for (const list of [entryList, placeList, ruleList, sourceList, linkList]) {
        for (const item of list) {
            if (!isBag(item)) continue;
            for (const key of PERSONAL_KEYS) if (key in item) personal.add(key);
            if (Array.isArray(item["terms"])) {
                for (const term of item["terms"]) {
                    if (!isBag(term)) continue;
                    for (const key of PERSONAL_KEYS) if (key in term) personal.add(key);
                }
            }
        }
    }
    if (personal.size > 0) {
        findings.push(
            createFinding(
                "personal_column_in_export",
                `Die Antwort trägt personenbezogene Schlüssel (${[...personal].sort().join(", ")}); der Import liest sie nie und speichert keinen Wert (nur der Name steht hier)`,
                { schluessel: [...personal].sort().join(", ") },
            ),
        );
    }

    const unusable: Record<string, FindingObject[]> = {};
    const bad = (code: string, object: FindingObject): void => {
        (unusable[code] ??= []).push(object);
    };
    const exceeds: FindingObject[] = [];
    const overLimit = (value: string | null, limit: number, ref: FindingObject, field: string): void => {
        if (value !== null && [...value].length > limit) exceeds.push({ ...ref, name: `${ref.name ?? ""} (${field})` });
    };
    const schemeRejected: FindingObject[] = [];

    // ---- Einträge ---------------------------------------------------------------------------------------------------------------
    const entries: EntryRow[] = [];
    const entryByKey = new Map<string, EntryRow>();
    const markup: FindingObject[] = [];
    const continentEmpty: Record<string, number> = {};
    const continentValues: Record<string, number> = {};
    const unknownFieldOrigins: FindingObject[] = [];
    const unknownOrigins: FindingObject[] = [];
    const merkmaleKeys: Record<string, Record<string, number>> = {};
    const withMerkmale: Record<string, number> = {};
    const negation: FindingObject[] = [];
    const doubleLink: FindingObject[] = [];
    let matchKeyBlank = 0;
    for (const item of entryList) {
        if (!isBag(item)) {
            bad("entry_wiki_key_invalid", { table: "lore_entry", publicId: "", name: null });
            continue;
        }
        const rawKey = item["wiki_key"];
        const wikiKey = typeof rawKey === "string" && rawKey.trim() !== "" ? rawKey : null;
        const name = typeof item["name"] === "string" && item["name"].trim() !== "" ? item["name"] : null;
        if (wikiKey === null) {
            bad("entry_wiki_key_invalid", { table: "lore_entry", publicId: String(rawKey ?? ""), name });
            continue;
        }
        const kind = LORE_KINDS.find((candidate) => candidate === item["kind"]);
        if (kind === undefined) {
            bad("kind_unknown", { table: "lore_entry", publicId: wikiKey, name });
            continue;
        }
        const status = item["status"];
        const state: SourceState | null =
            status === "active" || status === "suppressed" || status === "retired" ? status : null;
        if (state === null) {
            bad("status_value_unknown", { table: "lore_entry", publicId: wikiKey, name });
            continue;
        }
        if (name === null) {
            bad("entry_name_invalid", { table: "lore_entry", publicId: wikiKey, name: null });
            continue;
        }
        if (entryByKey.has(wikiKey)) {
            bad("entry_duplicate_key", { table: "lore_entry", publicId: wikiKey, name });
            continue;
        }
        const ref: FindingObject = { table: "lore_entry", publicId: wikiKey, name };
        const rawOrigin = item["origin"];
        const legacyOrigin: EntryOrigin =
            typeof rawOrigin === "string" && ENTRY_ORIGINS.includes(rawOrigin) ? (rawOrigin as EntryOrigin) : "unknown";
        if (rawOrigin !== undefined && rawOrigin !== null && legacyOrigin === "unknown") unknownOrigins.push(ref);

        let wikiUrl = textOf(item["wiki_url"]);
        if (wikiUrl !== null && !/^https?:\/\//i.test(wikiUrl)) {
            schemeRejected.push(ref);
            wikiUrl = null;
        }
        const row: EntryRow = {
            wikiKey,
            kind,
            name,
            wikiTitle: textOf(item["wiki_title"]),
            wikiUrl,
            gruppe: textOf(item["gruppe"]),
            typ: textOf(item["typ"]),
            lebensraum: textOf(item["lebensraum"]),
            synonyme: textOf(item["synonyme"]),
            continent: textOf(item["continent"]),
            matchKey: textOf(item["match_key"]),
            legacyOrigin,
            state,
            fieldOrigins: [],
        };
        overLimit(wikiKey, LIMITS.wiki_key, ref, "wiki_key");
        overLimit(row.name, LIMITS.name, ref, "name");
        overLimit(row.wikiTitle, LIMITS.wiki_title, ref, "wiki_title");
        overLimit(row.wikiUrl, LIMITS.wiki_url, ref, "wiki_url");
        overLimit(row.gruppe, LIMITS.gruppe, ref, "gruppe");
        overLimit(row.typ, LIMITS.typ, ref, "typ");
        overLimit(row.lebensraum, LIMITS.lebensraum, ref, "lebensraum");
        overLimit(row.synonyme, LIMITS.synonyme, ref, "synonyme");
        overLimit(row.continent, LIMITS.continent, ref, "continent");
        overLimit(row.matchKey, LIMITS.match_key, ref, "match_key");
        if (hasWikitextResidue(row.name)) markup.push(ref);
        if (row.matchKey === null) matchKeyBlank += 1;
        if (row.continent === null) continentEmpty[kind] = (continentEmpty[kind] ?? 0) + 1;
        else continentValues[row.continent] = (continentValues[row.continent] ?? 0) + 1;

        // Herkunft je Feld: die Karte kommt als Objekt oder als JSON-Text; `merkmale_json` heißt hier `merkmale`.
        const origins = bagOf(item["field_origins"]);
        if (origins !== null) {
            for (const [rawField, origin] of Object.entries(origins)) {
                const field = rawField === "merkmale_json" ? "merkmale" : rawField;
                if (!(ENTRY_FIELD_ORIGIN_FIELDS as readonly string[]).includes(field)) continue;
                if (origin === "wiki" || origin === "manual") {
                    if (!row.fieldOrigins.some((known) => known.field === field)) {
                        row.fieldOrigins.push({ field, origin });
                    }
                } else {
                    unknownFieldOrigins.push(ref);
                }
            }
        }
        // Merkmale: nicht übernommen (das öffentliche Panel zeigt keinen Merkmalswert), nur gezählt.
        const merkmale = bagOf(item["merkmale"]);
        if (merkmale !== null) {
            withMerkmale[kind] = (withMerkmale[kind] ?? 0) + 1;
            const census = (merkmaleKeys[kind] ??= {});
            for (const key of Object.keys(merkmale)) census[key] = (census[key] ?? 0) + 1;
            const placeTexts = ORT_FELDER.map((field) => merkmale[field]).filter(
                (value): value is string => typeof value === "string",
            );
            if (placeTexts.some((text) => text.includes("[[") && NEGATION.test(text))) negation.push(ref);
            if (placeTexts.some((text) => DOUBLE_LINK.test(text))) doubleLink.push(ref);
        }
        entries.push(row);
        entryByKey.set(wikiKey, row);
    }

    // ---- Ortszeilen -------------------------------------------------------------------------------------------------------------
    const places: PlaceRow[] = [];
    const seenPlaces = new Set<string>();
    const relationUnknown: FindingObject[] = [];
    const manualRows: FindingObject[] = [];
    const tombstones: Record<string, number> = {};
    const duplicatePlaces: FindingObject[] = [];
    const pathOnlyRows: FindingObject[] = [];
    /** Ortszeilen, die der Lookup anders auflöst als das Vergleichsmaß (Träger über D6 und `territory.wiki_key`): was nur das Maß trifft, was nur der Lookup. */
    const differs: { ref: FindingObject; only: LoreHit[]; added: LoreHit[] }[] = [];
    for (const item of placeList) {
        if (!isBag(item)) {
            bad("place_row_unusable", { table: "lore_place", publicId: "", name: null });
            continue;
        }
        const entryKey = typeof item["entry_wiki_key"] === "string" ? item["entry_wiki_key"] : "";
        const entry = entryByKey.get(entryKey);
        const rawPlaceKey = item["place_wiki_key"];
        const placeKey = typeof rawPlaceKey === "string" && rawPlaceKey.trim() !== "" ? rawPlaceKey : null;
        const label = `${entry?.name ?? entryKey} / ${placeKey ?? "(ohne Schlüssel)"}`;
        if (entry === undefined) {
            bad("place_without_entry", { table: "lore_place", publicId: entryKey, name: label });
            continue;
        }
        if (placeKey === null) {
            bad("place_key_invalid", { table: "lore_place", publicId: entryKey, name: label });
            continue;
        }
        const sortOrder = integerOf(item["sort_order"]);
        const status = item["status"];
        const state: SourceState | null =
            status === "active" ? "active" : status === "suppressed" ? "suppressed" : null;
        if (sortOrder === null || state === null) {
            bad("place_row_unusable", { table: "lore_place", publicId: entryKey, name: label });
            continue;
        }
        const ref: FindingObject = { table: "lore_place", publicId: entryKey, name: label };
        const rawRelation = item["relation"];
        const relation = LORE_RELATIONS.find((candidate) => candidate === rawRelation);
        if (relation === undefined) relationUnknown.push(ref);
        const identity = `${entryKey}|${placeKey}|${relation ?? "verbreitung"}`;
        if (seenPlaces.has(identity)) {
            duplicatePlaces.push(ref);
            continue;
        }
        seenPlaces.add(identity);
        const rawOrigin = item["origin"];
        const legacyOrigin: EntryOrigin =
            typeof rawOrigin === "string" && ENTRY_ORIGINS.includes(rawOrigin) ? (rawOrigin as EntryOrigin) : "unknown";
        if (rawOrigin !== undefined && rawOrigin !== null && legacyOrigin === "unknown") unknownOrigins.push(ref);
        const placeTitle = textOf(item["place_title"]);
        overLimit(placeKey, LIMITS.place_wiki_key, ref, "place_wiki_key");
        overLimit(placeTitle, LIMITS.place_title, ref, "place_title");
        const resolution = resolveLorePlace(placeKey, lookups.wikiKeys, lookups.carrierIds);
        if (resolution.pathOnly) pathOnlyRows.push(ref);
        const carriers = resolveLorePlaceByCarriers(placeKey, lookups.targets);
        const wanted = new Set(resolution.hits.map((hit) => `${hit.column}:${hit.id}`));
        const old = new Set(carriers.hits.map((hit) => `${hit.column}:${hit.id}`));
        if (wanted.size !== old.size || [...wanted].some((key) => !old.has(key))) {
            differs.push({
                ref,
                only: carriers.hits.filter((hit) => !wanted.has(`${hit.column}:${hit.id}`)),
                added: resolution.hits.filter((hit) => !old.has(`${hit.column}:${hit.id}`)),
            });
        }
        places.push({
            entryWikiKey: entryKey,
            entryName: entry.name,
            placeWikiKey: placeKey,
            relation: relation ?? "verbreitung",
            placeTitle,
            sortOrder,
            keyClass: resolution.keyClass,
            targetState: resolution.state,
            hits: resolution.hits,
            legacyOrigin,
            state,
        });
        if (legacyOrigin === "manual") manualRows.push(ref);
        if (state === "suppressed") tombstones[entry.kind] = (tombstones[entry.kind] ?? 0) + 1;
    }

    // ---- Regeln -----------------------------------------------------------------------------------------------------------------
    const rules: RuleRow[] = [];
    const seenRules = new Set<string>();
    const duplicateRules: FindingObject[] = [];
    const tooManyTerms: FindingObject[] = [];
    const emptyTerms: FindingObject[] = [];
    const areaUnmatched: FindingObject[] = [];
    const climateUnknown: FindingObject[] = [];
    const typeUnknown: FindingObject[] = [];
    const typeLayerUnknown: FindingObject[] = [];
    const ruleStats = {
        terms: 0,
        withArea: 0,
        withTypes: 0,
        withClimate: 0,
        areaResolved: 0,
        climateResolved: 0,
        chains: 0,
    };
    for (const item of ruleList) {
        if (!isBag(item)) {
            bad("rule_row_unusable", { table: "lore_rule", publicId: "", name: null });
            continue;
        }
        const entryKey = typeof item["entry_wiki_key"] === "string" ? item["entry_wiki_key"] : "";
        const entry = entryByKey.get(entryKey);
        const ref: FindingObject = { table: "lore_rule", publicId: entryKey, name: entry?.name ?? entryKey };
        if (entry === undefined) {
            bad("rule_without_entry", ref);
            continue;
        }
        if (item["status"] !== "active") {
            bad("rule_status_not_active", ref);
            continue;
        }
        const sortOrder = integerOf(item["sort_order"]);
        if (sortOrder === null) {
            bad("rule_row_unusable", ref);
            continue;
        }
        const rawRelation = item["relation"];
        const relation = LORE_RELATIONS.find((candidate) => candidate === rawRelation);
        if (relation === undefined) relationUnknown.push(ref);
        const rawOrigin = item["origin"];
        const legacyOrigin: RuleOrigin =
            typeof rawOrigin === "string" && RULE_ORIGINS.includes(rawOrigin) ? (rawOrigin as RuleOrigin) : "unknown";
        if (rawOrigin !== undefined && rawOrigin !== null && legacyOrigin === "unknown") unknownOrigins.push(ref);
        const rawTerms = (Array.isArray(item["terms"]) ? item["terms"] : []).filter(isBag);
        if (rawTerms.length === 0) {
            bad("rule_without_terms", ref);
            continue;
        }
        if (rawTerms.length > RULE_MAX_TERMS) tooManyTerms.push(ref);
        // Die Reihenfolge der Bedingungen ist die Auswertungsreihenfolge: nach seq geordnet (stabil), seq verbatim, sonst die Stelle.
        const ordered = rawTerms
            .map((term, position) => ({ term, position, seq: integerOf(term["seq"]) }))
            .sort((a, b) => (a.seq ?? a.position) - (b.seq ?? b.position) || a.position - b.position);
        const seqs = ordered.map((entryTerm) => entryTerm.seq);
        const seqUsable = seqs.every((seq) => seq !== null && seq >= 0) && new Set(seqs).size === seqs.length;
        const terms: TermRow[] = [];
        const keyInput: RuleTermKeyInput[] = [];
        ordered.forEach(({ term, seq }, position) => {
            const joinOp = term["join_op"] === "oder" ? "oder" : "und";
            const rawArea = textOf(term["area_public_id"]);
            const area = rawArea === null ? null : rawArea.trim();
            const region = area === null ? undefined : lookups.regions.get(area.toLowerCase());
            const areaRegionId = region !== undefined && region.active ? region.id : null;
            if (area !== null && areaRegionId === null) areaUnmatched.push(ref);
            const rawFrom = textOf(term["climate_from"]);
            const rawTo = textOf(term["climate_to"]);
            const climateKnown =
                rawFrom !== null &&
                rawTo !== null &&
                lookups.climateKeys.has(rawFrom.trim()) &&
                lookups.climateKeys.has(rawTo.trim());
            if ((rawFrom !== null || rawTo !== null) && !climateKnown) climateUnknown.push(ref);
            const types: { layer: RuleLayer; type: string }[] = [];
            const typeSeen = new Set<string>();
            for (const rawType of Array.isArray(term["region_types"]) ? term["region_types"] : []) {
                if (!isBag(rawType)) continue;
                const layer = RULE_LAYERS.find((candidate) => candidate === rawType["kind"]);
                const typeName = textOf(rawType["region_type"]);
                if (layer === undefined || typeName === null) {
                    typeLayerUnknown.push(ref);
                    continue;
                }
                const pair = `${layer}|${typeName}`;
                if (typeSeen.has(pair)) continue;
                typeSeen.add(pair);
                types.push({ layer, type: typeName });
                if (!lookups.regionTypes.has(pair)) typeUnknown.push(ref);
            }
            types.sort((a, b) => a.layer.localeCompare(b.layer) || a.type.localeCompare(b.type));
            if (area === null && types.length === 0 && rawFrom === null && rawTo === null) emptyTerms.push(ref);
            ruleStats.terms += 1;
            if (area !== null) ruleStats.withArea += 1;
            if (areaRegionId !== null) ruleStats.areaResolved += 1;
            if (types.length > 0) ruleStats.withTypes += 1;
            if (rawFrom !== null || rawTo !== null) ruleStats.withClimate += 1;
            if (climateKnown) ruleStats.climateResolved += 1;
            terms.push({
                seq: seqUsable && seq !== null ? seq : position,
                joinOp,
                areaRegionId,
                legacyAreaPublicId: area,
                climateFrom: climateKnown ? (rawFrom as string).trim() : null,
                climateTo: climateKnown ? (rawTo as string).trim() : null,
                legacyClimateFrom: rawFrom,
                legacyClimateTo: rawTo,
                types,
            });
            keyInput.push({
                joinOp,
                areaPublicId: area,
                climateFrom: rawFrom,
                climateTo: rawTo,
                types: types.map((type) => ({ layer: type.layer, type: type.type })),
            });
        });
        const ruleRelation = relation ?? "verbreitung";
        const ruleKey = ruleKeyOf(entryKey, ruleRelation, keyInput);
        const identity = `${entryKey}|${ruleKey}`;
        if (seenRules.has(identity)) {
            duplicateRules.push(ref);
            continue;
        }
        seenRules.add(identity);
        if (terms.length > 1) ruleStats.chains += 1;
        rules.push({
            entryWikiKey: entryKey,
            entryName: entry.name,
            ruleKey,
            relation: ruleRelation,
            sortOrder,
            legacyOrigin,
            terms,
        });
    }

    // ---- Quellen: der Katalog der Antwort, dann die Verknüpfungen --------------------------------------------------------------------
    const catalog = new Map<number, { sourceKey: string; label: string }>();
    const hashMismatch: FindingObject[] = [];
    const provisional: FindingObject[] = [];
    for (const item of sourceList) {
        if (!isBag(item)) continue;
        const id = integerOf(item["id"]);
        if (id === null) continue;
        const url = textOf(item["url"]);
        const wikiKey = textOf(item["wiki_key"]);
        const identity = catalogSourceIdentity(String(id), { url, wiki_key: wikiKey });
        if (identity === null) continue;
        const label = textOf(item["label"]) ?? url ?? wikiKey ?? String(id);
        const ref: FindingObject = { table: "feature_source", publicId: identity.sourceKey, name: label };
        // Legacys url_hash ist die Identität: SHA-256 der Adresse, bei URL-losen Quellen von `wikipub:<wiki_key>`.
        const stateHash = typeof item["url_hash"] === "string" ? item["url_hash"].trim().toLowerCase() : "";
        const computed =
            url !== null
                ? urlHash(url)
                : wikiKey !== null
                  ? createHash("sha256").update(`wikipub:${wikiKey}`, "utf8").digest("hex")
                  : "";
        if (stateHash !== "" && computed !== "" && stateHash !== computed) hashMismatch.push(ref);
        if (identity.identityState === "provisional") provisional.push(ref);
        catalog.set(id, { sourceKey: identity.sourceKey, label });
    }
    const links: LinkRow[] = [];
    const seenLinks = new Set<string>();
    const collapsed: FindingObject[] = [];
    const sourceUnresolved: FindingObject[] = [];
    const sourceKindEmpty: FindingObject[] = [];
    const noteMarkup: FindingObject[] = [];
    const unknownReferenceKind: FindingObject[] = [];
    const positionByEntry = new Map<string, number>();
    for (const item of linkList) {
        if (!isBag(item)) {
            bad("lore_link_unusable", { table: "lore_entry_source", publicId: "", name: null });
            continue;
        }
        const entryKey = typeof item["entity_public_id"] === "string" ? item["entity_public_id"] : "";
        const entry = entryByKey.get(entryKey);
        const ref: FindingObject = { table: "lore_entry_source", publicId: entryKey, name: entry?.name ?? entryKey };
        if (item["entity_type"] !== undefined && item["entity_type"] !== "lore") {
            bad("lore_link_unusable", ref);
            continue;
        }
        if (entry === undefined) {
            bad("lore_link_orphan", ref);
            continue;
        }
        const status = item["status"];
        const state: SourceState | null =
            status === "approved" ? "active" : status === "suppressed" ? "suppressed" : null;
        if (state === null) {
            bad("link_status_unknown", ref);
            continue;
        }
        const sourceNumber = integerOf(item["source_id"]);
        const source = sourceNumber === null ? undefined : catalog.get(sourceNumber);
        const sourceId = source === undefined ? undefined : lookups.sources.get(source.sourceKey);
        if (source === undefined || sourceId === undefined) {
            sourceUnresolved.push({
                ...ref,
                name: `${ref.name ?? ""} / ${source?.label ?? String(item["source_id"])}`,
            });
            continue;
        }
        const pairKey = `${entryKey}|${sourceId}`;
        if (seenLinks.has(pairKey)) {
            collapsed.push(ref);
            continue;
        }
        seenLinks.add(pairKey);
        const rawKind = typeof item["reference_kind"] === "string" ? item["reference_kind"].trim() : "";
        let referenceKind: LinkRow["referenceKind"] = null;
        if (rawKind === "") sourceKindEmpty.push(ref);
        else if (REFERENCE_KINDS.includes(rawKind)) referenceKind = rawKind as LinkRow["referenceKind"];
        else unknownReferenceKind.push(ref);
        const rawOrigin = item["origin"];
        const legacyOrigin: LinkOrigin =
            typeof rawOrigin === "string" && LINK_ORIGINS.includes(rawOrigin) ? (rawOrigin as LinkOrigin) : "unknown";
        if (rawOrigin !== undefined && rawOrigin !== null && legacyOrigin === "unknown") unknownOrigins.push(ref);
        const pages = textOf(item["pages"]);
        const note = textOf(item["note"]);
        overLimit(pages, LIMITS.pages, ref, "pages");
        overLimit(note, LIMITS.note, ref, "note");
        if (note !== null && /\{\{|\[\[/.test(note)) noteMarkup.push(ref);
        const ordinal = positionByEntry.get(entryKey) ?? 0;
        positionByEntry.set(entryKey, ordinal + 1);
        const position = integerOf(item["position"]);
        links.push({
            entryWikiKey: entryKey,
            entryName: entry.name,
            sourceId,
            referenceKind,
            pages,
            note,
            legacyOrigin,
            position: position !== null && position >= 0 ? position : ordinal,
            state,
        });
    }

    // ---- Befunde ----------------------------------------------------------------------------------------------------------------
    const simple = (
        code: string,
        message: string,
        objects: FindingObject[],
        numbers: Record<string, number | string> = {},
    ): void => {
        if (objects.length > 0)
            findings.push(createFinding(code, message, { zeilen: objects.length, ...numbers }, objects));
    };
    const unusableMessages: Record<string, string> = {
        entry_wiki_key_invalid: "Einträge ohne lesbaren wiki_key; nicht speicherbar, ausgelassen",
        kind_unknown:
            "Einträge mit einer Art ausserhalb von fauna, flora, spezies, ware; nicht speicherbar, ausgelassen",
        status_value_unknown:
            "Einträge mit einem Status ausserhalb von active, suppressed, retired; nicht speicherbar, ausgelassen",
        entry_name_invalid: "Einträge ohne Namen; nicht speicherbar, ausgelassen",
        entry_duplicate_key: "Einträge mit einem wiki_key, den die Antwort schon einmal nennt; der erste gilt",
        place_row_unusable:
            "Ortszeilen ohne lesbare Position oder mit einem Status ausserhalb von active und suppressed; nicht speicherbar, ausgelassen",
        place_without_entry:
            "Ortszeilen, deren Eintrag nicht in der Antwort steht (oder nicht speicherbar ist); nicht gespeichert",
        place_key_invalid: "Ortszeilen ohne lesbaren place_wiki_key; nicht gespeichert",
        rule_row_unusable: "Regeln ohne lesbare Position; nicht gespeichert",
        rule_without_entry:
            "Regeln, deren Eintrag nicht in der Antwort steht (oder nicht speicherbar ist); nicht gespeichert",
        rule_status_not_active: "Regeln, deren Status nicht active ist; nicht gespeichert",
        rule_without_terms: "Regeln ohne Bedingung; nicht gespeichert (Legacy rechnet sie zu „trifft nichts“)",
        lore_link_unusable:
            "Quellenverknüpfungen ohne lesbare Form oder mit einer anderen Art als lore; nicht gespeichert",
        lore_link_orphan: "Quellenverknüpfungen zu einem Eintrag, der nicht in der Antwort steht; keine Zeile",
        link_status_unknown:
            "Quellenverknüpfungen mit einem Status ausserhalb von approved und suppressed; nicht gespeichert",
    };
    for (const [code, message] of Object.entries(unusableMessages)) {
        simple(code, `${String(unusable[code]?.length ?? 0)} ${message}`, unusable[code] ?? []);
    }
    simple(
        "origin_value_unknown",
        `${String(unknownOrigins.length)} Zeilen mit einer Herkunft ausserhalb der Listen; gespeichert als unknown`,
        unknownOrigins,
    );
    simple(
        "field_origin_unknown",
        `${String(unknownFieldOrigins.length)} Herkunftswerte ausserhalb von wiki und manual; nicht gespeichert (ein fehlender Eintrag heisst nie wiki)`,
        unknownFieldOrigins,
    );
    simple(
        "link_scheme_rejected",
        `${String(schemeRejected.length)} Wiki-Adressen ohne http oder https; nicht gespeichert (der Leser gibt nur Adressen auf de.wiki-aventurica.de als Link aus)`,
        schemeRejected,
    );
    simple(
        "text_exceeds_legacy_limit",
        `${String(exceeds.length)} Texte über Legacys Spaltenbreite; unverändert gespeichert`,
        exceeds,
    );
    simple(
        "entry_name_markup",
        `${String(markup.length)} Namen mit Wikimarkup ([[ ]], { }); nicht repariert (Cutoff-Regel)`,
        markup,
    );
    simple(
        "relation_unknown",
        `${String(relationUnknown.length)} Zeilen mit einer Beziehung ausserhalb von verbreitung, vorkommen, herkunft, regionen; gespeichert als verbreitung (wie Legacy)`,
        relationUnknown,
    );
    simple(
        "place_duplicate_key",
        `${String(duplicatePlaces.length)} Ortszeilen mit gleichem (Eintrag, Schlüssel, Beziehung); eine Zeile`,
        duplicatePlaces,
    );
    simple(
        "place_manual_row",
        `${String(manualRows.length)} von Hand hinzugefügte Ortszeilen (origin manual, sort_order 9999); Information`,
        manualRows,
    );
    simple(
        "rule_duplicate_content",
        `${String(duplicateRules.length)} Regeln mit gleichem Inhalt (gleicher rule_key) in einem Eintrag; eine Zeile`,
        duplicateRules,
    );
    simple(
        "rule_too_many_terms",
        `${String(tooManyTerms.length)} Regeln mit mehr als ${String(RULE_MAX_TERMS)} Bedingungen; gespeichert`,
        tooManyTerms,
    );
    simple(
        "rule_term_empty",
        `${String(emptyTerms.length)} Bedingungen ohne Fläche, Art und Klima: sie trifft alles und ist in Legacy ein Versehen; gespeichert`,
        emptyTerms,
    );
    simple(
        "rule_area_unmatched",
        `${String(areaUnmatched.length)} Bedingungen, deren Fläche keine aktive Region trifft (inaktiv oder fehlt); die Bedingung bleibt, die Kennung steht als Text`,
        areaUnmatched,
    );
    simple(
        "rule_climate_unknown_key",
        `${String(climateUnknown.length)} Bedingungen mit einem Klimaendpunkt ohne Zone oder nur einem Endpunkt (in Legacy „keine Einschränkung“); beide Fremdschlüssel NULL, die Legacy-Werte stehen als Text`,
        climateUnknown,
    );
    simple(
        "rule_type_unknown",
        `${String(typeUnknown.length)} Landschaftsarten (Ebene und Art), die keine aktive Region trägt`,
        typeUnknown,
    );
    simple(
        "rule_type_kind_unknown",
        `${String(typeLayerUnknown.length)} Landschaftsarten ohne lesbare Ebene oder Art; nicht gespeichert`,
        typeLayerUnknown,
    );
    simple(
        "lore_source_unresolved",
        `${String(sourceUnresolved.length)} Quellenverknüpfungen, deren Quelle der Katalog von D1 (Schritt I18) nicht trägt; keine Verknüpfung`,
        sourceUnresolved,
    );
    simple(
        "lore_source_links_collapsed",
        `${String(collapsed.length)} Quellenverknüpfungen mit gleichem (Eintrag, Quelle) zu einer Zeile zusammengefasst`,
        collapsed,
    );
    simple(
        "lore_source_kind_unexpected",
        `${String(sourceKindEmpty.length)} Quellenverknüpfungen ohne Publikationsart: eine echte Quelle statt einer Publikation (Information)`,
        sourceKindEmpty,
    );
    simple(
        "reference_kind_unknown",
        `${String(unknownReferenceKind.length)} Quellenverknüpfungen mit einer Publikationsart ausserhalb von ausfuehrlich, ergaenzend, erwaehnung; gespeichert als echte Quelle`,
        unknownReferenceKind,
    );
    simple(
        "source_note_markup",
        `${String(noteMarkup.length)} Notizen von Quellenverknüpfungen mit Rohmarkup ({{R5}} nennt die Regeledition, [[ ]]); nicht repariert`,
        noteMarkup,
    );
    simple(
        "lore_source_hash_mismatch",
        `${String(hashMismatch.length)} Katalogzeilen, deren url_hash nicht zu Adresse oder wiki_key passt (Information; die Identität folgt Adresse und wiki_key)`,
        hashMismatch,
    );
    simple(
        "lore_source_provisional",
        `${String(provisional.length)} Katalogzeilen ohne Adresse und ohne wiki_key: nur die vorläufige Identität legacy-id:<id> trägt (gilt nur im Zug von D1)`,
        provisional,
    );

    // Einträge nach Zustand und ihre Teile.
    const inactive = entries.filter((entry) => entry.state !== "active");
    if (inactive.length > 0) {
        findings.push(
            createFinding(
                "entry_retired_or_suppressed",
                `${String(inactive.length)} Einträge mit Status retired oder suppressed; im öffentlichen Lesepfad nicht sichtbar (Information)`,
                { ...countBy(inactive, (entry) => `${entry.kind}/${entry.state}`) },
                inactive.map(entryObject),
            ),
        );
    }
    const activePlaces = new Set(places.filter((place) => place.state === "active").map((place) => place.entryWikiKey));
    const withoutPlaces = entries.filter((entry) => entry.state === "active" && !activePlaces.has(entry.wikiKey));
    if (withoutPlaces.length > 0) {
        findings.push(
            createFinding(
                "entry_without_places",
                `${String(withoutPlaces.length)} aktive Einträge ohne aktive Ortszeile (bei den Waren etwa die Hälfte; Information)`,
                { ...countBy(withoutPlaces, (entry) => entry.kind) },
                withoutPlaces.map(entryObject),
            ),
        );
    }
    const linked = new Set(links.filter((link) => link.state === "active").map((link) => link.entryWikiKey));
    const withoutSource = entries.filter((entry) => entry.state === "active" && !linked.has(entry.wikiKey));
    if (withoutSource.length > 0) {
        findings.push(
            createFinding(
                "entry_without_source",
                `${String(withoutSource.length)} aktive Einträge ohne aktive Quelle (Information)`,
                { ...countBy(withoutSource, (entry) => entry.kind) },
                withoutSource.map(entryObject),
            ),
        );
    }
    if (Object.keys(continentEmpty).length > 0) {
        findings.push(
            createFinding(
                "continent_empty",
                `Einträge ohne continent („nicht erkannt“, Legacy behandelt es wie Aventurien): ${Object.entries(
                    continentEmpty,
                )
                    .map(([kind, n]) => `${kind} ${String(n)}`)
                    .join(", ")}; gesetzte Werte: ${topLines(continentValues, 8).join(", ") || "keine"} (Information)`,
                { ...continentEmpty },
            ),
        );
    }
    if (matchKeyBlank > 0) {
        findings.push(
            createFinding(
                "match_key_missing",
                `${String(matchKeyBlank)} Einträge ohne match_key; die Warenauflösung freier Handelswarennamen (P8) hat für sie keine Grundlage. match_key ist Legacys gespeicherter Wert und kann nach einer Umbenennung veraltet sein (Information)`,
                { einträge: matchKeyBlank },
            ),
        );
    }
    if (Object.keys(merkmaleKeys).length > 0) {
        const flat: Record<string, number> = {};
        for (const [kind, census] of Object.entries(merkmaleKeys)) {
            for (const [key, n] of Object.entries(census)) flat[`${kind}.${key}`] = n;
        }
        findings.push(
            createFinding(
                "merkmale_census",
                `Merkmale der Infobox, nicht übernommen: ${Object.entries(withMerkmale)
                    .map(([kind, n]) => `${kind} ${String(n)}`)
                    .join(
                        ", ",
                    )} Einträge tragen welche, ${String(Object.keys(flat).length)} verschiedene Schlüssel je Art (Information für die Frage, welche später typisiert werden)`,
                { ...withMerkmale, schluessel: Object.keys(flat).length },
                [],
                0,
                topLines(flat, 40),
            ),
        );
    }
    simple(
        "negation_in_source_text",
        `${String(negation.length)} Einträge, deren Rohtext von Verbreitung, Herkunft oder Regionen eine Negation neben einem Link trägt: die Ausnahme ist nicht verlinkt und geht verloren, wie im Wiki selbst (Information)`,
        negation,
    );
    simple(
        "double_link_in_source_text",
        `${String(doubleLink.length)} Einträge mit zwei Wikilinks ohne Trenner, durch ein Wortstück verbunden ([[Schaf]]s[[wolle]]): in der Quelle zwei Ortszeilen (Information)`,
        doubleLink,
    );

    // Tombstones, Kontinentzeilen, Auflösung.
    if (Object.keys(tombstones).length > 0) {
        findings.push(
            createFinding(
                "place_tombstone",
                `${String(Object.values(tombstones).reduce((sum, n) => sum + n, 0))} Grabsteine (von Hand entfernte Wiki-Ortszeilen, suppressed); gespeichert, folgen bei jedem Zug dem Stand der Quelle (kehren zurück, wenn Legacy sie wieder führt)`,
                { ...tombstones },
            ),
        );
    }
    const totals: LoreTransform["totals"] = {
        places: { resolved: 0, ambiguous: 0, unresolved: 0, unmatched: 0 },
        targets: 0,
    };
    for (const place of places) {
        totals.places[place.targetState] += 1;
        totals.targets += place.hits.length;
    }
    const placeObject = (place: PlaceRow): FindingObject => ({
        table: "lore_place",
        publicId: place.entryWikiKey,
        name: `${place.entryName} / ${place.placeWikiKey}`,
    });
    const kindOfEntry = (place: PlaceRow): string => entryByKey.get(place.entryWikiKey)?.kind ?? "?";
    const continentRows = places.filter((place) => place.keyClass === "continent");
    if (continentRows.length > 0) {
        findings.push(
            createFinding(
                "place_continent_rows",
                `${String(continentRows.length)} Ortszeilen mit einem Kontinentbegriff als Schlüssel (Rang 3 beim Lesen, nie verworfen): ${topLines(
                    countBy(continentRows, (place) => place.placeWikiKey),
                    9,
                ).join(", ")}`,
                { ...countBy(continentRows, (place) => bareLoreKey(place.placeWikiKey)) },
            ),
        );
    }
    const unresolvedContinent = places.filter((place) => place.targetState === "unresolved");
    if (unresolvedContinent.length > 0) {
        findings.push(
            createFinding(
                "place_unresolved_continent",
                `${String(unresolvedContinent.length)} Kontinentbegriffe ohne Träger („gilt überall“, kein Objekt gemeint); Rohschlüssel und Titel bleiben`,
                { zeilen: unresolvedContinent.length },
            ),
        );
    }
    const unmatched = places.filter((place) => place.targetState === "unmatched");
    if (unmatched.length > 0) {
        findings.push(
            createFinding(
                "place_unmatched",
                `${String(unmatched.length)} Ortszeilen, deren Schlüssel kein aktiver Träger trägt (der Artikel hat kein Kartenobjekt, oder der Träger ist inaktiv); Rohschlüssel und Titel bleiben, bei jedem Lauf neu aufgelöst`,
                { zeilen: unmatched.length, ...countBy(unmatched, kindOfEntry) },
                unmatched.slice(0, 200).map(placeObject),
                unmatched.length,
                topLines(
                    countBy(unmatched, (place) => place.placeWikiKey),
                    15,
                ),
            ),
        );
    }
    const ambiguous = places.filter((place) => place.targetState === "ambiguous");
    if (ambiguous.length > 0) {
        const combos = countBy(
            ambiguous,
            (place) =>
                [...new Set(place.hits.map((hit) => hitKindLabel(hit.column)))].sort().join(" und ") +
                (new Set(place.hits.map((hit) => hit.column)).size === 1 ? " (mehrere)" : ""),
        );
        findings.push(
            createFinding(
                "place_target_ambiguous",
                `${String(ambiguous.length)} Ortszeilen, deren Schlüssel mehrere aktive Träger tragen (${Object.entries(
                    combos,
                )
                    .map(([key, n]) => `${key} ${String(n)}`)
                    .join(", ")}); ALLE gespeichert, keiner ausgezeichnet`,
                { zeilen: ambiguous.length, ...combos },
                ambiguous.slice(0, 200).map(placeObject),
                ambiguous.length,
                topLines(
                    countBy(ambiguous, (place) => place.placeWikiKey),
                    15,
                ),
            ),
        );
    }
    if (pathOnlyRows.length > 0) {
        findings.push(
            createFinding(
                "place_key_matches_path_only",
                `${String(pathOnlyRows.length)} Ortszeilen, deren Schlüssel nur einen Weg oder eine Kraftlinie trifft; beide sind kein Zielraum der Lore (Information)`,
                { zeilen: pathOnlyRows.length },
                pathOnlyRows.slice(0, 200),
                pathOnlyRows.length,
            ),
        );
    }
    // Der Lookup der Oberfläche ist die Quelle der Auflösung. Ist er leer (die Zuordnung X2, Schritt I24, ist nicht importiert), bleibt jede Ortszeile
    // ohne Ziel und wird beim nächsten Lauf neu aufgelöst: das sagt dieser Befund, statt es als `place_unmatched` zu verstecken.
    if (lookups.wikiKeys.byKey.size === 0 && places.length > 0) {
        findings.push(
            createFinding(
                "wiki_key_lookup_empty",
                `Der Lookup nach Wiki-Key ist leer (die Zuordnung X2, Schritt I24, ist nicht importiert oder trägt keinen auflösbaren Träger): ${String(places.length)} Ortszeilen bleiben ohne Ziel und werden beim nächsten Lauf neu aufgelöst`,
                { zeilen: places.length },
            ),
        );
    }
    if (differs.length > 0 && lookups.wikiKeys.byKey.size > 0) {
        const kinds = (hits: readonly LoreHit[]): string[] => hits.map((hit) => hitKindLabel(hit.column));
        const causes: Record<string, number> = {};
        for (const entry of differs) {
            for (const kind of kinds(entry.only))
                causes[`nur_traegermodell_${kind}`] = (causes[`nur_traegermodell_${kind}`] ?? 0) + 1;
            for (const kind of kinds(entry.added))
                causes[`nur_lookup_${kind}`] = (causes[`nur_lookup_${kind}`] ?? 0) + 1;
        }
        findings.push(
            createFinding(
                "place_target_differs_from_carriers",
                `${String(differs.length)} Ortszeilen, die der Lookup der Oberfläche anders auflöst als das Vergleichsmaß über D6 und territory.wiki_key (${Object.entries(
                    causes,
                )
                    .map(([key, n]) => `${key} ${String(n)}`)
                    .join(
                        ", ",
                    )}); gespeichert ist die Auflösung des Lookups, nichts wird angeglichen (typisch: Gebiet ohne abgeleitete Form, verborgener Ort, Landschaft als Gruppe mit dem Anker als Ziel, Träger ohne Eintrag in X2)`,
                { zeilen: differs.length, ...causes },
                differs.slice(0, 200).map((entry) => entry.ref),
                differs.length,
            ),
        );
    }
    const other = places.filter((place) => place.keyClass === "other");
    if (other.length > 0) {
        const hit = other.filter((place) => place.hits.length > 0).length;
        findings.push(
            createFinding(
                "place_key_space_probe",
                `Trefferquote der Ortsschlüssel ohne Kontinentbegriffe: ${String(hit)} von ${String(other.length)} (${((hit / other.length) * 100).toFixed(1).replace(".", ",")} %) treffen mindestens einen aktiven Träger; eine sehr niedrige Quote zeigte eine abweichende Slug-Form von Legacy und den gespeicherten D6-Schlüsseln an (Information)`,
                {
                    zeilen: other.length,
                    treffer: hit,
                    aufgeloest: other.filter((place) => place.targetState === "resolved").length,
                    mehrdeutig: other.filter((place) => place.targetState === "ambiguous").length,
                    ohne_treffer: other.length - hit,
                },
            ),
        );
    }

    // Messbefund der Regeln (M1 Bestand, M2 Auflösbarkeit); M3 braucht Zugehörigkeitsdaten, die nicht migriert sind.
    if (rules.length > 0) {
        findings.push(
            createFinding(
                "rule_gain_measurement",
                `Regelbestand (M1): ${String(rules.length)} Regeln (${Object.entries(
                    countBy(rules, (rule) => rule.legacyOrigin),
                )
                    .map(([key, n]) => `${key} ${String(n)}`)
                    .join(
                        ", ",
                    )}), ${String(ruleStats.chains)} Ketten mit mehr als einer Bedingung; ${String(ruleStats.terms)} Bedingungen, davon ${String(ruleStats.withArea)} mit Fläche, ${String(ruleStats.withTypes)} mit Art, ${String(ruleStats.withClimate)} mit Klima. Auflösbarkeit (M2): ${String(ruleStats.areaResolved)} von ${String(ruleStats.withArea)} Flächen auf eine aktive Region, ${String(ruleStats.climateResolved)} von ${String(ruleStats.withClimate)} Klimaspannen auf Zonen. Gewinn (M3): nicht gemessen, er braucht die Zugehörigkeit von Flächen und Orten (Information, keine Prüfung)`,
                {
                    regeln: rules.length,
                    ketten: ruleStats.chains,
                    bedingungen: ruleStats.terms,
                    mit_flaeche: ruleStats.withArea,
                    flaeche_aufgeloest: ruleStats.areaResolved,
                    mit_art: ruleStats.withTypes,
                    mit_klima: ruleStats.withClimate,
                    klima_aufgeloest: ruleStats.climateResolved,
                },
            ),
        );
    }

    return { skipped: false, revision, withheldKinds, entries, places, rules, links, totals, findings };
}

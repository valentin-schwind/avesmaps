import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { buildWikiKeyLookupOnly } from "../subjects/subject-index.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { readTargetIndex } from "./catalog-places.ts";
import { syncReported, type ExpectedRow } from "./catalog-sync.ts";
import { LORE_KINDS, hitCells, resolveLorePlace, type LoreKind } from "./lore-keys.ts";
import {
    LORE_CONTRACT_VERSION,
    transformLore,
    type LinkRow,
    type LoreLookups,
    type LoreTransform,
    type PlaceRow,
    type RuleRow,
} from "./lore.ts";
import {
    emptyTableReport,
    pgArray,
    replaceChildren,
    type Cell,
    type ChildSyncResult,
    type Col,
    type SourceState,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";

/**
 * Schreibt Einträge, Ortszeilen samt Zielen, Regeln samt Bedingungen, Herkunftsvermerke und Quellenverknüpfungen der Lore idempotent
 * in die Zieldatenbank (WI-0063 P3, Vertrag `lore.yaml`, D5).
 *
 * EINE Transaktion für alles (Einträge, Ortszeilen, Ziele, Regeln, Verknüpfungen, Stilllegen), damit die Stilllegequote über den Satz
 * gilt. Der zweite Lauf findet nichts zu schreiben.
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück.
 * 🔴 Ist die Antwort unbrauchbar, leer, abgeschaltet oder passen die Kopfzähler nicht, schreibt der Schritt nichts, legt nichts still und
 * meldet den Befund (`source_block_missing` und Verwandte); der Lauf geht weiter (kein Tor).
 * 🔴 Die Zeilen einer von Legacy abgeschalteten Art (Notaus je Art) fasst der Lauf nie an und legt sie nie still.
 * 🔴 Der Schritt schreibt KEINE Medienzeile, keine Merkmale und keine Bilder.
 *
 * Reihenfolge im Lauf (Vertrag `idempotenz.reihenfolge_im_lauf`): erst die Einträge, dann Ortszeilen, Regeln und Verknüpfungen, dann die
 * Auflösung (sie steckt in den Zeilen der Orte und den Zielzeilen), dann das Stilllegen (in `syncTable`).
 */

export const LORE_TABLES = [
    "lore_entry",
    "lore_entry_field_origin",
    "lore_place",
    "lore_place_target",
    "lore_rule",
    "lore_rule_term",
    "lore_rule_term_type",
    "lore_entry_source",
] as const;
export type LoreTable = (typeof LORE_TABLES)[number];

export interface ImportLoreOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
    /** Die Revision der `map-features.json` desselben Zuges (für den Befund `source_revision_differs`). */
    mapRevision?: number | undefined;
}

export interface ImportLoreReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Die Antwort war unbrauchbar, leer, abgeschaltet oder widersprach ihren Zählern: nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    tables: Record<LoreTable, TableReport>;
    resolution: LoreTransform["totals"];
    withheldKinds: LoreKind[];
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });
const int = (name: string): Col => ({ name, type: "int" });
const bigint = (name: string): Col => ({ name, type: "bigint" });

export const ENTRY_COLUMNS: readonly Col[] = [
    text("wiki_key"),
    text("kind"),
    text("name"),
    text("wiki_title"),
    text("wiki_url"),
    text("gruppe"),
    text("typ"),
    text("lebensraum"),
    text("synonyme"),
    text("continent"),
    text("match_key"),
    text("legacy_origin"),
];

export const PLACE_COLUMNS: readonly Col[] = [
    bigint("lore_entry_id"),
    text("place_wiki_key"),
    text("relation"),
    text("place_title"),
    int("sort_order"),
    text("key_class"),
    text("target_state"),
    int("target_count"),
    text("legacy_origin"),
];

export const RULE_COLUMNS: readonly Col[] = [
    bigint("lore_entry_id"),
    text("rule_key"),
    text("relation"),
    int("sort_order"),
    text("legacy_origin"),
];

export const SOURCE_COLUMNS: readonly Col[] = [
    bigint("lore_entry_id"),
    bigint("source_id"),
    text("reference_kind"),
    text("pages"),
    text("note"),
    text("legacy_origin"),
    int("position"),
];

export const FIELD_ORIGIN_COLUMNS: readonly Col[] = [text("field"), text("origin")];
export const TARGET_COLUMNS: readonly Col[] = [
    bigint("place_id"),
    bigint("territory_id"),
    bigint("region_id"),
    bigint("terrain_peak_id"),
];

const first = (cells: readonly Cell[]): string => String(cells[0]);
const placeKey = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[1])}|${String(cells[2])}`;
const pair = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[1])}`;

/**
 * Eine Bedingung über `t` und die Alias `e` des Eintrags: ein Editor-Entscheid oder eine abgeschaltete Art hält die Zeile fest. Dazu zählt ein
 * Eintrag, den die Redaktion im Fenster „Inhalte bearbeiten“ angelegt oder geändert hat (`source_system = 'editor'`, WI-0254): Er gehört danach der
 * Redaktion samt Ortszeilen, Regeln, Quellenverknüpfungen und Herkunftsvermerken. Feldgenauer Schutz ist ein späteres Paket.
 */
function entryHeld(withheld: readonly LoreKind[], alias = "e"): string {
    // Die Arten kommen aus der festen Liste, nie aus der Antwort: kein Einfallstor.
    const kinds = withheld.filter((kind) => (LORE_KINDS as readonly string[]).includes(kind));
    const withheldClause =
        kinds.length > 0 ? ` OR ${alias}.kind IN (${kinds.map((kind) => `'${kind}'`).join(", ")})` : "";
    return `(NOT ${alias}.is_active AND ${alias}.retired_origin = 'editor') OR ${alias}.source_system = 'editor'${withheldClause}`;
}

const DESCRIBE_ENTRY = "JOIN lore_entry e ON e.id = t.lore_entry_id";

export function entrySpec(withheld: readonly LoreKind[]): SyncSpec {
    const kinds = withheld.filter((kind) => (LORE_KINDS as readonly string[]).includes(kind));
    return {
        table: "lore_entry",
        columns: ENTRY_COLUMNS,
        keyOf: first,
        sourceStates: true,
        retiredSet: "state = 'retired'",
        // Ein Eintrag der Redaktion (`source_system editor`, WI-0254) fasst der Zug weder an noch legt er ihn still; dazu eine abgeschaltete Art.
        protectedWhere:
            kinds.length > 0
                ? `t.source_system = 'editor' OR t.kind IN (${kinds.map((kind) => `'${kind}'`).join(", ")})`
                : "t.source_system = 'editor'",
        describe: { join: "", publicId: "COALESCE(t.wiki_key, t.public_id::text)", name: "t.name" },
    };
}

export function placeSpec(withheld: readonly LoreKind[]): SyncSpec {
    return {
        table: "lore_place",
        columns: PLACE_COLUMNS,
        keyOf: placeKey,
        sourceStates: true,
        retiredSet: "state = 'retired'",
        protectedWhere: `t.target_origin = 'editor' OR EXISTS (SELECT 1 FROM lore_entry e WHERE e.id = t.lore_entry_id AND ${entryHeld(withheld)})`,
        describe: {
            join: DESCRIBE_ENTRY,
            publicId: "COALESCE(e.wiki_key, e.public_id::text)",
            name: "e.name || ' / ' || COALESCE(t.place_wiki_key, t.place_title)",
        },
    };
}

export function ruleSpec(withheld: readonly LoreKind[]): SyncSpec {
    return {
        table: "lore_rule",
        columns: RULE_COLUMNS,
        keyOf: pair,
        activeSet: "state = 'active'",
        retiredSet: "state = 'retired'",
        insertConstants: { state: "'active'" },
        // Eine Regel, die der WikiSync aus den Regelvorschlägen übernommen hat (WI-0253 §24, `source_system = 'wikisync'`), steht nicht in Legacys Antwort und fasst der Zug nie an. Ebenso eine Regel der
        // Redaktion (`source_system = 'editor'`, Regeleditor im Reiter „Vorkommen“, WI-0254): Nur die Regel gehört ihr, nicht der Eintrag (Entscheidung Claudia zu WI-0253 §26). Eine Regel, die die Redaktion
        // still gelegt hat (`retired_origin = 'editor'`, auch eine aus Legacy), belebt der Zug nie wieder.
        protectedWhere: `t.source_system IN ('wikisync', 'editor') OR t.retired_origin = 'editor' OR EXISTS (SELECT 1 FROM lore_entry e WHERE e.id = t.lore_entry_id AND ${entryHeld(withheld)})`,
        describe: {
            join: DESCRIBE_ENTRY,
            publicId: "COALESCE(e.wiki_key, e.public_id::text)",
            name: "e.name || ' / ' || left(t.rule_key, 12)",
        },
    };
}

export function sourceSpec(withheld: readonly LoreKind[]): SyncSpec {
    return {
        table: "lore_entry_source",
        columns: SOURCE_COLUMNS,
        keyOf: pair,
        sourceStates: true,
        retiredSet: "state = 'retired'",
        protectedWhere: `EXISTS (SELECT 1 FROM lore_entry e WHERE e.id = t.lore_entry_id AND ${entryHeld(withheld)})`,
        describe: { join: DESCRIBE_ENTRY, publicId: "COALESCE(e.wiki_key, e.public_id::text)", name: "e.name" },
    };
}

/** Die Zellen einer Ortszeile (Reihenfolge von `PLACE_COLUMNS`). */
export function placeCells(entryId: string, row: PlaceRow): Cell[] {
    return [
        entryId,
        row.placeWikiKey,
        row.relation,
        row.placeTitle,
        row.sortOrder,
        row.keyClass,
        row.targetState,
        row.hits.length,
        row.legacyOrigin,
    ];
}

export function ruleCells(entryId: string, row: RuleRow): Cell[] {
    return [entryId, row.ruleKey, row.relation, row.sortOrder, row.legacyOrigin];
}

export function sourceCells(entryId: string, row: LinkRow): Cell[] {
    return [entryId, row.sourceId, row.referenceKind, row.pages, row.note, row.legacyOrigin, row.position];
}

/**
 * Liest, was die Auflösung der Ortszeilen, von Flächen, Klimazonen, Arten und Quellen braucht. Nur lesend. Der Lookup „Wiki-Key → Subject“ ist
 * derselbe, den die Oberfläche fragt (aus der Zuordnung X2, Schritt I24); er braucht die Verbindung, nicht eine Transaktion: gelesen wird der
 * Stand, den die vorigen Schritte des Zuges abgeschlossen haben.
 */
export async function readLoreLookups(database: Database): Promise<LoreLookups> {
    const resolution = await readLoreResolution(database);
    const regions = resolution.regions;
    const regionTypes = resolution.regionTypes;
    const climateKeys = new Set(
        (await database<{ type_key: string }[]>`SELECT type_key FROM climate_zone_type`).map((row) => row.type_key),
    );
    const sources = new Map<string, string>();
    for (const row of await database<{ source_key: string; id: string }[]>`
        SELECT source_key, id::text FROM feature_source WHERE is_active
    `) {
        sources.set(row.source_key, row.id);
    }
    return {
        wikiKeys: resolution.wikiKeys,
        carrierIds: resolution.carrierIds,
        targets: await readTargetIndex(database),
        regions,
        regionTypes,
        climateKeys,
        sources,
    };
}

/**
 * Nur das, was die AUFLÖSUNG einer Ortszeile braucht: der Lookup „Wiki-Schlüssel → Kartenobjekt“ und die internen Nummern der aktiven Träger, dazu die
 * Flächen und ihre Arten. Der Import ruft es über `readLoreLookups`; das Fenster „Inhalte bearbeiten“ (WI-0254) rechnet damit die Treffer einer von Hand
 * angehängten Zeile, ohne Klimazonen, Quellen und das Vergleichsmaß zu lesen.
 */
export async function readLoreResolution(
    database: Database,
): Promise<Pick<LoreLookups, "wikiKeys" | "carrierIds" | "regions" | "regionTypes">> {
    const regions = new Map<string, { id: string; active: boolean }>();
    const regionTypes = new Set<string>();
    for (const row of await database<
        { id: string; public_id: string; is_active: boolean; region_layer: string; region_type: string | null }[]
    >`
        SELECT id::text, public_id::text, is_active, region_layer, region_type FROM region
    `) {
        regions.set(row.public_id.toLowerCase(), { id: row.id, active: row.is_active });
        if (row.is_active && row.region_type !== null) regionTypes.add(`${row.region_layer}|${row.region_type}`);
    }
    const carrierIds = {
        places: await idsByPublicId(database, "place"),
        territories: await idsByPublicId(database, "territory"),
        peaks: await idsByPublicId(database, "terrain_peak"),
        regions: new Map([...regions].filter(([, row]) => row.active).map(([publicId, row]) => [publicId, row.id])),
    };
    return { wikiKeys: await buildWikiKeyLookupOnly(database), carrierIds, regions, regionTypes };
}

/** `public_id` (klein) → `id` der aktiven Zeilen einer Trägertabelle (nur feste Tabellennamen). */
async function idsByPublicId(
    database: Queryable,
    table: "place" | "territory" | "terrain_peak",
): Promise<Map<string, string>> {
    const rows = await database.unsafe<{ id: string; public_id: string }[]>(
        `SELECT id::text, public_id::text FROM ${table} WHERE is_active`,
    );
    return new Map(rows.map((row) => [row.public_id.toLowerCase(), row.id]));
}

class DryRunRollback extends Error {}

function applyChild(report: TableReport, result: ChildSyncResult): void {
    report.created += result.created;
    report.retired += result.retired;
    report.unchanged += result.unchanged;
}

export async function importLore(
    database: Database,
    payload: unknown,
    options: ImportLoreOptions = {},
): Promise<ImportLoreReport> {
    const runId = randomUUID();
    const bag = payload as { entries?: unknown; lore_revision?: unknown } | null;
    const sourceRef =
        `lore-export.php; lore_revision=${typeof bag?.lore_revision === "string" ? bag.lore_revision : "unbekannt"}; ` +
        `entries=${Array.isArray(bag?.entries) ? String(bag.entries.length) : "unbekannt"}`;
    const report: ImportLoreReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: false,
        tables: Object.fromEntries(LORE_TABLES.map((name) => [name, emptyTableReport()])) as Record<
            LoreTable,
            TableReport
        >,
        resolution: { places: { resolved: 0, ambiguous: 0, unresolved: 0, unmatched: 0 }, targets: 0 },
        withheldKinds: [],
        changed: false,
        findings: [],
    };
    // 🔴 WI-0253, Scheibe Vorkommen: Gehören die Vorkommen in dieser Umgebung dem WikiSync, lässt der Zug sie aus (Vali 2026-10-25: „danach lässt der Legacy-Zug diesen Bereich in dieser Umgebung aus“) –
    // Einträge, Ortszeilen samt Rollen, Regeln, Quellenverknüpfungen und Herkunftsvermerke. Der Bericht ist der eines übersprungenen Schritts; ein Befund sagt, warum.
    if ((await wikisyncBereiche(database)).has("vorkommen")) {
        report.skipped = true;
        report.findings.push(
            createFinding(
                "bereich_wikisync",
                "Die Vorkommen gehören in dieser Umgebung dem WikiSync; der Zug lässt sie aus (Einträge, Ortszeilen, Regeln, Quellenverknüpfungen, Herkunft)",
                { bereich: "vorkommen" },
            ),
        );
        return report;
    }
    try {
        // Der Lookup und die Träger werden VOR der Transaktion gelesen (der Lookup braucht die Verbindung); die Umwandlung ist rein.
        const lookups = await readLoreLookups(database);
        const transformed = transformLore(payload, lookups, options.mapRevision ?? null);
        await database.begin(async (transaction) => {
            report.findings.push(...transformed.findings);
            report.resolution = transformed.totals;
            report.withheldKinds = transformed.withheldKinds;
            if (transformed.skipped) {
                report.skipped = true;
                return;
            }
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'lore', 'avesmaps-legacy', ${sourceRef}, ${LORE_CONTRACT_VERSION})
            `;
            await writeAll(transaction, runId, transformed, report, lookups);
            report.changed = Object.values(report.tables).some(
                (table) => table.created + table.updated + table.retired > 0,
            );
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables: report.tables,
                        resolution: report.resolution,
                        withheld_kinds: report.withheldKinds,
                        revision: transformed.revision,
                        dry_run: report.dryRun,
                        findings: report.findings.map((finding) => finding.code),
                    } as unknown as string
                }
                WHERE id = ${runId}
            `;
            if (options.dryRun) throw new DryRunRollback();
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
    }
    return report;
}

/** Der Zustand der Quelle je Schlüssel, nur für die Zeilen, die nicht aktiv geführt werden. */
function statesOf<T>(
    rows: readonly T[],
    keyOf: (row: T) => string,
    stateOf: (row: T) => SourceState,
): Map<string, SourceState> {
    const states = new Map<string, SourceState>();
    for (const row of rows) {
        const state = stateOf(row);
        if (state !== "active") states.set(keyOf(row), state);
    }
    return states;
}

async function writeAll(
    transaction: Queryable,
    runId: string,
    transformed: LoreTransform,
    report: ImportLoreReport,
    lookups: LoreLookups,
): Promise<void> {
    const findings = report.findings;
    const withheld = transformed.withheldKinds;
    const entryRef = (wikiKey: string, name: string): FindingObject => ({
        table: "lore_entry",
        publicId: wikiKey,
        name,
    });

    // ---- Einträge ---------------------------------------------------------------------------------------------------------------
    const entryRows: ExpectedRow[] = transformed.entries.map((entry) => ({
        ref: entryRef(entry.wikiKey, entry.name),
        cells: [
            entry.wikiKey,
            entry.kind,
            entry.name,
            entry.wikiTitle,
            entry.wikiUrl,
            entry.gruppe,
            entry.typ,
            entry.lebensraum,
            entry.synonyme,
            entry.continent,
            entry.matchKey,
            entry.legacyOrigin,
        ],
    }));
    const entries = await syncReported(
        transaction,
        runId,
        "lore_entry",
        entrySpec(withheld),
        entryRows,
        report.tables.lore_entry,
        findings,
        {
            states: statesOf(
                transformed.entries,
                (entry) => entry.wikiKey,
                (entry) => entry.state,
            ),
        },
    );
    // Ein Eintrag, den ein Editor-Entscheid oder eine abgeschaltete Art hält, behält alle seine Teile unberührt.
    const protectedEntries = new Set(entries.protectedHits);
    const idOf = (wikiKey: string): string => {
        const id = entries.idByKey.get(wikiKey);
        if (id === undefined) throw new Error(`lore_entry: der Eintrag ${wikiKey} fehlt nach dem Abgleich`);
        return id;
    };

    // ---- Herkunft je Feld ---------------------------------------------------------------------------------------------------------
    // Ein Eintrag ohne Vermerke ist „nicht bekannt“: der gespeicherte Satz folgt der Antwort, auch wenn sie ihn leert.
    const expectedOrigins = new Map<string, (readonly Cell[])[]>();
    for (const entry of transformed.entries) {
        if (protectedEntries.has(entry.wikiKey)) continue;
        expectedOrigins.set(
            idOf(entry.wikiKey),
            entry.fieldOrigins.map((origin) => [origin.field, origin.origin]),
        );
    }
    applyChild(
        report.tables.lore_entry_field_origin,
        await replaceChildren(
            transaction,
            "lore_entry_field_origin",
            "lore_entry_id",
            FIELD_ORIGIN_COLUMNS,
            expectedOrigins,
            "field",
        ),
    );

    // ---- Ortszeilen ---------------------------------------------------------------------------------------------------------------
    const placeRows: ExpectedRow[] = [];
    const placeStates = new Map<string, SourceState>();
    for (const place of transformed.places) {
        if (protectedEntries.has(place.entryWikiKey)) continue;
        const cells = placeCells(idOf(place.entryWikiKey), place);
        placeRows.push({
            ref: {
                table: "lore_place",
                publicId: place.entryWikiKey,
                name: `${place.entryName} / ${place.placeWikiKey}`,
            },
            cells,
        });
        if (place.state !== "active") placeStates.set(placeKey(cells), place.state);
    }
    const places = await syncReported(
        transaction,
        runId,
        "lore_place",
        placeSpec(withheld),
        placeRows,
        report.tables.lore_place,
        findings,
        { states: placeStates },
    );
    const protectedPlaces = new Set(places.protectedHits);

    // ---- Ziele der Ortszeilen: bei jedem Lauf aus den Trägern neu gerechnet ------------------------------------------------------
    // 🔴 Nur die Rolle `ort` trifft (WI-0253 §23): Eine Zeile, der der WikiSync eine andere Rolle gab (Bezugspunkt, Landschaftsart …), behält ihren Link, aber nie ein Ziel – auch dann nicht, wenn der
    // Zug sie wieder fährt. Legacys Antwort kennt keine Rolle; die Rolle einer Zeile bleibt, wie sie ist.
    const ohneTreffer = await zeilenOhneTreffer(transaction);
    const expectedTargets = new Map<string, (readonly Cell[])[]>();
    for (const place of transformed.places) {
        if (protectedEntries.has(place.entryWikiKey)) continue;
        const key = placeKey(placeCells(idOf(place.entryWikiKey), place));
        if (protectedPlaces.has(key)) continue;
        const id = places.idByKey.get(key);
        if (id === undefined) continue;
        expectedTargets.set(id, ohneTreffer.has(id) ? [] : place.hits.map(hitCells));
    }
    applyChild(
        report.tables.lore_place_target,
        await replaceChildren(transaction, "lore_place_target", "lore_place_id", TARGET_COLUMNS, expectedTargets),
    );
    await halteOhneTreffer(transaction, ohneTreffer);

    // ---- Treffer der Zeilen, die die Redaktion hält: ebenfalls bei jedem Lauf neu gerechnet --------------------------------------
    await refreshOwnedTargets(transaction, lookups, report);

    // ---- Regeln und ihre Bedingungen ---------------------------------------------------------------------------------------------
    const ruleRows: ExpectedRow[] = transformed.rules
        .filter((rule) => !protectedEntries.has(rule.entryWikiKey))
        .map((rule) => ({
            ref: {
                table: "lore_rule",
                publicId: rule.entryWikiKey,
                name: `${rule.entryName} / ${rule.ruleKey.slice(0, 12)}`,
            },
            cells: ruleCells(idOf(rule.entryWikiKey), rule),
        }));
    const rules = await syncReported(
        transaction,
        runId,
        "lore_rule",
        ruleSpec(withheld),
        ruleRows,
        report.tables.lore_rule,
        findings,
    );
    const protectedRules = new Set(rules.protectedHits);
    await replaceTerms(
        transaction,
        transformed.rules.flatMap((rule) => {
            if (protectedEntries.has(rule.entryWikiKey)) return [];
            const key = pair(ruleCells(idOf(rule.entryWikiKey), rule));
            const id = rules.idByKey.get(key);
            return id === undefined || protectedRules.has(key) ? [] : [{ ruleId: id, rule }];
        }),
        report,
    );

    // ---- Quellenverknüpfungen (D1) -----------------------------------------------------------------------------------------------
    const sourceRows: ExpectedRow[] = [];
    const sourceStates = new Map<string, SourceState>();
    for (const link of transformed.links) {
        if (protectedEntries.has(link.entryWikiKey)) continue;
        const cells = sourceCells(idOf(link.entryWikiKey), link);
        sourceRows.push({
            ref: { table: "lore_entry_source", publicId: link.entryWikiKey, name: link.entryName },
            cells,
        });
        if (link.state !== "active") sourceStates.set(pair(cells), link.state);
    }
    await syncReported(
        transaction,
        runId,
        "lore_entry_source",
        sourceSpec(withheld),
        sourceRows,
        report.tables.lore_entry_source,
        findings,
        { states: sourceStates },
    );
}

/** Die Ortszeilen, die keine Treffer haben dürfen: die mit einer anderen Rolle als `ort` (`lore_place.role`, WI-0253 §23; NULL gilt als Ort). */
async function zeilenOhneTreffer(transaction: Queryable): Promise<Set<string>> {
    const rows = await transaction<
        { id: string }[]
    >`SELECT id::text AS id FROM lore_place WHERE role IS NOT NULL AND role <> 'ort'`;
    return new Set(rows.map((row) => row.id));
}

/** Setzt die abgeleiteten Spalten dieser Zeilen zurück (kein Treffer, kein Kontinentbegriff): Der Zug schrieb Legacys Auflösung hinein, die die Rolle nicht kennt. */
async function halteOhneTreffer(transaction: Queryable, ids: ReadonlySet<string>): Promise<void> {
    if (ids.size === 0) return;
    await transaction.unsafe(
        `UPDATE lore_place SET key_class = 'other', target_state = 'unmatched', target_count = 0
          WHERE id = ANY($1::bigint[]) AND (key_class <> 'other' OR target_state <> 'unmatched' OR target_count <> 0)`,
        [pgArray([...ids])],
    );
}

/**
 * Die abgeleiteten Treffer (`lore_place_target`, `target_state`, `target_count`, `key_class`) der Ortszeilen, die der Zug nicht schreibt, weil die
 * Redaktion sie hält: Zeilen eines Eintrags mit `source_system = 'editor'` und Zeilen mit `target_origin = 'editor'`. Die Zeile selbst (Schlüssel,
 * Beziehung, Zustand) bleibt, wie die Redaktion sie hinterließ; was sie trifft, ist keine Redaktion, sondern eine Rechnung aus den Trägern, und wird
 * wie bei allen Zeilen mit demselben Lookup neu gerechnet (`resolveLorePlace`), damit es nicht veraltet.
 */
async function refreshOwnedTargets(
    transaction: Queryable,
    lookups: LoreLookups,
    report: ImportLoreReport,
): Promise<void> {
    const rows = await transaction<
        { id: string; place_wiki_key: string; key_class: string; target_state: string; target_count: number }[]
    >`
        SELECT p.id::text AS id, p.place_wiki_key, p.key_class, p.target_state, p.target_count::int AS target_count
          FROM lore_place p
          JOIN lore_entry e ON e.id = p.lore_entry_id
         WHERE p.is_active AND p.place_wiki_key IS NOT NULL AND (e.source_system = 'editor' OR p.target_origin = 'editor')
           AND (p.role IS NULL OR p.role = 'ort')
    `;
    if (rows.length === 0) return;
    const expectedTargets = new Map<string, (readonly Cell[])[]>();
    const changed: { id: string; keyClass: string; state: string; count: number }[] = [];
    for (const row of rows) {
        const resolution = resolveLorePlace(row.place_wiki_key, lookups.wikiKeys, lookups.carrierIds);
        expectedTargets.set(row.id, resolution.hits.map(hitCells));
        if (
            row.key_class !== resolution.keyClass ||
            row.target_state !== resolution.state ||
            row.target_count !== resolution.hits.length
        ) {
            changed.push({
                id: row.id,
                keyClass: resolution.keyClass,
                state: resolution.state,
                count: resolution.hits.length,
            });
        }
    }
    if (changed.length > 0) {
        await transaction.unsafe(
            `UPDATE lore_place p SET key_class = v.key_class, target_state = v.state, target_count = v.count, updated_at = now()
               FROM unnest($1::bigint[], $2::text[], $3::text[], $4::smallint[]) AS v(id, key_class, state, count)
              WHERE p.id = v.id`,
            [
                pgArray(changed.map((row) => row.id)),
                pgArray(changed.map((row) => row.keyClass)),
                pgArray(changed.map((row) => row.state)),
                pgArray(changed.map((row) => row.count)),
            ],
        );
        report.tables.lore_place.updated += changed.length;
    }
    applyChild(
        report.tables.lore_place_target,
        await replaceChildren(transaction, "lore_place_target", "lore_place_id", TARGET_COLUMNS, expectedTargets),
    );
}

/** Eine Bedingung, wie sie verglichen wird (gespeichert oder aus der Antwort). */
interface TermShape {
    seq: number;
    joinOp: string;
    areaRegionId: string | null;
    legacyAreaPublicId: string | null;
    climateFrom: string | null;
    climateTo: string | null;
    legacyClimateFrom: string | null;
    legacyClimateTo: string | null;
    types: readonly { layer: string; type: string }[];
}

/** Eine Regel mit ihrer Bedingungskette in einer vergleichbaren Form (Zeile je Bedingung, Arten sortiert). */
function termSignature(terms: readonly TermShape[]): string {
    return JSON.stringify(
        terms.map((term) => [
            term.seq,
            term.joinOp,
            term.areaRegionId,
            term.legacyAreaPublicId,
            term.climateFrom,
            term.climateTo,
            term.legacyClimateFrom,
            term.legacyClimateTo,
            term.types.map((type) => `${type.layer}\u001f${type.type}`).sort(),
        ]),
    );
}

/**
 * Die Bedingungen und Landschaftsarten der Regeln: Teile ihrer Regel, bei jedem Lauf mit der Antwort verglichen. Ändert sich die Kette
 * einer Regel (oder die Auflösung einer Fläche oder Klimaspanne), wird sie als Ganzes ersetzt; sonst bleibt sie. Die Arten hängen mit
 * `ON DELETE CASCADE` an ihrer Bedingung.
 */
async function replaceTerms(
    transaction: Queryable,
    rules: readonly { ruleId: string; rule: RuleRow }[],
    report: ImportLoreReport,
): Promise<void> {
    const termReport = report.tables.lore_rule_term;
    const typeReport = report.tables.lore_rule_term_type;
    if (rules.length === 0) return;
    const existing = new Map<string, { terms: TermShape[]; typeCount: number }>();
    const rows = await transaction.unsafe<
        {
            rule_id: string;
            seq: number;
            join_op: string;
            area_region_id: string | null;
            legacy_area_public_id: string | null;
            climate_from: string | null;
            climate_to: string | null;
            legacy_climate_from: string | null;
            legacy_climate_to: string | null;
            types: { layer: string; type: string }[];
        }[]
    >(
        `SELECT t.lore_rule_id::text AS rule_id, t.seq::int AS seq, t.join_op, t.area_region_id::text AS area_region_id,
                t.legacy_area_public_id, t.climate_from, t.climate_to, t.legacy_climate_from, t.legacy_climate_to,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('layer', y.region_layer, 'type', y.region_type))
                            FROM lore_rule_term_type y WHERE y.lore_rule_term_id = t.id), '[]'::jsonb) AS types
           FROM lore_rule_term t WHERE t.lore_rule_id = ANY($1::bigint[]) ORDER BY t.lore_rule_id, t.seq`,
        [pgArray(rules.map((entry) => entry.ruleId))],
    );
    for (const row of rows) {
        const slot = existing.get(row.rule_id) ?? { terms: [], typeCount: 0 };
        slot.terms.push({
            seq: row.seq,
            joinOp: row.join_op,
            areaRegionId: row.area_region_id,
            legacyAreaPublicId: row.legacy_area_public_id,
            climateFrom: row.climate_from,
            climateTo: row.climate_to,
            legacyClimateFrom: row.legacy_climate_from,
            legacyClimateTo: row.legacy_climate_to,
            types: row.types,
        });
        slot.typeCount += row.types.length;
        existing.set(row.rule_id, slot);
    }

    const replace: { ruleId: string; rule: RuleRow }[] = [];
    for (const entry of rules) {
        const have = existing.get(entry.ruleId);
        const same = have !== undefined && termSignature(have.terms) === termSignature(entry.rule.terms);
        if (same) {
            termReport.unchanged += entry.rule.terms.length;
            typeReport.unchanged += entry.rule.terms.reduce((sum, term) => sum + term.types.length, 0);
            continue;
        }
        replace.push(entry);
        termReport.retired += have?.terms.length ?? 0;
        typeReport.retired += have?.typeCount ?? 0;
    }
    if (replace.length === 0) return;
    await transaction.unsafe(`DELETE FROM lore_rule_term WHERE lore_rule_id = ANY($1::bigint[])`, [
        pgArray(replace.map((entry) => entry.ruleId)),
    ]);
    const flat = replace.flatMap((entry) => entry.rule.terms.map((term) => ({ ruleId: entry.ruleId, term })));
    for (let offset = 0; offset < flat.length; offset += 5000) {
        const part = flat.slice(offset, offset + 5000);
        const inserted = await transaction.unsafe<{ id: string; rule_id: string; seq: number }[]>(
            `INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id, legacy_area_public_id, climate_from, climate_to, legacy_climate_from, legacy_climate_to)
             SELECT v.rule, v.seq, v.join_op, v.area, v.legacy_area, v.cf, v.ct, v.lcf, v.lct
               FROM unnest($1::bigint[], $2::smallint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
                    AS v(rule, seq, join_op, area, legacy_area, cf, ct, lcf, lct)
             RETURNING id::text AS id, lore_rule_id::text AS rule_id, seq::int AS seq`,
            [
                pgArray(part.map((entry) => entry.ruleId)),
                pgArray(part.map((entry) => entry.term.seq)),
                pgArray(part.map((entry) => entry.term.joinOp)),
                pgArray(part.map((entry) => entry.term.areaRegionId)),
                pgArray(part.map((entry) => entry.term.legacyAreaPublicId)),
                pgArray(part.map((entry) => entry.term.climateFrom)),
                pgArray(part.map((entry) => entry.term.climateTo)),
                pgArray(part.map((entry) => entry.term.legacyClimateFrom)),
                pgArray(part.map((entry) => entry.term.legacyClimateTo)),
            ],
        );
        termReport.created += inserted.length;
        const termIdOf = new Map(inserted.map((row) => [`${row.rule_id}|${String(row.seq)}`, row.id]));
        const typeRows = part.flatMap((entry) =>
            entry.term.types.map((type) => ({
                termId: termIdOf.get(`${entry.ruleId}|${String(entry.term.seq)}`) as string,
                layer: type.layer,
                type: type.type,
            })),
        );
        if (typeRows.length > 0) {
            await transaction.unsafe(
                `INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type)
                 SELECT v.term, v.layer, v.type FROM unnest($1::bigint[], $2::text[], $3::text[]) AS v(term, layer, type)`,
                [
                    pgArray(typeRows.map((row) => row.termId)),
                    pgArray(typeRows.map((row) => row.layer)),
                    pgArray(typeRows.map((row) => row.type)),
                ],
            );
            typeReport.created += typeRows.length;
        }
    }
}

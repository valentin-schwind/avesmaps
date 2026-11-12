import { randomUUID } from "node:crypto";
import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { withZugSperre } from "../derive/derive-lock.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { karteGehalten } from "../media-editor/karte-gehalten.ts";
import { readTargetIndex, targetCells, type ResolutionTotals } from "./catalog-places.ts";
import { enrichRows, syncReported, writeTombstones, type ExpectedRow, type TombstoneResult } from "./catalog-sync.ts";
import {
    CITYMAPS_CONTRACT_VERSION,
    transformCitymaps,
    type CitymapOverlay,
    type CitymapsTransform,
    type MapPlaceRow,
    type SourcesPart,
} from "./citymaps.ts";
import { emptyTableReport, pgArray, type Cell, type Col, type SyncSpec, type TableReport } from "./sync-table.ts";

/**
 * Schreibt Karten, Typen, Beziehungen, Ortsbezüge, Fundstellen, die Quellenverknüpfung und (mit den privaten Feldern) die Zuordnung
 * des eigenen Wiki-Artikels der Kartensammlung idempotent in die Zieldatenbank (WI-0063 P3, Vertrag `citymaps.yaml`, D2).
 *
 * EINE Transaktion für alles (Karten, Typen, Beziehungen, Orte, Links, Quellen, Stilllegen), damit die Stilllegequote über den Satz
 * gilt. Der zweite Lauf findet nichts zu schreiben.
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück.
 * 🔴 Ist die Antwort unbrauchbar, leer bei aktivem Schalter oder der Schalter aus, schreibt der Schritt nichts, legt nichts still und
 * meldet `source_block_missing`, `source_empty_catalog` beziehungsweise `source_switched_off`; der Lauf geht weiter (kein Tor).
 * 🔴 Der Schritt schreibt KEINE Medienzeile: Vollkarte, Vorschau und die Freigaberegel kommen mit dem Medienimport (MEDIA-M8).
 *
 * Reihenfolge im Lauf (Vertrag `idempotenz.reihenfolge_im_lauf`): erst die Karten (ohne Elter), dann Elter und Beziehungen (alle Karten
 * sind da), dann Typen, Orte, Links, Quellen, dann die Auflösung (sie steckt in den Zeilen der Orte), dann das Stilllegen (in
 * `syncTable`).
 */

export const CITYMAP_TABLES = [
    "citymap",
    "citymap_type",
    "citymap_related",
    "citymap_place",
    "citymap_link",
    "citymap_source",
    "citymap_wiki_assignment",
] as const;
export type CitymapTable = (typeof CITYMAP_TABLES)[number];

export interface ImportCitymapsOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
    /** Der Satz `map-features.json` desselben Zuges, für die Quellenverknüpfung der Karten; ohne ihn entfällt dieser Teil. */
    features?: unknown;
    /** Die privaten Felder (E5/E5+), wenn die Datei sie trägt. */
    overlay?: CitymapOverlay | undefined;
}

export interface ImportCitymapsReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Die Antwort war unbrauchbar, leer oder abgeschaltet: nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    tables: Record<CitymapTable, TableReport>;
    resolution: ResolutionTotals;
    /** Karten, deren übergeordnete Karte sich geändert hat (Elter setzen oder lösen). */
    parentsChanged: number;
    /** Ob die Quellenverknüpfung geschrieben wurde: `applied`, ohne Satz `no_features`, ohne Katalog `block_missing`, oder `not_imported` (D1 fehlt). */
    sourcesPart: SourcesPart | "not_imported";
    privateFields: {
        file: boolean;
        maps: number;
        places: number;
        links: number;
        tombstonePlaces: TombstoneResult;
        tombstoneLinks: TombstoneResult;
        tombstoneMaps: number;
    };
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });
const int = (name: string): Col => ({ name, type: "int" });
const bigint = (name: string): Col => ({ name, type: "bigint" });
const bool = (name: string): Col => ({ name, type: "boolean" });

export const MAP_COLUMNS: readonly Col[] = [
    { name: "public_id", type: "uuid" },
    { name: "legacy_public_id", type: "uuid" },
    text("title"),
    text("art"),
    text("color_mode"),
    bool("is_multilevel"),
    bool("is_labeled"),
    bool("is_official"),
    bool("is_spoiler"),
    bool("has_scale"),
    int("width_px"),
    int("height_px"),
    text("format"),
    int("valid_from_bf"),
    int("valid_to_bf"),
    text("author"),
    text("publisher"),
    text("note"),
];
export const TYPE_COLUMNS: readonly Col[] = [bigint("citymap_id"), text("type_key")];
export const RELATED_COLUMNS: readonly Col[] = [bigint("citymap_id"), bigint("related_citymap_id")];
export const PLACE_COLUMNS: readonly Col[] = [
    bigint("citymap_id"),
    int("sort_order"),
    int("export_ordinal"),
    text("name_key"),
    int("dup_ordinal"),
    text("raw_name"),
    text("target_state"),
    text("resolved_by"),
    bigint("place_id"),
    bigint("territory_id"),
    bigint("region_id"),
    bigint("terrain_peak_id"),
    bigint("path_id"),
    text("legacy_target_kind"),
    text("legacy_target_public_id"),
    text("legacy_target_wiki_key"),
];
const PLACE_TOMBSTONE_COLUMNS: readonly Col[] = [...PLACE_COLUMNS, text("legacy_origin")];
export const LINK_COLUMNS: readonly Col[] = [
    bigint("citymap_id"),
    text("link_role"),
    text("url"),
    text("label"),
    bool("is_paid"),
    int("position"),
];
const LINK_TOMBSTONE_COLUMNS: readonly Col[] = [...LINK_COLUMNS, text("legacy_origin")];
export const SOURCE_LINK_COLUMNS: readonly Col[] = [
    bigint("citymap_id"),
    bigint("source_id"),
    text("reference_kind"),
    text("pages"),
    text("note"),
    text("legacy_origin"),
    int("position"),
];
export const ASSIGNMENT_COLUMNS: readonly Col[] = [
    bigint("citymap_id"),
    text("wiki_url"),
    text("article_key"),
    text("article_title"),
    text("assignment_state"),
    text("assignment_origin"),
];

const first = (cells: readonly Cell[]): string => String(cells[0]);
const pair = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[1])}`;
const placeKey = (cells: readonly Cell[]): string =>
    `${String(cells[0])}|${String(cells[1])}|${String(cells[3])}|${String(cells[4])}`;
const linkKey = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[2])}`;

/**
 * Die Kinder einer Karte, die ein Tombstone oder ein Editor-Entscheid hält, fasst der Import nie an. Ein Editor-Entscheid ist auch jede
 * Änderung in der Medienverwaltung (`karteGehalten`, WI-0068 R5).
 */
const PARENT_PROTECTED = `EXISTS (SELECT 1 FROM citymap a WHERE a.id = t.citymap_id AND (a.state = 'suppressed' OR (NOT a.is_active AND a.retired_origin = 'editor') OR ${karteGehalten("a")}))`;

const stateful = {
    activeSet: "state = 'active'",
    retiredSet: "state = 'retired'",
    insertConstants: { state: "'active'" },
} as const;

export function mapSpec(): SyncSpec {
    return {
        table: "citymap",
        columns: MAP_COLUMNS,
        keyOf: first,
        ...stateful,
        protectedWhere: `t.state = 'suppressed' OR ${karteGehalten("t")}`,
        describe: { join: "", publicId: "t.public_id::text", name: "t.title" },
    };
}

export function typeSpec(): SyncSpec {
    return {
        table: "citymap_type",
        columns: TYPE_COLUMNS,
        keyOf: pair,
        ...stateful,
        protectedWhere: `t.state = 'suppressed' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN citymap c ON c.id = t.citymap_id",
            publicId: "c.public_id::text",
            name: "c.title || ' / ' || t.type_key",
        },
    };
}

export function relatedSpec(): SyncSpec {
    return {
        table: "citymap_related",
        columns: RELATED_COLUMNS,
        keyOf: pair,
        ...stateful,
        protectedWhere: `t.state = 'suppressed' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN citymap c ON c.id = t.citymap_id JOIN citymap r ON r.id = t.related_citymap_id",
            publicId: "c.public_id::text",
            name: "c.title || ' / ' || r.title",
        },
    };
}

export function placeSpec(): SyncSpec {
    return {
        table: "citymap_place",
        columns: PLACE_COLUMNS,
        keyOf: placeKey,
        ...stateful,
        protectedWhere: `t.state = 'suppressed' OR t.target_origin = 'editor' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN citymap c ON c.id = t.citymap_id",
            publicId: "c.public_id::text",
            name: "c.title || ' / ' || t.raw_name",
        },
    };
}

export function linkSpec(): SyncSpec {
    return {
        table: "citymap_link",
        columns: LINK_COLUMNS,
        keyOf: linkKey,
        ...stateful,
        protectedWhere: `t.state = 'suppressed' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN citymap c ON c.id = t.citymap_id",
            publicId: "c.public_id::text",
            name: "c.title || ' / ' || t.url",
        },
    };
}

export function sourceLinkSpec(): SyncSpec {
    return {
        table: "citymap_source",
        columns: SOURCE_LINK_COLUMNS,
        keyOf: pair,
        ...stateful,
        protectedWhere: `t.state = 'suppressed' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN citymap c ON c.id = t.citymap_id",
            publicId: "c.public_id::text",
            name: "c.title",
        },
    };
}

export function assignmentSpec(): SyncSpec {
    return {
        table: "citymap_wiki_assignment",
        columns: ASSIGNMENT_COLUMNS,
        keyOf: first,
        protectedWhere: PARENT_PROTECTED,
        describe: {
            join: "JOIN citymap c ON c.id = t.citymap_id",
            publicId: "c.public_id::text",
            name: "c.title",
        },
    };
}

/** Die Zellen einer Ortszeile (Reihenfolge von `PLACE_COLUMNS`). */
export function placeCells(citymapId: string, row: MapPlaceRow): Cell[] {
    return [
        citymapId,
        row.sortOrder,
        row.exportOrdinal,
        row.nameKey,
        row.dupOrdinal,
        row.rawName,
        row.resolution.state,
        row.resolution.resolvedBy,
        ...targetCells(row.resolution),
        row.legacy.kind,
        row.legacy.publicId,
        row.legacy.wikiKey,
    ];
}

/** Das Paar zweier Karten in der Ordnung der Tabelle: die kleinere Id zuerst (numerisch). */
export function orderedPair(a: string, b: string): [string, string] {
    return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

class DryRunRollback extends Error {}

/**
 * Der Schritt I21. Er nimmt die Sperre der Kartendomäne exklusiv (`withZugSperre`, EDIT-0003 T17): Die Karten schreibt seit WI-0068 R5
 * auch die Medienverwaltung (`media-editor/kartensammlung-schreiben.ts`), und kein Speichern soll zwischen seine Zeilen fallen.
 */
export function importCitymaps(
    database: Database,
    payload: unknown,
    options: ImportCitymapsOptions = {},
): Promise<ImportCitymapsReport> {
    return withZugSperre(database, AVENTURIA.mapDomain, "I21 Kartensammlung", () =>
        importCitymapsLocked(database, payload, options),
    );
}

async function importCitymapsLocked(
    database: Database,
    payload: unknown,
    options: ImportCitymapsOptions,
): Promise<ImportCitymapsReport> {
    const runId = randomUUID();
    const list = (payload as { citymaps?: unknown } | null)?.citymaps;
    const sourceRef = `citymaps.php; citymaps=${Array.isArray(list) ? String(list.length) : "unbekannt"}`;
    const overlay = options.overlay ?? null;
    const report: ImportCitymapsReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: false,
        tables: Object.fromEntries(CITYMAP_TABLES.map((name) => [name, emptyTableReport()])) as Record<
            CitymapTable,
            TableReport
        >,
        resolution: { resolved: 0, unresolved: 0, unmatched: 0, byKind: {} },
        parentsChanged: 0,
        sourcesPart: "no_features",
        privateFields: {
            file: overlay !== null,
            maps: 0,
            places: 0,
            links: 0,
            tombstonePlaces: { created: 0, converted: 0, unchanged: 0 },
            tombstoneLinks: { created: 0, converted: 0, unchanged: 0 },
            tombstoneMaps: 0,
        },
        changed: false,
        findings: [],
    };
    try {
        await database.begin(async (transaction) => {
            const index = await readTargetIndex(transaction);
            const transformed = transformCitymaps(payload, index, { features: options.features, overlay });
            report.findings.push(...transformed.findings);
            report.resolution = transformed.totals;
            report.sourcesPart = transformed.sourcesPart;
            if (transformed.skipped) {
                report.skipped = true;
                return;
            }
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'citymaps', 'avesmaps-legacy', ${sourceRef}, ${CITYMAPS_CONTRACT_VERSION})
            `;
            await writeAll(transaction, runId, transformed, report);
            const privateChanged =
                report.privateFields.maps +
                report.privateFields.places +
                report.privateFields.links +
                report.privateFields.tombstonePlaces.created +
                report.privateFields.tombstonePlaces.converted +
                report.privateFields.tombstoneLinks.created +
                report.privateFields.tombstoneLinks.converted +
                report.privateFields.tombstoneMaps;
            report.changed =
                Object.values(report.tables).some((table) => table.created + table.updated + table.retired > 0) ||
                report.parentsChanged > 0 ||
                privateChanged > 0;
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables: report.tables,
                        resolution: report.resolution,
                        parents_changed: report.parentsChanged,
                        sources_part: report.sourcesPart,
                        private: report.privateFields,
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

async function writeAll(
    transaction: Queryable,
    runId: string,
    transformed: CitymapsTransform,
    report: ImportCitymapsReport,
): Promise<void> {
    const findings = report.findings;
    const mapRef = (publicId: string, title: string): FindingObject => ({ table: "citymap", publicId, name: title });

    // ---- Karten (ohne Elter) ----------------------------------------------------------------------------------------------------
    if (transformed.suppressedMaps.length > 0) {
        const done = await writeTombstones(
            transaction,
            "citymap",
            [{ name: "public_id", type: "uuid" }],
            first,
            transformed.suppressedMaps.map((publicId) => [publicId]),
            runId,
            false,
        );
        report.privateFields.tombstoneMaps = done.converted;
    }
    const mapRows: ExpectedRow[] = transformed.maps.map((row) => ({
        ref: mapRef(row.publicId, row.title),
        cells: [
            row.publicId,
            row.publicId,
            row.title,
            row.art,
            row.colorMode,
            row.isMultilevel,
            row.isLabeled,
            row.isOfficial,
            row.isSpoiler,
            row.hasScale,
            row.widthPx,
            row.heightPx,
            row.format,
            row.validFromBf,
            row.validToBf,
            row.author,
            row.publisher,
            row.note,
        ],
    }));
    const maps = await syncReported(transaction, runId, "citymap", mapSpec(), mapRows, report.tables.citymap, findings);
    const protectedMaps = new Set(maps.protectedHits);
    const idOf = (publicId: string): string => {
        const id = maps.idByKey.get(publicId);
        if (id === undefined) throw new Error(`citymap: die Karte ${publicId} fehlt nach dem Abgleich`);
        return id;
    };

    // ---- Übergeordnete Karte (jetzt sind alle Karten da) und private Felder -----------------------------------------------------------
    report.parentsChanged = await enrichRows(
        transaction,
        "citymap",
        [bigint("parent_id")],
        transformed.maps
            .filter((row) => !protectedMaps.has(row.publicId))
            .map((row) => ({
                id: idOf(row.publicId),
                cells: [row.parentPublicId === null ? null : idOf(row.parentPublicId)] as Cell[],
            })),
        runId,
    );
    await enrichMaps(transaction, runId, transformed, maps.idByKey, protectedMaps, report);

    // ---- Typen und Beziehungen ---------------------------------------------------------------------------------------------------
    const typeRows: ExpectedRow[] = transformed.types
        .filter((row) => !protectedMaps.has(row.mapPublicId))
        .map((row) => ({
            ref: { table: "citymap_type", publicId: row.mapPublicId, name: `${row.mapTitle} / ${row.typeKey}` },
            cells: [idOf(row.mapPublicId), row.typeKey],
        }));
    await syncReported(transaction, runId, "citymap_type", typeSpec(), typeRows, report.tables.citymap_type, findings);
    const relatedRows: ExpectedRow[] = transformed.related
        .filter((row) => !protectedMaps.has(row.a) && !protectedMaps.has(row.b))
        .map((row) => {
            const [low, high] = orderedPair(idOf(row.a), idOf(row.b));
            return {
                ref: { table: "citymap_related", publicId: row.a, name: `${row.titleA} / ${row.b}` },
                cells: [low, high],
            };
        });
    await syncReported(
        transaction,
        runId,
        "citymap_related",
        relatedSpec(),
        relatedRows,
        report.tables.citymap_related,
        findings,
    );

    // ---- Orte ---------------------------------------------------------------------------------------------------------------------
    if (transformed.suppressedPlaces.length > 0) {
        const rows = transformed.suppressedPlaces
            .filter((place) => maps.idByKey.has(place.mapPublicId) && !protectedMaps.has(place.mapPublicId))
            .map((place): Cell[] => [
                idOf(place.mapPublicId),
                place.sortOrder,
                place.exportOrdinal,
                place.nameKey,
                place.dupOrdinal,
                place.rawName,
                (place.legacy.kind ?? "") === "" || place.legacy.kind === "unresolved" ? "unresolved" : "unmatched",
                null,
                null,
                null,
                null,
                null,
                null,
                place.legacy.kind,
                place.legacy.publicId,
                place.legacy.wikiKey,
                place.origin,
            ]);
        report.privateFields.tombstonePlaces = await writeTombstones(
            transaction,
            "citymap_place",
            PLACE_TOMBSTONE_COLUMNS,
            placeKey,
            rows,
            runId,
        );
    }
    const placeRows: ExpectedRow[] = transformed.places
        .filter((place) => !protectedMaps.has(place.mapPublicId))
        .map((place) => ({
            ref: { table: "citymap_place", publicId: place.mapPublicId, name: `${place.mapTitle} / ${place.rawName}` },
            cells: placeCells(idOf(place.mapPublicId), place),
        }));
    const places = await syncReported(
        transaction,
        runId,
        "citymap_place",
        placeSpec(),
        placeRows,
        report.tables.citymap_place,
        findings,
    );
    if (transformed.privatePlaces.length > 0) {
        const updates = transformed.privatePlaces
            .filter((place) => !protectedMaps.has(place.mapPublicId))
            .flatMap((place) => {
                const id = places.idByKey.get(
                    `${idOf(place.mapPublicId)}|${String(place.sortOrder)}|${place.nameKey}|${String(place.dupOrdinal)}`,
                );
                return id === undefined ? [] : [{ id, cells: [place.origin] as Cell[] }];
            });
        report.privateFields.places = await enrichRows(
            transaction,
            "citymap_place",
            [text("legacy_origin")],
            updates,
            runId,
        );
    }

    // ---- Fundstellen ------------------------------------------------------------------------------------------------------------------
    if (transformed.suppressedLinks.length > 0) {
        const rows = transformed.suppressedLinks
            .filter((link) => maps.idByKey.has(link.mapPublicId) && !protectedMaps.has(link.mapPublicId))
            .map((link): Cell[] => [
                idOf(link.mapPublicId),
                // Der partielle Index lässt nur EINEN AKTIVEN primary je Karte zu; ein Tombstone ist nie aktiv und behält seine Rolle.
                link.role,
                link.url,
                link.label,
                link.isPaid,
                link.position,
                link.origin,
            ]);
        report.privateFields.tombstoneLinks = await writeTombstones(
            transaction,
            "citymap_link",
            LINK_TOMBSTONE_COLUMNS,
            linkKey,
            rows,
            runId,
        );
    }
    // Wechselt der Karten-Link zwischen zwei vorhandenen Fundstellen, würden beide kurz primary sein: Die alte wird vorher zur weiteren.
    const demote = transformed.links
        .filter((link) => link.role === "further" && !protectedMaps.has(link.mapPublicId))
        .map((link) => `${idOf(link.mapPublicId)}|${link.url}`);
    let demoted = 0;
    if (demote.length > 0) {
        const rows = await transaction.unsafe<{ id: string }[]>(
            `UPDATE citymap_link SET link_role = 'further', updated_at = now() WHERE state = 'active' AND link_role = 'primary' ` +
                `AND (citymap_id::text || '|' || url) = ANY($1::text[]) RETURNING id::text AS id`,
            [pgArray(demote)],
        );
        demoted = rows.length;
    }
    const linkRows: ExpectedRow[] = transformed.links
        .filter((link) => !protectedMaps.has(link.mapPublicId))
        .map((link) => ({
            ref: { table: "citymap_link", publicId: link.mapPublicId, name: `${link.mapTitle} / ${link.url}` },
            cells: [idOf(link.mapPublicId), link.role, link.url, link.label, link.isPaid, link.position],
        }));
    const linkReport = report.tables.citymap_link;
    const links = await syncReported(transaction, runId, "citymap_link", linkSpec(), linkRows, linkReport, findings);
    // Die herabgestuften Zeilen stehen danach schon richtig und zählen im Abgleich als unverändert; sie sind geändert.
    linkReport.updated += demoted;
    linkReport.unchanged -= Math.min(demoted, linkReport.unchanged);
    if (transformed.privateLinks.length > 0) {
        const updates = transformed.privateLinks
            .filter((link) => !protectedMaps.has(link.mapPublicId))
            .flatMap((link) => {
                const id = links.idByKey.get(`${idOf(link.mapPublicId)}|${link.url}`);
                return id === undefined ? [] : [{ id, cells: [link.origin] as Cell[] }];
            });
        report.privateFields.links = await enrichRows(
            transaction,
            "citymap_link",
            [text("legacy_origin")],
            updates,
            runId,
        );
    }

    // ---- Quellen (D1): nur mit dem Satz und nur, wenn der Katalog schon importiert ist ----------------------------------------------------
    if (transformed.sourcesPart === "applied") {
        const sourceIds = new Map<string, string>();
        for (const row of await transaction<{ source_key: string; id: string }[]>`
            SELECT source_key, id::text FROM feature_source WHERE is_active
        `) {
            sourceIds.set(row.source_key, row.id);
        }
        const missing = transformed.sources.filter((row) => !sourceIds.has(row.sourceKey));
        if (missing.length > 0) {
            // D1 ist nicht (oder nicht für diesen Satz) importiert: der Teil entfällt ganz, damit nichts zu Unrecht stillgelegt wird.
            report.sourcesPart = "not_imported";
            findings.push(
                createFinding(
                    "source_not_imported",
                    `${String(missing.length)} Quellenverknüpfungen von Karten nennen Quellen, die der Katalog (D1, Schritt I18) noch nicht trägt; citymap_source entfällt für diesen Lauf, nichts wird stillgelegt`,
                    { verknuepfungen: missing.length },
                    missing.map((row) => ({ table: "citymap", publicId: row.mapPublicId, name: row.mapTitle })),
                ),
            );
        } else {
            const sourceRows: ExpectedRow[] = transformed.sources
                .filter((row) => !protectedMaps.has(row.mapPublicId))
                .map((row) => ({
                    ref: { table: "citymap_source", publicId: row.mapPublicId, name: row.mapTitle },
                    cells: [
                        idOf(row.mapPublicId),
                        sourceIds.get(row.sourceKey) as string,
                        row.referenceKind,
                        row.pages,
                        row.note,
                        row.legacyOrigin,
                        row.position,
                    ],
                }));
            await syncReported(
                transaction,
                runId,
                "citymap_source",
                sourceLinkSpec(),
                sourceRows,
                report.tables.citymap_source,
                findings,
            );
        }
    }

    // ---- Zuordnung des eigenen Wiki-Artikels (E5+, nur mit der Datei) ------------------------------------------------------------------
    if (report.privateFields.file) {
        const rows: ExpectedRow[] = transformed.assignments
            .filter((row) => !protectedMaps.has(row.mapPublicId))
            .map((row) => ({
                ref: { table: "citymap_wiki_assignment", publicId: row.mapPublicId, name: row.mapTitle },
                cells: [
                    idOf(row.mapPublicId),
                    row.assignment.wikiUrl,
                    row.assignment.articleKey,
                    row.assignment.articleTitle,
                    row.assignment.state,
                    row.assignment.origin,
                ],
            }));
        await syncReported(
            transaction,
            runId,
            "citymap_wiki_assignment",
            assignmentSpec(),
            rows,
            report.tables.citymap_wiki_assignment,
            findings,
        );
    }
}

/** Herkunft und Bauschlüssel der Karten, additiv für die Karten, die die Datei nennt; dazu `citymap_recreated`. */
async function enrichMaps(
    transaction: Queryable,
    runId: string,
    transformed: CitymapsTransform,
    idByKey: ReadonlyMap<string, string>,
    protectedMaps: ReadonlySet<string>,
    report: ImportCitymapsReport,
): Promise<void> {
    const entries = transformed.privateMaps.filter(
        (entry) => !protectedMaps.has(entry.publicId) && idByKey.has(entry.publicId),
    );
    if (entries.length === 0) return;
    const idOf = (publicId: string): string => idByKey.get(publicId) as string;
    let changed = 0;
    changed += await enrichRows(
        transaction,
        "citymap",
        [text("legacy_origin")],
        entries
            .filter((entry) => entry.origin !== null)
            .map((entry) => ({ id: idOf(entry.publicId), cells: [entry.origin] as Cell[] })),
        runId,
    );
    changed += await enrichRows(
        transaction,
        "citymap",
        [text("legacy_wiki_key")],
        entries
            .filter((entry) => entry.wikiKey !== null)
            .map((entry) => ({ id: idOf(entry.publicId), cells: [entry.wikiKey] as Cell[] })),
        runId,
    );
    report.privateFields.maps = changed;

    // Derselbe Wiki-Eintrag, neu angelegt: eine neue Karte teilt den Bauschlüssel mit einer stillgelegten (Information).
    const keys = entries.flatMap((entry) => (entry.wikiKey === null ? [] : [entry.wikiKey]));
    if (keys.length === 0) return;
    const rows = await transaction<{ public_id: string; title: string; other_title: string }[]>`
        SELECT n.public_id::text, n.title, o.title AS other_title
        FROM citymap n JOIN citymap o ON o.legacy_wiki_key = n.legacy_wiki_key AND o.id <> n.id AND NOT o.is_active
        WHERE n.is_active AND n.legacy_wiki_key = ANY(${keys}::text[])
        ORDER BY n.title, n.public_id
    `;
    if (rows.length > 0) {
        report.findings.push(
            createFinding(
                "citymap_recreated",
                `${String(rows.length)} Karten teilen den Bauschlüssel mit einer stillgelegten Karte: derselbe Wiki-Eintrag, neu angelegt (neue public_id); Information`,
                { karten: rows.length },
                rows.map((row) => ({ table: "citymap", publicId: row.public_id, name: row.title })),
            ),
        );
    }
}

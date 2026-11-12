import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import type { MapFeaturesPayload } from "./map-features.ts";
import { retireFinding } from "./retire-findings.ts";
import { regionLinkFindings, wikiTextLicenseFinding } from "./subject-details-findings.ts";
import {
    SUBJECT_DETAILS_CONTRACT_VERSION,
    transformSubjectDetails,
    type CarrierTargets,
    type NeighborRow,
    type PathSnapshotRow,
    type PlaceDetailRow,
    type PowerlineSnapshotRow,
    type RegionSnapshotRow,
    type SettlementSnapshotRow,
    type SubjectDetailsTransform,
    type SynonymRow,
    type TrafficLinkRow,
} from "./subject-details.ts";
import {
    emptyTableReport,
    replaceChildren,
    syncTable,
    type Cell,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";
import { AVENTURIA } from "@avesmaps3d/shared";
import { withZugSperre } from "../derive/derive-lock.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";

/**
 * Schreibt die Detailfelder und die Wiki-Zuordnung der Subjects idempotent in die Zieldatenbank (WI-0063 P3, Vertrag
 * `subject-details.yaml`, D6).
 *
 * EINE Transaktion für alles (Schnappschüsse, Kindzeilen, Zuordnungen, redaktionelle Felder, Stilllegen): Die Wirkung eines
 * Satzes auf einen Träger ist nie eine halbe. Der zweite Lauf mit demselben Satz findet nichts zu schreiben.
 *
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard). Ohne ihn rechnet der Lauf und rollt zurück
 * (`dryRun`), auch das Journal. Der Import schreibt nur `assigned` und `address_only`; eine Zeile mit `separated`,
 * `suppressed`, einer reservierten Herkunft (`editor`, `wiki_sync`, `bulk`) oder `retired_origin editor` fasst er nie an.
 */

export const SUBJECT_DETAIL_TABLES = [
    "wiki_settlement_snapshot",
    "wiki_settlement_traffic_link",
    "wiki_path_snapshot",
    "wiki_region_snapshot",
    "wiki_region_snapshot_neighbor",
    "wiki_region_snapshot_synonym",
    "wiki_powerline_snapshot",
    "place_wiki_assignment",
    "path_wiki_assignment",
    "terrain_peak_wiki_assignment",
    "powerline_wiki_assignment",
    "place_detail",
] as const;

export type SubjectDetailTable = (typeof SUBJECT_DETAIL_TABLES)[number];

export interface ImportSubjectDetailsOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
}

export interface ImportSubjectDetailsReport {
    runId: string;
    sourceRef: string;
    revision: number;
    dryRun: boolean;
    tables: Record<SubjectDetailTable, TableReport>;
    /** Hat der Lauf etwas geschrieben (angelegt, geändert oder stillgelegt)? */
    changed: boolean;
    findings: Finding[];
}

/** Die Ids der aktiven Träger, für die Fremdschlüssel. */
export interface CarrierIds {
    places: Map<string, string>;
    paths: Map<string, string>;
    powerlines: Map<string, string>;
    peaks: Map<string, string>;
}

/** Liest die Träger: die Ids der aktiven Zeilen und was die reine Umwandlung über sie wissen muss. */
export async function readCarriers(database: Queryable): Promise<{ ids: CarrierIds; targets: CarrierTargets }> {
    const idMap = async (rows: { id: string; public_id: string }[]): Promise<Map<string, string>> =>
        new Map(rows.map((row) => [row.public_id, row.id]));
    const places = await idMap(
        await database<
            { id: string; public_id: string }[]
        >`SELECT id::text, public_id::text FROM place WHERE is_active`,
    );
    const paths = await idMap(
        await database<{ id: string; public_id: string }[]>`SELECT id::text, public_id::text FROM path WHERE is_active`,
    );
    const powerlines = await idMap(
        await database<
            { id: string; public_id: string }[]
        >`SELECT id::text, public_id::text FROM powerline WHERE is_active`,
    );
    const peakRows = await database<{ id: string; public_id: string; is_active: boolean }[]>`
        SELECT id::text, public_id::text, is_active FROM terrain_peak
    `;
    const labelRows = await database<
        { public_id: string; is_active: boolean }[]
    >`SELECT public_id::text, is_active FROM map_label`;
    return {
        ids: {
            places,
            paths,
            powerlines,
            peaks: new Map(peakRows.filter((row) => row.is_active).map((row) => [row.public_id, row.id])),
        },
        targets: {
            places: new Set(places.keys()),
            paths: new Set(paths.keys()),
            powerlines: new Set(powerlines.keys()),
            labels: new Map(labelRows.map((row) => [row.public_id, row.is_active])),
            peaks: new Map(peakRows.map((row) => [row.public_id, row.is_active])),
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Spalten und Schlüssel
// ---------------------------------------------------------------------------------------------------------------------

const text = (name: string): Col => ({ name, type: "text" });

export const SETTLEMENT_SNAPSHOT_COLUMNS: readonly Col[] = [
    text("wiki_key"),
    text("wiki_url"),
    text("wiki_title"),
    text("wiki_name"),
    text("description"),
    text("einwohner"),
    text("oberhaupt"),
    text("region_text"),
    text("staat_text"),
    text("handelszone"),
    text("verkehrswege"),
    text("bevoelkerung"),
    text("tempel"),
    text("building_type"),
    { name: "is_ruined", type: "boolean" },
    { name: "synced_at", type: "timestamptz" },
    // Die Ortsgröße laut Wiki (WI-0225, Migration 0184).
    text("settlement_class"),
    { name: "settlement_class_guessed", type: "boolean" },
];
export const PATH_SNAPSHOT_COLUMNS: readonly Col[] = [
    text("wiki_key"),
    text("wiki_url"),
    text("name"),
    text("kind"),
    text("art"),
    text("lage"),
    text("verlauf"),
    text("laenge"),
    text("description"),
    { name: "is_lean", type: "boolean" },
    { name: "synced_at", type: "timestamptz" },
];
export const REGION_SNAPSHOT_COLUMNS: readonly Col[] = [
    text("wiki_key"),
    text("wiki_url"),
    text("name"),
    text("art"),
    text("continent"),
    text("region_parent"),
    text("affiliation_staat"),
    text("einwohner"),
    text("sprache"),
    text("vegetation"),
    text("verkehrswege"),
    text("description"),
    { name: "synced_at", type: "timestamptz" },
];
export const POWERLINE_SNAPSHOT_COLUMNS: readonly Col[] = [
    text("wiki_key"),
    text("wiki_url"),
    text("name"),
    text("staerke"),
    text("affinitaet"),
    text("laenge"),
    text("regionen"),
    text("verlauf"),
    text("description"),
    { name: "synced_at", type: "timestamptz" },
];
const TRAFFIC_LINK_COLUMNS: readonly Col[] = [{ name: "position", type: "int" }, text("link_text"), text("path_name")];
const NEIGHBOR_COLUMNS: readonly Col[] = [text("direction"), { name: "position", type: "int" }, text("name")];
const SYNONYM_COLUMNS: readonly Col[] = [{ name: "position", type: "int" }, text("text")];

const ASSIGNMENT_TAIL: readonly Col[] = [
    text("wiki_url"),
    { name: "snapshot_id", type: "bigint" },
    text("assignment_state"),
    text("assignment_origin"),
];
const PLACE_ASSIGNMENT_COLUMNS: readonly Col[] = [{ name: "place_id", type: "bigint" }, ...ASSIGNMENT_TAIL];
const PATH_ASSIGNMENT_COLUMNS: readonly Col[] = [{ name: "path_id", type: "bigint" }, text("role"), ...ASSIGNMENT_TAIL];
const PEAK_ASSIGNMENT_COLUMNS: readonly Col[] = [{ name: "terrain_peak_id", type: "bigint" }, ...ASSIGNMENT_TAIL];
const POWERLINE_ASSIGNMENT_COLUMNS: readonly Col[] = [{ name: "powerline_id", type: "bigint" }, ...ASSIGNMENT_TAIL];
export const PLACE_DETAIL_COLUMNS: readonly Col[] = [
    { name: "place_id", type: "bigint" },
    text("description"),
    text("einwohner"),
    text("lage"),
    text("oberhaupt"),
    text("einwohner_origin"),
    text("lage_origin"),
    text("oberhaupt_origin"),
];

/** Die Zellen einer Zeile, in der Reihenfolge der Spalten; der Import und der Prüfer schreiben und lesen sie gleich. */
export const settlementSnapshotCells = (row: SettlementSnapshotRow): Cell[] => [
    row.wikiKey,
    row.wikiUrl,
    row.wikiTitle,
    row.wikiName,
    row.description,
    row.einwohner,
    row.oberhaupt,
    row.regionText,
    row.staatText,
    row.handelszone,
    row.verkehrswege,
    row.bevoelkerung,
    row.tempel,
    row.buildingType,
    row.isRuined,
    row.syncedAt,
    row.settlementClass,
    row.settlementClassGuessed,
];
export const pathSnapshotCells = (row: PathSnapshotRow): Cell[] => [
    row.wikiKey,
    row.wikiUrl,
    row.name,
    row.kind,
    row.art,
    row.lage,
    row.verlauf,
    row.laenge,
    row.description,
    row.isLean,
    row.syncedAt,
];
export const regionSnapshotCells = (row: RegionSnapshotRow): Cell[] => [
    row.wikiKey,
    row.wikiUrl,
    row.name,
    row.art,
    row.continent,
    row.regionParent,
    row.affiliationStaat,
    row.einwohner,
    row.sprache,
    row.vegetation,
    row.verkehrswege,
    row.description,
    row.syncedAt,
];
export const powerlineSnapshotCells = (row: PowerlineSnapshotRow): Cell[] => [
    row.wikiKey,
    row.wikiUrl,
    row.name,
    row.staerke,
    row.affinitaet,
    row.laenge,
    row.regionen,
    row.verlauf,
    row.description,
    row.syncedAt,
];
export const trafficLinkCells = (row: TrafficLinkRow): Cell[] => [row.position, row.linkText, row.pathName];
export const neighborCells = (row: NeighborRow): Cell[] => [row.direction, row.position, row.name];
export const synonymCells = (row: SynonymRow): Cell[] => [row.position, row.text];
export const placeDetailCells = (carrierId: string, row: PlaceDetailRow): Cell[] => [
    carrierId,
    row.description,
    row.einwohner,
    row.lage,
    row.oberhaupt,
    row.einwohnerOrigin,
    row.lageOrigin,
    row.oberhauptOrigin,
];

/** Zeilen, die der Import nie anfasst: ein Entscheid (getrennt, unterdrückt) oder eine Herkunft, die nicht aus Legacy kommt. */
const PROTECTED_ASSIGNMENT =
    "t.assignment_state IN ('separated', 'suppressed') OR t.assignment_origin IN ('editor', 'wiki_sync', 'bulk')";

const first = (cells: readonly Cell[]): string => String(cells[0]);

const byKeySpec = (table: string, columns: readonly Col[]): SyncSpec => ({
    table,
    columns,
    keyOf: first,
    describe: { join: "", publicId: "t.wiki_key", name: "t.wiki_url" },
});

function assignmentSpec(
    table: string,
    columns: readonly Col[],
    carrierTable: string,
    carrierColumn: string,
    keyOf: (cells: readonly Cell[]) => string,
): SyncSpec {
    return {
        table,
        columns,
        keyOf,
        protectedWhere: PROTECTED_ASSIGNMENT,
        describe: {
            join: `JOIN ${carrierTable} c ON c.id = t.${carrierColumn}`,
            publicId: "c.public_id::text",
            name: "c.name",
        },
    };
}

class DryRunRollback extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Der Import
// ---------------------------------------------------------------------------------------------------------------------

export function importSubjectDetails(
    database: Database,
    payload: MapFeaturesPayload,
    options: ImportSubjectDetailsOptions = {},
): Promise<ImportSubjectDetailsReport> {
    return withZugSperre(database, AVENTURIA.mapDomain, "I17 Detailfelder und Wiki-Zuordnung", () =>
        importSubjectDetailsLocked(database, payload, options),
    );
}

/** Der Körper von `importSubjectDetails`, unter der Sperre des Zugs. */
async function importSubjectDetailsLocked(
    database: Database,
    payload: MapFeaturesPayload,
    options: ImportSubjectDetailsOptions = {},
): Promise<ImportSubjectDetailsReport> {
    const runId = randomUUID();
    const sourceRef = `map_revision=${String(payload.revision ?? "unknown")}`;
    const tables = Object.fromEntries(SUBJECT_DETAIL_TABLES.map((name) => [name, emptyTableReport()])) as Record<
        SubjectDetailTable,
        TableReport
    >;
    const report: ImportSubjectDetailsReport = {
        runId,
        sourceRef,
        revision: Number(payload.revision),
        dryRun: options.dryRun === true,
        tables,
        changed: false,
        findings: [],
    };

    try {
        await database.begin(async (transaction) => {
            const { ids, targets } = await readCarriers(transaction);
            // A13 steht in der Umwandlung: eine unvollständige Quelle hält an, bevor etwas geschrieben ist.
            const transformed = transformSubjectDetails(payload, targets);
            report.findings.push(...transformed.findings);

            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'subject-details', 'avesmaps-legacy', ${sourceRef}, ${SUBJECT_DETAILS_CONTRACT_VERSION})
            `;

            // 🔴 WI-0253 D-1: Gehören die Kraftlinien in dieser Umgebung dem WikiSync, lässt der Zug ihren Teil aus – Wiki-Stand und Zuordnung je Abschnitt. Alles andere
            // (Orte, Wege, Landschaften, Gipfel) schreibt er wie bisher.
            const kraftlinienAusgelassen = (await wikisyncBereiche(transaction)).has("kraftlinie");
            if (kraftlinienAusgelassen) {
                report.findings.push(
                    createFinding(
                        "bereich_wikisync",
                        "Die Kraftlinien gehören in dieser Umgebung dem WikiSync; der Zug lässt ihren Wiki-Stand und ihre Zuordnung aus",
                        { bereich: "kraftlinie" },
                    ),
                );
            }
            await writeAll(transaction, runId, ids, transformed, report, kraftlinienAusgelassen);

            // Befunde, die die Datenbank nach dem Schreiben braucht.
            report.findings.push(
                ...(await regionLinkFindings(
                    transaction,
                    transformed.boundLabelNests.map((nest) => nest.publicId),
                )),
            );
            const license = await wikiTextLicenseFinding(transaction, [
                ...transformed.settlementSnapshots.map((row) => row.wikiUrl),
                ...transformed.pathSnapshots.map((row) => row.wikiUrl),
                ...transformed.regionSnapshots.map((row) => row.wikiUrl),
                ...(kraftlinienAusgelassen ? [] : transformed.powerlineSnapshots.map((row) => row.wikiUrl)),
            ]);
            if (license) report.findings.push(license);

            report.changed = Object.values(tables).some((table) => table.created + table.updated + table.retired > 0);
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables,
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

interface Expected {
    cells: Cell[];
    ref: FindingObject;
}

/** Gleicht eine Tabelle ab und trägt Zahlen und Befunde (Stilllegequote, Entscheid, Wiederaufleben) in den Bericht. */
async function runTable(
    transaction: Queryable,
    runId: string,
    report: ImportSubjectDetailsReport,
    name: SubjectDetailTable,
    spec: SyncSpec,
    rows: readonly Expected[],
): Promise<Map<string, string>> {
    const result = await syncTable(
        transaction,
        spec,
        rows.map((row) => row.cells),
        { runId },
    );
    const table = report.tables[name];
    table.created = result.created;
    table.updated = result.updated;
    table.unchanged = result.unchanged;
    table.retired = result.retired;
    table.protectedRows = result.protectedHits.length;
    table.reappeared = result.reappeared.length;

    const refByKey = new Map(rows.map((row) => [spec.keyOf(row.cells), row.ref]));
    const objectsOf = (keys: readonly string[]): FindingObject[] =>
        keys.map((key) => refByKey.get(key)).filter((ref): ref is FindingObject => ref !== undefined);

    const quota = await retireFinding(name, result.pressure, async () => result.retiring);
    if (quota) report.findings.push(quota);
    if (result.protectedHits.length > 0) {
        report.findings.push(
            createFinding(
                "wiki_assignment_vs_decision",
                `${name}: der Satz bringt ein Nest für ${String(result.protectedHits.length)} Träger mit einem Entscheid (separated, suppressed) oder einer Herkunft, die nicht aus Legacy kommt; die Zeile bleibt`,
                { table: name, traeger: result.protectedHits.length },
                objectsOf(result.protectedHits),
            ),
        );
    }
    if (result.reappeared.length > 0) {
        report.findings.push(
            createFinding(
                "assignment_reappeared",
                `${name}: ${String(result.reappeared.length)} Zeilen, die der Import stillgelegt hatte, sind wieder da`,
                { table: name, zeilen: result.reappeared.length },
                objectsOf(result.reappeared),
            ),
        );
    }
    return result.idByKey;
}

/**
 * Schlüssel einer Wegzuordnung (Spalten: Weg, Rolle, Adresse, Schnappschuss, Zustand, Herkunft): die Hauptzuweisung je Weg, jede
 * weitere je Weg und Artikel. Die Hauptzuweisung behält ihre Zeile, wenn Legacy sie umweist.
 */
export const pathAssignmentKey = (cells: readonly Cell[]): string =>
    cells[1] === "main" ? `${String(cells[0])}|main` : `${String(cells[0])}|further|${String(cells[3])}`;

async function writeAll(
    transaction: Queryable,
    runId: string,
    ids: CarrierIds,
    transformed: SubjectDetailsTransform,
    report: ImportSubjectDetailsReport,
    kraftlinienAusgelassen = false,
): Promise<void> {
    const ref = (table: string, publicId: string, name: string | null): FindingObject => ({ table, publicId, name });
    const sameRef = (table: string, row: { wikiKey: string; wikiUrl: string }): FindingObject =>
        ref(table, row.wikiKey, row.wikiUrl);

    // ---- Schnappschüsse -------------------------------------------------------------------------------------------
    const settlementIds = await runTable(
        transaction,
        runId,
        report,
        "wiki_settlement_snapshot",
        byKeySpec("wiki_settlement_snapshot", SETTLEMENT_SNAPSHOT_COLUMNS),
        transformed.settlementSnapshots.map((row) => ({
            ref: sameRef("wiki_settlement_snapshot", row),
            cells: settlementSnapshotCells(row),
        })),
    );
    const traffic = new Map<string, Cell[][]>();
    for (const row of transformed.settlementSnapshots) {
        traffic.set(settlementIds.get(row.wikiKey) as string, row.trafficLinks.map(trafficLinkCells));
    }
    applyChildren(
        report,
        "wiki_settlement_traffic_link",
        await replaceChildren(
            transaction,
            "wiki_settlement_traffic_link",
            "snapshot_id",
            TRAFFIC_LINK_COLUMNS,
            traffic,
        ),
    );

    const pathSnapshotIds = await runTable(
        transaction,
        runId,
        report,
        "wiki_path_snapshot",
        byKeySpec("wiki_path_snapshot", PATH_SNAPSHOT_COLUMNS),
        transformed.pathSnapshots.map((row) => ({
            ref: sameRef("wiki_path_snapshot", row),
            cells: pathSnapshotCells(row),
        })),
    );

    const regionIds = await runTable(
        transaction,
        runId,
        report,
        "wiki_region_snapshot",
        byKeySpec("wiki_region_snapshot", REGION_SNAPSHOT_COLUMNS),
        transformed.regionSnapshots.map((row) => ({
            ref: sameRef("wiki_region_snapshot", row),
            cells: regionSnapshotCells(row),
        })),
    );
    const neighbors = new Map<string, Cell[][]>();
    const synonyms = new Map<string, Cell[][]>();
    for (const row of transformed.regionSnapshots) {
        const id = regionIds.get(row.wikiKey) as string;
        neighbors.set(id, row.neighbors.map(neighborCells));
        synonyms.set(id, row.synonyms.map(synonymCells));
    }
    applyChildren(
        report,
        "wiki_region_snapshot_neighbor",
        await replaceChildren(transaction, "wiki_region_snapshot_neighbor", "snapshot_id", NEIGHBOR_COLUMNS, neighbors),
    );
    applyChildren(
        report,
        "wiki_region_snapshot_synonym",
        await replaceChildren(transaction, "wiki_region_snapshot_synonym", "snapshot_id", SYNONYM_COLUMNS, synonyms),
    );

    // Die Kraftlinien gehören dem WikiSync (D-1): ihren Wiki-Stand und ihre Zuordnung schreibt der Zug nicht (und legt auch nichts still).
    const powerlineSnapshotIds = kraftlinienAusgelassen
        ? new Map<string, string>()
        : await runTable(
              transaction,
              runId,
              report,
              "wiki_powerline_snapshot",
              byKeySpec("wiki_powerline_snapshot", POWERLINE_SNAPSHOT_COLUMNS),
              transformed.powerlineSnapshots.map((row) => ({
                  ref: sameRef("wiki_powerline_snapshot", row),
                  cells: powerlineSnapshotCells(row),
              })),
          );

    // ---- Zuordnungen ------------------------------------------------------------------------------------------------
    const idOf = (map: Map<string, string>, publicId: string, what: string): string => {
        const id = map.get(publicId);
        if (id === undefined)
            throw new Error(`${what} ${publicId}: kein aktiver Träger (die Umwandlung hat ihn geprüft)`);
        return id;
    };
    const snapshotOf = (map: Map<string, string>, key: string | null): string | null => {
        if (key === null) return null;
        const id = map.get(key);
        if (id === undefined) throw new Error(`Schnappschuss ${key} fehlt (die Umwandlung hat ihn angelegt)`);
        return id;
    };

    await runTable(
        transaction,
        runId,
        report,
        "place_wiki_assignment",
        assignmentSpec("place_wiki_assignment", PLACE_ASSIGNMENT_COLUMNS, "place", "place_id", first),
        transformed.placeAssignments.map((row) => ({
            ref: ref("place", row.publicId, row.name),
            cells: [
                idOf(ids.places, row.publicId, "Ort"),
                row.wikiUrl,
                snapshotOf(settlementIds, row.snapshotKey),
                row.state,
                row.origin,
            ],
        })),
    );
    await runTable(
        transaction,
        runId,
        report,
        "path_wiki_assignment",
        assignmentSpec("path_wiki_assignment", PATH_ASSIGNMENT_COLUMNS, "path", "path_id", pathAssignmentKey),
        transformed.pathAssignments.map((row) => ({
            ref: ref("path", row.publicId, row.name),
            cells: [
                idOf(ids.paths, row.publicId, "Weg"),
                row.role,
                row.wikiUrl,
                snapshotOf(pathSnapshotIds, row.snapshotKey),
                row.state,
                row.origin,
            ],
        })),
    );
    await runTable(
        transaction,
        runId,
        report,
        "terrain_peak_wiki_assignment",
        assignmentSpec(
            "terrain_peak_wiki_assignment",
            PEAK_ASSIGNMENT_COLUMNS,
            "terrain_peak",
            "terrain_peak_id",
            first,
        ),
        transformed.peakAssignments.map((row) => ({
            ref: ref("terrain_peak", row.publicId, row.name),
            cells: [
                idOf(ids.peaks, row.publicId, "Gipfel"),
                row.wikiUrl,
                snapshotOf(regionIds, row.snapshotKey),
                row.state,
                row.origin,
            ],
        })),
    );
    if (!kraftlinienAusgelassen) {
        await runTable(
            transaction,
            runId,
            report,
            "powerline_wiki_assignment",
            assignmentSpec(
                "powerline_wiki_assignment",
                POWERLINE_ASSIGNMENT_COLUMNS,
                "powerline",
                "powerline_id",
                first,
            ),
            transformed.powerlineAssignments.map((row) => ({
                ref: ref("powerline", row.publicId, row.name),
                cells: [
                    idOf(ids.powerlines, row.publicId, "Kraftlinie"),
                    row.wikiUrl,
                    snapshotOf(powerlineSnapshotIds, row.snapshotKey),
                    row.state,
                    row.origin,
                ],
            })),
        );
    }

    // ---- Redaktionelle Felder -----------------------------------------------------------------------------------------
    await runTable(
        transaction,
        runId,
        report,
        "place_detail",
        {
            table: "place_detail",
            columns: PLACE_DETAIL_COLUMNS,
            keyOf: first,
            // Stilllegen leert die Felder: Ein entferntes Feld wird NULL (Legacy löscht den Schlüssel).
            retiredSet:
                "description = NULL, einwohner = NULL, lage = NULL, oberhaupt = NULL, einwohner_origin = NULL, lage_origin = NULL, oberhaupt_origin = NULL",
            describe: { join: "JOIN place c ON c.id = t.place_id", publicId: "c.public_id::text", name: "c.name" },
        },
        transformed.placeDetails.map((row) => ({
            ref: ref("place", row.placePublicId, row.name),
            cells: placeDetailCells(idOf(ids.places, row.placePublicId, "Ort"), row),
        })),
    );
}

function applyChildren(
    report: ImportSubjectDetailsReport,
    name: SubjectDetailTable,
    result: { created: number; retired: number; unchanged: number },
): void {
    const table = report.tables[name];
    table.created = result.created;
    table.retired = result.retired;
    table.unchanged = result.unchanged;
}

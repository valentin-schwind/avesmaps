import { randomUUID } from "node:crypto";
import { AVENTURIA } from "@avesmaps3d/shared";
import { withZugSperre } from "../derive/derive-lock.ts";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    DETAIL_FIELDS,
    TERRITORY_DETAILS_CONTRACT_VERSION,
    transformTerritoryDetails,
    type CoatSummary,
    type DetailField,
    type DetailRow,
    type DetailTerritory,
    type FieldCount,
    type SnapshotRow,
    type TerritoryDetailIndex,
    type TerritoryDetailsTransform,
} from "./territory-details.ts";
import {
    emptyTableReport,
    replaceChildren,
    syncTable,
    type Cell,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";

/**
 * Schreibt die Gebietsdetails (17 Felder mit Herkunft je Feld) idempotent in die Zieldatenbank (WI-0063 P3, Vertrag
 * `territory-details.yaml`, Migration 0076). Quelle ist dieselbe `legacy-political-territories.json` wie bei I14, kein neuer Abruf.
 *
 * EINE Transaktion für alles (Detailzeilen, Herkunftsvermerke, Stilllegen), damit die Stilllegequote über den Satz gilt. Der zweite
 * Lauf mit demselben Satz findet nichts zu schreiben.
 *
 * 🔴 Drei Zustände je Feld: NULL (kein Wert), `''` (bewusster Leerwert, leerer Override: bleibt `''`, wird nie NULL) und Text. Eine Zeile
 * gibt es nur, wenn mindestens ein Feld einen Wert trägt; verliert ein Gebiet alle, wird die Zeile stillgelegt (Felder und Vermerke
 * geleert), nie gelöscht. Eine Zeile mit `state suppressed` oder `retired_origin editor` fasst der Import nie an (Kapitel 9.37).
 * 🔴 Der Wappenzustand wird NICHT geschrieben (Vertrag `transaktionsgrenze`): der Lauf rechnet die Abbildung auf den Media Core nur durch
 * und meldet sie (`coatSummary`, Befunde `coat_*`); `territory_media` und `territory_media_suppression` schreibt der Medienimport.
 * Dazu der Wiki-Schnappschuss (WI-0209, Migration 0162): `wiki_territory_snapshot` je Gebietsartikel und `wiki_territory_snapshot_unknown` je
 * Feld mit unbekanntem Wiki-Wert, in derselben Transaktion; ein Artikel, den kein Gebiet mehr trägt, wird stillgelegt. Fehlt Migration
 * 0162, entfällt dieser Teil mit dem Befund `migration_missing`.
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück.
 * 🔴 Trägt kein Gebiet das Objekt `detail`, schreibt der Schritt nichts, legt nichts still und meldet `source_block_missing`; der Lauf
 * geht weiter (kein Tor, Betreiber 2026-10-03).
 */

export const TERRITORY_DETAIL_TABLES = [
    "territory_detail",
    "territory_detail_field_origin",
    "wiki_territory_snapshot",
    "wiki_territory_snapshot_unknown",
] as const;
export type TerritoryDetailTable = (typeof TERRITORY_DETAIL_TABLES)[number];

export interface ImportTerritoryDetailsOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
}

export interface ImportTerritoryDetailsReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Kein Gebiet trug `detail` (älterer Export): nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    detailPart: TerritoryDetailsTransform["detailPart"];
    coatPart: TerritoryDetailsTransform["coatPart"];
    tables: Record<TerritoryDetailTable, TableReport>;
    territories: number;
    withDetail: number;
    withCoat: number;
    /** Gespeicherte Detailzeilen (Gebiete mit mindestens einem Wert). */
    stored: number;
    fieldCounts: Record<DetailField, FieldCount>;
    coatSummary: CoatSummary;
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });

export const DETAIL_COLUMNS: readonly Col[] = [{ name: "territory_id", type: "bigint" }, ...DETAIL_FIELDS.map(text)];
export const ORIGIN_COLUMNS: readonly Col[] = [text("field"), text("origin")];
export const SNAPSHOT_COLUMNS: readonly Col[] = [text("wiki_key"), ...DETAIL_FIELDS.map(text)];
export const UNKNOWN_COLUMNS: readonly Col[] = [text("field")];

/** Die Zellen eines Schnappschusses, in der Reihenfolge von `SNAPSHOT_COLUMNS`. */
export const snapshotCells = (row: SnapshotRow): Cell[] => [
    row.wikiKey,
    ...DETAIL_FIELDS.map((field) => row.values[field]),
];

/** Die Zellen einer Detailzeile, in der Reihenfolge von `DETAIL_COLUMNS`; der Import und der Prüfer schreiben und lesen sie gleich. */
export const detailCells = (row: DetailRow): Cell[] => [
    row.territoryId,
    ...DETAIL_FIELDS.map((field) => row.values[field]),
];

/** Die Herkunftsvermerke einer Detailzeile als Zellen von `ORIGIN_COLUMNS`, in der Reihenfolge der Felder. */
export const originCells = (row: DetailRow): Cell[][] =>
    DETAIL_FIELDS.flatMap((field) => {
        const origin = row.origins[field];
        return origin === undefined ? [] : [[field, origin]];
    });

const first = (cells: readonly Cell[]): string => String(cells[0]);

const detailSpec: SyncSpec = {
    table: "territory_detail",
    columns: DETAIL_COLUMNS,
    keyOf: first,
    // Eine Zeile des Editors (suppressed, oder mit retired_origin editor stillgelegt, das prüft der Abgleich selbst) fasst der Import nie an.
    protectedWhere: "t.state = 'suppressed'",
    // Stilllegen leert die Felder (wie place_detail): ein entferntes Feld wird NULL, Legacy löscht den Schlüssel.
    retiredSet: `state = 'retired', ${DETAIL_FIELDS.map((field) => `${field} = NULL`).join(", ")}`,
    activeSet: "state = 'active'",
    insertConstants: { state: "'active'" },
    describe: { join: "JOIN territory c ON c.id = t.territory_id", publicId: "c.public_id::text", name: "c.name" },
};

const snapshotSpec: SyncSpec = {
    table: "wiki_territory_snapshot",
    columns: SNAPSHOT_COLUMNS,
    keyOf: first,
    // Stilllegen leert die Felder; die Kindzeilen „unbekannt“ gehen mit.
    retiredSet: DETAIL_FIELDS.map((field) => `${field} = NULL`).join(", "),
};

class DryRunRollback extends Error {}

/** Liest die Gebiete (nach Kennung) für die Zuordnung. */
export async function readTerritoryDetailIndex(database: Queryable): Promise<TerritoryDetailIndex> {
    const rows = await database<
        {
            id: string;
            public_id: string;
            name: string;
            is_active: boolean;
            wiki_key: string | null;
        }[]
    >`
        SELECT id::text, public_id::text, name, is_active, wiki_key FROM territory
    `;
    const index = new Map<string, DetailTerritory>();
    for (const row of rows) {
        index.set(row.public_id.toLowerCase(), {
            id: row.id,
            publicId: row.public_id,
            name: row.name,
            active: row.is_active,
            wikiKey: row.wiki_key,
        });
    }
    return index;
}

/**
 * Seit der Gebietseditor die Detailfelder schreibt (WI-0209 G6), stehen `territory_detail` und `territory_detail_field_origin` in
 * `EDITOR_TABELLEN`: Der Import nimmt die Sperre des Zugs exklusiv (`withZugSperre`, EDIT-0003 T17), damit kein Speichern zwischen seine
 * Zeilen fällt, wie der Gebietsimport (I14).
 */
export function importTerritoryDetails(
    database: Database,
    payload: unknown,
    options: ImportTerritoryDetailsOptions = {},
): Promise<ImportTerritoryDetailsReport> {
    return withZugSperre(database, AVENTURIA.mapDomain, "I23 Gebietsdetails", () =>
        importTerritoryDetailsLocked(database, payload, options),
    );
}

/** Der Körper von `importTerritoryDetails`, unter der Sperre des Zugs. */
async function importTerritoryDetailsLocked(
    database: Database,
    payload: unknown,
    options: ImportTerritoryDetailsOptions,
): Promise<ImportTerritoryDetailsReport> {
    const runId = randomUUID();
    const head = payload as { territories_revision?: unknown; map_revision?: unknown } | null;
    const sourceRef = `territories_revision=${typeof head?.territories_revision === "string" ? head.territories_revision : "unbekannt"};map_revision=${typeof head?.map_revision === "number" ? String(head.map_revision) : "unbekannt"}`;
    const report: ImportTerritoryDetailsReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: false,
        detailPart: "block_missing",
        coatPart: "block_missing",
        tables: Object.fromEntries(TERRITORY_DETAIL_TABLES.map((name) => [name, emptyTableReport()])) as Record<
            TerritoryDetailTable,
            TableReport
        >,
        territories: 0,
        withDetail: 0,
        withCoat: 0,
        stored: 0,
        fieldCounts: Object.fromEntries(
            DETAIL_FIELDS.map((field) => [field, { values: 0, empty: 0, missing: 0 }]),
        ) as Record<DetailField, FieldCount>,
        coatSummary: {} as CoatSummary,
        changed: false,
        findings: [],
    };
    try {
        await database.begin(async (transaction) => {
            const index = await readTerritoryDetailIndex(transaction);
            const transformed = transformTerritoryDetails(payload, index);
            report.findings.push(...transformed.findings);
            report.detailPart = transformed.detailPart;
            report.coatPart = transformed.coatPart;
            report.territories = transformed.territories;
            report.withDetail = transformed.withDetail;
            report.withCoat = transformed.withCoat;
            report.fieldCounts = transformed.fieldCounts;
            report.coatSummary = transformed.coatSummary;
            if (transformed.detailPart === "block_missing") {
                report.skipped = true;
                return;
            }
            report.stored = transformed.details.length;
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'territory-details', 'avesmaps-legacy', ${sourceRef}, ${TERRITORY_DETAILS_CONTRACT_VERSION})
            `;
            await writeAll(transaction, runId, transformed.details, report);
            const [snapshotTable] = await transaction<{ present: string | null }[]>`
                SELECT to_regclass('wiki_territory_snapshot')::text AS present
            `;
            if (snapshotTable?.present != null) await writeSnapshots(transaction, runId, transformed.snapshots, report);
            else
                report.findings.push(
                    createFinding(
                        "migration_missing",
                        "Migration 0162_wiki_territory_snapshot ist in dieser Datenbank nicht angewendet; der Wiki-Schnappschuss der Gebiete bleibt ungeschrieben (npm run db:migrate)",
                        { migration: "0162_wiki_territory_snapshot" },
                    ),
                );

            report.changed = TERRITORY_DETAIL_TABLES.some((name) => {
                const table = report.tables[name];
                return table.created + table.updated + table.retired > 0;
            });
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables: report.tables,
                        territories: report.territories,
                        with_detail: report.withDetail,
                        with_coat: report.withCoat,
                        stored: report.stored,
                        field_counts: report.fieldCounts,
                        coat: report.coatSummary,
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
    details: readonly DetailRow[],
    report: ImportTerritoryDetailsReport,
): Promise<void> {
    const refByKey = new Map<string, FindingObject>(
        details.map((row) => [
            row.territoryId,
            { table: "territory", publicId: row.territoryPublicId, name: row.territoryName },
        ]),
    );
    const objectsOf = (keys: readonly string[]): FindingObject[] =>
        keys.map((key) => refByKey.get(key)).filter((ref): ref is FindingObject => ref !== undefined);

    const result = await syncTable(transaction, detailSpec, details.map(detailCells), { runId });
    const table = report.tables.territory_detail;
    table.created = result.created;
    table.updated = result.updated;
    table.unchanged = result.unchanged;
    table.retired = result.retired;
    table.protectedRows = result.protectedHits.length;
    table.reappeared = result.reappeared.length;

    const quota = await retireFinding("territory_detail", result.pressure, async () => result.retiring);
    if (quota) report.findings.push(quota);
    if (result.protectedHits.length > 0) {
        report.findings.push(
            createFinding(
                "row_vs_decision",
                `territory_detail: der Satz bringt Detailfelder für ${String(result.protectedHits.length)} Gebiete, deren Zeile der Editor unterdrückt oder stillgelegt hat; die Zeile bleibt (Kapitel 9.37)`,
                { gebiete: result.protectedHits.length },
                objectsOf(result.protectedHits),
            ),
        );
    }
    if (result.reappeared.length > 0) {
        report.findings.push(
            createFinding(
                "row_reappeared",
                `territory_detail: ${String(result.reappeared.length)} Zeilen, die der Import stillgelegt hatte, sind wieder da`,
                { gebiete: result.reappeared.length },
                objectsOf(result.reappeared),
            ),
        );
    }

    // ---- Herkunft je Feld ---------------------------------------------------------------------------------------------------------
    const protectedKeys = new Set(result.protectedHits);
    const expectedOrigins = new Map<string, Cell[][]>();
    for (const row of details) {
        const key = String(row.territoryId);
        const id = result.idByKey.get(key);
        if (id === undefined || protectedKeys.has(key)) continue;
        expectedOrigins.set(id, originCells(row));
    }
    const origins = await replaceChildren(
        transaction,
        "territory_detail_field_origin",
        "territory_detail_id",
        ORIGIN_COLUMNS,
        expectedOrigins,
        "field",
    );
    // Die Vermerke einer vom Import stillgelegten Zeile sind mit ihren Feldern weg (keine Werte, also auch keine Herkunft).
    const dropped = await transaction<{ territory_detail_id: string }[]>`
        DELETE FROM territory_detail_field_origin o
        USING territory_detail d
        WHERE d.id = o.territory_detail_id AND d.state = 'retired' AND d.retired_origin = 'import'
        RETURNING o.territory_detail_id::text
    `;
    const originTable = report.tables.territory_detail_field_origin;
    originTable.created = origins.created;
    originTable.unchanged = origins.unchanged;
    originTable.retired = origins.retired + dropped.length;
}

/** Der Wiki-Schnappschuss (Migration 0162): Zeilen je Artikel abgleichen, die Felder „unbekannt“ je Zeile ersetzen. */
async function writeSnapshots(
    transaction: Queryable,
    runId: string,
    snapshots: readonly SnapshotRow[],
    report: ImportTerritoryDetailsReport,
): Promise<void> {
    const result = await syncTable(transaction, snapshotSpec, snapshots.map(snapshotCells), { runId });
    const table = report.tables.wiki_territory_snapshot;
    table.created = result.created;
    table.updated = result.updated;
    table.unchanged = result.unchanged;
    table.retired = result.retired;
    table.reappeared = result.reappeared.length;
    const quota = await retireFinding("wiki_territory_snapshot", result.pressure, async () => result.retiring);
    if (quota) report.findings.push(quota);

    const expected = new Map<string, Cell[][]>();
    for (const row of snapshots) {
        const id = result.idByKey.get(row.wikiKey);
        if (id !== undefined)
            expected.set(
                id,
                row.unknown.map((field) => [field]),
            );
    }
    const unknown = await replaceChildren(
        transaction,
        "wiki_territory_snapshot_unknown",
        "snapshot_id",
        UNKNOWN_COLUMNS,
        expected,
        "field",
    );
    // Die Kindzeilen eines stillgelegten Schnappschusses sind mit seinen Feldern weg.
    const dropped = await transaction<{ snapshot_id: string }[]>`
        DELETE FROM wiki_territory_snapshot_unknown u
        USING wiki_territory_snapshot s
        WHERE s.id = u.snapshot_id AND NOT s.is_active
        RETURNING u.snapshot_id::text
    `;
    const unknownTable = report.tables.wiki_territory_snapshot_unknown;
    unknownTable.created = unknown.created;
    unknownTable.unchanged = unknown.unchanged;
    unknownTable.retired = unknown.retired + dropped.length;
}

/** Die Kurzfassung eines Laufs für die Kette und den Bericht (nur Zahlen). */
export function summarizeTerritoryDetails(report: ImportTerritoryDetailsReport): string {
    if (report.skipped) {
        return "uebersprungen: kein Gebiet traegt das Objekt detail (aelterer Export), nichts geschrieben, nichts stillgelegt";
    }
    const coat = report.coatSummary;
    const parts = TERRITORY_DETAIL_TABLES.map((name) => {
        const table = report.tables[name];
        return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
    }).join(", ");
    return (
        `${parts} (neu/geaendert/stillgelegt); ${String(report.stored)} von ${String(report.withDetail)} Gebieten mit Detailfeldern gespeichert` +
        (report.coatPart === "planned"
            ? `; Wappenzustand nur durchgerechnet: gesetzt ${String(coat.set)}, ausdruecklich keins ${String(coat.none)}, ohne Entscheid ${String(coat.undecided)} (Unterdrueckung ${String(coat.suppressions)}, Bindung ${String(coat.bindings)})`
            : "; Wappenzustand: kein coat in der Antwort")
    );
}

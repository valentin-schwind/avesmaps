import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    STAETTEN_CONTRACT_VERSION,
    resolveStaetten,
    staetteKeyParts,
    transformStaetten,
    type StaetteRow,
    type StaettenCounts,
    type StaettenResolution,
} from "./staetten.ts";
import { emptyTableReport, syncTable, type Cell, type Col, type SyncSpec, type TableReport } from "./sync-table.ts";
import { AVENTURIA } from "@avesmaps3d/shared";
import { withZugSperre } from "../derive/derive-lock.ts";

/**
 * Schreibt die Stätten der Orte idempotent in die Zieldatenbank (WI-0109, Vertrag `staetten.yaml`, D7, Migration 0078).
 *
 * EINE Transaktion für alles. Der zweite Lauf mit derselben Datei findet nichts zu schreiben.
 *
 * 🔴 Was Legacy nicht mehr nennt, wird STILLGELEGT, nie gelöscht (`syncTable`, `lifecycle: "retire"`) - dieselbe Regel wie bei
 * Orten und Lore. Nennt ein späterer Satz die Zeile wieder, wird sie wieder aktiv.
 * 🔴 Kartendatenübernahme: nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück,
 * auch das Journal.
 * 🔴 Fehlt der Block `in_settlement_places` oder ist er leer, schreibt der Schritt nichts, legt nichts still und meldet
 * `source_block_missing`; der Lauf geht weiter (kein Tor, Betreiber 2026-10-03).
 *
 * 🪤 **Keine Spalte für den Ort.** Der Siedlungsbezug ist der gefaltete Name (Legacys eigene Regel, Begründung in der Migration);
 * der Import rechnet die Auflösung nur und MELDET sie (`settlement_unmatched`, `settlement_ambiguous`). Darum liest er die
 * Ortsnamen, schreibt sie aber nicht.
 */

export const STAETTEN_TABLES = ["settlement_place"] as const;
export type StaettenTable = (typeof STAETTEN_TABLES)[number];

export interface ImportStaettenOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
}

export interface ImportStaettenReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Der Block fehlte oder war leer: nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    tables: Record<StaettenTable, TableReport>;
    counts: StaettenCounts;
    /** Gelieferte Zeilen, die nicht gespeichert sind, je Befundcode. */
    notStored: Record<string, number>;
    stored: number;
    resolution: StaettenResolution;
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });

/** Die Spalten, die der Import führt (ohne `id` und die gemeinsamen). */
export const STAETTEN_COLUMNS: readonly Col[] = [
    text("settlement_key"),
    text("settlement_name"),
    text("name"),
    text("place_type"),
    text("wiki_url"),
    { name: "legacy_public_id", type: "uuid" },
    { name: "on_map", type: "boolean" },
];

/** Die Zellen einer Stätte, in der Reihenfolge von {@link STAETTEN_COLUMNS}; Import und Prüfer schreiben und lesen sie gleich. */
export const staetteCells = (row: StaetteRow): Cell[] => [
    row.settlementKey,
    row.settlementName,
    row.name,
    row.placeType,
    row.wikiUrl,
    row.legacyPublicId,
    row.onMap,
];

/**
 * Der Schlüssel des Abgleichs: Siedlung, Name und die Kennung des Kartenpunkts - wie `settlement_place_key_unique`.
 *
 * 💣 **Der Name allein ist es nicht.** Legacy entdoppelt die innerorts-Punkte ausdrücklich nicht gegeneinander („zwei gleichnamige
 * Tempel sind zwei Tempel"); nur sie tragen eine eigene Kennung, und ohne sie im Schlüssel wären zwei gleichnamige Punkte EINER
 * Stadt eine Zeile. Für alle anderen Zeilen ist die Kennung leer und der Schlüssel damit Legacys `UNIQUE (settlement, name)`.
 */
export const staetteKey = (cells: readonly Cell[]): string =>
    staetteKeyParts(String(cells[0]), String(cells[2]), cells[5] == null ? null : String(cells[5]));

const staettenSpec: SyncSpec = {
    table: "settlement_place",
    columns: STAETTEN_COLUMNS,
    keyOf: staetteKey,
    activeSet: "state = 'active'",
    retiredSet: "state = 'retired'",
    insertConstants: { state: "'active'" },
    // Zeilen, die nicht aus Legacy stammen (kein heutiger Pfad legt welche an), fasst der Import nie an.
    protectedWhere: "t.source_system <> 'legacy'",
    describe: { join: "", publicId: "COALESCE(t.legacy_public_id::text, t.settlement_key)", name: "t.name" },
};

class DryRunRollback extends Error {}

/** Die aktiven Orte als gefalteter Name → Anzahl: die Gegenprobe für die Auflösung, nie ein Schreibweg. */
export async function readActivePlaceKeys(database: Queryable): Promise<Map<string, number>> {
    const rows = await database<{ key: string; n: string }[]>`
        SELECT lower(btrim(name)) AS key, count(*)::text AS n
        FROM place WHERE is_active GROUP BY lower(btrim(name))
    `;
    return new Map(rows.map((row) => [row.key, Number(row.n)]));
}

export function importStaetten(
    database: Database,
    payload: unknown,
    options: ImportStaettenOptions = {},
): Promise<ImportStaettenReport> {
    return withZugSperre(database, AVENTURIA.mapDomain, "I27 Stätten der Orte", () =>
        importStaettenLocked(database, payload, options),
    );
}

/** Der Körper von `importStaetten`, unter der Sperre des Zugs. */
async function importStaettenLocked(
    database: Database,
    payload: unknown,
    options: ImportStaettenOptions = {},
): Promise<ImportStaettenReport> {
    const runId = randomUUID();
    const revision = (payload as { revision?: unknown } | null)?.revision;
    const sourceRef = `map-features.php#in_settlement_places; revision=${Number.isFinite(Number(revision)) ? String(revision) : "unbekannt"}`;
    const transformed = transformStaetten(payload);
    const report: ImportStaettenReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: transformed.skipped,
        tables: { settlement_place: emptyTableReport() },
        counts: transformed.counts,
        notStored: transformed.notStored,
        stored: transformed.rows.length,
        resolution: { resolved: 0, ambiguous: 0, unmatched: 0, unmatchedRows: 0 },
        changed: false,
        findings: [...transformed.findings],
    };
    if (transformed.skipped) return report;

    try {
        await database.begin(async (transaction) => {
            const placeKeys = await readActivePlaceKeys(transaction);
            const resolved = resolveStaetten(transformed.rows, placeKeys);
            report.resolution = resolved.resolution;
            report.findings.push(...resolved.findings);

            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'staetten', 'avesmaps-legacy', ${sourceRef}, ${STAETTEN_CONTRACT_VERSION})
            `;

            const result = await syncTable(transaction, staettenSpec, transformed.rows.map(staetteCells), { runId });
            const table = report.tables.settlement_place;
            table.created = result.created;
            table.updated = result.updated;
            table.unchanged = result.unchanged;
            table.retired = result.retired;
            table.protectedRows = result.protectedHits.length;
            table.reappeared = result.reappeared.length;

            if (result.retiring.length > 0) {
                report.findings.push(
                    createFinding(
                        "staette_retired",
                        `${String(result.retiring.length)} früher importierte Stätten nennt der Kartenexport nicht mehr und sind stillgelegt (nicht gelöscht)`,
                        { zeilen: result.retiring.length },
                        result.retiring,
                    ),
                );
            }
            const quota = await retireFinding("settlement_place", result.pressure, async () => result.retiring);
            if (quota) report.findings.push(quota);

            report.changed = table.created + table.updated + table.retired > 0;
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        table,
                        counts: report.counts,
                        stored: report.stored,
                        not_stored: report.notStored,
                        resolution: report.resolution,
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

/** Die Kurzfassung eines Laufs für die Kette und den Bericht (nur Zahlen). */
export function summarizeStaetten(report: ImportStaettenReport): string {
    if (report.skipped) return "uebersprungen: Block `in_settlement_places` fehlt oder ist leer, nichts geschrieben";
    const table = report.tables.settlement_place;
    const resolution = report.resolution;
    return (
        `settlement_place ${String(table.created)}/${String(table.updated)}/${String(table.retired)} (neu/geaendert/stillgelegt); ` +
        `${String(report.stored)} von ${String(report.counts.delivered)} gelieferten gespeichert, ` +
        `${String(report.counts.types)} Arten, ${String(report.counts.settlements)} Siedlungen ` +
        `(${String(resolution.resolved)} genau ein Ort, ${String(resolution.ambiguous)} mehrere, ${String(resolution.unmatched)} ohne Ort); ` +
        `${String(report.counts.onMap)} mit Sprung auf die Karte`
    );
}

import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    REVIEWS_CONTRACT_VERSION,
    transformReviews,
    type ReviewPlace,
    type ReviewPlaceIndex,
    type ReviewRow,
    type ReviewSourceCounts,
    type ReviewsTransform,
} from "./reviews.ts";
import { emptyTableReport, syncTable, type Cell, type Col, type SyncSpec, type TableReport } from "./sync-table.ts";

/**
 * Schreibt die sichtbaren Bewertungen von Orten idempotent in die Zieldatenbank (WI-0063 P3, Vertrag `reviews.yaml`, D4, Migration 0075).
 *
 * EINE Transaktion für alles (Anlegen, Ändern, Löschen), damit die Entfernungsquote über den Satz gilt. Der zweite Lauf mit demselben Satz
 * findet nichts zu schreiben.
 *
 * 🔴 DATENSCHUTZ: Was die Antwort nicht mehr nennt (in Legacy verborgen, gelöscht, als Spam gesetzt, Ort inaktiv geworden), wird HART
 * GELÖSCHT, nicht stillgelegt (`lifecycle derived` im gemeinsamen Abgleich): Es gibt keine Zeile, die einen Inhalt über die Moderation
 * hinaus aufbewahrt, und keinen Tombstone. Der Bericht nennt Kennung (Legacys laufende Nummer) und Ort, nie einen Text oder Autor.
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück.
 * 🔴 Ist die Antwort unbrauchbar, in sich widersprüchlich oder leer ohne Beleg, schreibt der Schritt nichts, löscht nichts und meldet
 * `source_block_missing`, `source_counts_disagree` oder `source_empty_catalog`; der Lauf geht weiter (kein Tor, Betreiber 2026-10-03).
 *
 * Identität: Legacys laufende Nummer ist nur mit Anlagezeit und Ort Identität (sie kann nach einem harten Löschen wiederkehren). Der
 * Schlüssel des Abgleichs enthält deshalb alle drei: weicht bei gleicher Nummer Zeit oder Ort ab, ist es eine NEUE Bewertung, die alte
 * wird zuerst gelöscht (Befund `review_id_reused`).
 */

export const REVIEW_TABLES = ["place_review"] as const;
export type ReviewTable = (typeof REVIEW_TABLES)[number];

export interface ImportReviewsOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
}

export interface ImportReviewsReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Die Antwort war unbrauchbar, widersprüchlich oder leer ohne Beleg: nichts geschrieben, nichts gelöscht. */
    skipped: boolean;
    tables: Record<ReviewTable, TableReport>;
    /** Die Zahlen der Antwort (gesamt, sichtbar, verborgen, Spam, verwaist): nur im Bericht, nie in einer Tabelle. */
    counts: ReviewSourceCounts | null;
    delivered: number;
    /** Wie viele gelieferte Zeilen gespeichert sind und wie viele aus welchem Grund nicht (Befundcode → Zahl). */
    stored: number;
    notStored: Record<string, number>;
    /** Wiederverwendete Nummern: alte Zeile gelöscht, neue angelegt. */
    reused: number;
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });

/** Die Spalten, die der Import führt (ohne `id` und die gemeinsamen). KEINE Personenspalte. */
export const REVIEW_COLUMNS: readonly Col[] = [
    { name: "legacy_review_id", type: "int" },
    { name: "place_id", type: "bigint" },
    { name: "stars", type: "int" },
    text("author_name"),
    text("body"),
    text("dsa_date"),
    { name: "legacy_created_at", type: "timestamp" },
];

/** Die Zellen einer Bewertung, in der Reihenfolge von `REVIEW_COLUMNS`; der Import und der Prüfer schreiben und lesen sie gleich. */
export const reviewCells = (row: ReviewRow): Cell[] => [
    row.legacyReviewId,
    row.placeId,
    row.stars,
    row.authorName,
    row.body,
    row.dsaDate,
    row.legacyCreatedAt,
];

/** Der Schlüssel des Abgleichs: Nummer, Anlagezeit und Ort (nicht die Nummer allein, siehe Kopf). */
export const reviewKey = (cells: readonly Cell[]): string =>
    `${String(cells[0])}|${String(cells[6])}|${String(cells[1])}`;

const reviewSpec: SyncSpec = {
    table: "place_review",
    columns: REVIEW_COLUMNS,
    keyOf: reviewKey,
    // Löschen statt Stilllegen: die Tabelle hat kein is_active (Vertrag `stilllegen.modus`).
    lifecycle: "derived",
    // Zeilen, die nicht aus Legacy stammen (Bewertungen von der Website, WI-0269), fasst der Import nie an. Ebenso nicht eine Zeile, deren Inhalt
    // die Redaktion gelöscht hat (Datenschutz): Der Import brächte Name und Text sonst mit dem nächsten Zug zurück. Den ZUSTAND (neu,
    // gesichtet, zurückgehalten, verborgen) setzt der Import nur beim Anlegen (die Vorgabe der Spalte); `REVIEW_COLUMNS` nennt ihn nicht.
    protectedWhere: "t.source_system <> 'legacy' OR t.inhalt_geloescht_at IS NOT NULL",
    describe: {
        join: "JOIN place c ON c.id = t.place_id",
        publicId: "t.legacy_review_id::text",
        name: "'Ort ' || c.public_id::text",
    },
};

class DryRunRollback extends Error {}

/**
 * Liest die Orte (nach `public_id` und `legacy_public_id`) und die Kennungen aller anderen Träger für die Auflösung. Die Tabelle
 * `crossing` gehört seit WI-0132 Release N nicht mehr dazu (keine Kreuzungsobjekte; sie fällt in Release N+1 weg).
 */
export async function readReviewPlaceIndex(database: Queryable): Promise<ReviewPlaceIndex> {
    const places = new Map<string, ReviewPlace>();
    const rows = await database<
        { id: string; public_id: string; legacy_public_id: string | null; name: string; is_active: boolean }[]
    >`SELECT id::text, public_id::text, legacy_public_id::text, name, is_active FROM place`;
    for (const row of rows) {
        const place: ReviewPlace = { id: row.id, publicId: row.public_id, name: row.name, active: row.is_active };
        places.set(row.public_id.toLowerCase(), place);
        if (row.legacy_public_id !== null && !places.has(row.legacy_public_id.toLowerCase())) {
            places.set(row.legacy_public_id.toLowerCase(), place);
        }
    }
    const others = await database<{ public_id: string }[]>`
        SELECT public_id::text FROM path
        UNION ALL SELECT public_id::text FROM region
        UNION ALL SELECT public_id::text FROM territory
        UNION ALL SELECT public_id::text FROM map_label
        UNION ALL SELECT public_id::text FROM terrain_peak
        UNION ALL SELECT public_id::text FROM powerline
        UNION ALL SELECT public_id::text FROM nodix
    `;
    return { places, otherCarriers: new Set(others.map((row) => row.public_id.toLowerCase())) };
}

/** Die Zeilen, die schon aus Legacy stehen: Nummer → „Anlagezeit|Ort“, für die Wiederverwendung der Nummern. */
async function readStoredIdentity(transaction: Queryable): Promise<Map<string, string>> {
    const rows = await transaction<{ legacy_review_id: string; created: string; place_id: string }[]>`
        SELECT legacy_review_id::text,
               to_char(legacy_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS created,
               place_id::text
        FROM place_review WHERE source_system = 'legacy'
    `;
    return new Map(rows.map((row) => [row.legacy_review_id, `${row.created}|${row.place_id}`]));
}

export async function importReviews(
    database: Database,
    payload: unknown,
    options: ImportReviewsOptions = {},
): Promise<ImportReviewsReport> {
    const runId = randomUUID();
    const stampOf = (payload as { reviews_revision?: unknown } | null)?.reviews_revision;
    const sourceRef = `location-reviews-export.php; reviews_revision=${typeof stampOf === "string" && /^rev-[0-9a-f]{16}$/.test(stampOf) ? stampOf : "unbekannt"}`;
    const report: ImportReviewsReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: false,
        tables: { place_review: emptyTableReport() },
        counts: null,
        delivered: 0,
        stored: 0,
        notStored: {},
        reused: 0,
        changed: false,
        findings: [],
    };
    try {
        await database.begin(async (transaction) => {
            const index = await readReviewPlaceIndex(transaction);
            const transformed: ReviewsTransform = transformReviews(payload, index);
            report.findings.push(...transformed.findings);
            report.counts = transformed.counts;
            report.delivered = transformed.delivered;
            report.notStored = transformed.notStored;
            if (transformed.skipped) {
                report.skipped = true;
                return;
            }
            report.stored = transformed.reviews.length;
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'reviews', 'avesmaps-legacy', ${sourceRef}, ${REVIEWS_CONTRACT_VERSION})
            `;

            // Wiederverwendete Nummern vor dem Schreiben erkennen: gleiche Nummer, andere Anlagezeit oder anderer Ort.
            const stored = await readStoredIdentity(transaction);
            const reusedObjects: FindingObject[] = [];
            for (const row of transformed.reviews) {
                const have = stored.get(String(row.legacyReviewId));
                if (have !== undefined && have !== `${row.legacyCreatedAt}|${row.placeId}`) {
                    reusedObjects.push({
                        table: "place_review",
                        publicId: String(row.legacyReviewId),
                        name: `Ort ${row.placePublicId}`,
                    });
                }
            }
            report.reused = reusedObjects.length;
            if (reusedObjects.length > 0) {
                report.findings.push(
                    createFinding(
                        "review_id_reused",
                        `${String(reusedObjects.length)} Bewertungen tragen eine Nummer, die schon mit anderer Anlagezeit oder anderem Ort gespeichert war: eine NEUE Bewertung, die alte Zeile wird gelöscht`,
                        { zeilen: reusedObjects.length },
                        reusedObjects,
                    ),
                );
            }

            const result = await syncTable(transaction, reviewSpec, transformed.reviews.map(reviewCells), { runId });
            const table = report.tables.place_review;
            table.created = result.created;
            table.updated = result.updated;
            table.unchanged = result.unchanged;
            table.retired = result.retired;
            table.protectedRows = result.protectedHits.length;

            if (result.retiring.length > 0) {
                report.findings.push(
                    createFinding(
                        "review_removed",
                        `${String(result.retiring.length)} früher importierte Bewertungen fehlen im neuen Satz und sind gelöscht (in Legacy verborgen, gelöscht oder als Spam gesetzt, oder der Ort ist inaktiv); nur Nummer und Ort stehen hier, nie ein Text`,
                        { zeilen: result.retiring.length },
                        result.retiring,
                    ),
                );
            }
            const quota = await retireFinding("place_review", result.pressure, async () => result.retiring);
            if (quota) report.findings.push(quota);

            report.changed = table.created + table.updated + table.retired > 0;
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        table,
                        counts: report.counts,
                        delivered: report.delivered,
                        stored: report.stored,
                        not_stored: report.notStored,
                        reused: report.reused,
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
export function summarizeReviews(report: ImportReviewsReport): string {
    if (report.skipped)
        return "uebersprungen: Antwort unbrauchbar, widerspruechlich oder leer ohne Beleg, nichts geschrieben";
    const table = report.tables.place_review;
    const counts = report.counts;
    return (
        `place_review ${String(table.created)}/${String(table.updated)}/${String(table.retired)} (neu/geaendert/geloescht), ` +
        `${String(report.stored)} von ${String(report.delivered)} gelieferten gespeichert` +
        (counts === null
            ? ""
            : `; Legacy zaehlt gesamt ${String(counts.total)}, sichtbar ${String(counts.visible)}, verborgen ${String(counts.hidden)}, Spam ${String(counts.spam)}` +
              (counts.orphanedReviews === null
                  ? ""
                  : `, ${String(counts.orphanedReviews)} an ${String(counts.orphanedLocationIds ?? 0)} Orten ohne aktiven Ort`))
    );
}

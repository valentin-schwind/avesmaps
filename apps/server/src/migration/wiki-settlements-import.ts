import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding } from "../findings.ts";
import { syncReported, type ExpectedRow } from "./catalog-sync.ts";
import {
    emptyTableReport,
    replaceChildren,
    type Cell,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";
import {
    WIKI_SETTLEMENTS_CONTRACT_VERSION,
    crossStampFindings,
    transformWikiSettlements,
    type WikiSettlementCounts,
    type WikiSettlementRow,
    type WikiSettlementTransform,
} from "./wiki-settlements.ts";

/**
 * Schreibt die Wiki-Siedlungsregistry (X3) idempotent in die Zieldatenbank (WI-0128 E4, Migration 0089). EINE Transaktion; der zweite Lauf mit
 * derselben Antwort findet nichts zu schreiben. Was Legacy nicht mehr nennt, wird stillgelegt, nie gelöscht (`syncReported`, Stilllegequote
 * als Befund).
 *
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück, auch das Journal
 * (CLI). 🔴 Kein Key wird hier gerechnet, keine Zeile an einen Ort gebunden: ob eine Siedlung auf der Karte liegt, entscheidet der Leser über
 * denselben Key gegen X2 (`apps/server/src/editor/wiki-settlement-rows.ts`). Ist die Antwort unbrauchbar oder leer, schreibt der Schritt
 * nichts und legt nichts still (Befund, kein Tor).
 *
 * Seit WI-0134 (Migration 0099) schreibt der Schritt auch die Linkziele der `standort`-Kette als genannte Orte
 * (`wiki_settlement_registry_named_place`): Evidenz, nie eine Bindung. Sie werden je Zeile mit ihrem Satz ersetzt; trägt die Antwort
 * das Feld nicht (X3 vor WI-0134) oder fehlt die Migration, bleiben sie unberührt (Befund).
 */

export const WIKI_SETTLEMENT_TABLES = ["wiki_settlement_registry", "wiki_settlement_registry_named_place"] as const;
export type WikiSettlementTable = (typeof WIKI_SETTLEMENT_TABLES)[number];

export interface ImportWikiSettlementsOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
    /** Die Antwort von X2 desselben Zuges, nur für den Abgleich der Stände (Befund `x3_x2_stand`); nie geschrieben. */
    zuordnung?: unknown;
}

export interface ImportWikiSettlementsReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Die Antwort war unbrauchbar oder leer: nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    tables: Record<WikiSettlementTable, TableReport>;
    counts: WikiSettlementCounts;
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });
const int = (name: string): Col => ({ name, type: "int" });
const bool = (name: string): Col => ({ name, type: "boolean" });
const naive = (name: string): Col => ({ name, type: "timestamp" });

/** Die Spalten, die der Import führt (ohne `id` und die gemeinsamen); Import und Prüfer lesen und schreiben sie gleich. */
export const WIKI_SETTLEMENT_COLUMNS: readonly Col[] = [
    text("wiki_key"),
    text("title"),
    int("ns"),
    text("ns_name"),
    bool("is_redirect"),
    text("redirect_title"),
    int("redirect_ns"),
    text("redirect_ns_name"),
    text("wiki_url"),
    text("settlement_class"),
    text("settlement_label"),
    text("building_type"),
    bool("building_type_excluded"),
    bool("is_ruined"),
    text("continent"),
    text("lage"),
    text("standort"),
    bool("has_coat"),
    naive("wiki_fetched_at"),
    naive("wiki_enriched_at"),
];

export const wikiSettlementCells = (row: WikiSettlementRow): Cell[] => [
    row.wikiKey,
    row.title,
    row.ns,
    row.nsName,
    row.isRedirect,
    row.redirectTitle,
    row.redirectNs,
    row.redirectNsName,
    row.wikiUrl,
    row.settlementClass,
    row.settlementLabel,
    row.buildingType,
    row.buildingTypeExcluded,
    row.isRuined,
    row.continent,
    row.lage,
    row.standort,
    row.hasCoat,
    row.wikiFetchedAt,
    row.wikiEnrichedAt,
];

/** Die Spalten der genannten Orte (ohne `registry_id`, die `replaceChildren` setzt). */
export const WIKI_SETTLEMENT_NAMED_PLACE_COLUMNS: readonly Col[] = [
    int("position"),
    text("target_raw"),
    text("target_key"),
];

/** Der Schlüssel des Abgleichs: der kanonische Wiki-Key (wie `wiki_settlement_registry_key_unique`). */
export const wikiSettlementKey = (cells: readonly Cell[]): string => String(cells[0]);

export const wikiSettlementSpec: SyncSpec = {
    table: "wiki_settlement_registry",
    columns: WIKI_SETTLEMENT_COLUMNS,
    keyOf: wikiSettlementKey,
    describe: { join: "", publicId: "t.wiki_key", name: "t.title" },
};

class DryRunRollback extends Error {}

/**
 * Die Linkziele je gespeicherter Zeile, ersetzt mit ihrem Satz (wie `wiki_link_target`). Eine stillgelegte Zeile behält ihre; eine Zeile
 * ohne Linkziele nennt ihren leeren Satz, damit verschwindet, was Legacy aus der Kette genommen hat.
 */
async function writeNamedPlaces(
    transaction: Queryable,
    transformed: WikiSettlementTransform,
    idByKey: ReadonlyMap<string, string>,
    report: ImportWikiSettlementsReport,
): Promise<void> {
    if (!transformed.linksDelivered) return;
    const [present] = await transaction<{ present: string | null }[]>`
        SELECT to_regclass('wiki_settlement_registry_named_place')::text AS present
    `;
    if (present?.present == null) {
        report.findings.push(
            createFinding(
                "migration_missing",
                "Migration 0099_site_identities fehlt: die Linkziele der Standortkette werden nicht geschrieben (die Registry schon)",
                { migration: "0099_site_identities" },
            ),
        );
        return;
    }
    const byParent = new Map<string, Cell[][]>();
    for (const [wikiKey, links] of transformed.links) {
        const id = idByKey.get(wikiKey);
        if (id === undefined) throw new Error(`wiki_settlement_registry: die Zeile ${wikiKey} fehlt nach dem Abgleich`);
        byParent.set(
            id,
            links.map((link) => [link.position, link.targetRaw, link.targetKey]),
        );
    }
    const children = await replaceChildren(
        transaction,
        "wiki_settlement_registry_named_place",
        "registry_id",
        WIKI_SETTLEMENT_NAMED_PLACE_COLUMNS,
        byParent,
    );
    const table = report.tables.wiki_settlement_registry_named_place;
    table.created = children.created;
    table.retired = children.retired;
    table.unchanged = children.unchanged;
}

export async function importWikiSettlements(
    database: Database,
    payload: unknown,
    options: ImportWikiSettlementsOptions = {},
): Promise<ImportWikiSettlementsReport> {
    const runId = randomUUID();
    const transformed = transformWikiSettlements(payload);
    const stamps = transformed.stamps;
    const sourceRef =
        `wiki-siedlungen-export.php; registry_revision=${stamps.registryRevision ?? "unbekannt"}` +
        `; map_revision=${String(stamps.mapRevision ?? "unbekannt")}; siedlungen=${String(transformed.counts.delivered)}`;
    const report: ImportWikiSettlementsReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: transformed.skipped,
        tables: {
            wiki_settlement_registry: emptyTableReport(),
            wiki_settlement_registry_named_place: emptyTableReport(),
        },
        counts: transformed.counts,
        changed: false,
        findings: [
            ...transformed.findings,
            ...(transformed.skipped ? [] : crossStampFindings(stamps, options.zuordnung)),
        ],
    };
    if (transformed.skipped) return report;

    try {
        await database.begin(async (transaction) => {
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'wiki-settlements', 'avesmaps-legacy', ${sourceRef}, ${WIKI_SETTLEMENTS_CONTRACT_VERSION})
            `;
            const expected: ExpectedRow[] = transformed.rows.map((row) => ({
                ref: { table: "wiki_settlement_registry", publicId: row.wikiKey, name: row.title },
                cells: wikiSettlementCells(row),
            }));
            const table = report.tables.wiki_settlement_registry;
            const synced = await syncReported(
                transaction,
                runId,
                "wiki_settlement_registry",
                wikiSettlementSpec,
                expected,
                table,
                report.findings,
            );
            await writeNamedPlaces(transaction, transformed, synced.idByKey, report);
            const named = report.tables.wiki_settlement_registry_named_place;
            report.changed = table.created + table.updated + table.retired + named.created + named.retired > 0;
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        table,
                        counts: report.counts,
                        stamps,
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
export function summarizeWikiSettlements(report: ImportWikiSettlementsReport): string {
    if (report.skipped) return "uebersprungen: Antwort unbrauchbar oder leer, nichts geschrieben, nichts stillgelegt";
    const table = report.tables.wiki_settlement_registry;
    const counts = report.counts;
    const named = report.tables.wiki_settlement_registry_named_place;
    return (
        `wiki_settlement_registry ${String(table.created)}/${String(table.updated)}/${String(table.retired)} (neu/geaendert/stillgelegt); ` +
        `genannte Orte ${String(named.created)}/${String(named.retired)}/${String(named.unchanged)} (neu/ersetzt/unveraendert); ` +
        `${String(counts.stored)} von ${String(counts.delivered)} gelieferten gespeichert (${String(counts.withoutKey)} ohne Key, ` +
        `${String(counts.duplicateKeys)} doppelter Key); ${String(counts.withPlace)} mit Ort laut Legacy, ` +
        `${String(counts.excluded)} von Legacys Liste ausgeblendet, Legacys Zahl „Fehlt“ ${String(counts.legacyMissing)}`
    );
}

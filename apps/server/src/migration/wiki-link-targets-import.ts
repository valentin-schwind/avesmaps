import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { type Finding, type FindingObject } from "../findings.ts";
import { syncReported, type ExpectedRow } from "./catalog-sync.ts";
import {
    WIKI_LINK_TARGETS_CONTRACT_VERSION,
    crossFindings,
    transformAssignments,
    transformLinkTargets,
    type AssignmentRow,
    type PageRow,
    type TargetRow,
} from "./wiki-link-targets.ts";
import {
    emptyTableReport,
    replaceChildren,
    type Cell,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";
import { AVENTURIA } from "@avesmaps3d/shared";
import { withZugSperre } from "../derive/derive-lock.ts";

/**
 * Schreibt die Zuordnungstafel (X2) und die Linkziele (X1) idempotent in die Zieldatenbank (WI-0063 27.12, Migration 0073, Vertrag
 * `wiki-link-targets.yaml`).
 *
 * EINE Transaktion für beide Teile, damit die Stilllegequote und das Journal über den Zug gelten. Der zweite Lauf mit denselben Antworten findet
 * nichts zu schreiben. Die Teile sind unabhängig: Fehlt eine Antwort (`null`) oder ist sie unbrauchbar oder leer, schreibt NUR dieser Teil nichts
 * und legt nichts still (`source_block_missing`, `source_empty_catalog`, kein Tor); der andere Teil läuft.
 *
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück (CLI).
 * 🔴 Kein Key wird hier gerechnet: `wiki_key` und `target_key` stehen wörtlich, wie Legacy sie liefert, und der Import legt keine Verknüpfung zu einem
 * Träger an. Welches Objekt unserer Karte hinter einem Key steht, löst der Leser zur Laufzeit auf (`subjects/wiki-key-lookup.ts`).
 */

export const WIKI_LINK_TABLES = ["wiki_key_assignment", "wiki_link_page", "wiki_link_target"] as const;
export type WikiLinkTable = (typeof WIKI_LINK_TABLES)[number];

export interface ImportWikiLinkTargetsInput {
    /** X1, `wiki-linkziele-export.php`; `null`, wenn der Zug sie nicht holt. */
    linkziele?: unknown;
    /** X2, `wiki-zuordnung-export.php`; `null`, wenn der Zug sie nicht holt. */
    zuordnung?: unknown;
}

export interface ImportWikiLinkTargetsOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
}

export interface ImportWikiLinkTargetsReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Je Teil: nichts geschrieben, weil die Antwort fehlte, unbrauchbar oder leer war. */
    skipped: { linkziele: boolean; zuordnung: boolean };
    tables: Record<WikiLinkTable, TableReport>;
    /** Die Zahlen der Antworten: Objekte, Seiten, Links, verschiedene Keys, Objekte ohne Zuweisung je Art. */
    stats: {
        assignments: number;
        distinctKeys: number;
        withoutAssignment: Record<string, number>;
        pages: number;
        links: number;
    };
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });
const int = (name: string): Col => ({ name, type: "int" });
const bool = (name: string): Col => ({ name, type: "boolean" });

export const ASSIGNMENT_COLUMNS: readonly Col[] = [
    text("legacy_art"),
    { name: "object_public_id", type: "uuid" },
    text("wiki_key"),
    text("wiki_url"),
    text("wiki_title"),
    int("ns"),
    text("ns_name"),
    bool("is_redirect"),
    text("redirect_title"),
    int("redirect_ns"),
    text("redirect_ns_name"),
];

export const PAGE_COLUMNS: readonly Col[] = [
    text("page_key"),
    text("page_title"),
    text("page_kind"),
    int("ns"),
    text("ns_name"),
];

/** Die Kindzeilen eines Artikels (ohne die Spalte `page_id`, die `replaceChildren` voranstellt). */
export const TARGET_COLUMNS: readonly Col[] = [
    text("field"),
    int("position"),
    text("display_text"),
    text("link_art"),
    text("link_template"),
    text("target_raw"),
    text("target_key"),
    int("target_ns"),
    text("target_ns_name"),
    bool("is_redirect"),
    text("redirect_title"),
    int("redirect_ns"),
    text("redirect_ns_name"),
];

export const assignmentCells = (row: AssignmentRow): Cell[] => [
    row.art,
    row.publicId,
    row.wikiKey,
    row.wikiUrl,
    row.wikiTitle,
    row.ns,
    row.nsName,
    row.isRedirect,
    row.redirectTitle,
    row.redirectNs,
    row.redirectNsName,
];

export const pageCells = (row: PageRow): Cell[] => [row.pageKey, row.pageTitle, row.pageKind, row.ns, row.nsName];

export const targetCells = (row: TargetRow): Cell[] => [
    row.field,
    row.position,
    row.displayText,
    row.linkArt,
    row.linkTemplate,
    row.targetRaw,
    row.targetKey,
    row.targetNs,
    row.targetNsName,
    row.isRedirect,
    row.redirectTitle,
    row.redirectNs,
    row.redirectNsName,
];

const assignmentKey = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[1])}`;
const first = (cells: readonly Cell[]): string => String(cells[0]);

export function assignmentSpec(): SyncSpec {
    return {
        table: "wiki_key_assignment",
        // Eine Zuordnung, die ein Editor beim Platzieren eines Wiki-Eintrags schrieb (WI-0128 E16), kennt Legacy nicht: Der Import legt
        // sie nie still (Kapitel 9.37, manuell schlägt Wiki). Das Zurücksetzen der Testwelt nimmt sie mit.
        protectedWhere: "t.source_system <> 'legacy'",
        columns: ASSIGNMENT_COLUMNS,
        keyOf: assignmentKey,
        describe: { join: "", publicId: "t.object_public_id::text", name: "t.legacy_art || ' ' || t.wiki_key" },
    };
}

export function pageSpec(): SyncSpec {
    return {
        table: "wiki_link_page",
        columns: PAGE_COLUMNS,
        keyOf: first,
        describe: { join: "", publicId: "t.page_key", name: "t.page_title" },
    };
}

class DryRunRollback extends Error {}

export function importWikiLinkTargets(
    database: Database,
    input: ImportWikiLinkTargetsInput,
    options: ImportWikiLinkTargetsOptions = {},
): Promise<ImportWikiLinkTargetsReport> {
    return withZugSperre(database, AVENTURIA.mapDomain, "I24 Wiki-Linkziele und Zuordnung", () =>
        importWikiLinkTargetsLocked(database, input, options),
    );
}

/** Der Körper von `importWikiLinkTargets`, unter der Sperre des Zugs. */
async function importWikiLinkTargetsLocked(
    database: Database,
    input: ImportWikiLinkTargetsInput,
    options: ImportWikiLinkTargetsOptions = {},
): Promise<ImportWikiLinkTargetsReport> {
    const runId = randomUUID();
    const assignments =
        input.zuordnung === undefined || input.zuordnung === null ? null : transformAssignments(input.zuordnung);
    const links =
        input.linkziele === undefined || input.linkziele === null ? null : transformLinkTargets(input.linkziele);
    const sourceRef =
        `wiki-zuordnung-export.php; objekte=${assignments === null || assignments.skipped ? "keine" : String(assignments.rows.length)}` +
        ` | wiki-linkziele-export.php; seiten=${links === null || links.skipped ? "keine" : String(links.pages.length)}`;
    const report: ImportWikiLinkTargetsReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: { linkziele: links === null || links.skipped, zuordnung: assignments === null || assignments.skipped },
        tables: Object.fromEntries(WIKI_LINK_TABLES.map((name) => [name, emptyTableReport()])) as Record<
            WikiLinkTable,
            TableReport
        >,
        stats: {
            assignments: assignments?.rows.length ?? 0,
            distinctKeys: new Set(assignments?.rows.map((row) => row.wikiKey)).size,
            withoutAssignment: assignments?.withoutAssignment ?? {},
            pages: links?.pages.length ?? 0,
            links: links?.targets.length ?? 0,
        },
        changed: false,
        findings: [...(assignments?.findings ?? []), ...(links?.findings ?? [])],
    };
    if (assignments !== null && links !== null) report.findings.push(...crossFindings(links, assignments));
    if (report.skipped.linkziele && report.skipped.zuordnung) return report;

    try {
        await database.begin(async (transaction) => {
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'wiki-link-targets', 'avesmaps-legacy', ${sourceRef}, ${WIKI_LINK_TARGETS_CONTRACT_VERSION})
            `;
            if (assignments !== null && !assignments.skipped) {
                await writeAssignments(transaction, runId, assignments.rows, report);
            }
            if (links !== null && !links.skipped)
                await writeLinks(transaction, runId, links.pages, links.targets, report);
            report.changed = Object.values(report.tables).some(
                (table) => table.created + table.updated + table.retired > 0,
            );
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables: report.tables,
                        stats: report.stats,
                        skipped: report.skipped,
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

async function writeAssignments(
    transaction: Queryable,
    runId: string,
    rows: readonly AssignmentRow[],
    report: ImportWikiLinkTargetsReport,
): Promise<void> {
    const expected: ExpectedRow[] = rows.map((row) => ({
        ref: { table: "wiki_key_assignment", publicId: row.publicId, name: `${row.art} ${row.wikiKey}` },
        cells: assignmentCells(row),
    }));
    await syncReported(
        transaction,
        runId,
        "wiki_key_assignment",
        assignmentSpec(),
        expected,
        report.tables.wiki_key_assignment,
        report.findings,
    );
}

async function writeLinks(
    transaction: Queryable,
    runId: string,
    pages: readonly PageRow[],
    targets: readonly TargetRow[],
    report: ImportWikiLinkTargetsReport,
): Promise<void> {
    const expected: ExpectedRow[] = pages.map((page): ExpectedRow => {
        const ref: FindingObject = { table: "wiki_link_page", publicId: page.pageKey, name: page.pageTitle };
        return { ref, cells: pageCells(page) };
    });
    const synced = await syncReported(
        transaction,
        runId,
        "wiki_link_page",
        pageSpec(),
        expected,
        report.tables.wiki_link_page,
        report.findings,
    );
    // Die Links eines Artikels werden ERSETZT, wenn sich sein Satz ändert, nie angehäuft. Auch ein Artikel ohne Links nennt seinen (leeren) Satz,
    // damit Links, die Legacy aus dem Feld genommen hat, verschwinden. Ein stillgelegter Artikel behält seine Kinder (der Leser liest nur aktive).
    const byPage = new Map<string, (readonly Cell[])[]>();
    for (const page of pages) {
        const id = synced.idByKey.get(page.pageKey);
        if (id === undefined) throw new Error(`wiki_link_page: der Artikel ${page.pageKey} fehlt nach dem Abgleich`);
        byPage.set(id, []);
    }
    const idOf = (pageKey: string): string => {
        const id = synced.idByKey.get(pageKey);
        if (id === undefined) throw new Error(`wiki_link_page: der Artikel ${pageKey} fehlt nach dem Abgleich`);
        return id;
    };
    for (const target of targets) byPage.get(idOf(target.pageKey))?.push(targetCells(target));
    const children = await replaceChildren(transaction, "wiki_link_target", "page_id", TARGET_COLUMNS, byPage);
    const table = report.tables.wiki_link_target;
    table.created = children.created;
    table.retired = children.retired;
    table.unchanged = children.unchanged;
}

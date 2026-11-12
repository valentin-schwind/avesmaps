import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { targetCells, readTargetIndex, type ResolutionTotals } from "./catalog-places.ts";
import { enrichRows, syncReported, writeTombstones, type ExpectedRow, type TombstoneResult } from "./catalog-sync.ts";
import {
    LITERATURE_CONTRACT_VERSION,
    transformLiterature,
    type LiteratureOverlay,
    type LiteratureTransform,
    type WorkPlaceRow,
} from "./literature.ts";
import {
    emptyTableReport,
    replaceChildren,
    type Cell,
    type ChildSyncResult,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";

/**
 * Schreibt Werke, Ortsbezüge, weitere Links und Herkunftsvermerke der Spielliteratur idempotent in die Zieldatenbank (WI-0063 P3,
 * Vertrag `literature.yaml`, D3).
 *
 * EINE Transaktion für alles (Werke, Orte, Links, Herkunft, Stilllegen), damit die Stilllegequote über den Satz gilt. Der zweite Lauf
 * findet nichts zu schreiben.
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück.
 * 🔴 Ist die Antwort unbrauchbar, leer bei aktivem Schalter oder der Schalter aus, schreibt der Schritt nichts, legt nichts still und
 * meldet `source_block_missing`, `source_empty_catalog` beziehungsweise `source_switched_off`; der Lauf geht weiter (kein Tor).
 * 🔴 Der Schritt schreibt KEINE Medienzeile: Cover und die Freigaberegel kommen mit dem Medienimport (MEDIA-M8).
 *
 * Reihenfolge im Lauf (Vertrag `idempotenz.reihenfolge_im_lauf`): erst die Werke, dann Orte und Links, dann die Auflösung (sie steckt
 * in den Zeilen der Orte), dann das Stilllegen (in `syncTable`).
 */

export const LITERATURE_TABLES = ["adventure", "adventure_field_origin", "adventure_place", "adventure_link"] as const;
export type LiteratureTable = (typeof LITERATURE_TABLES)[number];

export interface ImportLiteratureOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
    /** Die privaten Felder (E5/E5+), wenn die Datei sie trägt. */
    overlay?: LiteratureOverlay | undefined;
}

export interface ImportLiteratureReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Die Antwort war unbrauchbar, leer oder abgeschaltet: nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    tables: Record<LiteratureTable, TableReport>;
    resolution: ResolutionTotals;
    /** Was die Datei mit den privaten Feldern bewirkt hat (alles 0 ohne Datei). */
    privateFields: {
        file: boolean;
        works: number;
        places: number;
        fieldOrigins: ChildSyncResult;
        tombstonePlaces: TombstoneResult;
        tombstoneWorks: number;
    };
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });
const int = (name: string): Col => ({ name, type: "int" });
const bigint = (name: string): Col => ({ name, type: "bigint" });

export const WORK_COLUMNS: readonly Col[] = [
    { name: "public_id", type: "uuid" },
    { name: "legacy_public_id", type: "uuid" },
    text("wiki_url"),
    text("title"),
    text("product_type"),
    text("edition"),
    int("bf_year"),
    text("bf_label"),
    text("genre"),
    text("complexity_gm"),
    text("complexity_pl"),
    { name: "is_official", type: "boolean" },
    text("series"),
    text("fshop_code"),
    text("link_ulisses"),
    text("link_fshop"),
    text("isbn"),
    text("contained_in"),
];

export const PLACE_COLUMNS: readonly Col[] = [
    bigint("adventure_id"),
    int("sort_order"),
    int("export_ordinal"),
    text("name_key"),
    int("dup_ordinal"),
    text("raw_name"),
    text("role"),
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

export const LINK_COLUMNS: readonly Col[] = [bigint("adventure_id"), text("url"), text("label"), int("position")];
export const FIELD_ORIGIN_COLUMNS: readonly Col[] = [text("field"), text("origin")];

const first = (cells: readonly Cell[]): string => String(cells[0]);
const placeKey = (cells: readonly Cell[]): string =>
    `${String(cells[0])}|${String(cells[1])}|${String(cells[3])}|${String(cells[4])}`;
const linkKey = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[1])}`;

/**
 * Die Kinder eines Werks, das ein Tombstone oder ein Editor-Entscheid hält, fasst der Import nie an. Dazu zählt ein Werk, das die Redaktion
 * im Fenster „Inhalte bearbeiten“ angelegt oder geändert hat (`source_system = 'editor'`, WI-0254): Es gehört danach der Redaktion samt
 * seiner Ortsliste (die Reihenfolge ist Aussage), seinen Links und Herkunftsvermerken. Feldgenauer Schutz ist ein späteres Paket.
 */
const PARENT_PROTECTED =
    "EXISTS (SELECT 1 FROM adventure a WHERE a.id = t.adventure_id AND (a.state = 'suppressed' OR a.source_system = 'editor' OR (NOT a.is_active AND a.retired_origin = 'editor')))";

export function workSpec(): SyncSpec {
    return {
        table: "adventure",
        columns: WORK_COLUMNS,
        keyOf: first,
        activeSet: "state = 'active'",
        retiredSet: "state = 'retired'",
        insertConstants: { state: "'active'" },
        // Ein Werk, das die Redaktion angelegt oder geändert hat (`source_system editor`, WI-0254), fasst der Zug weder an noch legt er es still.
        protectedWhere: "t.state = 'suppressed' OR t.source_system = 'editor'",
        describe: { join: "", publicId: "t.public_id::text", name: "t.title" },
    };
}

export function placeSpec(): SyncSpec {
    return {
        table: "adventure_place",
        columns: PLACE_COLUMNS,
        keyOf: placeKey,
        activeSet: "state = 'active'",
        retiredSet: "state = 'retired'",
        insertConstants: { state: "'active'" },
        protectedWhere: `t.state = 'suppressed' OR t.target_origin = 'editor' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN adventure c ON c.id = t.adventure_id",
            publicId: "c.public_id::text",
            name: "c.title || ' / ' || t.raw_name",
        },
    };
}

export function linkSpec(): SyncSpec {
    return {
        table: "adventure_link",
        columns: LINK_COLUMNS,
        keyOf: linkKey,
        activeSet: "state = 'active'",
        retiredSet: "state = 'retired'",
        insertConstants: { state: "'active'" },
        protectedWhere: `t.state = 'suppressed' OR ${PARENT_PROTECTED}`,
        describe: {
            join: "JOIN adventure c ON c.id = t.adventure_id",
            publicId: "c.public_id::text",
            name: "c.title || ' / ' || t.url",
        },
    };
}

/** Die Zellen einer Ortszeile (Reihenfolge von `PLACE_COLUMNS`). */
export function placeCells(adventureId: string, row: WorkPlaceRow): Cell[] {
    return [
        adventureId,
        row.sortOrder,
        row.exportOrdinal,
        row.nameKey,
        row.dupOrdinal,
        row.rawName,
        row.role,
        row.resolution.state,
        row.resolution.resolvedBy,
        ...targetCells(row.resolution),
        row.legacy.kind,
        row.legacy.publicId,
        row.legacy.wikiKey,
    ];
}

class DryRunRollback extends Error {}

export async function importLiterature(
    database: Database,
    payload: unknown,
    options: ImportLiteratureOptions = {},
): Promise<ImportLiteratureReport> {
    const runId = randomUUID();
    const adventures = (payload as { adventures?: unknown } | null)?.adventures;
    const sourceRef = `game-literature.php; adventures=${Array.isArray(adventures) ? String(adventures.length) : "unbekannt"}`;
    const overlay = options.overlay ?? null;
    const report: ImportLiteratureReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: false,
        tables: Object.fromEntries(LITERATURE_TABLES.map((name) => [name, emptyTableReport()])) as Record<
            LiteratureTable,
            TableReport
        >,
        resolution: { resolved: 0, unresolved: 0, unmatched: 0, byKind: {} },
        privateFields: {
            file: overlay !== null,
            works: 0,
            places: 0,
            fieldOrigins: { created: 0, retired: 0, unchanged: 0, replacedParents: 0 },
            tombstonePlaces: { created: 0, converted: 0, unchanged: 0 },
            tombstoneWorks: 0,
        },
        changed: false,
        findings: [],
    };
    // 🔴 WI-0253, Scheibe Literatur: Gehört die Literatur in dieser Umgebung dem WikiSync, lässt der Zug sie aus (Vali 2026-10-25: „danach lässt der Legacy-Zug diesen
    // Bereich in dieser Umgebung aus“) – Werke, Ortslisten, Links und Herkunft. Der Bericht ist der eines übersprungenen Schritts; ein Befund sagt, warum.
    if ((await wikisyncBereiche(database)).has("literatur")) {
        report.skipped = true;
        report.findings.push(
            createFinding(
                "bereich_wikisync",
                "Die Literatur gehört in dieser Umgebung dem WikiSync; der Zug lässt sie aus (Werke, Ortslisten, Links, Herkunft)",
                { bereich: "literatur" },
            ),
        );
        return report;
    }
    try {
        await database.begin(async (transaction) => {
            const index = await readTargetIndex(transaction);
            const transformed = transformLiterature(payload, index, overlay);
            report.findings.push(...transformed.findings);
            report.resolution = transformed.totals;
            if (transformed.skipped) {
                report.skipped = true;
                return;
            }
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'literature', 'avesmaps-legacy', ${sourceRef}, ${LITERATURE_CONTRACT_VERSION})
            `;
            await writeAll(transaction, runId, transformed, report);
            const privateChanged =
                report.privateFields.works +
                report.privateFields.places +
                report.privateFields.fieldOrigins.created +
                report.privateFields.fieldOrigins.retired +
                report.privateFields.tombstonePlaces.created +
                report.privateFields.tombstonePlaces.converted +
                report.privateFields.tombstoneWorks;
            report.changed =
                Object.values(report.tables).some((table) => table.created + table.updated + table.retired > 0) ||
                privateChanged > 0;
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables: report.tables,
                        resolution: report.resolution,
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
    transformed: LiteratureTransform,
    report: ImportLiteratureReport,
): Promise<void> {
    const findings = report.findings;
    const workRef = (publicId: string, title: string): FindingObject => ({ table: "adventure", publicId, name: title });

    // ---- Werke --------------------------------------------------------------------------------------------------------------------
    // Ein Werk, das die Datei unterdrückt nennt, wird zum Tombstone (nur Vorhandenes) und danach nicht mehr angefasst.
    if (transformed.suppressedWorks.length > 0) {
        const done = await writeTombstones(
            transaction,
            "adventure",
            [{ name: "public_id", type: "uuid" }],
            first,
            transformed.suppressedWorks.map((publicId) => [publicId]),
            runId,
            false,
        );
        report.privateFields.tombstoneWorks = done.converted;
    }
    const workRows: ExpectedRow[] = transformed.works.map((work) => ({
        ref: workRef(work.publicId, work.title),
        cells: [
            work.publicId,
            work.publicId,
            work.wikiUrl,
            work.title,
            work.productType,
            work.edition,
            work.bfYear,
            work.bfLabel,
            work.genre,
            work.complexityGm,
            work.complexityPl,
            work.isOfficial,
            work.series,
            work.fshopCode,
            work.linkUlisses,
            work.linkFshop,
            work.isbn,
            work.containedIn,
        ],
    }));
    const works = await syncReported(
        transaction,
        runId,
        "adventure",
        workSpec(),
        workRows,
        report.tables.adventure,
        findings,
    );
    const protectedWorks = new Set(works.protectedHits);
    const idOf = (publicId: string): string => {
        const id = works.idByKey.get(publicId);
        if (id === undefined) throw new Error(`adventure: das Werk ${publicId} fehlt nach dem Abgleich`);
        return id;
    };

    // ---- Private Felder der Werke (additiv, nur was die Datei nennt) -------------------------------------------------------------
    await enrichWorks(transaction, runId, transformed, works.idByKey, protectedWorks, report);

    // ---- Orte ---------------------------------------------------------------------------------------------------------------------
    if (transformed.suppressedPlaces.length > 0) {
        const rows = transformed.suppressedPlaces
            .filter((place) => works.idByKey.has(place.workPublicId) && !protectedWorks.has(place.workPublicId))
            .map((place): Cell[] => [
                idOf(place.workPublicId),
                place.sortOrder,
                place.exportOrdinal,
                place.nameKey,
                place.dupOrdinal,
                place.rawName,
                place.role,
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
            "adventure_place",
            PLACE_TOMBSTONE_COLUMNS,
            placeKey,
            rows,
            runId,
        );
    }
    const placeRows: ExpectedRow[] = transformed.places
        .filter((place) => !protectedWorks.has(place.workPublicId))
        .map((place) => ({
            ref: {
                table: "adventure_place",
                publicId: place.workPublicId,
                name: `${place.workTitle} / ${place.rawName}`,
            },
            cells: placeCells(idOf(place.workPublicId), place),
        }));
    const places = await syncReported(
        transaction,
        runId,
        "adventure_place",
        placeSpec(),
        placeRows,
        report.tables.adventure_place,
        findings,
    );
    if (transformed.privatePlaces.length > 0) {
        const updates = transformed.privatePlaces
            .filter((place) => !protectedWorks.has(place.workPublicId))
            .flatMap((place) => {
                const id = places.idByKey.get(
                    `${idOf(place.workPublicId)}|${String(place.sortOrder)}|${place.nameKey}|${String(place.dupOrdinal)}`,
                );
                return id === undefined ? [] : [{ id, cells: [place.origin] as Cell[] }];
            });
        report.privateFields.places = await enrichRows(
            transaction,
            "adventure_place",
            [text("legacy_origin")],
            updates,
            runId,
        );
    }

    // ---- Links --------------------------------------------------------------------------------------------------------------------
    const linkRows: ExpectedRow[] = transformed.links
        .filter((link) => !protectedWorks.has(link.workPublicId))
        .map((link) => ({
            ref: { table: "adventure_link", publicId: link.workPublicId, name: `${link.workTitle} / ${link.url}` },
            cells: [idOf(link.workPublicId), link.url, link.label, link.position],
        }));
    await syncReported(
        transaction,
        runId,
        "adventure_link",
        linkSpec(),
        linkRows,
        report.tables.adventure_link,
        findings,
    );
}

/** Wiki-Schlüssel, Autoren, Stempel, Herkunft und Herkunftsvermerke je Feld: additiv für die Werke, die die Datei nennt. */
async function enrichWorks(
    transaction: Queryable,
    runId: string,
    transformed: LiteratureTransform,
    idByKey: ReadonlyMap<string, string>,
    protectedWorks: ReadonlySet<string>,
    report: ImportLiteratureReport,
): Promise<void> {
    const entries = transformed.privateWorks.filter(
        (entry) => !protectedWorks.has(entry.publicId) && idByKey.has(entry.publicId),
    );
    if (entries.length === 0) return;
    const idOf = (publicId: string): string => idByKey.get(publicId) as string;
    const one = async (column: Col, pick: (entry: (typeof entries)[number]) => Cell): Promise<number> => {
        const updates = entries
            .map((entry) => ({ id: idOf(entry.publicId), cells: [pick(entry)] as Cell[] }))
            .filter((update) => update.cells[0] !== null);
        return enrichRows(transaction, "adventure", [column], updates, runId);
    };
    let changed = 0;
    changed += await one(text("legacy_origin"), (entry) => entry.origin);
    changed += await one(text("authors"), (entry) => entry.authors);
    changed += await one({ name: "synced_at", type: "timestamptz" }, (entry) => entry.syncedAt);

    // Der Wiki-Schlüssel ist eindeutig: Hält ihn ein anderes Werk, wird er nicht gesetzt (Befund), nie still umgehängt.
    const held = new Map<string, string>();
    for (const row of await transaction<{ public_id: string; wiki_key: string }[]>`
        SELECT public_id::text, wiki_key FROM adventure WHERE wiki_key IS NOT NULL
    `) {
        held.set(row.wiki_key, row.public_id);
    }
    const conflicts: FindingObject[] = [];
    const keyUpdates = entries.flatMap((entry) => {
        if (entry.wikiKey === null) return [];
        const owner = held.get(entry.wikiKey);
        if (owner !== undefined && owner !== entry.publicId) {
            conflicts.push({ table: "adventure", publicId: entry.publicId, name: null });
            return [];
        }
        return [{ id: idOf(entry.publicId), cells: [entry.wikiKey] as Cell[] }];
    });
    changed += await enrichRows(transaction, "adventure", [text("wiki_key")], keyUpdates, runId);
    if (conflicts.length > 0) {
        report.findings.push(
            createFinding(
                "wiki_key_conflict",
                `${String(conflicts.length)} Werke, deren wiki_key schon ein anderes Werk trägt; nicht gesetzt (der Schlüssel ist eindeutig)`,
                { werke: conflicts.length },
                conflicts,
            ),
        );
    }
    report.privateFields.works = changed;

    // Herkunftsvermerke je Feld: für die Werke, die die Datei mit einem Satz nennt, wird der Satz ersetzt.
    const expectedByParent = new Map<string, (readonly Cell[])[]>();
    for (const entry of entries) {
        if (entry.fieldOrigins === null) continue;
        expectedByParent.set(
            idOf(entry.publicId),
            entry.fieldOrigins.map((origin) => [origin.field, origin.origin]),
        );
    }
    if (expectedByParent.size > 0) {
        report.privateFields.fieldOrigins = await replaceChildren(
            transaction,
            "adventure_field_origin",
            "adventure_id",
            FIELD_ORIGIN_COLUMNS,
            expectedByParent,
            "field",
        );
        report.tables.adventure_field_origin.created = report.privateFields.fieldOrigins.created;
        report.tables.adventure_field_origin.retired = report.privateFields.fieldOrigins.retired;
        report.tables.adventure_field_origin.unchanged = report.privateFields.fieldOrigins.unchanged;
    }
}

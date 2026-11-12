import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { syncReported, type ExpectedRow } from "./catalog-sync.ts";
import {
    countNamedPlaces,
    describeNamedPlaces,
    emptyNamedPlaceCounts,
    readSettlementKeyIndex,
    type NamedPlaceCounts,
} from "./staetten-genannte-orte.ts";
import {
    SITE_KINDS,
    STAETTEN_V2_CONTRACT_VERSION,
    crossStampFindingsV2,
    siteKeyOf,
    transformRohquellen,
    type SiteKind,
    type SiteRow,
    type SiteSourceCount,
} from "./staetten-rohquellen.ts";
import {
    emptyTableReport,
    replaceChildren,
    type Cell,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";

/**
 * Schreibt die Stätten über Kennungen idempotent (WI-0134, Migration 0099, Vertrag `staetten.yaml` Version 2): Objekt (`site`),
 * Beziehung (`site_settlement`) und Evidenz (`site_named_place`) aus Legacys Rohquellen-Export X4. EINE Transaktion; der zweite Lauf
 * mit derselben Antwort findet nichts zu schreiben.
 *
 * 🔴 **Regeln** (WI-0134 §3):
 *  - Was Legacy nicht mehr nennt, wird stillgelegt, nie gelöscht; genannte Orte sind Teil ihrer Stätte und werden mit ihrem Satz ersetzt.
 *  - Der Ort einer Beziehung kommt NUR aus der Kennung: aktiver Ort mit `place.public_id` = Legacys Kennung. Trifft sie keinen, bleibt
 *    `place_id` leer (Befund), die Kennung steht trotzdem.
 *  - Eine Beziehung mit `origin = 'editor'` (ein Mensch in Avesmaps3D) fasst der Zug nie an, auch wenn Legacy etwas anderes sagt
 *    (AGENTS.md, Betreiber 2026-10-10; Befund `row_vs_decision`).
 *  - Eine Quelle, die der Kopf als ausgefallen meldet, legt nichts still: ihre Stätten und deren Beziehungen sind für diesen Lauf
 *    geschützt (Befund, kein Tor).
 *  - Kartendatenübernahme nur mit dem Zuruf des Betreibers (CLI); ohne ihn rechnet der Lauf und rollt zurück, auch das Journal.
 */

export const SITE_TABLES = ["site", "site_settlement", "site_named_place"] as const;
export type SiteTable = (typeof SITE_TABLES)[number];

export interface ImportRohquellenOptions {
    dryRun?: boolean;
    /** Antworten desselben Zuges (X2, X3), nur für den Abgleich der Stände; nie geschrieben. */
    sameTrain?: Readonly<Record<string, unknown>>;
}

/** Wie die Beziehungen dieses Satzes ausgehen. */
export interface RelationCounts {
    /** Mit gespeicherter Kennung der Stadt. */
    withId: number;
    /** Davon trifft die Kennung einen aktiven Ort. */
    resolved: number;
    /** Davon trifft sie keinen. */
    unresolved: number;
    /** Entscheidung „keine Stadt“ (Herkunft ohne Kennung). */
    noSettlement: number;
    /** Stätten des Satzes ohne gespeicherte Beziehung: offen (eine Zahl, kein Fehler). */
    open: number;
}

export interface ImportRohquellenReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    skipped: boolean;
    tables: Record<SiteTable, TableReport>;
    counts: Record<SiteKind, SiteSourceCount>;
    failedKinds: SiteKind[];
    relations: RelationCounts;
    /** Die genannten Orte der Ketten (Wege, Sitze, Stadtteile), gezählt über die Zuordnung X2. */
    namedPlaces: NamedPlaceCounts;
    changed: boolean;
    findings: Finding[];
}

const text = (name: string): Col => ({ name, type: "text" });

/** Die Spalten von `site`, die der Import führt; Import und Prüfer lesen und schreiben sie gleich. */
export const SITE_COLUMNS: readonly Col[] = [
    text("source_kind"),
    text("source_key"),
    text("name"),
    text("site_class"),
    text("site_type"),
    text("seat_role"),
    { name: "seat_order", type: "int" },
    text("wiki_url"),
    text("wiki_key"),
    text("raw_location"),
    text("source_origin"),
    { name: "on_map", type: "boolean" },
];

export const siteCells = (row: SiteRow): Cell[] => [
    row.sourceKind,
    row.sourceKey,
    row.name,
    row.siteClass,
    row.siteType,
    row.seatRole,
    row.seatOrder,
    row.wikiUrl,
    row.wikiKey,
    row.rawLocation,
    row.sourceOrigin,
    row.onMap,
];

/** Der Schlüssel aus den Zellen: Art und Kennung, wie `site_source_unique`. */
export const siteKeyOfCells = (cells: readonly Cell[]): string =>
    siteKeyOf(String(cells[0]) as SiteKind, String(cells[1]));

/** Die Spalten von `site_settlement` (ohne `id` und die gemeinsamen). */
export const SITE_SETTLEMENT_COLUMNS: readonly Col[] = [
    { name: "site_id", type: "bigint" },
    { name: "settlement_legacy_public_id", type: "uuid" },
    { name: "place_id", type: "bigint" },
    text("origin"),
];

/** Die Spalten von `site_named_place` (ohne `site_id`, die `replaceChildren` setzt). */
export const SITE_NAMED_PLACE_COLUMNS: readonly Col[] = [
    { name: "position", type: "int" },
    text("target_raw"),
    text("target_key"),
];

/** Nur feste Wörter aus `SITE_KINDS` gehen in die Bedingung, nie ein Wert aus der Antwort. */
const kindList = (kinds: readonly SiteKind[]): string =>
    kinds
        .filter((kind) => (SITE_KINDS as readonly string[]).includes(kind))
        .map((kind) => `'${kind}'`)
        .join(", ");

function siteSpec(failedKinds: readonly SiteKind[]): SyncSpec {
    const failed = kindList(failedKinds);
    return {
        table: "site",
        columns: SITE_COLUMNS,
        keyOf: siteKeyOfCells,
        // Zeilen, die nicht aus Legacy stammen, und die Stätten einer ausgefallenen Quelle fasst dieser Lauf nicht an.
        protectedWhere:
            failed === ""
                ? "t.source_system <> 'legacy'"
                : `t.source_system <> 'legacy' OR t.source_kind IN (${failed})`,
        describe: { join: "", publicId: "t.source_key", name: "t.name" },
    };
}

function settlementSpec(failedKinds: readonly SiteKind[]): SyncSpec {
    const failed = kindList(failedKinds);
    const ofFailed =
        failed === ""
            ? ""
            : ` OR EXISTS (SELECT 1 FROM site s WHERE s.id = t.site_id AND s.source_kind IN (${failed}))`;
    return {
        table: "site_settlement",
        columns: SITE_SETTLEMENT_COLUMNS,
        keyOf: (cells) => String(cells[0]),
        // 🔴 Die Entscheidung eines Menschen überlebt jeden Zug; die Beziehungen einer ausgefallenen Quelle bleiben stehen.
        protectedWhere: `t.origin = 'editor'${ofFailed}`,
        describe: { join: "JOIN site s ON s.id = t.site_id", publicId: "s.source_key", name: "s.name" },
    };
}

class DryRunRollback extends Error {}

const emptyRelations = (): RelationCounts => ({ withId: 0, resolved: 0, unresolved: 0, noSettlement: 0, open: 0 });

/** Kennung → `place.id` der aktiven Orte, nur für die genannten Kennungen. */
async function readPlaceIds(database: Queryable, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await database<{ public_id: string; id: string }[]>`
        SELECT public_id::text AS public_id, id::text AS id FROM place WHERE is_active AND public_id = ANY(${[...ids]}::uuid[])
    `;
    return new Map(rows.map((row) => [row.public_id, row.id]));
}

export async function importStaettenRohquellen(
    database: Database,
    payload: unknown,
    options: ImportRohquellenOptions = {},
): Promise<ImportRohquellenReport> {
    const runId = randomUUID();
    const transformed = transformRohquellen(payload);
    const stamps = transformed.stamps;
    const sourceRef =
        `staetten-rohquellen-export.php; quellen_stand=${stamps.sourcesStamp ?? "unbekannt"}` +
        `; map_revision=${String(stamps.mapRevision ?? "unbekannt")}; staetten=${String(transformed.sites.length)}`;
    const report: ImportRohquellenReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: transformed.skipped,
        tables: { site: emptyTableReport(), site_settlement: emptyTableReport(), site_named_place: emptyTableReport() },
        counts: transformed.counts,
        failedKinds: transformed.failedKinds,
        relations: emptyRelations(),
        namedPlaces: emptyNamedPlaceCounts(),
        changed: false,
        findings: [
            ...transformed.findings,
            ...(transformed.skipped ? [] : crossStampFindingsV2(stamps, options.sameTrain ?? {})),
        ],
    };
    if (transformed.skipped) return report;
    // Ohne Migration 0099 gibt es nichts zu schreiben: der Schritt entfällt mit Befund, statt am fehlenden Schema abzubrechen.
    const [schema] = await database<{ present: string | null }[]>`SELECT to_regclass('site')::text AS present`;
    if (schema?.present == null) {
        report.skipped = true;
        report.findings.push(
            createFinding(
                "migration_missing",
                "Migration 0099_site_identities fehlt (npm run db:migrate): die Stätten über Kennungen werden nicht geschrieben",
                { migration: "0099_site_identities" },
            ),
        );
        return report;
    }

    try {
        await database.begin(async (transaction) => {
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'staetten-kennungen', 'avesmaps-legacy', ${sourceRef}, ${STAETTEN_V2_CONTRACT_VERSION})
            `;

            // ---- Objekte ----------------------------------------------------------------------------------------------------------
            const siteRows: ExpectedRow[] = transformed.sites.map((site) => ({
                ref: { table: `site:${site.sourceKind}`, publicId: site.sourceKey, name: site.name },
                cells: siteCells(site),
            }));
            const sites = await syncReported(
                transaction,
                runId,
                "site",
                siteSpec(transformed.failedKinds),
                siteRows,
                report.tables.site,
                report.findings,
            );
            const idOf = (key: string): string => {
                const id = sites.idByKey.get(key);
                if (id === undefined) throw new Error(`site: die Stätte ${key} fehlt nach dem Abgleich`);
                return id;
            };

            // ---- Beziehungen, nur aus der Kennung -------------------------------------------------------------------------------------
            const ids = [
                ...new Set(
                    transformed.relations
                        .map((relation) => relation.settlementLegacyPublicId)
                        .filter((id): id is string => id !== null),
                ),
            ];
            const placeIds = await readPlaceIds(transaction, ids);
            const unresolved: FindingObject[] = [];
            const relations = report.relations;
            const nameOf = new Map(transformed.sites.map((site) => [siteKeyOf(site.sourceKind, site.sourceKey), site]));
            const relationRows: ExpectedRow[] = transformed.relations.map((relation) => {
                const site = nameOf.get(relation.siteKey);
                const ref: FindingObject = {
                    table: `site_settlement:${site?.sourceKind ?? "?"}`,
                    publicId: site?.sourceKey ?? relation.siteKey,
                    name: site?.name ?? null,
                };
                let placeId: string | null = null;
                if (relation.settlementLegacyPublicId === null) {
                    relations.noSettlement += 1;
                } else {
                    relations.withId += 1;
                    placeId = placeIds.get(relation.settlementLegacyPublicId) ?? null;
                    if (placeId === null) {
                        relations.unresolved += 1;
                        unresolved.push({ ...ref, name: `${ref.name ?? ""} → ${relation.settlementLegacyPublicId}` });
                    } else {
                        relations.resolved += 1;
                    }
                }
                return {
                    ref,
                    cells: [idOf(relation.siteKey), relation.settlementLegacyPublicId, placeId, relation.origin],
                };
            });
            relations.open = transformed.sites.length - transformed.relations.length;
            await syncReported(
                transaction,
                runId,
                "site_settlement",
                settlementSpec(transformed.failedKinds),
                relationRows,
                report.tables.site_settlement,
                report.findings,
            );
            if (unresolved.length > 0) {
                report.findings.push(
                    createFinding(
                        "site_settlement_unresolved",
                        `${String(unresolved.length)} Stätten nennen eine Kennung der Stadt, die keinen aktiven Ort trifft; die Kennung ist gespeichert, der Ort bleibt leer`,
                        { zeilen: unresolved.length },
                        unresolved,
                    ),
                );
            }

            // ---- Evidenz: die genannten Orte, ersetzt mit dem Satz ihrer Stätte ------------------------------------------------------
            const byParent = new Map<string, Cell[][]>();
            for (const [key, places] of transformed.namedPlaces) {
                byParent.set(
                    idOf(key),
                    places.map((place) => [place.position, place.targetRaw, place.targetKey]),
                );
            }
            const children = await replaceChildren(
                transaction,
                "site_named_place",
                "site_id",
                SITE_NAMED_PLACE_COLUMNS,
                byParent,
            );
            const named = report.tables.site_named_place;
            named.created = children.created;
            named.retired = children.retired;
            named.unchanged = children.unchanged;

            const chains = transformed.sites
                .filter(
                    (site) =>
                        site.sourceKind === "weg" || site.sourceKind === "sitz" || site.sourceKind === "stadtteil",
                )
                .map((site) =>
                    (transformed.namedPlaces.get(siteKeyOf(site.sourceKind, site.sourceKey)) ?? []).map(
                        (place) => place.targetKey,
                    ),
                );
            report.namedPlaces = countNamedPlaces(chains, await readSettlementKeyIndex(transaction));

            if (transformed.failedKinds.length > 0) {
                report.findings.push(
                    createFinding(
                        "staetten_quelle_geschuetzt",
                        `Die Stätten der ausgefallenen Quellen (${transformed.failedKinds.join(", ")}) sind in diesem Lauf nicht angefasst und nicht stillgelegt`,
                        { quellen: transformed.failedKinds.length },
                    ),
                );
            }

            const tables = Object.values(report.tables);
            report.changed = tables.some((table) => table.created + table.updated + table.retired > 0);
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables: report.tables,
                        counts: report.counts,
                        failed_kinds: report.failedKinds,
                        relations: report.relations,
                        named_places: report.namedPlaces,
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

/**
 * Der Rückfall ohne X4: Die Stätten stehen dann nur in `settlement_place`, gebunden über den Namen der Stadt aus `in_settlement_places`
 * (I27 wie bisher). Das ist ein Befund, kein Tor; der Zug läuft weiter.
 */
export function onlyNamesFinding(reason: string): Finding {
    return createFinding(
        "staetten_nur_namen",
        `Ohne Legacys Rohquellen-Export (${reason}) hängen die Stätten weiter nur am Namen der Stadt (settlement_place aus in_settlement_places); die Kennungen, alle Sitze und der Zustand je Quelle fehlen in diesem Lauf`,
        { grund: reason },
    );
}

/** Die Kurzfassung eines Laufs für Kette und Bericht (nur Zahlen). */
export function summarizeStaettenRohquellen(report: ImportRohquellenReport): string {
    if (report.skipped)
        return "Kennungen: uebersprungen (Antwort unbrauchbar, alle Quellen ausgefallen oder Migration 0099 fehlt; siehe Befunde)";
    const perKind = SITE_KINDS.map((kind) => {
        const count = report.counts[kind];
        return count.ok ? `${kind} ${String(count.stored)}` : `${kind} AUSGEFALLEN`;
    }).join(", ");
    const site = report.tables.site;
    const relations = report.relations;
    return (
        `Kennungen: site ${String(site.created)}/${String(site.updated)}/${String(site.retired)} (neu/geaendert/stillgelegt); ${perKind}; ` +
        `Beziehungen ${String(relations.withId)} mit Kennung (${String(relations.resolved)} Ort, ${String(relations.unresolved)} ohne Ort), ` +
        `${String(relations.noSettlement)} keine Stadt, ${String(relations.open)} offen; ${describeNamedPlaces(report.namedPlaces)}`
    );
}

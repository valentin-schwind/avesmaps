import { randomUUID } from "node:crypto";
import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { withZugSperre } from "../derive/derive-lock.ts";
import { createFinding, type Finding } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    CONTRACT_VERSION,
    transformTerritories,
    type LegacyTerritoryPayload,
    type SkippedArea,
    type TerritoryTransform,
} from "./territories.ts";

/**
 * Schreibt die Herrschaftsgebiete idempotent in die Zieldatenbank (WI-0062, ADR-0014).
 *
 * Eine Transaktion, vier Phasen: Gebiete, Eltern, Flächen, Ansprüche. Die Phasen sind eine Vorsichtsmaßnahme beim
 * Schreiben, keine Domänengrenze - ein Abbruch in einer lässt keine der anderen stehen. Der zweite Lauf mit
 * demselben Stand ändert nichts (Idempotenz), und nur ein Lauf, der etwas ändert, entwertet die Ableitung.
 *
 * 🔴 Hauptstadt und Sitz werden als UUID des Ortes abgelegt und nicht gegen `place` geprüft: ein Verweis ins Leere
 * ist ein Befund des Prüfers, kein Fehler des Imports (ADR-0014).
 */

export interface ImportTerritoriesOptions {
    mapDomainId?: string;
    /** Der `X-Avesmaps-ETag` der Antwort, wenn sie live geholt wurde (für den bedingten Abruf des nächsten Zugs). */
    sourceEtag?: string | null;
}

export interface PhaseReport {
    created: number;
    updated: number;
    unchanged: number;
    retired: number;
}

export interface ImportTerritoriesReport {
    runId: string;
    sourceRef: string;
    stamp: string;
    territories: PhaseReport;
    areas: PhaseReport;
    claims: PhaseReport;
    /** Eltern-Zeiger, die neu oder anders gesetzt wurden. Beim zweiten Lauf null. */
    parentsChanged: number;
    skippedAreas: SkippedArea[];
    areasWithDroppedParts: number;
    droppedPolygons: number;
    droppedHoles: number;
    rejectedClaims: number;
    openEndSentinels: number;
    /** Hat der Lauf Wahrheit geändert? Dann ist die Ableitung entwertet. */
    changed: boolean;
    /** Was der Lauf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa die Stilllegequote. */
    findings: Finding[];
}

function emptyPhase(): PhaseReport {
    return { created: 0, updated: 0, unchanged: 0, retired: 0 };
}

function countRow(phase: PhaseReport, rows: { inserted: boolean }[]): void {
    if (rows.length === 0) phase.unchanged += 1;
    else if (rows[0]?.inserted) phase.created += 1;
    else phase.updated += 1;
}

/**
 * Der Gebietsimport (I14). Seit WI-0209 B1 schreibt der Editor die Gebietstafeln: Der Import nimmt dabei die Sperre der Kartendomäne
 * exklusiv (`withZugSperre`, EDIT-0003 T17), damit kein Speichern zwischen seine Zeilen fällt.
 */
export function importTerritories(
    database: Database,
    payload: LegacyTerritoryPayload,
    options: ImportTerritoriesOptions = {},
): Promise<ImportTerritoriesReport> {
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "I14 Herrschaftsgebiete", () =>
        importTerritoriesLocked(database, payload, options),
    );
}

/** Der Körper von `importTerritories`, unter der Sperre des Zugs. */
async function importTerritoriesLocked(
    database: Database,
    payload: LegacyTerritoryPayload,
    options: ImportTerritoriesOptions,
): Promise<ImportTerritoriesReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const transformed: TerritoryTransform = transformTerritories(payload);
    const stamp = payload.territories_revision as string;
    const sourceRef = `territories_revision=${stamp};map_revision=${String(payload.map_revision ?? "")}`;
    const runId = randomUUID();

    const report: ImportTerritoriesReport = {
        runId,
        sourceRef,
        stamp,
        territories: emptyPhase(),
        areas: emptyPhase(),
        claims: emptyPhase(),
        parentsChanged: 0,
        skippedAreas: transformed.skippedAreas,
        areasWithDroppedParts: transformed.areasWithDroppedParts,
        droppedPolygons: transformed.droppedPolygons,
        droppedHoles: transformed.droppedHoles,
        rejectedClaims: transformed.rejectedClaims,
        openEndSentinels: transformed.openEndSentinels,
        changed: false,
        findings: [],
    };

    if (transformed.bandsAboveLegacyMax.length > 0) {
        const above = transformed.bandsAboveLegacyMax;
        report.findings.push(
            createFinding(
                "legacy_band_max_changed",
                `${String(above.length)} Gebiete und Flächen tragen in Legacy eine Obergrenze über 6. Legacy zeigt Gebiete dann über ` +
                    "Band 6 hinaus; seine 6 ist nicht mehr „oben“, und die Regel 6 → 8 gehört neu entschieden (WI-0188, wie WI-0129 S11).",
                { rows: above.length, legacy_max_band: 6 },
                above.map((row) => ({ table: row.table, publicId: row.publicId, name: row.name })),
                above.length,
                above.slice(0, 20).map((row) => `${row.name} (${row.publicId}): max_zoom ${String(row.maxZoom)}`),
            ),
        );
    }

    await database.begin(async (transaction) => {
        const territoryIds = transformed.territories.map((territory) => territory.publicId);
        const areaIds = transformed.areas.map((area) => area.publicId);

        const [territoryPressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT count(*)::int AS active,
                   count(*) FILTER (WHERE public_id <> ALL(${territoryIds}::uuid[]))::int AS retiring
            FROM territory
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
        `;
        // Über MAX_RETIRE_FRACTION ist das ein Befund mit Namen, kein Abbruch (Betreiber 2026-10-03).
        const territoryQuota = await retireFinding("territory", territoryPressure, async () => {
            const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name
                FROM territory
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
                  AND public_id <> ALL(${territoryIds}::uuid[])
                ORDER BY name, public_id
            `;
            return rows.map((row) => ({ table: "territory", publicId: row.public_id, name: row.name }));
        });
        if (territoryQuota) report.findings.push(territoryQuota);
        const [areaPressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT count(*)::int AS active,
                   count(*) FILTER (WHERE public_id <> ALL(${areaIds}::uuid[]))::int AS retiring
            FROM territory_area
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
        `;
        // Eine Gebietsfläche hat keinen eigenen Namen: genannt wird der des Gebiets, zu dem sie gehört.
        const areaQuota = await retireFinding("territory_area", areaPressure, async () => {
            const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT a.public_id::text, t.name
                FROM territory_area a
                JOIN territory t ON t.id = a.territory_id
                WHERE a.map_domain_id = ${mapDomainId} AND a.source_system = 'legacy' AND a.is_active
                  AND a.public_id <> ALL(${areaIds}::uuid[])
                ORDER BY t.name, a.public_id
            `;
            return rows.map((row) => ({ table: "territory_area", publicId: row.public_id, name: row.name }));
        });
        if (areaQuota) report.findings.push(areaQuota);

        await transaction`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'territories', 'avesmaps-legacy', ${sourceRef}, ${CONTRACT_VERSION})
        `;

        // ---- P1: Gebiete (ohne Elter; der Baum entsteht in P2, wenn alle Zeilen da sind) ---------------------------
        for (const t of transformed.territories) {
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO territory (
                    public_id, map_domain_id, name, short_name, territory_type, wiki_type, status_text,
                    color, opacity, min_zoom, max_zoom, valid_from_bf, valid_to_bf, valid_label,
                    wiki_key, wiki_url, capital_place_public_id, seat_place_public_id, sort_order,
                    coat_ref, coat_license_status, coat_origin, legacy_updated_at,
                    source_system, legacy_public_id, migration_run_id, imported_at, is_active
                ) VALUES (
                    ${t.publicId}, ${mapDomainId}, ${t.name}, ${t.shortName}, ${t.territoryType}, ${t.wikiType},
                    ${t.statusText}, ${t.color}, ${t.opacity}, ${t.minZoom}, ${t.maxZoom}, ${t.validFromBf},
                    ${t.validToBf}, ${t.validLabel}, ${t.wikiKey}, ${t.wikiUrl}, ${t.capitalPlacePublicId},
                    ${t.seatPlacePublicId}, ${t.sortOrder}, ${t.coatRef}, ${t.coatLicenseStatus}, ${t.coatOrigin},
                    ${t.legacyUpdatedAt}::timestamp,
                    'legacy', ${t.publicId}, ${runId}, now(), TRUE
                )
                ON CONFLICT (public_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    short_name = EXCLUDED.short_name,
                    territory_type = EXCLUDED.territory_type,
                    wiki_type = EXCLUDED.wiki_type,
                    status_text = EXCLUDED.status_text,
                    color = EXCLUDED.color,
                    opacity = EXCLUDED.opacity,
                    min_zoom = EXCLUDED.min_zoom,
                    max_zoom = EXCLUDED.max_zoom,
                    valid_from_bf = EXCLUDED.valid_from_bf,
                    valid_to_bf = EXCLUDED.valid_to_bf,
                    valid_label = EXCLUDED.valid_label,
                    wiki_key = EXCLUDED.wiki_key,
                    wiki_url = EXCLUDED.wiki_url,
                    capital_place_public_id = EXCLUDED.capital_place_public_id,
                    seat_place_public_id = EXCLUDED.seat_place_public_id,
                    sort_order = EXCLUDED.sort_order,
                    coat_ref = EXCLUDED.coat_ref,
                    coat_license_status = EXCLUDED.coat_license_status,
                    coat_origin = EXCLUDED.coat_origin,
                    legacy_updated_at = EXCLUDED.legacy_updated_at,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    is_active = TRUE,
                    updated_at = now()
                WHERE territory.name IS DISTINCT FROM EXCLUDED.name
                   OR territory.short_name IS DISTINCT FROM EXCLUDED.short_name
                   OR territory.territory_type IS DISTINCT FROM EXCLUDED.territory_type
                   OR territory.wiki_type IS DISTINCT FROM EXCLUDED.wiki_type
                   OR territory.status_text IS DISTINCT FROM EXCLUDED.status_text
                   OR territory.color IS DISTINCT FROM EXCLUDED.color
                   OR territory.opacity IS DISTINCT FROM EXCLUDED.opacity
                   OR territory.min_zoom IS DISTINCT FROM EXCLUDED.min_zoom
                   OR territory.max_zoom IS DISTINCT FROM EXCLUDED.max_zoom
                   OR territory.valid_from_bf IS DISTINCT FROM EXCLUDED.valid_from_bf
                   OR territory.valid_to_bf IS DISTINCT FROM EXCLUDED.valid_to_bf
                   OR territory.valid_label IS DISTINCT FROM EXCLUDED.valid_label
                   OR territory.wiki_key IS DISTINCT FROM EXCLUDED.wiki_key
                   OR territory.wiki_url IS DISTINCT FROM EXCLUDED.wiki_url
                   OR territory.capital_place_public_id IS DISTINCT FROM EXCLUDED.capital_place_public_id
                   OR territory.seat_place_public_id IS DISTINCT FROM EXCLUDED.seat_place_public_id
                   OR territory.sort_order IS DISTINCT FROM EXCLUDED.sort_order
                   OR territory.coat_ref IS DISTINCT FROM EXCLUDED.coat_ref
                   OR territory.coat_license_status IS DISTINCT FROM EXCLUDED.coat_license_status
                   OR territory.coat_origin IS DISTINCT FROM EXCLUDED.coat_origin
                   OR territory.legacy_updated_at IS DISTINCT FROM EXCLUDED.legacy_updated_at
                   OR territory.is_active IS DISTINCT FROM TRUE
                RETURNING (xmax = 0) AS inserted
            `;
            countRow(report.territories, rows);
        }

        // ---- P2: der Baum -----------------------------------------------------------------------------------------
        const childIds = transformed.territories.map((territory) => territory.publicId);
        const parentIds = transformed.territories.map((territory) => territory.parentPublicId);
        const parentRows = await transaction<{ public_id: string }[]>`
            UPDATE territory SET parent_id = want.parent_id, parent_origin = NULL, updated_at = now()
            FROM (
                SELECT c.id AS child_id, p.id AS parent_id
                FROM unnest(${childIds}::uuid[], ${parentIds}::uuid[]) AS m(child_public_id, parent_public_id)
                JOIN territory c ON c.public_id = m.child_public_id
                LEFT JOIN territory p ON p.public_id = m.parent_public_id
            ) want
            WHERE territory.id = want.child_id
              AND territory.parent_id IS DISTINCT FROM want.parent_id
            RETURNING territory.public_id::text
        `;
        report.parentsChanged = parentRows.length;

        // ---- P3: Flächen ------------------------------------------------------------------------------------------
        for (const a of transformed.areas) {
            const geojson = JSON.stringify({ type: "MultiPolygon", coordinates: a.coordinates });
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO territory_area (
                    public_id, territory_id, map_domain_id, geom,
                    valid_from_bf, valid_to_bf, min_zoom, max_zoom, legacy_updated_at,
                    source_system, legacy_public_id, migration_run_id, imported_at, is_active
                )
                SELECT
                    ${a.publicId}, t.id, ${mapDomainId}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 0)),
                    ${a.validFromBf}, ${a.validToBf}, ${a.minZoom}, ${a.maxZoom}, ${a.legacyUpdatedAt}::timestamp,
                    'legacy', ${a.publicId}, ${runId}, now(), TRUE
                FROM territory t
                WHERE t.public_id = ${a.territoryPublicId}
                ON CONFLICT (public_id) DO UPDATE SET
                    territory_id = EXCLUDED.territory_id,
                    geom = EXCLUDED.geom,
                    valid_from_bf = EXCLUDED.valid_from_bf,
                    valid_to_bf = EXCLUDED.valid_to_bf,
                    min_zoom = EXCLUDED.min_zoom,
                    max_zoom = EXCLUDED.max_zoom,
                    legacy_updated_at = EXCLUDED.legacy_updated_at,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    is_active = TRUE,
                    updated_at = now()
                WHERE territory_area.territory_id IS DISTINCT FROM EXCLUDED.territory_id
                   OR territory_area.geom IS DISTINCT FROM EXCLUDED.geom
                   OR territory_area.valid_from_bf IS DISTINCT FROM EXCLUDED.valid_from_bf
                   OR territory_area.valid_to_bf IS DISTINCT FROM EXCLUDED.valid_to_bf
                   OR territory_area.min_zoom IS DISTINCT FROM EXCLUDED.min_zoom
                   OR territory_area.max_zoom IS DISTINCT FROM EXCLUDED.max_zoom
                   OR territory_area.legacy_updated_at IS DISTINCT FROM EXCLUDED.legacy_updated_at
                   OR territory_area.is_active IS DISTINCT FROM TRUE
                RETURNING (xmax = 0) AS inserted
            `;
            countRow(report.areas, rows);
        }

        // ---- P4: Ansprüche ----------------------------------------------------------------------------------------
        for (const c of transformed.claims) {
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO territory_claim (
                    territory_id, claimant_id, sort_order, source, migration_run_id, imported_at, is_active
                )
                SELECT t.id, k.id, ${c.sortOrder}, ${c.source}, ${runId}, now(), TRUE
                FROM territory t, territory k
                WHERE t.public_id = ${c.territoryPublicId} AND k.public_id = ${c.claimantPublicId}
                ON CONFLICT (territory_id, claimant_id) DO UPDATE SET
                    sort_order = EXCLUDED.sort_order,
                    source = EXCLUDED.source,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    is_active = TRUE,
                    updated_at = now()
                WHERE territory_claim.sort_order IS DISTINCT FROM EXCLUDED.sort_order
                   OR territory_claim.source IS DISTINCT FROM EXCLUDED.source
                   OR territory_claim.is_active IS DISTINCT FROM TRUE
                RETURNING (xmax = 0) AS inserted
            `;
            countRow(report.claims, rows);
        }

        // ---- Stilllegen, was die Quelle nicht mehr kennt ----------------------------------------------------------
        const claimTerritories = transformed.claims.map((claim) => claim.territoryPublicId);
        const claimClaimants = transformed.claims.map((claim) => claim.claimantPublicId);
        const retiredClaims = await transaction<{ id: string }[]>`
            UPDATE territory_claim SET is_active = FALSE, updated_at = now()
            WHERE is_active
              AND NOT EXISTS (
                    SELECT 1
                    FROM unnest(${claimTerritories}::uuid[], ${claimClaimants}::uuid[]) AS m(t_public_id, k_public_id)
                    JOIN territory t ON t.public_id = m.t_public_id
                    JOIN territory k ON k.public_id = m.k_public_id
                    WHERE t.id = territory_claim.territory_id AND k.id = territory_claim.claimant_id
                  )
            RETURNING id::text
        `;
        report.claims.retired = retiredClaims.length;

        const retiredAreas = await transaction<{ public_id: string }[]>`
            UPDATE territory_area SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND public_id <> ALL(${areaIds}::uuid[])
            RETURNING public_id
        `;
        report.areas.retired = retiredAreas.length;

        const retiredTerritories = await transaction<{ public_id: string }[]>`
            UPDATE territory SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND public_id <> ALL(${territoryIds}::uuid[])
            RETURNING public_id
        `;
        report.territories.retired = retiredTerritories.length;

        const changedRows = (phase: PhaseReport): number => phase.created + phase.updated + phase.retired;
        report.changed =
            changedRows(report.territories) + changedRows(report.areas) + changedRows(report.claims) > 0 ||
            report.parentsChanged > 0;

        // Der Stempel und der ETag der Quelle; eine Änderung entwertet die Ableitung (nur dann).
        await transaction`
            INSERT INTO territory_state (
                map_domain_id, source_stamp, source_etag, source_map_revision, imported_at
            ) VALUES (
                ${mapDomainId}, ${stamp}, ${options.sourceEtag ?? null}, ${payload.map_revision ?? null}, now()
            )
            ON CONFLICT (map_domain_id) DO UPDATE SET
                source_stamp = EXCLUDED.source_stamp,
                source_etag = EXCLUDED.source_etag,
                source_map_revision = EXCLUDED.source_map_revision,
                imported_at = EXCLUDED.imported_at,
                derived_revision = CASE WHEN ${report.changed} THEN NULL ELSE territory_state.derived_revision END,
                derived_year_bf = CASE WHEN ${report.changed} THEN NULL ELSE territory_state.derived_year_bf END,
                derived_at = CASE WHEN ${report.changed} THEN NULL ELSE territory_state.derived_at END
        `;

        await transaction`
            UPDATE migration_run
            SET completed_at = now(), status = 'completed', journal = ${
                {
                    territories: report.territories,
                    areas: report.areas,
                    claims: report.claims,
                    parents_changed: report.parentsChanged,
                    skipped_areas: report.skippedAreas.length,
                    areas_with_dropped_parts: report.areasWithDroppedParts,
                    dropped_polygons: report.droppedPolygons,
                    dropped_holes: report.droppedHoles,
                    rejected_claims: report.rejectedClaims,
                    open_end_sentinels: report.openEndSentinels,
                } as unknown as string
            }
            WHERE id = ${runId}
        `;
    });

    return report;
}

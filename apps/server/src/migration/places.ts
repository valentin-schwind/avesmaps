import { randomUUID } from "node:crypto";
import { AVENTURIA, isWithinBounds } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import type { Finding } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import { withZugSperre } from "../derive/derive-lock.ts";

/**
 * Import of the data domain "places" from Avesmaps Legacy.
 * Contract: project-control/migration/contracts/places.yaml
 *
 * The importer never writes to legacy and never invents values: a record it cannot map is
 * rejected and reported, not repaired (chapters 9.21, 9.32).
 */

export const CONTRACT_VERSION = "4";
export const PLACE_SUBTYPES = [
    "metropole",
    "grossstadt",
    "stadt",
    "kleinstadt",
    "dorf",
    "gebaeude",
    "stadtviertel",
] as const;

export type PlaceSubtype = (typeof PLACE_SUBTYPES)[number];

export interface LegacyLocation {
    public_id?: unknown;
    name?: unknown;
    subtype?: unknown;
    is_crossing?: unknown;
    coordinates?: { x?: unknown; y?: unknown };
    /** Verborgen: neither marker nor name on the map, and routing must not choose the place. */
    is_hidden?: boolean;
    is_ruined?: boolean;
    /** Carried across unchanged; its meaning is UNKNOWN and nothing is derived from it. */
    is_nodix?: boolean;
    /**
     * Carried across unchanged, like is_nodix. Legacy sets it automatically for a place with a
     * sea path connection and otherwise lets editors set it by hand (legacy_code c13ad72db,
     * 4938850b6, WI-0041); nothing is derived from it here, no rendering, routing or search.
     */
    is_seaport?: boolean;
    place_kind?: string | undefined;
}

export interface LegacyPayload {
    locations: LegacyLocation[];
    map_revision?: unknown;
    /** The count the endpoint itself reports. A payload that disagrees with it is truncated. */
    location_count?: unknown;
}

export interface ImportScope {
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    subtypes: readonly PlaceSubtype[];
}

export interface TransformedPlace {
    publicId: string;
    name: string;
    subtype: PlaceSubtype;
    x: number;
    y: number;
    isHidden: boolean;
    isRuined: boolean;
    isNodix: boolean;
    isSeaport: boolean;
    placeKind: string | null;
}

export interface TransformResult {
    places: TransformedPlace[];
    skippedCrossings: number;
    skippedOutOfScope: number;
    rejected: { publicId: string; reason: string }[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MigrationAborted extends Error {
    // Written out rather than declared as a constructor parameter property: Node strips types, it
    // does not transpile them, and a parameter property is syntax it cannot strip.
    readonly detail: Record<string, number | string>;

    constructor(message: string, detail: Record<string, number | string>) {
        super(message);
        this.name = "MigrationAborted";
        this.detail = detail;
    }
}

/**
 * The source has to agree with itself before anything is written. The endpoint reports how many
 * locations it means to send; a shorter list is a truncated transfer, and a truncated transfer
 * looks exactly like a mass deletion to the importer.
 *
 * 🔴 Stays a stop (operator 2026-10-03, "A auch für die Prüfungen", BLOCKING_SOURCE_CHECKS A12): with the retire quota
 * reduced to a finding, this is the only brake against a truncated transfer.
 */
export function assertSourceComplete(payload: LegacyPayload): void {
    const declared = Number(payload.location_count);
    if (!Number.isFinite(declared)) {
        throw new MigrationAborted("the source does not declare location_count", {
            delivered: payload.locations.length,
        });
    }
    if (declared !== payload.locations.length) {
        throw new MigrationAborted("the source payload is incomplete", {
            declared,
            delivered: payload.locations.length,
        });
    }
}

function isInScope(scope: ImportScope, x: number, y: number, subtype: PlaceSubtype): boolean {
    return (
        scope.subtypes.includes(subtype) &&
        x >= scope.bounds.minX &&
        x <= scope.bounds.maxX &&
        y >= scope.bounds.minY &&
        y <= scope.bounds.maxY
    );
}

/** Pure transformation: legacy payload -> place rows, plus the counts the journal needs. */
export function transformLocations(payload: LegacyPayload, scope: ImportScope): TransformResult {
    const result: TransformResult = { places: [], skippedCrossings: 0, skippedOutOfScope: 0, rejected: [] };
    const seen = new Set<string>();

    for (const location of payload.locations) {
        const publicId = typeof location.public_id === "string" ? location.public_id : "";

        if (location.is_crossing === true) {
            result.skippedCrossings += 1;
            continue;
        }
        if (!UUID_PATTERN.test(publicId)) {
            result.rejected.push({ publicId, reason: "public_id is not a uuid" });
            continue;
        }

        const subtype = location.subtype;
        if (typeof subtype !== "string" || !PLACE_SUBTYPES.includes(subtype as PlaceSubtype)) {
            result.rejected.push({ publicId, reason: `unknown subtype: ${String(subtype)}` });
            continue;
        }

        const x = Number(location.coordinates?.x);
        const y = Number(location.coordinates?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            result.rejected.push({ publicId, reason: "coordinates are not finite numbers" });
            continue;
        }
        if (!isWithinBounds(AVENTURIA.coordinateSpace, { x, y })) {
            result.rejected.push({ publicId, reason: `outside the coordinate space: ${x}/${y}` });
            continue;
        }

        const name = typeof location.name === "string" ? location.name.trim() : "";
        if (name === "") {
            result.rejected.push({ publicId, reason: "name is empty" });
            continue;
        }

        if (!isInScope(scope, x, y, subtype as PlaceSubtype)) {
            result.skippedOutOfScope += 1;
            continue;
        }
        if (seen.has(publicId)) {
            result.rejected.push({ publicId, reason: "duplicate public_id in the source" });
            continue;
        }

        seen.add(publicId);
        result.places.push({
            publicId,
            name,
            subtype: subtype as PlaceSubtype,
            x,
            y,
            // A source that does not carry the flags leaves every place at false, which is what
            // the route network endpoint produces and what legacy itself means by a missing key.
            isHidden: location.is_hidden === true,
            isRuined: location.is_ruined === true,
            isNodix: location.is_nodix === true,
            isSeaport: location.is_seaport === true,
            placeKind: location.place_kind ?? null,
        });
    }

    return result;
}

export interface ImportOptions {
    mapDomainId?: string;
}

export interface ImportReport {
    runId: string;
    sourceRef: string;
    created: number;
    updated: number;
    /** Rows the source describes exactly as they already are; the database is not touched for them. */
    unchanged: number;
    retired: number;
    skippedCrossings: number;
    skippedOutOfScope: number;
    rejected: { publicId: string; reason: string }[];
    /** Was der Lauf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa die Stilllegequote, siehe retire-findings.ts. */
    findings: Finding[];
}

/**
 * Applies a transformed slice idempotently. Rows inside the scope that the source no longer
 * contains are retired (soft delete); rows outside the scope are never touched, because absence
 * outside the scope says nothing about deletion (chapter 9.36).
 */
export function importPlaces(
    database: Database,
    payload: LegacyPayload,
    scope: ImportScope,
    options: ImportOptions = {},
): Promise<ImportReport> {
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "I1 Orte", () =>
        importPlacesLocked(database, payload, scope, options),
    );
}

/** Der Körper von `importPlaces`, unter der Sperre des Zugs. */
async function importPlacesLocked(
    database: Database,
    payload: LegacyPayload,
    scope: ImportScope,
    options: ImportOptions = {},
): Promise<ImportReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    assertSourceComplete(payload);
    const transformed = transformLocations(payload, scope);
    const sourceRef = `map_revision=${String(payload.map_revision ?? "unknown")}`;
    const runId = randomUUID();

    const report: ImportReport = {
        runId,
        sourceRef,
        created: 0,
        updated: 0,
        unchanged: 0,
        retired: 0,
        skippedCrossings: transformed.skippedCrossings,
        skippedOutOfScope: transformed.skippedOutOfScope,
        rejected: transformed.rejected,
        findings: [],
    };

    await database.begin(async (transaction) => {
        // Count what this run retires, inside the transaction so the number cannot change underneath.
        // Beyond MAX_RETIRE_FRACTION that is a finding with the names, not a stop (operator 2026-10-03).
        const incoming = transformed.places.map((place) => place.publicId);
        const [pressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT
                count(*)::int AS active,
                count(*) FILTER (WHERE public_id <> ALL(${incoming}::uuid[]))::int AS retiring
            FROM place
            WHERE map_domain_id = ${mapDomainId}
              AND source_system = 'legacy'
              AND is_active
              AND subtype = ANY(${scope.subtypes as unknown as string[]})
              AND ST_Within(
                    geom,
                    ST_MakeEnvelope(
                        ${scope.bounds.minX}, ${scope.bounds.minY},
                        ${scope.bounds.maxX}, ${scope.bounds.maxY}, 0
                    )
                  )
        `;
        const quota = await retireFinding("place", pressure, async () => {
            const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name
                FROM place
                WHERE map_domain_id = ${mapDomainId}
                  AND source_system = 'legacy'
                  AND is_active
                  AND subtype = ANY(${scope.subtypes as unknown as string[]})
                  AND ST_Within(
                        geom,
                        ST_MakeEnvelope(
                            ${scope.bounds.minX}, ${scope.bounds.minY},
                            ${scope.bounds.maxX}, ${scope.bounds.maxY}, 0
                        )
                      )
                  AND public_id <> ALL(${incoming}::uuid[])
                ORDER BY name, public_id
            `;
            return rows.map((row) => ({ table: "place", publicId: row.public_id, name: row.name }));
        });
        if (quota) report.findings.push(quota);

        await transaction`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'places', 'avesmaps-legacy', ${sourceRef}, ${CONTRACT_VERSION})
        `;

        for (const place of transformed.places) {
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO place (
                    public_id, map_domain_id, name, subtype, geom,
                    is_hidden, is_ruined, is_nodix, is_seaport, place_kind,
                    source_system, legacy_public_id, migration_run_id, imported_at, is_active
                ) VALUES (
                    ${place.publicId}, ${mapDomainId}, ${place.name}, ${place.subtype},
                    ST_SetSRID(ST_MakePoint(${place.x}, ${place.y}), 0),
                    ${place.isHidden}, ${place.isRuined}, ${place.isNodix}, ${place.isSeaport}, ${place.placeKind},
                    'legacy', ${place.publicId}, ${runId}, now(), TRUE
                )
                ON CONFLICT (public_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    subtype = EXCLUDED.subtype,
                    geom = EXCLUDED.geom,
                    is_hidden = EXCLUDED.is_hidden,
                    is_ruined = EXCLUDED.is_ruined,
                    is_nodix = EXCLUDED.is_nodix,
                    is_seaport = EXCLUDED.is_seaport,
                    place_kind = EXCLUDED.place_kind,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    is_active = TRUE,
                    updated_at = now()
                -- Only when something actually differs. Without this every repeat run would touch
                -- every row, and "idempotent" would mean "ends up the same" instead of "does
                -- nothing" (chapter 9.32).
                WHERE place.name IS DISTINCT FROM EXCLUDED.name
                   OR place.subtype IS DISTINCT FROM EXCLUDED.subtype
                   OR place.geom IS DISTINCT FROM EXCLUDED.geom
                   OR place.is_hidden IS DISTINCT FROM EXCLUDED.is_hidden
                   OR place.is_ruined IS DISTINCT FROM EXCLUDED.is_ruined
                   OR place.is_nodix IS DISTINCT FROM EXCLUDED.is_nodix
                   OR place.is_seaport IS DISTINCT FROM EXCLUDED.is_seaport
                   OR place.place_kind IS DISTINCT FROM EXCLUDED.place_kind
                   OR place.is_active IS DISTINCT FROM TRUE
                RETURNING (xmax = 0) AS inserted
            `;
            if (rows.length === 0) {
                report.unchanged += 1;
            } else if (rows[0]?.inserted) {
                report.created += 1;
            } else {
                report.updated += 1;
            }
        }

        // Retire what the source dropped, limited to this run's scope. Decided by absence from the
        // source, not by the run id: an unchanged row is deliberately left untouched above and
        // would otherwise look like one the source forgot.
        const retired = await transaction<{ public_id: string }[]>`
            UPDATE place SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId}
              AND source_system = 'legacy'
              AND is_active
              AND subtype = ANY(${scope.subtypes as unknown as string[]})
              AND ST_Within(
                    geom,
                    ST_MakeEnvelope(
                        ${scope.bounds.minX}, ${scope.bounds.minY},
                        ${scope.bounds.maxX}, ${scope.bounds.maxY}, 0
                    )
                  )
              AND public_id <> ALL(${incoming}::uuid[])
            RETURNING public_id
        `;
        report.retired = retired.length;

        await transaction`
            UPDATE migration_run
            SET completed_at = now(), status = 'completed', journal = ${
                {
                    created: report.created,
                    updated: report.updated,
                    unchanged: report.unchanged,
                    retired: report.retired,
                    skipped_crossings: report.skippedCrossings,
                    skipped_out_of_scope: report.skippedOutOfScope,
                    rejected: report.rejected.length,
                    scope,
                } as unknown as string
            }
            WHERE id = ${runId}
        `;
    });

    return report;
}

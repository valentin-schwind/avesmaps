import { createHash } from "node:crypto";
import type { Queryable } from "../database.ts";
import type { RiverBurnInput } from "./river-burn.ts";
import { JOIN_TOLERANCE, type RiverLake, type RiverRow } from "./river-network.ts";
import { type V12Geometry } from "@avesmaps3d/shared";

/**
 * Die Eingaben des Einbrennens aus der Datenbank (WI-0049 S6) und der Fingerabdruck, der entscheidet, ob
 * `derive:terrain` neu rechnet.
 *
 * - Flüsse: aktive `path` mit `subtype = 'Flussweg'`, samt `is_bach` und `flow_direction`.
 * - Seen: aktive Seeflächen (`topographie/see`, wie V12), die ein Fluss bis `JOIN_TOLERANCE` berührt.
 * - Für Läufe ohne Richtung der Abstand ihrer Enden zum Meer (Regel c).
 */

export interface RiverInputs extends RiverBurnInput {
    /** Über Flüsse, Seen und Küstenabstände. */
    fingerprint: string;
}

type Position = [number, number];

export async function loadRiverInputs(database: Queryable, mapDomainId: string): Promise<RiverInputs> {
    const rivers = await database<
        {
            id: string;
            public_id: string;
            name: string;
            is_bach: boolean;
            flow_direction: string | null;
            geometry: string;
            coast_start: number | null;
            coast_end: number | null;
        }[]
    >`
        SELECT p.id::text, p.public_id::text, p.name, p.is_bach, p.flow_direction, ST_AsGeoJSON(p.geom, 15) AS geometry,
               CASE WHEN p.flow_direction IS NULL THEN (
                   SELECT min(ST_Distance(a.geom, ST_StartPoint(p.geom))) FROM region_area a
                   JOIN region r ON r.id = a.region_id AND r.is_active AND r.region_type = 'meer'
                   WHERE a.map_domain_id = ${mapDomainId} AND a.is_active) END AS coast_start,
               CASE WHEN p.flow_direction IS NULL THEN (
                   SELECT min(ST_Distance(a.geom, ST_EndPoint(p.geom))) FROM region_area a
                   JOIN region r ON r.id = a.region_id AND r.is_active AND r.region_type = 'meer'
                   WHERE a.map_domain_id = ${mapDomainId} AND a.is_active) END AS coast_end
        FROM path p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND p.subtype = 'Flussweg'
        ORDER BY p.id
    `;
    const lakes = await database<{ id: string; name: string; geometry: string }[]>`
        SELECT a.public_id::text AS id, r.name, ST_AsGeoJSON(a.geom, 15) AS geometry
        FROM region_area a
        JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
          AND r.region_layer = 'topographie' AND r.region_type = 'see'
          AND EXISTS (
              SELECT 1 FROM path p
              WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND p.subtype = 'Flussweg'
                AND ST_DWithin(p.geom, a.geom, ${JOIN_TOLERANCE})
          )
        ORDER BY a.public_id
    `;
    const rows: RiverRow[] = rivers.map((row) => {
        const direction =
            row.flow_direction === "forward" || row.flow_direction === "reverse" ? row.flow_direction : null;
        return {
            id: row.id,
            publicId: row.public_id,
            name: row.name,
            bach: row.is_bach,
            direction,
            coordinates: (JSON.parse(row.geometry) as { coordinates: Position[] }).coordinates,
            coast:
                direction === null && row.coast_start !== null && row.coast_end !== null
                    ? [row.coast_start, row.coast_end]
                    : null,
        };
    });
    const riverLakes: RiverLake[] = lakes.map((lake) => ({
        id: lake.id,
        name: lake.name,
        geometry: JSON.parse(lake.geometry) as V12Geometry,
    }));
    return { rivers: rows, lakes: riverLakes, fingerprint: hashRiverInputs(rows, riverLakes) };
}

/** Über alles an Flüssen und Seen, was das Einbrennen liest: Lage, Richtung, Bach, Küstenabstand. */
export function hashRiverInputs(rivers: readonly RiverRow[], lakes: readonly RiverLake[]): string {
    const hash = createHash("sha256");
    for (const row of rivers) {
        hash.update(
            `|r:${row.id}:${String(row.bach)}:${row.direction ?? ""}:${row.coast ? row.coast.join(",") : ""}:${JSON.stringify(row.coordinates)}`,
        );
    }
    for (const lake of lakes) hash.update(`|s:${lake.id}:${JSON.stringify(lake.geometry)}`);
    return hash.digest("hex");
}

/**
 * Was in `terrain_raster.fingerprint` steht: die Rechnung des Gebirges (V12) und der Fingerabdruck seiner Gruppe
 * beim Einbrennen (`burn-groups.ts`, WI-0059).
 */
export function rasterFingerprint(mountainFingerprint: string, burnFingerprint: string): string {
    return createHash("sha256").update(`${mountainFingerprint}|${burnFingerprint}`).digest("hex");
}

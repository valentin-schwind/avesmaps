import { terrainTileKey } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Das Manifest einer Revision der Geländepyramide (JOBS-0001 V2, WI-0125): je Kachel (`z/x/y`) ihre Revision, der Inhalts-Hash ihrer
 * Bytes (`terrain_dem_tile.tile_revision`, Migration 0085). `undefined`, wenn eine Kachel keine Revision trägt; dann gilt die Vorlage
 * der Pyramidenrevision. Der Zeiger (`current.json`), die Bereichsereignisse und der Routing-Worker lesen es.
 */
export async function loadTerrainManifest(
    database: Queryable,
    revision: string,
    zoom?: number,
): Promise<Record<string, string> | undefined> {
    const rows = await database<{ z: number; x: number; y: number; tile_revision: string | null }[]>`
        SELECT z, x, y, tile_revision FROM terrain_dem_tile
        WHERE revision = ${revision} AND (${zoom ?? null}::int IS NULL OR z = ${zoom ?? null}::int)
        ORDER BY z, y, x
    `;
    if (rows.length === 0 || rows.some((row) => row.tile_revision === null)) return undefined;
    const tiles: Record<string, string> = {};
    for (const row of rows) tiles[terrainTileKey(row)] = row.tile_revision as string;
    return tiles;
}

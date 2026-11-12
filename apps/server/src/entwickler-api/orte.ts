import type { EntwicklerOrt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";

/**
 * Alle sichtbaren Orte für `GET /api/v1/orte` (WI-0303 P7): dieselbe Quelle wie die Wegfindung (`routing/waypoints.ts`, aktive Orte der
 * Domäne), ohne verborgene Orte (WI-0080), nach Namen sortiert und bei gleichem Namen nach Kennung, damit die Reihenfolge fest ist.
 */
export async function leseEntwicklerOrte(database: Database, mapDomainId = "aventuria"): Promise<EntwicklerOrt[]> {
    const zeilen = await database<{ id: string; name: string; art: string; x: number; y: number }[]>`
        SELECT public_id::text AS id, name, subtype AS art, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM place
        WHERE is_active AND map_domain_id = ${mapDomainId} AND NOT COALESCE(is_hidden, FALSE)
        ORDER BY name, public_id
    `;
    return zeilen.map((zeile) => ({ ...zeile, x: Number(zeile.x), y: Number(zeile.y) }));
}

import type { Queryable } from "../database.ts";
import { areasContainPoint, prepareWater, type Water } from "./water.ts";

/**
 * Liegt ein Kartenpunkt an Land? (WI-0030, Legacys `land-areas.php`, avesmaps@770c80e). Die Frage gilt
 * NUR dem angeklickten Punkt - nie einem Ort: Orte im Wasser erreicht man über ihre Wege (Owner Legacy).
 *
 * - **Land sind die Flächen `kontinent` und `insel`**, nach `region_type`, nie nach der Ebene: Die
 *   beiden liegen auf verschiedenen Ebenen (`derographisch`, `topographie`).
 * - **Wasser schlägt Land.** Jeder See liegt geometrisch in einem Kontinent.
 * - **Was keine Fläche nennt, ist kein Land** (`kueste`, `inselgruppe`, Lücken): Lieber „bitte einen
 *   Punkt an Land wählen“ als ein Marsch in eine ungezeichnete Leere.
 * - **Ohne Landdaten ist nichts Land** - die sichere Richtung.
 */

export const LAND_REGION_TYPES = ["kontinent", "insel"] as const;

export function pointIsOnLand(x: number, y: number, land: Water, water: Water): boolean {
    if (areasContainPoint(x, y, water)) return false;
    return areasContainPoint(x, y, land);
}

/** Die Landflächen der Kartendomäne, in derselben Form wie das Wasser. */
export async function loadLand(database: Queryable, mapDomainId: string): Promise<Water> {
    const rows = await database<{ geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]>`
        SELECT ST_AsGeoJSON(a.geom) AS geometry,
               ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y
        FROM region_area a
        JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.region_type IN ${database([...LAND_REGION_TYPES])}
        ORDER BY a.public_id
    `;
    return prepareWater(
        rows.map((row) => ({
            geometry: JSON.parse(row.geometry) as { type: string; coordinates?: unknown },
            minX: row.min_x,
            minY: row.min_y,
            maxX: row.max_x,
            maxY: row.max_y,
        })),
    );
}

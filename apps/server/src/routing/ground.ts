import type { Queryable } from "../database.ts";
import { areaEdges, areasNear, indexAreas, lineIntervals } from "./water.ts";

/**
 * Der Boden querfeldein (WI-0030 R8, Betreiber 2026-09-24: „Wald, Sumpf, Dschungel und Wüste bremsen“):
 * die Landschaftsflächen, auf denen der Gang langsamer vorankommt als auf offenem Boden, mit ihrem
 * Faktor aus dem Reisemodell (`bodenfaktor`). Legacy `offroad-data.php` (avesmaps@770c80e): Faktor =
 * offenes Gelände 0,75 / GA-Faktor der Landschaft; überlagerte Landschaften zählen per Maximum.
 *
 * Gespeichert als 32-Bit-Zahlen und auf 0,05 E vereinfacht - ein Fünftel einer Rasterzelle, und die
 * Wälder allein haben 85.000 Punkte; der Routing-Worker hat ein Speicherbudget.
 */

export interface GroundArea {
    /** Alle Kanten aller Ringe, je vier Zahlen: x1, y1, x2, y2. */
    edges: Float32Array;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    /** Wie viel langsamer als offener Boden, größer als 1. */
    factor: number;
    /**
     * Die Landschaftsart (`region_type`), aus der die Fläche kommt. Der Gang querfeldein braucht nur den Faktor;
     * das Eiltempo (WI-0078) braucht die Art, weil Sumpf, Dschungel, Urwald und Regenwald es ausschließen.
     */
    type: string;
}

export interface Ground {
    areas: GroundArea[];
    grid: Map<string, number[]>;
}

export const NO_GROUND: Ground = { areas: [], grid: new Map() };

/** Vereinfachung beim Laden, in Karteneinheiten. */
const SIMPLIFY = 0.05;

type AreaGeometry = Parameters<typeof areaEdges>[0];

/** Flächen mit ihrem Faktor und ein Gitter darüber; was nicht bremst oder keine Fläche ist, fällt weg. */
export function prepareGround(
    rows: {
        geometry: AreaGeometry;
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        factor: number;
        type?: string;
    }[],
): Ground {
    const areas: GroundArea[] = [];
    for (const row of rows) {
        if (!(row.factor > 1)) continue;
        const edges = areaEdges(row.geometry);
        if (edges.length === 0) continue;
        areas.push({
            edges: Float32Array.from(edges),
            minX: row.minX,
            minY: row.minY,
            maxX: row.maxX,
            maxY: row.maxY,
            factor: row.factor,
            type: row.type ?? "",
        });
    }
    return { areas, grid: indexAreas(areas) };
}

/**
 * Berührt diese Linie eine Landschaft einer der genannten Arten (WI-0078)? Dieselben Flächen, die den Gang
 * querfeldein bremsen - sie sind ohnehin geladen, und Sumpf, Dschungel, Urwald und Regenwald stehen alle darunter.
 *
 * `IMPLEMENTATION DETAIL`: Berührt genügt. Das Eiltempo wirkt abschnittsweise, und ein Abschnitt, der einen Sumpf
 * auch nur streift, eilt gar nicht - das ist die vorsichtige Seite der Regel „schlichtweg unmöglich“ (GA S. 123).
 */
export function lineTouchesGroundTypes(
    coordinates: readonly (readonly [number, number])[],
    ground: Ground,
    types: readonly string[],
): boolean {
    if (ground.areas.length === 0 || types.length === 0 || coordinates.length < 2) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of coordinates) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const line = coordinates as readonly [number, number][];
    for (const index of areasNear(ground.grid, minX, minY, maxX, maxY)) {
        const area = ground.areas[index] as GroundArea;
        if (!types.includes(area.type)) continue;
        if (area.minX > maxX || area.maxX < minX || area.minY > maxY || area.maxY < minY) continue;
        if (lineIntervals(line, area.edges).length > 0) return true;
    }
    return false;
}

/** Berührt die gerade Sehne bremsenden Boden? Dann geht unter „Schnellste“ die Suche um ihn herum. */
export function chordTouchesGround(x1: number, y1: number, x2: number, y2: number, ground: Ground): boolean {
    if (ground.areas.length === 0) return false;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (const index of areasNear(ground.grid, minX, minY, maxX, maxY)) {
        const area = ground.areas[index] as GroundArea;
        if (area.minX > maxX || area.maxX < minX || area.minY > maxY || area.maxY < minY) continue;
        if (
            lineIntervals(
                [
                    [x1, y1],
                    [x2, y2],
                ],
                area.edges,
            ).length > 0
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Die bremsenden Landschaftsflächen der Kartendomäne. Nur aktive; ungültige
 * Flächen (20 von 2.499 in Legacys Satz 147359) werden beim Lesen repariert, wie in WI-0035.
 */
export async function loadGround(
    database: Queryable,
    mapDomainId: string,
    factors: Readonly<Record<string, number>>,
): Promise<Ground> {
    const types = Object.keys(factors).filter((type) => (factors[type] ?? 1) > 1);
    if (types.length === 0) return NO_GROUND;
    const rows = await database<
        { region_type: string; geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]
    >`
        WITH flaeche AS (
            SELECT r.region_type,
                   ST_SimplifyPreserveTopology(
                       CASE WHEN ST_IsValid(a.geom) THEN a.geom ELSE ST_MakeValid(a.geom, 'method=structure') END,
                       ${SIMPLIFY}
                   ) AS geom
            FROM region_area a
            JOIN region r ON r.id = a.region_id AND r.is_active
            WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
              AND r.region_type IN ${database(types)}
            ORDER BY a.public_id
        )
        SELECT region_type, ST_AsGeoJSON(geom) AS geometry,
               ST_XMin(geom) AS min_x, ST_YMin(geom) AS min_y, ST_XMax(geom) AS max_x, ST_YMax(geom) AS max_y
        FROM flaeche
    `;
    return prepareGround(
        rows.map((row) => ({
            geometry: JSON.parse(row.geometry) as AreaGeometry,
            minX: row.min_x,
            minY: row.min_y,
            maxX: row.max_x,
            maxY: row.max_y,
            factor: factors[row.region_type] ?? 1,
            type: row.region_type,
        })),
    );
}

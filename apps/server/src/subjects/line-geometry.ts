import type { Queryable } from "../database.ts";

/**
 * Die Geometrie einer Gruppe von Linien (Wegabschnitte, Kraftliniensegmente) für Kontext und Sprungziel: alle Linien, ihr
 * Ausschnitt und die Mitte des LÄNGSTEN zusammenhängenden Stücks (wie die Suche: dort liegt die Straße, nicht in der Lücke zwischen
 * zwei Flussarmen).
 */

export interface LineGeometry {
    /** Die Linien als Punktfolgen in `aventuria-v1`. */
    lines: [number, number][][];
    bounds: [number, number, number, number];
    /** Die Mitte des längsten Stücks. */
    x: number;
    y: number;
}

/** Aus welcher Tabelle die Linien kommen: eine feste Wahl, nie eine Eingabe (der Name wird in den Text gesetzt). */
const TABLES = { path: "path", powerline: "powerline" } as const;

export async function lineGeometry(
    database: Queryable,
    table: keyof typeof TABLES,
    memberIds: readonly string[],
): Promise<LineGeometry | null> {
    const [row] = await database.unsafe<
        {
            geojson: string | null;
            min_x: number | null;
            min_y: number | null;
            max_x: number | null;
            max_y: number | null;
            x: number | null;
            y: number | null;
        }[]
    >(
        `WITH g AS (
             SELECT ST_Collect(t.geom) AS geom FROM ${TABLES[table]} t WHERE t.public_id = ANY($1::uuid[]) AND t.is_active
         ), merged AS (
             SELECT (ST_Dump(ST_LineMerge(g.geom))).geom AS piece FROM g
         ), longest AS (
             SELECT ST_LineInterpolatePoint(m.piece, 0.5) AS point FROM merged m ORDER BY ST_Length(m.piece) DESC LIMIT 1
         )
         SELECT ST_AsGeoJSON(g.geom, 6) AS geojson,
                ST_XMin(g.geom) AS min_x, ST_YMin(g.geom) AS min_y, ST_XMax(g.geom) AS max_x, ST_YMax(g.geom) AS max_y,
                (SELECT ST_X(point) FROM longest) AS x, (SELECT ST_Y(point) FROM longest) AS y
         FROM g`,
        [[...memberIds]],
    );
    if (
        !row ||
        row.geojson === null ||
        row.min_x === null ||
        row.min_y === null ||
        row.max_x === null ||
        row.max_y === null
    ) {
        return null;
    }
    const parsed = JSON.parse(row.geojson) as { type: string; coordinates: unknown };
    const lines = (parsed.type === "MultiLineString" ? parsed.coordinates : [parsed.coordinates]) as [
        number,
        number,
    ][][];
    return {
        lines,
        bounds: [row.min_x, row.min_y, row.max_x, row.max_y],
        x: row.x ?? (row.min_x + row.max_x) / 2,
        y: row.y ?? (row.min_y + row.max_y) / 2,
    };
}

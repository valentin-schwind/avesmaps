import type postgres from "postgres";
import type { Queryable } from "../../database.ts";
import type { ContourLine } from "./contours.ts";
import { lineJson } from "./line-json.ts";

/**
 * Die Fläche einer Höhenstufe aus den Ringen ihrer Schwelle, als Teilanfrage (WI-0055): innerhalb der Ringe nach
 * der Gerade-ungerade-Regel, ein Ring in einem Ring ist ein Loch.
 *
 * 🪤 `ST_UnaryUnion` vor `ST_BuildArea`: Der Polygonizer verlangt Linien, die sich nur an ihren Enden treffen. Ein
 * Ring, der sich nach Vereinfachung, Glättung und Rundung auf ein Zehntausendstel E selbst kreuzt (an engen Hälsen,
 * ein bis drei je Schwelle), machte ihn blind: Er ließ den Ring samt allem darin weg, und die ganze Fläche der
 * Stufe fiel auf die darunter durch (Schwelle 100: 20 000 statt 280 000 E², Finsterkamm ohne Ocker; Befund
 * Höhenstufen 2026-10-03). Das Verknoten zerlegt die Linien an jeder Kreuzung; die Flächen bleiben die der Ringe.
 */
export function bandAreaQuery(sql: Queryable, rings: readonly ContourLine[]): postgres.PendingQuery<postgres.Row[]> {
    return sql`(
        SELECT ST_CollectionExtract(
                   ST_MakeValid(ST_BuildArea(ST_UnaryUnion(ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(g), 0))))), 3
               )
        FROM unnest(${rings.map(lineJson)}::text[]) AS g
    )`;
}

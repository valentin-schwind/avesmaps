import type { Queryable } from "../database.ts";
import type { RouteLandscapesResponse } from "@avesmaps3d/shared";

/**
 * Aktuelle Gebietsformen aller Bänder, je Gebiet einmal und nach erstem Eintritt. Nur lesend.
 *
 * ⚡ Der Kasten je LINIENSTÜCK (`sh.geom && line.geom`, Qualitätsreview 2026-10-12, Claudios Hotspot §3 Nr. 2): Der Verbund prüft den
 * Kasten der Gebietsform nur gegen die GANZE Etappe. Eine Etappe mit vielen Stücken — ein Weg als Subject bringt alle Abschnitte
 * seiner Gruppe in EINE Etappe, „Reichsstraße 3“ sind 127 — schnitt danach jede getroffene Form gegen JEDES Stück, auch gegen die am
 * anderen Ende der Karte. Der Kasten ist notwendige Bedingung für einen Schnitt, die Zeilen bleiben also dieselben; gemessen lokal am
 * 2026-10-12 (Median aus 5, `avesmaps3d_dev`): Reichsstraße 3 140 → 95 ms, Reichsstraße 2 103 → 77 ms, Der Große Fluss 128 → 95 ms,
 * Seneb-Horas-Straße 27 → 22 ms, Ergebniszeilen in allen vier Fällen byteweise gleich.
 */
export async function routeTerritories(
    database: Queryable,
    wkts: readonly string[],
    mapDomainId: string,
): Promise<NonNullable<RouteLandscapesResponse["territories"]> | null> {
    const [state] = await database<{ ready: boolean }[]>`
        SELECT derived_revision IS NOT NULL AND derived_revision <> '' AND derived_year_bf IS NOT NULL AS ready
        FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    if (!state?.ready) return null;
    // Materialization bounds geometry parsing by stages and target lookup by encountered IDs.
    const rows = await database<
        {
            stage: number;
            id: string;
            name: string;
            x: number;
            y: number;
            band: number;
            type: string;
            parent_name: string | null;
            parent_id: string | null;
        }[]
    >`
        WITH stage AS MATERIALIZED (
            SELECT (t.n - 1)::int AS stage, ST_GeomFromText(t.wkt) AS geom
            FROM unnest(${[...wkts]}::text[]) WITH ORDINALITY AS t(wkt, n)
        ), encounters AS (
            SELECT s.stage, t.id AS territory_id, sh.depth,
                   line.path[1] AS part,
                   LEAST(ST_LineLocatePoint(line.geom, ST_StartPoint(piece.geom)),
                         ST_LineLocatePoint(line.geom, ST_EndPoint(piece.geom))) AS position
            FROM stage s
            JOIN territory_shape sh ON sh.geom && s.geom AND ST_Intersects(sh.geom, s.geom)
            JOIN territory t ON t.id = sh.territory_id AND t.is_active AND t.map_domain_id = ${mapDomainId}
            CROSS JOIN LATERAL ST_Dump(s.geom) line
            CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(ST_Intersection(line.geom, sh.geom), 2)) piece
            -- Der Kasten je Stück zuerst: siehe Kopf der Datei. Notwendige Bedingung, also dieselben Zeilen.
            WHERE sh.geom && line.geom AND ST_Length(piece.geom) > 0
        ), first_encounter AS (
            SELECT DISTINCT ON (stage, territory_id) stage, territory_id, depth, part, position
            FROM encounters ORDER BY stage, territory_id, part, position, depth
        ), metadata AS MATERIALIZED (
            SELECT t.id AS territory_id, t.public_id::text AS id, t.name,
                   ST_X(target.label_geom) AS x, ST_Y(target.label_geom) AS y,
                   target.band, COALESCE(t.territory_type, '') AS type,
                   p.name AS parent_name, p.public_id::text AS parent_id
            FROM (SELECT DISTINCT territory_id FROM first_encounter) ids
            JOIN territory t ON t.id = ids.territory_id
            CROSS JOIN LATERAL (
                SELECT sh.band, sh.label_geom, sh.parent_id FROM territory_shape sh
                WHERE sh.territory_id = ids.territory_id ORDER BY sh.band LIMIT 1
            ) target
            LEFT JOIN territory p ON p.id = target.parent_id
        )
        SELECT f.stage, m.id, m.name, m.x, m.y, m.band, m.type, m.parent_name, m.parent_id
        FROM first_encounter f
        JOIN metadata m ON m.territory_id = f.territory_id
        ORDER BY f.stage, f.part, f.position, f.depth, m.name, m.id
    `;
    const result: NonNullable<RouteLandscapesResponse["territories"]> = wkts.map(() => []);
    for (const row of rows)
        result[row.stage]?.push({
            id: row.id,
            name: row.name,
            parentId: row.parent_id,
            target: { x: Number(row.x), y: Number(row.y), band: row.band, type: row.type, parentName: row.parent_name },
        });
    return result;
}

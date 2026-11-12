import type { EditorLandscapeLayer, EditorPathTargets } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Andockziele, die nur ein Fluss oder Bach bekommt (Vali 2026-11-08: „dass beim Editieren von Flussverläufen in der Derographie
 * Flüsse an Seen, anderen Flächen und anderen Flüssen "andocken" können - sprich dass der normale Snap wie bei der Wegbearbeitung
 * erscheint“), für die Wegkurve (`readPathTargets`) und für „Neuer Fluss/Bach“ (`readTargetsInBox`):
 *
 * - `areaEdges`: die Kanten der aktiven Teilflächen in den Ebenen `layers` im Kasten, als Strecken; ihre Enden sind die Ecken. Dieselbe
 *   Auswahl wie die Kanten um eine Landschaft (`readEditorLandscapeTargets`); die Seeufer liegen in der Topographie.
 * - `riverEdges`: die Abschnitte anderer aktiver Flusswege zwischen zwei Stützpunkten im Kasten (ohne `ohne`, den bearbeiteten Weg).
 *   Ihre Stützpunkte stehen schon in `vertices`.
 *
 * Nur Lage, keine Verbindung: Was eingerastet ist, liegt genau dort; einen Verweis „mündet in“ speichert nichts. Ein Flussende auf der
 * Strecke eines anderen Flusses ist für die Wegfindung trotzdem ein Anschluss (`routing/topology.ts`, „Strecke anderer Wege“).
 */
export async function flussZiele(
    database: Queryable,
    kasten: readonly [number, number, number, number],
    layers: readonly EditorLandscapeLayer[],
    mapDomainId: string,
    ohne?: string,
): Promise<Required<Pick<EditorPathTargets, "areaEdges" | "riverEdges">>> {
    const [x0, y0, x1, y1] = kasten;
    const flaechen =
        layers.length === 0
            ? []
            : await database<{ area_id: string; name: string; ax: number; ay: number; bx: number; by: number }[]>`
        SELECT a.public_id::text AS area_id, o.name,
               ST_X(ST_StartPoint(s.geom)) AS ax, ST_Y(ST_StartPoint(s.geom)) AS ay,
               ST_X(ST_EndPoint(s.geom)) AS bx, ST_Y(ST_EndPoint(s.geom)) AS by
          FROM region_area a
          JOIN region o ON o.id = a.region_id AND o.is_active AND o.region_layer = ANY(${layers as unknown as string[]})
         CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(a.geom)) s
         WHERE a.is_active AND a.map_domain_id = ${mapDomainId}
           AND a.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
           AND s.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY a.public_id, s.path
    `;
    const fluesse = await database<
        { path_id: string; name: string; index: number; ax: number; ay: number; bx: number; by: number }[]
    >`
        SELECT w.public_id::text AS path_id, w.name, (s.path[1] - 1)::int AS index,
               ST_X(ST_StartPoint(s.geom)) AS ax, ST_Y(ST_StartPoint(s.geom)) AS ay,
               ST_X(ST_EndPoint(s.geom)) AS bx, ST_Y(ST_EndPoint(s.geom)) AS by
          FROM path w
         CROSS JOIN LATERAL ST_DumpSegments(w.geom) s
         WHERE w.is_active AND w.map_domain_id = ${mapDomainId} AND w.subtype = 'Flussweg'
           AND (${ohne ?? null}::uuid IS NULL OR w.public_id <> ${ohne ?? null}::uuid)
           AND w.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
           AND s.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY w.public_id, s.path
    `;
    return {
        areaEdges: flaechen.map((e) => ({ areaId: e.area_id, name: e.name, a: [e.ax, e.ay], b: [e.bx, e.by] })),
        riverEdges: fluesse.map((e) => ({
            pathId: e.path_id,
            name: e.name,
            index: e.index,
            a: [e.ax, e.ay],
            b: [e.bx, e.by],
        })),
    };
}

import type { Queryable } from "../database.ts";

/**
 * Die Schraffur umstrittener Gebiete ableiten (WI-0062 Nachtrag, Betreiber 2026-09-30; Legacy
 * `map-features-contested-hatch-overlay.js`, Konzept `docs/feature-umstrittene-gebiete.md`).
 *
 * Je Band, nach den Formen (`territory_shape`) und vor den Grenzen:
 *  1. `territory_claim_shape`: für jedes Gebiet mit mindestens einem aktiven Anspruch eines aktiven Anspruchstellers die
 *     Vereinigung der Flächen, die das Band zeigt (`territory_display_area`), und das Gebiet, unter dem sie erscheinen.
 *     Legacy schraffiert auf jeder Zoomstufe, auch wo das Gebiet in einem Vorfahren aufgeht (dessen `contested_pieces`).
 *  2. Legacy schneidet das umstrittene Gebiet aus der Füllung heraus („Option A“: Die Streifen liegen über dem Kartenbild,
 *     nicht über der Farbe des Reiches). Das tut hier die Ableitung, nicht die Kachel: `territory_shape.fill_render_geom`
 *     ist die Form ohne die schraffierten Flächen; besteht die Form ganz daraus (das umstrittene Gebiet zeigt sich selbst),
 *     ist `hatched` gesetzt, die Füllung entfällt, und die Fläche bleibt als Ziel des Klicks stehen.
 *
 * Grenzen, Namensanker und Hüllen bleiben an der ganzen Form: Die Schraffur ändert nur, was gefüllt wird.
 */

/** Unter dieser Fläche in Karteneinheiten² ist ein Rest kein Gebiet mehr, sondern eine Naht der Vereinigung. */
export const CLAIM_REMAINDER_EPSILON = 1e-4;

export async function deriveClaimShapes(
    tx: Queryable,
    mapDomainId: string,
    band: number,
    /** Teillauf (WI-0283): nur die Schraffur, die unter diesen Formen liegt; sonst alles. */
    formen: readonly number[] | null = null,
): Promise<void> {
    const liste = formen === null ? [] : [...formen];
    await tx`
        INSERT INTO territory_claim_shape (band, territory_id, display_territory_id, geom, render_geom)
        SELECT g.band, g.territory_id, g.display_id, g.geom,
               map_domain_to_render(${mapDomainId}, g.geom)::geometry(MultiPolygon, 3857)
        FROM (
            SELECT da.band, a.territory_id, min(da.territory_id) AS display_id,
                   ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(territory_area_valid(a.geom) ORDER BY a.id)), 3)) AS geom
            FROM territory_display_area da
            JOIN territory_area a ON a.id = da.area_id
            WHERE da.band = ${band}
              AND a.territory_id IN (
                  SELECT tc.territory_id
                  FROM territory_claim tc
                  JOIN territory owner ON owner.id = tc.territory_id AND owner.is_active
                  JOIN territory claimant ON claimant.id = tc.claimant_id AND claimant.is_active
                  WHERE tc.is_active AND owner.map_domain_id = ${mapDomainId}
              )
              ${
                  formen === null
                      ? tx``
                      : tx`AND a.territory_id IN (
                            SELECT a2.territory_id
                            FROM territory_display_area d2
                            JOIN territory_area a2 ON a2.id = d2.area_id
                            WHERE d2.band = ${band} AND d2.territory_id = ANY(${liste}::bigint[])
                        )`
              }
            GROUP BY da.band, a.territory_id
        ) g
        WHERE NOT ST_IsEmpty(g.geom)
    `;
    await tx`
        UPDATE territory_shape s
        SET hatched = q.hatched,
            fill_render_geom = CASE WHEN q.hatched THEN NULL
                                    ELSE map_domain_to_render(${mapDomainId}, q.rest)::geometry(MultiPolygon, 3857) END
        FROM (
            SELECT s2.territory_id, d.rest,
                   (ST_IsEmpty(d.rest) OR ST_Area(d.rest) < ${CLAIM_REMAINDER_EPSILON}) AS hatched
            FROM territory_shape s2
            JOIN (
                SELECT cs.display_territory_id AS territory_id, ST_UnaryUnion(ST_Collect(cs.geom ORDER BY cs.territory_id)) AS pieces
                FROM territory_claim_shape cs
                WHERE cs.band = ${band}
                GROUP BY cs.display_territory_id
            ) c ON c.territory_id = s2.territory_id
            CROSS JOIN LATERAL (
                SELECT ST_Multi(ST_CollectionExtract(ST_Difference(s2.geom, c.pieces), 3)) AS rest
            ) d
            WHERE s2.band = ${band} ${formen === null ? tx`` : tx`AND s2.territory_id = ANY(${liste}::bigint[])`}
        ) q
        WHERE s.band = ${band} AND s.territory_id = q.territory_id
    `;
}

import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../database.ts";

/**
 * Der Umfang eines Laufs der Glättung (WI-0077): nichts, die geänderten Flächen samt Nachbarn, oder das ganze Netz. Eine
 * Editoränderung rechnet so nur die Fläche und ihre Nachbarn neu (JOBS-0001, lokale Rechnung), mit demselben Ergebnis wie
 * der volle Lauf.
 */

/**
 * Wie weit ein Nachbar reicht (E): Was eine Fläche im Netz beeinflusst, liegt höchstens 0,001 E neben ihrem Rand (über Ketten
 * fast gleicher Punkte gemessen höchstens 0,002 E). Zehnmal so viel lässt Luft und kostet nur ein paar Nachbarn mehr.
 */
export const NEIGHBOUR_REACH = 0.01;

/** Bis zu so vielen geänderten Flächen rechnet die Ableitung nur sie und ihre Nachbarn, darüber das ganze Netz. */
export const LOCAL_SEED_LIMIT = 250;

export interface Plan {
    mode: "voll" | "lokal" | "keine";
    seeds: number[];
}

/** Die Flächen des Netzes in der Kartendomäne. */
export function membersSql(tx: Queryable, domain: string): PendingQuery<Row[]> {
    return tx`
        SELECT a.id
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = ${domain} AND a.is_active AND r.is_active
          AND region_area_is_smoothed(r.region_layer, r.region_type)
    `;
}

/** Was zu rechnen ist: nichts, die geänderten Flächen samt Nachbarn, oder das ganze Netz. */
export async function planRun(
    tx: Queryable,
    domain: string,
    options: { force?: boolean; areaIds?: readonly number[] },
): Promise<Plan> {
    if (options.areaIds) return { mode: "lokal", seeds: [...options.areaIds] };
    if (options.force === true) return { mode: "voll", seeds: [] };
    const stale = await tx<{ id: string; recipe: string | null }[]>`
        SELECT a.id::text, s.recipe
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        LEFT JOIN region_area_smooth s ON s.region_area_id = a.id
        WHERE a.map_domain_id = ${domain} AND a.is_active AND r.is_active
          AND region_area_is_smoothed(r.region_layer, r.region_type)
          AND (s.region_area_id IS NULL OR s.source_updated_at <> a.updated_at OR s.recipe <> region_area_smooth_recipe())
        UNION ALL
        SELECT s.region_area_id::text, s.recipe
        FROM region_area_smooth s
        JOIN region_area a ON a.id = s.region_area_id
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = ${domain}
          AND NOT (a.is_active AND r.is_active AND region_area_is_smoothed(r.region_layer, r.region_type))
    `;
    if (stale.length === 0) return { mode: "keine", seeds: [] };
    const [state] = await tx<{ rows: number; recipe: string }[]>`
        SELECT (SELECT count(*)::int FROM region_area_smooth s JOIN region_area a ON a.id = s.region_area_id
                WHERE a.map_domain_id = ${domain}) AS rows,
               region_area_smooth_recipe() AS recipe
    `;
    const otherRecipe = stale.some((row) => row.recipe !== null && row.recipe !== state?.recipe);
    if ((state?.rows ?? 0) === 0 || otherRecipe || stale.length > LOCAL_SEED_LIMIT) return { mode: "voll", seeds: [] };
    return { mode: "lokal", seeds: stale.map((row) => Number(row.id)) };
}

/**
 * Der Umfang eines Laufs als Tafel `ras2_scope (aid, writes)`: geschrieben werden die Saat und ihre Nachbarn (Rand höchstens
 * `NEIGHBOUR_REACH` neben dem Rand der Saat, nach der Quelle UND nach der bisherigen geglätteten Form, damit auch ein
 * früherer Nachbar seine gemeinsame Kante neu bekommt), mitgerechnet deren Nachbarn.
 */
export async function buildScope(tx: Queryable, domain: string, plan: Plan): Promise<void> {
    await tx`DROP TABLE IF EXISTS ras2_member, ras2_write, ras2_scope`;
    await tx`CREATE TEMP TABLE ras2_member ON COMMIT DROP AS ${membersSql(tx, domain)}`;
    await tx`ALTER TABLE ras2_member ADD PRIMARY KEY (id)`;
    if (plan.mode === "voll") {
        await tx`CREATE TEMP TABLE ras2_scope ON COMMIT DROP AS SELECT id AS aid, true AS writes FROM ras2_member`;
        return;
    }
    // 🪤 Nachbarn über Randstücke, nicht über ganze Ränder: `ST_DWithin` zweier Ränder, deren Rahmen sich überdecken, misst
    // jedes Stück gegen jedes (am Kontinent 444 s für eine Fläche, gemessen). Hier hat jede Seite ihre Stücke im Index.
    const reach = NEIGHBOUR_REACH;
    await tx`DROP TABLE IF EXISTS ras2_target, ras2_wseg`;
    await tx`
        CREATE TEMP TABLE ras2_target ON COMMIT DROP AS
        SELECT 'raw' AS kind, d.geom AS seg
        FROM region_area x CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(x.geom)) d
        WHERE x.id = ANY(${plan.seeds}::bigint[]) AND x.id IN (SELECT id FROM ras2_member)
        UNION ALL
        SELECT 'smooth', d.geom
        FROM region_area_smooth s CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(s.geom)) d
        WHERE s.region_area_id = ANY(${plan.seeds}::bigint[])
    `;
    await tx`CREATE INDEX ON ras2_target USING gist (seg)`;
    await tx`ANALYZE ras2_target`;
    // Erst die Flächen, deren Rahmen ein Randstück der Saat berührt (Index auf `region_area.geom`, je Randstück eine kleine
    // Frage: ein großer Rahmen wie der des Kontinents zieht so nicht die ganze Karte herein), dann deren Randstücke.
    await tx`
        CREATE TEMP TABLE ras2_write ON COMMIT DROP AS
        WITH raw_candidate AS MATERIALIZED (
            SELECT a.id, a.geom FROM region_area a
            WHERE a.id IN (
                SELECT n.id FROM ras2_target t JOIN region_area n ON n.geom && ST_Expand(t.seg, ${reach})
                WHERE t.kind = 'raw' AND n.id IN (SELECT id FROM ras2_member)
            )
        ), smooth_candidate AS MATERIALIZED (
            SELECT s.region_area_id AS id, s.geom FROM region_area_smooth s
            WHERE s.region_area_id IN (
                SELECT n.id FROM ras2_target t JOIN region_area n ON n.geom && ST_Expand(t.seg, ${reach})
                WHERE t.kind = 'smooth' AND n.id IN (SELECT id FROM ras2_member)
            )
        )
        SELECT id FROM ras2_member WHERE id = ANY(${plan.seeds}::bigint[])
        UNION
        SELECT c.id FROM raw_candidate c
        WHERE EXISTS (
            SELECT 1 FROM ST_DumpSegments(ST_Boundary(c.geom)) d
            JOIN ras2_target t ON t.kind = 'raw' AND t.seg && ST_Expand(d.geom, ${reach}) AND ST_DWithin(t.seg, d.geom, ${reach})
        )
        UNION
        SELECT c.id FROM smooth_candidate c
        WHERE EXISTS (
            SELECT 1 FROM ST_DumpSegments(ST_Boundary(c.geom)) d
            JOIN ras2_target t ON t.kind = 'smooth' AND t.seg && ST_Expand(d.geom, ${reach}) AND ST_DWithin(t.seg, d.geom, ${reach})
        )
    `;
    await tx`
        CREATE TEMP TABLE ras2_wseg ON COMMIT DROP AS
        SELECT d.geom AS seg FROM ras2_write w JOIN region_area x ON x.id = w.id
        CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(x.geom)) d
    `;
    await tx`CREATE INDEX ON ras2_wseg USING gist (seg)`;
    await tx`ANALYZE ras2_wseg`;
    await tx`
        CREATE TEMP TABLE ras2_scope ON COMMIT DROP AS
        WITH candidate AS MATERIALIZED (
            SELECT a.id, a.geom FROM region_area a
            WHERE a.id IN (
                SELECT n.id FROM ras2_wseg t JOIN region_area n ON n.geom && ST_Expand(t.seg, ${reach})
                WHERE n.id IN (SELECT id FROM ras2_member) AND n.id NOT IN (SELECT id FROM ras2_write)
            )
        )
        SELECT id AS aid, true AS writes FROM ras2_write
        UNION ALL
        SELECT c.id, false FROM candidate c
        WHERE EXISTS (
            SELECT 1 FROM ST_DumpSegments(ST_Boundary(c.geom)) d
            JOIN ras2_wseg t ON t.seg && ST_Expand(d.geom, ${reach}) AND ST_DWithin(t.seg, d.geom, ${reach})
        )
    `;
}

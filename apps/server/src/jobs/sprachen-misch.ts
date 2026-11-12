import type { Queryable } from "../database.ts";

/**
 * Die Mischgebiete der Sprachen (WI-0261 S5a, Migration 0257; E2: ein Mischgebiet ist, wo sich zwei Sprachen überlappen). Eine Phase des
 * Auftrags `sprache_treffer` (`sprachen-treffer-job.ts`), wenn sein Umfang Sprachen oder „alle“ nennt; ein Lauf nur über Objekte rechnet sie
 * nicht. Gerechnet als Jobs-Rolle (INSERT und DELETE an `sprache_misch`, `system-grants.psql`), ganz in PostGIS, in EINER Transaktion: Die
 * Kacheln sehen bis zum Ende die alten Paare, nie keine.
 *
 * - **Je Sprache** die aktiven Flächen der Domäne vereinigt (wie die Treffer): Zwei sich überlappende Teilflächen derselben Sprache sind kein
 *   Mischgebiet.
 * - **Je Paar** A < B (nach `sprache.id`) die Überlappung, nur Polygonteile, je Teil eine Zeile (der größte zuerst); Kleinstreste unter
 *   `KLEINSTREST_E2` fallen weg (die Tafel prüft es ebenfalls).
 * - **Der Umfang:** alles, oder die Paare, an denen eine der Sprachen beteiligt ist. Eine stillgelegte Sprache (oder eine ohne aktive Fläche)
 *   verliert so ihre Paare; die übrigen bleiben, wie sie waren.
 */

/** Teilflächen darunter (Karteneinheiten²) sind Rechenrauschen an gemeinsamen Kanten und Glättungssäumen, kein Mischgebiet. */
export const KLEINSTREST_E2 = 0.5;

/** Der Umfang des Laufs: alle Paare oder die mit einer dieser Sprachen (`sprache.id`). */
export interface MischUmfang {
    alle: boolean;
    sprachIds: readonly string[];
}

export interface MischBericht {
    geloescht: number;
    angelegt: number;
    ms: number;
}

/** Löscht die Paare des Umfangs. */
export async function loescheMisch(tx: Queryable, domain: string, umfang: MischUmfang): Promise<number> {
    const ergebnis = await tx`
        DELETE FROM sprache_misch
         WHERE map_domain_id = ${domain}
           AND (${umfang.alle}::boolean OR sprache_a_id = ANY(${umfang.sprachIds}::bigint[])
                OR sprache_b_id = ANY(${umfang.sprachIds}::bigint[]))
    `;
    return ergebnis.count;
}

/**
 * Löscht die Paare des Umfangs und bestimmt sie neu, in der Transaktion des Aufrufers. Die Sperre je Domäne nimmt der Aufrufer (dieselbe wie
 * die der Treffer).
 */
export async function rechneMisch(tx: Queryable, domain: string, umfang: MischUmfang): Promise<MischBericht> {
    const start = performance.now();
    await tx`SET LOCAL max_parallel_workers_per_gather = 0`;
    const geloescht = await loescheMisch(tx, domain, umfang);
    const ergebnis = await tx`
        WITH je AS MATERIALIZED (
            SELECT f.sprache_id, ST_CollectionExtract(ST_MakeValid(ST_Union(ST_MakeValid(f.geom))), 3) AS geom
              FROM sprache_flaeche f
              JOIN sprache s ON s.id = f.sprache_id
             WHERE f.map_domain_id = ${domain} AND f.is_active AND s.is_active
             GROUP BY f.sprache_id
        ),
        paar AS (
            SELECT a.sprache_id AS a_id, b.sprache_id AS b_id,
                   ST_CollectionExtract(ST_MakeValid(ST_Intersection(a.geom, b.geom)), 3) AS geom
              FROM je a
              JOIN je b ON a.sprache_id < b.sprache_id AND ST_Intersects(a.geom, b.geom)
             WHERE ${umfang.alle}::boolean OR a.sprache_id = ANY(${umfang.sprachIds}::bigint[])
                OR b.sprache_id = ANY(${umfang.sprachIds}::bigint[])
        ),
        teile AS (
            SELECT d.a_id, d.b_id, d.geom, ST_Area(d.geom) AS flaeche
              FROM (SELECT p.a_id, p.b_id, (ST_Dump(p.geom)).geom AS geom FROM paar p) d
             WHERE ST_Area(d.geom) >= ${KLEINSTREST_E2}
        )
        INSERT INTO sprache_misch (map_domain_id, sprache_a_id, sprache_b_id, teil, geom)
        SELECT ${domain}, t.a_id, t.b_id,
               row_number() OVER (PARTITION BY t.a_id, t.b_id ORDER BY t.flaeche DESC, ST_XMin(t.geom), ST_YMin(t.geom))::integer,
               t.geom
          FROM teile t
    `;
    return { geloescht, angelegt: ergebnis.count, ms: Math.round(performance.now() - start) };
}

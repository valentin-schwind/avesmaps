import type { Queryable } from "../database.ts";

/**
 * Durchläufe gleicher Zeilen über benachbarte Bänder (WI-0062 Nachtrag, Betreiber 2026-09-30).
 *
 * Jede Kachel trägt ALLE Bänder, die in ihrem Anzeigebereich vorkommen können (das Band der Ansicht folgt dem Kamerazoom,
 * nie dem Zoom der Kachel). Ohne Gegenmaßnahme wäre jede Kachel so groß wie die Summe aller Bänder. Ein Gebiet sieht in
 * benachbarten Bändern aber oft gleich aus (eine Baronie in den Bändern 4 bis 6, ein Reich in 0 und 1): gemessen 1.013
 * verschiedene Formen in 3.068 Zeilen, 217 verschiedene Außengrenzen in 674.
 *
 * Diese Ableitung schreibt je Zeile `run_from` und `run_to`, das erste und letzte Band des Durchlaufs gleicher Zeilen;
 * die `*_render`-Sichten liefern nur die erste Zeile eines Durchlaufs und tragen `band` (Beginn) und `band_to` (Ende). Die
 * Tabellen selbst behalten je Band eine Zeile: Zuordnung, Prüfer und Revision bleiben, wie sie waren.
 *
 * "Gleich" heißt: dieselbe Geometrie (Byte für Byte) und dieselben Attribute, die sich zwischen Bändern ändern können
 * (Elter, Tiefe, Namensanker, Füllung ohne Schraffur, Ebene, Name an der Grenze). Was am Gebiet selbst hängt (Name, Farbe),
 * ist in jedem Band gleich und steht nicht im Schlüssel.
 */

/** Der Schlüssel einer Form: ändert er sich zwischen zwei Bändern, beginnt ein neuer Durchlauf. */
export const SHAPE_RUN_KEY = `md5(
    ST_AsEWKB(s.geom) || ST_AsEWKB(s.label_geom) || COALESCE(ST_AsEWKB(s.fill_render_geom), ''::bytea)
    || convert_to(concat_ws('|', s.parent_id, s.depth, s.hatched, s.source_count), 'UTF8')
)`;
/** Der Schlüssel einer Grenzlinie (die Grenzart gehört zur Gruppe, nicht zum Schlüssel). */
export const BORDER_RUN_KEY = `md5(
    ST_AsEWKB(b.geom) || convert_to(concat_ws('|', b.level, COALESCE(b.label_name, '')), 'UTF8')
)`;

export async function deriveBandRuns(
    tx: Queryable,
    mapDomainId: string,
    /** Teillauf (WI-0283): nur die Durchläufe dieser Gebiete; sonst alle. */
    gebiete: readonly number[] | null = null,
): Promise<void> {
    // Eine Kommaliste statt eines Feldes: `unsafe` kennt den Typ eines Feldparameters nicht.
    const nurForm = gebiete === null ? "" : "AND s.territory_id = ANY(string_to_array($2, ',')::bigint[])";
    const nurGrenze = gebiete === null ? "" : "AND b.territory_id = ANY(string_to_array($2, ',')::bigint[])";
    const parameter = gebiete === null ? [mapDomainId] : [mapDomainId, gebiete.join(",")];
    await tx.unsafe(
        `
        UPDATE territory_shape s
        SET run_from = r.run_from, run_to = r.run_to
        FROM (
            SELECT g.band, g.territory_id,
                   min(g.band) OVER w AS run_from, max(g.band) OVER w AS run_to
            FROM (
                SELECT k.band, k.territory_id, k.key,
                       k.band - row_number() OVER (PARTITION BY k.territory_id, k.key ORDER BY k.band) AS island
                FROM (
                    SELECT s.band, s.territory_id, ${SHAPE_RUN_KEY} AS key
                    FROM territory_shape s
                    JOIN territory t ON t.id = s.territory_id
                    WHERE t.map_domain_id = $1 ${nurForm}
                ) k
            ) g
            WINDOW w AS (PARTITION BY g.territory_id, g.key, g.island)
        ) r
        WHERE s.band = r.band AND s.territory_id = r.territory_id
        `,
        parameter,
    );
    await tx.unsafe(
        `
        UPDATE territory_border b
        SET run_from = r.run_from, run_to = r.run_to
        FROM (
            SELECT g.band, g.kind, g.territory_id,
                   min(g.band) OVER w AS run_from, max(g.band) OVER w AS run_to
            FROM (
                SELECT k.band, k.kind, k.territory_id, k.key,
                       k.band - row_number() OVER (PARTITION BY k.territory_id, k.kind, k.key ORDER BY k.band) AS island
                FROM (
                    SELECT b.band, b.kind, b.territory_id, ${BORDER_RUN_KEY} AS key
                    FROM territory_border b
                    JOIN territory t ON t.id = b.territory_id
                    WHERE t.map_domain_id = $1 ${nurGrenze}
                ) k
            ) g
            WINDOW w AS (PARTITION BY g.territory_id, g.kind, g.key, g.island)
        ) r
        WHERE b.band = r.band AND b.kind = r.kind AND b.territory_id = r.territory_id
        `,
        parameter,
    );
}

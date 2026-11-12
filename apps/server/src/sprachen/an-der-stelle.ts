import type { SubjectSprache } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Sprachen an Stellen, die kein Objekt mit Treffern sind (WI-0261; Betreiber 2026-10-31: „sprachen soll immer zwischen "Regionen" und
 * "Derographie" bzw. über "Waren, Fauna, ..." in der tabelle gelistet werden. sprachen sollen verlinkbar sein.“): der Kartenpunkt und die Etappe einer
 * Route. Ort, Weg, Region und Gebiet lesen den Zwischenspeicher `sprache_treffer` (`treffer.ts`); eine freie Stelle und eine Etappe hat er nicht, sie
 * werden hier an den Flächen gemessen, wie die Landschaften und Gebiete daneben.
 *
 * - **Nur aktive Flächen aktiver Sprachen** der Domäne, wie die Treffer.
 * - **Am Punkt zählt jede Fläche**, die ihn enthält (Anteil 1, wie an einem Ort). **An der Etappe** ist der Anteil die Länge in den Flächen der Sprache
 *   durch die Länge der Etappe, wie an einem Weg; die Schwelle (`mindestanteil`) wirkt wie dort.
 * - Ordnung: der größte Anteil zuerst, dann die Reihenfolge der Legende.
 *
 * 🔴 LIEST NUR, und ohne eigene Transaktion: Beide Leser laufen in der Zeitgrenze ihres Aufrufers.
 */

interface SpracheZeile {
    id: string;
    name: string;
    farbe: string;
    anteil: number;
}

const alsSprache = (zeile: SpracheZeile): SubjectSprache => ({
    ref: { kind: "sprache", id: zeile.id },
    name: zeile.name,
    farbe: zeile.farbe,
    anteil: Math.min(1, Math.max(0, Number(zeile.anteil))),
});

/** Die Sprachen, deren aktive Flächen den Punkt enthalten. */
export async function sprachenAmPunkt(
    db: Queryable,
    mapDomainId: string,
    punkt: { x: number; y: number },
): Promise<SubjectSprache[]> {
    const zeilen = await db<SpracheZeile[]>`
        WITH p AS (SELECT ST_MakePoint(${punkt.x}, ${punkt.y}) AS geom)
        SELECT s.public_id::text AS id, s.name, s.farbe, 1::double precision AS anteil
          FROM sprache s, p
         WHERE s.is_active
           AND EXISTS (
               SELECT 1 FROM sprache_flaeche f
                WHERE f.sprache_id = s.id AND f.is_active AND f.map_domain_id = ${mapDomainId}
                  AND f.geom && p.geom AND ST_Intersects(f.geom, p.geom)
           )
         ORDER BY s.reihenfolge, lower(s.name), s.id
    `;
    return zeilen.map(alsSprache);
}

/** Je Etappe (als WKT, wie `route-landscapes.ts` sie baut) die Sprachen ab dem Mindestanteil. */
export async function sprachenDerEtappen(
    db: Queryable,
    wkts: readonly string[],
    mapDomainId: string,
    mindestanteil: number,
): Promise<SubjectSprache[][]> {
    const ergebnis: SubjectSprache[][] = wkts.map(() => []);
    if (wkts.length === 0) return ergebnis;
    const zeilen = await db<(SpracheZeile & { etappe: number })[]>`
        WITH etappe AS MATERIALIZED (
            SELECT (t.n - 1)::int AS etappe, g.geom, ST_Length(g.geom) AS laenge
              FROM unnest(${[...wkts]}::text[]) WITH ORDINALITY AS t(wkt, n)
             CROSS JOIN LATERAL (SELECT ST_GeomFromText(t.wkt) AS geom) g
        )
        SELECT e.etappe, s.public_id::text AS id, s.name, s.farbe,
               LEAST(1, sum(ST_Length(ST_Intersection(e.geom, f.geom))) / e.laenge)::double precision AS anteil
          FROM etappe e
          JOIN sprache_flaeche f
            ON f.map_domain_id = ${mapDomainId} AND f.is_active AND f.geom && e.geom AND ST_Intersects(f.geom, e.geom)
          JOIN sprache s ON s.id = f.sprache_id AND s.is_active
         WHERE e.laenge > 0
         GROUP BY e.etappe, e.laenge, s.id
         ORDER BY e.etappe, anteil DESC, s.reihenfolge, lower(s.name), s.id
    `;
    for (const zeile of zeilen) {
        if (Number(zeile.anteil) <= 0 || Number(zeile.anteil) < mindestanteil) continue;
        ergebnis[zeile.etappe]?.push(alsSprache(zeile));
    }
    return ergebnis;
}

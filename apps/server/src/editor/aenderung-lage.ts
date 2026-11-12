import type { MapChangeLage } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Wo die Gegenstände einer Änderung HEUTE liegen (`GET /api/editor/changes/:operationId/lage`, WI-0265 B9; Vali 2026-11-01: „kannst du bei den änderungensitems immer (wenn möglich)
 * 'Auf Karte anzeigen' machen, sodass die Ansicht hinfliegt, wo die Änderung war? sonst muss man ewig suchen“).
 *
 * Das Fachprotokoll führt Geometrie nur dort, wo sich die Lage selbst änderte (`geometry`, `position`, das Netz des Gebirges). Ein Feld („Ungefähre Lage“), eine Quelle, ein Wiki-Lauf mit
 * fünftausend Kurzbeschreibungen trägt keine; dann liest diese Stelle, wo die betroffenen Gegenstände jetzt liegen, und gibt EINEN Kasten zurück, in Kartenkoordinaten (`aventuria-v1`, die
 * Spalten `geom` selbst: SRID 0, ohne Umrechnung).
 *
 * - **Eine Anweisung für alles.** Die Gegenstände der Operation (`map_audit_event`, ein Mal gelesen) fließen in EINE Abfrage, die je Art ihre Tafel anschließt und mit `ST_Extent` bündelt. Kein
 *   Schleifenlauf je Gegenstand, kein Mitschleppen von Kennungen zum Client: Auch eine Operation mit 5.069 Orten ist ein Kasten und ein paar Indexzugriffe.
 * - **Dieselbe Rangfolge wie der Leser der Einträge** (`history.ts`, `baueEintraege`): Eine Teilfläche trägt auch ihre Fläche (`region_public_id`), eine Gebietsfläche ihr Gebiet, eine Sprachfläche ihre Sprache.
 *   Der Gegenstand ist der speziellere; sonst zeigte „Teilfläche verschoben“ die ganze Landschaft.
 * - **Art → Tafel:** Ort `place.geom` · Weg `path.geom` · Kraftlinie `powerline.drawn_geom` (die gezeichnete Bahn) · Kraftlinienpunkt `nodix.geom` · Landschaft alle Teilflächen · Teilfläche `region_area.geom` ·
 *   Beschriftung `map_label.geom` · Gebiet alle Gebietsflächen · Gebietsfläche · Gipfel `terrain_peak.geom` · Sprache alle Sprachflächen · Sprachfläche · Sprachartikel die Flächen seiner Sprache.
 * - **Inhalte haben keinen eigenen Ort, ihre Träger schon:** ein Werk die Orte seiner Ortsbezüge (`adventure_place`), ein Vorkommen die Ziele seiner Ortszeilen (`lore_place_target`), eine Quelle die
 *   Träger, die sie nennen (`place_source`, `path_source`, `territory_source`, `region_source`, `terrain_peak_source`), ein Korpus die Träger aller seiner Quellen. Die Quellen an einem Träger stehen
 *   im Protokoll an dessen eigenem Gegenstand (Ort, Weg, Gebiet, Landschaft) und brauchen nichts Eigenes.
 * - **Stillgelegtes zählt mit seiner letzten Lage.** Hat ein Gegenstand aktive Zeilen, gilt der Kasten um diese; hat er keine, der um alle (eine stillgelegte Fläche, ein gelöschter Ort behält seine
 *   Geometrie), und er zählt in `stillgelegt`. Die Oberfläche sagt dann „nicht mehr auf der Karte“. Ein Ort, der von der Karte genommen wurde (`place_unplaced`), hat keine Lage mehr und fehlt.
 * - **Was nicht gefunden wird, zählt nicht.** Ein Gegenstand ohne Zeile in seiner Tafel, ein Werk ohne Orte: kein Beitrag. Hat keiner eine Lage, ist `grenzen` `null` (kein Fehler).
 */

/** Wie viele Operationen höchstens zusammen gefragt werden (eine Arbeitsserie): wie die Länge von `mit` im Vertrag. */
export const LAGE_OPERATIONEN_MAX = 101;

interface Zeile {
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
    n: number;
    still: number;
}

/**
 * Die Lage der Operation `operationId` und, falls genannt, der Operationen `mit` zusammen; `undefined`, wenn es `operationId` in dieser Domäne nicht gibt.
 * Mitglieder, die es nicht gibt oder die in einer anderen Domäne liegen, tragen nichts bei.
 */
export async function aenderungLage(
    database: Queryable,
    operationId: string,
    optionen: { mapDomainId: string; mit?: readonly string[] },
): Promise<MapChangeLage | undefined> {
    const ids = [...new Set([operationId, ...(optionen.mit ?? [])])].slice(0, LAGE_OPERATIONEN_MAX);
    const [vorhanden, zeilen] = await Promise.all([
        database<{ ok: boolean }[]>`
            SELECT TRUE AS ok FROM map_operation WHERE operation_id = ${operationId}::uuid AND map_domain_id = ${optionen.mapDomainId}
        `,
        database<Zeile[]>`
            WITH operationen AS (
                SELECT operation_id FROM map_operation
                 WHERE operation_id = ANY(${ids}::uuid[]) AND map_domain_id = ${optionen.mapDomainId}
            ),
            -- Die Gegenstände, je Art und Kennung einmal. Die Rangfolge der Arten ist die des Lesers der Einträge (baueEintraege).
            ev AS MATERIALIZED (
                SELECT DISTINCT
                       CASE WHEN e.place_public_id IS NOT NULL THEN 'place'
                            WHEN e.powerline_public_id IS NOT NULL THEN 'powerline'
                            WHEN e.nodix_public_id IS NOT NULL THEN 'nodix'
                            WHEN e.region_area_public_id IS NOT NULL THEN 'area'
                            WHEN e.map_label_public_id IS NOT NULL THEN 'label'
                            WHEN e.region_public_id IS NOT NULL THEN 'landscape'
                            WHEN e.territory_area_public_id IS NOT NULL THEN 'territory_area'
                            WHEN e.territory_public_id IS NOT NULL THEN 'territory'
                            WHEN e.peak_public_id IS NOT NULL THEN 'peak'
                            WHEN e.source_public_id IS NOT NULL THEN 'source'
                            WHEN e.work_public_id IS NOT NULL THEN 'work'
                            WHEN e.lore_public_id IS NOT NULL THEN 'lore'
                            WHEN e.corpus_public_id IS NOT NULL THEN 'corpus'
                            WHEN e.sprache_artikel_public_id IS NOT NULL THEN 'sprache_artikel'
                            WHEN e.landmarke_artikel_public_id IS NOT NULL THEN 'landmarke_artikel'
                            WHEN e.region_artikel_public_id IS NOT NULL THEN 'region_artikel'
                            WHEN e.ort_artikel_public_id IS NOT NULL THEN 'ort_artikel'
                            WHEN e.sprache_flaeche_public_id IS NOT NULL THEN 'sprache_flaeche'
                            WHEN e.sprache_public_id IS NOT NULL THEN 'sprache'
                            ELSE 'path' END AS art,
                       COALESCE(e.place_public_id, e.powerline_public_id, e.nodix_public_id, e.region_area_public_id, e.map_label_public_id,
                                e.region_public_id, e.territory_area_public_id, e.territory_public_id, e.peak_public_id, e.source_public_id,
                                e.work_public_id, e.lore_public_id, e.corpus_public_id, e.sprache_artikel_public_id,
                                e.landmarke_artikel_public_id, e.region_artikel_public_id, e.ort_artikel_public_id, e.sprache_flaeche_public_id, e.sprache_public_id, e.path_public_id) AS ziel
                  FROM map_audit_event e
                 WHERE e.operation_id IN (SELECT operation_id FROM operationen)
            ),
            -- Gegenstände mit eigener Lage: je Zeile eine Geometrie und ob sie noch gilt.
            direkt AS (
                SELECT ev.art, ev.ziel, p.geom, p.is_active AS aktiv FROM ev JOIN place p ON p.public_id = ev.ziel WHERE ev.art = 'place'
                UNION ALL
                SELECT ev.art, ev.ziel, w.geom, w.is_active FROM ev JOIN path w ON w.public_id = ev.ziel WHERE ev.art = 'path'
                UNION ALL
                SELECT ev.art, ev.ziel, k.drawn_geom, k.is_active FROM ev JOIN powerline k ON k.public_id = ev.ziel WHERE ev.art = 'powerline'
                UNION ALL
                SELECT ev.art, ev.ziel, n.geom, n.is_active FROM ev JOIN nodix n ON n.public_id = ev.ziel WHERE ev.art = 'nodix'
                UNION ALL
                SELECT ev.art, ev.ziel, a.geom, a.is_active FROM ev JOIN region_area a ON a.public_id = ev.ziel WHERE ev.art = 'area'
                UNION ALL
                SELECT ev.art, ev.ziel, l.geom, l.is_active FROM ev JOIN map_label l ON l.public_id = ev.ziel WHERE ev.art = 'label'
                UNION ALL
                SELECT ev.art, ev.ziel, a.geom, a.is_active AND r.is_active
                  FROM ev JOIN region r ON r.public_id = ev.ziel JOIN region_area a ON a.region_id = r.id WHERE ev.art = 'landscape'
                UNION ALL
                SELECT ev.art, ev.ziel, f.geom, f.is_active FROM ev JOIN territory_area f ON f.public_id = ev.ziel WHERE ev.art = 'territory_area'
                UNION ALL
                SELECT ev.art, ev.ziel, f.geom, f.is_active AND g.is_active
                  FROM ev JOIN territory g ON g.public_id = ev.ziel JOIN territory_area f ON f.territory_id = g.id WHERE ev.art = 'territory'
                UNION ALL
                SELECT ev.art, ev.ziel, k.geom, k.is_active FROM ev JOIN terrain_peak k ON k.public_id = ev.ziel WHERE ev.art = 'peak'
                UNION ALL
                SELECT ev.art, ev.ziel, f.geom, f.is_active FROM ev JOIN sprache_flaeche f ON f.public_id = ev.ziel WHERE ev.art = 'sprache_flaeche'
                UNION ALL
                SELECT ev.art, ev.ziel, f.geom, f.is_active AND s.is_active
                  FROM ev JOIN sprache s ON s.public_id = ev.ziel JOIN sprache_flaeche f ON f.sprache_id = s.id WHERE ev.art = 'sprache'
                UNION ALL
                -- Ein Sprachartikel liegt dort, wo seine Sprache liegt (die geordneten Pillen des Spracheditors, sprache_wiki).
                SELECT ev.art, ev.ziel, f.geom, w.is_active AND f.is_active AND s.is_active
                  FROM ev
                  JOIN wiki_sprache_artikel sa ON sa.public_id = ev.ziel
                  JOIN sprache_wiki w ON w.wiki_sprache_artikel_id = sa.id
                  JOIN sprache s ON s.id = w.sprache_id
                  JOIN sprache_flaeche f ON f.sprache_id = s.id
                 WHERE ev.art = 'sprache_artikel'
            ),
            -- Inhalte: die Quellen, deren Träger gefragt sind (eine Quelle selbst, alle Quellen eines Korpus).
            quellen AS (
                SELECT ev.art, ev.ziel, fs.id AS source_id FROM ev JOIN feature_source fs ON fs.public_id = ev.ziel WHERE ev.art = 'source'
                UNION ALL
                SELECT ev.art, ev.ziel, fs.id FROM ev JOIN source_corpus sc ON sc.public_id = ev.ziel
                  JOIN feature_source fs ON fs.corpus_key = sc.corpus_key WHERE ev.art = 'corpus'
            ),
            -- Die Träger der Inhalte in EINER Form: je Zeile höchstens EIN Ziel unter den fünf Arten von Kartengegenständen.
            bezuege AS (
                SELECT ev.art, ev.ziel, ap.place_id, ap.path_id, ap.territory_id, ap.region_id, ap.terrain_peak_id AS peak_id, ap.is_active AS aktiv
                  FROM ev JOIN adventure ad ON ad.public_id = ev.ziel JOIN adventure_place ap ON ap.adventure_id = ad.id WHERE ev.art = 'work'
                UNION ALL
                SELECT ev.art, ev.ziel, t.place_id, NULL::bigint, t.territory_id, t.region_id, t.terrain_peak_id, z.is_active
                  FROM ev JOIN lore_entry le ON le.public_id = ev.ziel
                  JOIN lore_place z ON z.lore_entry_id = le.id
                  JOIN lore_place_target t ON t.lore_place_id = z.id WHERE ev.art = 'lore'
                UNION ALL
                SELECT q.art, q.ziel, s.place_id, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, s.is_active
                  FROM quellen q JOIN place_source s ON s.source_id = q.source_id
                UNION ALL
                SELECT q.art, q.ziel, NULL::bigint, s.path_id, NULL::bigint, NULL::bigint, NULL::bigint, s.is_active
                  FROM quellen q JOIN path_source s ON s.source_id = q.source_id
                UNION ALL
                SELECT q.art, q.ziel, NULL::bigint, NULL::bigint, s.territory_id, NULL::bigint, NULL::bigint, s.is_active
                  FROM quellen q JOIN territory_source s ON s.source_id = q.source_id
                UNION ALL
                SELECT q.art, q.ziel, NULL::bigint, NULL::bigint, NULL::bigint, s.region_id, NULL::bigint, s.is_active
                  FROM quellen q JOIN region_source s ON s.source_id = q.source_id
                UNION ALL
                SELECT q.art, q.ziel, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, s.terrain_peak_id, s.is_active
                  FROM quellen q JOIN terrain_peak_source s ON s.source_id = q.source_id
            ),
            indirekt AS (
                SELECT b.art, b.ziel, g.geom, b.aktiv AND g.aktiv AS aktiv
                  FROM bezuege b
                 CROSS JOIN LATERAL (
                     SELECT p.geom, p.is_active AS aktiv FROM place p WHERE p.id = b.place_id
                     UNION ALL
                     SELECT w.geom, w.is_active FROM path w WHERE w.id = b.path_id
                     UNION ALL
                     SELECT f.geom, f.is_active AND g2.is_active FROM territory g2 JOIN territory_area f ON f.territory_id = g2.id WHERE g2.id = b.territory_id
                     UNION ALL
                     SELECT a.geom, a.is_active AND r.is_active FROM region r JOIN region_area a ON a.region_id = r.id WHERE r.id = b.region_id
                     UNION ALL
                     SELECT k.geom, k.is_active FROM terrain_peak k WHERE k.id = b.peak_id
                 ) g
            ),
            -- Je Gegenstand EIN Kasten: um die gültigen Zeilen, sonst um alle.
            je_gegenstand AS (
                SELECT art, ziel,
                       COALESCE(ST_Extent(geom) FILTER (WHERE aktiv), ST_Extent(geom)) AS kasten,
                       bool_or(aktiv) AS aktiv
                  FROM (SELECT * FROM direkt UNION ALL SELECT * FROM indirekt) alle
                 GROUP BY art, ziel
            ),
            gesamt AS (
                SELECT ST_Extent(kasten::geometry) AS kasten, count(*)::int AS n, (count(*) FILTER (WHERE NOT aktiv))::int AS still
                  FROM je_gegenstand
            )
            SELECT ST_XMin(kasten) AS x0, ST_YMin(kasten) AS y0, ST_XMax(kasten) AS x1, ST_YMax(kasten) AS y1, n, still FROM gesamt
        `,
    ]);
    if (vorhanden.length === 0) return undefined;
    const z = zeilen[0];
    if (z === undefined || z.n === 0 || z.x0 === null || z.y0 === null || z.x1 === null || z.y1 === null)
        return { grenzen: null, gegenstaende: 0, stillgelegt: 0 };
    return { grenzen: [z.x0, z.y0, z.x1, z.y1], gegenstaende: z.n, stillgelegt: z.still };
}

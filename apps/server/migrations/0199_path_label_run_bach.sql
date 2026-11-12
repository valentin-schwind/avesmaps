-- 0199 Bachnamen tragen ihr Merkmal (WI-0177; Befund der Kartenverwaltung, WI-0221 §10)
--
-- Der Schriftlauf eines Wegnamens (`path_label_run`, 0023) kannte `is_bach` nicht, die Sicht `path_label_run_render` (zuletzt 0174)
-- und die Kachel (`path_label_run_tile`, zuletzt 0174) auch nicht. Darum griff `["get", "is_bach"]` in der Namensebene
-- (`buildPathLabelLayer`, apps/web/src/map/path-layers.ts) nie: Bachnamen standen in der Größe der Flussnamen und erschienen auch unter
-- Band 4, wo die Bachlinie seit OPS-000036 fehlt. Das ist ein Fehler, keine Gestaltungsfrage.
--
--   1. `path_label_run.is_bach`: ob der Lauf auf einem Bachabschnitt liegt. Die Ableitung (`derive/path-runs.ts`, Algorithmus 6)
--      setzt es je LAUF, nicht je Name: 21 Flussketten mischen Bach- und Flussabschnitte (etwa Ingval, 1 zu 18), und ein Lauf auf dem
--      Flussteil ist ein Flussname. Maßgeblich ist die Mitte des Laufs.
--   2. Sicht und Kachel liefern die Spalte am Ende aus.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte ohne Vorgabe (NULL bis zur nächsten Ableitung, die Namensebene liest NULL wie
-- „kein Bach“, also wie bisher), die Sicht mit einer Spalte mehr am Ende, die Kachelfunktion mit derselben Signatur und einer
-- Eigenschaft mehr. Das vorige Release liest und schreibt die Spalte nie. Die Rechte bleiben: Die Jobs-Rolle schreibt Zeilen der
-- Tafel (`map-grants.psql`, tabellenweit), die App-Rolle liest. 🔴 Nach dem Einspielen leitet `derive:path-runs` (I7) die Läufe neu ab,
-- erst dann tragen sie das Merkmal. Martin braucht dafür keinen Neustart: Die Wegnamen kommen aus der Funktionsquelle, nicht aus dem
-- Katalog der Sichten (wie bei 0174).

ALTER TABLE path_label_run ADD COLUMN IF NOT EXISTS is_bach BOOLEAN;

COMMENT ON COLUMN path_label_run.is_bach IS
    'Liegt der Lauf (seine Mitte) auf einem Bachabschnitt? Gesetzt von derive:path-runs ab Algorithmus 6 (WI-0177, Migration 0199); NULL bis zur nächsten Ableitung. Die Namensebene setzt Bachnamen kleiner und zeigt sie nur, wo die Bachlinie steht.';

CREATE OR REPLACE VIEW path_label_run_render AS
SELECT
    r.name,
    r.subtype,
    r.part,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(r.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    k.mark,
    r.is_bach
FROM path_label_run r
LEFT JOIN LATERAL (
    SELECT p.mark
      FROM path p
     WHERE p.map_domain_id = r.map_domain_id AND p.name = r.name AND p.subtype = r.subtype
       AND p.mark IS NOT NULL AND p.is_active
     LIMIT 1
) k ON TRUE
ORDER BY r.name, r.subtype, r.part, r.instance;

COMMENT ON VIEW path_label_run_render IS
    'Wegnamen-Schriftlaeufe im Darstellungsraum (0025). 0174: mark am Ende, das Kennzeichen eines Abschnitts derselben Kette (Name und Wegtyp), fuer die Namensfarbe der Karawanenroute. 0199: is_bach am Ende, fuer Groesse und Spanne der Bachnamen.';

CREATE OR REPLACE FUNCTION path_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    SELECT ST_AsMVT(
               source,
               'path_label_run'
               ORDER BY source.name, source.subtype, source.part, source.instance, source.candidate
           )
    INTO tile
    FROM (
        SELECT
            run.name,
            run.subtype,
            run.part,
            run.instance,
            run.instance_count,
            run.collision_rank,
            kandidat.ordnung AS candidate,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom,
            run.mark,
            run.is_bach
        FROM path_label_run_render run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd.
        CROSS JOIN LATERAL (
            VALUES (0, 0.0), (1, 0.125), (2, -0.125), (3, 0.25), (4, -0.25)
        ) AS kandidat(ordnung, versatz)
        CROSS JOIN LATERAL (
            SELECT 0.5 + kandidat.versatz * need.target / need.laenge AS mitte,
                   (need.target / 2.0) / need.laenge AS halb
        ) lage
        CROSS JOIN LATERAL (
            SELECT GREATEST(0.0, lage.mitte - lage.halb) AS lo,
                   LEAST(1.0, lage.mitte + lage.halb) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND (
                kandidat.ordnung = 0
                OR (lage.mitte - lage.halb >= 0.0 AND lage.mitte + lage.halb <= 1.0)
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$;

-- Die Landschaftsart erreicht die Beschriftungskacheln (WI-0014, Finding MCS-015).
--
-- 💣 DIESE MIGRATION EXISTIERT WEGEN EINES BILDES, NICHT WEGEN EINES TESTS. Der Stil liest seit
-- WI-0014 je Landschaftsart einen eigenen Namenston und setzt fünf Arten in Versalien. Beides hing
-- an `["get", "region_type"]` - und genau diese Eigenschaft lag in `region_area_render` (den
-- FLÄCHEN), nicht in `map_label_render` und `landscape_label_run_render` (den NAMEN). Der Ausdruck
-- war gültig, seine Auswertung fiel still auf den Auffangwert, und die Karte zeigte alle Namen in
-- derselben Farbe und ohne Versalien. Aufgefallen ist es erst im Sichtvergleich gegen Legacy:
-- „Darpatien" stand dort in Versalien und bei uns gemischt.
--
-- 🪤 UND DER TEST HAT ES NICHT GEFUNDEN, weil er dem Ausdruck ein Feature mit `region_type` in die
-- Hand gab. Ein Test, der die Eigenschaft selbst mitbringt, prüft den Ausdruck - nicht die Kachel.
-- Deshalb steht jetzt zusätzlich eine Prüfung gegen die echte Relation.
--
-- ⭐ Auch hier entsteht kein Datum: `region.region_type` liegt seit WI-0003 in der Datenbank. Die
-- Migration reicht eine vorhandene redaktionelle Angabe an die Darstellung durch. Keine Geometrie,
-- keine Sichtbarkeit, keine Kollisionsregel.
--
-- 🪤 Beide Sichten wachsen am ENDE (`42P16`; ein DROP nähme der Martin-Rolle ihr Leserecht, auf dem
-- VPS gemessen). Und die Kachelfunktion muss die Spalte MITNEHMEN: sie baut ihre MVT aus einer
-- ausdrücklichen Spaltenliste, eine neue Spalte in der Sicht erreicht sie von allein nicht.

CREATE OR REPLACE VIEW map_label_render AS
SELECT
    l.public_id,
    l.name,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    EXISTS (SELECT 1 FROM landscape_label_run r WHERE r.region_id = l.region_id) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point, 3857) AS geom,
    label_collision_rank(NULL::smallint, l.label_priority, l.label_min_zoom) AS collision_rank,
    -- Die neue letzte Spalte: der Namenston und die Versalien hängen an ihr.
    reg.region_type
FROM map_label l
LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
WHERE l.is_active
ORDER BY l.public_id;

CREATE OR REPLACE VIEW landscape_label_run_render AS
SELECT
    r.id AS run_id,
    reg.public_id AS region_public_id,
    l.name,
    reg.region_layer,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, l.label_priority, l.label_min_zoom) AS collision_rank,
    reg.region_type
FROM landscape_label_run r
JOIN region reg ON reg.id = r.region_id
JOIN map_label l ON l.id = r.style_label_id
WHERE reg.is_active
  AND l.is_active
ORDER BY reg.public_id, r.instance_count, r.instance;

-- Die Kachelfunktion unverändert bis auf die eine Spalte. Reihenfolge, Zuschnitt und Zoomfenster
-- bleiben Wort für Wort die aus 0017 beziehungsweise ADR-0007.
CREATE OR REPLACE FUNCTION landscape_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'landscape_label_run' ORDER BY source.region_public_id, source.instance_count, source.instance)
    INTO tile
    FROM (
        SELECT
            run.run_id,
            run.region_public_id,
            run.name,
            run.region_layer,
            run.region_type,
            run.label_size,
            run.label_priority,
            run.collision_rank,
            run.instance,
            run.instance_count,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM landscape_label_run_render run
        CROSS JOIN LATERAL (SELECT run.name_width_px * units_per_pixel AS target) need
        CROSS JOIN LATERAL (
            SELECT
                GREATEST(0.0, 0.5 - (need.target / 2.0) / NULLIF(ST_Length(run.geom), 0)) AS lo,
                LEAST(1.0, 0.5 + (need.target / 2.0) / NULLIF(ST_Length(run.geom), 0)) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

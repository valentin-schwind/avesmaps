-- Landschaftsnamen waehlen Versalien und Namenston nach dem LABELTYP, wie Legacy (Katalog V1).
--
-- 💣 Bisher las der Stil den REGIONSTYP der verknuepften Flaeche (Migration 0027). Legacy setzt die
-- Klasse aber aus dem Labeltyp (`.map-label--<labelType>`), und der liegt bei uns in
-- `map_label.subtype` - Zeichen fuer Zeichen. Gemessen 2026-09-23: 90 von 1047 Beschriftungen
-- weichen ab, 87 davon haben gar keinen Regionstyp. Darunter genau die grossen politischen Namen:
-- „Nordmarken", „Liebliches Feld", „Tulamidenlande", „Huegellande" - Labeltyp `region`, also
-- Versalien und Regionston, bei uns gemischt und in der Vorgabefarbe (Betreiberbefund 2026-09-23).
--
-- 🔴 Kein neues Datum: `map_label.subtype` ist seit dem Regionsimport migriert, er wurde nur nicht
-- gelesen. Keine Kartenmutation.
--
-- Vorlage sind die AKTUELLEN Definitionen (test/__snapshots__/render-definitions.sql), nicht eine
-- aeltere Migration - die Lehre aus 0028/0029. Neue Spalte jeweils ans ENDE (PostgreSQL erweitert
-- eine Sicht nur dort); `CREATE OR REPLACE` behaelt der Kachelrolle ihr Leserecht (0017).
-- `region_type` bleibt stehen: eine Spalte laesst sich aus einer Sicht nur per DROP entfernen, und
-- das kostete das Leserecht. Der Stil liest sie nicht mehr.

CREATE OR REPLACE VIEW map_label_render AS
SELECT l.public_id,
    l.name,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    (EXISTS ( SELECT 1
           FROM landscape_label_run r
          WHERE r.region_id = l.region_id)) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point,3857) AS geom,
    label_collision_rank(NULL::smallint, l.label_priority, l.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type
   FROM map_label l
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active
  ORDER BY l.public_id;

CREATE OR REPLACE VIEW landscape_label_run_render AS
SELECT r.id AS run_id,
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
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString,3857) AS geom,
    label_collision_rank(NULL::smallint, l.label_priority, l.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type
   FROM landscape_label_run r
     JOIN region reg ON reg.id = r.region_id
     JOIN map_label l ON l.id = r.style_label_id
  WHERE reg.is_active AND l.is_active
  ORDER BY reg.public_id, r.instance_count, r.instance;

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
            run.label_type,
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

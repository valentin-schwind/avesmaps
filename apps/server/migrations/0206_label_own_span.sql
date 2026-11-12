-- 0206: Die Kacheln der Landschaftsnamen sagen, ob eine Beschriftung ihre eigene Spanne aus dem Editor trägt (WI-0178; Befund der
-- Kartenverwaltung, WI-0221 §8.1: „Darum begrenzt eine verstellte Art auch diese Regionen (Schnittmenge), entgegen F2.“). F2: Die Spanne
-- am Objekt ersetzt die der Art. Die Karte legt die Spanne der Art aus dem Reiter „Zoombänder“ nur noch über Beschriftungen ohne eigene.
--
--   `own_span`: beide Grenzen am Objekt gesetzt (`map_label.label_min_zoom` und `label_max_zoom`), dieselbe Regel wie
--   `map_label_effective` (0057: nur das Paar ersetzt die Vorgabe der Art).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): je Sicht EINE Spalte hinten, die Kachelfunktion liefert sie mit. Vorlage sind die Definitionen
-- aus `apps/server/test/__snapshots__/render-definitions.sql`, nicht ältere Migrationen; geändert ist nur die neue Spalte. Ohne die
-- Spalte (alte Kachel) wertet die Karte wie bisher: Die Spanne der Art gilt. Martin liest den Katalog beim Start: danach neu starten.

CREATE OR REPLACE VIEW landscape_label_run_render AS
SELECT r.id AS run_id,
    reg.public_id AS region_public_id,
    l.name,
    reg.region_layer,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type,
    (l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL) AS own_span
   FROM landscape_label_run r
     JOIN region reg ON reg.id = r.region_id
     JOIN map_label l ON l.id = r.style_label_id
     JOIN map_label_effective e ON e.label_id = l.id
  WHERE reg.is_active AND NOT reg.is_hidden AND l.is_active AND l.show_name IS DISTINCT FROM false
  ORDER BY reg.public_id, r.instance_count, r.instance;

CREATE OR REPLACE VIEW map_label_render AS
SELECT l.public_id,
    l.name,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    (EXISTS ( SELECT 1
           FROM landscape_label_run r
          WHERE r.region_id = l.region_id)) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type,
    ((reg.region_layer = ANY (ARRAY['vegetation'::text, 'topographie'::text])) AND (EXISTS ( SELECT 1
           FROM region zwilling
          WHERE zwilling.is_active AND (zwilling.region_layer = ANY (ARRAY['vegetation'::text, 'topographie'::text])) AND zwilling.name = reg.name AND zwilling.id <> reg.id AND (EXISTS ( SELECT 1
                   FROM region_area a
                  WHERE a.region_id = zwilling.id AND a.is_active))))) IS TRUE AS name_twin,
    (l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL) AS own_span
   FROM map_label l
     JOIN map_label_effective e ON e.label_id = l.id
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active AND l.show_name IS DISTINCT FROM false AND NOT (EXISTS ( SELECT 1
           FROM region verborgen
          WHERE verborgen.id = l.region_id AND verborgen.is_hidden))
  ORDER BY l.public_id;

CREATE OR REPLACE FUNCTION public.landscape_label_run_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    -- Die Sortierung steht im Aggregat (render-order.test.ts): erst die Mitte je Lauf.
    SELECT ST_AsMVT(source, 'landscape_label_run' ORDER BY source.region_public_id, source.instance_count, source.instance, source.candidate)
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
            kandidat.ordnung AS candidate,
            run.own_span,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM landscape_label_run_render run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd (wie 0030).
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
                OR (
                    run.instance_count = 1
                    AND lage.mitte - lage.halb >= 0.0
                    AND lage.mitte + lage.halb <= 1.0
                )
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$;

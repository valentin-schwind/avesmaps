-- 0166: Derographie-Flächen für Besucher verbergen (WI-0178 T41; EDIT-0003 T41, Betreiber 2026-10-17 am Blatt; Claudio 2026-10-18,
-- `2026-10-18-landschaften-verbergen-einschaetzung-antwort-an-claudia.md`).
--
--   1. `region.is_hidden`: Die Landschaft ist für Besucher verborgen, überall: keine Fläche, kein Name, keine Schriftläufe (Betreiber,
--      Frage 3 „Überall weg“). Sie bleibt aktiv; Gelände, Seegraph, Wegfindung und die Ableitungen rechnen sie weiter (Claudio, Abschnitt
--      2: `is_hidden` geht in keinen Fingerabdruck, keinen Eingabeindex und keinen Auslöser).
--   2. Der Trigger `region_revision` (0137, 0163) zählt auch `is_hidden`: Verbergen und Zurückholen sind fachliche Änderungen mit Revision.
--   3. Die Besucherquellen in Martin filtern `NOT is_hidden` im SQL (Claudio, Abschnitt 1): Verborgenes verlässt die Datenbank für Besucher
--      nie. Editoren bekommen die Verborgenen als kleine Zusatzschicht über die App (`/api/editor/landscapes/hidden`), nicht über Martin.
--      Spalten und Reihenfolge der vier Sichten bleiben, nur die Bedingungen kommen dazu (Fassung aus `render-definitions.sql`).
--
-- 🔴 ADDITIV: eine Spalte mit Vorgabe `FALSE`, derselbe Trigger mit einer Spalte mehr, vier Sichten mit gleichen Spalten. Das vorige
-- Release liest und schreibt die Spalte nie; alle Zeilen sind `FALSE`, die Sichten liefern dasselbe. Der Landschaften-Zug schreibt
-- `is_hidden` nie (wie die Klicksperre); legt er eine verborgene Landschaft still, meldet er es als Befund.

ALTER TABLE region ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN region.is_hidden IS
    'Für Besucher verborgen (WI-0178 T41, landscape.update changes.hidden); die Besucherquellen filtern sie, Editoren sehen sie schraffiert. Der Landschaften-Zug schreibt die Spalte nie.';

CREATE OR REPLACE TRIGGER region_revision
    BEFORE UPDATE OF map_domain_id, name, region_layer, region_type, stack_order, is_locked, wiki_url, wiki_region_key,
                     label_curve_enabled, label_curve_max, label_curve_degree, primary_label_id, is_active, off_map, is_hidden,
                     source_system, legacy_public_id, revision
    ON region
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE VIEW region_area_render AS
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    s.render_geom AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden
UNION ALL
 SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry,3857) AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)))
  ORDER BY 1;

CREATE OR REPLACE VIEW terrain_water_render AS
SELECT a.public_id,
    r.region_type,
    s.render_geom AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text]))
UNION ALL
 SELECT a.public_id,
    r.region_type,
    map_domain_to_render(a.map_domain_id, terrain_water_smooth(a.geom))::geometry(Geometry,3857) AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text])) AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at))
  ORDER BY 1;

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
                  WHERE a.region_id = zwilling.id AND a.is_active))))) IS TRUE AS name_twin
   FROM map_label l
     JOIN map_label_effective e ON e.label_id = l.id
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active AND l.show_name IS DISTINCT FROM false AND NOT (EXISTS ( SELECT 1
           FROM region verborgen
          WHERE verborgen.id = l.region_id AND verborgen.is_hidden))
  ORDER BY l.public_id;

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
    l.subtype AS label_type
   FROM landscape_label_run r
     JOIN region reg ON reg.id = r.region_id
     JOIN map_label l ON l.id = r.style_label_id
     JOIN map_label_effective e ON e.label_id = l.id
  WHERE reg.is_active AND NOT reg.is_hidden AND l.is_active AND l.show_name IS DISTINCT FROM false
  ORDER BY reg.public_id, r.instance_count, r.instance;

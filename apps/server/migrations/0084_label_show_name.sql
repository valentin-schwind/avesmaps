-- Beschriftungen mit „Regionname anzeigen = aus“ werden nicht gezeichnet (Betreiber 2026-10-09 mit zwei Bildern von Stage,
-- „See-281“ und „See-267“: „ein blick in legacy zeigt, dass sie "auto-name" sind“).
--
-- 🔴 Legacys Regel, wörtlich (`js/map-features/map-features-labels.js`, `shouldShowLabelMarker`, Mirror `cfbbe69c8`):
-- „„Regionname anzeigen" aus -> das Label bleibt bestehen, wird aber nicht gezeichnet.“ Gelesen wird
-- `(properties.show_name ?? feature.show_name) !== false`: nur ein ausdrückliches `false` verbirgt, ein fehlender Wert zeigt.
-- Der Import trägt den Wert seit jeher (`map_label.show_name`, `regions.ts`); die zwei Ansichten der Namen haben ihn nie
-- gelesen. Am Satz 169042 zeichneten wir deshalb 337 Namen, die Legacy verbirgt: 75 Platzhalter („See-281“, „Wald-…“) und
-- 262 echte Namen, deren Anzeige die Redaktion abgeschaltet hat. Das ist eine redaktionelle Einstellung und gehört den
-- Editoren (AGENTS.md, Map Mutation Guard: Einstellungen der Editoren sind kein Fehler).
--
-- Geändert ist allein die Bedingung `l.show_name IS DISTINCT FROM false` in beiden Ansichten; Spalten, Reihenfolge und
-- Joins sind die aus 0057 (der aktuellen Fassung, `test/__snapshots__/render-definitions.sql`). Die Beschriftung bleibt in
-- `map_label` stehen und mit ihr ihre Schriftläufe; sie werden nur nicht ausgeliefert.

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
  WHERE reg.is_active AND l.is_active AND l.show_name IS DISTINCT FROM false
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
    l.subtype AS label_type
   FROM map_label l
     JOIN map_label_effective e ON e.label_id = l.id
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active AND l.show_name IS DISTINCT FROM false
  ORDER BY l.public_id;

-- The view published untyped geometry, so geometry_columns reported SRID 0 and Martin skipped it
-- ("Table public.place_render.geom has SRID=0, skipping"). A typed column states the derived SRID
-- to the catalog. The authoritative place.geom stays SRID 0 (chapter 4.13).
DROP VIEW IF EXISTS place_render;

CREATE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_min_zoom,
    p.label_max_zoom,
    p.show_name,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom
FROM place p
WHERE p.is_active;

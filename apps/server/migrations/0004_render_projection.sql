-- Derived Render Projection (chapter 4.17.4), the fallback the rendering gate selected (ADR-0003).
--
-- 💣 DERIVED, NEVER AUTHORITATIVE. These geometries exist so a Web-Mercator tile stack can draw
-- them. Distances, routing costs, editor writes and migration parity all use place.geom instead.
-- The same affine transform exists once more in packages/shared/src/render-projection.ts; a test
-- compares both against each other, so a drift fails the build instead of moving the map.

CREATE OR REPLACE FUNCTION map_domain_to_render(domain_id TEXT, geom geometry)
RETURNS geometry
LANGUAGE sql
STABLE
AS $$
    SELECT ST_SetSRID(
        ST_Translate(
            ST_Scale(
                ST_Translate(geom, -d.min_x, -d.min_y),
                (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y),
                (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y)
            ),
            -20037508.342789244,
            -20037508.342789244
        ),
        3857
    )
    FROM map_domain d
    WHERE d.id = domain_id;
$$;

COMMENT ON FUNCTION map_domain_to_render IS
    'Derived render geometry for the tile stack. Never a source of truth (chapter 4.17.4).';

-- Tile source for Martin. Martin refuses SRID 0 tables, which is exactly the reason this view
-- exists; it publishes derived geometry and carries the logical zoom band data along.
CREATE OR REPLACE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_min_zoom,
    p.label_max_zoom,
    p.show_name,
    map_domain_to_render(p.map_domain_id, p.geom) AS geom
FROM place p
WHERE p.is_active;

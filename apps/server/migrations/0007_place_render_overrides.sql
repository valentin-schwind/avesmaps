-- Die Renderansicht traegt die umbenannten Overrides. Sie gehen als eigene Eigenschaften in die
-- Kachel, damit der Stil die globale Regel anwenden und sie im Einzelfall ersetzen kann (ADR-0006).
DROP VIEW IF EXISTS place_render;

CREATE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom
FROM place p
WHERE p.is_active;

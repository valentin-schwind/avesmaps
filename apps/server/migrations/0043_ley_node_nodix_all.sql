-- Jeder Kraftlinienpunkt ist ein Knoten der Kraftlinien-Ansicht (WI-0025).
--
-- Betreiber 2026-09-26 auf die Frage, ob die Bögen an den 19 Treffpunkten landen oder im Himmel
-- ineinander übergehen: „richtig, dort landen, wie bei knoten“. 0042 führte einen Kraftlinienpunkt
-- nur als Knoten, wenn dort genau eine Linie endet; jetzt ist es jeder aktive Punkt, alle 45.
--
-- Spalten und die übrigen Zweige wie in 0042; nur die Bedingung des letzten Zweigs fällt weg.

CREATE OR REPLACE VIEW ley_node_render AS
SELECT knoten.*
FROM (
    SELECT
        p.public_id,
        p.name,
        p.subtype,
        p.is_hidden,
        p.label_min_zoom_override,
        p.label_max_zoom_override,
        p.label_visible_override,
        p.label_size_override,
        map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
        label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
        p.is_ruined,
        'place'::text AS node_kind
    FROM place p
    LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
    WHERE p.is_active
      AND (
          p.is_nodix
          OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.from_public_id = p.public_id)
          OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.to_public_id = p.public_id)
      )
    UNION ALL
    SELECT
        l.public_id,
        l.name,
        'stadt'::text AS subtype,
        FALSE AS is_hidden,
        NULL::smallint AS label_min_zoom_override,
        NULL::smallint AS label_max_zoom_override,
        NULL::boolean AS label_visible_override,
        NULL::numeric(4, 1) AS label_size_override,
        map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point, 3857) AS geom,
        label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
        FALSE AS is_ruined,
        'label'::text AS node_kind
    FROM map_label l
    LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = 'stadt'
    WHERE l.is_active
      AND (
          l.is_nodix IS TRUE
          OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.from_public_id = l.public_id)
          OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.to_public_id = l.public_id)
      )
    UNION ALL
    SELECT
        n.public_id,
        NULL::text AS name,
        'dorf'::text AS subtype,
        FALSE AS is_hidden,
        NULL::smallint AS label_min_zoom_override,
        NULL::smallint AS label_max_zoom_override,
        NULL::boolean AS label_visible_override,
        NULL::numeric(4, 1) AS label_size_override,
        map_domain_to_render(n.map_domain_id, n.geom)::geometry(Point, 3857) AS geom,
        label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
        FALSE AS is_ruined,
        'nodix'::text AS node_kind
    FROM nodix n
    LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = 'dorf'
    WHERE n.is_active
) AS knoten
ORDER BY knoten.public_id;

COMMENT ON VIEW ley_node_render IS
    'Die Knoten der Kraftlinien-Ansicht (WI-0025): Orte und Labels mit Nodix-Kennzeichen, jedes Linienende an Ort oder Label und jeder Kraftlinienpunkt (0043: alle, auch die Treffpunkte). Spalten wie place_render, dazu node_kind. Nur Darstellung.';

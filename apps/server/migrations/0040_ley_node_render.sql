-- Die Knoten der Kraftlinien-Ansicht (WI-0025).
--
-- Betreiber 2026-09-23: „nodix knoten: nicht nur orte sondern auch flächen oder labels können nodix
-- sein“. Legacy lässt Kraftlinien an Nodix-Orten UND an Nodix-Labels enden (Owner 2026-07-28,
-- `powerline-anchor-delete-test.php`); bei einer Fläche trägt ihr Label das Kennzeichen. In der
-- Ansicht ist deshalb jedes Linienende ein Knoten, dazu jeder Ort und jedes Label mit Kennzeichen.
-- Das schließt die 21 Enden an 8 Orten ohne Kennzeichen ein (Befund KL5, etwa Dragenfeld bei
-- Gareth): Dort landete der Bogen bisher im Nichts.
--
-- ⭐ HIER ENTSTEHT KEIN DATUM. Die Sicht liest nur, was in `place`, `map_label` und `powerline` steht.
--
-- 🔴 DIE SPALTEN SIND DIE VON `place_render` (0038), in derselben Reihenfolge, plus `node_kind` am
-- Ende. So zeichnen die Knoten und ihre Namen nach denselben Regeln wie die Orte. Ein Label hat keine
-- Ortsklasse; als Knoten gilt es als Stadt, eine mittlere Größe.
--
-- 🪤 Die Kraftlinien-Ansicht las ihre Nodices bisher aus `place_render.is_nodix` (0038). Die Spalte
-- bleibt stehen, weil Sichten nur am Ende wachsen und ein `DROP VIEW` der Martin-Rolle ihr Leserecht
-- nähme. Gelesen wird sie von der Karte nicht mehr.
--
-- Martin veröffentlicht neue Sichten beim Start: nach dieser Migration neu starten.

CREATE INDEX IF NOT EXISTS powerline_from_public_id ON powerline (from_public_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS powerline_to_public_id ON powerline (to_public_id) WHERE is_active;

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
) AS knoten
ORDER BY knoten.public_id;

COMMENT ON VIEW ley_node_render IS
    'Die Knoten der Kraftlinien-Ansicht (WI-0025): Orte und Labels mit Nodix-Kennzeichen und jedes Linienende. Spalten wie place_render, dazu node_kind. Nur Darstellung.';

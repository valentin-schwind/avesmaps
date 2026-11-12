-- 0297: Landmarken tragen die Merkmale des Orts, und Kraftlinien können an ihnen enden (WI-0271 §17; Vali 2026-11-02, wörtlich: „landmarken [können]
--   verborgen, nodix, unterirdisch, unauffindbar/entrückt und ungefähr sein - sie können keine ruine und keinen seehafen sein“).
--
--   1. `merkmale` (0276) lernt Nodix, unterirdisch, entrückt und ungefähr; „verborgen“ gab es schon. Katalog `LANDMARKEN_MERKMALE` in
--      `packages/shared/src/landmarken.ts`, dieselbe Liste; `landmarken-katalog.test.ts` hält beide zusammen. Die Revision zählt auch bei den Merkmalen.
--   2. `terrain_peak_render` hängt `is_hidden` und `is_approximate` an: Die Karte zeichnet eine verborgene Landmarke ohne Namen und erst ab dem
--      Band „Verborgene Orte“, wie einen verborgenen Ort, und zeigt das Zeichen „ungefähr“. Martin liest neue Spalten erst nach einem Neustart.
--   3. `ley_node_render` kennt die Landmarke als Knoten (`node_kind = 'landmark'`): mit dem Merkmal Nodix oder wenn dort eine Kraftlinie endet, wie
--      Ort und Beschriftung. `subtype` ist die Größenklasse des Knotens, wie bei Beschriftung und Kraftlinienpunkt: ein Bauwerk, damit ein
--      umgewandelter Ort seine Größe in der Kraftlinien-Ansicht behält.
--
-- 🔴 Kraftlinien brauchen keine neue Spalte: `from_public_id` und `to_public_id` sind Kennungen ohne Fremdschlüssel (0036), die Art eines Endes
-- ergibt sich aus der Tafel, in der die Kennung steht (`powerlines/network.ts`). Kennungen sind UUIDs, Verwechslung gibt es nicht.
--
-- 🔴 Nur gelockert und angehängt (AGENTS.md, „erst erweitern“): Das vorige Release schreibt die neuen Merkmale nicht; jede bestehende Zeile erfüllt die
-- neue Bedingung, und die neuen Spalten der Sichten stehen hinten.

ALTER TABLE terrain_peak DROP CONSTRAINT IF EXISTS terrain_peak_merkmale_known;
ALTER TABLE terrain_peak
    ADD CONSTRAINT terrain_peak_merkmale_known
        CHECK (merkmale <@ ARRAY['heilig', 'magisch', 'gefaehrlich', 'unzugaenglich', 'verborgen', 'nodix', 'unterirdisch', 'entrueckt', 'ungefaehr']::TEXT[]);

CREATE OR REPLACE TRIGGER terrain_peak_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, merkmale, geom, height_schritt, show_name, is_active, source_system, legacy_public_id,
                     revision
    ON terrain_peak
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN terrain_peak.merkmale IS
    'Merkmale der Landmarke (WI-0271): heilig, magisch, gefaehrlich, unzugaenglich ohne Wirkung auf die Karte; verborgen, nodix, unterirdisch, entrueckt, ungefaehr wirken wie am Ort (0297). Ruine und Seehafen gibt es an einer Landmarke nicht.';

CREATE OR REPLACE VIEW terrain_peak_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.height_schritt AS height,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
    p.subtype IN ('berggipfel', 'vulkan') AS formt_gelaende,
    'verborgen' = ANY (p.merkmale) AS is_hidden,
    'ungefaehr' = ANY (p.merkmale) AS is_approximate
FROM terrain_peak p
WHERE p.is_active AND p.show_name
ORDER BY p.public_id;

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
    UNION ALL
    SELECT
        t.public_id,
        t.name,
        'gebaeude'::text AS subtype,
        'verborgen' = ANY (t.merkmale) AS is_hidden,
        NULL::smallint AS label_min_zoom_override,
        NULL::smallint AS label_max_zoom_override,
        NULL::boolean AS label_visible_override,
        NULL::numeric(4, 1) AS label_size_override,
        map_domain_to_render(t.map_domain_id, t.geom)::geometry(Point, 3857) AS geom,
        label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
        FALSE AS is_ruined,
        'landmark'::text AS node_kind
    FROM terrain_peak t
    LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = 'gebaeude'
    WHERE t.is_active
      AND (
          'nodix' = ANY (t.merkmale)
          OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.from_public_id = t.public_id)
          OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.to_public_id = t.public_id)
      )
) AS knoten
ORDER BY knoten.public_id;

COMMENT ON VIEW ley_node_render IS
    'Die Knoten der Kraftlinien-Ansicht (WI-0025): Orte, Labels und Landmarken mit Nodix-Kennzeichen, jedes Linienende an ihnen und jeder Kraftlinienpunkt (0043: alle, auch die Treffpunkte). Landmarken seit 0297. Spalten wie place_render, dazu node_kind. Nur Darstellung.';

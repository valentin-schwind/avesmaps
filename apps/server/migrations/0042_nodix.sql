-- Die Kraftlinienpunkte, a.k.a. Nodix, als eigener Objekttyp (WI-0025).
--
-- Betreiber 2026-09-26: „achte darauf, dass kreuzung nicht einfach als kreuzungen importiert werden.
-- für deinen import reicht es "Kraftlinienpunkte a.k.a. Nodix" als eigenes objekt zu bauen … Nodix
-- ist ein neuer Objekttyp, der für Kraftlinien deinen aktuellen Kreuzungen entspricht. Ein "Nodix"
-- kann aber auch eine Objekteigenschaft sein.“
--
-- Legacy führt die Punkte, an denen eine Kraftlinie ohne Ort endet oder mehrere zusammenlaufen, als
-- Kreuzungen (`junction`/`crossing`, Name „Kreuzung“). Im Snapshot 140088 sind es 45, nur 13 davon
-- liegen überhaupt auf einem Weg. Hier sind sie ein eigener Objekttyp und hängen NICHT an der
-- Kreuzungstabelle des Wegenetzes. Das Kennzeichen `is_nodix` an Orten und Labels bleibt daneben: Ein
-- Nodix ist ein Objekt ODER eine Eigenschaft.
--
-- ⭐ Ein Punkt trägt die Kennung seines Legacy-Objekts. So stimmen die Verweise der Kraftlinien
-- (`from_public_id`, `to_public_id`) ohne jede Umrechnung.

CREATE TABLE IF NOT EXISTS nodix (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Legacy schreibt nur „Kreuzung“ oder „Kreuzung-41“: kein Name, nur die Spur des Imports.
    legacy_name TEXT,
    legacy_kind TEXT NOT NULL CHECK (legacy_kind IN ('junction', 'crossing')),
    geom geometry(Point, 0) NOT NULL,
    source_system TEXT NOT NULL,
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT nodix_public_id_unique UNIQUE (public_id),
    CONSTRAINT nodix_inside_domain CHECK (map_domain_contains(map_domain_id, geom))
);

COMMENT ON TABLE nodix IS
    'Kraftlinienpunkte (Nodix) als eigener Objekttyp: wo eine Kraftlinie ohne Ort endet oder mehrere zusammenlaufen. Aus Legacys Kreuzungsobjekten, die Kraftlinien verwenden (WI-0025, Betreiber 2026-09-26).';

-- Die Knoten der Kraftlinien-Ansicht, jetzt mit den Kraftlinienpunkten. Spalten unverändert (0040).
--
-- 🔴 Ein Kraftlinienpunkt ist ein Knoten, wo die Bögen LANDEN: an dem nur eine Linie endet (26 im
-- Bestand, Betreiber: „die 26 Linienenden an Kreuzungen sind Nodices“). Wo mehrere zusammenlaufen,
-- tragen die Bögen einander im Himmel weiter, wie im abgenommenen Entwurf; dort steht kein Knoten am
-- Boden. Dieselbe Regel steht in `powerlineChainReach` (ein Ende mit nur einer Linie ist ein Anker).
-- Ohne Namen: Legacy schreibt nur „Kreuzung“. Als Knoten zeichnet er sich wie ein Dorf, klein.
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
      AND (
          SELECT count(*)
          FROM powerline pl
          WHERE pl.is_active AND (pl.from_public_id = n.public_id OR pl.to_public_id = n.public_id)
      ) = 1
) AS knoten
ORDER BY knoten.public_id;

COMMENT ON VIEW ley_node_render IS
    'Die Knoten der Kraftlinien-Ansicht (WI-0025): Orte und Labels mit Nodix-Kennzeichen, jedes Linienende an Ort oder Label und jeder Kraftlinienpunkt, an dem nur eine Linie endet (0042). Spalten wie place_render, dazu node_kind. Nur Darstellung.';

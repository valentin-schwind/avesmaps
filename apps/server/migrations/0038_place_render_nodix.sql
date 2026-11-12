-- Die Nodices in der Kraftlinien-Ansicht (WI-0025, Betreiber 2026-09-23: „ortsmarkierungen von nodices
-- fehlen noch wie in legacy“) - dafür muss die Ortskachel wissen, welcher Ort ein Nodix ist.
--
-- ⭐ HIER ENTSTEHT KEIN DATUM. `place.is_nodix` liegt seit WI-0002 in der Datenbank, migriert und gegen
-- Legacy geprüft (83 Orte, 5 davon verborgen); es hat bisher nur nie die Renderansicht erreicht. Legacy
-- zeichnet in der Kraftlinien-Ansicht genau diese Orte als leuchtende „Ley-Knoten“ und sonst keinen
-- (`shouldShowLocationMarker`, map-features-location-marker-rendering.js).
--
-- 🪤 DIE SPALTE WÄCHST AM ENDE, wortgleich zu 0026 und nur um eine letzte Spalte länger. Eine Spalte in
-- der Mitte erzwänge DROP + CREATE, und ein `DROP VIEW` nähme der Martin-Rolle ihr Leserecht.
--
-- 💣 DIE KACHELBYTES ÄNDERN SICH. Jedes Ortsfeature trägt eine Eigenschaft mehr, also weicht jede
-- `place_render`-Kachel von ihrer gepinnten Fassung ab - erwartet, nicht kaputt (Handover an Claudio).
-- Martin cacht die Kacheln selbst: nach dieser Migration neu starten.

CREATE OR REPLACE VIEW place_render AS
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
    -- Die neue letzte Spalte: in der Kraftlinien-Ansicht der Ley-Knoten (WI-0025).
    p.is_nodix
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW place_render IS
    'Renderansicht der Orte. `is_ruined` seit 0026 (kursiv), `is_nodix` seit 0038: in der Kraftlinien-Ansicht ein leuchtender Ley-Knoten (WI-0025). Beides Darstellung, keine neue Redaktionsangabe.';

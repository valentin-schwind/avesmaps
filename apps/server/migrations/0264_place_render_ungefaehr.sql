-- 0264: Die Ortskachel trägt die ungefähre Lage (WI-0267 B). Vali 2026-10-31 zur Probierseite: „das fragezeichen is cool, aber lass es erst in
-- höheren zoomstufen erscheinen wenn man es wirklich sieht“. Die Karte setzt das Fragezeichen an die Marke; dafür braucht `place_render` die Spalte
-- `is_approximate` (0263).
--
-- 🔴 ERWEITERND: Dieselbe Sicht wie 0055, Spalte für Spalte in derselben Folge, nur `is_approximate` HINTEN angehängt (`CREATE OR REPLACE VIEW` lässt
-- nur das zu). Keine neue Funktion, kein DROP; die Rechte der Kachelrolle an der Sicht bleiben. Martin liest die Spalten beim Start: Auf der Stage
-- startet ihn der Korridor nach einer Migration neu (`postmigrate --changed yes`), lokal von Hand.

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
    p.is_nodix,
    tcb.bands AS capital_bands,
    p.is_approximate
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
WHERE p.is_active
ORDER BY p.public_id;

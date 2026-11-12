-- Die Kartenlabels als Renderrelation (WI-0004, ADR-0006, ADR-0007).
--
-- 💣 Ohne diese Ansicht ist Invariante I7 auf der Karte NICHT erfüllt. Sie verlangt, dass ein
-- Fehler der Kurvenableitung die Kurve kostet und niemals den Namen - aber ein Name, für den es
-- keinen Layer gibt, ist auch ohne Fehler unsichtbar. Gemessen: Albernia trägt ein aktives Label,
-- keine Kurve und stand auf der Karte nirgends.
--
-- `has_curve_run` entscheidet, welcher Layer den Namen zeichnet: trägt die Region Schriftläufe,
-- steht der Name auf seiner Kurve, sonst als gewöhnliches Punktlabel an seiner gespeicherten
-- Stelle. Die Spalte ist zoomunabhängig, weil die Sätze einer Region ihr Erscheinungsband
-- lückenlos abdecken (geprüft als I2_baender_lueckenlos).
--
-- 🪤 `rotation` wird bewusst NICHT mitgeliefert. Für ein Label mit Regionsbezug zwingt Legacy die
-- Drehung auf 0 und zeichnet sie nicht mehr; der Wert bleibt nur als Rückweg eines Feature-Rückbaus
-- erhalten (MCS-008). Wer ihn hier ausliefert, dreht Namen, die seit August 2026 gerade stehen.

CREATE OR REPLACE VIEW map_label_render AS
SELECT
    l.public_id,
    l.name,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    EXISTS (SELECT 1 FROM landscape_label_run r WHERE r.region_id = l.region_id) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point, 3857) AS geom
FROM map_label l
LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
WHERE l.is_active;

COMMENT ON VIEW map_label_render IS
    'Renderansicht der Kartenlabels. has_curve_run trennt Kurvenbeschriftung von Punktlabel (ADR-0007).';

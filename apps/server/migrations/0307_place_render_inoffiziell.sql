-- 0307: Die Ortskachel trägt, ob der Ort inoffiziell ist (Kanal OPS-000083, Festlegung des Editorenkreises): Die Karte färbt Kreis und Raute danach
-- (`config/design-canon/avesmaps.json`, `$markerCanonComment`).
--
-- Dieselbe Aussage wie das Etikett im Infopanel (`subjects/carrier-tables.ts`, `kanonMitRang4`): Eine Zeile in `place_canon` entscheidet, `unlabelled`
-- gewinnt vor Rang 4; ohne Zeile sagt die Tafel je Objektart der Umgebung (`canon_object_label_setting`), ohne deren Zeile gilt die Vorgabe „kein Etikett“.
-- Nur lesend: keine Kartendaten.
--
-- 🔴 ERWEITERND: Dieselbe Sicht wie 0264, Spalte für Spalte in derselben Folge, nur `is_unofficial` HINTEN angehängt (`CREATE OR REPLACE VIEW` lässt nur
-- das zu). Keine neue Funktion, kein DROP; die Rechte der Kachelrolle an der Sicht bleiben. Martin liest die Spalten beim Start: Auf der Stage startet ihn
-- der Korridor nach einer Migration neu (`postmigrate --changed yes`), lokal von Hand.

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
    p.is_approximate,
    COALESCE(
        pc.canon = 'unofficial',
        (SELECT s.display FROM canon_object_label_setting s WHERE s.object_kind = 'place'),
        false
    ) AS is_unofficial
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
LEFT JOIN place_canon pc ON pc.place_id = p.id
WHERE p.is_active
ORDER BY p.public_id;

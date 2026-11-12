-- Die Renderansicht traegt die Ortsmerkmale mit.
--
-- Verborgene Orte bleiben in der Ansicht, statt hier herausgefiltert zu werden: Legacy verbirgt
-- Markierung und Namen, laesst den Ort aber ueber seinen Namen auffindbar und zeigt ihn nach einem
-- Treffer fuer diesen Besuch. Das ist eine Renderentscheidung, keine Datenfrage - der Stil trifft
-- sie, und eine spaetere Suche braucht die Zeile.
--
-- is_ruined, is_nodix und place_kind gehen nicht in die Kachel: sie aendern die Zeichnung nicht und
-- haetten in jeder Kachel nur Platz gekostet.
DROP VIEW IF EXISTS place_render;

CREATE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom
FROM place p
WHERE p.is_active;

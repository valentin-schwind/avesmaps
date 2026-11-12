-- Die Fläche je Polygon in der Landschaftskachel (WI-0043 Stufe 2, Betreiber 2026-09-28: „A+B+C“ zum Klick
-- auf Flächen). Wo sich Flächen überlagern, wählt ein Klick zuerst die kleinste, ein zweiter an derselben
-- Stelle die nächstgrößere. Vorher gewann die oberste gezeichnete, und welche das ist, entschied die
-- Reihenfolge in der Kachel.
--
-- `area` ist die Fläche des einzelnen Polygons in Karteneinheiten² (E², 2 Stellen), nicht die der ganzen
-- Region: Gewählt wird, was unter dem Zeiger liegt. Eine abgeleitete Spalte, keine Kartendaten.
--
-- 🪤 Martin liest die Spalten einer Sicht nur beim Start: Nach dieser Migration braucht Martin einen
-- Neustart, sonst fehlt `area` in den Kacheln. Die Kacheln ändern sich dadurch byteweise ohne
-- Datenänderung (eine Eigenschaft mehr).
--
-- Neue Spalten dürfen nur HINTEN an eine Sicht (CREATE OR REPLACE VIEW); alles davor bleibt wie in 0016.
CREATE OR REPLACE VIEW region_area_render AS
SELECT
    a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry, 3857) AS geom,
    round(ST_Area(a.geom)::numeric, 2)::double precision AS area
FROM region_area a
JOIN region r ON r.id = a.region_id
WHERE a.is_active
  AND r.is_active
ORDER BY a.public_id;

-- Die Kachel zeichnet wieder die GEGLAETTETE Wegkurve (Catmull-Rom, Migration 0024).
--
-- 💣 Migration 0028 (Fliessrichtung) hat `path_render` per `CREATE OR REPLACE VIEW` neu geschrieben
-- und dabei den `LEFT JOIN path_visual` aus 0024 verloren. Seitdem kam wieder die eckige Rohlinie
-- in die Kachel - waehrend die Wegnamen weiter auf der geglaetteten Kurve lagen, an jeder Biegung
-- also NEBEN der Strasse. Bemerkt hat es der Betreiber am Bild (2026-09-23), kein Test: der
-- vorhandene pruefte nur das Koordinatensystem der Sicht. Jetzt haelt
-- `test/path-render-visual.test.ts` fest, WELCHE Geometrie ausgeliefert wird.
--
-- 🪤 Die Lehre fuer jede kuenftige Aenderung an einer Renderansicht: `CREATE OR REPLACE VIEW`
-- schreibt die GANZE Sicht neu. Die Vorlage ist die LETZTE Fassung, nicht die erste.
--
-- Spaltenfolge unveraendert wie in 0028 (flow_direction am Ende). `CREATE OR REPLACE` statt
-- `DROP VIEW`, damit die Kachelrolle ihr Leserecht behaelt (Migration 0017). Kein neues Datum, nur
-- die Geometriequelle.

CREATE OR REPLACE VIEW path_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    -- LEFT JOIN mit Rueckfall: eine fehlende Kurve darf keinen Weg von der Karte nehmen. Dann ist
    -- die Linie eckig statt unsichtbar, und `verify:path-visuals` meldet, dass sie fehlt.
    map_domain_to_render(p.map_domain_id, COALESCE(v.geom, p.geom))::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction
FROM path p
LEFT JOIN path_visual v ON v.path_id = p.id
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW path_render IS
    'Wegabschnitte fuer die Kachel, mit der GEZEICHNETEN Kurve aus path_visual (Rueckfall: die rohe Geometrie, 0024). Feste Reihenfolge nach public_id (0016). Traegt seit 0028 die Fliessrichtung fuer die Stroemungspfeile. 0029 stellt die Kurve wieder her, die 0028 verloren hatte.';

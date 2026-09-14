-- Die Ortspaare fuer die Passpunkt-Kalibrierung ziehen (14.09.2026).
--
-- In phpMyAdmin: LINKS DIE DATENBANK ANKLICKEN, dann Reiter "SQL" -- nicht den SQL-Reiter
-- der Server-Ebene. Dort fehlt der Datenbank-Kontext, und MySQL antwortet mit
-- "#1046 - No database selected" (am 14.09.2026 genau so passiert). Wer lieber auf der
-- Server-Ebene bleibt, stellt `USE <datenbankname>;` voran.
-- Dann ausfuehren und das Ergebnis der LETZTEN Abfrage kopieren. REINES LESEN, aendert nichts.
--
-- Hintergrund: docs/superpowers/specs/2026-09-13-garetien-passpunkte-design.md
-- Gebraucht wird je Ort: unsere Lage (Karteneinheiten) und ihre (Wagenhalt-Einheiten).
--
-- 🔴 GEPAART WIRD NUR UEBER DEN EXAKTEN NAMEN, klein geschrieben und ohne Randleerzeichen.
-- Die Hausregel `avesmapsGaretienNamenNormalisiert` kann mehr (fuehrender Artikel, Unicode-
-- Faltung), aber sie in SQL nachzubauen waere eine zweite Wahrheit ueber "ist das derselbe
-- Ort" -- und bei jedem ueberraschenden Ergebnis waere die erste Frage, welche von beiden
-- recht hat. Lieber ein paar Paare weniger und diese sicher.
--
-- 💣 MEHRDEUTIGE NAMEN FLIEGEN RAUS. Entwurf §2.4: von 219 namensgleichen Orten waren 70
-- VERSCHIEDENE Orte (es gibt zwei "Hueterkloster", zwei "Dreiwegen"). Ein Name, der auf EINER
-- der beiden Karten mehr als einmal vorkommt, ist als Passpunkt unbrauchbar -- egal, wie nah
-- die beiden zufaellig liegen.

SET SESSION group_concat_max_len = 50000000;

-- (1) Zur Kontrolle: welcher Lauf wird gelesen, und wie viel steht darin?
SELECT (SELECT MAX(id) FROM garetien_import_run)                       AS lauf,
       (SELECT COUNT(*) FROM garetien_import_row
         WHERE run_id = (SELECT MAX(id) FROM garetien_import_run)
           AND geo_art = 'koordinaten')                                AS ihre_zeilen,
       (SELECT COUNT(*) FROM map_features
         WHERE feature_type = 'location' AND is_active = 1)            AS unsere_orte;

-- (2) DIE PAARE. Eine Zeile je Ort, Felder durch | getrennt:
--     name | unser_x | unser_y | ortsklasse | ihre_rohkoordinate
--
-- ⚠️ `geo` kommt ROH heraus und wird erst in PHP zerlegt: die Quelle schreibt zwei
-- Schreibweisen ("x y, x y" bei GGP, "x;y; x;y" im KoschWiki), und der Hausparser
-- `avesmapsGaretienParseKoordinaten` kennt beide. In SQL zu trennen hiesse, eine davon
-- stillschweigend fallen zu lassen.
-- ⚠️ Die Marke "existiert, aber noch nicht platziert" (2000000 2000000) faellt schon hier
-- heraus -- sie ist kein Ort, und EIN solcher Punkt zerrisse jede Anpassung.
SELECT GROUP_CONCAT(zeile ORDER BY name SEPARATOR '\n') AS paare
FROM (
    SELECT m.name                                                       AS name,
           CONCAT_WS('|',
               m.name,
               ROUND(JSON_EXTRACT(m.geometry_json, '$.coordinates[0]') + 0, 5),
               ROUND(JSON_EXTRACT(m.geometry_json, '$.coordinates[1]') + 0, 5),
               m.feature_subtype,
               TRIM(g.geo)
           )                                                            AS zeile
    FROM map_features m
    JOIN garetien_import_row g
      ON LOWER(TRIM(g.anzeige)) = LOWER(TRIM(m.name))
    WHERE m.feature_type = 'location'
      AND m.is_active = 1
      AND JSON_UNQUOTE(JSON_EXTRACT(m.geometry_json, '$.type')) = 'Point'
      AND g.run_id   = (SELECT MAX(id) FROM garetien_import_run)
      AND g.geo_art  = 'koordinaten'
      AND g.geo NOT LIKE '%2000000%'
      -- Nur eindeutige Namen, auf BEIDEN Seiten.
      AND LOWER(TRIM(m.name)) IN (
            SELECT LOWER(TRIM(m2.name)) FROM map_features m2
             WHERE m2.feature_type = 'location' AND m2.is_active = 1
             GROUP BY LOWER(TRIM(m2.name)) HAVING COUNT(*) = 1)
      AND LOWER(TRIM(g.anzeige)) IN (
            SELECT LOWER(TRIM(g2.anzeige)) FROM garetien_import_row g2
             WHERE g2.run_id  = (SELECT MAX(id) FROM garetien_import_run)
               AND g2.geo_art = 'koordinaten'
             GROUP BY LOWER(TRIM(g2.anzeige)) HAVING COUNT(*) = 1)
) x;

-- ---------------------------------------------------------------------------------------------
-- 💣 ZWEI FALLEN, DIE BEIDE STILL SIND -- sie liefern NULL Zeilen statt eines Fehlers.
--
-- (1) `JSON_EXTRACT` gibt einen JSON-Wert zurueck, also '"Point"' MIT Anfuehrungszeichen.
--     `JSON_EXTRACT(...) = 'Point'` ist deshalb NIE wahr, und die Abfrage kommt leer
--     zurueck, als gaebe es keine Ortspunkte. Darum oben `JSON_UNQUOTE`. Bei den Zahlen
--     erzwingt `+ 0` dasselbe.
--
-- (2) Kennt dieser MySQL/MariaDB die JSON-Funktionen nicht (MySQL < 5.7, MariaDB < 10.2.3),
--     bricht die Abfrage mit "FUNCTION ... does not exist" ab. Dann DIESE Fassung nehmen --
--     sie liest die Koordinaten als Text aus `{"type":"Point","coordinates":[x,y]}`:
--
--       SUBSTRING_INDEX(SUBSTRING_INDEX(m.geometry_json, '[', -1), ',',  1)  AS ax,
--       SUBSTRING_INDEX(SUBSTRING_INDEX(m.geometry_json, ',', -1), ']',  1)  AS ay
--
--     und statt der Typ-Bedingung:  m.geometry_json LIKE '%"Point"%'
--
-- ⚠️ Kommt (2) leer zurueck, steht die Geometrie anders in der Spalte als angenommen. Dann
--    EINE Zeile ansehen, bevor irgendetwas gedeutet wird:
--       SELECT name, geometry_json FROM map_features
--        WHERE feature_type = 'location' AND is_active = 1 LIMIT 1;

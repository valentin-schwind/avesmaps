-- Aufräumen der drei Testreste des Systemtests vom 05.08.2026
--
-- Diese drei Zeilen(gruppen) sind beim Test entstanden und liessen sich ueber KEINE
-- Oberflaeche entfernen. Genau das ist Befund A3 und A6 im AKUT-Bericht: es fehlen die
-- Loeschwege, nicht die Sorgfalt.
--
-- In phpMyAdmin ausfuehren. JEDER Block zeigt ERST, was er treffen wuerde -- bitte das
-- Ergebnis anschauen, bevor das DELETE darunter laeuft.

-- ---------------------------------------------------------------------------
-- 1. Acht bearbeitete Testmeldungen (id 273-280).
--    Sie tragen einen IP-Hash und sind ueber keine Ansicht mehr erreichbar.
-- ---------------------------------------------------------------------------
SELECT id, name, status, created_at, reviewed_at
FROM map_reports
WHERE id BETWEEN 273 AND 280;
-- Erwartet: genau 8 Zeilen, alle mit 'ZZ-Systemtest' im Namen bzw. als Angbar-Korrektur,
-- alle vom 05.08.2026, alle mit Status != 'neu'. Stimmt das nicht, hier ABBRECHEN.

-- DELETE FROM map_reports WHERE id BETWEEN 273 AND 280;


-- ---------------------------------------------------------------------------
-- 2. Die Kontaktnachricht des Tests.
--    Die Mail im Postfach (uid 13) ist bereits vom Owner geloescht.
-- ---------------------------------------------------------------------------
SELECT id, name, created_at, LEFT(message, 60) AS anfang
FROM contact_message
WHERE message LIKE '%ZZ-Systemtest%';
-- Erwartet: genau 1 Zeile vom 05.08.2026.

-- DELETE FROM contact_message WHERE message LIKE '%ZZ-Systemtest%';


-- ---------------------------------------------------------------------------
-- 3. Eine verwaiste Katalogquelle (uses 0).
--    Sie taucht weiter in der Quellen-Vervollstaendigung aller Redakteure auf.
-- ---------------------------------------------------------------------------
SELECT s.id, s.label, s.url, COUNT(fs.id) AS verweise
FROM sources s
LEFT JOIN feature_sources fs ON fs.source_id = s.id
WHERE s.id = 1224935
GROUP BY s.id, s.label, s.url;
-- Erwartet: 1 Zeile, verweise = 0. Ist verweise > 0, hier ABBRECHEN -- dann haengt
-- doch noch etwas daran.

-- DELETE FROM sources WHERE id = 1224935;


-- ---------------------------------------------------------------------------
-- ZUR KONTROLLE: sind sonst noch Testspuren da?
-- ---------------------------------------------------------------------------
SELECT 'map_reports' AS tabelle, COUNT(*) AS treffer FROM map_reports WHERE name LIKE '%ZZ-Systemtest%'
UNION ALL SELECT 'contact_message', COUNT(*) FROM contact_message WHERE message LIKE '%ZZ-Systemtest%'
UNION ALL SELECT 'map_features',    COUNT(*) FROM map_features    WHERE name LIKE '%ZZ-Systemtest%'
UNION ALL SELECT 'adventure',       COUNT(*) FROM adventure       WHERE title LIKE '%ZZ-Systemtest%'
UNION ALL SELECT 'sources',         COUNT(*) FROM sources         WHERE label LIKE '%ZZ-Systemtest%';
-- Nach den drei DELETEs muessen alle fuenf Zeilen 0 zeigen.

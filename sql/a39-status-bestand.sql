-- A39/A33 · Welche Status liegen heute wirklich in den Meldungstabellen?
--
-- NUR LESEND. Keine Schreibvorgaenge, keine Tabellenaenderung, kein Massenlauf.
-- In phpMyAdmin ausfuehren und die Ergebnisse melden.
--
-- WARUM DIE FRAGE JETZT DRINGENDER IST ALS VORHER: zwei Aenderungen vom 05.08.2026 haben den
-- Import-Endpunkt (api/import/location-reports/update-status.php) enger gemacht, jede fuer sich
-- richtig -- zusammen frieren sie eine Altzeile aber DOPPELT ein:
--
--   * A33 (7aedccb3): er nimmt nur noch approved | rejected | in_review entgegen. Ein anderer
--     Status laesst sich ueber diese Tuer nicht mehr SETZEN.
--   * A39 (2d98bb9e): sein UPDATE fasst nur noch Zeilen mit status='neu' an. Eine Zeile, die
--     bereits einen anderen Status traegt, laesst sich ueber diese Tuer nicht mehr AENDERN.
--
-- Steht im Bestand also eine Zeile mit einem Status ausserhalb der vier bekannten
-- (neu | approved | rejected | in_review), dann ist sie ab sofort weder korrigierbar noch
-- entfernbar -- der Editor fasst wegen `AND status = 'neu'` ebenfalls nichts mehr an (A32).
--
-- 💣 Ein konkreter Verdacht, kein erfundener: das inzwischen geloeschte Importwerkzeug
-- (map/import_reported_locations.py, entfernt am 17.05.2026) setzte nach getanem Import den Status
-- 'alt'. Ob solche Zeilen existieren, weiss niemand -- die Spalte ist VARCHAR(20) ohne ENUM
-- (sql/schema.sql:221), die Datenbank hat es also nie eingeschraenkt.
--
-- Fallen Zeilen an, ist das KEIN Grund, die beiden Riegel zurueckzunehmen: der Weg zurueck ist ein
-- einmaliges, gezieltes UPDATE von Hand, kein dauerhaft offener Schreibkanal.

-- 1) Die Statusverteilung der Ortsmeldungen.
SELECT
    status,
    COUNT(*)        AS anzahl,
    MIN(created_at) AS aelteste,
    MAX(created_at) AS juengste
FROM location_reports
GROUP BY status
ORDER BY anzahl DESC;

-- 2) Dasselbe fuer die zweite Meldungstabelle -- sie haengt am selben Pruefbildschirm und an
--    denselben Filtern ("Bearbeitet" heisst dort `status <> 'neu'`).
SELECT
    status,
    COUNT(*)        AS anzahl,
    MIN(created_at) AS aelteste,
    MAX(created_at) AS juengste
FROM map_reports
GROUP BY status
ORDER BY anzahl DESC;

-- 3) Nur die Zeilen, die von KEINER Oberflaeche mehr erreichbar waeren. Erwartung: leer.
--    Kommt hier etwas zurueck, bitte die ids melden -- dann braucht es ein einmaliges UPDATE.
SELECT 'location_reports' AS tabelle, id, status, created_at
FROM location_reports
WHERE status NOT IN ('neu', 'approved', 'rejected', 'in_review')
UNION ALL
SELECT 'map_reports' AS tabelle, id, status, created_at
FROM map_reports
WHERE status NOT IN ('neu', 'approved', 'rejected', 'in_review')
ORDER BY tabelle, id
LIMIT 100;

-- A39 · Die 17 eingefrorenen `alt`-Zeilen richtigstellen
--
-- ⚠️ DIESE DATEI SCHREIBT. Abschnitt 1 ist rein lesend und zeigt, was Abschnitt 2 anfassen wuerde --
-- bitte erst 1 laufen lassen, das Ergebnis ansehen, dann 2. Kein Massenlauf, 17 Zeilen.
--
-- BEFUND (gemessen am 06.08.2026 ueber sql/a39-status-bestand.sql):
-- `location_reports` traegt 17 Zeilen mit status='alt', ids 3-19, alle vom 24.04.2026. Sie sind
-- ueber keine Oberflaeche mehr richtigzustellen:
--   * A33 nimmt nur noch approved | rejected | in_review entgegen -- 'alt' ist nicht mehr SETZbar.
--   * A39 fasst nur noch status='neu' an -- eine 'alt'-Zeile ist nicht mehr AENDERbar.
--   * Der Editor hat `AND status = 'neu'` in jedem Schreibpfad (A32).
-- Sie sind weiterhin LOESCHbar (api/import/location-reports/delete.php prueft den Status nicht),
-- aber loeschen waere hier das Falsche: es sind echte, verarbeitete Meldungen.
--
-- WARUM 'approved' UND NICHT 'rejected': das Werkzeug, das sie gesetzt hat
-- (map/import_reported_locations.py, geloescht am 17.05.2026 mit 477cf7ad), dokumentiert den Wert
-- in seiner eigenen Hilfe als „Auf diesen Status werden ERFOLGREICH IMPORTIERTE Meldungen gesetzt."
-- 'alt' hiess also: uebernommen, Inhalt steht in der Karte. Das ist 'approved'.
--
-- 🔧 Das ist trotzdem DEINE Entscheidung: die Zeile behauptet hinterher, ein Mensch habe zugestimmt.
-- Wer das nicht will, laesst sie stehen -- sie schaden nichts, sie stehen nur unter „Bearbeitet"
-- mit einem Etikett, das keine Oberflaeche kennt.

-- ============================================================================================
-- 1) NUR LESEN: was Abschnitt 2 anfassen wuerde. Erwartet: 17 Zeilen, ids 3-19.
-- ============================================================================================
SELECT id, name, status, created_at, reviewed_at
FROM location_reports
WHERE status = 'alt'
ORDER BY id;

-- Und zur Sicherheit: es darf NICHTS ausserhalb dieser 17 treffen.
SELECT COUNT(*) AS zeilen_die_geaendert_wuerden
FROM location_reports
WHERE status = 'alt';

-- ============================================================================================
-- 2) SCHREIBT. Erst ausfuehren, wenn Abschnitt 1 genau die erwarteten Zeilen gezeigt hat.
-- ============================================================================================
-- ⚠️ `reviewed_at` bleibt unangetastet: der Zeitpunkt der damaligen Verarbeitung ist eine Tatsache,
-- und ihn auf heute zu setzen waere dieselbe stille Faelschung, die A39 am Import-Endpunkt behoben
-- hat. Nur das Etikett wird richtiggestellt.
UPDATE location_reports
SET status = 'approved'
WHERE status = 'alt';

-- ============================================================================================
-- 3) NUR LESEN: Gegenprobe nach dem Schreiben. Erwartet: 0 Zeilen.
-- ============================================================================================
SELECT 'location_reports' AS tabelle, id, status, created_at
FROM location_reports
WHERE status NOT IN ('neu', 'approved', 'rejected', 'in_review')
UNION ALL
SELECT 'map_reports' AS tabelle, id, status, created_at
FROM map_reports
WHERE status NOT IN ('neu', 'approved', 'rejected', 'in_review')
ORDER BY tabelle, id;

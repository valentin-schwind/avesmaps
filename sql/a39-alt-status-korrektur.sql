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
-- 1b) NUR LESEN: der Beleg fuer 'approved' statt 'rejected'. Erwartet: 17 Zeilen, alle mit
--     karten_treffer = 1. Eine Zeile mit karten_treffer = 0 heisst: diese Meldung wurde damals
--     NICHT uebernommen -- dann ist 'approved' fuer sie falsch und Abschnitt 2 zu eng zu fassen.
-- ============================================================================================
-- ⚠️ Warum das hier steht: die Begruendung oben stuetzt sich auf die Hilfe eines geloeschten
-- Werkzeugs. Das ist eine Herleitung, keine Messung. Diese Abfrage misst es an den Kartendaten
-- selbst. (Drei der 17 sind am 06.08.2026 einzeln live geprueft -- Altenfurten, Rabenhorst,
-- Kloster Loë liegen als Dorf auf der Karte. Drei von 17 ist eine Stichprobe, kein Beweis.)
--
-- ⚠️ Verglichen wird ueber den NAMEN, und der ist kein Schluessel. `map_features` speichert
-- min_x = lng und min_y = lat (api/_internal/map/features.php:1400), deshalb steht die
-- Entfernung daneben: ein Namensgleicher an ganz anderer Stelle ist ein anderer Ort.
SELECT
    r.id,
    r.name,
    r.lat,
    r.lng,
    COUNT(f.id) AS karten_treffer,
    MIN(ABS(f.min_y - r.lat) + ABS(f.min_x - r.lng)) AS naechster_abstand
FROM location_reports r
LEFT JOIN map_features f
    ON f.name = r.name
   AND f.feature_type = 'location'
   AND f.is_active = 1
WHERE r.status = 'alt'
GROUP BY r.id, r.name, r.lat, r.lng
ORDER BY karten_treffer ASC, r.id ASC;

-- ============================================================================================
-- 2) SCHREIBT. Erst ausfuehren, wenn Abschnitt 1 genau die erwarteten Zeilen gezeigt hat.
-- ============================================================================================
-- ⚠️ `reviewed_at` bleibt unangetastet: der Zeitpunkt der damaligen Verarbeitung ist eine Tatsache,
-- und ihn auf heute zu setzen waere dieselbe stille Faelschung, die A39 am Import-Endpunkt behoben
-- hat. Nur das Etikett wird richtiggestellt.
UPDATE location_reports
SET status = 'approved'
WHERE status = 'alt';

-- Falls Abschnitt 1b bei einzelnen Zeilen karten_treffer = 0 zeigt: STATT der Zeile oben diese
-- beiden nehmen, mit den betroffenen ids. Die erste stellt die uebernommenen richtig, die zweite
-- die nicht uebernommenen -- ein pauschales 'approved' waere fuer sie die Behauptung, ihr Inhalt
-- stehe auf der Karte.
--   UPDATE location_reports SET status = 'approved' WHERE status = 'alt' AND id NOT IN (<ids>);
--   UPDATE location_reports SET status = 'rejected' WHERE status = 'alt' AND id     IN (<ids>);

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

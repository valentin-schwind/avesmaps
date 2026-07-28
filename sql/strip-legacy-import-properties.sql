-- Alte Import-Eigenschaften aus map_features.properties_json entfernen -- MIT BACKUP.
-- ===========================================================================
-- WAS: 28 Eigenschaften aus alten Crawls und Importen (avespfade-Wegezuordnung, ein
-- Orte-Crawl, der SVG-Import). Sie werden im GESAMTEN Code nirgends gelesen -- weder
-- Frontend noch Editor noch API -- reisen aber in jedem Kartenpayload mit: gemessen
-- 7,5 MB von 28,6 MB, gut ein Viertel.
--
-- Groesster Posten mit Abstand: `data-confirmed-segment-ids`, 6,7 MB ueber 2443 Wege.
-- Das sind die Segment-ID-Listen des avespfade-Abgleichs. Die Positionen, um die es
-- damals ging, stecken laengst in geometry_json; die Rohspur reist nur noch mit.
--
-- 💣 KEIN Datenverlust: Abschnitt 2 sichert das VOLLSTAENDIGE properties_json jedes
-- betroffenen Features nach map_feature_legacy_properties. Abschnitt 6 stellt daraus
-- alles wieder her.
--
-- 🔧 AUSFUEHRUNG DURCH DEN OWNER (phpMyAdmin). map_features-Schreibvorgaenge macht nie
-- ein Agent. Vorher einen Dump ziehen: das Backup hier schuetzt gegen genau diesen
-- Eingriff, es ersetzt keinen Dump.
--
-- REIHENFOLGE, und warum: Kandidaten sammeln -> sichern -> entfernen -> map_revision
-- hochzaehlen. Der letzte Schritt ist NICHT optional: api/app/map-features.php bildet
-- sein ETag aus der Revision, und ohne Erhoehung antwortet der Server weiter mit 304 --
-- alle Clients behielten ihre alte, grosse Kopie, und von der Ersparnis kaeme nichts an.
--
-- KOMPATIBILITAET: bewusst OHNE JSON_OVERLAPS (erst ab MySQL 8.0.17). Statt die 28
-- Namen in jeder WHERE-Klausel zu wiederholen, entscheidet der Vergleich
-- `properties_json <> JSON_REMOVE(properties_json, …)`: betroffen ist genau, was sich
-- durch das Entfernen aendert. Das ist zugleich die exakteste denkbare Bedingung -- sie
-- kann per Konstruktion nicht von der Liste unten abweichen.

-- ===========================================================================
-- 1. KANDIDATEN SAMMELN (nur lesen)
-- ===========================================================================
DROP TEMPORARY TABLE IF EXISTS tmp_legacy_property_features;
CREATE TEMPORARY TABLE tmp_legacy_property_features AS
SELECT id
FROM map_features
WHERE properties_json IS NOT NULL
  AND properties_json <> JSON_REMOVE(properties_json,
        '$."data-confidence"',
        '$."data-confirmed-crossing-ids"',
        '$."data-confirmed-segment-ids"',
        '$."data-conflict-distance"',
        '$."data-conflict-kind"',
        '$."data-conflict-layers"',
        '$."data-conflict-segment-ids"',
        '$."data-crossing-id"',
        '$."data-imported-at"',
        '$."data-layer-label"',
        '$."data-match-status"',
        '$."data-place-category"',
        '$."data-place-category-label"',
        '$."data-place-icon"',
        '$."data-place-id"',
        '$."data-place-type-label"',
        '$."data-report-client-version"',
        '$."data-report-created-at"',
        '$."data-report-id"',
        '$."data-report-page-url"',
        '$."data-report-source"',
        '$."data-route-type"',
        '$."data-segment-id"',
        '$."data-source-x"',
        '$."data-source-y"',
        '$."legacy_route_type"',
        '$."settlement_icon"',
        '$."svg_tag"'
    );

-- HIER ANHALTEN UND ANSEHEN.
-- ERWARTUNG (Lauf vom 2026-07-28): rund 12800 Zeilen.
--
-- 💣 NICHT am Payload eichen. map-features.php liefert nur `is_active = 1` -- dort tragen
-- 5421 Features eines der Felder (2892 Wege, 1922 Orte, 607 Kreuzungen). map_features
-- enthaelt aber auch die INAKTIVEN Altzeilen, und davon gibt es hier mehr als aktive:
-- der echte Lauf sicherte 12829 Zeilen bei 11024 aktiven Features insgesamt. Meine
-- urspruengliche Erwartung "5400-6200" war genau dieser Denkfehler.
-- Weicht die Zahl um Groessenordnungen ab, NICHT weitermachen.
SELECT COUNT(*) AS kandidaten FROM tmp_legacy_property_features;

-- ===========================================================================
-- 2. BACKUP-TABELLE
-- ===========================================================================
-- Sichert das GANZE properties_json, nicht nur die entfernten Schluessel: ein
-- vollstaendiger Vorher-Zustand macht den Rollback zu einem simplen UPDATE und laesst
-- keinen Zweifel, was dort stand.
--
-- 💣 UNIQUE(feature_id) ist die Absicherung gegen einen DOPPELLAUF. Ohne sie legt ein
-- zweiter Durchlauf eine zweite Sicherung an -- und weil die Felder dann schon entfernt
-- sind, waere die zweite ein BEREINIGTER Zustand. Ein spaeterer Rollback koennte den
-- erwischen und wuerde nichts wiederherstellen, ohne dass man es merkt. Mit dem Index
-- ist das strukturell unmoeglich: `ON DUPLICATE KEY UPDATE feature_id = feature_id` laesst
-- die ERSTE (vollstaendige) Sicherung unberuehrt stehen.
CREATE TABLE IF NOT EXISTS map_feature_legacy_properties (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    feature_id BIGINT UNSIGNED NOT NULL,
    public_id CHAR(36) NOT NULL,
    feature_type VARCHAR(40) NOT NULL,
    name VARCHAR(160) NULL,
    properties_before JSON NOT NULL,
    removed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    note VARCHAR(190) NOT NULL DEFAULT 'legacy import fields (avespfade / place crawl / svg import)',
    PRIMARY KEY (id),
    UNIQUE KEY uq_mflp_feature (feature_id),
    KEY idx_mflp_public (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fuer eine Tabelle aus einem frueheren Lauf OHNE den Index (der erste Lauf am
-- 2026-07-28 hatte ihn nicht -- er lief zufaellig sauber, 12829 Zeilen auf 12829
-- verschiedene Features). Nachtraeglich setzen, sonst greift die Absicherung nie:
-- ALTER TABLE map_feature_legacy_properties ADD UNIQUE KEY uq_mflp_feature (feature_id);

-- ===========================================================================
-- 3. SICHERN + ENTFERNEN + REVISION (eine Transaktion)
-- ===========================================================================
START TRANSACTION;

SELECT revision + 1 INTO @next_revision
FROM map_revision
WHERE id = 1
FOR UPDATE;

INSERT INTO map_feature_legacy_properties (feature_id, public_id, feature_type, name, properties_before)
SELECT f.id, f.public_id, f.feature_type, f.name, f.properties_json
FROM map_features f
JOIN tmp_legacy_property_features t ON t.id = f.id
-- Bewusst ein No-Op: die ERSTE Sicherung bleibt stehen. Siehe UNIQUE(feature_id) oben.
ON DUPLICATE KEY UPDATE feature_id = map_feature_legacy_properties.feature_id;

-- JSON_REMOVE ignoriert Pfade, die es nicht gibt -- ein Feature, das nur drei der 28
-- Felder traegt, wird korrekt behandelt, ganz ohne Fallunterscheidung.
UPDATE map_features f
JOIN tmp_legacy_property_features t ON t.id = f.id
SET f.properties_json = JSON_REMOVE(f.properties_json,
        '$."data-confidence"',
        '$."data-confirmed-crossing-ids"',
        '$."data-confirmed-segment-ids"',
        '$."data-conflict-distance"',
        '$."data-conflict-kind"',
        '$."data-conflict-layers"',
        '$."data-conflict-segment-ids"',
        '$."data-crossing-id"',
        '$."data-imported-at"',
        '$."data-layer-label"',
        '$."data-match-status"',
        '$."data-place-category"',
        '$."data-place-category-label"',
        '$."data-place-icon"',
        '$."data-place-id"',
        '$."data-place-type-label"',
        '$."data-report-client-version"',
        '$."data-report-created-at"',
        '$."data-report-id"',
        '$."data-report-page-url"',
        '$."data-report-source"',
        '$."data-route-type"',
        '$."data-segment-id"',
        '$."data-source-x"',
        '$."data-source-y"',
        '$."legacy_route_type"',
        '$."settlement_icon"',
        '$."svg_tag"'
    ),
    f.revision = @next_revision;

UPDATE map_revision
SET revision = @next_revision
WHERE id = 1;

COMMIT;

-- ===========================================================================
-- 4. NACHHER PRUEFEN
-- ===========================================================================
-- gesichert muss der Kandidatenzahl aus Abschnitt 1 entsprechen, verbleibend muss 0 sein.
SELECT (SELECT COUNT(*) FROM map_feature_legacy_properties)                                    AS gesichert,
       (SELECT COUNT(*) FROM map_features
         WHERE JSON_EXTRACT(properties_json, '$."data-confirmed-segment-ids"') IS NOT NULL)     AS verbleibend,
       (SELECT ROUND(SUM(CHAR_LENGTH(properties_json)) / 1048576, 2) FROM map_features)         AS mb_properties_jetzt;

DROP TEMPORARY TABLE IF EXISTS tmp_legacy_property_features;

-- Ist eine Sicherung wirklich brauchbar? Sie muss mindestens eines der 28 Felder
-- enthalten -- sonst wurde ein bereits bereinigter Zustand gesichert und ein Rollback
-- daraus stellte nichts wieder her. brauchbar muss == zeilen sein.
-- (Beim Lauf am 2026-07-28: 12829 von 12829.)
-- SELECT COUNT(*) AS zeilen,
--        SUM(properties_before <> JSON_REMOVE(properties_before,
--            '$."data-confidence"','$."data-confirmed-crossing-ids"','$."data-confirmed-segment-ids"',
--            '$."data-conflict-distance"','$."data-conflict-kind"','$."data-conflict-layers"',
--            '$."data-conflict-segment-ids"','$."data-crossing-id"','$."data-imported-at"',
--            '$."data-layer-label"','$."data-match-status"','$."data-place-category"',
--            '$."data-place-category-label"','$."data-place-icon"','$."data-place-id"',
--            '$."data-place-type-label"','$."data-report-client-version"','$."data-report-created-at"',
--            '$."data-report-id"','$."data-report-page-url"','$."data-report-source"','$."data-route-type"',
--            '$."data-segment-id"','$."data-source-x"','$."data-source-y"','$."legacy_route_type"',
--            '$."settlement_icon"','$."svg_tag"')) AS brauchbar
-- FROM map_feature_legacy_properties;
-- 🪤 NICHT nur ein paar Felder stichprobenartig pruefen: eine Sicherung kann eines der
-- selteneren 25 tragen und keines der drei haeufigen -- sie sieht dann faelschlich leer aus.

-- ===========================================================================
-- 5. DANACH: Payload gegenmessen (Shell, nicht SQL)
-- ===========================================================================
-- curl -s -H 'Accept-Encoding: gzip' -o nachher.gz https://avesmaps.de/api/app/map-features.php
-- GEMESSEN am 2026-07-28:
--   entpackt   28,65 MB -> 21,16 MB  (-26,1 %)
--   gzip        3,33 MB ->  3,11 MB  (-6,6 %)
-- ⭐ Der Gewinn liegt NICHT im Transfer: die Segment-ID-Listen waren lange Zahlenreihen
-- und komprimierten hervorragend. Er liegt im Browser -- 7,5 MB weniger JSON, das bei
-- jedem Kaltstart geparst und im Speicher gehalten werden muss.

-- ===========================================================================
-- 6. ROLLBACK (falls doch etwas fehlt)
-- ===========================================================================
-- Stellt jedes gesicherte Feature exakt wieder her und zaehlt die Revision hoch, damit
-- die Clients die Rueckkehr auch sehen.
-- START TRANSACTION;
-- SELECT revision + 1 INTO @rollback_revision FROM map_revision WHERE id = 1 FOR UPDATE;
-- UPDATE map_features f
--   JOIN map_feature_legacy_properties b ON b.feature_id = f.id
--    SET f.properties_json = b.properties_before,
--        f.revision = @rollback_revision;
-- UPDATE map_revision SET revision = @rollback_revision WHERE id = 1;
-- COMMIT;

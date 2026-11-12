-- 0329: Die Kategorien-Datei im Pin eines WikiSync-Laufs (WI-0294).
--
--   Ortsgröße, Bauwerkart und Kontinent kommen nicht mehr über die Kategorie-Abfragen der API (Auftrag `wiki_kategorien`, Tafeln aus 0226), sondern aus der Datei
--   `dump_categorylinks.sql.gz` des Wikis, die die Vorschau (`wiki_vorschau`) neben dem XML-Dump liest. Wie der Dump wird auch sie gepinnt: Dateiname (nie ein Pfad),
--   Prüfsumme der gepackten Datei, der Stand aus ihrer Endzeile (`-- Dump completed on …`, UTC) und die Zahl ihrer Zeilen. Der Pin ist zugleich das Tor der Übernahme: Ein Bereich
--   mit Kategorien (Orte, Herrschaftsgebiete, Derographie) wird nur übernommen, wenn die Vorschau eine Datei gelesen hat (`kategorien_sha256 IS NOT NULL`).
--
-- 1. `wikisync_lauf`: vier Spalten für den Pin der Vorschau.
-- 2. `wikisync_uebernahme`: drei Spalten, damit das Protokoll einer Übernahme weiß, aus welcher Kategorien-Datei sie übernahm, auch wenn die Vorschau schon abgeräumt ist.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): nur nullbare Spalten, deren CHECKs NULL erlauben; das vorige Release schreibt und liest sie nie. Die Tafeln des Wiki-Teils (0226) bleiben
-- stehen und werden erst im zweiten Release gelöscht (WI-0294 Aufgabe 9), nach dem Stage-Vergleich. Rechte: Die Spalten erben die der Tafeln (Jobs-Rolle schreibt, App liest),
-- `apps/server/src/db/system-grants.psql` bleibt unverändert.

ALTER TABLE wikisync_lauf
    ADD COLUMN IF NOT EXISTS kategorien_datei TEXT CHECK (kategorien_datei IS NULL OR kategorien_datei !~ '[/\\]'),
    ADD COLUMN IF NOT EXISTS kategorien_sha256 TEXT CHECK (kategorien_sha256 IS NULL OR kategorien_sha256 ~ '^[0-9a-f]{64}$'),
    ADD COLUMN IF NOT EXISTS kategorien_stand TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kategorien_zeilen INTEGER CHECK (kategorien_zeilen IS NULL OR kategorien_zeilen >= 0);

ALTER TABLE wikisync_uebernahme
    ADD COLUMN IF NOT EXISTS kategorien_datei TEXT CHECK (kategorien_datei IS NULL OR kategorien_datei !~ '[/\\]'),
    ADD COLUMN IF NOT EXISTS kategorien_sha256 TEXT CHECK (kategorien_sha256 IS NULL OR kategorien_sha256 ~ '^[0-9a-f]{64}$'),
    ADD COLUMN IF NOT EXISTS kategorien_stand TIMESTAMPTZ;

COMMENT ON COLUMN wikisync_lauf.kategorien_sha256 IS
    'Prüfsumme der Kategorien-Datei (dump_categorylinks.sql.gz), aus der die Vorschau Ortsgröße, Bauwerkart und Kontinent rechnete; NULL: keine Datei gelesen (die Bereiche mit Kategorien stehen dann aus) oder ein Lauf vor WI-0294.';
COMMENT ON COLUMN wikisync_lauf.kategorien_stand IS
    'Der Stand der Kategorien-Datei laut Endzeile (-- Dump completed on …), UTC.';

-- 0243: Der WikiSync legt Quellen-Verknüpfungen an und legt sie still (WI-0253 §21; Vali 2026-10-27, Knopfwahl „Anlegen und stilllegen“, vorher §16/§19: nur vergleichen).
--
--   Das Wiki nennt in der Rubrik „Publikationen“ eines Artikels, welche Produkte ihn beschreiben, ergänzen oder erwähnen. Der WikiSync legt für eine neue Nennung die Verknüpfung
--   Träger ↔ Katalogquelle an (fehlt die Quelle, auch sie) und legt eine Verknüpfung still, die belegt aus dem Wiki kam (`legacy_origin = 'wiki_publication'`) und die der Artikel nicht
--   mehr nennt. Eine Verknüpfung der Redaktion, ein Tombstone und eine von der Redaktion gelöste Verknüpfung bleiben, wie sie sind; gelöscht wird nie.
--
--   Wer eine Zeile still gelegt hat, steht in `retired_origin` (`import`: der Legacy-Zug, `editor`: die Redaktion). Der WikiSync ist ein Dritter und bekommt sein Wort: `wikisync`
--   (wie bei der Ortsliste, 0241). Die Rücknahme eines Laufs belebt genau die Zeilen wieder, die der WikiSync still gelegt hat, und legt still, was er anlegte; für eine Quelle, die er
--   anlegte und deren Verknüpfungen alle zurückgenommen sind, gilt dasselbe (`feature_source`).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): gelockerte Prüfungen, jedes bisherige Wort bleibt erlaubt; das vorige Release schreibt das neue nie. Keine Tafel, keine Spalte, keine
-- Datenänderung. Die Rechte der Jobs-Rolle (INSERT an den Verknüpfungen und der Quelle, Stilllegen, der Kanon der Träger) stehen in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE place_source DROP CONSTRAINT IF EXISTS place_source_retired_consistent;
ALTER TABLE place_source
    ADD CONSTRAINT place_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

ALTER TABLE path_source DROP CONSTRAINT IF EXISTS path_source_retired_consistent;
ALTER TABLE path_source
    ADD CONSTRAINT path_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

ALTER TABLE territory_source DROP CONSTRAINT IF EXISTS territory_source_retired_consistent;
ALTER TABLE territory_source
    ADD CONSTRAINT territory_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

ALTER TABLE region_source DROP CONSTRAINT IF EXISTS region_source_retired_consistent;
ALTER TABLE region_source
    ADD CONSTRAINT region_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

ALTER TABLE terrain_peak_source DROP CONSTRAINT IF EXISTS terrain_peak_source_retired_consistent;
ALTER TABLE terrain_peak_source
    ADD CONSTRAINT terrain_peak_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

ALTER TABLE feature_source DROP CONSTRAINT IF EXISTS feature_source_retired_consistent;
ALTER TABLE feature_source
    ADD CONSTRAINT feature_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

COMMENT ON COLUMN feature_source.retired_origin IS
    'Wer die Quelle still gelegt hat: import (der Legacy-Zug) | editor (die Redaktion) | wikisync (die Rücknahme einer Quelle, die der WikiSync angelegt hat, WI-0253 §21, 0243).';

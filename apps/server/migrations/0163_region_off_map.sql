-- 0163: Derographie-Flächen „Von der Karte nehmen“ (WI-0178 D2; EDIT-0004 §2.6, FL6; EDIT-0003 T43, T54; dieselbe Datenform wie Wege 0150
-- und Kraftlinien 0154; Claudio 2026-10-18, `2026-10-18-landschaft-entfernen-antwort-an-claudia.md`).
--
--   1. `region.off_map`: Die Fläche ist von der Karte genommen. Sie bleibt mit Namen, Ebene, Art, Teilflächen und Beschriftungen in den
--      Tafeln und steht im Derographie-Editor unter „Nicht auf der Karte“; ↺ im Verlauf holt sie zurück. Wie bei Wegen ist sie still
--      (`is_active = FALSE`), und ihre Teilflächen und Beschriftungen gehen in derselben Operation mit (`is_active = FALSE`): Kacheln,
--      Suche, Kraftlinienknoten und Gelände lesen nur `is_active` der Teile. „Ganz löschen“ setzt beides FALSE (weich, `landscape.retire`).
--   2. Der Trigger `region_revision` (0137) zählt auch `off_map`: Abnehmen und Zurückholen sind fachliche Änderungen mit Revision.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe `FALSE` (seit PostgreSQL 11 nur ein Katalogeintrag), dazu derselbe
-- Trigger mit einer Spalte mehr. Das vorige Release liest und schreibt die Spalte nie; alle Zeilen sind `FALSE`. Der Landschaften-Zug
-- (`migration/region-import.ts`) schreibt `off_map` nie und setzt `region.is_active = NOT off_map` (zusätzlich zu `region_retirement`),
-- die Teile einer abgenommenen Fläche `is_active = <Legacy aktiv> AND NOT region.off_map`; die Prüfer des Zugs nehmen abgenommene Flächen
-- aus dem Erwartungswert (Claudio, Bedingungen A und B). Die App-Rolle hat an `region`, `region_area` und `map_label` schon UPDATE auf
-- der ganzen Tafel (`apps/server/src/db/map-grants.psql`: nur DELETE und TRUNCATE sind entzogen).

ALTER TABLE region ADD COLUMN IF NOT EXISTS off_map BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN region.off_map IS
    'Von der Karte genommen (WI-0178 D2, landscape.retire mit stage off_map); ↺ (landscape.restore) setzt FALSE. Der Landschaften-Zug schreibt die Spalte nie.';

CREATE OR REPLACE TRIGGER region_revision
    BEFORE UPDATE OF map_domain_id, name, region_layer, region_type, stack_order, is_locked, wiki_url, wiki_region_key,
                     label_curve_enabled, label_curve_max, label_curve_degree, primary_label_id, is_active, off_map, source_system,
                     legacy_public_id, revision
    ON region
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- 0154: Kraftlinien „Von der Karte nehmen“ (WI-0205 K10; EDIT-0003 T43, dieselbe Datenform wie Wege 0150 und Orte).
--
--   1. `powerline.off_map`: der Abschnitt ist von der Karte genommen. Er bleibt mit Lage, Bogen, Enden und Wiki-Zuordnung in der Tafel
--      und steht im Kraftlinien-Editor unter „Nicht auf der Karte“; „Zurück auf die Karte“ holt ihn wieder. Wie bei Wegen ist ein
--      abgenommener Abschnitt still (`is_active = FALSE`): Kacheln, Bögen, Knotenlisten und Prüfungen lesen nur `is_active` und lassen
--      ihn ohne eigene Bedingung aus. „Ganz löschen“ setzt beides FALSE (weich, `powerline.retire`).
--   2. Der Trigger `powerline_revision` (0143) zählt auch `off_map`: Abnehmen und Zurückholen sind fachliche Änderungen mit Revision.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe `FALSE` (seit PostgreSQL 11 nur ein Katalogeintrag, ohne Umschreiben
-- der Tafel), dazu derselbe Trigger mit einer Spalte mehr. Das vorige Release liest und schreibt die Spalte nie; alle Zeilen sind
-- `FALSE`. Der Legacy-Kraftlinienimport (`migration/powerlines.ts`) setzt `is_active = NOT off_map` und schreibt `off_map` nie (wie der
-- Wege-Zug, Claudio 2026-10-17, Bedingung 2); nur die Testwelt setzt es vor dem Zug zurück. Die App-Rolle hat an `powerline` schon
-- UPDATE auf der ganzen Tafel (`apps/server/src/db/map-grants.psql`: nur DELETE und TRUNCATE sind entzogen).

ALTER TABLE powerline ADD COLUMN IF NOT EXISTS off_map BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN powerline.off_map IS
    'Von der Karte genommen (WI-0205 K10, powerline.take_off_map); powerline.put_on_map setzt FALSE. Der Legacy-Kraftlinienimport schreibt die Spalte nie.';

CREATE OR REPLACE TRIGGER powerline_revision
    BEFORE UPDATE OF map_domain_id, name, label_visible, from_public_id, to_public_id, curve, description, geom, is_active, off_map,
                     source_system, legacy_public_id, revision
    ON powerline
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

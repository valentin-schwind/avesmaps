-- 0150: Wege „Von der Karte nehmen“ (WI-0177 Stufe 3b; EDIT-0003 F12 „ja, wie Orte“, T24 (2), T43; Claudios Einschätzung
-- `project-control/handovers/2026-10-17-wege-von-der-karte-nehmen-antwort-an-claudia.md`).
--
--   1. `path.off_map`: der Weg ist von der Karte genommen. Er bleibt mit seiner Linie, Wiki-Zuordnung und Quellen in der Tafel und
--      steht im Wege-Fenster unter „Nicht auf der Karte“; „Zurück auf die Karte“ holt ihn wieder.
--   2. Der Trigger `path_revision` (0091) zählt auch `off_map`: Abnehmen und Zurückholen sind fachliche Änderungen mit Revision.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe `FALSE` (seit PostgreSQL 11 nur ein Katalogeintrag, ohne Umschreiben
-- der Tafel), dazu derselbe Trigger mit einer Spalte mehr. Das vorige Release liest und schreibt die Spalte nie; alle Zeilen sind
-- `FALSE`. Der Legacy-Wegeimport (`migration/paths.ts`) fasst `off_map` nicht an (Claudio, Bedingung 2). Die Rechte der App-Rolle
-- stehen in `apps/server/src/db/map-grants.psql`.

ALTER TABLE path ADD COLUMN IF NOT EXISTS off_map BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN path.off_map IS
    'Von der Karte genommen (WI-0177 Stufe 3b, path.take_off_map); path.put_on_map setzt FALSE. Der Legacy-Wegeimport schreibt die Spalte nie.';

CREATE OR REPLACE TRIGGER path_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, label_visible, is_bach, geom, is_active, off_map, flow_direction, allowed_transports,
                     transport_domain, transport_seasons, flow_factor, source_system, legacy_public_id, revision
    ON path
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- 0258: Der Spracheditor schreibt (WI-0261 S5d; Betreiber 2026-10-30: „intern sind es inhalten -> Auf der Karte -> Sprachen und benötigen auch einen editor“,
-- E4 eigener Spracheditor, O6 Rechte wie die übrigen Inhalte mit Audit).
--
--   1. Das Fachprotokoll (`map_audit_event`) bekommt zwei Ziele (Muster 0234, 0236, 0255): die Sprache (`sprache_public_id`, `sprache.public_id`) und eine
--      ihrer Teilflächen (`sprache_flaeche_public_id`, `sprache_flaeche.public_id`), ohne Fremdschlüssel. Eine Zeile an einer Teilfläche trägt ihre Sprache
--      mit (wie `territory_area` das Gebiet): Der Verlauf einer Sprache ist jede Operation, deren Protokoll sie nennt. Die Aktionen heißen `sprache.*` und
--      `sprache_flaeche.*` (`apps/server/src/sprachen/editor-schreiben.ts`, `editor-flaechen.ts`).
--   2. Die Sperre während der Bearbeitung (`editor_lock`, 0138) und die Bitte um Freigabe (`editor_lock_request`, 0253) kennen die Art `sprache`: Eine
--      Sprache wird als Ganzes gesperrt, ihre Teilflächen haben keine eigene Sperre (der Schreibweg einer Teilfläche verlangt die Sperre ihrer Sprache).
--      Die Bedingungen sind von ihrer GELTENDEN Fassung abgeschrieben (0205 für `editor_lock`, 0253 für `editor_lock_request`, dort ohne eigenen Namen
--      angelegt, Postgres nannte sie `editor_lock_request_object_kind_check`) und nur um das eine Wort erweitert.
--
-- 🔴 ADDITIV („erst erweitern“, `docs/regeln/entwicklung.md`): zwei nullbare Spalten, zwei Teilindizes, drei gelockerte Prüfungen. Das vorige Release setzt
-- die neuen Spalten nie und schreibt das neue Wort nie; was vorher erlaubt war, bleibt erlaubt, jede gespeicherte Zeile besteht die Regeln. Keine
-- Datenänderung, keine neue Tafel, keine neue Sicht.
--
-- Rechte: keine neuen. Die App schreibt `sprache`, `sprache_flaeche` und `sprache_wiki` seit 0254/0255 (`apps/server/src/db/map-grants.psql` nimmt ihr nur
-- DELETE und TRUNCATE) und das Fachprotokoll wie jeder Editor; die Sperren-Tafeln gehören ihr ohnehin.

-- 1. FACHPROTOKOLL ----------------------------------------------------------------------------------------------------------------

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS sprache_public_id UUID;
ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS sprache_flaeche_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id, corpus_public_id, sprache_artikel_public_id,
                     sprache_public_id, sprache_flaeche_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_sprache ON map_audit_event (sprache_public_id, id DESC)
    WHERE sprache_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_audit_event_sprache_flaeche ON map_audit_event (sprache_flaeche_public_id, id DESC)
    WHERE sprache_flaeche_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.sprache_public_id IS
    'Ziel: eine Sprache (WI-0261 S5d, sprache.public_id), ohne Fremdschlüssel; auch an jeder Zeile einer ihrer Teilflächen. Die Aktionen heißen sprache.*.';
COMMENT ON COLUMN map_audit_event.sprache_flaeche_public_id IS
    'Ziel: eine Teilfläche einer Sprache (WI-0261 S5d, sprache_flaeche.public_id), ohne Fremdschlüssel; die Zeile trägt ihre Sprache mit. Die Aktionen heißen sprache_flaeche.*.';

-- 2. SPERRE UND BITTE UM FREIGABE -------------------------------------------------------------------------------------------------

ALTER TABLE editor_lock DROP CONSTRAINT IF EXISTS editor_lock_object_kind_check;
ALTER TABLE editor_lock ADD CONSTRAINT editor_lock_object_kind_check
    CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline', 'peak', 'sprache'));

ALTER TABLE editor_lock_request DROP CONSTRAINT IF EXISTS editor_lock_request_object_kind_check;
ALTER TABLE editor_lock_request ADD CONSTRAINT editor_lock_request_object_kind_check
    CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline', 'peak', 'sprache'));

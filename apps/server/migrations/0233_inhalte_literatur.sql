-- 0233: Literatur im Fenster „Inhalte bearbeiten“ und das Notizfeld der Quellen (WI-0254, Runde 2; Betreiber 2026-10-25: Mockup
-- `review/wi-0254/inhalte-editor-korpora-mockup.html`).
--
-- Der Reiter „Literatur“ schreibt zum ersten Mal an Werken (`adventure`) und ihren geordneten Ortsbezügen (`adventure_place`, 0068). Dafür
-- fehlten drei Dinge, alle ADDITIV (AGENTS.md, „erst erweitern“):
--
--   1. `adventure.revision` (ADR-0020): der gesehene Stand eines Werks. Der Trigger `revision_bump_forward()` (0115) zählt sie bei jeder
--      Änderung einer inhaltlichen Spalte hoch; eine Änderung nur an den Ortsbezügen setzt sie ausdrücklich höher (`revision = revision + 1`,
--      deshalb steht `revision` in der Spaltenliste). Jedes Speichern im Fenster schreibt gegen sie, ein Konflikt ist 409. `migration_run_id`
--      und `imported_at` zählen nicht mit: Ein Zug, der eine Zeile nur bestätigt, stört keinen Entwurf. Die Kennung des Werks ist schon
--      `adventure.public_id` (0068), eine zweite gibt es nicht.
--   2. `adventure.editor_note` und `feature_source.editor_note`: das Feld „Redaktionelle Notiz“ (Werk) und „Kommentar“ (Quelle) des Mockups.
--      Eine Anmerkung der Redaktion für die Redaktion: NULL oder ein Text, den kein öffentlicher Leser liest (kein Subject, kein Katalog, kein
--      Export). Der Trigger der Quelle (0232) bekommt die neue Spalte in seine Liste.
--   3. Das Fachprotokoll der Karte (`map_audit_event`, 0091) kennt das Werk als Ziel (`work_public_id`, ohne Fremdschlüssel: ein Protokoll
--      überlebt seinen Gegenstand), wie die Quelle in 0232. Das Speichern schreibt damit eine Operation (`map_operation`) wie jeder Editor der
--      Karte, und die Leser-Revision (`subjects/revision.ts`, `max(map_operation.seq)`) wechselt: Das Infopanel zeigt das geänderte Werk ohne
--      eigenen Weg.
--
-- 🔴 Importschutz steht nicht hier, sondern im Import (`migration/literature-import.ts`): Ein Werk mit `source_system = 'editor'` fasst der
-- Legacy-Zug samt seinen Ortsbezügen, Links und Herkunftsvermerken weder an noch legt er es still (Ownership auf Werksebene, WI-0254 §10).
-- Der Editor setzt `source_system = 'editor'`, sobald er einen Wert des Werks oder seine Ortsliste ändert oder ein Werk neu anlegt.
-- Feldgenauer Schutz wie in Legacy (`field_origins_json`) ist ein späteres Paket.
--
-- Keine neuen Rechte: Die App-Rolle schreibt die Tafeln über ihr Standardrecht; `apps/server/src/db/map-grants.psql` nimmt ihr DELETE
-- und TRUNCATE (stillgelegt wird, nie gelöscht), die Einordnung für Claudios Vorlage steht in `apps/server/test/support/public-rechte.ts`.

ALTER TABLE adventure ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE adventure ADD COLUMN IF NOT EXISTS editor_note TEXT;
ALTER TABLE feature_source ADD COLUMN IF NOT EXISTS editor_note TEXT;

CREATE OR REPLACE TRIGGER adventure_revision
    BEFORE UPDATE OF wiki_key, wiki_url, title, product_type, edition, bf_year, bf_label, genre, complexity_gm, complexity_pl, is_official,
                     authors, series, fshop_code, link_ulisses, link_fshop, isbn, contained_in, editor_note, state, is_active,
                     source_system, revision
    ON adventure
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

CREATE OR REPLACE TRIGGER feature_source_revision
    BEFORE UPDATE OF source_key, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key, editor_note,
                     is_active, source_system, revision
    ON feature_source
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

COMMENT ON COLUMN adventure.revision IS
    'Fachrevision (ADR-0020): steigt mit jeder Änderung einer inhaltlichen Spalte; eine Änderung nur der Ortsbezüge setzt sie ausdrücklich höher (0233).';
COMMENT ON COLUMN adventure.editor_note IS
    'Redaktionelle Notiz zum Werk (0233): eine Anmerkung der Redaktion für die Redaktion, NULL oder ein Text. Kein öffentlicher Leser liest sie.';
COMMENT ON COLUMN feature_source.editor_note IS
    'Kommentar der Redaktion zur Quelle (0233): NULL oder ein Text. Kein öffentlicher Leser liest ihn.';

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS work_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_work ON map_audit_event (work_public_id, id DESC)
    WHERE work_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.work_public_id IS
    'Ziel: ein Werk der Spielliteratur (WI-0254, adventure.public_id), ohne Fremdschlüssel; die Aktionen heißen work.*.';

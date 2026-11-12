-- 0234: Vorkommen im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 3; Betreiber 2026-10-25: Mockup
-- `review/wi-0254/inhalte-editor-korpora-mockup.html`).
--
-- Der Reiter „Vorkommen“ schreibt zum ersten Mal an Lore-Einträgen (`lore_entry`), ihren Ortszeilen (`lore_place`) und Quellenverknüpfungen
-- (`lore_entry_source`, 0074). Dafür fehlten drei Dinge, alle ADDITIV (AGENTS.md, „erst erweitern“):
--
--   1. `lore_entry.public_id` (UUID) und `lore_entry.revision` (ADR-0020): die Kennung des Eintrags für die Schnittstelle und das Fachprotokoll
--      und der gesehene Stand. 🔴 Die IDENTITÄT bleibt der Wiki-Schlüssel (`wiki_key`, 0074); `public_id` ist nur die Kennung der Schnittstelle (wie
--      `feature_source.public_id` in 0232), kein Schlüssel auf ein Kartenobjekt und nie ein Ersatz für den Wiki-Artikel. Die Vorgabe
--      `gen_random_uuid()` gibt den vorhandenen Zeilen je einen Wert; der Import schreibt die Spalte nie. Der Trigger `revision_bump_forward()`
--      (0115) zählt die Revision bei jeder Änderung einer inhaltlichen Spalte hoch; eine Änderung nur an den Ortszeilen oder Quellenverknüpfungen
--      setzt sie ausdrücklich höher (`revision = revision + 1`, deshalb steht `revision` in der Spaltenliste). Jedes Speichern im Fenster
--      schreibt gegen sie, ein Konflikt ist 409. `migration_run_id` und `imported_at` zählen nicht mit.
--   2. `lore_entry.editor_note`: das Feld „Anmerkung“ des Mockups, eine Anmerkung der Redaktion für die Redaktion; NULL oder ein Text, den kein
--      öffentlicher Leser liest.
--   3. Das Fachprotokoll der Karte (`map_audit_event`, 0091) kennt den Eintrag als Ziel (`lore_public_id`, ohne Fremdschlüssel: ein Protokoll
--      überlebt seinen Gegenstand), wie die Quelle in 0232 und das Werk in 0233. Die Aktionen heißen `lore.*`.
--
-- 🔴 Importschutz steht nicht hier, sondern im Import (`migration/lore-import.ts`): Ein Eintrag mit `source_system = 'editor'` fasst der Legacy-Zug
-- samt Ortszeilen, Regeln, Quellenverknüpfungen und Herkunftsvermerken weder an noch legt er ihn still (Ownership auf Eintragsebene, WI-0254 §10).
-- Der Editor setzt `source_system = 'editor'`, sobald er einen Wert des Eintrags, eine Ortszeile oder eine Quellenverknüpfung ändert. Die ABGELEITETEN
-- Treffer der Ortszeilen (`lore_place_target`) rechnet der Import trotzdem bei jedem Lauf neu, auch für solche Einträge, damit sie nicht veralten.
--
-- Keine neuen Rechte: Die App-Rolle schreibt die Tafeln über ihr Standardrecht; `apps/server/src/db/map-grants.psql` nimmt ihr DELETE und TRUNCATE
-- (stillgelegt wird, nie gelöscht), die Einordnung für Claudios Vorlage steht in `apps/server/test/support/public-rechte.ts`.

ALTER TABLE lore_entry ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS lore_entry_public_id_unique ON lore_entry (public_id);

ALTER TABLE lore_entry ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE lore_entry ADD COLUMN IF NOT EXISTS editor_note TEXT;

CREATE OR REPLACE TRIGGER lore_entry_revision
    BEFORE UPDATE OF wiki_key, kind, name, wiki_title, wiki_url, gruppe, typ, lebensraum, synonyme, continent, match_key, legacy_origin,
                     state, is_active, source_system, editor_note, revision
    ON lore_entry
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

COMMENT ON COLUMN lore_entry.public_id IS
    'Kennung des Eintrags für die Schnittstelle der Redaktion und das Fachprotokoll (0234). Die Identität bleibt wiki_key; die interne id verlässt den Server nicht.';
COMMENT ON COLUMN lore_entry.revision IS
    'Fachrevision (ADR-0020): steigt mit jeder Änderung einer inhaltlichen Spalte; eine Änderung nur der Ortszeilen oder Quellenverknüpfungen setzt sie ausdrücklich höher (0234).';
COMMENT ON COLUMN lore_entry.editor_note IS
    'Anmerkung der Redaktion zum Eintrag (0234): NULL oder ein Text. Kein öffentlicher Leser liest sie.';

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS lore_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_lore ON map_audit_event (lore_public_id, id DESC)
    WHERE lore_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.lore_public_id IS
    'Ziel: ein Lore-Eintrag (Vorkommen; WI-0254, lore_entry.public_id), ohne Fremdschlüssel; die Aktionen heißen lore.*.';

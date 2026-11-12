-- 0232: Quellen im Fenster „Inhalte bearbeiten“ (WI-0254; Betreiber 2026-10-25: Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`).
--
-- Der Reiter „Quellen“ schreibt zum ersten Mal an den Katalogquellen (`feature_source`) und an ihren Verknüpfungen (`<träger>_source`,
-- 0066). Dafür fehlten drei Dinge, alle ADDITIV (AGENTS.md, „erst erweitern“):
--
--   1. `feature_source.public_id` (UUID): die Kennung der Quelle für die Schnittstelle und das Fachprotokoll. Die Identität bleibt
--      `source_key` (Hash der Adresse oder Wiki-Schlüssel, 0066); die interne `id` verlässt den Server nicht. Die Spalte bekommt für die
--      vorhandenen Zeilen je einen Wert (Vorgabe `gen_random_uuid()`), der Import schreibt sie nie.
--   2. `feature_source.revision` (ADR-0020): der gesehene Stand einer Quelle. Der Trigger `revision_bump_forward()` (0115) zählt sie bei
--      jeder Änderung einer redaktionellen Spalte hoch; eine Änderung nur an den Verknüpfungen der Quelle setzt sie ausdrücklich höher
--      (`revision = revision + 1`, `revision` steht deshalb in der Spaltenliste). Jedes Speichern im Fenster schreibt gegen sie, ein
--      Konflikt ist 409. `migration_run_id` und `imported_at` zählen nicht mit: Ein Zug, der eine Zeile nur bestätigt, stört keinen Entwurf.
--   3. Das Fachprotokoll der Karte (`map_audit_event`, 0091) kennt die Quelle als Ziel (`source_public_id`, ohne Fremdschlüssel: ein
--      Protokoll überlebt seinen Gegenstand), wie den Gipfel in 0205. Damit schreibt das Speichern eine Operation (`map_operation`) wie
--      jeder Editor der Karte, und die Leser-Revision (`subjects/revision.ts`, `max(map_operation.seq)`) wechselt: Infopanel und Links
--      zeigen die geänderte Quelle ohne eigenen Weg.
--
-- 🔴 Importschutz steht nicht hier, sondern im Import (`migration/sources-import.ts`, `protectedWhere`): Eine Zeile mit
-- `source_system <> 'legacy'` fasst der Legacy-Zug weder an noch legt er sie still. Der Editor setzt `source_system = 'editor'`, sobald er
-- einen Wert der Quelle selbst ändert oder eine Quelle oder Verknüpfung neu anlegt (Kapitel 9.37: manuell schlägt Wiki).
--
-- Keine neuen Rechte: Die App-Rolle schreibt die Tafeln über ihr Standardrecht; `apps/server/src/db/map-grants.psql` nimmt ihr DELETE
-- und TRUNCATE (stillgelegt wird, nie gelöscht), die Einordnung für Claudios Vorlage steht in `apps/server/test/support/public-rechte.ts`.

ALTER TABLE feature_source ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS feature_source_public_id_unique ON feature_source (public_id);

ALTER TABLE feature_source ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE TRIGGER feature_source_revision
    BEFORE UPDATE OF source_key, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key,
                     is_active, source_system, revision
    ON feature_source
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

COMMENT ON COLUMN feature_source.public_id IS
    'Kennung der Quelle für die Schnittstelle der Redaktion und das Fachprotokoll (0232). Die Identität bleibt source_key; die interne id verlässt den Server nicht.';
COMMENT ON COLUMN feature_source.revision IS
    'Fachrevision (ADR-0020): steigt mit jeder Änderung einer redaktionellen Spalte; eine Änderung nur der Verknüpfungen setzt sie ausdrücklich höher (0232).';

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS source_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_source ON map_audit_event (source_public_id, id DESC)
    WHERE source_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.source_public_id IS
    'Ziel: eine Katalogquelle (WI-0254, feature_source.public_id), ohne Fremdschlüssel; die Aktionen heißen source.*.';

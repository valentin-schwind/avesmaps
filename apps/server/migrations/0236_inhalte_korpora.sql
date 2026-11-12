-- 0236: Korpora im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 4; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`; Vali: „Belegstellen-Korpus
-- ja, wenn ich da was änder, änderts überall, was den Korpus verwendet“).
--
-- Der Reiter „Korpora“ schreibt zum ersten Mal an `source_corpus` (0066). Dafür fehlten fünf Dinge, alle ADDITIV (AGENTS.md, „erst erweitern“):
--
--   1. `source_corpus.public_id` (UUID) und `.revision` (ADR-0020): die Kennung des Korpus für die Schnittstelle und das Fachprotokoll und der gesehene
--      Stand. 🔴 Die IDENTITÄT bleibt der Schlüssel, die registrierbare Domain (`corpus_key`, 0066, unveränderlich); `public_id` ist nur die Kennung der
--      Schnittstelle (wie `feature_source.public_id` in 0232). Der Trigger `revision_bump_forward()` (0115) zählt die Revision bei jeder Änderung einer
--      inhaltlichen Spalte hoch.
--   2. `source_corpus.source_type` und `.is_official`: die Vorgabe des Korpus für Art und „offiziell“ seiner Quellen (NULL = keine Vorgabe). Lizenz und
--      Namensnennung hat der Korpus seit 0066 (`license_statement`, `license_key`, `attribution`; „nicht erfasst“ ist nie eine Vorgabe).
--   3. `source_corpus.editor_note`: die „Redaktionelle Notiz“ des Mockups; kein öffentlicher Leser liest sie.
--   4. Das Fachprotokoll der Karte (`map_audit_event`, 0091) kennt den Korpus als Ziel (`corpus_public_id`, ohne Fremdschlüssel), wie die Quelle in
--      0232, das Werk in 0233 und das Vorkommen in 0234. Die Aktionen heißen `corpus.*`.
--
-- 🔴 WIRKUNG (Vali, WI-0254 §5): Bei einem Korpus mit der Anzeigeform `belegstelle` schreibt eine Änderung an Art, „offiziell“, Lizenz oder Namensnennung auf ALLE
-- Quellen der Domain durch; Ausnahmen je Quelle gibt es nicht („überall heißt überall“). Bei `werk` und unentschiedener Form schreibt nichts durch: Die
-- Felder bleiben an der Quelle. Das Durchschreiben ist EINE Operation mit Revision, 409 und Protokoll (`korpora-schreiben.ts`); der Legacy-Zug rechnet die
-- Vorgabe nach dem Abgleich erneut auf die Quellen (`migration/sources-import.ts`), statt Quellen einzeln zu sperren. Ein Korpus, den die Redaktion angelegt
-- oder geändert hat, trägt `source_system = 'editor'` und gehört ihr (der Import fasst ihn nie an, `protectedWhere`).
--
-- Keine neuen Rechte: Die App-Rolle schreibt die Tafel über ihr Standardrecht; `apps/server/src/db/map-grants.psql` nimmt ihr DELETE und TRUNCATE.

ALTER TABLE source_corpus ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS source_corpus_public_id_unique ON source_corpus (public_id);

ALTER TABLE source_corpus ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE source_corpus ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE source_corpus ADD COLUMN IF NOT EXISTS is_official BOOLEAN;
ALTER TABLE source_corpus ADD COLUMN IF NOT EXISTS editor_note TEXT;

ALTER TABLE source_corpus
    ADD CONSTRAINT source_corpus_source_type_known CHECK (
        source_type IS NULL OR source_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch', 'sonstiges'
        )
    );

CREATE OR REPLACE TRIGGER source_corpus_revision
    BEFORE UPDATE OF label, form, license_statement, license_key, attribution, source_type, is_official, editor_note, is_active, source_system, revision
    ON source_corpus
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

COMMENT ON COLUMN source_corpus.public_id IS
    'Kennung des Korpus für die Schnittstelle der Redaktion und das Fachprotokoll (0236). Die Identität bleibt corpus_key, die registrierbare Domain; die interne Zeile verlässt den Server nie.';
COMMENT ON COLUMN source_corpus.revision IS
    'Fachrevision (ADR-0020): steigt mit jeder Änderung einer inhaltlichen Spalte (0236). Jedes Speichern im Fenster schreibt gegen sie, ein Konflikt ist 409.';
COMMENT ON COLUMN source_corpus.source_type IS
    'Vorgabe des Korpus für die Art seiner Quellen (0236); NULL = keine Vorgabe. Wirkt nur bei form = belegstelle: dann schreibt eine Änderung auf alle Quellen der Domain durch.';
COMMENT ON COLUMN source_corpus.is_official IS
    'Vorgabe des Korpus für „offiziell“ seiner Quellen (0236); NULL = nicht eingestuft. Wirkt nur bei form = belegstelle (siehe source_type).';
COMMENT ON COLUMN source_corpus.editor_note IS
    'Redaktionelle Notiz zum Korpus (0236): NULL oder ein Text. Kein öffentlicher Leser liest sie.';

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS corpus_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id, corpus_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_corpus ON map_audit_event (corpus_public_id, id DESC)
    WHERE corpus_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.corpus_public_id IS
    'Ziel: ein Korpus (WI-0254, source_corpus.public_id), ohne Fremdschlüssel; die Aktionen heißen corpus.*.';

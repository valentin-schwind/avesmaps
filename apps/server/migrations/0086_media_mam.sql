-- Das additive MAM-Datenmodell (WI-0068 P1, Abschnitt 18 „P1 geschärft“; ADR-0019, ADR-0020, AUTH-0001 §7.2).
--
-- 🔴 Nur die fehlenden Konzepte, ADDITIV (AGENTS.md „erst erweitern, dann umstellen, dann entfernen“): neue Tabellen, neue nullbare
-- Spalten oder Spalten mit DEFAULT, Trigger, gelockerte oder erweiterte Bedingungen. Das vorige Release liest und schreibt weiter, ohne
-- eine dieser Spalten zu kennen. Rollenneutral: KEIN Recht in dieser Datei. Was die App-Rolle an den neuen Tabellen NICHT darf, steht in
-- `apps/server/src/db/media-grants.psql` (Vorlage für Claudios `avesmaps3d-db-grants`).
--
-- Was hier entsteht:
--   1. Fachrevision (ADR-0020) an Asset, Rechten, Entstehung, Galerie, Galerieeintrag, den fünf Bindungen und den Freigaberegeln. Ein
--      Schreibpfad ändert nur `WHERE revision = $baseRevision` und erkennt so den Bearbeitungskonflikt (409 `edit_conflict`).
--   2. Titel am Asset; die Galerie als Objekt (Titel, Cover, Veröffentlichungszustand, Herkunft, Art `editorial`).
--   3. Entscheidungen einer Person neben dem Betreiberzitat: Einzelfreigabe, Rechteprüfung, Freigaberegel.
--   4. Provenienz `media_ingest`: wer oder was ein Asset hereinbrachte. Der Hochlader ist nie der Urheber (WI-0068 §2 Nr. 5).
--   5. Speicher für Operation und Fachprotokoll der Medien (`media_operation`, `media_audit_event`; ADR-0019 Nr. 3: „Fachdomänen legen
--      ihre Speicherstelle mit ihrem ersten Schreibpfad fest“). `avesmaps_auth.security_event` bleibt der Anmeldung und Verwaltung.
--   6. Der Einzelbild-Notaus als Zustand mit Grund, Person, Zeit und Wiederfreigabe (`media_publication_suspension`, Capability
--      `suspend_media_publication`, Betreiber 2026-10-10 zu WI-0119 F2). Er gilt dem Bild, also den Bytes, nicht der Stelle, und kein
--      Import hebt ihn auf (Betreiber 2026-10-10 zu SYS-0001 Fragen 2 und 3).
--
-- Bewusst NICHT hier: Einreichungen (`media_submission`, P8), 3D-Platzierung (WI-0020), Suchindizes, keine generische
-- `entity_type`-Relation. Kein Leser und kein Schreiber der Anwendung nutzt das Neue in diesem Release; Resolver und Policy bleiben, wie
-- sie sind. Der Notaus wirkt erst mit dem Paket, das auch die Datei aus `published/` nimmt (Claudio, Handover
-- `2026-10-10-wi0119-systemzustand-antwort.md` §5).
--
-- Personen: Fachtabellen verweisen nur über die pseudonyme `person.id` (UUID), OHNE Fremdschlüssel ins Schema `avesmaps_auth` (AUTH-0001
-- §5, wie `job.actor_ref`). Personen werden nie hart gelöscht; ihre Namen löst die Anwendung auf.

-- 1. FACHREVISION ---------------------------------------------------------------------------------------------------------------------
--
-- `revision` zählt allein der Trigger `public.revision_bump()` aus 0079 (er setzt auch `updated_at`); die Anwendung schreibt sie nie.

ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE media_rights ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE media_creation ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE media_gallery ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE media_gallery_item ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE place_media ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE territory_media ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE adventure_media ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE citymap_media ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE place_media_gallery ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE publication_rule ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

-- Der Titel des Werks (§3.2 sucht nach Titel). NULL: die Oberfläche zeigt den aus der Verwendung abgeleiteten Namen („Gareth · Wappen“).
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE media_asset
    DROP CONSTRAINT IF EXISTS media_asset_title_not_blank,
    ADD CONSTRAINT media_asset_title_not_blank CHECK (title IS NULL OR btrim(title) <> '');

-- Am Asset zählen nur die fachlichen Spalten (Muster 0080 an `person`): Der Binärimport schreibt `technical_state`, der Medienzug
-- `migration_run_id`; beides darf einem Editor, der gerade Titel oder Entstehung bearbeitet, keinen Bearbeitungskonflikt bescheren.
-- `revision` steht selbst in der Liste: Wer sie setzen will, zählt stattdessen hoch.
CREATE OR REPLACE TRIGGER media_asset_revision
    BEFORE UPDATE OF title, media_kind, origin, creation_method, degraded_original, moderation_state, ingest_actor_legacy,
        legacy_uploaded_at, stamp_semantics, revision
    ON media_asset
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER media_rights_revision BEFORE UPDATE ON media_rights
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER media_creation_revision BEFORE UPDATE ON media_creation
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER media_gallery_revision BEFORE UPDATE ON media_gallery
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER media_gallery_item_revision BEFORE UPDATE ON media_gallery_item
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER place_media_revision BEFORE UPDATE ON place_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER territory_media_revision BEFORE UPDATE ON territory_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER adventure_media_revision BEFORE UPDATE ON adventure_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER citymap_media_revision BEFORE UPDATE ON citymap_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER place_media_gallery_revision BEFORE UPDATE ON place_media_gallery
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
CREATE OR REPLACE TRIGGER publication_rule_revision BEFORE UPDATE ON publication_rule
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- Die Reihenfolge gehört der Galerie (§9: „Reihenfolge ist stabil und revisionsgeschützt“). Jede Änderung an einem Eintrag (anlegen,
-- umsortieren, Bildunterschrift, Freigabe, Rückzug, löschen) zählt auch die Revision SEINER Galerie hoch. So schützt EINE
-- `baseRevision` der Galerie das Umsortieren der ganzen Folge, auch gegen einen Reimport, der die Folge zwischendurch geändert hat.
-- Mit den Rechten des Besitzers und festem Suchpfad wie die Trigger in 0064 (render-grants.test.ts): Sie berührt nur
-- `updated_at` der Galerie des Eintrags, den der Aufrufer gerade ändern durfte.
CREATE OR REPLACE FUNCTION media_gallery_item_touches_gallery() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE media_gallery SET updated_at = now() WHERE id = NEW.gallery_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE media_gallery SET updated_at = now() WHERE id = OLD.gallery_id;
    ELSE
        UPDATE media_gallery SET updated_at = now() WHERE id = OLD.gallery_id;
        IF NEW.gallery_id IS DISTINCT FROM OLD.gallery_id THEN
            UPDATE media_gallery SET updated_at = now() WHERE id = NEW.gallery_id;
        END IF;
    END IF;
    RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER media_gallery_item_touches_gallery
    AFTER INSERT OR UPDATE OR DELETE ON media_gallery_item
    FOR EACH ROW EXECUTE FUNCTION media_gallery_item_touches_gallery();

-- 2. DIE GALERIE ALS OBJEKT (§9) ------------------------------------------------------------------------------------------------------
--
-- `origin`: wem die Folge gehört. `legacy` schreibt der Medienimport in jedem Lauf aus Legacy nach; eine Galerie, die ein Editor
-- angefasst hat (`editor`), lässt er stehen (der Import liest die Spalte erst mit P6, bis dahin setzt sie niemand). Die Vorgabe
-- `legacy` gilt für alles, was das vorige Release anlegt.
-- `publication_state`: ganze Galerie sichtbar (`published`), noch nicht (`draft`, für neue redaktionelle Galerien) oder gesperrt
-- (`suppressed`). Die Vorgabe `published` entspricht dem heutigen Verhalten der Ortsgalerien; über jedes Bild entscheidet weiter die
-- Policy je Eintrag.
-- `cover_item_id`: das Cover ist ein EINTRAG dieser Galerie, nie ein unabhängiges Bild (§9 „Cover verweist bevorzugt auf ein Gallery
-- Item“); NULL heißt: die Oberfläche nimmt den ersten Eintrag.
ALTER TABLE media_gallery
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS cover_item_id BIGINT,
    ADD COLUMN IF NOT EXISTS publication_state TEXT NOT NULL DEFAULT 'published',
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'legacy';

-- `editorial` kommt dazu (§9); `photobox` erst mit P8. Erweitern verträgt das vorige Release, es schreibt nur `object_gallery`.
ALTER TABLE media_gallery
    DROP CONSTRAINT IF EXISTS media_gallery_kind_known,
    ADD CONSTRAINT media_gallery_kind_known CHECK (gallery_kind IN ('object_gallery', 'editorial')),
    DROP CONSTRAINT IF EXISTS media_gallery_title_not_blank,
    ADD CONSTRAINT media_gallery_title_not_blank CHECK (title IS NULL OR btrim(title) <> ''),
    DROP CONSTRAINT IF EXISTS media_gallery_publication_state_known,
    ADD CONSTRAINT media_gallery_publication_state_known CHECK (publication_state IN ('draft', 'published', 'suppressed')),
    DROP CONSTRAINT IF EXISTS media_gallery_origin_known,
    ADD CONSTRAINT media_gallery_origin_known CHECK (origin IN ('legacy', 'editor'));

-- Das Cover gehört zur selben Galerie: Fremdschlüssel über (Eintrag, Galerie). Wird der Eintrag doch einmal hart gelöscht, fällt nur das
-- Cover weg, nicht die Galerie.
ALTER TABLE media_gallery DROP CONSTRAINT IF EXISTS media_gallery_cover_in_gallery;
ALTER TABLE media_gallery_item
    DROP CONSTRAINT IF EXISTS media_gallery_item_id_gallery_unique,
    ADD CONSTRAINT media_gallery_item_id_gallery_unique UNIQUE (id, gallery_id);
ALTER TABLE media_gallery
    ADD CONSTRAINT media_gallery_cover_in_gallery FOREIGN KEY (cover_item_id, id)
        REFERENCES media_gallery_item (id, gallery_id) ON DELETE SET NULL (cover_item_id);

COMMENT ON COLUMN media_gallery.origin IS
    'Wem die Folge gehört: legacy (der Medienimport gleicht sie ab) oder editor (der Import lässt sie stehen, ab P6).';
COMMENT ON COLUMN media_gallery.cover_item_id IS
    'Das Cover als Eintrag DIESER Galerie (Fremdschlüssel über Eintrag und Galerie). NULL: der erste Eintrag ist Vorgabe der Oberfläche.';
COMMENT ON COLUMN media_gallery.publication_state IS
    'draft | published | suppressed für die ganze Galerie. Über jedes Bild entscheidet weiter die Policy je Eintrag.';

-- 3. ENTSCHEIDUNGEN EINER PERSON ------------------------------------------------------------------------------------------------------
--
-- Eine Einzelfreigabe (`approved`) stammte bisher nur vom Betreiber, mit wörtlichem Zitat. Mit dem MAM gibt sie eine Person mit
-- `publish_media` frei: Datum UND (Zitat ODER Person). Gelockert, nie verschärft: alles, was das vorige Release schreibt, besteht weiter.

ALTER TABLE place_media
    ADD COLUMN IF NOT EXISTS override_decided_by UUID,
    ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE place_media
    DROP CONSTRAINT IF EXISTS place_media_approved_has_decision,
    ADD CONSTRAINT place_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (
            override_decided_on IS NOT NULL
            AND (btrim(coalesce(override_operator_quote, '')) <> '' OR override_decided_by IS NOT NULL)
        )
    ),
    DROP CONSTRAINT IF EXISTS place_media_decided_by_has_date,
    ADD CONSTRAINT place_media_decided_by_has_date CHECK (override_decided_by IS NULL OR override_decided_on IS NOT NULL);

ALTER TABLE territory_media
    ADD COLUMN IF NOT EXISTS override_decided_by UUID,
    ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE territory_media
    DROP CONSTRAINT IF EXISTS territory_media_approved_has_decision,
    ADD CONSTRAINT territory_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (
            override_decided_on IS NOT NULL
            AND (btrim(coalesce(override_operator_quote, '')) <> '' OR override_decided_by IS NOT NULL)
        )
    ),
    DROP CONSTRAINT IF EXISTS territory_media_decided_by_has_date,
    ADD CONSTRAINT territory_media_decided_by_has_date CHECK (override_decided_by IS NULL OR override_decided_on IS NOT NULL);

ALTER TABLE adventure_media
    ADD COLUMN IF NOT EXISTS override_decided_by UUID,
    ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE adventure_media
    DROP CONSTRAINT IF EXISTS adventure_media_approved_has_decision,
    ADD CONSTRAINT adventure_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (
            override_decided_on IS NOT NULL
            AND (btrim(coalesce(override_operator_quote, '')) <> '' OR override_decided_by IS NOT NULL)
        )
    ),
    DROP CONSTRAINT IF EXISTS adventure_media_decided_by_has_date,
    ADD CONSTRAINT adventure_media_decided_by_has_date CHECK (override_decided_by IS NULL OR override_decided_on IS NOT NULL);

ALTER TABLE citymap_media
    ADD COLUMN IF NOT EXISTS override_decided_by UUID,
    ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE citymap_media
    DROP CONSTRAINT IF EXISTS citymap_media_approved_has_decision,
    ADD CONSTRAINT citymap_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (
            override_decided_on IS NOT NULL
            AND (btrim(coalesce(override_operator_quote, '')) <> '' OR override_decided_by IS NOT NULL)
        )
    ),
    DROP CONSTRAINT IF EXISTS citymap_media_decided_by_has_date,
    ADD CONSTRAINT citymap_media_decided_by_has_date CHECK (override_decided_by IS NULL OR override_decided_on IS NOT NULL);

ALTER TABLE media_gallery_item
    ADD COLUMN IF NOT EXISTS override_decided_by UUID,
    ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE media_gallery_item
    DROP CONSTRAINT IF EXISTS media_gallery_item_approved_has_decision,
    ADD CONSTRAINT media_gallery_item_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (
            override_decided_on IS NOT NULL
            AND (btrim(coalesce(override_operator_quote, '')) <> '' OR override_decided_by IS NOT NULL)
        )
    ),
    DROP CONSTRAINT IF EXISTS media_gallery_item_decided_by_has_date,
    ADD CONSTRAINT media_gallery_item_decided_by_has_date CHECK (override_decided_by IS NULL OR override_decided_on IS NOT NULL);

COMMENT ON COLUMN place_media.override_decided_by IS
    'INTERN: person.id der Person, die die Einzelfreigabe oder -sperre entschied (neben dem Betreiberzitat). Gilt ebenso an territory_media, adventure_media, citymap_media und media_gallery_item.';
COMMENT ON COLUMN place_media.override_reason IS 'INTERN: Begründung der Einzelentscheidung, nie öffentlich.';

-- Die Rechteprüfung durch eine Person (D5: „nie das eigene Hochgeladene“ vergleicht sie mit `media_ingest.actor_person_id`). Der Text
-- `reviewed_by` bleibt für Legacy und das vorige Release.
ALTER TABLE media_rights ADD COLUMN IF NOT EXISTS reviewed_by_person UUID;
ALTER TABLE media_rights
    DROP CONSTRAINT IF EXISTS media_rights_reviewer_has_date,
    ADD CONSTRAINT media_rights_reviewer_has_date CHECK (reviewed_by_person IS NULL OR reviewed_at IS NOT NULL);

COMMENT ON COLUMN media_rights.reviewed_by_person IS
    'INTERN: person.id des Rechteprüfers (ohne Fremdschlüssel ins Schema avesmaps_auth). reviewed_by bleibt Text für Legacy.';

-- Freigaberegeln legt nur der Betreiber an oder widerruft sie (`manage_media_rules`, Stufe S); das Zitat bleibt Pflicht.
ALTER TABLE publication_rule
    ADD COLUMN IF NOT EXISTS decided_by_person UUID,
    ADD COLUMN IF NOT EXISTS revoked_by_person UUID;
ALTER TABLE publication_rule
    DROP CONSTRAINT IF EXISTS publication_rule_revoker_needs_revocation,
    ADD CONSTRAINT publication_rule_revoker_needs_revocation CHECK (revoked_by_person IS NULL OR revoked_on IS NOT NULL);

COMMENT ON COLUMN publication_rule.decided_by_person IS
    'INTERN: person.id des Betreibers, der die Regel im MAM anlegte (manage_media_rules). NULL bei Regeln aus dem Seed-Skript.';

-- 4. PROVENIENZ: media_ingest (§5) ----------------------------------------------------------------------------------------------------
--
-- Wer oder was ein Asset hereinbrachte, je Asset eine oder mehrere Zeilen (ein späteres Ersetzen der Quelle ist ein neuer Ingest).
-- Unveränderlich (§2 Nr. 7): die App-Rolle darf nur anhängen (media-grants.psql). Getrennt von Urheber (`media_rights.creator`),
-- Rechteinhaber, letztem Bearbeiter (Fachprotokoll) und Rechteprüfer (`media_rights.reviewed_by_person`).
--
-- 🔴 Ein Legacy-Login ist nie ein Konto (§2 Nr. 8): `legacy_import` trägt den Login nur als Text (`legacy_actor_label`) und NIE eine
-- `actor_person_id`; ein Mapping auf ein Konto steht, wenn beweisbar, in `avesmaps_auth.legacy_identity`.
-- Zwei Releases (AGENTS.md): Login und Stempel stehen bis zum Schritt „entfernen“ AUCH noch am Asset (`ingest_actor_legacy`,
-- `legacy_uploaded_at`, `stamp_semantics`); der Medienimport schreibt beide Stellen gleich (einmal übernommen, nie neu geschrieben).
CREATE TABLE IF NOT EXISTS media_ingest (
    id BIGSERIAL PRIMARY KEY,
    -- Ein Ingest gehört zu seinem Asset; fällt das Asset einmal endgültig weg (`delete_media`), fällt er mit. Das Fachprotokoll bleibt.
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id) ON DELETE CASCADE,
    ingest_kind TEXT NOT NULL,
    -- Der Hochlader als pseudonyme person.id (Editor-Upload); nie bei legacy_import.
    actor_person_id UUID,
    -- Der Medienzug als Akteur (legacy_import): der Lauf, der das Asset anlegte.
    migration_run_id UUID REFERENCES migration_run (id),
    -- INTERN: Legacys `uploaded_by` als Text, Legacys Hochladestempel und was er bedeutet (Ortsbilder: die letzte Einstufung).
    legacy_actor_label TEXT,
    legacy_uploaded_at TIMESTAMPTZ,
    legacy_stamp_semantics TEXT,
    -- Die Einreichung, aus der ein Community-Upload wurde; Fremdschlüssel mit P8 (`media_submission`).
    submission_id BIGINT,
    source_system TEXT,
    source_ref TEXT,
    -- INTERN: der Dateiname des Hochladers, nur zur Anzeige im MAM; nie Identität, nie Speicherschlüssel, nie ein Pfad.
    original_filename TEXT,
    -- Wann das Asset in Avesmaps3D ankam (beim Legacy-Import: der Lauf, nicht Legacys Hochladestempel).
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_ingest_kind_known CHECK (
        ingest_kind IN ('editor_upload', 'community_upload', 'legacy_import', 'wiki_import', 'system_import', 'generated')
    ),
    CONSTRAINT media_ingest_editor_has_person CHECK (ingest_kind <> 'editor_upload' OR actor_person_id IS NOT NULL),
    CONSTRAINT media_ingest_legacy_has_run CHECK (ingest_kind <> 'legacy_import' OR migration_run_id IS NOT NULL),
    CONSTRAINT media_ingest_legacy_no_person CHECK (ingest_kind <> 'legacy_import' OR actor_person_id IS NULL),
    CONSTRAINT media_ingest_community_has_submission CHECK (ingest_kind <> 'community_upload' OR submission_id IS NOT NULL),
    CONSTRAINT media_ingest_legacy_fields_only_legacy CHECK (
        ingest_kind = 'legacy_import'
        OR (legacy_actor_label IS NULL AND legacy_uploaded_at IS NULL AND legacy_stamp_semantics IS NULL)
    ),
    CONSTRAINT media_ingest_stamp_semantics_known CHECK (
        legacy_stamp_semantics IS NULL OR legacy_stamp_semantics IN ('upload', 'last_classification')
    ),
    CONSTRAINT media_ingest_filename_plain CHECK (
        original_filename IS NULL
        OR (
            btrim(original_filename) <> ''
            AND char_length(original_filename) <= 255
            AND position('/' IN original_filename) = 0
            AND position(chr(92) IN original_filename) = 0
        )
    ),
    CONSTRAINT media_ingest_source_system_not_blank CHECK (source_system IS NULL OR btrim(source_system) <> ''),
    CONSTRAINT media_ingest_source_ref_not_blank CHECK (source_ref IS NULL OR btrim(source_ref) <> '')
);

CREATE INDEX IF NOT EXISTS media_ingest_asset ON media_ingest (media_asset_id);
-- Genau EIN Legacy-Ingest je Asset: Idempotenz der Übernahme unten und des Medienimports.
CREATE UNIQUE INDEX IF NOT EXISTS media_ingest_one_legacy_import ON media_ingest (media_asset_id)
    WHERE ingest_kind = 'legacy_import';
CREATE INDEX IF NOT EXISTS media_ingest_actor ON media_ingest (actor_person_id) WHERE actor_person_id IS NOT NULL;

COMMENT ON TABLE media_ingest IS
    'INTERN: wer oder was ein Asset hereinbrachte (WI-0068 §5). Uploader ist nicht Urheber; nur anhängen. Lesen nur mit view_media_private.';
COMMENT ON COLUMN media_ingest.actor_person_id IS
    'INTERN: person.id des Hochladers (ohne Fremdschlüssel ins Schema avesmaps_auth). Nie bei legacy_import: ein Legacy-Login ist kein Konto.';
COMMENT ON COLUMN media_ingest.legacy_actor_label IS
    'INTERN, nie öffentlich: Legacys uploaded_by als Text. Einmal übernommen, nie neu geschrieben.';
COMMENT ON COLUMN media_ingest.original_filename IS
    'INTERN: Dateiname des Hochladers, nur Anzeige. Nie Identität, nie Speicherschlüssel, nie ein Pfad.';

-- Die vorhandenen Legacy-Assets bekommen je eine Zeile `legacy_import` mit dem Medienzug als Akteur. Der anlegende Lauf ist der mit
-- demselben Transaktionsbeginn (`imported_at` und `migration_run.started_at` sind beide `now()` der einen Importtransaktion); fehlt er,
-- der letzte Lauf am Asset. Login und Stempel wie am Asset; nichts wird erfunden (0 von 2.484 tragen sie bis Export B).
-- BACKFILL-BEGIN (media-mam-schema.test.ts führt genau diese Anweisung noch einmal aus)
INSERT INTO media_ingest (
    media_asset_id, ingest_kind, migration_run_id, legacy_actor_label, legacy_uploaded_at, legacy_stamp_semantics, source_system,
    source_ref, ingested_at
)
SELECT
    a.id,
    'legacy_import',
    coalesce(
        (
            SELECT r.id
            FROM migration_run r
            WHERE r.data_domain = 'media' AND r.source_system = a.source_system AND r.started_at = a.imported_at
            ORDER BY r.id
            LIMIT 1
        ),
        a.migration_run_id
    ),
    a.ingest_actor_legacy,
    a.legacy_uploaded_at,
    a.stamp_semantics,
    a.source_system,
    a.source_ref,
    coalesce(a.imported_at, a.ingested_at)
FROM media_asset a
WHERE a.source_system = 'avesmaps-legacy' AND a.migration_run_id IS NOT NULL
ON CONFLICT (media_asset_id) WHERE ingest_kind = 'legacy_import' DO NOTHING;
-- BACKFILL-END

-- 5. OPERATION UND FACHPROTOKOLL (ADR-0019) ------------------------------------------------------------------------------------------
--
-- `media_operation`: eine Zeile je WIRKSAMER Operation, in derselben Transaktion wie die Änderung. Kennung, Hash des Inhalts und
-- Quittung stehen so, dass `runOperation` (apps/server/src/auth/operations.ts) sie mit einer austauschbaren Speicherstelle lesen und
-- schreiben kann, wie heute in `security_event`: dieselbe Kennung mit demselben Hash ergibt die gespeicherte Quittung (`replayed`), mit
-- anderem Hash 409 `idempotency_key_reused`; zwei gleichzeitige Anfragen scheitern am Primärschlüssel (23505), die zweite liest die
-- Quittung der ersten. Dauerhaft aufbewahrt (ADR-0019 Nr. 3: mindestens 24 Stunden; hier hängt das Fachprotokoll daran).
CREATE TABLE IF NOT EXISTS media_operation (
    operation_id UUID PRIMARY KEY,
    -- SHA-256 des Anfrageinhalts ohne Geheimnisse (`requestHash` in operations.ts).
    request_hash BYTEA NOT NULL,
    -- Die Quittung der ersten Ausführung (`OperationReceipt`, Status `applied`).
    receipt JSONB NOT NULL,
    -- Die benannte Operation (§14), etwa `gallery.reorder`; der Katalog lebt im Code.
    action TEXT NOT NULL,
    environment TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    -- Die pseudonyme person.id des Handelnden; nur bei actor_kind = person.
    actor_person_id UUID,
    -- Kommandozeile oder System: eine Bezeichnung des Werkzeugs, nie der Name einer Person.
    actor_label TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_operation_hash_sha256 CHECK (octet_length(request_hash) = 32),
    CONSTRAINT media_operation_receipt_applied CHECK (
        jsonb_typeof(receipt) = 'object'
        AND receipt ->> 'operationId' = operation_id::text
        AND receipt ->> 'status' = 'applied'
    ),
    CONSTRAINT media_operation_action_format CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT media_operation_environment_known CHECK (environment IN ('development', 'staging', 'production', 'test')),
    CONSTRAINT media_operation_actor_kind_known CHECK (actor_kind IN ('person', 'cli', 'system', 'anonymous')),
    CONSTRAINT media_operation_person_iff_person CHECK ((actor_kind = 'person') = (actor_person_id IS NOT NULL)),
    CONSTRAINT media_operation_label_not_blank CHECK (actor_label IS NULL OR btrim(actor_label) <> '')
);

CREATE INDEX IF NOT EXISTS media_operation_at ON media_operation (at DESC);
CREATE INDEX IF NOT EXISTS media_operation_actor ON media_operation (actor_person_id, at DESC) WHERE actor_person_id IS NOT NULL;

COMMENT ON TABLE media_operation IS
    'Idempotenzspeicher der Medien-Operationen (ADR-0019): Kennung, Hash, Quittung, Akteur. Nur anhängen; dauerhaft, das Fachprotokoll hängt daran.';
COMMENT ON COLUMN media_operation.actor_person_id IS 'INTERN: person.id des Handelnden (ohne Fremdschlüssel ins Schema avesmaps_auth).';

-- `media_audit_event`: das Fachprotokoll, eine Zeile je betroffenem Gegenstand einer Operation (eine Operation kann mehrere treffen:
-- Umsortieren trifft die Galerie, Freigeben eine Verwendung am Asset). Akteur und Zeit stehen an der Operation.
-- Typisierte Ziele statt `entity_type`: Asset und Galerie über ihre öffentliche Kennung, die Freigaberegel über ihre Zeile. OHNE
-- Fremdschlüssel: Ein Protokoll überlebt das endgültige Löschen seines Gegenstands (`delete_media`), und es verhindert es nicht.
-- `details`: nur Felder der Positivliste je Handlung (im Code, wie AUDIT_DETAIL_KEYS); nie ein Prompt, ein Beleg, ein Speicherschlüssel.
CREATE TABLE IF NOT EXISTS media_audit_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id UUID NOT NULL REFERENCES media_operation (operation_id),
    -- Was dem Gegenstand geschah, etwa `asset.title_changed`, `binding.approved`, `suspension.lifted`.
    action TEXT NOT NULL,
    media_asset_public_id UUID,
    media_gallery_public_id UUID,
    publication_rule_id BIGINT,
    -- Die Revision des Gegenstands NACH der Operation (für „wer war schneller“ in `EditConflictDetails`).
    target_revision BIGINT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT media_audit_event_has_target CHECK (
        num_nonnulls(media_asset_public_id, media_gallery_public_id, publication_rule_id) >= 1
    ),
    CONSTRAINT media_audit_event_action_format CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT media_audit_event_revision_positive CHECK (target_revision IS NULL OR target_revision >= 1),
    CONSTRAINT media_audit_event_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS media_audit_event_operation ON media_audit_event (operation_id);
CREATE INDEX IF NOT EXISTS media_audit_event_asset ON media_audit_event (media_asset_public_id, id DESC)
    WHERE media_asset_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_audit_event_gallery ON media_audit_event (media_gallery_public_id, id DESC)
    WHERE media_gallery_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_audit_event_rule ON media_audit_event (publication_rule_id, id DESC)
    WHERE publication_rule_id IS NOT NULL;

COMMENT ON TABLE media_audit_event IS
    'INTERN: Fachprotokoll der Medien (WI-0068 §3.3 Historie), je Operation und betroffenem Gegenstand. Nur anhängen; typisierte Ziele ohne Fremdschlüssel.';

-- 6. EINZELBILD-NOTAUS (suspend_media_publication) -----------------------------------------------------------------------------------
--
-- Ein Bild sofort nicht mehr ausliefern und wieder freigeben (AUTH-0001 §7.2; Betreiber 2026-10-10, WI-0119 F2): eigene Operation,
-- Stufe S, Grund Pflicht, Person und Zeit für Aus und Wieder-an. Kein Löschen, keine Änderung der Rechteklassifikation, unabhängig von
-- `publication_override` (der Sperre einer Verwendung aus der Rechteprüfung).
--
-- 🔴 Der Notaus gilt dem BILD, nicht der Stelle (Betreiber 2026-10-10 zu SYS-0001 Frage 2: „2 ja natürlich“; WI-0068
-- „Betreiberentscheid 2026-10-10: der Einzelbild-Notaus gehört ins MAM“): Alle Verwendungen mit denselben Bytes verschwinden
-- (1.024 Assets teilen ihre Quelldatei). Das Ziel ist deshalb der Inhalts-Hash des Originals (`source_sha256`, die SHA-256 der
-- Datei `private_source`), nicht eine Zeile von `media_file`: Ein Medienlauf, der Dateizeilen neu schreibt oder löscht, ändert
-- daran nichts. `media_asset_id` sagt nur, an welchem Asset der Notaus ausgelöst wurde; seine Bytes müssen es sein (Trigger).
-- Welche Assets und Dateien betroffen sind, folgt über `media_file.sha256` (Index `media_file_sha256` aus 0064) und
-- `media_file (media_asset_id, …)`; ein Medienlauf erkennt eine ausgeblendete Datei über `source_sha256` (Index unten). Beides
-- ohne Volltabellenlauf (media-mam-schema.test.ts prüft die Pläne).
--
-- 🔴 Schutzregel (Betreiber 2026-10-10 zu Frage 3): Kein Import und kein Medienlauf hebt einen Notaus oder eine Quarantäne auf. Die
-- Importer schreiben diese Tafel nie; aufgehoben wird nur mit `lifted_at` und Person. `file_state` sagt, wo die veröffentlichten
-- Dateien gerade liegen: `pending` (noch nicht dort, wo der Zustand sie verlangt), `quarantined` (aktiv, Dateien unter
-- `private/quarantine/`), `restored` (aufgehoben, Dateien zurück). Das Verschieben baut das Notaus-Paket; bis dahin bleibt `pending`.
--
-- Höchstens ein aktiver Notaus je Bild; ein aufgehobener bleibt als Verlauf stehen, an ihm ändert sich nur noch `file_state`
-- (Trigger unten). Die App-Rolle darf setzen und aufheben, nie löschen (media-grants.psql).
CREATE TABLE IF NOT EXISTS media_publication_suspension (
    id BIGSERIAL PRIMARY KEY,
    -- Das Bild: die SHA-256 der Originaldatei (`media_file`, Klasse `private_source`).
    source_sha256 TEXT NOT NULL,
    -- Das Asset, an dem der Notaus ausgelöst wurde (die Bestätigung nennt alle Stellen mit denselben Bytes).
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    reason TEXT NOT NULL,
    suspended_by_person UUID NOT NULL,
    suspended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lifted_at TIMESTAMPTZ,
    lifted_by_person UUID,
    lift_reason TEXT,
    file_state TEXT NOT NULL DEFAULT 'pending',
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_publication_suspension_sha256_format CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_publication_suspension_reason_not_blank CHECK (btrim(reason) <> ''),
    CONSTRAINT media_publication_suspension_lift_has_person CHECK ((lifted_at IS NULL) = (lifted_by_person IS NULL)),
    CONSTRAINT media_publication_suspension_lift_reason_needs_lift CHECK (
        lift_reason IS NULL OR (lifted_at IS NOT NULL AND btrim(lift_reason) <> '')
    ),
    CONSTRAINT media_publication_suspension_lift_after_suspend CHECK (lifted_at IS NULL OR lifted_at >= suspended_at),
    CONSTRAINT media_publication_suspension_file_state_known CHECK (file_state IN ('pending', 'quarantined', 'restored')),
    -- In Quarantäne nur, solange der Notaus gilt; zurück nur, wenn er aufgehoben ist.
    CONSTRAINT media_publication_suspension_file_state_fits CHECK (
        (file_state <> 'quarantined' OR lifted_at IS NULL) AND (file_state <> 'restored' OR lifted_at IS NOT NULL)
    )
);

-- Höchstens EIN aktiver Notaus je Bild, und zugleich der Weg des Medienlaufs: „ist diese Datei ausgeblendet?“ über ihre Bytes.
CREATE UNIQUE INDEX IF NOT EXISTS media_publication_suspension_one_active
    ON media_publication_suspension (source_sha256)
    WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_publication_suspension_asset ON media_publication_suspension (media_asset_id);

-- Die Bytes müssen die des Originals des auslösenden Assets sein: kein Notaus auf einen geratenen oder fremden Hash.
CREATE OR REPLACE FUNCTION media_publication_suspension_bytes_of_asset() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM media_file f
        WHERE f.media_asset_id = NEW.media_asset_id AND f.storage_class = 'private_source' AND f.sha256 = NEW.source_sha256
    ) THEN
        RAISE EXCEPTION 'Notaus: % sind nicht die Bytes des Originals von Asset %', NEW.source_sha256, NEW.media_asset_id
            USING ERRCODE = '23514', CONSTRAINT = 'media_publication_suspension_bytes_of_asset';
    END IF;
    RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER media_publication_suspension_bytes_of_asset BEFORE INSERT ON media_publication_suspension
    FOR EACH ROW EXECUTE FUNCTION media_publication_suspension_bytes_of_asset();

-- Was entschieden ist, bleibt: Bild, Asset, Grund, Person und Zeit ändern sich nie; nach dem Aufheben auch die Wiederfreigabe nicht
-- mehr. Nur `file_state` folgt den Dateien, auch danach (der Job, der zurückschiebt, kann später kommen).
CREATE OR REPLACE FUNCTION media_publication_suspension_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (NEW.source_sha256, NEW.media_asset_id, NEW.reason, NEW.suspended_by_person, NEW.suspended_at)
       IS DISTINCT FROM (OLD.source_sha256, OLD.media_asset_id, OLD.reason, OLD.suspended_by_person, OLD.suspended_at) THEN
        RAISE EXCEPTION 'Bild, Asset, Grund, Person und Zeit eines Notaus ändern sich nie (Notaus %): aufheben und neu setzen', OLD.id
            USING ERRCODE = '23514', CONSTRAINT = 'media_publication_suspension_fixed';
    END IF;
    IF OLD.lifted_at IS NOT NULL
       AND (NEW.lifted_at, NEW.lifted_by_person, NEW.lift_reason)
           IS DISTINCT FROM (OLD.lifted_at, OLD.lifted_by_person, OLD.lift_reason) THEN
        RAISE EXCEPTION 'Notaus % ist aufgehoben; die Wiederfreigabe bleibt als Verlauf, wie sie ist', OLD.id
            USING ERRCODE = '23514', CONSTRAINT = 'media_publication_suspension_lifted_is_final';
    END IF;
    RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER media_publication_suspension_guard BEFORE UPDATE ON media_publication_suspension
    FOR EACH ROW EXECUTE FUNCTION media_publication_suspension_guard();
-- Die Revision zählt die Entscheidung, nicht den Stand der Dateien (`file_state` schreibt der Job; Muster 0080).
CREATE OR REPLACE TRIGGER media_publication_suspension_revision
    BEFORE UPDATE OF source_sha256, media_asset_id, reason, suspended_by_person, suspended_at, lifted_at, lifted_by_person,
        lift_reason, revision
    ON media_publication_suspension
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE media_publication_suspension IS
    'Einzelbild-Notaus (suspend_media_publication): das Bild (die Bytes des Originals) nirgends mehr ausliefern, mit Grund, Person und Zeit für Aus und Wieder-an. Kein Import und kein Medienlauf hebt ihn auf. Wirkt erst mit dem Notaus-Paket (Policy, Resolver, Quarantäne).';
COMMENT ON COLUMN media_publication_suspension.source_sha256 IS
    'Das Bild: SHA-256 der Originaldatei (private_source). Alle Assets mit diesen Bytes sind ausgeblendet (Index media_file_sha256).';
COMMENT ON COLUMN media_publication_suspension.file_state IS
    'pending (Dateien noch nicht dort, wo der Zustand sie verlangt) | quarantined (aktiv, unter private/quarantine/) | restored (aufgehoben, zurück).';
COMMENT ON COLUMN media_publication_suspension.reason IS 'INTERN: Grund des Notaus, Pflicht; nie öffentlich.';
COMMENT ON COLUMN media_publication_suspension.suspended_by_person IS 'INTERN: person.id der Person, die den Notaus setzte.';
COMMENT ON COLUMN media_publication_suspension.lifted_by_person IS 'INTERN: person.id der Person, die wieder freigab.';

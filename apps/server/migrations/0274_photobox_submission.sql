-- 0274: Einreichung eines Reisebildes durch Besucher ohne Konto (WI-0272 S1 „Datenkern“; WI-0068 §12 „Community-Einreichung“, WI-0272 §12/§13).
--
-- Die Tafel `media_submission` hält, was ein Besucher einreicht, bis die Redaktion entschieden hat: Ort auf der Karte, Bildbeschreibung,
-- Entstehung, Lizenzwahl und den Zustand der Einreichung. Das Bild selbst wird erst mit der Freigabe ein Medium (`media_asset`, Rolle
-- `photobox`); bis dahin ist es nicht öffentlich. Der Besucher hat kein Konto; die Statusseite öffnet ein geheimer Schlüssel, von dem hier nur
-- der SHA-256-Wert steht (`status_key_hash`).
--
-- 🔴 Die Zusagen hält die Datenbank selbst, nicht erst das Formular: eine Avesmaps-Aufnahme unter CC BY gibt es nicht
-- (`media_submission_capture_avesmaps_only`), ein freigegebenes Bild hat sein Asset, eine geleerte Einreichung (`purged`) hat weder
-- Schlüssel noch Texte. Die Wertelisten stehen gleich in `packages/shared/src/photobox.ts` (Test `photobox-schema.test.ts` hält beide
-- gegeneinander).
--
-- Aufbewahrung: offene Einreichungen verfallen nach 60 Tagen (`expired`), 30 Tage danach werden sie GELEERT (`purged`: Schlüssel, Beschreibung
-- und Name werden NULL, die Zeile bleibt). Gelöscht wird nie: `media_ingest.submission_id` zeigt auf die Zeile, und die App-Rolle darf
-- `media_ingest` nicht löschen (`media-grants.psql`), der Fremdschlüssel bliebe sonst gebrochen.
--
-- Erst erweitern (AGENTS.md): Die Tafel ist neu und wird vom vorigen Release nie gelesen. Die vier erweiterten Wertelisten alter Tafeln und der
-- Fremdschlüssel von `media_ingest` verlangen nichts Neues vom vorigen Release: Es schreibt `photobox` nie und `submission_id` nur als NULL
-- (der Community-Upload kommt erst mit diesem Release). Rechte: die Vorgabe-Rechte der App-Rolle in `public` (lesen, anlegen, ändern, löschen).

-- 1. DIE TAFEL ---------------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media_submission (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Heute nur das Reisebild; die Bild- und Kartenvorschläge aus WI-0068 §12 bringen ihre Werte mit ihrem Release selbst.
    contribution_kind TEXT NOT NULL DEFAULT 'photobox',
    state TEXT NOT NULL DEFAULT 'incoming',
    -- Der SHA-256-Wert des geheimen Statusschlüssels (32 Bytes). NULL nur bei `purged`: Ohne Schlüssel gibt es keine Statusseite mehr.
    status_key_hash BYTEA,
    map_domain_id TEXT NOT NULL,
    -- Die Stelle auf der Karte, im Koordinatenraum 0 wie `place.geom`.
    geom geometry(Point, 0) NOT NULL,
    place_id BIGINT,
    -- Worauf sich das Bild bezieht: dieselben Arten wie ein Suchtreffer (`SearchHitKind`), beide Spalten oder keine.
    reference_kind TEXT,
    reference_key TEXT,
    -- Die Blickrichtung als Himmelsrichtung: 0 = Norden, im Uhrzeigersinn je 45 Grad, 7 = Nordwesten.
    view_direction SMALLINT,
    creation_kind TEXT NOT NULL,
    usage_grant TEXT NOT NULL,
    description TEXT,
    attribution_name TEXT,
    terms_version TEXT NOT NULL,
    adjusted_by_editors BOOLEAN NOT NULL DEFAULT false,
    -- Das Medium, das aus der Freigabe entstand. Ohne ON DELETE: ein Asset mit Einreichung wird nicht gelöscht.
    approved_media_asset_id BIGINT,
    -- Fachrevision (ADR-0020): zählt allein der Trigger `media_submission_revision` (unten), die Anwendung schreibt sie nie.
    revision BIGINT NOT NULL DEFAULT 1,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    original_deleted_at TIMESTAMPTZ,
    CONSTRAINT media_submission_public_id_unique UNIQUE (public_id),
    CONSTRAINT media_submission_status_key_unique UNIQUE (status_key_hash),
    CONSTRAINT media_submission_map_domain_fk FOREIGN KEY (map_domain_id) REFERENCES map_domain (id),
    CONSTRAINT media_submission_place_fk FOREIGN KEY (place_id) REFERENCES place (id),
    CONSTRAINT media_submission_asset_fk FOREIGN KEY (approved_media_asset_id) REFERENCES media_asset (id),
    -- 🔴 Die Stelle kommt von einem Besucher ohne Konto: Sie liegt in der Kartendomäne (das weist auch eine andere SRID ab), wie bei `place`.
    CONSTRAINT media_submission_inside_domain CHECK (map_domain_contains(map_domain_id, geom)),
    CONSTRAINT media_submission_kind_known CHECK (contribution_kind IN ('photobox')),
    CONSTRAINT media_submission_state_known CHECK (
        state IN (
            'incoming',
            'technical_failed',
            'pending',
            'changes_requested',
            'approved',
            'rejected',
            'withdrawn',
            'offline',
            'expired',
            'purged'
        )
    ),
    CONSTRAINT media_submission_key_hash_len CHECK (status_key_hash IS NULL OR octet_length(status_key_hash) = 32),
    CONSTRAINT media_submission_reference_pair CHECK ((reference_kind IS NULL) = (reference_key IS NULL)),
    CONSTRAINT media_submission_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ort', 'landschaft', 'weg', 'klima')
    ),
    CONSTRAINT media_submission_view_direction_range CHECK (view_direction IS NULL OR view_direction BETWEEN 0 AND 7),
    CONSTRAINT media_submission_creation_kind_known CHECK (
        creation_kind IN ('drawing', 'photo', 'ai_generated', 'avesmaps_capture')
    ),
    CONSTRAINT media_submission_usage_grant_known CHECK (usage_grant IN ('avesmaps_only', 'cc-by-4.0')),
    -- 🔴 Eine Avesmaps-Aufnahme (Bild aus der Karte selbst) gibt es nur für Avesmaps, nie unter CC BY.
    CONSTRAINT media_submission_capture_avesmaps_only CHECK (
        creation_kind <> 'avesmaps_capture' OR usage_grant = 'avesmaps_only'
    ),
    CONSTRAINT media_submission_description_len CHECK (
        description IS NULL OR char_length(btrim(description)) BETWEEN 1 AND 300
    ),
    CONSTRAINT media_submission_attribution_len CHECK (
        attribution_name IS NULL OR char_length(btrim(attribution_name)) BETWEEN 1 AND 80
    ),
    CONSTRAINT media_submission_terms_version_not_blank CHECK (btrim(terms_version) <> ''),
    -- 🔴 Freigegeben und offline (zurückgenommen) heißen: Es gibt das Medium.
    CONSTRAINT media_submission_approved_has_asset CHECK (
        state NOT IN ('approved', 'offline') OR approved_media_asset_id IS NOT NULL
    ),
    -- 🔴 Geleert (`purged`): Schlüssel, Beschreibung und Name sind NULL; jede andere Einreichung hat Schlüssel und Beschreibung.
    CONSTRAINT media_submission_purged_empty CHECK (
        (state = 'purged' AND status_key_hash IS NULL AND description IS NULL AND attribution_name IS NULL)
        OR (state <> 'purged' AND status_key_hash IS NOT NULL AND description IS NOT NULL)
    )
);

-- Der Moderationskorb (Eingang nach Zustand) und die Aufbewahrung (Verfall, Leeren nach Zustandswechsel).
CREATE INDEX IF NOT EXISTS media_submission_state_changed ON media_submission (state, state_changed_at);
-- Die Stelle auf der Karte (Lesen je Ausschnitt), wie `place_geom_gist` (0003).
CREATE INDEX IF NOT EXISTS media_submission_geom_gist ON media_submission USING GIST (geom);

-- `revision` zählt der Trigger aus 0079 hoch und setzt dabei `updated_at` (Muster der Medientafeln, 0086 Abschnitt 1): Die Operationen der
-- Redaktion prüfen `WHERE revision = baseRevision`, und kein Schreibpfad kann das Hochzählen vergessen. `state_changed_at` setzt die App.
CREATE OR REPLACE TRIGGER media_submission_revision BEFORE UPDATE ON media_submission
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE media_submission IS
    'Einreichung eines Reisebildes durch Besucher ohne Konto (WI-0068 §12, WI-0272 §12/§13): Ort, Beschreibung, Entstehung, Lizenzwahl und Zustand bis zur Entscheidung der Redaktion. Das Bild wird erst mit der Freigabe ein Medium (Rolle photobox). Verfallene Einreichungen werden geleert (purged), nie gelöscht: media_ingest.submission_id zeigt auf die Zeile.';
COMMENT ON COLUMN media_submission.id IS 'INTERN: Schlüssel der Tafel; media_ingest.submission_id verweist darauf.';
COMMENT ON COLUMN media_submission.public_id IS 'Die Kennung nach außen (Moderation, Eingang); nie der Statusschlüssel.';
COMMENT ON COLUMN media_submission.contribution_kind IS
    'Art des Beitrags (WI-0068 §12); heute nur photobox, Bild- und Kartenvorschläge bringen ihre Werte mit ihrem Release.';
COMMENT ON COLUMN media_submission.state IS
    'Weg der Einreichung (WI-0272 §12, PHOTOBOX_SUBMISSION_STATES): incoming, technical_failed, pending, changes_requested, approved, rejected, withdrawn, offline, expired, purged.';
COMMENT ON COLUMN media_submission.status_key_hash IS
    'INTERN: SHA-256 des geheimen Statusschlüssels (32 Bytes), nie der Schlüssel selbst; NULL nur bei purged (WI-0272 §12).';
COMMENT ON COLUMN media_submission.map_domain_id IS 'Kartendomäne der Stelle (WI-0272 §12).';
COMMENT ON COLUMN media_submission.geom IS 'Die Stelle auf der Karte, Punkt im Koordinatenraum 0 wie place.geom, innerhalb der Kartendomäne (WI-0272 §12).';
COMMENT ON COLUMN media_submission.place_id IS 'Der Ort, auf den sich das Bild bezieht, wenn der Einreicher einen wählte (WI-0272 §12); sonst NULL.';
COMMENT ON COLUMN media_submission.reference_kind IS
    'Art des gewählten Bezugs, dieselben Arten wie ein Suchtreffer (SearchHitKind); mit reference_key beide oder keine (WI-0272 §12).';
COMMENT ON COLUMN media_submission.reference_key IS 'Schlüssel des gewählten Bezugs, gehört zu reference_kind (WI-0272 §12).';
COMMENT ON COLUMN media_submission.view_direction IS
    'Blickrichtung als Himmelsrichtung 0 bis 7 (0 = Norden, im Uhrzeigersinn je 45 Grad), NULL ohne Angabe (WI-0272 §12).';
COMMENT ON COLUMN media_submission.creation_kind IS
    'Was für ein Bild das ist (PHOTOBOX_CREATION_KINDS): drawing, photo, ai_generated, avesmaps_capture; die Wahl des Einreichers (WI-0272 §12).';
COMMENT ON COLUMN media_submission.usage_grant IS
    'Lizenzwahl des Einreichers (PHOTOBOX_USAGE_GRANTS): avesmaps_only (Vorgabe) oder cc-by-4.0; nie avesmaps_capture mit cc-by-4.0 (WI-0272 §12/§13).';
COMMENT ON COLUMN media_submission.description IS
    'INTERN bis zur Freigabe: Bildbeschreibung des Einreichers, 1 bis 300 Zeichen; NULL nur bei purged (WI-0272 §12).';
COMMENT ON COLUMN media_submission.attribution_name IS
    'INTERN bis zur Freigabe: freiwillige Nennung des Einreichers, 1 bis 80 Zeichen; NULL ohne Angabe und bei purged (WI-0272 §12).';
COMMENT ON COLUMN media_submission.terms_version IS 'Fassung der Nutzungsbedingungen, der der Einreicher zustimmte (WI-0272 §13); nie leer.';
COMMENT ON COLUMN media_submission.adjusted_by_editors IS 'Die Statusseite zeigt „von der Redaktion angepasst“, wenn die Redaktion Angaben änderte (WI-0272 §12).';
COMMENT ON COLUMN media_submission.approved_media_asset_id IS
    'Das Medium, das aus der Freigabe entstand (Rolle photobox); Pflicht bei approved und offline (WI-0272 §12).';
COMMENT ON COLUMN media_submission.revision IS
    'Fachrevision für gleichzeitige Änderungen (ADR-0020, MEDIA-M10): zählt allein der Trigger media_submission_revision (public.revision_bump()), die App schreibt sie nie.';
COMMENT ON COLUMN media_submission.submitted_at IS 'Wann die Einreichung ankam; die Frist für den Verfall (60 Tage) zählt ab hier, solange sie offen ist (WI-0272 §12).';
COMMENT ON COLUMN media_submission.state_changed_at IS 'Wann der Zustand zuletzt wechselte; die Fristen für Verfall und Leeren (30 Tage nach dem Verfall) zählen ab hier (WI-0272 §12).';
COMMENT ON COLUMN media_submission.updated_at IS 'Wann die Zeile zuletzt geändert wurde; setzt der Trigger media_submission_revision bei jeder Änderung.';
COMMENT ON COLUMN media_submission.decided_at IS 'Wann die Redaktion entschied (freigegeben, abgelehnt, Änderung erbeten); NULL, solange offen (WI-0272 §12).';
COMMENT ON COLUMN media_submission.original_deleted_at IS 'Wann das Original des Bildes gelöscht wurde (Aufbewahrung, WI-0272 §13); NULL, solange es da ist.';

-- 2. ERWEITERTE WERTELISTEN ALTER TAFELN ----------------------------------------------------------------------------------------------
--
-- Jede Liste behält ihre bisherigen Werte; `photobox` kommt dazu. Das vorige Release schreibt den Wert nie, kann also keine Bedingung
-- verletzen, und bestehende Zeilen erfüllen sie. Aufnahme in `KNOWN_EXCEPTIONS` (migration-compat.test.ts): Regel `add-check`.

-- Die Galerie eines Ortes mit Reisebildern (gallery_kind), ihre Bindung an den Ort (Rolle und Herkunft `photobox`) und die Freigaberegel für
-- die Rolle: ohne Regel wird kein Reisebild öffentlich (media/policy.ts, Test media-policy.test.ts).
ALTER TABLE media_gallery
    DROP CONSTRAINT IF EXISTS media_gallery_kind_known,
    ADD CONSTRAINT media_gallery_kind_known CHECK (gallery_kind IN ('object_gallery', 'editorial', 'photobox'));

ALTER TABLE publication_rule
    DROP CONSTRAINT IF EXISTS publication_rule_role_known,
    ADD CONSTRAINT publication_rule_role_known CHECK (
        role IN ('coat', 'header', 'map_full', 'map_preview', 'literature_cover', 'photobox')
    );

ALTER TABLE place_media_gallery
    DROP CONSTRAINT IF EXISTS place_media_gallery_role_known,
    ADD CONSTRAINT place_media_gallery_role_known CHECK (role IN ('header', 'photobox')),
    DROP CONSTRAINT IF EXISTS place_media_gallery_origin_known,
    ADD CONSTRAINT place_media_gallery_origin_known CHECK (origin IN ('legacy', 'editor', 'photobox'));

-- 3. DER EINGANG VERWEIST AUF DIE EINREICHUNG -----------------------------------------------------------------------------------------
--
-- `media_ingest.submission_id` (0086) hatte bis jetzt keinen Fremdschlüssel („Fremdschlüssel mit P8“). Bewusst OHNE `ON DELETE`: Eine
-- Einreichung mit Eingang wird geleert (`purged`), nie gelöscht; die App-Rolle darf `media_ingest` nicht löschen. `media_ingest_community_has_submission`
-- (0086) bleibt wie sie ist.
ALTER TABLE media_ingest
    DROP CONSTRAINT IF EXISTS media_ingest_submission_fk,
    ADD CONSTRAINT media_ingest_submission_fk FOREIGN KEY (submission_id) REFERENCES media_submission (id);

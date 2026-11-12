-- Kartenrevision und Schreibnaht des Ortseditors (WI-0128 E8, EDIT-0001 §6.1 Nr. 1 bis 4, §4.7 G8).
--
--   1. `place.revision` und `path.revision`, gezählt allein vom Trigger `public.revision_bump()` (0079; er setzt auch `updated_at`).
--      Gezählt wird nur, wenn sich eine FACHLICHE Spalte ändert (Muster 0086 an `media_asset`): Beschriftungs-Overrides (ADR-0006),
--      `migration_run_id` und `imported_at` bescheren einem offenen Entwurf keinen Bearbeitungskonflikt. `revision` steht selbst in der
--      Liste: Eine Operation, die nur `place_detail` oder die Wiki-Zuordnung ändert, berührt den Ort mit `SET revision = revision … AND
--      revision = $baseRevision`; das zählt und ist zugleich die Konfliktprüfung (EDIT-0001 §6.1 Nr. 1). Der Import ändert Ort und Weg
--      nur, wenn sich etwas unterscheidet (`migration/places.ts`, `paths.ts`), und zählt dann mit.
--      🪤 Ändert der Import nur `place_detail` oder die Zuordnung, zählt er NICHT: Ein Trigger dort zählte eine Operation, die beides
--      ändert, doppelt (E8: „genau einmal je Operation“). In der Testwelt setzt der Zug ohnehin alles zurück (E14); Production schreibt
--      niemand (EDIT-0001 §4.6).
--   2. `map_operation`: eine Zeile je wirksamer Operation an der Karte, wie `media_operation` (Kennung, Hash, Quittung, Handlung,
--      Umgebung, Akteur), dazu `seq` (Weckruf `map.changed` und Kachelrevision, E13), die Domäne, `source` (`editor`, `import`,
--      `restore`, `testwelt_reset`), `summary` und `approval_ref`. 🔴 Map Mutation Guard: Handelt ein Agent (Claudia, Claudio), ist
--      `approval_ref` Pflicht, der Verweis auf die persönliche, scope-genaue Freigabe des Betreibers. Zug und Zurücksetzen (`import`,
--      `testwelt_reset`) laufen nicht über `runOperation` und tragen weder Hash noch Quittung.
--   3. `map_audit_event`: je Operation und Gegenstand eine Zeile mit typisiertem Ziel (`place_public_id`, `path_public_id`; weitere
--      Arten additiv mit ihren Editoren), Revision vorher und nachher und `changes` (Feld → alt, neu; nur Felder der Positivliste in
--      `apps/server/src/editor/map-operation.ts`). Ohne Fremdschlüssel wie bei den Medien: Ein Protokoll überlebt seinen Gegenstand.
--   4. Ein neuer Ort von Avesmaps3D (`source_system = 'avesmaps3d'`) trägt keine `legacy_public_id`.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): Spalten mit Vorgabe, neue Tabellen, Trigger; das vorige Release liest und schreibt weiter
-- (sein Import setzt die Revision nie). Die Rechte der App-Rolle stehen in `apps/server/src/db/map-grants.psql` (Claudio, N2).

-- 1. KARTENREVISION -------------------------------------------------------------------------------------------------------------------

ALTER TABLE place ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE path ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE TRIGGER place_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, geom, is_active, is_hidden, is_ruined, is_nodix, is_seaport, place_kind,
                     source_system, legacy_public_id, revision
    ON place
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER path_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, label_visible, is_bach, geom, is_active, flow_direction, allowed_transports,
                     transport_domain, transport_seasons, flow_factor, source_system, legacy_public_id, revision
    ON path
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN place.revision IS
    'Fachrevision (WI-0128 E8): zählt der Trigger place_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN path.revision IS
    'Fachrevision (WI-0128 E8): zählt der Trigger path_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. OPERATION -----------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS map_operation (
    operation_id UUID PRIMARY KEY,
    -- Die Reihenfolge aller Operationen an der Karte: Weckruf und Kachelrevision (`?r=<seq>`) zählen damit.
    seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- SHA-256 des Anfrageinhalts ohne Geheimnisse (`requestHash` in auth/operations.ts); nur bei `editor` und `restore`.
    request_hash BYTEA,
    -- Die Quittung der ersten Ausführung (`OperationReceipt`, Status `applied`); nur bei `editor` und `restore`.
    receipt JSONB,
    -- Die benannte Operation, etwa `place.move`; der Katalog lebt im Code.
    action TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'editor',
    -- Ein Satz für den Verlauf („Gratenfels verschoben, 4 Wegenden mit“); keine Person, kein Freitext eines Antrags.
    summary TEXT,
    environment TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    -- Die pseudonyme person.id des Handelnden; nur bei actor_kind = person.
    actor_person_id UUID,
    -- Agent, Kommandozeile oder System: eine Bezeichnung, nie der Name einer Person (Agent: `claudia`, `claudio`).
    actor_label TEXT,
    -- 🔴 Map Mutation Guard: der Verweis auf die persönliche Freigabe des Betreibers; Pflicht, wenn ein Agent handelt.
    approval_ref TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT map_operation_source_known CHECK (source IN ('editor', 'import', 'restore', 'testwelt_reset')),
    CONSTRAINT map_operation_request_from_runner CHECK (
        source IN ('import', 'testwelt_reset') OR (request_hash IS NOT NULL AND receipt IS NOT NULL)
    ),
    CONSTRAINT map_operation_hash_sha256 CHECK (request_hash IS NULL OR octet_length(request_hash) = 32),
    CONSTRAINT map_operation_receipt_applied CHECK (
        receipt IS NULL
        OR (
            jsonb_typeof(receipt) = 'object'
            AND receipt ->> 'operationId' = operation_id::text
            AND receipt ->> 'status' = 'applied'
        )
    ),
    CONSTRAINT map_operation_action_format CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT map_operation_summary_not_blank CHECK (summary IS NULL OR btrim(summary) <> ''),
    CONSTRAINT map_operation_environment_known CHECK (environment IN ('development', 'staging', 'production', 'test')),
    CONSTRAINT map_operation_actor_kind_known CHECK (actor_kind IN ('person', 'agent', 'cli', 'system')),
    CONSTRAINT map_operation_person_iff_person CHECK ((actor_kind = 'person') = (actor_person_id IS NOT NULL)),
    CONSTRAINT map_operation_label_not_blank CHECK (actor_label IS NULL OR btrim(actor_label) <> ''),
    CONSTRAINT map_operation_agent_named CHECK (actor_kind <> 'agent' OR actor_label IN ('claudia', 'claudio')),
    CONSTRAINT map_operation_agent_approved CHECK (actor_kind <> 'agent' OR approval_ref IS NOT NULL),
    CONSTRAINT map_operation_approval_not_blank CHECK (approval_ref IS NULL OR btrim(approval_ref) <> '')
);

CREATE INDEX IF NOT EXISTS map_operation_domain_seq ON map_operation (map_domain_id, seq DESC);
CREATE INDEX IF NOT EXISTS map_operation_at ON map_operation (at DESC);
CREATE INDEX IF NOT EXISTS map_operation_actor ON map_operation (actor_person_id, at DESC) WHERE actor_person_id IS NOT NULL;

COMMENT ON TABLE map_operation IS
    'Operationen an der Karte (WI-0128 E8, ADR-0019): Kennung, Hash, Quittung, Akteur, Reihenfolge seq. Nur anhängen; das Fachprotokoll hängt daran.';
COMMENT ON COLUMN map_operation.actor_person_id IS 'INTERN: person.id des Handelnden (ohne Fremdschlüssel ins Schema avesmaps_auth).';

-- 3. FACHPROTOKOLL ------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS map_audit_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id UUID NOT NULL REFERENCES map_operation (operation_id),
    -- Was dem Gegenstand geschah, etwa `place.moved`, `path.endpoint_moved`.
    action TEXT NOT NULL,
    place_public_id UUID,
    path_public_id UUID,
    -- Die Revision des Gegenstands vor und nach der Operation (vorher fehlt bei einem neuen Gegenstand).
    revision_before BIGINT,
    revision_after BIGINT,
    -- Feld → {"before": …, "after": …}; nur Felder der Positivliste (map-operation.ts).
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT map_audit_event_has_target CHECK (num_nonnulls(place_public_id, path_public_id) >= 1),
    CONSTRAINT map_audit_event_action_format CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT map_audit_event_revision_positive CHECK (
        (revision_before IS NULL OR revision_before >= 1) AND (revision_after IS NULL OR revision_after >= 1)
    ),
    CONSTRAINT map_audit_event_revision_forward CHECK (
        revision_before IS NULL OR revision_after IS NULL OR revision_after > revision_before
    ),
    CONSTRAINT map_audit_event_changes_object CHECK (jsonb_typeof(changes) = 'object')
);

CREATE INDEX IF NOT EXISTS map_audit_event_operation ON map_audit_event (operation_id);
CREATE INDEX IF NOT EXISTS map_audit_event_place ON map_audit_event (place_public_id, id DESC)
    WHERE place_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_audit_event_path ON map_audit_event (path_public_id, id DESC)
    WHERE path_public_id IS NOT NULL;

COMMENT ON TABLE map_audit_event IS
    'INTERN: Fachprotokoll der Karte (WI-0128 E8, EDIT-0001 §6.1 Nr. 3), je Operation und Gegenstand. Nur anhängen; typisierte Ziele ohne Fremdschlüssel.';

-- 4. NEUE ORTE ----------------------------------------------------------------------------------------------------------------------
--
-- Das vorige Release schreibt nie `avesmaps3d` (sein Import schreibt `legacy`); die Bedingung trifft keinen bestehenden Ort.
ALTER TABLE place
    DROP CONSTRAINT IF EXISTS place_own_without_legacy_id,
    ADD CONSTRAINT place_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);

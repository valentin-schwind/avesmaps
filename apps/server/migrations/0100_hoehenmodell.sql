-- Höhenmodell in der Systemsteuerung (WI-0127 SYS-13, SYS-0001 §9c, Betreiber 2026-10-10 „nach Empfehlung“, §9c.12).
--
-- Die Fassungen des Geländerezepts bleiben geprüfte Dateien im Repository (Option C); GEWÄHLT wird je Umgebung hier. Dazu die Abnahmen,
-- die Entwürfe einer neuen Fassung, die Fassung am Master und die Kette, die ein Wechsel anstößt.
--
-- 🔴 REIN ADDITIV: neue Tafeln, eine neue Spalte (nullbar), eine neue Funktion; `job_enqueue` und `redact_person_events` mit
-- derselben Argumentliste aus ihrer AKTUELLEN Fassung (0094, 0087) abgeschrieben und nur erweitert. Das vorige Release liest keine der
-- neuen Tafeln: Ohne Auswahlzeile gilt `active` aus der Datei wie bisher (`terrain/auswahl.ts`). Rechte an den Tafeln:
-- `apps/server/src/db/hoehenmodell-grants.psql`.

-- Welche Fassung einen Master rechnete; `NULL` bei Mastern vor dieser Migration (die Fassung steckt dann nur im Eingabe-Fingerabdruck).
ALTER TABLE terrain_domain_raster ADD COLUMN IF NOT EXISTS recipe_version SMALLINT;
COMMENT ON COLUMN terrain_domain_raster.recipe_version IS
    'Fassung des Geländerezepts, die diesen Master rechnete (WI-0127 SYS-13); NULL vor Migration 0100.';

-- Die Auswahl dieser Umgebung: eine Zeile je Domäne. Fehlt sie, gilt `active` aus config/terrain/aventuria.json.
CREATE TABLE IF NOT EXISTS terrain_recipe_choice (
    map_domain_id TEXT PRIMARY KEY REFERENCES map_domain (id),
    version SMALLINT NOT NULL CHECK (version >= 1),
    -- Die Fassung vor der letzten Wahl: das Ziel des Rückwegs, wenn sie abgenommen ist.
    previous_version SMALLINT CHECK (previous_version IS NULL OR previous_version >= 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    chosen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    chosen_by UUID,
    chosen_by_label TEXT,
    reason TEXT
);
COMMENT ON TABLE terrain_recipe_choice IS
    'Gewählte Fassung des Geländerezepts je Domäne in dieser Umgebung (WI-0127 SYS-13); ohne Zeile gilt die Datei.';

-- Abnahmen am Blatt und an der Karte: nur anhängen. Production aktiviert nur, was die Datei unter `accepted` nennt (§9c.8).
CREATE TABLE IF NOT EXISTS terrain_recipe_acceptance (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    version SMALLINT NOT NULL CHECK (version >= 1),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_by UUID,
    accepted_by_label TEXT,
    reason TEXT
);
CREATE INDEX IF NOT EXISTS terrain_recipe_acceptance_version ON terrain_recipe_acceptance (map_domain_id, version);
COMMENT ON TABLE terrain_recipe_acceptance IS
    'Abnahmen einer Fassung des Geländerezepts in dieser Umgebung (WI-0127 SYS-13); nur anhängen.';

-- Entwürfe einer neuen Fassung: eine vorhandene Fassung als Basis, nur die freigegebenen Regler geändert (§9c.12 Frage 2 „A plus“).
-- Gemessen wird als Job `terrain_preview`, nie veröffentlicht; zur Fassung wird ein Entwurf erst, wenn Claudia ihn als Datei einträgt.
CREATE TABLE IF NOT EXISTS terrain_recipe_draft (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    base_version SMALLINT NOT NULL CHECK (base_version >= 1),
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'entwurf' CHECK (state IN ('entwurf', 'verworfen')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    created_by_label TEXT,
    -- Der jüngste Messauftrag (`job.public_id`); das Ergebnis steht in seiner Jobzeile.
    measure_job UUID,
    discarded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS terrain_recipe_draft_domain ON terrain_recipe_draft (map_domain_id, created_at DESC);
COMMENT ON TABLE terrain_recipe_draft IS
    'Entwürfe einer neuen Fassung des Geländerezepts (WI-0127 SYS-13); die Messung ist ein Job, nie eine Veröffentlichung.';

-- Die volle Kette nach einem Wechsel der Fassung (§9c.11: „Wechsel der Fassung = ganze Karte neu“), wie `enqueueTerrainFull` samt
-- Nachfolgern (`apps/server/src/jobs/terrain-chain.ts`): Wartet schon ein voller Lauf, nimmt er die Anforderung auf; sonst
-- `terrain_full`, danach `routing_reload` und `display_heights`. SECURITY DEFINER: Die App-Rolle schreibt nie selbst in `job`.
-- Mit einer Person als Auslöser wartet der volle Lauf unter Kartensperre (SYS-4).
CREATE OR REPLACE FUNCTION terrain_chain_enqueue(p_map_domain_id TEXT, p_actor_ref TEXT, p_label TEXT)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_waiting_id BIGINT;
    v_waiting_public UUID;
    v_full_id BIGINT;
    v_full_public UUID;
BEGIN
    SELECT j.id, j.public_id INTO v_waiting_id, v_waiting_public
      FROM job j
     WHERE j.kind = 'terrain_full' AND j.map_domain_id = p_map_domain_id AND j.state = 'QUEUED'
     ORDER BY j.id LIMIT 1
       FOR UPDATE;
    IF v_waiting_id IS NOT NULL THEN
        UPDATE job SET coalesced_count = coalesced_count + 1 WHERE id = v_waiting_id;
        RETURN v_waiting_public;
    END IF;
    SELECT i.id, i.public_id INTO v_full_id, v_full_public
      FROM job_insert('terrain_full', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                      left(COALESCE(p_label, 'Gelände voll'), 120), '{}'::jsonb, 70::smallint, NULL, 'domain', '{}', NULL) i;
    PERFORM 1 FROM job_insert('routing_reload', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                              'Routenrechner nach vollem Lauf', '{}'::jsonb, 20::smallint, NULL, 'tiles', '{}', ARRAY[v_full_id]);
    PERFORM 1 FROM job_insert('display_heights', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                              'Höhenlinien nach vollem Lauf', '{}'::jsonb, 60::smallint, NULL, 'tiles', '{}', ARRAY[v_full_id]);
    RETURN v_full_public;
END;
$$;

COMMENT ON FUNCTION terrain_chain_enqueue(TEXT, TEXT, TEXT) IS
    'WI-0127 SYS-13: die volle Geländekette nach einem Wechsel der Fassung (terrain_full, routing_reload, display_heights); nimmt einen wartenden vollen Lauf mit. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION terrain_chain_enqueue(TEXT, TEXT, TEXT) FROM PUBLIC;

-- Die Messung eines Entwurfs darf die Anwendung einreihen (`terrain_preview`, SYS-13 13c). Abgeschrieben von 0094, nur um die Art erweitert.
CREATE OR REPLACE FUNCTION job_enqueue(
    p_kind TEXT,
    p_kind_version SMALLINT,
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_input_ref JSONB,
    p_priority SMALLINT DEFAULT 50,
    p_not_before TIMESTAMPTZ DEFAULT NULL,
    p_scope_kind TEXT DEFAULT 'domain',
    p_scope_tiles SMALLINT[] DEFAULT '{}',
    p_depends_on BIGINT[] DEFAULT '{}'
) RETURNS TABLE (id BIGINT, public_id UUID)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN (
        'terrain_local', 'dem_publish', 'display_heights', 'routing_reload', 'media_settle', 'legacy_pull', 'legacy_media',
        'terrain_preview'
    ) THEN
        RAISE EXCEPTION 'job_enqueue: Jobart % darf die Anwendung nicht einreihen', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id FROM job_insert(
        p_kind, p_kind_version, p_map_domain_id, 'queued', p_actor_ref, NULL, NULL, p_input_ref, p_priority,
        p_not_before, p_scope_kind, p_scope_tiles, p_depends_on
    ) i;
END;
$$;

-- Der Grund einer Wahl, einer Abnahme und eines Entwurfs ist Freitext der HANDELNDEN Person über das System (wie 0087): geschwärzt, wenn
-- sie aufgelöst wird. Abgeschrieben aus der AKTUELLEN Fassung (0087), nur die Tafel `authored` erweitert.
CREATE OR REPLACE FUNCTION avesmaps_auth.redact_person_events(person_ref uuid) RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    mark_text CONSTANT text := '[geschwärzt]';
    mark CONSTANT jsonb := to_jsonb(mark_text);
    discord_ref text;
    redacted bigint;
BEGIN
    IF person_ref IS NULL THEN
        RETURN 0;
    END IF;
    -- Vor dem Löschen der Verknüpfung gerufen (`dissolve.ts`): Die Discord-ID findet die Einladungen, die an sie gebunden waren.
    SELECT d.discord_user_id INTO discord_ref FROM avesmaps_auth.discord_login d WHERE d.person_id = person_ref;

    WITH RECURSIVE own_invitation (id) AS (
        SELECT i.id FROM avesmaps_auth.invitation i
         WHERE i.accepted_person_id = person_ref OR i.bound_discord_user_id = discord_ref
        UNION
        -- Neu ausgestellt: Der Vorgänger trug dieselbe Notiz und zeigt mit `replaced_by` auf den Nachfolger.
        SELECT earlier.id FROM avesmaps_auth.invitation earlier JOIN own_invitation o ON earlier.replaced_by = o.id
    ),
    -- Freitext mit Personenbezug je Handlung, Schlüssel aus `AUDIT_DETAIL_KEYS`. Wer dort einen Freitext ergänzt, ergänzt ihn hier.
    personal (action, key) AS (
        VALUES ('person.renamed', 'from'), ('person.renamed', 'to'),
               ('person.locked', 'reason'),
               ('capability.granted', 'reason'), ('capability.revoked', 'reason'),
               ('discord.linked', 'discordUsername'),
               ('passkey.registered', 'label'), ('passkey.revoked', 'label'), ('passkey.counter_regression', 'label'),
               ('invitation.created', 'note'),
               ('legacy.mapped', 'legacyName'), ('legacy.mapped', 'legacyUserId'), ('legacy.mapped', 'evidence'),
               ('legacy.unmapped', 'legacyName'), ('legacy.unmapped', 'legacyUserId')
    ),
    -- Freitext, den die HANDELNDE Person über das System schreibt (kein Gegenstand, keine betroffene Person; WI-0127 SYS-2).
    authored (action, key) AS (
        VALUES ('system.mode_changed', 'reason'),
               ('system.lock_changed', 'reason'),
               ('system.terrain_activated', 'reason'),
               ('system.terrain_accepted', 'reason'),
               ('system.terrain_draft_created', 'reason')
    ),
    concerned AS (
        SELECT e.id,
               coalesce(e.target_person_id = person_ref, false)
                   OR (starts_with(e.action, 'invitation.') AND e.target_ref IN (SELECT o.id::text FROM own_invitation o))
                   AS subject,
               coalesce(e.actor_person_id = person_ref, false)
                   OR (coalesce(e.target_person_id = person_ref, false) AND e.actor_person_id IS NULL) AS trace,
               coalesce(e.actor_person_id = person_ref, false) AS author
          FROM avesmaps_auth.security_event e
         WHERE e.target_person_id = person_ref
            OR e.actor_person_id = person_ref
            OR (starts_with(e.action, 'invitation.') AND e.target_ref IN (SELECT o.id::text FROM own_invitation o))
    ),
    planned AS (
        SELECT c.id, c.subject, c.trace,
               (
                   SELECT jsonb_object_agg(k.key, mark)
                     FROM (SELECT p.key FROM personal p WHERE c.subject AND p.action = e.action
                           UNION
                           SELECT a.key FROM authored a WHERE c.author AND a.action = e.action) k
                    WHERE e.details ? k.key AND e.details -> k.key NOT IN ('null'::jsonb, mark)
               ) AS blackened,
               c.author AND EXISTS (SELECT 1 FROM authored a WHERE a.action = e.action) AS own_text,
               c.subject AND starts_with(e.action, 'legacy.') AND e.target_ref IS NOT NULL AND e.target_ref <> mark_text
                   AS legacy_ref
          FROM concerned c JOIN avesmaps_auth.security_event e ON e.id = c.id
    )
    UPDATE avesmaps_auth.security_event e
       SET details = e.details || coalesce(p.blackened, '{}'::jsonb),
           target_ref = CASE WHEN p.legacy_ref THEN mark_text ELSE e.target_ref END,
           request_hash = CASE WHEN p.subject OR p.own_text THEN NULL ELSE e.request_hash END,
           client_label = CASE WHEN p.trace THEN NULL ELSE e.client_label END,
           ip_prefix = CASE WHEN p.trace THEN NULL ELSE e.ip_prefix END
      FROM planned p
     WHERE e.id = p.id
       AND (p.blackened IS NOT NULL
            OR p.legacy_ref
            OR ((p.subject OR p.own_text) AND e.request_hash IS NOT NULL)
            OR (p.trace AND (e.client_label IS NOT NULL OR e.ip_prefix IS NOT NULL)));
    GET DIAGNOSTICS redacted = ROW_COUNT;
    RETURN redacted;
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_auth.redact_person_events(uuid) FROM PUBLIC;

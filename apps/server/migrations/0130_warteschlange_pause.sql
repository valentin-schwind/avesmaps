-- Die Warteschlange pausieren und fortsetzen, je Umgebung (WI-0160, Migration 0130; Auftrag
-- `project-control/handovers/2026-10-15-antwort-stage-landschaften-gelaendekette-an-claudia.md` §5, Claudios Entwurf).
--
-- Betreiber 2026-10-15, wörtlich: „ganz besonders ärgerlich ist, dass in der warteschlange bei production nicht abgearbeitet
-- wird, obwohl da neue aufträge drin stehen. es wäre gut, wenn man da einen "Warteschlagen starten" und "Pausieren" steht“.
--
-- 🔴 Gebaut wird EIN Knopf: „Pausieren“ und im pausierten Zustand „Fortsetzen“. Ein Knopf „Starten“ gibt es nicht, weil nichts
--    angehalten ist, was man starten müsste (Begründung im Work Item, dem Betreiber vorgelegt).
--
-- Zwei Teile:
--
-- 1. Drei neue Spalten in `system_state` — der Schalter steht da, wo Stellung und die zwei Sperren schon stehen, in genau
--    deren Form (`…_since`, `…_by`, `…_by_label`, `…_reason`). Damit erbt er den ganzen Apparat von 0087: `revision` und die
--    Prüfung gegen `baseRevision`, den Weckruf `avesmaps_system_changed`, den Speicher jeder Instanz, und das Schwärzen des
--    Grundes beim Auflösen eines Kontos (Tafel `authored` in `redact_person_events()`, siehe unten).
-- 2. `job_sync_claim` gibt bei Pause nichts heraus. 🔴 Damit braucht Claudios Abholer in Production KEINE Änderung: Er ruft
--    weiter jede Minute `sync-claim` und liest „nichts zu tun“, wie an einem ruhigen Tag.
--
-- 🔴 LAUFENDE JOBS LAUFEN ZU ENDE. `job_sync_phase`, `job_sync_finish` und `job_sync_discard` bleiben unberührt: Ein
--    übernommener Auftrag muss zum Abschluss kommen können, und in der Pause will man gerade aufräumen dürfen. Die Pause hält
--    das ÜBERNEHMEN an, nichts sonst. Das Einreihen (`job_enqueue`) bleibt auch offen — ein Wunsch ist kein Lauf.
--
-- 🪤 Fehlerrichtung: FAIL-OPEN, anders als bei den Sperren (`jobs/editor-freeze.ts` wartet bei unbekanntem Zustand). Fehlt die
--    Zeile, ist `queue_paused` in der Prüfung unten NULL, `IF NULL THEN` ist falsch, und der Claim arbeitet weiter. Das ist
--    gewollt: Eine Sperre SCHÜTZT etwas, eine Pause BREMST nur. Fail-closed hieße, ein Datenbankhusten stellt die
--    Warteschlange still, und niemand sieht warum.
--
-- 🔴 REIN ADDITIV: Drei Spalten mit `DEFAULT`, ein CHECK auf genau diesen drei, `job_sync_claim` als `CREATE OR REPLACE` von
-- seiner GELTENDEN Fassung (0129) abgeschrieben und nur um die Pausenprüfung erweitert. Keine Signatur ändert sich, keine
-- Spalte geht, keine Tafel wechselt. Das vorige Release kennt die Spalten nicht und schreibt sie nie — es kann den CHECK also
-- nicht verletzen —, und `EXECUTE` bleibt bei `CREATE OR REPLACE` erhalten: **kein Lauf von `avesmaps3d-db-grants` nötig**,
-- `apps/server/src/db/system-grants.psql` und `jobs-grants.psql` sind unverändert richtig (es entsteht keine neue Funktion, und
-- an `system_state` nimmt die Rechtedatei der App schon INSERT, DELETE und TRUNCATE weg — UPDATE braucht sie für den Schalter).
--
-- Der Eintrag in `KNOWN_EXCEPTIONS` von `apps/server/test/migration-compat.test.ts` begründet den `add-check` (Regel: ein
-- Tabellen-CHECK auf einer Tafel früherer Migrationen).

-- 1. DER SCHALTER -----------------------------------------------------------------------------------------------------------
--
-- Eine Datenbank je Umgebung, deshalb wie in 0087 keine Spalte `environment`: „ein Schalter je Umgebung“ ist diese eine Zeile.
-- Personen nur über die pseudonyme `person.id`, ohne Fremdschlüssel ins Schema `avesmaps_auth` (AUTH-0001 §5). Hat die
-- Kommandozeile geschaltet, steht `cli:<Systembenutzer>` in `queue_paused_by_label` und die Person bleibt leer.

ALTER TABLE system_state
    ADD COLUMN IF NOT EXISTS queue_paused BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS queue_paused_since TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS queue_paused_by UUID,
    ADD COLUMN IF NOT EXISTS queue_paused_by_label TEXT,
    ADD COLUMN IF NOT EXISTS queue_paused_reason TEXT
        CHECK (queue_paused_reason IS NULL OR char_length(queue_paused_reason) BETWEEN 1 AND 300);

-- Pausieren nur mit Grund (wie Einschränken und Sperren, E5 A); Fortsetzen ohne Pflicht. Und: eine Person ODER die
-- Kommandozeile, nie beides. Beide Bedingungen gelten allein für die drei neuen Spalten (Form wie 0087).
ALTER TABLE system_state
    ADD CONSTRAINT system_state_queue_paused_reason
        CHECK (NOT queue_paused OR (queue_paused_reason IS NOT NULL AND queue_paused_since IS NOT NULL)),
    ADD CONSTRAINT system_state_queue_paused_by_one
        CHECK (queue_paused_by IS NULL OR queue_paused_by_label IS NULL);

COMMENT ON COLUMN system_state.queue_paused IS
    'WI-0160: Die Warteschlange dieser Umgebung ist pausiert — job_sync_claim gibt nichts heraus, der Worker holt keinen neuen Job; laufende Jobs laufen zu Ende.';

-- 2. SCHWÄRZEN BEIM AUFLÖSEN EINES KONTOS -----------------------------------------------------------------------------------
--
-- Der Grund einer Pause ist Freitext der HANDELNDEN Person über das System, wie der Grund einer Umschaltung oder einer Sperre.
-- Er gehört damit in die Tafel `authored` von `redact_person_events()` (0087): Was sie über das System schrieb, wird
-- geschwärzt, wenn SIE aufgelöst wird, samt dem Prüfwert des Anfrageinhalts.
--
-- 🔴 Neu aus der GELTENDEN Fassung (0087) abgeschrieben, nicht aus einer älteren, und nur um EINE Zeile erweitert:
-- `('system.queue_changed', 'reason')` in `authored`. Sonst unverändert: Marke, Struktur, nur diese Person, wiederholbar,
-- `search_path` fest, PUBLIC ohne EXECUTE. Die Rechte bleiben bei `CREATE OR REPLACE` erhalten.

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
    -- Freitext, den die HANDELNDE Person über das System schreibt (kein Gegenstand, keine betroffene Person; WI-0127 SYS-2,
    -- Höhenmodell SYS-13, WI-0160 für die Pause der Warteschlange).
    --
    -- 🔴 Diese Tafel ist aus Migration 0100 abgeschrieben, der GELTENDEN Fassung, nicht aus 0087. Der erste Versuch nahm 0087
    --    und hätte dabei die drei Gründe des Höhenmodells aus der Schwärzung geworfen — gefangen hat es
    --    `apps/server/test/auth-redact-events.test.ts` („jeder Schlüssel der Positivliste ist eingeordnet“). Genau davor warnt
    --    AGENTS.md: eine Funktion wird nie aus einer alten Migration abgeschrieben.
    authored (action, key) AS (
        VALUES ('system.mode_changed', 'reason'),
               ('system.lock_changed', 'reason'),
               ('system.terrain_activated', 'reason'),
               ('system.terrain_accepted', 'reason'),
               ('system.terrain_draft_created', 'reason'),
               ('system.queue_changed', 'reason')
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

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur, wem `auth-grants.psql` es erlaubt (die App-Rolle).
REVOKE ALL ON FUNCTION avesmaps_auth.redact_person_events(uuid) FROM PUBLIC;

-- 3. DER CLAIM GIBT IN DER PAUSE NICHTS HERAUS ------------------------------------------------------------------------------
--
-- 🔴 Von der GELTENDEN Fassung (0129) abgeschrieben und um GENAU EINE Prüfung erweitert; alles andere steht Zeichen für
-- Zeichen wie dort. Die Prüfung kommt NACH der Prüfung der Art und der Lease: Ein falscher Aufruf soll auch in der Pause
-- seinen Fehler bekommen, statt still `NULL` zu lesen und den Programmierfehler zu verdecken.

CREATE OR REPLACE FUNCTION job_sync_claim(p_kind TEXT, p_lease_s INTEGER)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_id BIGINT;
    v_public UUID;
    v_domain TEXT;
    v_attempt SMALLINT;
    v_lease_no INTEGER;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full') THEN
        RAISE EXCEPTION 'job_sync_claim: % ist keine Art der Abgleiche', p_kind USING ERRCODE = '22023';
    END IF;
    IF p_lease_s IS NULL OR p_lease_s < 30 OR p_lease_s > 14400 THEN
        RAISE EXCEPTION 'job_sync_claim: Lease % s außerhalb 30 bis 14400', p_lease_s USING ERRCODE = '22023';
    END IF;
    -- WI-0160: Die Warteschlange ist pausiert — nichts wird übernommen. Fehlt die Zeile, ist das Ergebnis NULL und der Claim
    -- arbeitet weiter (fail-open, oben begründet).
    IF (SELECT s.queue_paused FROM system_state s WHERE s.id = 1) THEN
        RETURN NULL;
    END IF;
    SELECT j.id INTO v_id
      FROM job j
     WHERE j.kind = p_kind AND j.state = 'QUEUED' AND j.origin = 'queued'
       AND (j.not_before IS NULL OR j.not_before <= now())
     ORDER BY j.priority, j.queued_at, j.id
     LIMIT 1
       FOR UPDATE SKIP LOCKED;
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;
    UPDATE job SET
        state = 'RUNNING', wait_reason = NULL, lease_owner = 'korridor', lease_no = lease_no + 1,
        lease_expires_at = now() + make_interval(secs => p_lease_s), heartbeat_at = now(),
        started_at = now(), attempt = attempt + 1, phase = NULL, progress = NULL, finished_at = NULL
     WHERE id = v_id
    RETURNING public_id, map_domain_id, attempt, lease_no INTO v_public, v_domain, v_attempt, v_lease_no;
    PERFORM job_event_add(
        'job.started', v_id, v_domain,
        jsonb_build_object('jobId', v_public, 'jobKind', p_kind, 'state', 'RUNNING', 'attempt', v_attempt, 'leaseNo', v_lease_no)
    );
    RETURN v_public;
END;
$$;

COMMENT ON FUNCTION job_sync_claim(TEXT, INTEGER) IS
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154, WI-0160): uebernimmt den aeltesten wartenden Auftrag dieser Art, setzt Lease und RUNNING; NULL, wenn keiner wartet oder die Warteschlange pausiert ist. Nur fuer die Jobs-Rolle.';

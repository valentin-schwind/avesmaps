-- Abgleiche über Claudios Korridor (WI-0127 SYS-14b; Claudio 2026-10-10, `handovers/2026-10-10-abgleiche-stage-antwort.md`, Option A).
--
-- Auf Stage schreibt die Anwendung die Kartentafeln nie selbst: Ein Knopfdruck reiht wie bisher einen Auftrag ein (`job_enqueue`, 0094),
-- und mit `ABGLEICHE=korridor` holt Claudios Abholer ihn ab. Er läuft als root über einen festen Korridor-Befehl mit der Jobs-Rolle
-- (`avesmaps3d_<env>_jobs`) und meldet über drei Funktionen: übernehmen, Phase, Ende. Claudios eigene DB-Rolle bekommt kein Schreibrecht.
--
-- 🔴 REIN ADDITIV: drei neue Funktionen, kein Tabellenwechsel. SECURITY DEFINER mit festem `search_path`; PUBLIC verliert EXECUTE hier,
-- die App-Rolle über `apps/server/src/db/jobs-grants.psql` (die Default-Privilegien geben ihr jede Funktion der Migrationsrolle), und nur
-- die Jobs-Rolle bekommt es dort. Die Funktionen nehmen NUR die Arten der Abgleiche an, nur Aufträge aus der Warteschlange (`queued`),
-- und schreiben nur Zeilen, die sie selbst übernommen haben (`lease_owner = 'korridor'`).
--
-- Fortschritt grob aus Claudios Phasen (Betreiber 2026-10-10: „grob reicht, einfach ein fortschrittsbalken“): holen 0,1 · pruefen 0,25 ·
-- einspielen 0,5 · ableiten 0,75 · proben 0,9; eine andere Phase lässt den Anteil stehen.

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
    IF p_kind IS NULL OR p_kind NOT IN ('legacy_pull', 'legacy_media') THEN
        RAISE EXCEPTION 'job_sync_claim: % ist keine Art der Abgleiche', p_kind USING ERRCODE = '22023';
    END IF;
    IF p_lease_s IS NULL OR p_lease_s < 30 OR p_lease_s > 14400 THEN
        RAISE EXCEPTION 'job_sync_claim: Lease % s außerhalb 30 bis 14400', p_lease_s USING ERRCODE = '22023';
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
    'Abgleiche über den Korridor (WI-0127 SYS-14b): übernimmt den ältesten wartenden Auftrag dieser Art, setzt Lease und RUNNING; NULL, wenn keiner wartet. Nur für die Jobs-Rolle.';

CREATE OR REPLACE FUNCTION job_sync_phase(p_id UUID, p_phase TEXT, p_detail TEXT)
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_row RECORD;
    v_progress REAL;
BEGIN
    IF p_phase IS NULL OR p_phase !~ '^[a-z0-9][a-z0-9_-]{0,39}$' THEN
        RAISE EXCEPTION 'job_sync_phase: Phase % hat keinen gültigen Namen', p_phase USING ERRCODE = '22023';
    END IF;
    SELECT j.id, j.phase, j.kind, j.map_domain_id, j.progress, j.cancel_requested_at, j.lease_expires_at, j.heartbeat_at
      INTO v_row
      FROM job j
     WHERE j.public_id = p_id AND j.state = 'RUNNING' AND j.lease_owner = 'korridor'
       AND j.kind IN ('legacy_pull', 'legacy_media')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    v_progress := CASE p_phase
        WHEN 'holen' THEN 0.1
        WHEN 'pruefen' THEN 0.25
        WHEN 'einspielen' THEN 0.5
        WHEN 'ableiten' THEN 0.75
        WHEN 'proben' THEN 0.9
        ELSE v_row.progress
    END;
    -- Die Lease um dieselbe Spanne verlängern, die beim Übernehmen galt (Heartbeat und Ablauf wandern zusammen).
    UPDATE job SET
        phase = p_phase, progress = v_progress, heartbeat_at = now(),
        lease_expires_at = now() + GREATEST(v_row.lease_expires_at - v_row.heartbeat_at, interval '30 seconds')
     WHERE id = v_row.id;
    IF v_row.phase IS DISTINCT FROM p_phase THEN
        PERFORM job_event_add(
            'job.phase', v_row.id, v_row.map_domain_id,
            jsonb_build_object('jobId', p_id, 'jobKind', v_row.kind, 'state', 'RUNNING', 'phase', p_phase,
                               'detail', left(COALESCE(p_detail, ''), 200))
        );
    END IF;
    -- FALSE heißt: abbrechen (verlangt über die Statusseite); der Abholer endet dann mit job_sync_finish(…, 'skipped', …).
    RETURN v_row.cancel_requested_at IS NULL;
END;
$$;

COMMENT ON FUNCTION job_sync_phase(UUID, TEXT, TEXT) IS
    'Abgleiche über den Korridor (WI-0127 SYS-14b): Phase und grober Fortschritt, verlängert die Lease; FALSE: Abbruch verlangt oder nicht (mehr) übernommen. Nur für die Jobs-Rolle.';

CREATE OR REPLACE FUNCTION job_sync_finish(p_id UUID, p_result TEXT, p_summary TEXT)
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_row RECORD;
    v_summary TEXT := left(COALESCE(p_summary, ''), 500);
    v_reason TEXT;
BEGIN
    IF p_result IS NULL OR p_result NOT IN ('ok', 'failed', 'skipped') THEN
        RAISE EXCEPTION 'job_sync_finish: Ergebnis % ist nicht ok, failed oder skipped', p_result USING ERRCODE = '22023';
    END IF;
    SELECT j.id, j.kind, j.map_domain_id, j.attempt, j.cancel_requested_at, j.cancel_reason
      INTO v_row
      FROM job j
     WHERE j.public_id = p_id AND j.state = 'RUNNING' AND j.lease_owner = 'korridor'
       AND j.kind IN ('legacy_pull', 'legacy_media')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF p_result = 'ok' THEN
        UPDATE job SET
            state = 'SUCCEEDED', finished_at = now(), wait_reason = NULL, progress = 1,
            result = jsonb_build_object('zusammenfassung', v_summary),
            wall_ms = (extract(epoch FROM now() - started_at) * 1000)::bigint,
            error_code = NULL, error_summary = NULL
         WHERE id = v_row.id;
        PERFORM job_event_add(
            'job.succeeded', v_row.id, v_row.map_domain_id,
            jsonb_build_object('jobId', p_id, 'jobKind', v_row.kind, 'state', 'SUCCEEDED', 'unchanged', false)
        );
    ELSIF p_result = 'failed' THEN
        UPDATE job SET
            state = 'FAILED', finished_at = now(), wait_reason = NULL,
            error_code = 'korridor_failed', error_summary = v_summary,
            wall_ms = (extract(epoch FROM now() - started_at) * 1000)::bigint
         WHERE id = v_row.id;
        PERFORM job_event_add(
            'job.failed', v_row.id, v_row.map_domain_id,
            jsonb_build_object('jobId', p_id, 'jobKind', v_row.kind, 'state', 'FAILED', 'code', 'korridor_failed',
                               'attempt', v_row.attempt)
        );
    ELSE
        -- Übersprungen (Tageszug läuft, Drossel) oder auf Verlangen abgebrochen: CANCELLED mit dem Satz des Abholers.
        v_reason := CASE WHEN v_row.cancel_requested_at IS NOT NULL THEN COALESCE(v_row.cancel_reason, 'operator') ELSE 'skipped' END;
        UPDATE job SET
            state = 'CANCELLED', finished_at = now(), wait_reason = NULL, cancel_reason = v_reason,
            error_summary = NULLIF(v_summary, ''),
            wall_ms = (extract(epoch FROM now() - started_at) * 1000)::bigint
         WHERE id = v_row.id;
        PERFORM job_event_add(
            'job.cancelled', v_row.id, v_row.map_domain_id,
            jsonb_build_object('jobId', p_id, 'jobKind', v_row.kind, 'state', 'CANCELLED', 'reason', v_reason)
        );
    END IF;
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION job_sync_finish(UUID, TEXT, TEXT) IS
    'Abgleiche über den Korridor (WI-0127 SYS-14b): beendet einen übernommenen Auftrag mit ok, failed oder skipped und der Zusammenfassung (höchstens 500 Zeichen); FALSE: nicht (mehr) übernommen. Nur für die Jobs-Rolle.';

REVOKE ALL ON FUNCTION job_sync_claim(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_phase(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_finish(UUID, TEXT, TEXT) FROM PUBLIC;

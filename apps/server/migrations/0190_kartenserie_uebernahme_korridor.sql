-- Die Übernahme einer Kartenserie nach Production läuft über den Korridor (WI-0220 Schnitt 4; Claudio 2026-10-18, Handover
-- `project-control/handovers/2026-10-18-kartenverwaltung-schnitt4-korridor-gebaut-an-claudia.md`): Der Wrapper übernimmt den Auftrag
-- `map_series_production` mit `job_sync_claim_id`, der Abholer meldet Phasen mit `job_sync_phase` und beendet mit `job_sync_finish`.
-- Bisher kannten die drei Funktionen nur die Abgleiche, den Production-Zug und die Geländekette.
--
-- 🔴 REIN ADDITIV: alle drei von ihrer GELTENDEN Fassung abgeschrieben (`job_sync_claim_id` aus 0133, `job_sync_phase` und
-- `job_sync_finish` aus 0129), nur die Artenliste um `map_series_production` erweitert; dazu für diese Art eigene Stufen des
-- Fortschritts (`kopieren` 0,1 · `einspielen` 0,7 · `proben` 0,9), weil sie zuerst kopiert. Keine Signatur ändert sich;
-- `CREATE OR REPLACE` behält Eigentümer und Rechte (EXECUTE hat weiter nur die Jobs-Rolle, `jobs-grants.psql`). Das vorige Release reiht
-- die Art nie ein. Wer eine der drei Funktionen danach neu schreibt, nimmt `map_series_production` mit.

CREATE OR REPLACE FUNCTION job_sync_claim_id(p_job_id BIGINT, p_lease_s INTEGER)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_id BIGINT;
    v_kind TEXT;
    v_public UUID;
    v_domain TEXT;
    v_attempt SMALLINT;
    v_lease_no INTEGER;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'job_sync_claim_id: keine Kennung' USING ERRCODE = '22023';
    END IF;
    IF p_lease_s IS NULL OR p_lease_s < 30 OR p_lease_s > 14400 THEN
        RAISE EXCEPTION 'job_sync_claim_id: Lease % s außerhalb 30 bis 14400', p_lease_s USING ERRCODE = '22023';
    END IF;
    SELECT j.id, j.kind INTO v_id, v_kind
      FROM job j
     WHERE j.id = p_job_id
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full', 'map_series_production')
       AND j.state = 'QUEUED' AND j.origin = 'queued'
       AND (j.not_before IS NULL OR j.not_before <= now())
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
        jsonb_build_object('jobId', v_public, 'jobKind', v_kind, 'state', 'RUNNING', 'attempt', v_attempt, 'leaseNo', v_lease_no)
    );
    RETURN v_public;
END;
$$;

COMMENT ON FUNCTION job_sync_claim_id(BIGINT, INTEGER) IS
    'Gemeinsame Warteschlange (WI-0163; WI-0220 Schnitt 4: map_series_production): uebernimmt genau diesen wartenden Auftrag einer Korridor-Art, setzt Lease und RUNNING; NULL, wenn er nicht (mehr) wartet. Ohne Pausen-Riegel: die wirksame Pause haelt der Dirigent. Nur fuer die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full', 'map_series_production')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    -- WI-0220 Schnitt 4: Die Übernahme einer Kartenserie kopiert ZUERST (die übrigen Arten zuletzt); eigene Stufen nur für sie.
    IF v_row.kind = 'map_series_production' THEN
        v_progress := CASE p_phase
            WHEN 'kopieren' THEN 0.1
            WHEN 'einspielen' THEN 0.7
            WHEN 'proben' THEN 0.9
            ELSE v_row.progress
        END;
    ELSE
    v_progress := CASE p_phase
        WHEN 'holen' THEN 0.1
        WHEN 'pruefen' THEN 0.25
        WHEN 'einspielen' THEN 0.5
        WHEN 'ableiten' THEN 0.75
        WHEN 'proben' THEN 0.9
        -- WI-0141: die Kopie der Kategorie-Tafeln Stage → Production ist der letzte Schritt vor dem Postflight.
        WHEN 'kopieren' THEN 0.95
        ELSE v_row.progress
    END;
    END IF;
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
    RETURN v_row.cancel_requested_at IS NULL;
END;
$$;

COMMENT ON FUNCTION job_sync_phase(UUID, TEXT, TEXT) IS
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154, WI-0220 Schnitt 4): Phase und grober Fortschritt, verlaengert die Lease; FALSE: Abbruch verlangt oder nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

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
    v_dep RECORD;
BEGIN
    IF p_result IS NULL OR p_result NOT IN ('ok', 'failed', 'skipped') THEN
        RAISE EXCEPTION 'job_sync_finish: Ergebnis % ist nicht ok, failed oder skipped', p_result USING ERRCODE = '22023';
    END IF;
    SELECT j.id, j.kind, j.map_domain_id, j.attempt, j.cancel_requested_at, j.cancel_reason, j.input_ref
      INTO v_row
      FROM job j
     WHERE j.public_id = p_id AND j.state = 'RUNNING' AND j.lease_owner = 'korridor'
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full', 'map_series_production')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF p_result = 'ok' THEN
        UPDATE job SET
            state = 'SUCCEEDED', finished_at = now(), wait_reason = NULL, progress = 1,
            -- Die Kategorie steht im Ergebnis, damit die Zeile der Verwaltung sie ohne zweite Abfrage nennen kann.
            result = jsonb_strip_nulls(jsonb_build_object('zusammenfassung', v_summary,
                                                          'kategorie', v_row.input_ref->>'kategorie')),
            wall_ms = (extract(epoch FROM now() - started_at) * 1000)::bigint,
            error_code = NULL, error_summary = NULL
         WHERE id = v_row.id;
        PERFORM job_event_add(
            'job.succeeded', v_row.id, v_row.map_domain_id,
            jsonb_build_object('jobId', p_id, 'jobKind', v_row.kind, 'state', 'SUCCEEDED', 'unchanged', false)
        );
        IF v_row.kind = 'terrain_full' THEN
            FOR v_dep IN
                WITH erledigt AS (
                    UPDATE job j SET
                        state = 'SUCCEEDED', finished_at = now(), wait_reason = NULL, progress = 1,
                        result = jsonb_build_object('zusammenfassung', 'mit dem vollen Lauf erledigt', 'durch', p_id)
                     WHERE j.state = 'QUEUED'
                       AND j.id IN (SELECT d.job_id FROM job_dependency d WHERE d.depends_on_id = v_row.id)
                    RETURNING j.id, j.public_id, j.kind, j.map_domain_id
                )
                SELECT id, public_id, kind, map_domain_id FROM erledigt ORDER BY id
            LOOP
                PERFORM job_event_add(
                    'job.succeeded', v_dep.id, v_dep.map_domain_id,
                    jsonb_build_object('jobId', v_dep.public_id, 'jobKind', v_dep.kind, 'state', 'SUCCEEDED',
                                       'unchanged', false, 'durch', p_id)
                );
            END LOOP;
        END IF;
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
        PERFORM job_chain_cancel_waiting(v_row.id, 'dependency_failed');
    ELSE
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
        PERFORM job_chain_cancel_waiting(v_row.id, 'dependency_cancelled');
    END IF;
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION job_sync_finish(UUID, TEXT, TEXT) IS
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154, WI-0220 Schnitt 4): beendet einen uebernommenen Auftrag mit ok, failed oder skipped und der Zusammenfassung (hoechstens 500 Zeichen); die wartenden Nachfolger gehen mit (bei terrain_full und ok als erledigt). FALSE: nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

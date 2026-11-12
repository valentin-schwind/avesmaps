-- 0325: Der volle Geländelauf geht nicht mehr über den Korridor (Vali 2026-11-07: „die soll den sonderweg abschaffen, was soll der quatsch“).
--
--   Seit Claudios `c31c03fde` ist `terrain_full` in beiden Umgebungen eine App-Art (`ops/corridor/sbin/avesmaps3d-auftrag`, `app_art()`), der
--   Abholer `gelaende-abholer.sh` ist gelöscht. Die Probe in Production am 2026-11-08 03:19 war grün: `terrain_full`, `routing_reload` und
--   `display_heights` liefen als drei echte Aufträge über den Dirigenten, der Zeiger der Anzeigehöhen liefert 200
--   (`project-control/handovers/2026-11-08-gelaende-und-karten-zugang-antwort-an-claudia.md`).
--
--   Darum nehmen die sechs Korridorfunktionen `terrain_full` nicht mehr an, und `job_sync_finish` markiert keine Nachfolger mehr als erledigt,
--   ohne dass sie gelaufen sind. Das war der Sonderweg aus 0129: `corridor-import gelaende-neu production` rechnete Routing und Höhenlinien mit,
--   also galten die zwei Nachfolger als erledigt. Nach der Aktivierung von Fassung 19 am 2026-11-07 fehlten dadurch in Production die
--   Anzeigehöhen, bis Claudio sie von Hand nachholte (`848a8fd3c`).
--
-- 🔴 Abgeschrieben von den GELTENDEN Fassungen (`job_sync_claim` aus 0130, `job_sync_discard` und `job_sync_kategorie` aus 0129,
-- `job_sync_claim_id`, `job_sync_phase` und `job_sync_finish` aus 0246), geändert ist nur die Artenliste und in `job_sync_finish` der Block für
-- `terrain_full`. Keine Signatur ändert sich, keine Tafel und keine Spalte kommt oder geht; `CREATE OR REPLACE` behält Eigentümer und Rechte
-- (EXECUTE nur die Jobs-Rolle, `jobs-grants.psql`). Das vorige Release ruft die Funktionen nie selbst auf, nur der Korridor, und der nimmt
-- `terrain_full` seit `c31c03fde` nicht mehr; in Production war beim Umschalten kein `terrain_full` offen oder geleast (Claudio, ebenda).

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
    IF p_kind IS NULL OR p_kind NOT IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull') THEN
        RAISE EXCEPTION 'job_sync_claim: % ist keine Art der Abgleiche', p_kind USING ERRCODE = '22023';
    END IF;
    IF p_lease_s IS NULL OR p_lease_s < 30 OR p_lease_s > 14400 THEN
        RAISE EXCEPTION 'job_sync_claim: Lease % s außerhalb 30 bis 14400', p_lease_s USING ERRCODE = '22023';
    END IF;
    -- WI-0160: Die Warteschlange ist pausiert — nichts wird übernommen. Fehlt die Zeile, ist das Ergebnis NULL und der Claim
    -- arbeitet weiter (fail-open, in 0130 begründet).
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
    'Abgleiche ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0160; seit 0325 ohne terrain_full): uebernimmt den aeltesten wartenden Auftrag dieser Art, setzt Lease und RUNNING; NULL, wenn keiner wartet oder die Warteschlange pausiert ist. Nur fuer die Jobs-Rolle.';

CREATE OR REPLACE FUNCTION job_sync_discard(p_kind TEXT, p_reason TEXT)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_id BIGINT;
    v_public UUID;
    v_domain TEXT;
    v_reason TEXT;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull') THEN
        RAISE EXCEPTION 'job_sync_discard: % ist keine Art der Abgleiche', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '22023';
    END IF;
    -- Der Grund ist die Spur: ohne ihn wird nichts verworfen. Steuerzeichen fallen weg, die Laenge ist beschraenkt wie
    -- `detail` in `job_sync_phase`.
    v_reason := btrim(left(regexp_replace(COALESCE(p_reason, ''), '[[:cntrl:]]', ' ', 'g'), 200));
    IF v_reason = '' THEN
        RAISE EXCEPTION 'job_sync_discard: ohne Grund wird kein Auftrag verworfen' USING ERRCODE = '22023';
    END IF;
    -- Dieselbe Wahl wie `job_sync_claim`, mit EINEM Unterschied: `not_before` zaehlt nicht. Ein entprellter Auftrag
    -- wartet auch, und wer ihn verwirft, will ihn los sein und nicht erst seine Frist abwarten.
    SELECT j.id INTO v_id
      FROM job j
     WHERE j.kind = p_kind AND j.state = 'QUEUED' AND j.origin = 'queued'
     ORDER BY j.priority, j.queued_at, j.id
     LIMIT 1
       FOR UPDATE SKIP LOCKED;
    IF v_id IS NULL THEN
        RETURN 0;
    END IF;
    UPDATE job SET
        state = 'CANCELLED', cancel_reason = 'superseded', error_summary = v_reason,
        finished_at = now(), wait_reason = NULL
     WHERE id = v_id
    RETURNING public_id, map_domain_id INTO v_public, v_domain;
    PERFORM job_event_add(
        'job.cancelled', v_id, v_domain,
        jsonb_build_object('jobId', v_public, 'jobKind', p_kind, 'state', 'CANCELLED', 'reason', 'superseded',
                           'detail', v_reason)
    );
    RETURN 1 + job_chain_cancel_waiting(v_id, 'dependency_cancelled');
END;
$$;

COMMENT ON FUNCTION job_sync_discard(TEXT, TEXT) IS
    'Abgleiche ueber den Korridor (WI-0154; seit 0325 ohne terrain_full): verwirft den aeltesten wartenden Auftrag dieser Art samt seinen wartenden Nachfolgern (CANCELLED, superseded, Grund in error_summary) und gibt die Zahl der Zeilen zurueck; 0, wenn keiner wartet. Nur fuer die Jobs-Rolle.';

CREATE OR REPLACE FUNCTION job_sync_kategorie(p_id UUID)
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT j.input_ref->>'kategorie'
      FROM job j
     WHERE j.public_id = p_id
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull')
$$;

COMMENT ON FUNCTION job_sync_kategorie(UUID) IS
    'Abgleiche ueber den Korridor (WI-0141, WI-0144, WI-0154; seit 0325 ohne terrain_full): die Kategorie eines Auftrags (landschaften, wege, orte) oder NULL. Nur fuer die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'map_series_production', 'abzug_lokal',
                      'wiki_dump_holen')
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
    'Gemeinsame Warteschlange (WI-0163; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 §22: wiki_dump_holen; seit 0325 ohne terrain_full): uebernimmt genau diesen wartenden Auftrag einer Korridor-Art, setzt Lease und RUNNING; NULL, wenn er nicht (mehr) wartet. Ohne Pausen-Riegel: die wirksame Pause haelt der Dirigent. Nur fuer die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'map_series_production', 'abzug_lokal',
                      'wiki_dump_holen')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    -- WI-0253 §22: Das Holen des Dumps ruft zuerst ab, prüft dann und legt ab (WIKI_DUMP_HOLEN_PHASEN in packages/shared/src/system/wikisync-steuerung.ts).
    IF v_row.kind = 'wiki_dump_holen' THEN
        v_progress := CASE p_phase
            WHEN 'holen' THEN 0.1
            WHEN 'pruefen' THEN 0.7
            WHEN 'ablegen' THEN 0.9
            ELSE v_row.progress
        END;
    -- WI-0251: Der Abzug für lokal liest zuerst, packt dann und legt ab (ABZUG_PHASEN in packages/shared/src/system/abzug.ts).
    ELSIF v_row.kind = 'abzug_lokal' THEN
        v_progress := CASE p_phase
            WHEN 'vorbereiten' THEN 0.05
            WHEN 'lesen' THEN 0.15
            WHEN 'packen' THEN 0.8
            WHEN 'ablegen' THEN 0.95
            ELSE v_row.progress
        END;
    -- WI-0220 Schnitt 4: Die Übernahme einer Kartenserie kopiert ZUERST (die übrigen Arten zuletzt); eigene Stufen nur für sie.
    ELSIF v_row.kind = 'map_series_production' THEN
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
    'Abgleiche ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0220 Schnitt 4, WI-0251, WI-0253 §22; seit 0325 ohne terrain_full): Phase und grober Fortschritt, verlaengert die Lease; FALSE: Abbruch verlangt oder nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

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
    SELECT j.id, j.kind, j.map_domain_id, j.attempt, j.cancel_requested_at, j.cancel_reason, j.input_ref
      INTO v_row
      FROM job j
     WHERE j.public_id = p_id AND j.state = 'RUNNING' AND j.lease_owner = 'korridor'
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'map_series_production', 'abzug_lokal',
                      'wiki_dump_holen')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    -- 🔴 Seit 0325 kein Block mehr, der wartende Nachfolger als erledigt markiert: Ein Nachfolger läuft selbst oder entfällt.
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
    'Abgleiche ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0220 Schnitt 4, WI-0251, WI-0253 §22; seit 0325 ohne terrain_full und ohne Nachfolger, die ohne Lauf als erledigt gelten): beendet einen uebernommenen Auftrag mit ok, failed oder skipped und der Zusammenfassung (hoechstens 500 Zeichen); bei failed und skipped entfallen die wartenden Nachfolger. FALSE: nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

REVOKE ALL ON FUNCTION job_sync_claim(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_discard(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_kategorie(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_claim_id(BIGINT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_phase(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_finish(UUID, TEXT, TEXT) FROM PUBLIC;

-- Der Production-Zug auf der Stage (WI-0144, Migration 0126; Auftrag `project-control/handovers/2026-10-14-stage-production-zug-und-rueckweg-an-claudia.md` §1).
--
-- Betreiber 2026-10-14, wörtlich: „ich will auf der stage den button "Production-Zug holen" (da wo in Production die Legacy-Züge
-- stehen) … abgleichen kann ich nur auf der stage nur von production - für die stage ist production die einzige wahrheit. d.h.
-- unter "Abgleiche" darf auf der Stage nur "Production-Zug" stehen. Und in Production lassen wir das mal so wie jetzt.“
--
-- Eine neue Jobart `production_pull`: der Knopf reiht sie ein, Claudios Abholer übernimmt sie über den Korridor und spielt Daten,
-- Kacheln und Medien von Production auf die Stage (`ops/production/production-zug-abholer.sh`, `corridor-import production-zug`,
-- schon gebaut in `41cbe1a2`). Production wird dabei nur GELESEN.
--
-- 🔴 Sie hat bewusst KEINEN Handler in der Anwendung (`apps/server/src/jobs/handlers.ts`): Production zu lesen hat der Server
-- keinen Weg, und er soll auch keinen bekommen — dasselbe Argument wie bei der Freigabe-Statusdatei. `ABGLEICHE` lässt für diese
-- Quelle darum kein `worker` zu.
--
-- 🔴 REIN ADDITIV: `job_enqueue` und die vier Korridor-Funktionen werden von ihrer AKTUELLEN Fassung (0120) abgeschrieben und nur
-- um die Art `production_pull` erweitert. Keine Signatur ändert sich, keine Tafel wechselt, keine Spalte kommt oder geht. Das
-- vorige Release kennt die Art nicht und reiht sie nie ein; `EXECUTE` bleibt bei `CREATE OR REPLACE` erhalten, also braucht es
-- hier auch keinen `db-grants`-Lauf — `apps/server/src/db/jobs-grants.psql` ist unverändert richtig.

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
        'terrain_preview', 'path_profile', 'media_quarantine', 'kanal_bild', 'legacy_zug', 'production_pull'
    ) THEN
        RAISE EXCEPTION 'job_enqueue: Jobart % darf die Anwendung nicht einreihen', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    -- Ein Zug einer Kategorie nennt genau eine der drei. Herrschaftsgebiete gibt es hier nicht und nie (Betreiber 2026-10-13):
    -- Die Sperre steht in der Datenbank, nicht nur im Werkzeug, damit kein Aufrufer sie umgehen kann.
    IF p_kind = 'legacy_zug' AND COALESCE(p_input_ref->>'kategorie', '') NOT IN ('landschaften', 'wege', 'orte') THEN
        RAISE EXCEPTION 'job_enqueue: legacy_zug braucht die Kategorie landschaften, wege oder orte (nicht %)',
            COALESCE(p_input_ref->>'kategorie', '(leer)') USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id FROM job_insert(
        p_kind, p_kind_version, p_map_domain_id, 'queued', p_actor_ref, NULL, NULL, p_input_ref, p_priority,
        p_not_before, p_scope_kind, p_scope_tiles, p_depends_on
    ) i;
END;
$$;

COMMENT ON FUNCTION job_enqueue IS
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

-- ------------------------------------------------------------- Die vier Korridor-Funktionen nehmen `production_pull` an

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
    'Abgleiche über den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144): übernimmt den ältesten wartenden Auftrag dieser Art, setzt Lease und RUNNING; NULL, wenn keiner wartet. Nur für die Jobs-Rolle.';

/*
 * Die Kategorie eines übernommenen Zugs (WI-0141). Für `production_pull` ist sie immer NULL — die Art steht hier nur mit, damit
 * alle vier Korridor-Funktionen dieselbe Artenliste führen und `avesmaps3d-corridor-jobs sync-kategorie` (es prüft die Art
 * nicht) für jeden übernommenen Auftrag dasselbe antwortet.
 */
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
    'Abgleiche über den Korridor (WI-0141, WI-0144): die Kategorie eines Auftrags (landschaften, wege, orte) oder NULL. Nur für die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull')
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
        -- WI-0141: die Kopie der Kategorie-Tafeln Stage → Production ist der letzte Schritt vor dem Postflight.
        WHEN 'kopieren' THEN 0.95
        ELSE v_row.progress
    END;
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
    'Abgleiche über den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144): Phase und grober Fortschritt, verlängert die Lease; FALSE: Abbruch verlangt oder nicht (mehr) übernommen. Nur für die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull')
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
    'Abgleiche über den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144): beendet einen übernommenen Auftrag mit ok, failed oder skipped und der Zusammenfassung (höchstens 500 Zeichen); FALSE: nicht (mehr) übernommen. Nur für die Jobs-Rolle.';

REVOKE ALL ON FUNCTION job_sync_claim(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_kategorie(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_phase(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_finish(UUID, TEXT, TEXT) FROM PUBLIC;

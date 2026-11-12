-- 0246: Das Holen des Wiki-Dumps als Auftrag der Warteschlange (WI-0253 §22; Vali 2026-10-27: „Dump holen“ in der Systemsteuerung war nie angeschlossen).
--
--   `job_enqueue` lernt die Jobart `wiki_dump_holen`: Die Route `POST /api/admin/wikisync/dump` der Stage und von Production reiht sie ein (Recht `fetch_wiki_dump`, nur der Betreiber; in Production mit
--   frischem Passkey). Ausgeführt wird sie von Claudios Korridor (`ops/production/wiki-einrichten.sh --dump-holen --operator-approved-wiki-dump`: Sperrdatei, `.part`, `bzip2 -t`, Umbenennen, zwei
--   Stände). Die App hat dafür keinen Handler (`apps/server/src/jobs/kinds.ts`). Der Korridor übernimmt den Auftrag über `job_sync_claim_id`, meldet Phasen über `job_sync_phase` (holen 0,1 · pruefen 0,7 ·
--   ablegen 0,9) und beendet ihn mit `job_sync_finish`; darum kennen auch diese drei Funktionen die Art.
--
-- 🔴 REIN ADDITIV: Die vier Funktionen sind von ihren GELTENDEN Fassungen abgeschrieben (`job_enqueue` aus 0239, die drei `job_sync_*` aus 0218) und nur um die eine Art erweitert. Keine Signatur ändert
-- sich, keine Tafel und keine Spalte kommt oder geht. Das vorige Release reiht die Art nie ein; `CREATE OR REPLACE` behält Eigentümer und Rechte (EXECUTE hat weiter nur die Jobs-Rolle bei den
-- `job_sync_*`, `jobs-grants.psql`). Wer eine der vier Funktionen danach neu schreibt, nimmt `wiki_dump_holen` mit.

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
        'terrain_preview', 'path_profile', 'media_quarantine', 'kanal_bild', 'legacy_zug', 'production_pull',
        'land_smooth', 'label_runs', 'territory_derive', 'media_merge_all', 'path_label_runs', 'sea_derive',
        'map_series_tile', 'map_series_production', 'abzug_lokal',
        'wiki_dump_einlesen', 'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel',
        'wiki_dump_holen'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt; WI-0253 §22: wiki_dump_holen). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full', 'map_series_production', 'abzug_lokal',
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
    'Gemeinsame Warteschlange (WI-0163; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 §22: wiki_dump_holen): uebernimmt genau diesen wartenden Auftrag einer Korridor-Art, setzt Lease und RUNNING; NULL, wenn er nicht (mehr) wartet. Ohne Pausen-Riegel: die wirksame Pause haelt der Dirigent. Nur fuer die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full', 'map_series_production', 'abzug_lokal',
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
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154, WI-0220 Schnitt 4, WI-0251, WI-0253 §22): Phase und grober Fortschritt, verlaengert die Lease; FALSE: Abbruch verlangt oder nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full', 'map_series_production', 'abzug_lokal',
                      'wiki_dump_holen')
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
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154, WI-0220 Schnitt 4, WI-0251, WI-0253 §22): beendet einen uebernommenen Auftrag mit ok, failed oder skipped und der Zusammenfassung (hoechstens 500 Zeichen); die wartenden Nachfolger gehen mit (bei terrain_full und ok als erledigt). FALSE: nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

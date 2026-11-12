-- Die Geländekette über den Korridor: verwerfen und in EINEM Lauf abschließen (WI-0154, Migration 0129;
-- Auftrag `project-control/handovers/2026-10-14-vorarbeit-sieben-punkte-an-claudia.md` §4).
--
-- Betreiber 2026-10-14, wörtlich „sehr gut, ja“ auf Claudios beide Vorschläge:
--   (a) Die drei überholten Aufträge in Production (`terrain_full` „Gelände voll: Fassung 17“, `routing_reload`,
--       `display_heights`, alle eingereiht am 2026-10-13 12:44) werden verworfen, Grund „durch Wahl 18 überholt“ — die
--       geltende Wahl steht dort seit 12:51 auf Fassung 18, und Production hat keinen Worker, es ist also nichts gelaufen.
--   (b) „Aktivieren“ rechnet in Production künftig alles in einem Lauf: Claudios Abholer übernimmt `terrain_full` per
--       `job_sync_claim` und führt `corridor-import gelaende-neu production` aus; `routing_reload` und `display_heights`
--       erledigt derselbe Lauf mit (`gelaende-neu` ruft `derive:terrain` und danach `domain-terrain --activate`).
--
-- Vier Teile, alle an vorhandenen Begriffen:
--
-- 1. `job_sync_discard` — das fünfte Verb des Korridors, neben `job_sync_claim`. Es wählt wie der Claim den ältesten
--    wartenden Auftrag einer Art, setzt ihn aber auf `CANCELLED` mit `cancel_reason = 'superseded'` und dem Grund in
--    `error_summary`, und nimmt seine wartenden Nachfolger mit. 🔴 Der Weg über `job_sync_claim` und danach
--    `job_sync_finish(…, 'skipped', …)` wäre falsch: Ein Claim schreibt `started_at`, zählt `attempt` hoch und legt
--    `job.started` ab — ein Lauf, der nie stattgefunden hat. Die Warteschlange ist das Protokoll der Läufe.
--    `superseded` steht seit WI-0074 in `CANCEL_REASONS` (`packages/shared/src/jobs.ts`) und war bis heute von niemandem
--    geschrieben; es ist genau dieser Fall.
-- 2. `job_chain_cancel_waiting` — der Abbruch der wartenden Nachfolger, Wort für Wort wie `cancelDependents`
--    (`apps/server/src/jobs/store.ts`): erste Ebene mit dem genannten Grund, jede tiefere mit `dependency_cancelled`,
--    `cancel_ref_job_id` auf den Vorgänger, je Zeile ein Ereignis `job.cancelled`. 🔴 Keine zweite Semantik für dieselbe
--    Frage. Die Funktion ruft nur der Korridor über die `job_sync_*` (SECURITY DEFINER); die App-Rolle verliert ihr
--    `EXECUTE` in `apps/server/src/db/jobs-grants.psql`.
-- 3. Die Artenliste der Korridorfunktionen nimmt `terrain_full` an — und NUR ihn, nicht `routing_reload` und
--    `display_heights`: Die zwei sind Nachfolger, nie ein eigener Auftrag des Abholers, und werden allein über die Kette
--    erreicht. 🪤 Die Funktion ist in BEIDEN Umgebungen offen, und auf der Stage rechnet ein Worker `terrain_full` selbst.
--    Zwei Läufe kann es nicht geben (`FOR UPDATE SKIP LOCKED`, wer zuerst kommt, gewinnt), aber dass auf der Stage
--    niemand danach greift, entscheidet Claudios Skript: `sync-claim terrain_full` nimmt es nur mit dem Vorsatz
--    `production` an (Handover `2026-10-15-gelaendekette-verwerfen-an-claudio.md`).
-- 4. `job_sync_finish(…, 'ok', …)` schließt bei `terrain_full` die Nachfolger mit ab — ein Lauf, drei erledigte Aufträge.
--    Nur bei dieser Art: Für `legacy_zug` oder `production_pull` wäre es eine Behauptung über fremde Läufe. Die Nachfolger
--    bekommen bewusst KEIN `started_at` (sie sind erledigt, aber nie gelaufen); woran, steht in ihrem `result.durch`.
--    Bei `failed` und `skipped` entfallen sie wie überall (`dependency_failed`, `dependency_cancelled`).
--
-- 🔴 REIN ADDITIV: Die vier Korridorfunktionen und `terrain_chain_enqueue` sind von ihrer GELTENDEN Fassung (0126 bzw.
-- 0100) abgeschrieben und nur erweitert. Keine Signatur ändert sich, keine Spalte kommt oder geht, keine Tafel wechselt.
-- Das vorige Release kennt `job_sync_discard` nicht und ruft es nie; `job_sync_finish` verhält sich für jede Art, die es
-- kennt, unverändert. `EXECUTE` bleibt bei `CREATE OR REPLACE` erhalten — die zwei NEUEN Funktionen brauchen dagegen
-- einen Lauf von `avesmaps3d-db-grants` unmittelbar nach `migrate` (AGENTS.md „Migrationen“ Nr. 5, Vorbild 0067).

-- ------------------------------------------------------------- Die wartenden Nachfolger eines Auftrags abbrechen

CREATE OR REPLACE FUNCTION job_chain_cancel_waiting(p_root BIGINT, p_reason TEXT)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_level BIGINT[] := ARRAY[p_root];
    v_next BIGINT[];
    v_reason TEXT := p_reason;
    v_row RECORD;
    v_count INTEGER := 0;
BEGIN
    IF p_reason IS NULL OR p_reason NOT IN ('dependency_failed', 'dependency_cancelled') THEN
        RAISE EXCEPTION 'job_chain_cancel_waiting: Grund % ist nicht dependency_failed oder dependency_cancelled',
            COALESCE(p_reason, '(leer)') USING ERRCODE = '22023';
    END IF;
    WHILE COALESCE(array_length(v_level, 1), 0) > 0 LOOP
        v_next := '{}'::BIGINT[];
        FOR v_row IN
            WITH gebrochen AS (
                UPDATE job j SET
                    state = 'CANCELLED', cancel_reason = v_reason, finished_at = now(), wait_reason = NULL,
                    cancel_ref_job_id = (
                        SELECT min(d.depends_on_id) FROM job_dependency d
                         WHERE d.job_id = j.id AND d.depends_on_id = ANY(v_level)
                    )
                 WHERE j.state = 'QUEUED'
                   AND j.id IN (SELECT d.job_id FROM job_dependency d WHERE d.depends_on_id = ANY(v_level))
                RETURNING j.id, j.public_id, j.kind, j.map_domain_id
            )
            SELECT id, public_id, kind, map_domain_id FROM gebrochen ORDER BY id
        LOOP
            v_count := v_count + 1;
            v_next := v_next || v_row.id;
            PERFORM job_event_add(
                'job.cancelled', v_row.id, v_row.map_domain_id,
                jsonb_build_object('jobId', v_row.public_id, 'jobKind', v_row.kind, 'state', 'CANCELLED',
                                   'reason', v_reason)
            );
        END LOOP;
        v_level := v_next;
        -- Jede Ebene unter der ersten entfällt, weil ihr Vorgänger ABGEBROCHEN wurde, nicht weil er scheiterte.
        v_reason := 'dependency_cancelled';
    END LOOP;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION job_chain_cancel_waiting(BIGINT, TEXT) IS
    'WI-0154: bricht die wartenden Nachfolger eines Auftrags ab, wie cancelDependents in der Anwendung; nur fuer die job_sync_*-Funktionen.';

REVOKE ALL ON FUNCTION job_chain_cancel_waiting(BIGINT, TEXT) FROM PUBLIC;

-- ------------------------------------------------------------- Einen wartenden Auftrag verwerfen

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
    IF p_kind IS NULL OR p_kind NOT IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full') THEN
        RAISE EXCEPTION 'job_sync_discard: % ist keine Art der Abgleiche', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '22023';
    END IF;
    -- Der Grund ist die Spur: ohne ihn wird nichts verworfen. Steuerzeichen fallen weg, die Lange ist beschraenkt wie
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
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0154): verwirft den aeltesten wartenden Auftrag dieser Art samt seinen wartenden Nachfolgern (CANCELLED, superseded, Grund in error_summary) und gibt die Zahl der Zeilen zurueck; 0, wenn keiner wartet. Nur fuer die Jobs-Rolle.';

REVOKE ALL ON FUNCTION job_sync_discard(TEXT, TEXT) FROM PUBLIC;

-- ------------------------------------------------------------- Die vier Korridorfunktionen nehmen `terrain_full` an

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
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154): uebernimmt den aeltesten wartenden Auftrag dieser Art, setzt Lease und RUNNING; NULL, wenn keiner wartet. Nur fuer die Jobs-Rolle.';

/*
 * Die Kategorie eines übernommenen Zugs (WI-0141). Für `production_pull` und `terrain_full` ist sie immer NULL — die Arten
 * stehen hier nur mit, damit alle Korridorfunktionen dieselbe Artenliste führen und `avesmaps3d-corridor-jobs
 * sync-kategorie` (es prüft die Art nicht) für jeden übernommenen Auftrag dasselbe antwortet.
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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full')
$$;

COMMENT ON FUNCTION job_sync_kategorie(UUID) IS
    'Abgleiche ueber den Korridor (WI-0141, WI-0144, WI-0154): die Kategorie eines Auftrags (landschaften, wege, orte) oder NULL. Nur fuer die Jobs-Rolle.';

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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full')
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
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154): Phase und grober Fortschritt, verlaengert die Lease; FALSE: Abbruch verlangt oder nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

/*
 * Das Ende eines übernommenen Laufs. Neu in WI-0154: die wartenden NACHFOLGER gehen mit.
 *
 * - `ok` und `terrain_full`: Die Nachfolger sind ERLEDIGT. `corridor-import gelaende-neu production` ruft `derive:terrain`
 *   und danach `domain-terrain --activate`, rechnet also die Höhenlinien und die neue Routenrevision mit — ein Lauf, drei
 *   erledigte Aufträge, statt zwei Zeilen, die für immer warten. 🪤 Kein `started_at`: Sie sind erledigt, aber nie
 *   gelaufen. Nur für diese Art; bei `legacy_zug` oder `production_pull` wäre es eine Behauptung über fremde Läufe.
 * - `failed` und `skipped`: Die Nachfolger entfallen, wie überall in der Warteschlange.
 */
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
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full')
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
    'Abgleiche und Gelaendekette ueber den Korridor (WI-0127 SYS-14b, WI-0141, WI-0144, WI-0154): beendet einen uebernommenen Auftrag mit ok, failed oder skipped und der Zusammenfassung (hoechstens 500 Zeichen); die wartenden Nachfolger gehen mit (bei terrain_full und ok als erledigt). FALSE: nicht (mehr) uebernommen. Nur fuer die Jobs-Rolle.';

REVOKE ALL ON FUNCTION job_sync_claim(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_kategorie(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_phase(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_sync_finish(UUID, TEXT, TEXT) FROM PUBLIC;

-- ------------------------------------------------------------- Ein gesammelter voller Lauf nennt die geltende Fassung

/*
 * Abgeschrieben von 0100, EINE Zeile neu: Nimmt ein schon wartender voller Lauf die Anforderung auf, bekommt er auch das
 * NEUE Etikett.
 *
 * 🔴 Genau daraus entstand der Satz, den der Betreiber in Production las: „Gelände voll: Fassung 17“, während die geltende
 * Wahl seit dem 2026-10-13 12:51 auf Fassung 18 stand (Claudio, §4 seiner Vorarbeit). Der Job rechnet beim Start die
 * GELTENDE Wahl, nicht die der ersten Anforderung — das neue Etikett ist also das wahre, und das alte war eine Unwahrheit
 * in der Warteschlange.
 */
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
        UPDATE job SET
            coalesced_count = coalesced_count + 1,
            label = left(COALESCE(p_label, 'Gelände voll'), 120)
         WHERE id = v_waiting_id;
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
    'WI-0127 SYS-13, WI-0154: die volle Gelaendekette nach einem Wechsel der Fassung (terrain_full, routing_reload, display_heights); nimmt einen wartenden vollen Lauf mit und schreibt dessen Etikett auf die neue Fassung. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION terrain_chain_enqueue(TEXT, TEXT, TEXT) FROM PUBLIC;

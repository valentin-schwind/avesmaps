-- Die Warteschlange (JOBS-0001 Etappe 1, WI-0074, Betreiber 2026-10-04: „alles wie empfohlen“).
--
-- PostgreSQL IST die Queue (Kap. 5.24). Drei Tabellen und eine Sicht, Schema `public` (ADR-0010): Claudio liest sie über die
-- Allowlist, Fastify liest sie und schreibt höchstens über `job_enqueue`, der Worker schreibt mit der Jobs-Rolle
-- `avesmaps3d_<env>_jobs`. Keine Geheimnisse, keine Konten- und Personendaten: der Auslöser steht als opake `actor_ref`
-- (`readonly-allowlist.test.ts` wacht darüber).
--
-- 🔴 REIN ADDITIV (Kap. 10.41, Blue/Green, AGENTS.md „erst erweitern, dann umstellen, dann entfernen“): neue Tabellen, neue
-- Funktionen, `CREATE OR REPLACE VIEW`. Kein `DROP`, kein `RENAME`, kein `NOT NULL` auf Bestehendem. Die Sicht ruft keine
-- Funktion der Migrationsrolle auf (sonst unlesbar für `claudio`, ADR-0010) und keine neue Funktion, bevor jemand sie
-- ausführen darf (0067).
--
-- 🔴 Die Jobart steht NICHT als CHECK da. Ein neuer Name wäre sonst ein `DROP CONSTRAINT` mitten in einem Wechsel zweier
-- Server nebeneinander; jeder Slot nimmt nur Arten (`kind`, `kind_version`) an, die er kennt. Genauso `wait_reason` und
-- `cancel_reason`. Fest sind nur die fünf Zustände (Kap. 11.64).
--
-- „Hängt“ ist KEIN gespeicherter Zustand, sondern abgeleitet: `RUNNING` mit abgelaufener Lease (`lease_expires_at < now()`).
--
-- Rechte (Betreiber-Gate, Claudios Korridor `db-grants`): Migrationen bleiben rollenneutral, hier steht kein GRANT. Die
-- Soll-Rechte stehen im Handover: Jobs-Rolle schreibt `job`, `job_dependency`, `job_event`; die App-Rolle liest sie und
-- führt nur `job_enqueue` aus (SECURITY DEFINER, fester `search_path`, wie die Kachelfunktionen).

CREATE TABLE IF NOT EXISTS job (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),

    -- Identität
    kind TEXT NOT NULL,
    kind_version SMALLINT NOT NULL DEFAULT 1 CHECK (kind_version >= 1),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- `queued`: der Worker holt den Job. `recorded`: ein bestehender Ablauf (der Korridor, `legacy:update`) meldet sich selbst.
    origin TEXT NOT NULL DEFAULT 'queued' CHECK (origin IN ('queued', 'recorded')),
    -- Opake Kennung des Auslösers; Namen löst nur die Anwendung aus dem geschützten Schema auf (ADR-0013).
    actor_ref TEXT,
    -- Eine Kennung des Aufrufers (etwa der Lauf des Korridors): wer zweimal meldet, bekommt denselben aktiven Job zurück.
    external_ref TEXT,
    -- Eine kurze, namenlose Beschreibung („täglicher Zug 12:00“); nie ein Pfad, nie ein Name.
    label TEXT,
    -- Verweise und Fingerabdruck der Eingaben, nie die Eingabe selbst (Kap. 7.15).
    input_ref JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Planung
    state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    wait_reason TEXT,
    priority SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    not_before TIMESTAMPTZ,
    first_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    coalesced_count INTEGER NOT NULL DEFAULT 0 CHECK (coalesced_count >= 0),
    -- Der Fußabdruck: die ganze Domäne oder einzelne Rechenkacheln (Index der Kachel, Etappe 2).
    scope_kind TEXT NOT NULL DEFAULT 'domain' CHECK (scope_kind IN ('domain', 'tiles')),
    scope_tiles SMALLINT[] NOT NULL DEFAULT '{}',
    scope_bounds JSONB,

    -- Lauf: Lease, Heartbeat, Fencing (Kap. 5.24)
    attempt SMALLINT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    lease_owner TEXT,
    -- Steigt bei jedem Claim. Jeder schreibende Schritt trägt sie: wer eine alte Nummer hat, schreibt nichts mehr.
    lease_no INTEGER NOT NULL DEFAULT 0 CHECK (lease_no >= 0),
    lease_expires_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    phase TEXT,
    progress REAL CHECK (progress IS NULL OR progress BETWEEN 0 AND 1),
    cancel_requested_at TIMESTAMPTZ,
    cancel_reason TEXT,
    -- Der Job, dessen Ende diesen abgebrochen hat (`dependency_failed`, `dependency_cancelled`).
    cancel_ref_job_id BIGINT REFERENCES job (id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,

    -- Messung (Selbstmeldung, Kap. 10.124): Spitze RSS und ArrayBuffer, CPU und Walltime gesamt und je Phase
    rss_peak_mb INTEGER,
    arraybuffer_peak_mb INTEGER,
    cpu_ms BIGINT,
    wall_ms BIGINT,
    swap_seen_mb INTEGER,
    mem_expected_mb INTEGER,
    phase_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Befunde melden, sie halten nie an (AGENTS.md „Blockierende Prüfungen im Betrieb“): [{code, detail}]
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Ergebnis (klein: Revisionen, geänderte Kacheln) und Fehler (Klartext, kein Stacktrace, kein Pfad, kein Geheimnis)
    result JSONB,
    error_code TEXT,
    error_summary TEXT,

    -- Herkunft
    generator_version TEXT,
    recipe_version TEXT,
    release TEXT,

    CONSTRAINT job_public_id_unique UNIQUE (public_id),
    CONSTRAINT job_running_has_lease CHECK (
        state <> 'RUNNING' OR (lease_owner IS NOT NULL AND lease_no > 0 AND lease_expires_at IS NOT NULL)
    ),
    CONSTRAINT job_finished_iff_terminal CHECK (
        (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (finished_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS job_queue ON job (priority, queued_at, id) WHERE state = 'QUEUED';
CREATE INDEX IF NOT EXISTS job_running_lease ON job (lease_expires_at) WHERE state = 'RUNNING';
CREATE INDEX IF NOT EXISTS job_kind_finished ON job (kind, finished_at DESC) WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_finished_at ON job (finished_at) WHERE finished_at IS NOT NULL;
-- Wer mit derselben Kennung zweimal meldet, bekommt den aktiven Job zurück (nie zwei).
CREATE UNIQUE INDEX IF NOT EXISTS job_external_ref_active ON job (external_ref)
    WHERE external_ref IS NOT NULL AND state IN ('QUEUED', 'RUNNING');

COMMENT ON TABLE job IS
    'Ein Auftrag der Warteschlange (JOBS-0001). Fünf Zustände (Kap. 11.64); hängt = RUNNING mit abgelaufener Lease, abgeleitet.';
COMMENT ON COLUMN job.lease_no IS 'Fencing: steigt bei jedem Claim; jeder schreibende Schritt trägt sie.';
COMMENT ON COLUMN job.actor_ref IS 'Opake Kennung des Auslösers, nie ein Name (ADR-0013).';

-- Die Kette: Nachfolger warten auf ihre Vorgänger. Ein Vorgänger hat immer die kleinere Nummer: so kann es keinen Kreis geben.
CREATE TABLE IF NOT EXISTS job_dependency (
    job_id BIGINT NOT NULL REFERENCES job (id) ON DELETE CASCADE,
    depends_on_id BIGINT NOT NULL REFERENCES job (id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, depends_on_id),
    CONSTRAINT job_dependency_earlier CHECK (depends_on_id < job_id)
);

CREATE INDEX IF NOT EXISTS job_dependency_depends_on ON job_dependency (depends_on_id);

COMMENT ON TABLE job_dependency IS
    'Abhängigkeiten als Baum: scheitert oder entfällt ein Vorgänger, wird der Nachfolger CANCELLED (dependency_failed).';

-- Verlauf und Nachholen. NUR Zustands- und Phasenwechsel und Bereichsereignisse, nie Heartbeats (Kap. 7.38: kein
-- Telemetrietyp wächst unbegrenzt). Aufbewahrung kürzer als die Jobzeilen (`jobs.retention.eventKeepDays`).
CREATE TABLE IF NOT EXISTS job_event (
    seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    job_id BIGINT REFERENCES job (id) ON DELETE SET NULL,
    map_domain_id TEXT,
    scope_bounds JSONB,
    -- Wenige KB: öffentliche Kennung des Jobs, Zustand, Phase, Grund (Etappe 2: Kachelliste mit neuer Revision).
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS job_event_at ON job_event (at);
CREATE INDEX IF NOT EXISTS job_event_job ON job_event (job_id) WHERE job_id IS NOT NULL;

COMMENT ON TABLE job_event IS
    'Zustands- und Phasenwechsel der Jobs und Bereichsereignisse; `seq` ist die Nummer, ab der ein Client nachholt.';

-- Ein Ereignis schreiben und bekanntgeben. 🔴 Die Nummer wird unter einer Sperre vergeben, die bis zum Ende der Transaktion
-- hält: So werden Ereignisse in der Reihenfolge ihrer Nummer sichtbar, und ein Leser, der bis `seq` 6 gelesen hat, hat nie ein
-- noch nicht festgeschriebenes `seq` 5 übersprungen. Deshalb IMMER als letzte Anweisung der Transaktion aufrufen.
-- `NOTIFY` wird erst mit `COMMIT` zugestellt: kein Client hört je von etwas Unveröffentlichtem. Es trägt nur `seq`
-- (höchstens 8.000 Byte, nicht dauerhaft): die Wahrheit sind die Tabellen.
CREATE OR REPLACE FUNCTION job_event_add(
    p_kind TEXT,
    p_job_id BIGINT,
    p_map_domain_id TEXT,
    p_payload JSONB,
    p_scope_bounds JSONB DEFAULT NULL
) RETURNS BIGINT
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_seq BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('avesmaps3d:job-event'), 0);
    INSERT INTO job_event (kind, job_id, map_domain_id, scope_bounds, payload)
    VALUES (p_kind, p_job_id, p_map_domain_id, p_scope_bounds, COALESCE(p_payload, '{}'::jsonb))
    RETURNING seq INTO v_seq;
    PERFORM pg_notify('avesmaps3d_jobs', v_seq::text);
    RETURN v_seq;
END;
$$;

-- Einen Job anlegen, samt Abhängigkeiten und Ereignis, in EINER Transaktion (kein verlorener Auftrag, Kap. 5.24).
-- Gilt für beide Ursprünge: `queued` beginnt als QUEUED, `recorded` beginnt gleich als RUNNING (der Aufrufer ist der Ablauf).
-- Wer mit derselben `external_ref` zweimal anlegt, bekommt den aktiven Job zurück.
-- Läuft mit den Rechten des Aufrufers: nur die Jobs-Rolle darf in `job` schreiben (Soll-Rechte im Handover).
CREATE OR REPLACE FUNCTION job_insert(
    p_kind TEXT,
    p_kind_version SMALLINT,
    p_map_domain_id TEXT,
    p_origin TEXT,
    p_actor_ref TEXT,
    p_external_ref TEXT,
    p_label TEXT,
    p_input_ref JSONB,
    p_priority SMALLINT,
    p_not_before TIMESTAMPTZ,
    p_scope_kind TEXT,
    p_scope_tiles SMALLINT[],
    p_depends_on BIGINT[],
    p_lease_owner TEXT DEFAULT NULL,
    p_lease_s DOUBLE PRECISION DEFAULT NULL,
    p_phase TEXT DEFAULT NULL,
    p_mem_expected_mb INTEGER DEFAULT NULL,
    p_release TEXT DEFAULT NULL
) RETURNS TABLE (id BIGINT, public_id UUID, created BOOLEAN)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id BIGINT;
    v_public UUID;
    v_dep BIGINT;
    v_dep_state TEXT;
BEGIN
    IF p_kind IS NULL OR length(p_kind) = 0 OR length(p_kind) > 64 THEN
        RAISE EXCEPTION 'job_insert: kind fehlt oder ist zu lang' USING ERRCODE = '22023';
    END IF;
    IF p_origin NOT IN ('queued', 'recorded') THEN
        RAISE EXCEPTION 'job_insert: origin muss queued oder recorded sein' USING ERRCODE = '22023';
    END IF;
    IF p_external_ref IS NOT NULL THEN
        SELECT j.id, j.public_id INTO v_id, v_public
        FROM job j WHERE j.external_ref = p_external_ref AND j.state IN ('QUEUED', 'RUNNING');
        IF FOUND THEN
            RETURN QUERY SELECT v_id, v_public, FALSE;
            RETURN;
        END IF;
    END IF;
    IF p_depends_on IS NOT NULL THEN
        FOREACH v_dep IN ARRAY p_depends_on LOOP
            SELECT j.state INTO v_dep_state FROM job j WHERE j.id = v_dep;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'job_insert: Vorgänger % existiert nicht', v_dep USING ERRCODE = '23503';
            END IF;
            IF v_dep_state IN ('FAILED', 'CANCELLED') THEN
                RAISE EXCEPTION 'job_insert: Vorgänger % ist bereits gescheitert oder abgebrochen', v_dep
                    USING ERRCODE = '22023';
            END IF;
        END LOOP;
    END IF;

    INSERT INTO job (
        kind, kind_version, map_domain_id, origin, actor_ref, external_ref, label, input_ref, priority, not_before,
        scope_kind, scope_tiles, release,
        state, lease_owner, lease_no, lease_expires_at, heartbeat_at, started_at, attempt, phase, mem_expected_mb
    ) VALUES (
        p_kind, COALESCE(p_kind_version, 1), p_map_domain_id, p_origin, p_actor_ref, p_external_ref, p_label,
        COALESCE(p_input_ref, '{}'::jsonb), COALESCE(p_priority, 50), p_not_before,
        COALESCE(p_scope_kind, 'domain'), COALESCE(p_scope_tiles, '{}'), p_release,
        CASE WHEN p_origin = 'recorded' THEN 'RUNNING' ELSE 'QUEUED' END,
        CASE WHEN p_origin = 'recorded' THEN COALESCE(p_lease_owner, 'recorder') END,
        CASE WHEN p_origin = 'recorded' THEN 1 ELSE 0 END,
        CASE WHEN p_origin = 'recorded' THEN now() + make_interval(secs => COALESCE(p_lease_s, 900)) END,
        CASE WHEN p_origin = 'recorded' THEN now() END,
        CASE WHEN p_origin = 'recorded' THEN now() END,
        CASE WHEN p_origin = 'recorded' THEN 1 ELSE 0 END,
        p_phase, p_mem_expected_mb
    ) RETURNING job.id, job.public_id INTO v_id, v_public;

    IF p_depends_on IS NOT NULL THEN
        FOREACH v_dep IN ARRAY p_depends_on LOOP
            INSERT INTO job_dependency (job_id, depends_on_id) VALUES (v_id, v_dep) ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    PERFORM job_event_add(
        CASE WHEN p_origin = 'recorded' THEN 'job.started' ELSE 'job.queued' END,
        v_id,
        p_map_domain_id,
        jsonb_build_object(
            'jobId', v_public, 'jobKind', p_kind,
            'state', CASE WHEN p_origin = 'recorded' THEN 'RUNNING' ELSE 'QUEUED' END,
            'origin', p_origin
        )
    );
    RETURN QUERY SELECT v_id, v_public, TRUE;
END;
$$;

-- Die einzige Tür der App-Rolle (Q10): ein Editor-Auslöser reiht einen Job ein, in derselben Transaktion wie das Speichern
-- seiner Eingabe. SECURITY DEFINER mit festem `search_path`, wie die Kachelfunktionen (0014, 0058): die App-Rolle braucht
-- kein Schreibrecht auf `job`. Nur Jobarten der Editor-Auslöser: `probe` bleibt der Jobs-Rolle vorbehalten (Speicherballast
-- gehört nicht in die Hand der Anwendung, Q6), `import` und `rollout` sind Aufzeichnungen, keine Aufträge.
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
    IF p_kind IS NULL OR p_kind NOT IN ('terrain_local', 'dem_publish', 'display_heights', 'routing_reload') THEN
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

COMMENT ON FUNCTION job_enqueue IS
    'Einreihen durch einen Editor-Auslöser (Q10). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

-- Claudios Leseweg (Kap. 10.165): deterministisch, ohne Modellaufruf. Eine Zeile je Jobart. Keine Funktion der
-- Migrationsrolle, nur eingebaute: sonst wäre die Sicht für `claudio` unlesbar (ADR-0010).
CREATE OR REPLACE VIEW job_health AS
SELECT
    kind,
    count(*) FILTER (WHERE state = 'QUEUED') AS queued,
    count(*) FILTER (WHERE state = 'RUNNING' AND lease_expires_at >= now()) AS running,
    -- hängt: RUNNING mit abgelaufener Lease
    count(*) FILTER (WHERE state = 'RUNNING' AND lease_expires_at < now()) AS stalled,
    min(queued_at) FILTER (WHERE state = 'QUEUED') AS oldest_queued_at,
    max(extract(epoch FROM now() - queued_at)) FILTER (WHERE state = 'QUEUED') AS oldest_queued_s,
    max(extract(epoch FROM now() - started_at)) FILTER (WHERE state = 'RUNNING') AS longest_running_s,
    count(*) FILTER (WHERE state = 'SUCCEEDED' AND finished_at > now() - interval '24 hours') AS succeeded_24h,
    count(*) FILTER (WHERE state = 'FAILED' AND finished_at > now() - interval '24 hours') AS failed_24h,
    count(*) FILTER (WHERE state = 'CANCELLED' AND finished_at > now() - interval '24 hours') AS cancelled_24h,
    count(*) FILTER (
        WHERE finished_at > now() - interval '24 hours' AND findings @> '[{"code": "swap_in_use"}]'::jsonb
    ) AS swap_24h,
    count(*) FILTER (
        WHERE finished_at > now() - interval '24 hours' AND findings @> '[{"code": "budget_exceeded"}]'::jsonb
    ) AS budget_exceeded_24h,
    count(*) FILTER (
        WHERE state = 'FAILED' AND error_code = 'lease_expired_exhausted' AND finished_at > now() - interval '24 hours'
    ) AS lease_expired_24h,
    max(rss_peak_mb) FILTER (WHERE finished_at > now() - interval '24 hours') AS rss_peak_mb_24h,
    (percentile_cont(0.50) WITHIN GROUP (ORDER BY wall_ms) FILTER (WHERE state = 'SUCCEEDED' AND wall_ms IS NOT NULL)) / 1000.0
        AS p50_wall_s,
    (percentile_cont(0.95) WITHIN GROUP (ORDER BY wall_ms) FILTER (WHERE state = 'SUCCEEDED' AND wall_ms IS NOT NULL)) / 1000.0
        AS p95_wall_s
FROM job
GROUP BY kind;

COMMENT ON VIEW job_health IS
    'Claudios Leseweg (Kap. 10.165): wartende, laufende und hängende Jobs, ältester wartender, FAILED im Fenster, laufend gegen p95, Befunde. Eine Zeile je Jobart.';

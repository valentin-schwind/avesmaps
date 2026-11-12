-- Folgeaufträge der Schreibnaht gleitend sammeln (WI-0229; Hauptorchestrierung 2026-10-19 „A, gleitend wie beim Gelände (10 s Ruhe,
-- höchstens 120 s nach der ersten Speicherung)“, wiederverwendbar für die Folgearten; Claudio 2026-10-19: 120 s Obergrenze in Ordnung,
-- Handover `2026-10-19-gebietsableitung-gleitend-antwort-an-claudia.md`).
--
-- `job_sammeln` ist der wartende Auftrag dieser Art und Eingabe in der Domäne oder ein neuer: Liegt einer, schiebt die Speicherung seinen
-- Start auf `jetzt + p_quiet_s`, höchstens auf `queued_at + p_max_s`; sonst reiht sie einen ein, der nach `p_quiet_s` startet. Eine
-- einzelne Speicherung steht damit nach der Ruhe auf der Karte, eine Folge von Speicherungen spätestens nach der Obergrenze. Ein laufender
-- Auftrag nimmt nichts mehr auf; was währenddessen gespeichert wird, sammelt der nächste.
--
-- Die Sperre je Art und Domäne (`pg_advisory_xact_lock`) hält zwei gleichzeitige Speicherungen davon ab, je einen Auftrag einzureihen.
--
-- Der Bereich kommt vom Aufrufer wie bei `job_enqueue`: Eine Art ohne Kartenfußabdruck (die Ableitung der Herrschaftsgebiete) reiht mit
-- `tiles` ohne Kacheln ein und schneidet so keinen Auftrag mit Kachelbereich, etwa das Gelände im Umkreis (Hauptorchestrierung 2026-10-19).
--
-- 🔴 REIN ADDITIV: eine neue Funktion; `job_enqueue` bleibt, wie es ist. Nur die Folgearten der Schreibnaht (die Liste unten).

CREATE OR REPLACE FUNCTION job_sammeln(
    p_kind TEXT,
    p_kind_version SMALLINT,
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_input_ref JSONB,
    p_priority SMALLINT,
    p_quiet_s INTEGER,
    p_max_s INTEGER,
    p_scope_kind TEXT DEFAULT 'domain',
    p_scope_tiles SMALLINT[] DEFAULT '{}'
) RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_id BIGINT;
    v_public UUID;
    v_queued_at TIMESTAMPTZ;
    v_input JSONB := COALESCE(p_input_ref, '{}'::jsonb);
    v_quiet INTERVAL := make_interval(secs => GREATEST(COALESCE(p_quiet_s, 0), 0));
    v_max INTERVAL := make_interval(secs => GREATEST(COALESCE(p_max_s, 0), COALESCE(p_quiet_s, 0), 0));
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('territory_derive', 'land_smooth', 'label_runs', 'path_profile', 'path_label_runs') THEN
        RAISE EXCEPTION 'job_sammeln: Jobart % sammelt die Anwendung nicht', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('job_sammeln'), hashtext(p_kind || '/' || COALESCE(p_map_domain_id, '')));
    SELECT j.id, j.public_id, j.queued_at INTO v_id, v_public, v_queued_at
      FROM job j
     WHERE j.kind = p_kind AND j.map_domain_id = p_map_domain_id AND j.state = 'QUEUED'
       AND j.input_ref @> v_input AND v_input @> j.input_ref
     ORDER BY j.id LIMIT 1
       FOR UPDATE;
    IF v_id IS NOT NULL THEN
        -- Ruhe ab jetzt, aber nie über die Obergrenze ab der ersten Speicherung hinaus.
        UPDATE job SET not_before = LEAST(now() + v_quiet, v_queued_at + v_max) WHERE id = v_id;
        RETURN v_public;
    END IF;
    SELECT e.public_id INTO v_public
      FROM job_enqueue(p_kind, p_kind_version, p_map_domain_id, p_actor_ref, v_input, p_priority, now() + v_quiet,
                       p_scope_kind, p_scope_tiles) e;
    RETURN v_public;
END;
$$;

COMMENT ON FUNCTION job_sammeln(TEXT, SMALLINT, TEXT, TEXT, JSONB, SMALLINT, INTEGER, INTEGER, TEXT, SMALLINT[]) IS
    'WI-0229: ein Folgeauftrag der Schreibnaht, gleitend gesammelt; jede Speicherung schiebt den Start auf jetzt + p_quiet_s, hoechstens queued_at + p_max_s. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION job_sammeln(TEXT, SMALLINT, TEXT, TEXT, JSONB, SMALLINT, INTEGER, INTEGER, TEXT, SMALLINT[]) FROM PUBLIC;

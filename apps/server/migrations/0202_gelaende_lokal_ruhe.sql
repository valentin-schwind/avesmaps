-- Gelände im Umkreis: warten, bis Ruhe ist (WI-0223; Betreiber 2026-10-18 über Claudio, wörtlich „1. A, warten bis Ruhe ist
-- (empfohlen)“, Handover `2026-10-18-betreiber-antworten-gelaende-pruefungen-an-claudia.md` §1).
--
-- Statt einer festen Sammelzeit ab der ersten Speicherung (0169, `p_delay_s`) schiebt jede weitere Speicherung den Start des wartenden
-- `terrain_local` auf `jetzt + p_quiet_s`, höchstens aber auf `queued_at + p_max_s`. Arbeiten zwei Editoren länger, rechnet das Gelände
-- erst, wenn eine Weile niemand eine Fläche, einen Fluss oder einen Gipfel gespeichert hat, und doch spätestens nach `p_max_s`. Laufende
-- Rechnungen bricht nichts ab; was während eines Laufs gespeichert wird, sammelt wie bisher der wartende Auftrag dahinter.
--
-- 🔴 REIN ADDITIV („erst erweitern“): eine zweite Form von `terrain_local_enqueue` mit fünf Argumenten. Die Form mit vier aus 0169
-- bleibt, solange ein Release sie ruft; ein späteres Release entfernt sie. Rumpf sonst wie 0169.

CREATE OR REPLACE FUNCTION terrain_local_enqueue(
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_tiles SMALLINT[],
    p_quiet_s INTEGER,
    p_max_s INTEGER
) RETURNS TABLE (local_job UUID, publish_job UUID)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_local_id BIGINT;
    v_local_public UUID;
    v_tiles SMALLINT[];
    v_scope TEXT;
    v_queued_at TIMESTAMPTZ;
    v_quiet INTERVAL := make_interval(secs => GREATEST(COALESCE(p_quiet_s, 0), 0));
    v_max INTERVAL := make_interval(secs => GREATEST(COALESCE(p_max_s, 0), COALESCE(p_quiet_s, 0), 0));
    v_publish_id BIGINT;
    v_publish_public UUID;
BEGIN
    SELECT j.id, j.public_id, j.scope_tiles, j.queued_at INTO v_local_id, v_local_public, v_tiles, v_queued_at
      FROM job j
     WHERE j.kind = 'terrain_local' AND j.map_domain_id = p_map_domain_id AND j.state = 'QUEUED'
     ORDER BY j.id LIMIT 1
       FOR UPDATE;
    IF v_local_id IS NOT NULL THEN
        IF cardinality(v_tiles) > 0 AND cardinality(COALESCE(p_tiles, '{}')) > 0 THEN
            v_tiles := ARRAY(SELECT DISTINCT t FROM unnest(v_tiles || p_tiles) t ORDER BY t);
            v_scope := 'tiles';
        ELSE
            v_tiles := '{}';
            v_scope := 'domain';
        END IF;
        UPDATE job SET
            scope_kind = v_scope,
            scope_tiles = v_tiles,
            coalesced_count = coalesced_count + 1,
            -- Ruhe ab jetzt, aber nie über die Obergrenze ab der ersten Speicherung hinaus.
            not_before = LEAST(now() + v_quiet, v_queued_at + v_max),
            label = left(format('Gelände lokal, %s Rechenkacheln', cardinality(v_tiles)), 120)
         WHERE id = v_local_id;
        UPDATE job SET scope_kind = v_scope, scope_tiles = v_tiles
         WHERE kind = 'dem_publish' AND state = 'QUEUED'
           AND id IN (SELECT d.job_id FROM job_dependency d WHERE d.depends_on_id = v_local_id)
        RETURNING public_id INTO v_publish_public;
        RETURN QUERY SELECT v_local_public, v_publish_public;
        RETURN;
    END IF;

    v_tiles := COALESCE(p_tiles, '{}');
    v_scope := CASE WHEN cardinality(v_tiles) > 0 THEN 'tiles' ELSE 'domain' END;
    SELECT i.id, i.public_id INTO v_local_id, v_local_public
      FROM job_insert('terrain_local', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                      left(format('Gelände lokal, %s Rechenkacheln', cardinality(v_tiles)), 120), '{}'::jsonb, 30::smallint,
                      now() + v_quiet, v_scope, v_tiles, NULL) i;
    SELECT i.id, i.public_id INTO v_publish_id, v_publish_public
      FROM job_insert('dem_publish', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                      'Gelände veröffentlichen', jsonb_build_object('candidateJob', v_local_public), 20::smallint, NULL,
                      v_scope, v_tiles, ARRAY[v_local_id]) i;
    PERFORM 1 FROM job_insert('routing_reload', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                              'Routenrechner nach lokaler Veröffentlichung', '{}'::jsonb, 20::smallint, NULL, 'tiles', '{}',
                              ARRAY[v_publish_id]);
    PERFORM 1 FROM job_insert('display_heights', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, NULL,
                              'Höhenlinien nach lokaler Veröffentlichung', '{}'::jsonb, 60::smallint, NULL, 'tiles', '{}',
                              ARRAY[v_publish_id]);
    RETURN QUERY SELECT v_local_public, v_publish_public;
END;
$$;

COMMENT ON FUNCTION terrain_local_enqueue(TEXT, TEXT, SMALLINT[], INTEGER, INTEGER) IS
    'WI-0223: die lokale Gelaendekette; ein wartender terrain_local nimmt die Speicherung mit, vereinigt den Bereich und startet erst nach p_quiet_s Ruhe, hoechstens p_max_s nach der ersten Speicherung (Betreiber 2026-10-18). SECURITY DEFINER.';

REVOKE ALL ON FUNCTION terrain_local_enqueue(TEXT, TEXT, SMALLINT[], INTEGER, INTEGER) FROM PUBLIC;

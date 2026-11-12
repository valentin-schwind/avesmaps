-- Das Gelände im Umkreis einer Änderung als Folge der Schreibnaht (WI-0223 Schritt 1; Betreiber 2026-10-18 „Geländerechnung: A“,
-- SYS-0001 §9c.11, JOBS-0001 Etappe 3).
--
-- `terrain_local_enqueue` reiht die lokale Kette ein: `terrain_local` → `dem_publish` → `routing_reload` und `display_heights`, wie
-- `enqueueTerrainLocal` (`jobs/terrain-chain.ts`) für die Kommandozeile. Gerufen wird sie in der Transaktion einer Operation, die
-- etwas geändert hat, das ins Gelände eingeht (`editor/gelaende-folgen.ts`), und nur unter einer Fassung mit regionaler
-- Rückverteilung.
--
-- - **Zusammenfassen:** Wartet schon ein `terrain_local` der Domäne, nimmt er die Speicherung mit. Sein Bereich (`scope_tiles`) wird
--   um den neuen vereinigt, ebenso der seines `dem_publish`, und `coalesced_count` zählt hoch. Welche Kacheln er rechnet, bestimmt
--   der Job beim Start selbst aus dem Eingabeindex; der Bereich hier ist die Sperre für die Reihenfolge je Bereich.
-- - **Sammelzeit** `p_delay_s`: Der erste Auftrag wartet so lange, damit eine Folge von Speicherungen einen Lauf ergibt.
-- - **Ohne Kacheln** (der Aufrufer kennt keinen Bereich) gilt die ganze Domäne als Bereich.
-- - **Antwort:** die Kennungen von `terrain_local` und seinem `dem_publish`. Der Editor verfolgt den zweiten: Endet er, ist das Gelände
--   im Umkreis fertig (`area.changed` kam davor im Kanal `area`), gescheitert oder abgebrochen.
--
-- SECURITY DEFINER wie `terrain_chain_enqueue` (0129): Die App-Rolle schreibt `job` nicht selbst. 🔴 REIN ADDITIV: eine neue
-- Funktion, keine Tafel, keine Spalte, keine bestehende Funktion geändert.

CREATE OR REPLACE FUNCTION terrain_local_enqueue(
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_tiles SMALLINT[],
    p_delay_s INTEGER
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
    v_publish_id BIGINT;
    v_publish_public UUID;
BEGIN
    SELECT j.id, j.public_id, j.scope_tiles INTO v_local_id, v_local_public, v_tiles
      FROM job j
     WHERE j.kind = 'terrain_local' AND j.map_domain_id = p_map_domain_id AND j.state = 'QUEUED'
     ORDER BY j.id LIMIT 1
       FOR UPDATE;
    IF v_local_id IS NOT NULL THEN
        -- Ein wartender Lauf über die ganze Domäne bleibt es; sonst die Vereinigung der Bereiche.
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
                      now() + make_interval(secs => GREATEST(COALESCE(p_delay_s, 0), 0)), v_scope, v_tiles, NULL) i;
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

COMMENT ON FUNCTION terrain_local_enqueue(TEXT, TEXT, SMALLINT[], INTEGER) IS
    'WI-0223: die lokale Gelaendekette als Folge der Schreibnaht (terrain_local, dem_publish, routing_reload, display_heights); ein wartender terrain_local nimmt die Speicherung mit und vereinigt den Bereich. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION terrain_local_enqueue(TEXT, TEXT, SMALLINT[], INTEGER) FROM PUBLIC;

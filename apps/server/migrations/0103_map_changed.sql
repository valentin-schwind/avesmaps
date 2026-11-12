-- Ableitungen nach einer Kartenoperation (WI-0128 E13, EDIT-0001 §6.3, N6, N8).
--
-- 1. `map_event_add`: Das Ereignis `map.changed` geht wie die Bereichsereignisse (`area.changed`, 0070/WI-0125) in `job_event` und über
--    `/ws` im Kanal `area` an die Karten. Die App-Rolle darf `job_event_add` auf dem VPS nicht ausführen (nur die Jobs-Rolle,
--    `runtime-foundation.sh`); diese Funktion ist ihre einzige Tür dafür, mit fester Art und ohne Job. Die Schreibnaht ruft sie IN der
--    Transaktion der Operation (`editor/map-operation.ts`): Ein Ereignis nach dem Commit erzählt nie von Unveröffentlichtem.
-- 2. `job_enqueue` um die Jobart `path_profile` (die Wegprofile der Wege, die eine Operation bewegt hat): Argumentliste aus ihrer
--    AKTUELLEN Fassung (0100) abgeschrieben und nur erweitert.
--
-- 🔴 REIN ADDITIV: eine neue Funktion, eine erweiterte Positivliste. Das vorige Release ruft keine von beiden neu; es reiht die alten
-- Arten weiter ein. Wer `job_enqueue` nach dieser Migration neu schreibt, nimmt `path_profile` mit.

CREATE OR REPLACE FUNCTION map_event_add(
    p_map_domain_id TEXT,
    p_payload JSONB,
    p_scope_bounds JSONB DEFAULT NULL
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_map_domain_id IS NULL OR NOT EXISTS (SELECT 1 FROM map_domain WHERE id = p_map_domain_id) THEN
        RAISE EXCEPTION 'map_event_add: unbekannte Domäne %', COALESCE(p_map_domain_id, '(leer)') USING ERRCODE = '22023';
    END IF;
    RETURN job_event_add('map.changed', NULL, p_map_domain_id, COALESCE(p_payload, '{}'::jsonb), p_scope_bounds);
END;
$$;
REVOKE ALL ON FUNCTION map_event_add(TEXT, JSONB, JSONB) FROM PUBLIC;
COMMENT ON FUNCTION map_event_add(TEXT, JSONB, JSONB) IS
    'Ereignis map.changed nach einer Kartenoperation (WI-0128 E13): job_event ohne Job, Kanal area. Gibt die Nummer (seq) zurück, die zugleich die Kachelrevision ist.';

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
        'terrain_preview', 'path_profile'
    ) THEN
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

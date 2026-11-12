-- Die Medienverwaltung darf ihren Abgleich einreihen (WI-0068 P4a): `job_enqueue` nimmt die Jobart `media_settle` an.
--
-- Hochladen, Binden und Lösen eines Bildes legen nur Bytes und Zeilen ab; Dekodieren, Rendern und die öffentliche Fassung macht der
-- Worker (Claudio, `handovers/2026-10-04-media-m7-sharp-antwort.md`: die Rasterpipeline läuft in der Queue, nie im Fastify-Prozess).
-- Die App-Rolle reiht dafür über `job_enqueue` ein, in derselben Transaktion wie die Operation (ADR-0019 Nr. 5); sie hat kein
-- Schreibrecht auf `job` und führt `job_insert` nicht aus (0070, Q10).
--
-- 🔴 ADDITIV: dieselbe Funktion mit derselben Argumentliste, abgeschrieben von ihrer AKTUELLEN Fassung (0070, die einzige) und nur
-- um `media_settle` in der Liste erweitert. Das Recht EXECUTE bleibt bei `CREATE OR REPLACE` erhalten; das vorige Release kennt die
-- Jobart nicht und reiht sie nie ein. `probe`, `import` und `rollout` bleiben der Anwendung verwehrt.
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
    IF p_kind IS NULL OR p_kind NOT IN ('terrain_local', 'dem_publish', 'display_heights', 'routing_reload', 'media_settle') THEN
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
    'Einreihen durch einen Editor-Auslöser (Q10, WI-0068 P4a: auch media_settle). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

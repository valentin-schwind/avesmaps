-- Die Verwaltung darf einen Abgleich einreihen (WI-0127 SYS-14, SYS-0001 §9b): `job_enqueue` nimmt die Jobarten `legacy_pull` (der
-- Legacy-Zug) und `legacy_media` (die Medien aus Legacy) an.
--
-- Betreiber 2026-10-10: „du kannst "Zieh mal" auch in die verwaltung tun, dann brauch ichs dir nicht sagen“. Der Knopf „⇄ Jetzt
-- abgleichen“ (nur die Betreiber-Vorlage, `run_legacy_sync`) reiht in derselben Transaktion wie das Protokoll ein, mit der Person als
-- Auslöser; der Worker startet das Werkzeug mit `--auftrag <Job>`. Die App-Rolle hat kein Schreibrecht auf `job` (0070, Q10).
--
-- 🔴 ADDITIV: dieselbe Funktion mit derselben Argumentliste, abgeschrieben von ihrer AKTUELLEN Fassung (0090) und nur um die zwei
-- Jobarten erweitert. Das Recht EXECUTE bleibt bei `CREATE OR REPLACE` erhalten; das vorige Release kennt die Arten nicht und reiht sie
-- nie ein. `probe`, `import` und `rollout` bleiben der Anwendung verwehrt.
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
        'terrain_local', 'dem_publish', 'display_heights', 'routing_reload', 'media_settle', 'legacy_pull', 'legacy_media'
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

COMMENT ON FUNCTION job_enqueue IS
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

-- Der Sammellauf „Alle bytegleichen Duplikate zusammenführen“ als Auftrag der Warteschlange (WI-0068, Betreiber 2026-10-17;
-- Claudios Einschätzung `project-control/handovers/2026-10-17-medienverwaltung-antworten-an-claudia.md` §3).
--
-- `job_enqueue` lernt die Jobart `media_merge_all`. Eingereiht wird sie von der Operation `media.merge_all` (nur Betreiber,
-- `merge_media_all`), mit der Person als Auslöser; gerechnet wird als Jobs-Rolle. Ihre Rechte stehen in
-- `apps/server/src/db/media-grants.psql`.
--
-- 🔴 REIN ADDITIV: `job_enqueue` von ihrer GELTENDEN Fassung (0147) abgeschrieben und nur um die eine Art erweitert. Keine Signatur
-- ändert sich, keine Tafel und keine Spalte kommt oder geht. Das vorige Release kennt die Art nicht und reiht sie nie ein;
-- `CREATE OR REPLACE` behält Eigentümer und Rechte. Wer `job_enqueue` nach dieser Migration neu schreibt, nimmt `media_merge_all`
-- mit.

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
        'land_smooth', 'label_runs', 'territory_derive', 'media_merge_all'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

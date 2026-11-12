-- 0239: `job_enqueue` lernt `wiki_dump_einlesen` (WI-0253, erster WikiSync-Lauf auf der Stage, 2026-10-26).
--
--   Der Auftrag `wiki_dump_einlesen` steht seit B-1 im Katalog der Warteschlange (`apps/server/src/jobs/kinds.ts`, `jobs/wiki-dump-jobs.ts`), und der Auftrags-Wrapper kennt ihn. Nur die Tür der
--   App-Rolle, `job_enqueue`, ließ ihn nie zu: Die Liste erlaubter Arten (0237) nennt `wiki_vorschau`, `wiki_uebernehmen`, `wiki_zuruecknehmen`, `wiki_kategorien` und `wiki_artikel`, aber nicht
--   ihn. Wer ihn einreihen wollte (Claudio, am echten Dump), bekam 42501 „Jobart wiki_dump_einlesen darf die Anwendung nicht einreihen“.
--
--   Alle Wiki-Arten des Katalogs sind damit erlaubt; `apps/server/test/wikisync-uebernahme.test.ts` prüft es gegen den Katalog („jede Wiki-Art ist einreihbar“), damit die nächste Art nicht wieder fehlt.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): `job_enqueue` von ihrer geltenden Fassung (0237) abgeschrieben und um EINE Art erweitert; die Argumentliste bleibt, jede bisherige Art bleibt erlaubt.
-- Keine Tafel, keine Spalte, keine Datenänderung. Rechte: unverändert (`CREATE OR REPLACE` behält Besitzerin und EXECUTE); `apps/server/src/db/system-grants.psql` läuft hinter JEDER Migration.

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
        'wiki_dump_einlesen', 'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

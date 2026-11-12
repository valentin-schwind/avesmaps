-- Karten herunterladen (WI-0280): die befristeten Zugänge zu den Kartendateien und ihre Abrufe.
--
-- Ein Zugang ist ein Token-Link (Empfängerseite `/paket#…`) oder ein API-Schlüssel (`Authorization: Bearer avk_…`). Er gilt für genau die Karten in
-- `karten`, bis zum Ablauf oder Widerruf, und solange die Person, die ihn anlegte, aktiv ist. Gespeichert wird nur sein SHA-256 (32 Byte Zufall, wie
-- Sitzungen und Abzugs-Schlüssel, `auth/tokens.ts`); `kennung` sind die ersten Zeichen des Werts zum Wiedererkennen, kein Geheimnis.
--
-- `karten_abruf` ist die Liste im Fenster: wer lud wann was (ein Zugang oder eine angemeldete Person), ohne IP und ohne Geheimnis. Das Protokoll steht
-- daneben in `avesmaps_auth.security_event`.
--
-- `job_enqueue` lernt die Jobart `karten_svg` (die Vektorkarte zeichnen); `CREATE OR REPLACE` behält Eigentümer und Rechte, die Signatur bleibt.
--
-- 🔴 REIN ADDITIV: zwei neue Tafeln in `public`; das Default-Privileg gibt sie der App-Rolle, `system-grants.psql` nimmt ihr das Löschen. Das vorige
-- Release kennt sie nicht und braucht sie nicht. Kartendaten berührt das nicht.

CREATE TABLE IF NOT EXISTS karten_zugang (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    art TEXT NOT NULL CHECK (art IN ('link', 'schluessel')),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    kennung TEXT NOT NULL CHECK (char_length(kennung) BETWEEN 4 AND 16),
    fuer_wen TEXT NOT NULL CHECK (char_length(fuer_wen) BETWEEN 1 AND 80),
    karten TEXT[] NOT NULL CHECK (cardinality(karten) BETWEEN 1 AND 32),
    created_by UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    ersetzt UUID REFERENCES karten_zugang (id),
    last_used_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS karten_zugang_art_idx ON karten_zugang (art, created_at DESC);

COMMENT ON TABLE karten_zugang IS
    'WI-0280: Token-Links und API-Schlüssel für die Kartendateien (nur Hash); lesen, anlegen, ändern, nie löschen.';

CREATE TABLE IF NOT EXISTS karten_abruf (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zugang_id UUID REFERENCES karten_zugang (id),
    person_id UUID REFERENCES avesmaps_auth.person (id),
    karten TEXT[] NOT NULL,
    bytes BIGINT NOT NULL CHECK (bytes >= 0),
    geliefert BIGINT NOT NULL DEFAULT 0 CHECK (geliefert >= 0),
    zustand TEXT NOT NULL DEFAULT 'laeuft' CHECK (zustand IN ('laeuft', 'vollstaendig', 'abgebrochen')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS karten_abruf_zugang_idx ON karten_abruf (zugang_id, started_at DESC);

COMMENT ON TABLE karten_abruf IS
    'WI-0280: Abrufe der Kartendateien, für die Liste im Fenster; ohne IP und ohne Geheimnis.';

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
        'wiki_dump_einlesen', 'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel',
        'wiki_dump_holen', 'sprache_treffer', 'community_mail_versand', 'social_senden', 'karten_svg'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt; WI-0253 §22: wiki_dump_holen; WI-0261 S4: sprache_treffer; WI-0268 C6a: community_mail_versand; WI-0268 C12a: social_senden). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

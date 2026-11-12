-- Quarantäne veröffentlichter Mediendateien (WI-0127 SYS-10 Teil b3; SYS-0001 §3.4 „Bilder hart“; Betreiber §9a Frage 1 B: die
-- Bilder-Schalter nehmen die Dateien aus der Auslieferung). Der Mechanismus ist generisch für Mengen von Bytes; die Inhaltsschalter
-- nutzen ihn als Grund `content_switch`, der Einzelbild-Notaus aus WI-0068 später als `asset_suspension`. Vertrag: WI-0127 §19.6.
--
-- 1. `media_quarantine`: je (Bytes der veröffentlichten Datei, Grund) höchstens eine aktive Zeile. Die Datei liegt unter
--    `private/quarantine/sha256/…`, solange irgendein Grund für ihre Bytes aktiv ist; fällt der letzte weg, wandert sie zurück nach
--    `published/`. Aufgehoben wird mit `restored_at`, gelöscht wird nie: die Zeilen sind zugleich der Verlauf.
-- 2. `job_enqueue` um die Jobart `media_quarantine` (der Abgleich nach einer Umschaltung): Argumentliste aus ihrer AKTUELLEN Fassung
--    (0103) abgeschrieben und nur erweitert. Wer `job_enqueue` nach dieser Migration neu schreibt, nimmt `media_quarantine` mit.
--
-- 🔴 REIN ADDITIV: eine neue Tafel, eine erweiterte Positivliste. Das vorige Release liest die Tafel nicht und reiht die alten Arten
-- weiter ein. Rechte: `apps/server/src/db/media-grants.psql` (die App liest nur, die Jobs-Rolle legt an und hebt auf, niemand löscht).

CREATE TABLE IF NOT EXISTS media_quarantine (
    id BIGSERIAL PRIMARY KEY,
    -- Die Bytes der veröffentlichten Datei (`media_file.sha256`, Klasse `published`): Alle Assets mit denselben Bytes teilen sie.
    sha256 TEXT NOT NULL,
    reason_kind TEXT NOT NULL,
    -- Woran es hing, für Menschen: die Schalter, die gerade aus sind, oder die Nummer des Notaus. Keine Person.
    detail TEXT,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    restored_at TIMESTAMPTZ,
    CONSTRAINT media_quarantine_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_quarantine_reason_known CHECK (reason_kind IN ('content_switch', 'asset_suspension')),
    CONSTRAINT media_quarantine_restore_after CHECK (restored_at IS NULL OR restored_at >= quarantined_at)
);
COMMENT ON TABLE media_quarantine IS
    'Quarantäne veröffentlichter Mediendateien (WI-0127 SYS-10): je Bytes und Grund eine aktive Zeile; die Datei liegt unter private/quarantine/, solange ein Grund aktiv ist.';

CREATE UNIQUE INDEX IF NOT EXISTS media_quarantine_one_active ON media_quarantine (sha256, reason_kind) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS media_quarantine_active ON media_quarantine (sha256) WHERE restored_at IS NULL;

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
        'terrain_preview', 'path_profile', 'media_quarantine'
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

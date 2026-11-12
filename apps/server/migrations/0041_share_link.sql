-- Kurzlinks `?s=<code>` (WI-0034, WI-0017 F2): Legacys Teilen-Knopf mit Speicher.
--
-- 🔴 DER ERSTE SCHREIBPFAD, DEN BESUCHER AUSLÖSEN. Die Zeilen lassen sich aus keinem Snapshot neu
-- ableiten; sie gehören ins Backup (Claudio, `2026-09-24-kurzlink-einschaetzung-antwort.md`).
--
-- Gespeichert wird ein Zustand des Planers (`SharePayload` in `@avesmaps3d/shared`): Kennungen,
-- Zahlen und Werte aus festen Listen, kein freier Text. Keine IP, kein Zähler - die Drossel lebt im
-- Speicher der Anwendung und im vhost.
--
-- - `code`: eindeutig OHNE Rücksicht auf Groß- und Kleinschreibung. Legacys MySQL fand Codes so
--   (`utf8mb4_unicode_ci`), und seine Codes ziehen später in diese Tabelle um (F3).
-- - `payload_hash`: SHA-256 der kanonischen Schreibweise, eindeutig. Derselbe Zustand ergibt denselben
--   Code, auch bei zwei gleichzeitigen Anfragen.
-- - `last_used_at`: der Tag des letzten Aufrufs, höchstens einmal täglich geschrieben. Damit ließe sich
--   später bereinigen, ohne zu raten (Claudios Wunsch). Ein Ablauf ist nicht vorgesehen.

CREATE TABLE IF NOT EXISTS share_link (
    code text PRIMARY KEY,
    payload jsonb NOT NULL,
    payload_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at date,
    CONSTRAINT share_link_code_format CHECK (code ~ '^[A-Za-z0-9]{4,16}$'),
    CONSTRAINT share_link_payload_hash_format CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT share_link_payload_is_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS share_link_code_folded ON share_link (lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS share_link_payload_hash_key ON share_link (payload_hash);
-- Für das Tagesbudget: neue Codes der letzten 24 Stunden.
CREATE INDEX IF NOT EXISTS share_link_created_at ON share_link (created_at);

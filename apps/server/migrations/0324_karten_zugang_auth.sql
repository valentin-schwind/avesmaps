-- Die Zugänge zu den Kartendateien ziehen ins Schema `avesmaps_auth` (WI-0280; Vali 2026-11-07, Option „A“). Grund: `public` liest Claudios Lesekonto
-- (ADR-0010), und mit `token_hash` unterschreibt der Server die Tickets eines Links (`karten-export/zugang.ts`, HMAC über den Hash). Wer den Hash liest,
-- kann ein Ticket fälschen und die Karten dieses Links laden, ohne den Link zu kennen. Vorbild ist `avesmaps_auth.abzug_schluessel` (0220).
--
-- 🔴 ERWEITERN UND UMSTELLEN, NICHT ENTFERNEN (`docs/regeln/entwicklung.md`, „Migrationen: erst erweitern …“):
-- - Neu ist die Tafel `avesmaps_auth.karten_zugang` mit denselben Spalten und Bedingungen und den Zeilen der alten. Der Code dieses Release liest und schreibt
--   nur sie, sobald die App-Rolle sie lesen darf.
-- - `public.karten_zugang` bleibt im Überlapp stehen: Das vorige Release liest und schreibt sie, und solange Claudio `auth-grants.psql` nicht eingespielt hat
--   (der Korridor tut das nie), liest dieses Release daraus und nimmt keine Änderung an (`zugang.ts`, `zugangTafel`). Entfernt wird sie in einem eigenen,
--   späteren Release (WI-0280, offener Punkt). Claudios Lesekonto nimmt sie aus (`ops/db-readonly/claudio-readonly.sh`, `AUSGENOMMEN`).
-- - Der Fremdschlüssel von `karten_abruf.zugang_id` fällt: Er zeigte auf die alte Tafel, und ein Zugang, den dieses Release anlegt, steht nur in der neuen.
--   Einen neuen auf die neue Tafel gibt es nicht: `karten_abruf` ist ein Beleg in `public`, die Zeilen der Zugänge gehen in keinen Abzug und kein Testpaket
--   (`release-fixtures.ts`), und ein Fremdschlüssel hinüber bräche dort das Einspielen. Einen Abruf trägt der Code nur nach einem geprüften Zugang ein.
-- - `avesmaps_auth.karten_zugang_karten()`: Die Jobs-Rolle hat im Schema an keiner Tafel ein Recht (`auth-grants.psql`). Der SVG-Bau braucht nur, welche
--   Karten ein gültiger Zugang nennt (er hebt sie auf); diese Funktion sagt genau das, ohne Hash, ohne Namen.
--
-- Rechte stehen in `auth-grants.psql`: App lesen, anlegen, ändern (nie löschen), Jobs nur die Funktion. Kartendaten berührt das nicht.

CREATE TABLE IF NOT EXISTS avesmaps_auth.karten_zugang (
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
    ersetzt UUID REFERENCES avesmaps_auth.karten_zugang (id),
    last_used_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS karten_zugang_art_idx ON avesmaps_auth.karten_zugang (art, created_at DESC);

COMMENT ON TABLE avesmaps_auth.karten_zugang IS
    'WI-0280: Token-Links und API-Schlüssel für die Kartendateien (nur Hash), seit 0324 im geschützten Schema; lesen, anlegen, ändern, nie löschen.';

-- Alle Zeilen, mit ihrer Kennung: Ein Link, ein Schlüssel und ein laufendes Ticket gelten weiter. Ein Verweis `ersetzt` zeigt auf eine Zeile derselben
-- Anweisung; der Fremdschlüssel prüft am Ende der Anweisung.
INSERT INTO avesmaps_auth.karten_zugang (
    id, art, token_hash, kennung, fuer_wen, karten, created_by, created_at, expires_at, revoked_at, revoked_by, ersetzt, last_used_at
)
SELECT id, art, token_hash, kennung, fuer_wen, karten, created_by, created_at, expires_at, revoked_at, revoked_by, ersetzt, last_used_at
  FROM public.karten_zugang
    ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.karten_abruf DROP CONSTRAINT IF EXISTS karten_abruf_zugang_id_fkey;

COMMENT ON TABLE public.karten_zugang IS
    'WI-0280: abgelöst durch avesmaps_auth.karten_zugang (0324). Bleibt für das vorige Release und den Rückfall ohne auth-grants stehen; fällt in einem späteren Release.';

CREATE OR REPLACE FUNCTION avesmaps_auth.karten_zugang_karten() RETURNS text[]
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(array_agg(DISTINCT k.karte ORDER BY k.karte), '{}'::text[])
      FROM avesmaps_auth.karten_zugang z
     CROSS JOIN LATERAL unnest(z.karten) AS k (karte)
     WHERE z.revoked_at IS NULL AND z.expires_at > now()
$$;

REVOKE ALL ON FUNCTION avesmaps_auth.karten_zugang_karten() FROM PUBLIC;

COMMENT ON FUNCTION avesmaps_auth.karten_zugang_karten() IS
    'WI-0280: die Karten, die ein gültiger Zugang nennt (für die Aufbewahrung des SVG-Baus der Jobs-Rolle); kein Hash, kein Name. SECURITY DEFINER.';

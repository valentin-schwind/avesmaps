-- Der Abzugs-Schlüssel (WI-0251; Vali 2026-10-25: „ja die TAR automatisch über HTTPs zu ziehen wär mir am liebsten. ich will keine dateien runter und
-- wieder hochladen“): Der Entwicklungsrechner holt den Abzug von Stage oder Production selbst über HTTPS. Er ausweist sich dabei nicht mit einer
-- Sitzung, sondern mit einem Schlüssel, den ein Admin mit Passkey und dem Recht `create_backup` im Datenabgleich der Umgebung anlegt und widerruft.
-- Der Schlüssel darf genau zwei Dinge: die Abzüge dieser Umgebung auflisten und einen davon herunterladen (`GET /api/abzug-holen/…`).
--
-- Gespeichert wird nur sein SHA-256 (32 Byte Zufall, 256 Bit: ein schneller Hash genügt, wie bei Sitzungen und Links, `auth/tokens.ts`); der Wert selbst
-- erscheint einmal bei der Ausstellung. Ein Schlüssel gilt, solange er nicht abgelaufen und nicht widerrufen ist UND die Person, die ihn anlegte, aktiv
-- ist (ein aufgelöstes oder gesperrtes Konto zieht seine Schlüssel mit). Jede Nutzung steht im Protokoll (`system.abzug_abgeholt`).
--
-- 🔴 REIN ADDITIV: eine neue Tafel, keine Änderung an einer bestehenden. Das vorige Release kennt sie nicht und braucht sie nicht. Die Rechte stehen in
-- `auth-grants.psql` (lesen, anlegen, ändern; nie löschen).

CREATE TABLE IF NOT EXISTS avesmaps_auth.abzug_schluessel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quelle TEXT NOT NULL CHECK (quelle IN ('staging', 'production')),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_by UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    last_used_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS abzug_schluessel_quelle_idx ON avesmaps_auth.abzug_schluessel (quelle, created_at DESC);

COMMENT ON TABLE avesmaps_auth.abzug_schluessel IS
    'WI-0251: Schlüssel, mit dem der Entwicklungsrechner Abzüge von Stage oder Production abholt (nur Hash); lesen, anlegen, ändern, nie löschen.';

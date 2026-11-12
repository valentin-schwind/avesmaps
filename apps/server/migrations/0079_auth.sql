-- Identität, Anmeldung und Rechte (WI-0120 A2, AUTH-0001 §5; Betreiber 2026-10-09: „D2: B′ – Passkeys. Bau freigegeben.“,
-- ADR-0013 v3).
--
-- 🔴 EIGENES SCHEMA `avesmaps_auth` (ADR-0010 Nr. 2): Konten, Sitzungen, Tokens als Hash, Discord-ID und IP-Präfix liegen
-- außerhalb der Lese-Allowlist (`public`, `avesmaps_ops`). `claudio` sieht davon nichts; keine Sicht in `public` liest
-- hieraus (ADR-0010 Nr. 3). Fachtabellen verweisen nur über die pseudonyme `person.id`.
--
-- 🔴 KEIN KLARTEXTGEHEIMNIS (Kap. 10.70): Session-, Einladungs-, Rücksetz-, Einrichtungs- und OAuth-Werte nur als SHA-256
-- (`bytea`, 32 Byte; 256 Bit Zufall, daher kein langsamer Hash). Passwörter nur als Argon2id-PHC-Text. Einzige Ausnahme ist
-- der PKCE-Verifier eines laufenden Discord-Umwegs: Er muss im Klartext an Discord, lebt zehn Minuten und ist danach wertlos.
--
-- 🔴 D1 C (vorläufig): Jede Umgebungsdatenbank führt nur Zeilen ihrer eigenen Umgebung. Die Spalte `environment` steht
-- trotzdem überall, wo Zugang entsteht: Mit G-PROD-IDENT kann Production die Zeilen beider Umgebungen führen, ohne Umbau.
--
-- REIN ADDITIV, rollenneutral: kein GRANT (Claudios `db-grants`, Handover; lokal `scripts/dev/provision-auth-grants.ps1`).
-- Rollen und Capabilities stehen NICHT als CHECK: der Katalog lebt im Code (`packages/shared/src/auth/capabilities.ts`), und
-- ein neuer Name wäre sonst ein `DROP CONSTRAINT` während zwei Server nebeneinander laufen (wie `job.kind`, 0070).

CREATE SCHEMA IF NOT EXISTS avesmaps_auth;

-- Revision je Datensatz (ADR-0020): Die Anwendung schreibt `revision` nie selbst; der Trigger zählt hoch und setzt
-- `updated_at`. Eine Tabelle mit diesem Trigger führt deshalb beide Spalten. Einmal für alle Domänen.
CREATE OR REPLACE FUNCTION public.revision_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Identität: die Person (AUTH-0001 §3 Nr. 1, 3). Global eindeutige UUID, damit dieselbe Person bei G-PROD-IDENT dieselbe bleibt.
CREATE TABLE IF NOT EXISTS avesmaps_auth.person (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'departed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES avesmaps_auth.person (id),
    -- Wie die Person entstand: Einladung, Kommandozeile (Notzugang/Bootstrap), Test.
    created_via TEXT NOT NULL DEFAULT 'invitation' CHECK (created_via IN ('invitation', 'cli', 'system')),
    locked_at TIMESTAMPTZ,
    locked_by UUID REFERENCES avesmaps_auth.person (id),
    lock_reason TEXT,
    last_login_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER person_revision BEFORE UPDATE ON avesmaps_auth.person
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- Umgebungseintritt und Rolle (§3 Nr. 4, 5): genau eine Zeile je Person und Umgebung.
CREATE TABLE IF NOT EXISTS avesmaps_auth.person_access (
    person_id UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    granted_by UUID REFERENCES avesmaps_auth.person (id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    revoked_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, environment)
);
CREATE OR REPLACE TRIGGER person_access_revision BEFORE UPDATE ON avesmaps_auth.person_access
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- Sonderrechte (§7.2, §7.3): einzeln zugeteilt, nie gelöscht, nur widerrufen.
CREATE TABLE IF NOT EXISTS avesmaps_auth.capability_grant (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_id UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    capability TEXT NOT NULL,
    granted_by UUID REFERENCES avesmaps_auth.person (id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS capability_grant_active
    ON avesmaps_auth.capability_grant (person_id, environment, capability) WHERE revoked_at IS NULL;

-- Anmeldeweg Passwort (§6.4). `login_name` ist NFC-normalisiert und klein geschrieben (die Anwendung normalisiert).
CREATE TABLE IF NOT EXISTS avesmaps_auth.password_login (
    person_id UUID PRIMARY KEY REFERENCES avesmaps_auth.person (id),
    login_name TEXT NOT NULL UNIQUE CHECK (char_length(login_name) BETWEEN 3 AND 40),
    password_hash TEXT NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    must_change BOOLEAN NOT NULL DEFAULT false,
    -- Fehlversuche in Folge; bei 100 wird nur dieser Anmeldeweg stillgelegt (NIST SP 800-63B-4 §3.2.2).
    failed_streak INTEGER NOT NULL DEFAULT 0 CHECK (failed_streak >= 0),
    disabled_at TIMESTAMPTZ
);

-- Anmeldeweg Discord (§6.3). Die Snowflake bleibt Text (bis 64 Bit, in JavaScript nie `Number`).
CREATE TABLE IF NOT EXISTS avesmaps_auth.discord_login (
    person_id UUID PRIMARY KEY REFERENCES avesmaps_auth.person (id),
    discord_user_id TEXT NOT NULL UNIQUE CHECK (discord_user_id ~ '^[0-9]{15,21}$'),
    discord_username TEXT,
    discord_global_name TEXT,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- Anmeldeweg Passkey (§11.4, Passkey-ADR). Ein Passkey ist ein Faktor DIESER Umgebung (RP-ID = Host).
CREATE TABLE IF NOT EXISTS avesmaps_auth.passkey_credential (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    rp_id TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    sign_count BIGINT NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
    transports TEXT[] NOT NULL DEFAULT '{}',
    device_type TEXT,
    backed_up BOOLEAN NOT NULL DEFAULT false,
    label TEXT CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_via TEXT NOT NULL CHECK (created_via IN ('passkey', 'enrollment_link', 'recovery')),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS passkey_credential_person ON avesmaps_auth.passkey_credential (person_id) WHERE revoked_at IS NULL;

-- Sitzung (§6.1). `assurance`: `basic` (Stufe R), `strong` (Stufe V: Discord-2FA oder Passwort plus Passkey), `recovery`
-- (Notzugang, 60 min). Stufe S ist keine Sitzungsart, sondern ein frischer Passkey-Nachweis (`passkey_confirmed_at`).
CREATE TABLE IF NOT EXISTS avesmaps_auth.session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    person_id UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    method TEXT NOT NULL CHECK (method IN ('discord', 'password', 'passkey', 'recovery')),
    assurance TEXT NOT NULL CHECK (assurance IN ('basic', 'strong', 'recovery')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    idle_expires_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    passkey_confirmed_at TIMESTAMPTZ,
    rotate_required BOOLEAN NOT NULL DEFAULT false,
    rotated_from UUID,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    revoke_reason TEXT,
    ip_prefix TEXT,
    client_label TEXT
);
CREATE INDEX IF NOT EXISTS session_person_live ON avesmaps_auth.session (person_id) WHERE revoked_at IS NULL;

-- Ein laufender Discord-Umweg (§6.3): einmalig, zehn Minuten, an das Browser-Nonce gebunden.
CREATE TABLE IF NOT EXISTS avesmaps_auth.oauth_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
    browser_nonce_hash BYTEA NOT NULL CHECK (octet_length(browser_nonce_hash) = 32),
    code_verifier TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link', 'invitation', 'confirm')),
    person_id UUID REFERENCES avesmaps_auth.person (id),
    session_id UUID REFERENCES avesmaps_auth.session (id),
    invitation_id UUID,
    return_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

-- Einladung (§6.5). Admin- und Betreiber-Einladungen sind immer an eine Discord-ID gebunden (D3, die Anwendung prüft).
CREATE TABLE IF NOT EXISTS avesmaps_auth.invitation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    token_hint TEXT NOT NULL CHECK (char_length(token_hint) = 4),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    role TEXT NOT NULL,
    note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 120),
    bound_discord_user_id TEXT CHECK (bound_discord_user_id IS NULL OR bound_discord_user_id ~ '^[0-9]{15,21}$'),
    created_by UUID REFERENCES avesmaps_auth.person (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_person_id UUID REFERENCES avesmaps_auth.person (id),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    replaced_by UUID REFERENCES avesmaps_auth.invitation (id),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER invitation_revision BEFORE UPDATE ON avesmaps_auth.invitation
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- Einmalige Links an eine Person (§6.7, §11.2, §11.4): Passwort zurücksetzen, Notzugang, ersten Passkey einrichten.
-- Erzeugt von einer Person (`created_by`) oder von der Kommandozeile (`created_by_cli`, Systembenutzer).
CREATE TABLE IF NOT EXISTS avesmaps_auth.access_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'recovery', 'passkey_enrollment')),
    person_id UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    created_by UUID REFERENCES avesmaps_auth.person (id),
    created_by_cli TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CHECK (created_by IS NOT NULL OR created_by_cli IS NOT NULL)
);

-- Laufende Passkey-Zeremonie (§11.4): einmalig, fünf Minuten.
CREATE TABLE IF NOT EXISTS avesmaps_auth.webauthn_challenge (
    challenge_hash BYTEA PRIMARY KEY CHECK (octet_length(challenge_hash) = 32),
    session_id UUID REFERENCES avesmaps_auth.session (id),
    person_id UUID REFERENCES avesmaps_auth.person (id),
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'confirm', 'login')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

-- Drossel (§6.4): je eingegebenem Benutzernamen und je IP-Präfix, Schlüssel nur als Hash.
CREATE TABLE IF NOT EXISTS avesmaps_auth.login_throttle (
    key_hash BYTEA PRIMARY KEY CHECK (octet_length(key_hash) = 32),
    kind TEXT NOT NULL CHECK (kind IN ('name', 'ip')),
    failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Protokoll der Anmeldung und Verwaltung (Kap. 10.63, ADR-0019). Die App-Rolle darf nur anhängen. `details` trägt nur die
-- Felder der Positivliste je `action`, nie ein Token, Passwort, Code oder Geheimnis. Mit `operation_id` und `request_hash` ist
-- jede Verwaltungshandlung höchstens einmal wirksam; die Quittung wird bei einer Wiederholung zurückgegeben.
CREATE TABLE IF NOT EXISTS avesmaps_auth.security_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'cli', 'system', 'anonymous')),
    actor_person_id UUID REFERENCES avesmaps_auth.person (id),
    actor_label TEXT,
    action TEXT NOT NULL,
    target_person_id UUID REFERENCES avesmaps_auth.person (id),
    target_ref TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    operation_id UUID UNIQUE,
    request_hash BYTEA CHECK (request_hash IS NULL OR octet_length(request_hash) = 32),
    receipt JSONB,
    session_id UUID,
    recovery BOOLEAN NOT NULL DEFAULT false,
    ip_prefix TEXT,
    client_label TEXT
);
CREATE INDEX IF NOT EXISTS security_event_at ON avesmaps_auth.security_event (at DESC);
CREATE INDEX IF NOT EXISTS security_event_target ON avesmaps_auth.security_event (target_person_id, at DESC);
CREATE INDEX IF NOT EXISTS security_event_actor ON avesmaps_auth.security_event (actor_person_id, at DESC);

-- Legacy-Akteure (§6.9): Schlüssel ist Legacys `users.id`; Klartextnamen ohne ID als eigene Zeilen. Zuordnen nur durch einen
-- Admin, mit Beleg; die Zuordnung behauptet nur, was er festgestellt hat.
CREATE TABLE IF NOT EXISTS avesmaps_auth.legacy_identity (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_user_id BIGINT UNIQUE,
    legacy_name TEXT NOT NULL,
    known_names TEXT[] NOT NULL DEFAULT '{}',
    kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'machine', 'deleted')),
    person_id UUID REFERENCES avesmaps_auth.person (id),
    mapped_by UUID REFERENCES avesmaps_auth.person (id),
    mapped_at TIMESTAMPTZ,
    evidence TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER legacy_identity_revision BEFORE UPDATE ON avesmaps_auth.legacy_identity
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

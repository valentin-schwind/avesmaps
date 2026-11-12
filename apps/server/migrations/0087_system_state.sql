-- Der Betriebszustand (WI-0127 SYS-2, Bauplan SYS-0001 §3.1, §3.9 Migration A; Betreiber 2026-10-09 E1, E4; Claudio,
-- `handovers/2026-10-09-wi0119-systemsteuerung-antwort.md` Punkt 4).
--
-- 🔴 Die Wartung steht hier NICHT. Sie bleibt die Datei, die nur root schreibt (`/srv/avesmaps3d/<env>/maintenance/`, Claudio); die
-- Anwendung liest sie nicht einmal. In der Datenbank stehen nur der eingeschränkte Betrieb und die zwei Sperren (Karte, System).
--
-- Rein additiv und rollenneutral: eine neue Tabelle, ihr Trigger, eine neue Fassung von `redact_person_events()` mit derselben
-- Signatur. Ein alter Server kennt die Tabelle nicht und arbeitet weiter wie bisher. KEIN Recht in dieser Datei; was die App-Rolle an
-- `system_state` nicht darf (anlegen, löschen), nimmt `apps/server/src/db/system-grants.psql` weg (Vorlage für Claudios
-- `avesmaps3d-db-grants`).
--
-- Personen nur über die pseudonyme `person.id`, OHNE Fremdschlüssel ins Schema `avesmaps_auth` (AUTH-0001 §5, wie `job.actor_ref`). Hat
-- die Kommandozeile geschaltet, steht `cli:<Systembenutzer>` in der Spalte `…_by_label` und die Person bleibt leer.

-- 1. DIE EINE ZEILE ---------------------------------------------------------------------------------------------------------------------
--
-- Eine Datenbank je Umgebung, deshalb keine Spalte `environment`. `revision` zählt allein `public.revision_bump()` (0079, ADR-0020);
-- jede Umschaltung trägt `baseRevision`. `content_revision` gehört den Inhaltsschaltern (SYS-10) und steht schon hier, damit beide über
-- denselben Weckruf gehen.

CREATE TABLE IF NOT EXISTS system_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'restricted')),
    mode_since TIMESTAMPTZ NOT NULL DEFAULT now(),
    mode_by UUID,
    mode_by_label TEXT,
    mode_reason TEXT CHECK (mode_reason IS NULL OR char_length(mode_reason) BETWEEN 1 AND 300),
    map_lock BOOLEAN NOT NULL DEFAULT false,
    map_lock_since TIMESTAMPTZ,
    map_lock_by UUID,
    map_lock_by_label TEXT,
    map_lock_reason TEXT CHECK (map_lock_reason IS NULL OR char_length(map_lock_reason) BETWEEN 1 AND 300),
    system_lock BOOLEAN NOT NULL DEFAULT false,
    system_lock_since TIMESTAMPTZ,
    system_lock_by UUID,
    system_lock_by_label TEXT,
    system_lock_reason TEXT CHECK (system_lock_reason IS NULL OR char_length(system_lock_reason) BETWEEN 1 AND 300),
    content_revision BIGINT NOT NULL DEFAULT 1,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Einschränken und Sperren nur mit Grund (E5 A, Blatt A4); zurück auf Normal und Lösen ohne Pflicht.
    CONSTRAINT system_state_restricted_reason CHECK (mode = 'normal' OR mode_reason IS NOT NULL),
    CONSTRAINT system_state_map_lock_reason CHECK (NOT map_lock OR (map_lock_reason IS NOT NULL AND map_lock_since IS NOT NULL)),
    CONSTRAINT system_state_system_lock_reason CHECK (
        NOT system_lock OR (system_lock_reason IS NOT NULL AND system_lock_since IS NOT NULL)
    ),
    -- Wer geschaltet hat: eine Person ODER die Kommandozeile, nie beides.
    CONSTRAINT system_state_mode_by_one CHECK (mode_by IS NULL OR mode_by_label IS NULL),
    CONSTRAINT system_state_map_lock_by_one CHECK (map_lock_by IS NULL OR map_lock_by_label IS NULL),
    CONSTRAINT system_state_system_lock_by_one CHECK (system_lock_by IS NULL OR system_lock_by_label IS NULL)
);

-- Stellung Normal, beide Sperren offen; ein zweiter Lauf ändert nichts.
INSERT INTO system_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE TRIGGER system_state_revision BEFORE UPDATE ON system_state
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- 2. DER WECKRUF --------------------------------------------------------------------------------------------------------------------------
--
-- Jede Änderung ruft `pg_notify('avesmaps_system_changed', <revision>)`. `NOTIFY` geht erst mit dem COMMIT hinaus; eine zurückgerollte
-- Umschaltung meldet nichts (Muster 0081). Der Kanal ist nur ein Weckruf: Jede Instanz liest danach die Zeile neu und vergleicht die
-- Revision; die Wahrheit ist die gelesene Zeile, nie die Nachricht (global-review R3).

CREATE OR REPLACE FUNCTION public.system_state_notify() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('avesmaps_system_changed', NEW.revision::text);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER system_state_notify AFTER UPDATE ON system_state
    FOR EACH ROW EXECUTE FUNCTION public.system_state_notify();

-- 3. SCHWÄRZEN BEIM AUFLÖSEN EINES KONTOS ----------------------------------------------------------------------------------------------
--
-- Neu aus der AKTUELLEN Fassung (0083), nicht aus einer älteren abgeschrieben (AGENTS.md: „Eine Renderansicht wird nie aus einer
-- alten Migration abgeschrieben“ gilt für jede `CREATE OR REPLACE`). Dazu kommt EIN Gedanke:
--
-- 🔴 Der Grund einer Umschaltung (`system.mode_changed`, `system.lock_changed`) ist Freitext mit möglichem Personenbezug (SYS-0001
-- §4.5). Die Tafel `personal` schwärzt nur Einträge, deren GEGENSTAND die Person ist; ein Systemeintrag hat keine betroffene Person, nur
-- eine handelnde. Deshalb die zweite Tafel `authored`: Freitext, den die handelnde Person über das System schreibt, wird geschwärzt,
-- wenn SIE aufgelöst wird, samt dem Prüfwert des Anfrageinhalts (er enthält den Grund). Was sie über eine ANDERE Person schrieb, bleibt
-- wie bisher stehen, bis diese aufgelöst wird. Die Kommandozeile (`cli:<user>`) ist keine Person; ihr Grund bleibt.
--
-- Sonst unverändert: Marke, Struktur, nur diese Person, wiederholbar, `search_path` fest, PUBLIC ohne EXECUTE. Die Rechte der Funktion
-- bleiben bei `CREATE OR REPLACE` erhalten (`auth-grants.psql` gibt sie der App-Rolle).

CREATE OR REPLACE FUNCTION avesmaps_auth.redact_person_events(person_ref uuid) RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    mark_text CONSTANT text := '[geschwärzt]';
    mark CONSTANT jsonb := to_jsonb(mark_text);
    discord_ref text;
    redacted bigint;
BEGIN
    IF person_ref IS NULL THEN
        RETURN 0;
    END IF;
    -- Vor dem Löschen der Verknüpfung gerufen (`dissolve.ts`): Die Discord-ID findet die Einladungen, die an sie gebunden waren.
    SELECT d.discord_user_id INTO discord_ref FROM avesmaps_auth.discord_login d WHERE d.person_id = person_ref;

    WITH RECURSIVE own_invitation (id) AS (
        SELECT i.id FROM avesmaps_auth.invitation i
         WHERE i.accepted_person_id = person_ref OR i.bound_discord_user_id = discord_ref
        UNION
        -- Neu ausgestellt: Der Vorgänger trug dieselbe Notiz und zeigt mit `replaced_by` auf den Nachfolger.
        SELECT earlier.id FROM avesmaps_auth.invitation earlier JOIN own_invitation o ON earlier.replaced_by = o.id
    ),
    -- Freitext mit Personenbezug je Handlung, Schlüssel aus `AUDIT_DETAIL_KEYS`. Wer dort einen Freitext ergänzt, ergänzt ihn hier.
    personal (action, key) AS (
        VALUES ('person.renamed', 'from'), ('person.renamed', 'to'),
               ('person.locked', 'reason'),
               ('capability.granted', 'reason'), ('capability.revoked', 'reason'),
               ('discord.linked', 'discordUsername'),
               ('passkey.registered', 'label'), ('passkey.revoked', 'label'), ('passkey.counter_regression', 'label'),
               ('invitation.created', 'note'),
               ('legacy.mapped', 'legacyName'), ('legacy.mapped', 'legacyUserId'), ('legacy.mapped', 'evidence'),
               ('legacy.unmapped', 'legacyName'), ('legacy.unmapped', 'legacyUserId')
    ),
    -- Freitext, den die HANDELNDE Person über das System schreibt (kein Gegenstand, keine betroffene Person; WI-0127 SYS-2).
    authored (action, key) AS (
        VALUES ('system.mode_changed', 'reason'),
               ('system.lock_changed', 'reason')
    ),
    concerned AS (
        SELECT e.id,
               coalesce(e.target_person_id = person_ref, false)
                   OR (starts_with(e.action, 'invitation.') AND e.target_ref IN (SELECT o.id::text FROM own_invitation o))
                   AS subject,
               coalesce(e.actor_person_id = person_ref, false)
                   OR (coalesce(e.target_person_id = person_ref, false) AND e.actor_person_id IS NULL) AS trace,
               coalesce(e.actor_person_id = person_ref, false) AS author
          FROM avesmaps_auth.security_event e
         WHERE e.target_person_id = person_ref
            OR e.actor_person_id = person_ref
            OR (starts_with(e.action, 'invitation.') AND e.target_ref IN (SELECT o.id::text FROM own_invitation o))
    ),
    planned AS (
        SELECT c.id, c.subject, c.trace,
               (
                   SELECT jsonb_object_agg(k.key, mark)
                     FROM (SELECT p.key FROM personal p WHERE c.subject AND p.action = e.action
                           UNION
                           SELECT a.key FROM authored a WHERE c.author AND a.action = e.action) k
                    WHERE e.details ? k.key AND e.details -> k.key NOT IN ('null'::jsonb, mark)
               ) AS blackened,
               c.author AND EXISTS (SELECT 1 FROM authored a WHERE a.action = e.action) AS own_text,
               c.subject AND starts_with(e.action, 'legacy.') AND e.target_ref IS NOT NULL AND e.target_ref <> mark_text
                   AS legacy_ref
          FROM concerned c JOIN avesmaps_auth.security_event e ON e.id = c.id
    )
    UPDATE avesmaps_auth.security_event e
       SET details = e.details || coalesce(p.blackened, '{}'::jsonb),
           target_ref = CASE WHEN p.legacy_ref THEN mark_text ELSE e.target_ref END,
           request_hash = CASE WHEN p.subject OR p.own_text THEN NULL ELSE e.request_hash END,
           client_label = CASE WHEN p.trace THEN NULL ELSE e.client_label END,
           ip_prefix = CASE WHEN p.trace THEN NULL ELSE e.ip_prefix END
      FROM planned p
     WHERE e.id = p.id
       AND (p.blackened IS NOT NULL
            OR p.legacy_ref
            OR ((p.subject OR p.own_text) AND e.request_hash IS NOT NULL)
            OR (p.trace AND (e.client_label IS NOT NULL OR e.ip_prefix IS NOT NULL)));
    GET DIAGNOSTICS redacted = ROW_COUNT;
    RETURN redacted;
END;
$$;

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur, wem `auth-grants.psql` es erlaubt (die App-Rolle).
REVOKE ALL ON FUNCTION avesmaps_auth.redact_person_events(uuid) FROM PUBLIC;

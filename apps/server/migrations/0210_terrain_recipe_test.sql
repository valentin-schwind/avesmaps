-- 0210: Die offene Geländefassung ist auf der Stage live einstellbar (WI-0240; Betreiber 2026-10-19 über die Hauptorchestrierung, wörtlich:
-- „Gelände: ergänz denen namen der 19 mit (Test). alle änderungen die wir mit test machen soll automatisch passieren wenn wir was machen
-- oder wenn jemand auf aktivieren geklickt haben. wir ändern eigenschaften von test 19 live auf der stage bis das modell brauchbare
-- ergebnisse liefert.“).
--
--   1. `terrain_recipe_test`: je Domäne und offener Fassung die Werte, die über ihrer Datei liegen (Regler und Gebirgs-Presets, JSONB).
--      `resolveTerrainRecipe` legt sie über die Datei, NUR solange die Fassung offen ist (nicht unter `accepted` der Auswahldatei) und nie
--      auf Production (Profil `abgenommen`). Mit der Abnahme in dieser Umgebung wird die Zeile gesperrt (`gesperrt_am`); ihr Stand geht als
--      Datei ins Repository (`19.json`), und mit `accepted` in der Datei liegt keine Überlagerung mehr darüber.
--   2. `terrain_recipe_test_event`: jede Änderung mit Stand vorher und nachher, nur anhängen (der Rückweg nimmt einen früheren Stand).
--
-- 🔴 ADDITIV: zwei neue Tafeln, dazu die Schwärzfunktion mit einer Zeile mehr (Abschnitt 3). Das vorige Release liest die Tafeln
-- nie; ohne Zeile gilt die Datei wie bisher. Rechte: `apps/server/src/db/hoehenmodell-grants.psql` (die Jobs-Rolle liest über die
-- Default-Privilegien, der volle und der lokale Lauf brauchen die Werte).

CREATE TABLE IF NOT EXISTS terrain_recipe_test (
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    version SMALLINT NOT NULL CHECK (version >= 1),
    werte JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(werte) = 'object'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    geaendert_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    geaendert_von UUID,
    geaendert_von_label TEXT,
    grund TEXT,
    gesperrt_am TIMESTAMPTZ,
    PRIMARY KEY (map_domain_id, version)
);
COMMENT ON TABLE terrain_recipe_test IS
    'Werte über der Datei einer offenen Geländefassung je Domäne (WI-0240, „19 (Test)“); nie auf Production, gesperrt nach der Abnahme.';

CREATE TABLE IF NOT EXISTS terrain_recipe_test_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    version SMALLINT NOT NULL CHECK (version >= 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    vorher JSONB NOT NULL,
    nachher JSONB NOT NULL,
    am TIMESTAMPTZ NOT NULL DEFAULT now(),
    von UUID,
    von_label TEXT,
    grund TEXT
);
CREATE INDEX IF NOT EXISTS terrain_recipe_test_event_version ON terrain_recipe_test_event (map_domain_id, version, id DESC);
COMMENT ON TABLE terrain_recipe_test_event IS
    'Verlauf der Werte einer offenen Geländefassung (WI-0240): je Änderung vorher und nachher, nur anhängen.';

-- 3. SCHWÄRZEN BEIM AUFLÖSEN EINES KONTOS -----------------------------------------------------------------------------------
--
-- Der Grund einer Änderung an den Testwerten (Ereignis `system.terrain_test_changed`) ist Freitext der HANDELNDEN Person über das
-- System, wie der Grund einer Aktivierung oder Abnahme. Er gehört in die Tafel `authored` von `redact_person_events()`.
--
-- 🔴 Aus der GELTENDEN Fassung (0130) abgeschrieben und nur um EINE Zeile erweitert: `('system.terrain_test_changed', 'reason')`
-- in `authored`. Sonst unverändert; die Rechte bleiben bei `CREATE OR REPLACE` erhalten.

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
    -- Freitext, den die HANDELNDE Person über das System schreibt (kein Gegenstand, keine betroffene Person; WI-0127 SYS-2,
    -- Höhenmodell SYS-13, WI-0160 für die Pause der Warteschlange).
    --
    -- 🔴 Diese Tafel ist aus Migration 0100 abgeschrieben, der GELTENDEN Fassung, nicht aus 0087. Der erste Versuch nahm 0087
    --    und hätte dabei die drei Gründe des Höhenmodells aus der Schwärzung geworfen — gefangen hat es
    --    `apps/server/test/auth-redact-events.test.ts` („jeder Schlüssel der Positivliste ist eingeordnet“). Genau davor warnt
    --    AGENTS.md: eine Funktion wird nie aus einer alten Migration abgeschrieben.
    authored (action, key) AS (
        VALUES ('system.mode_changed', 'reason'),
               ('system.lock_changed', 'reason'),
               ('system.terrain_activated', 'reason'),
               ('system.terrain_accepted', 'reason'),
               ('system.terrain_draft_created', 'reason'),
               ('system.queue_changed', 'reason'),
               ('system.terrain_test_changed', 'reason')
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

REVOKE ALL ON FUNCTION avesmaps_auth.redact_person_events(uuid) FROM PUBLIC;

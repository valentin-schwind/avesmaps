-- 0303: Sonderrollen (WI-0279; Betreiber 2026-11-03): fachliche Beauftragungen, die zur Grundrolle hinzukommen.
--
--   1. `sonderrolle_zuteilung`: wer welche Sonderrolle in welcher Umgebung hat, bei regionalen Rollen je Region eine Zeile. Beendet wird mit
--      `revoked_at`, nie gelöscht; die beendeten Zeilen sind der Verlauf im Reiter.
--   2. `invitation_sonderrolle`: was eine offene Einladung beim Einlösen hinzubringt.
--   3. Die Schwärzfunktion kennt die neuen Gründe.
--
-- Der Name der Rolle bleibt Text ohne CHECK, wie `capability_grant.capability`: Der Katalog steht in `packages/shared`, und ein Name, den
-- ein älterer Katalog nicht kennt, zählt schlicht nicht. Die Region ist `region.public_id`, ohne Fremdschlüssel aus dem geschützten
-- Schema in die Kartendaten: Der Abzug spielt Karten ein, nie Konten (ADR-0013), und eine Region überlebt so auch ein Einspielen.
--
-- 🔴 ADDITIV: zwei neue Tafeln und die Funktion mit drei Zeilen mehr. Das vorige Release liest die Tafeln nie. Die Rechte stehen in
-- `apps/server/src/db/auth-grants.psql` und kommen über Claudio; bis dahin gibt es für die App-Rolle keine Sonderrollen (`auth/sonderrollen.ts`).

CREATE TABLE IF NOT EXISTS avesmaps_auth.sonderrolle_zuteilung (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_id UUID NOT NULL REFERENCES avesmaps_auth.person (id),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production', 'test')),
    sonderrolle TEXT NOT NULL CHECK (char_length(sonderrolle) BETWEEN 1 AND 40),
    region_public_id UUID,
    -- `vergabe`: hier vergeben oder aus einer Einladung; `production`: von Production übernommen (WI-0279, Paket 4).
    herkunft TEXT NOT NULL DEFAULT 'vergabe' CHECK (herkunft IN ('vergabe', 'production')),
    granted_by UUID REFERENCES avesmaps_auth.person (id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
    revoked_by UUID REFERENCES avesmaps_auth.person (id),
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT
);
COMMENT ON TABLE avesmaps_auth.sonderrolle_zuteilung IS
    'Sonderrollen je Person und Umgebung (WI-0279); die Rechte stehen im Katalog in packages/shared, hier nur, wer die Rolle hat.';

-- Eindeutig aktiv je Person, Rolle und Region. Der feste Wert steht für „ohne Region“, weil NULL in einem Index nie gleich ist.
CREATE UNIQUE INDEX IF NOT EXISTS sonderrolle_zuteilung_aktiv
    ON avesmaps_auth.sonderrolle_zuteilung
       (person_id, environment, sonderrolle, coalesce(region_public_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE revoked_at IS NULL;
-- Höchstens eine Person je Region (E3); der Katalog nennt dieselbe Rolle (`einePersonJeRegion`).
CREATE UNIQUE INDEX IF NOT EXISTS sonderrolle_regionalkanzler_je_region
    ON avesmaps_auth.sonderrolle_zuteilung (environment, region_public_id)
    WHERE sonderrolle = 'regionalkanzler' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sonderrolle_zuteilung_person
    ON avesmaps_auth.sonderrolle_zuteilung (person_id, environment) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS avesmaps_auth.invitation_sonderrolle (
    invitation_id UUID NOT NULL REFERENCES avesmaps_auth.invitation (id),
    sonderrolle TEXT NOT NULL CHECK (char_length(sonderrolle) BETWEEN 1 AND 40),
    region_public_id UUID,
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300)
);
COMMENT ON TABLE avesmaps_auth.invitation_sonderrolle IS
    'Sonderrollen, die eine Einladung beim Einlösen hinzubringt (WI-0279); wirksam erst in der Transaktion der Annahme.';
CREATE UNIQUE INDEX IF NOT EXISTS invitation_sonderrolle_eindeutig
    ON avesmaps_auth.invitation_sonderrolle
       (invitation_id, sonderrolle, coalesce(region_public_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Ein Entzug meldet sich wie jede andere Rechteänderung: `requireRotation` setzt `rotate_required`, und dessen Trigger (0081) ruft an.

-- 🔴 Aus der GELTENDEN Fassung (0210) abgeschrieben und nur in der Tafel `personal` erweitert: der Grund einer Einladung mit Sonderrolle und
-- die Gründe von Vergabe und Entzug. Sie sagen, warum gerade diese Person eine Rolle bekam, wie bei `capability.granted`.

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
               ('invitation.created', 'note'), ('invitation.created', 'grund'),
               ('sonderrolle.vergeben', 'grund'), ('sonderrolle.entzogen', 'grund'),
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

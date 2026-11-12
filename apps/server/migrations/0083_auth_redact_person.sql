-- Konto auflösen: Freitext mit Personenbezug im Protokoll schwärzen (WI-0120 A15, Bauschritt B). Betreiber 2026-10-09 zur
-- Frage, was beim Auflösen mit Protokolleinträgen geschieht, die selbst Personenbezug tragen: „1 B, englisch passt, Ehemalige
-- Person lassen“ (B: echt löschen).
--
-- 🔴 Für die App-Rolle bleibt das Protokoll „nur anhängen“ (Kap. 10.63, AUTH-0001 T18): kein UPDATE, kein DELETE. Geschwärzt
-- wird nur hier, in einer Funktion mit `SECURITY DEFINER`, die der Migrationsrolle gehört, und immer nur für EINE Person. Die
-- App-Rolle darf sie aufrufen (`auth-grants.psql`), weil `auth aufloesen` auf dem VPS mit ihr läuft; `dissolve.ts` ruft sie in
-- derselben Transaktion wie die übrige Auflösung, ein Trockenlauf rollt sie mit zurück.
--
-- Was sich ändert; die Struktur bleibt (Kennung, Art, Zeitpunkt, wer an wem, Operation, Quittung):
--
-- 1. Einträge, deren GEGENSTAND die Person ist: `target_person_id`, dazu die Einträge zu ihren Einladungen (mit der sie kam,
--    die an ihre Discord-ID gebunden waren, und deren Vorgänger beim Neu-Ausstellen).
--    - Die Freitextfelder aus `details` (Tafel `personal` unten) bekommen den Wert "[geschwärzt]".
--    - `request_hash` wird geleert: ein Hash über den Inhalt der Anfrage, der Name, Grund, Notiz, Begründung, Benutzername oder
--      Discord-ID enthalten kann und sie durch Raten bestätigen ließe. Er dient nur dazu, eine Wiederholung derselben Handlung
--      binnen Sekunden zu erkennen; danach antwortet dieselbe Kennung mit 409 statt der Quittung.
--    - Bei der Zuordnung zu einem Legacy-Namen wird auch `target_ref` geschwärzt: Die Kennung der Legacy-Identität führt zu
--      Legacys Namen, der in `legacy_identity` als Legacys Geschichte bleibt; sie wäre sonst der Weg vom Platzhalter zum Namen.
-- 2. Einträge, in denen sie HANDELT (`actor_person_id`), und Fehlversuche ohne handelnde Person an ihrem Konto: Gerätebezeichnung
--    `client_label` und gekürzte IP `ip_prefix` werden geleert. Beide stammen von ihrem Gerät.
--
-- Bewusst nicht: Freitext, den sie als Handelnde über ANDERE schrieb (Sperrgrund, Notiz, Begründung einer Zuordnung oder eines
-- Sonderrechts); er beschreibt die andere Person und wird geschwärzt, wenn diese aufgelöst wird. Gerät und IP einer anderen
-- Person, die an ihr handelte. Codes (`method`, `reason` einer Anmeldung oder Sitzung, `via`, `kind`), Zahlen, Namen von Rollen,
-- Rechten und Umgebungen, `tokenHint`, die Quittung. Ein Name, den jemand in einen Freitext über eine andere Person schrieb, ist
-- nicht erkennbar und bleibt.
--
-- Markierung: Der Schlüssel bleibt, nur sein Wert wird "[geschwärzt]". `details` folgt der Positivliste je Handlung
-- (`apps/server/src/auth/audit.ts`); ein fehlender Schlüssel hieße dort „nie angegeben“ (Einladung ohne Notiz, Passkey ohne
-- Bezeichnung), und die Verwaltung zeigt den Wert so, wie er steht. `client_label`, `ip_prefix` und `request_hash` werden NULL
-- wie in `purge_expired()` (Migration 0082); ihr Fehlen ist dort der Normalfall. Die Zahl steht im Eintrag `person.departed`.
--
-- Wiederholbar: Ein geschwärzter Wert und ein leeres Feld zählen nicht noch einmal, ein zweiter Aufruf gibt 0. Rückgabe ist die
-- Zahl der geänderten Einträge. `search_path` fest, jeder Name voll qualifiziert. Rein additiv; ein alter Server ruft sie nicht.

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
    concerned AS (
        SELECT e.id,
               coalesce(e.target_person_id = person_ref, false)
                   OR (starts_with(e.action, 'invitation.') AND e.target_ref IN (SELECT o.id::text FROM own_invitation o))
                   AS subject,
               coalesce(e.actor_person_id = person_ref, false)
                   OR (coalesce(e.target_person_id = person_ref, false) AND e.actor_person_id IS NULL) AS trace
          FROM avesmaps_auth.security_event e
         WHERE e.target_person_id = person_ref
            OR e.actor_person_id = person_ref
            OR (starts_with(e.action, 'invitation.') AND e.target_ref IN (SELECT o.id::text FROM own_invitation o))
    ),
    planned AS (
        SELECT c.id, c.subject, c.trace,
               CASE WHEN c.subject THEN (
                   SELECT jsonb_object_agg(k.key, mark) FROM personal k
                    WHERE k.action = e.action AND e.details ? k.key AND e.details -> k.key NOT IN ('null'::jsonb, mark)
               ) END AS blackened,
               c.subject AND starts_with(e.action, 'legacy.') AND e.target_ref IS NOT NULL AND e.target_ref <> mark_text
                   AS legacy_ref
          FROM concerned c JOIN avesmaps_auth.security_event e ON e.id = c.id
    )
    UPDATE avesmaps_auth.security_event e
       SET details = e.details || coalesce(p.blackened, '{}'::jsonb),
           target_ref = CASE WHEN p.legacy_ref THEN mark_text ELSE e.target_ref END,
           request_hash = CASE WHEN p.subject THEN NULL ELSE e.request_hash END,
           client_label = CASE WHEN p.trace THEN NULL ELSE e.client_label END,
           ip_prefix = CASE WHEN p.trace THEN NULL ELSE e.ip_prefix END
      FROM planned p
     WHERE e.id = p.id
       AND (p.blackened IS NOT NULL
            OR p.legacy_ref
            OR (p.subject AND e.request_hash IS NOT NULL)
            OR (p.trace AND (e.client_label IS NOT NULL OR e.ip_prefix IS NOT NULL)));
    GET DIAGNOSTICS redacted = ROW_COUNT;
    RETURN redacted;
END;
$$;

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur, wem `auth-grants.psql` es erlaubt (die App-Rolle).
REVOKE ALL ON FUNCTION avesmaps_auth.redact_person_events(uuid) FROM PUBLIC;

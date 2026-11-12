-- Die Aufbewahrung der Anmeldedaten (WI-0120 A12, AUTH-0001 §5, Kap. 7.38: kein Telemetrietyp wächst unbegrenzt).
--
-- 🔴 Keine Rolle des Betriebs bekommt `DELETE` auf das Protokoll; es bleibt „nur anhängen“ (Kap. 10.63, T18). Gelöscht wird nur
-- hier, in einer Funktion mit `SECURITY DEFINER`, die der Migrationsrolle gehört (Claudio 2026-10-09,
-- `handovers/2026-10-09-auth-einschaetzung-antwort.md` Punkt 2). Die Jobs-Rolle darf sie nur aufrufen (`auth-grants.psql`); der
-- Worker tut das täglich als aufgezeichneter Job `auth_retention`, sichtbar auf der Statusseite.
--
-- Die Fristen stehen fest in der Funktion. Wer sie ändert, ändert den Datenschutz-Nachtrag mit:
-- - Anmeldungen und Fehlversuche im Protokoll 90 Tage; Verwaltungshandlungen (sie tragen eine `operation_id`) bleiben.
-- - Die gekürzte IP (`ip_prefix`) nach 14 Tagen geleert, im Protokoll und an den Sitzungen.
-- - Abgelaufenes 30 Tage nach seinem Ende: Discord-Umwege, Passkey-Zeremonien, Sitzungen, Links; die Drossel nach 30 Tagen Ruhe.
--
-- `search_path` ist fest und jeder Name voll qualifiziert: Eine Funktion mit den Rechten ihres Besitzers löst keinen fremden Namen
-- auf. Rein additiv; ein alter Server ruft sie nicht.

CREATE OR REPLACE FUNCTION avesmaps_auth.purge_expired() RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    events bigint;
    event_ips bigint;
    session_ips bigint;
    flows bigint;
    challenges bigint;
    sessions bigint;
    links bigint;
    throttles bigint;
BEGIN
    DELETE FROM avesmaps_auth.security_event
     WHERE action IN ('login.success', 'login.failure', 'login.throttled', 'logout', 'session.rotated', 'confirm.success')
       AND operation_id IS NULL
       AND at < now() - interval '90 days';
    GET DIAGNOSTICS events = ROW_COUNT;

    UPDATE avesmaps_auth.security_event SET ip_prefix = NULL
     WHERE ip_prefix IS NOT NULL AND at < now() - interval '14 days';
    GET DIAGNOSTICS event_ips = ROW_COUNT;
    UPDATE avesmaps_auth.session SET ip_prefix = NULL
     WHERE ip_prefix IS NOT NULL AND created_at < now() - interval '14 days';
    GET DIAGNOSTICS session_ips = ROW_COUNT;

    -- Erst was auf Sitzungen zeigt, dann die Sitzungen selbst (Fremdschlüssel).
    DELETE FROM avesmaps_auth.oauth_flow WHERE expires_at < now() - interval '30 days';
    GET DIAGNOSTICS flows = ROW_COUNT;
    DELETE FROM avesmaps_auth.webauthn_challenge WHERE expires_at < now() - interval '30 days';
    GET DIAGNOSTICS challenges = ROW_COUNT;
    DELETE FROM avesmaps_auth.session s
     WHERE (s.revoked_at < now() - interval '30 days'
            OR s.expires_at < now() - interval '30 days'
            OR s.idle_expires_at < now() - interval '30 days')
       AND NOT EXISTS (SELECT 1 FROM avesmaps_auth.oauth_flow f WHERE f.session_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM avesmaps_auth.webauthn_challenge c WHERE c.session_id = s.id);
    GET DIAGNOSTICS sessions = ROW_COUNT;

    DELETE FROM avesmaps_auth.access_link WHERE expires_at < now() - interval '30 days';
    GET DIAGNOSTICS links = ROW_COUNT;
    DELETE FROM avesmaps_auth.login_throttle
     WHERE updated_at < now() - interval '30 days' AND (blocked_until IS NULL OR blocked_until < now());
    GET DIAGNOSTICS throttles = ROW_COUNT;

    RETURN jsonb_build_object(
        'events', events,
        'ipPrefixes', event_ips + session_ips,
        'flows', flows,
        'challenges', challenges,
        'sessions', sessions,
        'links', links,
        'throttles', throttles
    );
END;
$$;

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur, wem `auth-grants.psql` es erlaubt.
REVOKE ALL ON FUNCTION avesmaps_auth.purge_expired() FROM PUBLIC;

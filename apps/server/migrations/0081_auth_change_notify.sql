-- Ein Entzug meldet sich (WI-0120 A11, AUTH-0001 §8 „WebSocket“, T11).
--
-- Jede Änderung, die eine Sitzung beendet oder die Rechte einer Person ändert, ruft `pg_notify('avesmaps_auth_changed',
-- <person_id>)`: Sitzung widerrufen oder zur Erneuerung markiert, Person gesperrt oder entsperrt, Rolle oder Zugang geändert,
-- Sonderrecht entzogen. Die Instanzen hören zu und schließen die WebSockets dieser Person; der Client verbindet neu und bekommt im
-- Handshake, was er jetzt sehen darf. Über Prozesse hinweg (Blue/Green) genauso wie der Kanal der Queue.
--
-- 🔴 Ein Trigger statt eines Aufrufs je Stelle: Verwaltung, Konto, Anmeldung und Kommandozeile ändern dieselben Zeilen, und
-- keine Stelle kann das Melden vergessen. `NOTIFY` geht erst mit dem COMMIT hinaus; eine zurückgerollte Änderung meldet nichts.
-- Die Nachricht trägt nur die Kennung der Person, nie einen Namen oder ein Token.
--
-- Rein additiv, rollenneutral, keine Grants: Ein alter Server ignoriert den Kanal.

CREATE OR REPLACE FUNCTION avesmaps_auth.notify_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    -- Die Spalte mit der Kennung der Person kommt als Argument: `id` an `person`, sonst `person_id`.
    PERFORM pg_notify('avesmaps_auth_changed', to_jsonb(NEW) ->> TG_ARGV[0]);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER session_change_notify
    AFTER UPDATE OF revoked_at, rotate_required ON avesmaps_auth.session
    FOR EACH ROW
    WHEN (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.rotate_required IS DISTINCT FROM OLD.rotate_required)
    EXECUTE FUNCTION avesmaps_auth.notify_change('person_id');

CREATE OR REPLACE TRIGGER person_change_notify
    AFTER UPDATE OF status ON avesmaps_auth.person
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION avesmaps_auth.notify_change('id');

CREATE OR REPLACE TRIGGER person_access_change_notify
    AFTER UPDATE OF role, status ON avesmaps_auth.person_access
    FOR EACH ROW
    WHEN (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION avesmaps_auth.notify_change('person_id');

CREATE OR REPLACE TRIGGER capability_grant_change_notify
    AFTER UPDATE OF revoked_at ON avesmaps_auth.capability_grant
    FOR EACH ROW
    WHEN (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    EXECUTE FUNCTION avesmaps_auth.notify_change('person_id');

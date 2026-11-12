-- Die Revision einer Person zählt nur Verwaltungsänderungen (WI-0120 A7, ADR-0020).
--
-- 🪤 Jede Anmeldung schreibt `person.last_login_at`. Mit dem Trigger aus 0079 zählte sie dabei die Revision hoch: Wer eine
-- Person sperren wollte, bekam 409 `edit_conflict`, sobald diese sich zwischendurch angemeldet hatte. Der Trigger feuert
-- jetzt nur, wenn eine Verwaltungsspalte im `SET` steht; `updated_at` ist damit die letzte Verwaltungsänderung.
--
-- Rein additiv, rollenneutral; alter und neuer Server arbeiten mit beiden Fassungen.

CREATE OR REPLACE TRIGGER person_revision
    BEFORE UPDATE OF display_name, status, locked_at, locked_by, lock_reason ON avesmaps_auth.person
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

-- Die Revision eines Orts steigt über beide Tafeln (Fehler 2026-10-12, WI-0128 D20/E16).
--
-- Ein Ort wandert mit DERSELBEN `public_id` zwischen `place` und `place_unplaced` (0105): „⊖ Von der Karte nehmen“ legt die Zeile in
-- `place` still und holt die in `place_unplaced` zurück, „Auf die Karte setzen“ umgekehrt. Beide Trigger zählten ihre Zeile für sich
-- (`revision_bump()`, 0079: OLD + 1). Wurde der Ort zwischen zwei Wechseln bearbeitet, lag die zurückgeholte Zeile hinter der anderen,
-- die Revision des Objekts fiel zurück, und das Fachprotokoll wies die Operation ab (`map_audit_event_revision_forward`, 0091): 500 beim
-- Abnehmen von „Vali's Heimat“ (Betreiber, lokal, 2026-10-12).
--
-- `revision_bump_forward()` zählt wie `revision_bump()`, übernimmt aber eine HÖHERE Revision, die die Operation selbst setzt:
-- GREATEST(OLD + 1, NEW). Beim Wechsel setzt die Anwendung beide Zeilen auf die höchste Revision beider Tafeln plus eins
-- (`nextObjectRevision` in `apps/server/src/editor/place-edit.ts`). `SET revision = revision … AND revision = $base` zählt weiter genau
-- einmal; eine niedrigere Revision als OLD + 1 lässt sich nie setzen.
--
-- Additiv: eine neue Funktion, die beiden Trigger zeigen auf sie, ihre Spaltenlisten unverändert aus 0108. Das vorige Release setzt
-- `revision` nie über den Stand hinaus und zählt damit genau wie bisher. Keine Datenänderung: Ein Ort, dessen Zeilen schon
-- auseinanderliefen, geht beim nächsten Wechsel über die höhere. Keine neuen Rechte: PostgreSQL prüft das Recht an der
-- Triggerfunktion beim Anlegen des Triggers (Migrationsrolle), nicht beim Feuern.

CREATE OR REPLACE FUNCTION public.revision_bump_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.revision := GREATEST(OLD.revision + 1, NEW.revision);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.revision_bump_forward() IS
    'Wie revision_bump(), übernimmt aber eine höhere gesetzte Revision (GREATEST(OLD + 1, NEW)): ein Ort wechselt zwischen place und place_unplaced, ohne dass seine Revision zurückfällt (0115).';

CREATE OR REPLACE TRIGGER place_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, geom, is_active, is_hidden, is_ruined, is_nodix, is_seaport, place_kind,
                     source_system, legacy_public_id, is_underground, is_withdrawn, revision
    ON place
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

CREATE OR REPLACE TRIGGER place_unplaced_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, place_kind, is_hidden, is_ruined, is_nodix, is_seaport, is_underground,
                     is_withdrawn, description, einwohner, lage, oberhaupt, is_active, revision
    ON place_unplaced
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

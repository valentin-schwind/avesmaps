-- Konto auflösen: die Begründungen einer Person im Kartenprotokoll schwärzen (WI-0265 B7; Fachvertrag `project-control/planning/
-- aenderungen-arbeitsserien-fachvertrag.md` F.3; Claudios Antwort „F.3 Schwärzen: Ja“ in `project-control/handovers/2026-10-31-community-weg-b-
-- antwort-an-claudia.md`; Betreiber 2026-10-09 „1 B“: echt löschen, „Ehemalige Person lassen“). Gegenstück zu `public.redact_person_media()` (0088)
-- für die Karte; `dissolve.ts` ruft beide in derselben Transaktion.
--
-- Anlass: Wer eine FREMDE Änderung zurücknimmt, muss einen Grund angeben (WI-0265, Gate 2). Er steht als `restoreReason` im Fachprotokoll
-- (`map_audit_event.changes`) und ist im Reiter „Änderungen“ sichtbar. Freitext kann einen Namen tragen, eine Mail, eine Beschwerde. Dort bleibt er
-- nicht stehen, wenn das Konto aufgelöst wird.
--
-- 🔴 Wessen Freitext? Wie bei den Medien (0088) gilt: Ein Grund, den eine Person über IHRE Handlung schrieb, fällt mit IHRER Auflösung. Geschwärzt
-- wird nur, was die Person als Handelnde (`map_operation.actor_person_id`) schrieb; der Grund einer anderen Person in einer Rücknahme, die
-- Änderungen DIESER Person betrifft, bleibt (wie in 0083: ein Name in fremdem Freitext ist nicht erkennbar und fällt mit der Auflösung des Schreibenden).
--
-- Was sich ändert; die Struktur bleibt (Kennung, Zeit, Revisionen, Ziel, Verknüpfung zu den zurückgenommenen Operationen):
--
-- 1. Fachprotokoll `map_audit_event.changes` ihrer Operationen: die Freitextschlüssel (Liste unten, dieselbe wie `MAP_AUDIT_FREE_TEXT_KEYS` in
--    `apps/server/src/editor/map-audit-freitext.ts`; heute allein `restoreReason`) bekommen den Wert "[geschwärzt]". Der Schlüssel bleibt, und
--    zwar mit seiner Form `{ "after": … }`: Der Reiter liest `changes -> 'restoreReason' ->> 'after'` und zeigt dann die Marke als Grund
--    (`editor/history-status.ts`); die Rücknahme einer Rücknahme überspringt den Schlüssel (`ruecknahme-*.ts`: „ist kein Feld des Gegenstands“).
-- 2. `map_operation.request_hash` ihrer Operationen wird NULL: Der Hash über den Inhalt der Anfrage enthielt den Grund (`reason` im Körper einer
--    Rücknahme) und ließe ihn durch Raten bestätigen (wie 0083 und 0088). Es sind alle ihre Operationen, nicht nur die Rücknahmen: Welche Felder ein
--    Körper trägt, weiß diese Funktion nicht, und der Hash dient nur der Wiederholung binnen Sekunden. Eine Wiederholung derselben Kennung bekommt
--    danach 409 statt der Quittung (`replay()` in `auth/operations.ts` behandelt NULL). Dafür lockert diese Migration eine Bedingung, siehe unten.
--
-- Bewusst NICHT geschwärzt (Inhalt der Karte, nicht Begründung der Person über ihre Handlung; sonst bräche die Rücknahme dieser Felder, und die
-- Karte verlöre Geschichte):
--
-- - alle übrigen Schlüssel in `map_audit_event.changes` (`MAP_AUDIT_FIELDS` in `editor/map-operation.ts`): Name, Beschreibung, Lage, Oberhaupt,
--   `editorNote` der Quelle, des Werks, des Korpus und des Lore-Eintrags (Redaktionsnotiz am Datensatz, ein Karteninhalt), Quellenverwendungen mit
--   ihrer `note` (Beleg), Wiki-Werte. Ihr `before` ist der Wert, den die Rücknahme zurückschreibt.
-- - `map_operation.summary`: ein Satz für den Verlauf mit dem Namen des Gegenstands („Gratenfels verschoben“), „keine Person, kein Freitext eines
--   Antrags“ (0091); die Rücknahmen nennen darin nur Zahl und Gegenstand, nie den Grund.
-- - `map_operation.actor_label` und `approval_ref`: bei einer Person leer; sie tragen nur Agenten (`claudia`, `claudio`) und den Verweis auf die
--   Freigabe des Betreibers.
-- - `map_operation.receipt`: Kennungen, Revisionen, Warnungen des Systems, kein Text der Person.
-- - `map_operation.community_vorgang` (0272): die COM-Nummer; was dort personenbezogen ist, entpersonalisiert das Community-Modul selbst.
-- - `actor_person_id` und `at`: pseudonym (die Person heißt nach der Auflösung „Ehemalige Person …“); „wer, wann“ bleibt die Geschichte.
--
-- 🔴 Eine Bedingung wird gelockert (`map_operation_request_from_runner`, 0091): Sie verlangte für Operationen des Editors Hash UND Quittung. Künftig
-- genügt die Quittung; der Hash darf nach dem Schwärzen fehlen. Die Spalte `request_hash` trägt kein NOT NULL (0091), ihre Bedingung `…_hash_sha256`
-- lässt NULL zu. Das vorige Release schreibt jede Operation weiter mit Hash und kann die neue Bedingung nicht verletzen; bestehende Zeilen erfüllen
-- sie. Es liest die Spalte nur in `MAP_OPERATION_STORE.find` und `replay()`, und beide kennen NULL seit 0088 (Typ `StoredOperation`): Es
-- behandelt eine Zeile ohne Hash als „andere Handlung“ (409), nicht als Fehler. Rein gelockert, nichts wird entfernt (`migration-compat.test.ts`).
--
-- Wächter: `map_operation` und `map_audit_event` haben KEINEN Trigger gegen Änderungen (anders als `media_publication_suspension`, 0086); „nur
-- anhängen“ erzwingt allein das Rechtesystem (`map-grants.psql`: kein UPDATE, kein DELETE für die App-Rolle). Es gibt also keinen Wächter zu
-- erweitern. Geschwärzt wird, wie in 0083 und 0088, nur hier, in einer Funktion mit `SECURITY DEFINER`, die der Migrationsrolle gehört, und immer nur
-- für EINE Person. Die App-Rolle darf sie aufrufen, weil `auth aufloesen` auf dem VPS mit ihr läuft: Das EXECUTE auf eine Funktion in `public` gibt
-- ihr das Default-Privileg der Migrationsrolle (`sql_env`, `ops/runtime/runtime-foundation.sh`: `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS
-- TO app`), PUBLIC nimmt es die Migration. Wie bei `redact_person_media` steht darum in `map-grants.psql` keine Zeile dafür, nur ein Kommentar.
--
-- Wiederholbar: Ein geschwärzter Wert und ein leerer Hash zählen nicht noch einmal, ein zweiter Aufruf gibt 0 (so holt auch ein Aufruf nach dem
-- Release die Schwärzung für ein früher aufgelöstes Konto nach). Rückgabe ist die Zahl der geänderten Zeilen (Protokolleinträge plus Operationen).
-- Fester Suchpfad, jeder Name voll qualifiziert (`render-grants.test.ts`).

ALTER TABLE map_operation
    DROP CONSTRAINT IF EXISTS map_operation_request_from_runner,
    ADD CONSTRAINT map_operation_request_from_runner CHECK (source IN ('import', 'testwelt_reset') OR receipt IS NOT NULL);

COMMENT ON COLUMN map_operation.request_hash IS
    'SHA-256 des Anfrageinhalts ohne Geheimnisse; nur bei editor, restore und wikisync. NULL nach dem Auflösen des Kontos der handelnden Person (Migration 0273): Die Kennung antwortet dann mit 409 statt der Quittung.';

CREATE OR REPLACE FUNCTION redact_person_map_operation(person_ref uuid) RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
DECLARE
    mark_text CONSTANT text := '[geschwärzt]';
    mark CONSTANT jsonb := to_jsonb(mark_text);
    -- Die Freitextschlüssel des Fachprotokolls; dieselbe Liste wie MAP_AUDIT_FREE_TEXT_KEYS.
    free_text CONSTANT text[] := ARRAY['restoreReason'];
    changed bigint;
    total bigint := 0;
BEGIN
    IF person_ref IS NULL THEN
        RETURN 0;
    END IF;

    -- 1. Fachprotokoll: der Grund in den Einträgen ihrer Operationen. `changes -> schluessel` ist ein Objekt `{ "after": … }` (Feld → vorher/nachher); jeder
    --    Wert darin außer JSON-null und der Marke wird zur Marke, die Seiten und der Schlüssel bleiben. Ein Wert ohne diese Form wird als Ganzes zur Marke.
    WITH planned AS (
        SELECT e.id,
               (
                   SELECT jsonb_object_agg(
                              k.key,
                              CASE WHEN jsonb_typeof(e.changes -> k.key) = 'object' THEN (
                                       SELECT jsonb_object_agg(s.key, CASE WHEN s.value IN ('null'::jsonb, mark) THEN s.value ELSE mark END)
                                         FROM jsonb_each(e.changes -> k.key) AS s
                                   )
                                   ELSE mark
                              END
                          )
                     FROM unnest(free_text) AS k (key)
                    WHERE e.changes ? k.key
                      AND CASE WHEN jsonb_typeof(e.changes -> k.key) = 'object' THEN EXISTS (
                                   SELECT 1 FROM jsonb_each(e.changes -> k.key) AS t WHERE t.value NOT IN ('null'::jsonb, mark)
                               )
                               ELSE e.changes -> k.key NOT IN ('null'::jsonb, mark)
                          END
               ) AS blackened
          FROM public.map_audit_event e
         WHERE e.operation_id IN (SELECT o.operation_id FROM public.map_operation o WHERE o.actor_person_id = person_ref)
           AND e.changes ?| free_text
    )
    UPDATE public.map_audit_event e
       SET changes = e.changes || p.blackened
      FROM planned p
     WHERE e.id = p.id AND p.blackened IS NOT NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    -- 2. Der Hash über den Inhalt ihrer Anfragen.
    UPDATE public.map_operation SET request_hash = NULL WHERE actor_person_id = person_ref AND request_hash IS NOT NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    RETURN total;
END;
$$;

COMMENT ON FUNCTION redact_person_map_operation(uuid) IS
    'Konto auflösen (WI-0265 B7, Migration 0273): die Begründungen EINER Person im Kartenprotokoll schwärzen, den Hash ihrer Anfragen leeren. Nur über dissolve.ts.';

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur, wem die Default-Privilegien es geben (die App-Rolle, `sql_env`).
REVOKE ALL ON FUNCTION redact_person_map_operation(uuid) FROM PUBLIC;

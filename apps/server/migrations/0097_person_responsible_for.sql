-- „Verantwortlich für:“ je Person (WI-0133, Betreiber 2026-10-10).
--
-- Betreiber, wörtlich: „kannst du hier ein freies editierbares text feld hinzufügen, das allepersonen mit account für sich (und den den
-- betreibern) editiere können (betreiben können es auch ändern), wo einfach "Verantwortlich für:" dranstehen. Das kann ein einzeiliges
-- textfeld sein. das steht später dann bei den statusanzeigen unter den namen z.B. (Vali - Verantwortlich für: "Entwicklung, Claudia,
-- Claudio, Gemotze")“.
--
-- Ein Freitext an der Person (Identität, nicht je Umgebung): die Person selbst über `/api/account/responsibility` (Stufe R), Betreiber
-- über `/api/admin/people/responsibility` (`set_responsibility`, Stufe V). Das Protokoll (`person.responsibility_changed`) hält nur
-- fest, DASS und von wem er geändert wurde, nie den Text. Beim Auflösen eines Kontos wird er geleert (`auth/dissolve.ts`).
--
-- 🔴 ADDITIV, das vorige Release erträgt es (AGENTS „erst erweitern, dann umstellen, dann entfernen“):
--   - Die Spalte ist nullbar und hat keinen Vorgabewert; das vorige Release liest und schreibt sie nicht und legt Personen ohne sie an.
--   - Die Prüfung gilt nur der neuen Spalte; NULL erfüllt sie. Leer heißt NULL: '' und reine Leerzeichen stehen nie in der Tafel.
--   - Einzeilig: kein Steuerzeichen (C0 samt Zeilenumbruch und Tabulator, DEL, C1; als Bereiche ausgeschrieben, weil `[[:cntrl:]]`
--     von der Locale abhängt) und kein Zeilen- oder Absatztrenner (U+2028, U+2029). Höchstens
--     120 Zeichen (Codepunkte, wie `char_length`). Der Server prüft dasselbe vorher (`responsibilityProblem` in packages/shared) und
--     antwortet 400 `responsibility_invalid`; die Bedingung hier fängt nur, was an ihm vorbei geschrieben würde.
--   - Der Trigger der Revision zählt die Spalte mit (wie den Anzeigenamen, 0080): Zwei Betreiber, die gleichzeitig ändern, bekommen
--     409 `edit_conflict` statt eines still verlorenen Textes. Eine Anmeldung (`last_login_at`) zählt weiter nicht.
--   - Rechte: Die App-Rolle hat `SELECT, INSERT, UPDATE` auf der ganzen Tafel `avesmaps_auth.person` (auth-grants.psql); eine neue
--     Spalte braucht keine eigene Zeile.

ALTER TABLE avesmaps_auth.person ADD COLUMN IF NOT EXISTS responsible_for TEXT;

ALTER TABLE avesmaps_auth.person
    DROP CONSTRAINT IF EXISTS person_responsible_for_line,
    ADD CONSTRAINT person_responsible_for_line CHECK (
        responsible_for IS NULL
        OR (
            char_length(responsible_for) BETWEEN 1 AND 120
            AND responsible_for ~ '[^[:space:]]'
            AND responsible_for !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'
        )
    );

COMMENT ON COLUMN avesmaps_auth.person.responsible_for IS
    '„Verantwortlich für:“ (WI-0133, Betreiber 2026-10-10): freiwilliger Freitext der Person, eine Zeile, höchstens 120 Zeichen; NULL = nicht gesetzt. Ändern: die Person selbst oder ein Betreiber (set_responsibility). Nie im Protokoll; beim Auflösen geleert.';

CREATE OR REPLACE TRIGGER person_revision
    BEFORE UPDATE OF display_name, status, locked_at, locked_by, lock_reason, responsible_for ON avesmaps_auth.person
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

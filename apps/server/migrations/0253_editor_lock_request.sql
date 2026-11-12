-- Die Bitte um Freigabe einer Sperre (WI-0262, OPS-000059; Vali 2026-10-30: „OPS-059 entscheiden ja“). Wer ein Objekt sieht, das ein
-- anderer gerade bearbeitet, bittet den Inhaber um Freigabe; der Inhaber sieht die Bitte mit dem nächsten Herzschlag und antwortet
-- „freigegeben“ (sein Browser speichert den Entwurf über „Fertig“ und gibt die Sperre ab) oder „später“. Läuft nach 5 Minuten ab.
--
-- Warum eine eigene Tafel und keine Spalte an `editor_lock` (0138): Die Sperre hat je Objekt EINE Zeile, die mit dem Freigeben
-- verschwindet, und die Antwort „freigegeben“ muss danach noch lesbar sein; es kann mehrere Bittende zugleich geben (je Person
-- eine). Die Anfrage gehört zum Halter, nicht zum Objekt: `holder_run` hält fest, WEM die Bitte galt, damit nur dieser Lauf antwortet
-- und eine Bitte an den früheren Halter keinen späteren trifft.
--
-- Der Stand `state`: `open`, dann `released` (Inhaber gab frei oder gab die Sperre sonst ab), `later` (Inhaber vertagte) oder
-- `expired` (nach 5 Minuten; der Server setzt das beim nächsten Bitten, gelesen wird es sofort aus `expires_at`). Höchstens eine
-- OFFENE Bitte je Person und Objekt (Teilindex): Eine neue ist erst nach Antwort oder Ablauf möglich. Personen stehen wie in
-- `editor_lock` ohne Fremdschlüssel ins geschützte Schema, mit dem Namen zur Zeit der Bitte. Alte Zeilen räumt das nächste Bitten weg.
--
-- 🔴 ADDITIV: eine neue Tafel, die das vorige Release nicht kennt. Rechte: In public gibt die Default-Privilegie der Migrationsrolle
-- der App-Rolle SELECT, INSERT, UPDATE, DELETE (`apps/server/src/db/map-grants.psql`, Kopf); mehr braucht die App nicht (bitten,
-- antworten, Alte wegräumen). `map-grants.psql` nimmt ihr TRUNCATE.

CREATE TABLE IF NOT EXISTS editor_lock_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Die Art und die Kennung des Objekts wie in `editor_lock`; ohne Fremdschlüssel, die Sperre darf verschwinden.
    object_kind TEXT NOT NULL CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline', 'peak')),
    object_id UUID NOT NULL,
    requester_person_id UUID NOT NULL,
    requester_name TEXT NOT NULL CHECK (length(requester_name) BETWEEN 1 AND 200),
    requester_run UUID NOT NULL,
    -- Wer die Sperre zur Zeit der Bitte hielt: Person und Lauf. Nur dieser Lauf antwortet.
    holder_person_id UUID NOT NULL,
    holder_run UUID NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'released', 'later', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes',
    answered_at TIMESTAMPTZ
);
COMMENT ON TABLE editor_lock_request IS
    'Bitte um Freigabe einer Sperre (WI-0262): höchstens eine offene je Person und Objekt, läuft nach 5 Minuten ab, nur der Halter antwortet.';

-- Höchstens eine offene Bitte je Person und Objekt.
CREATE UNIQUE INDEX IF NOT EXISTS editor_lock_request_one_open
    ON editor_lock_request (object_kind, object_id, requester_person_id) WHERE state = 'open';
-- Was der Herzschlag des Halters liest.
CREATE INDEX IF NOT EXISTS editor_lock_request_holder ON editor_lock_request (holder_run) WHERE state = 'open';
-- Was die Liste dem Bittenden zeigt, und das Wegräumen nach Alter.
CREATE INDEX IF NOT EXISTS editor_lock_request_requester ON editor_lock_request (requester_person_id, object_kind);
CREATE INDEX IF NOT EXISTS editor_lock_request_created ON editor_lock_request (created_at);

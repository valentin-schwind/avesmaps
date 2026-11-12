-- Die Sperre während der Bearbeitung (EDIT-0003 §4, T27 (14); WI-0178, die Landschaft-Sitzung als erster Nutzer, gebaut an gemeinsamer
-- Stelle für alle Editoren). Betreiber 2026-10-16, wörtlich: „objekte sollen gesperrt werden / sein, wenn sie jemand bearbeitet“; der
-- Betreiber wählte „15 Minuten“ auf die Frage „Wie lange hält eine Sperre ohne Aktivität?“ (2026-10-16).
--
-- EINE Tafel, eine Zeile je Objekt (Art und Kennung), nach Claudios Einschätzung (Antwort
-- `project-control/handovers/2026-10-16-antwort-b1-sperre-commitwaechter-an-claudia.md` §2):
--   - kein Advisory Lock (er hängt an einer Verbindung des Pools) und kein Prozessspeicher (die Stage startet mehrmals am Tag neu);
--   - FREI ist ein Objekt, dessen letzter Herzschlag älter als 15 Minuten ist; wer es dann nimmt, überschreibt die Zeile. Die Richtigkeit
--     braucht also keinen Aufräumer; alte Zeilen räumt der Schreibweg selbst weg (`apps/server/src/editor/editor-lock.ts`).
--   - Der Herzschlag kommt als kleines POST alle 60 s (Entscheidung der Orchestrierung, EDIT-0003 §4), nie auf `info` protokolliert.
--   - Ein Zug hält weiter seine Domänensperre (T17), Speichern antwortet dann 423; diese Sperre bleibt dabei bestehen.
--
-- Die Person steht ohne Fremdschlüssel ins geschützte Schema, mit ihrem Namen zur Zeit des Nehmens (wie `map_setting.changed_by`, 0134):
-- Das Schild „🔒 Thomas · Form · seit …“ (T27 (3)) liest nur diese Tafel. `lauf` ist die Kennung des Bearbeitens im Browser (ein Fenster,
-- ein Modus): Dieselbe Person in einem zweiten Fenster ist ein anderer Lauf.
--
-- 🔴 ADDITIV: eine neue Tafel, die das vorige Release nicht kennt. Rechte: In public gibt die Default-Privilegie der Migrationsrolle der
-- App-Rolle SELECT, INSERT, UPDATE, DELETE (`apps/server/src/db/map-grants.psql`, Kopf); die App braucht genau das (Nehmen, Herzschlag,
-- Freigeben, Wegräumen). `map-grants.psql` nimmt ihr TRUNCATE.

CREATE TABLE IF NOT EXISTS editor_lock (
    -- Die Art des Objekts wie im Register der Handgriffe (`EditorMenuSubject.ref.kind` im Client).
    object_kind TEXT NOT NULL CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline')),
    object_id UUID NOT NULL,
    -- Woran gearbeitet wird, für das Schild: die Form (ein Modus auf der Karte) oder die Felder des Fensters.
    part TEXT NOT NULL CHECK (part IN ('form', 'felder')),
    person_id UUID NOT NULL,
    person_name TEXT NOT NULL CHECK (length(person_name) BETWEEN 1 AND 200),
    run_id UUID NOT NULL,
    since TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (object_kind, object_id)
);
COMMENT ON TABLE editor_lock IS
    'Sperre während der Bearbeitung (EDIT-0003 §4): je Objekt höchstens eine Zeile; frei, wenn der Herzschlag älter als 15 Minuten ist.';

-- Was gerade gilt, liest die Karte je Art (Schraffur und Schild); das Wegräumen sucht nach Alter.
CREATE INDEX IF NOT EXISTS editor_lock_heartbeat ON editor_lock (heartbeat_at);

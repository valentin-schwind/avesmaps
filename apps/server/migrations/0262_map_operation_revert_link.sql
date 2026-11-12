-- Rücknahmen merken sich, welche Operationen sie zurücknehmen (WI-0265 B1; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-
-- fachvertrag.md` C.4, Modell α; Betreiber 2026-10-31: Probierseite als Bauvorlage abgenommen).
--
-- Bisher trug nur der Anfragekörper das Feld `reverts`; gespeichert war es nirgends. Eine Rücknahme (Quelle `restore`) kann EINE Operation
-- zurücknehmen (die Einzelrücknahme im Verlauf) oder künftig mehrere auf einmal (eine Arbeitsserie): Darum eine Verknüpfungstafel statt
-- einer Spalte an `map_operation` (1:N, referenzielle Integrität, die Rückwärtsfrage „wer nahm das zurück“ per Index; `map_operation`
-- bleibt unberührt).
--
--   restore_operation_id   die Operation, die zurücknimmt (die neue, `source = 'restore'`)
--   reverted_operation_id  die Operation, die dadurch zurückgenommen wurde
--   position               die Reihenfolge in der Anfrage, von 0 an; je Rücknahme eindeutig
--
-- Nur anhängen wie die Mutter: Die App-Rolle darf SELECT und INSERT (`apps/server/src/db/map-grants.psql`). Der Schreiber legt die Zeilen in
-- DERSELBEN Transaktion an wie die Operation (`mapOperation`, `MAP_OPERATION_STORE.record`); ein Replay derselben Kennung schreibt nichts neu.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Tafel, die das vorige Release nicht kennt und nie schreibt. Ältere Rücknahmen ohne
-- Verknüpfung bleiben unverknüpft; es gibt keinen Backfill nach Vermutung (Fachvertrag C.4).
--
-- Fremdschlüssel mit ON DELETE CASCADE: Gelöscht wird eine Operation nur vom Zurücksetzen der Testwelt (`editor/testwelt.ts`) und von
-- Testaufräumen unter der Migrationsrolle; die App-Rolle darf nie löschen. Eine Verknüpfung ohne ihre Operation hätte keinen Sinn, und
-- die Löschstellen müssen die Tafel nicht kennen.

CREATE TABLE IF NOT EXISTS map_operation_revert_link (
    restore_operation_id UUID NOT NULL REFERENCES map_operation (operation_id) ON DELETE CASCADE,
    reverted_operation_id UUID NOT NULL REFERENCES map_operation (operation_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (restore_operation_id, reverted_operation_id),
    CONSTRAINT map_operation_revert_link_position_valid CHECK (position >= 0),
    CONSTRAINT map_operation_revert_link_not_self CHECK (restore_operation_id <> reverted_operation_id),
    CONSTRAINT map_operation_revert_link_position_unique UNIQUE (restore_operation_id, position)
);

-- „Wer nahm diese Operation zurück?“ (Status des Originals im Verlauf); die Richtung davon deckt der Primärschlüssel.
CREATE INDEX IF NOT EXISTS map_operation_revert_link_reverted ON map_operation_revert_link (reverted_operation_id);

COMMENT ON TABLE map_operation_revert_link IS
    'Welche Operationen eine Rücknahme zurücknimmt (WI-0265 B1, Fachvertrag C.4): 1:N, Reihenfolge der Anfrage in position (von 0). Nur anhängen.';
COMMENT ON COLUMN map_operation_revert_link.position IS 'Reihenfolge in der Anfrage (`reverts`), von 0 an; je Rücknahme eindeutig.';

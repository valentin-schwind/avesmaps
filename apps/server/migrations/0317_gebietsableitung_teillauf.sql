-- 0317: Die Ableitung der Herrschaftsgebiete rechnet nach einer Editoränderung nur den betroffenen Bereich (WI-0283 §4; Vali 2026-11-06 über Claudio:
-- Herrschaftsgebiete „rechnen länger als in Legacy“, Legacy rechnet Teilbaum und Vorfahren).
--
-- Zwei Bausteine, beide abgeleitet und jederzeit aus dem vollen Lauf wiederherstellbar:
--
-- - `territory_state.derive_inputs`: der Abdruck der Eingaben des letzten Laufs. Der Teillauf vergleicht ihn mit den heutigen Eingaben und weiß so, was sich
--   geändert hat, ohne dass ein Schreibweg etwas melden muss. Ohne Abdruck rechnet die Ableitung voll.
-- - `territory_inner_edge`: die Kanten der Innengrenzen, bisher eine Arbeitstafel je Lauf. Die Zeile `inner` eines Reichs vereinigt alle seine Kanten, und das
--   Entdoppeln vergleicht über alle Eigner hinweg; ohne die stehenden Kanten müsste ein Teillauf wieder fast alles rechnen. `raw_*` ist die Kante vor dem
--   Entdoppeln, `lebt` das Ergebnis des ersten Schritts, `geom` und `len` das des zweiten.
--
-- 🔴 ERWEITERND: eine Spalte, eine Tafel, kein Eingriff in Gelesenes. Das vorige Release schreibt den Abdruck nicht und lässt die Kanten stehen; der nächste
-- Lauf des neuen Standes erkennt das an der Revision im Abdruck und rechnet voll. Die Jobs-Rolle bekommt ihre Rechte in `map-grants.psql`.

ALTER TABLE territory_state ADD COLUMN IF NOT EXISTS derive_inputs JSONB;
COMMENT ON COLUMN territory_state.derive_inputs IS
    'Abdruck der Eingaben des letzten Laufs (WI-0283): Woran der Teillauf erkennt, was sich geaendert hat. Abgeleitet; fehlt er, rechnet die Ableitung voll.';

CREATE TABLE IF NOT EXISTS territory_inner_edge (
    band SMALLINT NOT NULL,
    a_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    b_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    part INTEGER NOT NULL,
    owner_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    depth SMALLINT NOT NULL,
    raw_len DOUBLE PRECISION NOT NULL,
    raw_geom geometry NOT NULL,
    lebt BOOLEAN NOT NULL DEFAULT TRUE,
    len DOUBLE PRECISION NOT NULL,
    geom geometry NOT NULL,
    PRIMARY KEY (band, a_id, b_id, part)
);
CREATE INDEX IF NOT EXISTS territory_inner_edge_raw_gist ON territory_inner_edge USING GIST (raw_geom);
CREATE INDEX IF NOT EXISTS territory_inner_edge_eigner ON territory_inner_edge (band, owner_id);
COMMENT ON TABLE territory_inner_edge IS
    'Die Kanten der Innengrenzen je Band und Paar benachbarter Zellen (WI-0283). DERIVED DATA: Die Tafel territory_border vereinigt sie je Eigner.';

-- 0250: Die Lage zu einer Linie als Teil einer Regelbedingung (WI-0254, Regeleditor im Reiter „Vorkommen“, Bezug WI-0253 §27 B; Vali 2026-10-28 zum klickbaren Entwurf: „oh ja das is geil, bau das“).
--
--   Eine Bedingung einer Regel (`lore_rule_term`) hat bisher eine Fläche, Landschaftsarten und eine Klimaspanne. Dazu kommt die Lage zu einer Linie: „südlich von Gareth“, „nördlich der Linie Perricum–Havena“.
--   Sie steht NEBEN den anderen drei Teilen und schränkt wie diese ein (innerhalb einer Bedingung wirkt immer UND); „zwischen A und B“ sind zwei Bedingungen mit UND (die Ableitung baut das Paar).
--
--   - `line_direction`: die Richtung, `nord`, `sued`, `ost` oder `west` (nur diese vier; „nordöstlich“ ist keine Lage). NULL ohne Lage.
--   - `line_place_a_id`, `line_place_b_id`: die Orte der Linie als Siedlungen der Karte (`place.id`). Ein Ort: die Linie läuft waagerecht (Nord, Süd) oder senkrecht (Ost, West) durch ihn; zwei Orte: die
--     Linie läuft durch beide, auf der Karte verlängert. A–B ist B–A: Die Reihenfolge der Orte ist ohne Bedeutung und geht sortiert in den Fingerabdruck der Regel (`rule_key`, sechstes Feld nur MIT Lage).
--     Nach außen und im Fingerabdruck steht immer `place.public_id`, nie die Nummer.
--
--   Die Prüfung `lore_rule_term_line_check`: entweder alle drei Spalten leer, oder eine der vier Richtungen mit gesetztem Ort A und einem Ort B, der fehlt oder ein anderer ist als A. Dass ein Ort eine AKTIVE
--   SIEDLUNG ist (nicht Gebäude oder Stadtviertel), prüft der Schreibweg, nicht die Datenbank: Ein Ort darf später still gelegt werden, die Regel bleibt lesbar.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): drei neue, nullbare Spalten, die das vorige Release nie liest und nie schreibt; in jeder gespeicherten Bedingung sind sie leer, die neue Prüfung gilt also für
-- alles, was das vorige Release schreibt (alle drei NULL). Keine Datenänderung. Die Rechte ändern sich nicht (`apps/server/src/db/map-grants.psql`): Die App legt Bedingungen mit INSERT an, die neuen
-- Spalten schreibt sie nur dabei, UPDATE an `lore_rule_term` bleibt entzogen. Der Fremdschlüssel prüft beim Einfügen mit den Rechten des Eigentümers von `place`, braucht also kein Recht an `place`.

ALTER TABLE lore_rule_term ADD COLUMN IF NOT EXISTS line_direction TEXT;
ALTER TABLE lore_rule_term ADD COLUMN IF NOT EXISTS line_place_a_id BIGINT REFERENCES place (id);
ALTER TABLE lore_rule_term ADD COLUMN IF NOT EXISTS line_place_b_id BIGINT REFERENCES place (id);

ALTER TABLE lore_rule_term DROP CONSTRAINT IF EXISTS lore_rule_term_line_check;
ALTER TABLE lore_rule_term
    ADD CONSTRAINT lore_rule_term_line_check CHECK (
        (line_direction IS NULL AND line_place_a_id IS NULL AND line_place_b_id IS NULL)
        OR (
            line_direction IN ('nord', 'sued', 'ost', 'west')
            AND line_place_a_id IS NOT NULL
            AND (line_place_b_id IS NULL OR line_place_b_id <> line_place_a_id)
        )
    );

-- Teilindizes: nur Bedingungen mit Lage (fast keine); sie beantworten „welche Regeln nennen diesen Ort“ (Verwendungen am Ort) und den Fremdschlüssel.
CREATE INDEX IF NOT EXISTS lore_rule_term_line_place_a ON lore_rule_term (line_place_a_id) WHERE line_place_a_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lore_rule_term_line_place_b ON lore_rule_term (line_place_b_id) WHERE line_place_b_id IS NOT NULL;

COMMENT ON COLUMN lore_rule_term.line_direction IS
    'Die Lage zu einer Linie (0250): nord | sued | ost | west. NULL ohne Lage. Nur mit gesetztem line_place_a_id (lore_rule_term_line_check). Wirkt NEBEN Fläche, Landschaftsart und Klima (UND).';
COMMENT ON COLUMN lore_rule_term.line_place_a_id IS
    'Der erste Ort der Linie einer Lage (0250): eine Siedlung der Karte (place.id). Die Linie läuft durch ihn (waagerecht für Nord/Süd, senkrecht für Ost/West) oder, mit line_place_b_id, durch beide Orte. Nach außen und im rule_key place.public_id.';
COMMENT ON COLUMN lore_rule_term.line_place_b_id IS
    'Der zweite Ort der Linie (0250), oder NULL (dann läuft die Linie nur durch line_place_a_id). Anderer Ort als A; A–B ist B–A, darum geht die Reihenfolge nicht in den rule_key ein.';

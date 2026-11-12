-- 0327: Das Wetter bekommt eine vierte Icon-Art, den Mahlstrom (WI-0288; Betreiber 2026-11-08: eine eigene Icon-Art „Mahlstrom“ für den Wetter-Editor).
--
-- Ein Mahlstrom hat wie der Wirbel Lage, Reichweite, Stärke und einen Drehsinn, aber keine Richtung. Er wirkt nur im Feld der Meeresströmung. Darum:
--   1. `weather_symbol_art_check` (die unbenannte CHECK der Spalte `art` aus 0326, so benennt PostgreSQL sie) nimmt `mahlstrom` dazu.
--   2. `weather_symbol_richtung_oder_drehsinn` gilt für Wirbel UND Mahlstrom: Drehsinn ohne Richtung; alle übrigen Arten Richtung ohne Drehsinn.
--
-- 🔴 Nur gelockert (AGENTS.md, „erst erweitern“): Jede bestehende Zeile erfüllt beide weiteren Bedingungen, das vorige Release schreibt nie `mahlstrom`
-- und liest die Tafel mit der Art-Prüfung seines Schreibwegs (eine unbekannte Art übergeht der Leseweg). Keine Inhalte (Map Mutation Guard), keine neuen Rechte.

ALTER TABLE weather_symbol DROP CONSTRAINT IF EXISTS weather_symbol_art_check;
ALTER TABLE weather_symbol
    ADD CONSTRAINT weather_symbol_art_check CHECK (art IN ('wind', 'wirbel', 'stroemung', 'mahlstrom'));

ALTER TABLE weather_symbol DROP CONSTRAINT IF EXISTS weather_symbol_richtung_oder_drehsinn;
ALTER TABLE weather_symbol
    ADD CONSTRAINT weather_symbol_richtung_oder_drehsinn CHECK (
        (art IN ('wirbel', 'mahlstrom') AND richtung IS NULL AND drehsinn IS NOT NULL)
        OR (art NOT IN ('wirbel', 'mahlstrom') AND richtung IS NOT NULL AND drehsinn IS NULL)
    );

COMMENT ON TABLE weather_symbol IS
    'Icons des Wetters (WI-0288): Wind, Wirbel, Strömung, Mahlstrom; weich entfernt. Leer heißt: die Icons des Prototyps aus dem Code.';

-- Die Karteneinstellungen nehmen auch Text und Ja/Nein an (WI-0166, Panel „Routenplaner“; Betreiber 2026-10-15: „Bau als
-- Nächstes das Panel Routenplaner in die Karteneinstellungen (…), so dass alte Links gleich bleiben“).
--
-- 0134 hat den Wert auf eine Zahl oder ein Objekt beschränkt (`CHECK (jsonb_typeof(value) IN ('number', 'object'))`). Ein
-- Transportmittel ist aber ein Name (`"groupFoot"`), „Eiltempo“ ein Schalter (`true`) und der Reisebeginn auch einmal
-- `"unbestimmt"`. Art und Grenzen je Kennung prüft weiter die Tafel (`packages/shared/src/system/karteneinstellungen.ts`) —
-- im Schreibweg, und beim Lesen fällt ein unpassender Wert auf die Vorgabe zurück (`unknownKeys`).
--
-- 🔴 NUR LOCKERN: Die Bedingung fällt weg, keine neue kommt dazu. Das Release mit 0134 schreibt nur Zahlen und Punkte, also
-- nichts, was hier abgewiesen würde; ein Rückweg auf 0134 liest einen Text als „passt nicht“ und nimmt die Vorgabe. 0134 selbst
-- bleibt unverändert (ihre Prüfsumme steht in `schema_migration`).
ALTER TABLE map_setting DROP CONSTRAINT IF EXISTS map_setting_value_check;

COMMENT ON COLUMN map_setting.value IS
    'Der verstellte Wert als JSON: Zahl, Punkt {x,y}, Name, Schalter oder Reisebeginn; Art und Grenzen prüft die Tafel im Code (WI-0166).';

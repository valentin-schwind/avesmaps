-- 0194: Typ und Grundmuster eines Gebirges (WI-0226, Gebirge-Editor; Freigabe des Betreibers 2026-10-18: „gebirgseditor -> ich denk ja,
-- wir legen mal los.“).
--
--   1. `terrain_control.gebirgstyp`: der Gebirgstyp als Eigenschaft (Betreiber 2026-10-17, F1). Die Werte des Typs stehen im Preset der
--      Höhenmodell-Fassung (F3, Gruppe `gebirgsPresets`); die elf Spalten daneben sind Abweichungen davon (F2), leer heißt „Wert des
--      Typs“. Ohne Gruppe in der gültigen Fassung (bis Fassung 19) bleibt der Typ für die Rechnung ohne Wirkung.
--   2. `terrain_control.muster`: das Grundmuster als Abweichung vom Preset, „rauschen“ (Legacys Weg) oder „zellen“ (Betreiber
--      2026-10-18 für Bergland und Massengebirge). Leer heißt „Muster des Typs“, ohne Typ „rauschen“.
--
--   Die Schlüssel der Typen und Muster stehen im Vertrag `packages/shared/src/gebirge/vertrag.ts`; geprüft wird beim Schreiben
--   (`GebirgsAenderung`), nicht hier: Neue Typen kommen mit einer Fassung, und ein CHECK auf einer alten Tafel wäre kein reines
--   Erweitern. Legacy kennt beide Spalten nicht: Der Landschaften-Zug (`migration/terrain.ts`) schreibt nur die elf Werte und lässt sie
--   stehen (F10).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei Spalten ohne Vorgabe und ohne NOT NULL. Das vorige Release liest und schreibt sie nie;
-- alle Zeilen stehen auf leer, und das Gelände rechnet bytegleich wie vorher (Beleg im Work Item).

ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS gebirgstyp TEXT;
ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS muster TEXT;

COMMENT ON COLUMN terrain_control.gebirgstyp IS
    'Gebirgstyp (WI-0226, F1): Schluessel eines Presets der Hoehenmodell-Fassung; leer = ohne Typ. Ohne Preset-Gruppe in der Fassung ohne Wirkung.';
COMMENT ON COLUMN terrain_control.muster IS
    'Grundmuster als Abweichung vom Preset (WI-0226): rauschen (Legacy) oder zellen; leer = Muster des Typs, ohne Typ rauschen.';

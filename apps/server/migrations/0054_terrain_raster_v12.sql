-- Das ungeschnittene Raster je Gebirge (WI-0059, Entscheidung 4.2). Derived Data wie der Rest von
-- terrain_raster: ein Verlust kostet einen Lauf von `derive:terrain` (alle Gebirge neu, wie vor dieser Migration),
-- keinen Import. Keine zweite Wahrheitsquelle: Es ist das Ergebnis von Legacys Rechnung V12 aus den
-- Gelaende-Eingaben, VOR dem Einbrennen der Fluesse (`river-burn.ts`), und wird von keinem Leser ausser
-- `derive:terrain` und `verify:terrain-dem` gelesen. Routing, Kacheln und Wegprofile lesen weiter `samples`.
--
-- Warum gespeichert: Die Fluesse werden in die Raster eingebrannt (S6); das Ergebnis haengt am ganzen
-- Flussnetz einer Gruppe von Gebirgen. Aendert sich ein Gipfel, muss die Gruppe von IHREM ungeschnittenen
-- Stand aus neu gebrannt werden. Ohne dieses Raster hiesse das, alle Gebirge der Gruppe neu zu rechnen
-- (V12 braucht fuer das groesste Gebirge allein rund 50 s); mit ihm rechnet nur das geaenderte Gebirge V12
-- neu, die Gruppe brennt in Sekunden.
--
-- NULL = noch nicht abgeleitet (Raster aus der Zeit vor dieser Migration): der naechste Lauf rechnet dieses
-- Gebirge neu. `samples` bleibt das eingebrannte Raster.

ALTER TABLE terrain_raster
    ADD COLUMN IF NOT EXISTS v12_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS v12_samples BYTEA
        CONSTRAINT terrain_raster_v12_samples_size CHECK (v12_samples IS NULL OR octet_length(v12_samples) = width * height * 2);

COMMENT ON COLUMN terrain_raster.v12_fingerprint IS
    'Fingerabdruck der Rechnung V12 dieses Gebirges (Eingaben, Regeln, Generator), ohne die Fluesse. WI-0059.';
COMMENT ON COLUMN terrain_raster.v12_samples IS
    'Das Raster wie V12 es liefert, vor dem Einbrennen der Fluesse (gleiches Gitter wie samples). Derived Data, WI-0059.';

-- 0282: Der Stand des Syncs je Objekt (`wikisync_objekt`, Migration 0238) kennt den Gipfel (WI-0271 L4, Wiki-Box für jede Landmarke).
--
--   Die Wiki-Box trägt seit L4 auch die Art `gipfel` (jede Zeile von `terrain_peak`, `WIKI_BOX_ARTEN`). Ihr letzter Sync und sein Fehler
--   stehen in `wikisync_objekt`; deren CHECK der Art kannte nur Ort, Weg, Gebiet, Region und Kraftlinie. Ohne `gipfel` bräche das INSERT
--   des Stands und mit ihm die ganze Übernahme der Gipfel (`wiki/objekt/stand.ts`).
--
-- 🔴 Nur gelockert (AGENTS.md, „erst erweitern“): Die bisherigen fünf Arten bleiben, `gipfel` kommt dazu. Das vorige Release schreibt nie
-- `gipfel`, jede bestehende Zeile erfüllt die neue Bedingung.

ALTER TABLE wikisync_objekt DROP CONSTRAINT IF EXISTS wikisync_objekt_art_check;
ALTER TABLE wikisync_objekt
    ADD CONSTRAINT wikisync_objekt_art_check CHECK (art IN ('ort', 'weg', 'gebiet', 'region', 'kraftlinie', 'gipfel'));

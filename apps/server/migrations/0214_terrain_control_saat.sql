-- 0214: Eine gespeicherte Saat je Gebirge (WI-0245, abgenommener Entwurf V16/V17: „Saat mit ⟳ neu würfeln“; Freigabe über die
-- Hauptorchestrierung 2026-10-21). Bisher leitet das Gelände die Saat allein aus Kennung und Geometrie-Revision der Fläche ab (`seedOf`,
-- `terrain/inputs.ts`). Der Editor schreibt hier eine gewürfelte Saat; leer heißt „abgeleitet wie bisher“, und dann bleibt jede Rechnung
-- Zeichen für Zeichen, wie sie war. Gelesen wird die Spalte vom Geländelauf (Topographie) und vom Reiter „Gebirge“.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine nullbare Spalte ohne Prüfung. Das vorige Release liest und schreibt sie nicht. Die
-- App-Rolle schreibt `terrain_control` schon (0212); die neue Spalte erbt das Recht der Tafel.

ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS saat INTEGER;

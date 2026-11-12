-- 0292: „In Landmarke umwandeln …“ (WI-0271 L8; Vali 2026-11-01 über die Editor-Orchestrierung).
--
--   `terrain_peak_bezug.rolle` lernt `umgewandelt_aus`: Die Landmarke nennt den Ort, aus dem sie entstand (der Verweis). Über ihn liest die Landmarke den Verlauf und die Bilder des stillgelegten Orts.
--
-- 🔴 Nur gelockert (AGENTS.md, „erst erweitern“): Das vorige Release schreibt das neue Wort nie; jede bestehende Zeile besteht die Regel. Keine Zeile einer Karte wird hier angefasst.

ALTER TABLE terrain_peak_bezug DROP CONSTRAINT IF EXISTS terrain_peak_bezug_rolle_known;
ALTER TABLE terrain_peak_bezug
    ADD CONSTRAINT terrain_peak_bezug_rolle_known CHECK (rolle IN ('am_fluss', 'kultstaette', 'umgewandelt_aus'));

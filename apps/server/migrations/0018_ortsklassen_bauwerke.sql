-- Die Ortsklassen-Reihenfolge korrigiert: ein Stadtviertel ist kein kleiner Ort.
--
-- 🔴 MIGRATION 0017 HAT EINE KLASSE FALSCH EINSORTIERT. Der Seed dort las
-- `... dorf(50), stadtviertel(60), gebaeude(70)` und behandelte `stadtviertel` als Ortsklasse
-- zwischen Dorf und Gebäude — also als besonders kleine Siedlung. Das ist falsch, und zwar nicht
-- um eine Position, sondern um eine Kategorie: **ein Stadtviertel liegt INNERORTS.** Es ist kein
-- kleiner Ort, sondern ein Teil eines großen.
--
-- Betreiberkorrektur vom 2026-09-21, wörtlich: „stadtviertel ist innerorts. die reihenfolge ist:
-- Metropole → Großstadt → Stadt → Kleinstadt → Dorf → Gebäude".
--
-- Legacy sagt dasselbe, und ich hätte es lesen können, bevor ich den Seed schrieb
-- (`api/_internal/ortsklassen.php`):
--
--     const AVESMAPS_ORTSKLASSEN = ['metropole','grossstadt','stadt','kleinstadt','dorf',
--                                   'gebaeude','stadtviertel'];   // gross -> klein
--     const AVESMAPS_BAUWERKSKLASSEN = ['gebaeude', 'stadtviertel'];
--
-- Dort steht `gebaeude` VOR `stadtviertel`, und daneben steht die eigentliche Aussage: beide
-- sind **Bauwerksklassen**, keine Siedlungen. Legacy hat sich diese Unterscheidung am 31.08.2026
-- teuer erarbeitet — vorher bedeutete `= 'gebaeude'` an sieben Stellen zweierlei zugleich
-- („diese Ortsklasse" und „ein Bauwerk, kein Behälter"), und die zweite Bauwerksklasse hätte
-- jede dieser Stellen still in die falsche Richtung gekippt.

UPDATE label_class_rank SET rank = 60 WHERE scope = 'place' AND class_key = 'gebaeude';
UPDATE label_class_rank SET rank = 70 WHERE scope = 'place' AND class_key = 'stadtviertel';

-- ⚠️ Keine Datenänderung: im Bestand steht kein einziges `stadtviertel` (3426 aktive Orte am
-- 2026-09-21, gemessen). Das hier korrigiert das Modell, bevor die ersten 22 Objekte aus dem
-- Garetien-Import kommen — nicht hinterher.

COMMENT ON TABLE label_class_rank IS
    'Globale Klassenpriorität der Kartenbeschriftung, zur Laufzeit pflegbar (WI-0007). Gilt für alle Objekte einer Klasse; pro Objekt NICHT überschreibbar - dafür ist label_priority da. Reihenfolge gross -> klein wie Legacys AVESMAPS_ORTSKLASSEN; gebaeude und stadtviertel sind BAUWERKSKLASSEN (innerorts), keine Siedlungen - siehe MCS-012.';

COMMENT ON COLUMN place.subtype IS
    'Ortsklasse. metropole..dorf sind Siedlungen; gebaeude und stadtviertel sind Bauwerksklassen (Legacy: AVESMAPS_BAUWERKSKLASSEN) - sie liegen innerorts, enthalten nichts und werden in Legacy als Raute statt als Kreis gezeichnet. Ein gebaeude kann ausserorts liegen, ein stadtviertel nie. Siehe MCS-012.';

-- 0213: Das Gebirge merkt sich den Talboden, den das Rückennetz gefunden hat (WI-0247, Bauplan „Gebirge aus gezeichneten Kämmen
-- (Rückennetz) im Produkt“ Schritt 3; Claudios Antwort `2026-10-20-gelaende-rueckennetz-rechenzeit-antwort-an-claudia.md`: „in die
-- Datenbank neben v12_fingerprint“).
--
-- Ohne eigenen Talboden sucht das Rückennetz ihn je Rechnung mit bis zu acht Proberechnungen (Grat zuerst, Hauptorchestrierung
-- 2026-10-20); am Ehernen Schwert sind das Minuten. Gespeichert wird der gefundene Wert samt dem Fingerabdruck der Form, an der er
-- gefunden wurde (Eingabe ohne Täler: Flüsse, Seen, Talbreite, Taltiefe). Stimmt der Fingerabdruck beim nächsten Lauf, entfällt die
-- Suche, auch wenn sich nur Täler geändert haben.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei nullbare Spalten. Das vorige Release liest und schreibt sie nie; `NULL` heißt „kein
-- Rückennetz“ (jedes Gebirge ohne gezeichneten Kamm) oder „noch nicht gesucht“.

ALTER TABLE terrain_raster ADD COLUMN IF NOT EXISTS rueckennetz_talboden DOUBLE PRECISION;
ALTER TABLE terrain_raster ADD COLUMN IF NOT EXISTS rueckennetz_talboden_fingerprint TEXT;

COMMENT ON COLUMN terrain_raster.rueckennetz_talboden IS
    'Talboden (Anteil der Kammhöhe), den das Rückennetz für dieses Gebirge abgeleitet hat (WI-0247); NULL ohne Rückennetz.';
COMMENT ON COLUMN terrain_raster.rueckennetz_talboden_fingerprint IS
    'Fingerabdruck der Form, an der rueckennetz_talboden gefunden wurde (Eingabe ohne Täler, WI-0247).';

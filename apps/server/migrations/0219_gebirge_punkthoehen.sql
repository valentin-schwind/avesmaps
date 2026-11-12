-- 0219: Höhe je Stützpunkt gezeichneter Kamm- und Tallinien (WI-0249 P9; Betreiber 2026-10-24: „ich will, dass kämme, nebengipfel,
-- täler und mulden definierte höhen haben. über diese eingabe sollen höhen der punkte im kammeditor einstellbar sein“).
--
--   `heights_schritt`: je Stützpunkt der Linie eine Höhe in Schritt, in der Folge der Punkte von `geom`; ein NULL-Element ist die Vorgabe
--   des Modells an dieser Stelle, die ganze Spalte NULL heißt „überall Vorgabe“. Grenzen wie `terrain_peak.height_schritt`, die Länge
--   muss die Zahl der Punkte sein.
--
-- Löst `height_schritt` (eine Höhe je Linie, 0216) ab, in zwei Releases (`AGENTS.md`, „Migrationen: erst erweitern, dann umstellen, dann
-- entfernen“): Dieses Release schreibt die alte Spalte nicht mehr (immer NULL) und liest sie nur noch, wo die neue fehlt, als dieselbe Höhe
-- an allen Stützpunkten (`terrain/gebirge-zusatz.ts`). Kein Umschreiben der Bestände hier: Eine Linie mit Höhe je Linie bekommt ihre
-- Punkthöhen, sobald der Editor ihr Netz das nächste Mal schreibt. Das Entfernen von `height_schritt` folgt frühestens nach dem Stage-Release
-- dieses Schritts.
--
-- 🔴 ADDITIV: zwei nullbare Spalten mit eigener Prüfung. Das vorige Release liest und schreibt sie nicht; schreibt es ein Netz, bleibt die
-- neue Spalte NULL, und es gilt wieder seine Höhe je Linie. Die App-Rolle schreibt beide Tafeln schon vollständig (0212, 0215).

ALTER TABLE terrain_ridge_edge ADD COLUMN IF NOT EXISTS heights_schritt INTEGER[]
    CHECK (
        heights_schritt IS NULL
        OR (cardinality(heights_schritt) = ST_NPoints(geom) AND 0 <= ALL (heights_schritt) AND 65535 >= ALL (heights_schritt))
    );
ALTER TABLE terrain_valley_edge ADD COLUMN IF NOT EXISTS heights_schritt INTEGER[]
    CHECK (
        heights_schritt IS NULL
        OR (cardinality(heights_schritt) = ST_NPoints(geom) AND 0 <= ALL (heights_schritt) AND 65535 >= ALL (heights_schritt))
    );

COMMENT ON COLUMN terrain_ridge_edge.heights_schritt IS
    'Hoehe je Stuetzpunkt in Schritt (WI-0249 P9), NULL-Element = Vorgabe; loest height_schritt (0216) ab, das nur noch gelesen wird.';
COMMENT ON COLUMN terrain_valley_edge.heights_schritt IS
    'Talsohle je Stuetzpunkt in Schritt (WI-0249 P9), NULL-Element = Vorgabe; loest height_schritt (0216) ab, das nur noch gelesen wird.';

-- WI-0073: Die Höhenkacheln sind verlustfreies WebP statt PNG. Eine Revision trägt ihr Format; Revisionen aus der Zeit davor
-- bleiben PNG ('png' ist der Standard, so schreibt auch der Code vor WI-0073). Rein additiv: das vorige Release liest und
-- schreibt weiter, ohne die Spalte zu kennen.
ALTER TABLE terrain_dem ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'png';
ALTER TABLE terrain_dem DROP CONSTRAINT IF EXISTS terrain_dem_format_check;
ALTER TABLE terrain_dem ADD CONSTRAINT terrain_dem_format_check CHECK (format IN ('png', 'webp'));

COMMENT ON COLUMN terrain_dem.format IS
    'Dateiformat der Kacheln dieser Revision: png (vor WI-0073) oder webp (verlustfrei). Bestimmt Endung und Content-Type der Auslieferung.';
-- Der Spaltenname png bleibt vorerst: Das vorige Release liest ihn beim Zurückrollen. Umbenennen frühestens ein Release später.
COMMENT ON COLUMN terrain_dem_tile.png IS
    'Bytes der Kachel (Spaltenname historisch): Format laut terrain_dem.format, seit WI-0073 verlustfreies WebP.';

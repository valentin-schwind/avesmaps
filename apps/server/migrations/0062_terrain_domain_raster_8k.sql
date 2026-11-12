-- WI-0070: Domain-Master auch in 8192² (8 × 8 Kacheln zu je 1024²); 4096² bleibt gültig (Rückweg).
ALTER TABLE terrain_domain_raster DROP CONSTRAINT terrain_domain_raster_size_check;
ALTER TABLE terrain_domain_raster ADD CONSTRAINT terrain_domain_raster_size_check CHECK (size IN (4096, 8192));
-- 128 MiB je Master: Scheibenweises Lesen (WI-0071) soll nicht für jede Scheibe den ganzen Wert entpacken.
ALTER TABLE terrain_domain_raster ALTER COLUMN samples SET STORAGE EXTERNAL;

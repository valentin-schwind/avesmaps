-- Eigene Zielhoehe gezeichneter Kamm- und Tallinien; additive Erweiterung, alte Releases bleiben lauffaehig.
ALTER TABLE terrain_ridge_edge ADD COLUMN height_schritt INTEGER CHECK (height_schritt BETWEEN 0 AND 65535);
ALTER TABLE terrain_valley_edge ADD COLUMN height_schritt INTEGER CHECK (height_schritt BETWEEN 0 AND 65535);

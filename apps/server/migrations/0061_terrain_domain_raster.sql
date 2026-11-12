-- WI-0067: paralleles Derived Master, keine bestehenden Produkte entfernen.
CREATE TABLE terrain_domain_raster (
    map_domain_id TEXT NOT NULL REFERENCES map_domain(id),
    fingerprint TEXT NOT NULL,
    input_fingerprint TEXT NOT NULL,
    generator_version TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size = 4096),
    samples BYTEA NOT NULL CHECK (octet_length(samples) = size * size * 2),
    report JSONB NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (map_domain_id, fingerprint)
);
COMMENT ON COLUMN terrain_domain_raster.samples IS 'uint16 Schritt, little-endian, Zeile 0 im Sueden, Zellmitten ab 0.125 E; verlustfreies finales Domain-Master';
CREATE INDEX terrain_domain_input_idx ON terrain_domain_raster (map_domain_id, input_fingerprint);
ALTER TABLE terrain_dem ADD COLUMN domain_fingerprint TEXT;
ALTER TABLE terrain_dem ADD CONSTRAINT terrain_dem_domain_fk
    FOREIGN KEY (map_domain_id, domain_fingerprint)
    REFERENCES terrain_domain_raster(map_domain_id, fingerprint);

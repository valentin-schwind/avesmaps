-- Abgeleiteter fachlicher Landsockel (WI-0066), an die veroeffentlichte DEM gebunden.
CREATE TABLE terrain_continental_base (
    map_domain_id TEXT NOT NULL REFERENCES map_domain(id),
    fingerprint TEXT NOT NULL,
    input_fingerprint TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size = 4096),
    samples BYTEA NOT NULL CHECK (octet_length(samples) = size * size * 2),
    PRIMARY KEY (map_domain_id, fingerprint)
);
ALTER TABLE terrain_dem ADD COLUMN continental_fingerprint TEXT;
ALTER TABLE terrain_dem ADD CONSTRAINT terrain_dem_continental_fk
    FOREIGN KEY (map_domain_id, continental_fingerprint)
    REFERENCES terrain_continental_base(map_domain_id, fingerprint);

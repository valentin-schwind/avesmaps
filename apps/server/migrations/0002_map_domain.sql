-- Map domains and their coordinate spaces (chapter 4.9, 4.10).
--
-- The authoritative definition lives in config/map-domains/*.json. This table is a seeded
-- projection of it so the database can enforce bounds without a second hand-maintained copy:
-- scripts/db/seed-map-domains.ts writes it, and it fails when a row and the config disagree.
--
-- Raster resolution is deliberately absent. A pixel grid is a rendering artifact, not part of the
-- coordinate space (chapter 5.6).
CREATE TABLE IF NOT EXISTS map_domain (
    id TEXT PRIMARY KEY,
    coordinate_space_id TEXT NOT NULL,
    min_x DOUBLE PRECISION NOT NULL,
    min_y DOUBLE PRECISION NOT NULL,
    max_x DOUBLE PRECISION NOT NULL,
    max_y DOUBLE PRECISION NOT NULL,
    axis_x TEXT NOT NULL CHECK (axis_x IN ('east', 'west')),
    axis_y TEXT NOT NULL CHECK (axis_y IN ('north', 'south')),
    miles_per_unit DOUBLE PRECISION NOT NULL CHECK (miles_per_unit > 0),
    schritt_per_unit DOUBLE PRECISION NOT NULL CHECK (schritt_per_unit > 0),
    config_checksum TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT map_domain_bounds_ordered CHECK (min_x < max_x AND min_y < max_y)
);

COMMENT ON TABLE map_domain IS
    'Seeded projection of config/map-domains/*.json. The JSON file wins on any disagreement.';

-- Domain geometry must stay inside its own coordinate space. The bounds come from the row, never
-- from a literal in SQL, so there is exactly one place where 0..1024 is stated (the config file).
CREATE OR REPLACE FUNCTION map_domain_contains(domain_id TEXT, geom geometry)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT ST_Within(
        geom,
        ST_MakeEnvelope(d.min_x, d.min_y, d.max_x, d.max_y, 0)
    )
    FROM map_domain d
    WHERE d.id = domain_id;
$$;

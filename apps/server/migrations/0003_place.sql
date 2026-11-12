-- Migration runs, so every imported row can name the run that produced it (chapter 9.23, 9.64).
CREATE TABLE IF NOT EXISTS migration_run (
    id UUID PRIMARY KEY,
    data_domain TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    journal JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Places (Orte), the first authoritative data domain (chapter 9.17).
--
-- Geometry lives in the map coordinate space with SRID 0: no registered Earth CRS (chapter 4.13).
-- SRID 0 alone does not identify a domain, so map_domain_id is explicit (chapter 4.11). A derived
-- render projection is never stored here; it is produced on the way out (chapter 4.17.4).
CREATE TABLE IF NOT EXISTS place (
    id BIGSERIAL PRIMARY KEY,
    -- Stable public identity, preserved from legacy so deep links keep working (chapter 9.16).
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    name TEXT NOT NULL,
    -- The seven legacy location classes (finding MCS-004). A new class is a product decision.
    subtype TEXT NOT NULL CHECK (
        subtype IN ('metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude', 'stadtviertel')
    ),
    geom geometry(Point, 0) NOT NULL,
    -- Zoom band overrides. NULL means: the class band from the zoom band model applies
    -- (finding MCS-004). 0..8 are the logical Avesmaps bands, never MapLibre zoom values.
    label_min_zoom SMALLINT CHECK (label_min_zoom BETWEEN 0 AND 8),
    label_max_zoom SMALLINT CHECK (label_max_zoom BETWEEN 0 AND 8),
    show_name BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Provenance (chapter 9.38): where the row came from and which run wrote it.
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_public_id_unique UNIQUE (public_id),
    CONSTRAINT place_label_zoom_ordered CHECK (
        label_min_zoom IS NULL OR label_max_zoom IS NULL OR label_min_zoom <= label_max_zoom
    ),
    CONSTRAINT place_inside_domain CHECK (map_domain_contains(map_domain_id, geom))
);

CREATE UNIQUE INDEX IF NOT EXISTS place_legacy_public_id_unique
    ON place (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS place_geom_gist ON place USING GIST (geom);
CREATE INDEX IF NOT EXISTS place_domain_subtype ON place (map_domain_id, subtype) WHERE is_active;

COMMENT ON COLUMN place.geom IS 'Authoritative MCS geometry, SRID 0. Never a render projection.';
COMMENT ON COLUMN place.label_min_zoom IS 'Override of the class zoom band, logical band 0..8, NULL = use the band.';

-- WI-0245: Additive Senkentafeln. Alte Releases sehen und schreiben ausschließlich die bisherigen Rückentafeln.
CREATE TABLE IF NOT EXISTS terrain_valley_edge (
    id BIGSERIAL PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES region_area (id) ON DELETE CASCADE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    geom geometry(LineString, 0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_valley_edge_ordinal_unique UNIQUE (area_id, ordinal),
    CONSTRAINT terrain_valley_edge_inside CHECK (map_domain_contains(map_domain_id, geom)),
    CONSTRAINT terrain_valley_edge_laenge CHECK (ST_NPoints(geom) >= 2 AND ST_Length(geom) > 0)
);

COMMENT ON TABLE terrain_valley_edge IS
    'Gezeichnete Taeler je Gebirgsflaeche (WI-0245): Linienzug; geschrieben als ganzes Netz in area.gebirge.';

CREATE TABLE IF NOT EXISTS terrain_hollow_point (
    id BIGSERIAL PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES region_area (id) ON DELETE CASCADE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Die Folge, in der sie gezeichnet wurden; das Modell braucht keine, Lesen und Protokoll bleiben damit stabil.
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    geom geometry(Point, 0) NOT NULL,
    -- NULL: abgeleiteter Talboden des Modells (`gebirge/rueckennetz/senken.ts`). Grenzen wie `terrain_peak.height_schritt`.
    height_schritt INTEGER CHECK (height_schritt BETWEEN 0 AND 65535),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_hollow_point_ordinal_unique UNIQUE (area_id, ordinal),
    CONSTRAINT terrain_hollow_point_inside CHECK (map_domain_contains(map_domain_id, geom))
);

COMMENT ON TABLE terrain_hollow_point IS
    'Mulden je Gebirgsflaeche (WI-0245, N1): Formpunkte ohne Name und Wiki; geschrieben mit dem Netz in area.gebirge.';

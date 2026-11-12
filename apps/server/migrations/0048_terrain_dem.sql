-- Das abgeleitete Hoehenmodell (WI-0049 S3). Alles hier ist Derived Data aus terrain_control und
-- terrain_peak (Migration 0047): ein Verlust kostet einen Lauf von `derive:terrain`, keinen Import.
--
-- 🔴 Zwei Ebenen, getrennt wie in Kap. 4.22 und 5.32:
--   terrain_raster    das Hoehenfeld je Gebirge in SCHRITT, im Kartenraum; daraus lesen Routing und Flug.
--   terrain_dem_tile  die Kacheln fuer MapLibre, ein Renderartefakt mit Ausgleich der Ueberhoehung;
--                     nie Grundlage einer Rechnung.

CREATE TABLE IF NOT EXISTS terrain_raster (
    area_id BIGINT PRIMARY KEY REFERENCES region_area (id),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Ueber alle Eingaben, die Regeln und den Generator. Gleich = nicht neu rechnen.
    fingerprint TEXT NOT NULL,
    -- Das Gitter wie in Legacy (MCS-025): Zelle in Karteneinheiten, Ursprung an der rohen
    -- bbox-Ecke, Zeile 0 im Sueden, zeilenweise uint16 little-endian, ausserhalb der Flaeche 0.
    cell DOUBLE PRECISION NOT NULL CHECK (cell > 0),
    origin_x DOUBLE PRECISION NOT NULL,
    origin_y DOUBLE PRECISION NOT NULL,
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    samples BYTEA NOT NULL,
    max_schritt INTEGER NOT NULL,
    mean_schritt DOUBLE PRECISION NOT NULL,
    -- Woher der Kamm kam: kammlinie | beschriftungskurve | erzeugt | gipfel | keiner.
    kamm_quelle TEXT NOT NULL,
    -- Die erzeugte Kammlinie, wenn keine vorlag und es sie brauchte (Betreiber 2026-09-27).
    kammlinie_erzeugt geometry(LineString, 0),
    -- Die angewandte Grundhoehe, wenn Legacy keine Maximalhoehe fuehrt (1000 oder 1500 Schritt).
    grundhoehe DOUBLE PRECISION,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_raster_samples_size CHECK (octet_length(samples) = width * height * 2)
);

-- Eine Revision der Kachelpyramide. Unter einer Revision aendert sich nie ein Byte (ADR-0008).
CREATE TABLE IF NOT EXISTS terrain_dem (
    revision TEXT PRIMARY KEY CHECK (revision ~ '^[0-9a-f]{12}$'),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    fingerprint TEXT NOT NULL,
    tile_size INTEGER NOT NULL,
    max_zoom SMALLINT NOT NULL,
    encoding TEXT NOT NULL,
    tiles INTEGER NOT NULL,
    bytes BIGINT NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS terrain_dem_one_current
    ON terrain_dem (map_domain_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS terrain_dem_tile (
    revision TEXT NOT NULL REFERENCES terrain_dem (revision) ON DELETE CASCADE,
    z SMALLINT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    png BYTEA NOT NULL,
    PRIMARY KEY (revision, z, x, y)
);

COMMENT ON TABLE terrain_raster IS
    'Hoehenfeld je Gebirgsflaeche in Schritt (WI-0049), abgeleitet mit Legacys Rechnung V12. Grundlage fuer Routing und Flug.';
COMMENT ON TABLE terrain_dem_tile IS
    'raster-dem-Kacheln fuer MapLibre (WI-0049): Renderartefakt mit Ausgleich der Ueberhoehung, nie Rechengrundlage.';

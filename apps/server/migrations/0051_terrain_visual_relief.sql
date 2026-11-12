-- Das visuelle Relief der ganzen Landflaeche (WI-0054). Alles hier ist Derived Data aus der
-- veroeffentlichten Gelaenderevision, den Wasserflaechen und den Fluessen: ein Verlust kostet einen
-- Lauf von `derive:visual-relief`, keinen Import.
--
-- 🔴 Das Relief ist KEINE Hoehe. Es ist eine Darstellungsgroesse fuer die Schattierung in der
-- Landschaftsansicht (3D). Routing, Steigung, Flug und das Gelaende (`setTerrain`) lesen es nie;
-- die einzige Hoehe bleibt terrain_raster bzw. terrain_dem (Migration 0048).

-- Eine Revision der Kachelpyramide. Unter einer Revision aendert sich nie ein Byte (ADR-0008).
CREATE TABLE IF NOT EXISTS terrain_visual_relief (
    revision TEXT PRIMARY KEY CHECK (revision ~ '^[0-9a-f]{12}$'),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Ueber Gelaenderevision, Wasser, Fluesse, Generator, Saat und Parameter. Gleich = nicht neu rechnen.
    fingerprint TEXT NOT NULL,
    -- Die Gelaenderevision, an die das Relief gebunden ist. Ohne Fremdschluessel: alte DEM-Revisionen
    -- werden aufgeraeumt, die Angabe bleibt als Herkunft.
    dem_revision TEXT NOT NULL CHECK (dem_revision ~ '^[0-9a-f]{12}$'),
    generator_version TEXT NOT NULL,
    seed INTEGER NOT NULL,
    params JSONB NOT NULL,
    tile_size INTEGER NOT NULL,
    max_zoom SMALLINT NOT NULL,
    encoding TEXT NOT NULL,
    tiles INTEGER NOT NULL,
    bytes BIGINT NOT NULL,
    -- SHA-256 ueber alle Kacheln; die Revision sind seine ersten zwoelf Zeichen.
    output_checksum TEXT NOT NULL,
    -- Gegen die vorige aktuelle Revision: wie viele Kacheln und welcher Kartenbereich sich aenderten
    -- (Kap. 5.33). NULL bei der ersten Revision.
    changed_tiles INTEGER,
    changed_min_x DOUBLE PRECISION,
    changed_min_y DOUBLE PRECISION,
    changed_max_x DOUBLE PRECISION,
    changed_max_y DOUBLE PRECISION,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS terrain_visual_relief_one_current
    ON terrain_visual_relief (map_domain_id) WHERE is_current;

-- Eigene Tabelle fuer die Kacheln, damit ein Backup sie auslassen kann wie terrain_dem_tile
-- (Claudio 2026-09-28): sie lassen sich jederzeit neu rechnen.
CREATE TABLE IF NOT EXISTS terrain_visual_relief_tile (
    revision TEXT NOT NULL REFERENCES terrain_visual_relief (revision) ON DELETE CASCADE,
    z SMALLINT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    png BYTEA NOT NULL,
    PRIMARY KEY (revision, z, x, y)
);

COMMENT ON TABLE terrain_visual_relief IS
    'Visuelles Relief der Landflaeche (WI-0054): nur Schattierung in Landschaften/3D, KEINE Hoehe. Nie Rechengrundlage.';
COMMENT ON TABLE terrain_visual_relief_tile IS
    'raster-dem-Kacheln des visuellen Reliefs (WI-0054), nur fuer die Hillshade-Ebene, nie fuer setTerrain.';

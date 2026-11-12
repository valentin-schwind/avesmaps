-- Gelaende-Eingaben aus Legacy (WI-0049 S2): die Regler der Gebirgsflaechen und die Gipfel.
--
-- Das ist die autoritative Terrain Definition aus Kap. 5.20, nicht das Hoehenmodell: das DEM wird
-- daraus in S3 abgeleitet (Legacys Rechnung V12, MCS-025). Legacy speichert seine fertigen Raster
-- nur im Datenbank-Backup; uebernommen werden deshalb die Eingaben, die jeder Satz ohnehin traegt
-- (Betreiber 2026-09-27, T1 = B: "du uebernimmst die rechnung und hoeheneinstellungen von legacy").
--
-- 🔴 Die Werte kommen unveraendert aus Legacy (Cutoff-Regel, AGENTS.md). Leer heisst "ableiten",
-- genau wie in Legacy: eine Flaeche, die nie angefasst wurde, rechnet mit den Vorgaben.

CREATE TABLE IF NOT EXISTS terrain_control (
    id BIGSERIAL PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES region_area (id),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Die zwoelf Regler von V12 (Legacy `ecosystem_area.terrain_*`), unter ehrlichen Namen.
    koernung DOUBLE PRECISION,
    stufen SMALLINT CHECK (stufen BETWEEN 0 AND 16),
    erosion SMALLINT CHECK (erosion BETWEEN 0 AND 5),
    plateau DOUBLE PRECISION CHECK (plateau BETWEEN 0 AND 1),
    hypsometrie DOUBLE PRECISION CHECK (hypsometrie BETWEEN 0 AND 1),
    -- 🪤 In Legacy heisst die Spalte `terrain_avg_height`, gemeint ist aber die MAXIMALHOEHE: der
    -- Sockel des Kamms, unter den er zwischen zwei Gipfeln nicht faellt (MCS-025).
    maximalhoehe DOUBLE PRECISION CHECK (maximalhoehe BETWEEN 0 AND 20000),
    bergform DOUBLE PRECISION CHECK (bergform >= 0),
    rauschen DOUBLE PRECISION CHECK (rauschen BETWEEN 0 AND 1),
    sattel DOUBLE PRECISION CHECK (sattel BETWEEN 0 AND 1),
    talbreite DOUBLE PRECISION CHECK (talbreite >= 0),
    einschnitt DOUBLE PRECISION CHECK (einschnitt >= 0),
    -- Die Kammlinie der Flaeche (Legacy `terrain_ridge_line`) und Legacys Rueckfall dafuer, die
    -- Beschriftungskurve ihres Labels (`curve_label_line`). V12 liest die erste, sonst die zweite.
    kammlinie geometry(LineString, 0),
    beschriftungskurve geometry(LineString, 0),
    -- Herkunft der zuletzt angewandten Vorlagen; eine Angabe, keine Bindung (Legacy, Owner 04.09.2026).
    vorlage_morph TEXT,
    vorlage_hoehe TEXT,
    -- 🔴 NEU in Avesmaps3D (Betreiber 2026-09-27): die Durchschnittshoehe der Flaeche in Schritt.
    -- Leer rechnet das Gebirge wie Legacy; gesetzt hebt sie die Masse um die festen Gipfel (C3).
    -- Kein Legacy-Wert: der Import schreibt sie nie.
    durchschnittshoehe DOUBLE PRECISION CHECK (durchschnittshoehe BETWEEN 0 AND 20000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_control_area_unique UNIQUE (area_id),
    CONSTRAINT terrain_control_kammlinie_inside CHECK (kammlinie IS NULL OR map_domain_contains(map_domain_id, kammlinie)),
    CONSTRAINT terrain_control_kurve_inside CHECK (
        beschriftungskurve IS NULL OR map_domain_contains(map_domain_id, beschriftungskurve)
    )
);

COMMENT ON TABLE terrain_control IS
    'Gelaende-Regler je Gebirgsflaeche (WI-0049). Autoritative Eingabe; das Hoehenmodell wird daraus abgeleitet.';

-- Gipfel und Vulkane. In Legacy freie Labels (`berggipfel`, `vulkan`) mit `height_schritt`; hier
-- nur als Gelaende-Eingabe. Ob sie auch als Namen auf die Karte kommen, ist eine eigene Frage.
-- 🔴 Betreiber 2026-09-27: Jeder Gipfel und Vulkan macht einen Berg mit Steigung, auch ausserhalb
-- eines Gebirges (Regel der Ableitung in S3, nicht dieser Tabelle).
CREATE TABLE IF NOT EXISTS terrain_peak (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    name TEXT NOT NULL,
    subtype TEXT NOT NULL CHECK (subtype IN ('berggipfel', 'vulkan')),
    geom geometry(Point, 0) NOT NULL,
    -- NULL: Legacy kennt keine Hoehe; die Ableitung nimmt dann Legacys Vorgabe (5.000 Schritt).
    height_schritt INTEGER CHECK (height_schritt BETWEEN 0 AND 65535),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    legacy_revision BIGINT,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_peak_public_id_unique UNIQUE (public_id),
    CONSTRAINT terrain_peak_inside_domain CHECK (map_domain_contains(map_domain_id, geom))
);

CREATE INDEX IF NOT EXISTS terrain_peak_geom_gist ON terrain_peak USING GIST (geom) WHERE is_active;

COMMENT ON TABLE terrain_peak IS
    'Gipfel und Vulkane als Gelaende-Eingabe (WI-0049). Die Hoehe ist ein fester Punkt des Hoehenmodells.';

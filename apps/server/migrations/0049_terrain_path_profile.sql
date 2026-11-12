-- Hoehenprofile der Landwege (WI-0049 S5a): Derived Data aus terrain_raster und terrain_peak, gerechnet
-- von `derive:terrain`. Ein Verlust kostet einen Lauf, keinen Import.
--
-- 🔴 Ohne Zeile rechnet der Router wie vor S5a (Koordination 2026-09-27): Die Steigung wirkt erst, wenn
-- das Profil eines Weges zu seiner heutigen Geometrie passt (geometry_md5).
--
-- Je Stuetzpunktpaar des Weges, in gespeicherter Punktreihenfolge, sieben float32 (little-endian):
--   Anstieg, Abstieg, steiler Anstieg, steiler Abstieg (Schritt; steil = ueber der Schwelle je Abtastschritt),
--   hoechster Punkt (Schritt, -1 ohne Hoehe), steilste Steigung, steilstes Gefaelle (Verhaeltnis, 0 ohne Hoehe).
-- Ein Paar ganz ausserhalb jeder Hoehe traegt -1 als hoechsten Punkt und sonst Nullen.

CREATE TABLE IF NOT EXISTS terrain_path_profile (
    path_id BIGINT PRIMARY KEY REFERENCES path (id) ON DELETE CASCADE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Ueber Raster, freie Gipfel, Kegelregel und Profilregeln. Gleich = nicht neu rechnen.
    height_fingerprint TEXT NOT NULL,
    -- md5 ueber ST_AsBinary(path.geom) beim Rechnen. Weicht es ab, ist das Profil veraltet und zaehlt nicht.
    geometry_md5 TEXT NOT NULL CHECK (geometry_md5 ~ '^[0-9a-f]{32}$'),
    pair_count INTEGER NOT NULL CHECK (pair_count >= 1),
    pairs BYTEA NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_path_profile_pairs_size CHECK (octet_length(pairs) = pair_count * 28)
);

CREATE INDEX IF NOT EXISTS terrain_path_profile_domain ON terrain_path_profile (map_domain_id);

-- 0230: Eigene Höhen an Flüssen und Seen je Gebirgsfläche (WI-0249; Vali 2026-10-25: „die höhe von seen und flüssen, welche das gebirge
-- durchqueren, sollen ebenfalls in ihrer höhe verändert werden können“; Vali wählte A, 2026-10-26).
--
--   `terrain_water_height`: je Zeile eine Höhe in Schritt an einer Lage, `art` 'fluss' (ein Stützpunkt eines Flusses) oder 'see' (der Platz
--   eines Sees, `seePlatz` in `packages/shared/src/gebirge/rueckennetz/wasser.ts`). Flüsse und Seen selbst kommen aus der Karte; gespeichert
--   wird nur die Höhe nach Lage. Ändert sich ein Fluss, gilt eine Höhe, deren Lage keinen Stützpunkt mehr trifft, nicht mehr (sie bleibt
--   stehen, bis der Editor das Netz das nächste Mal schreibt). Wirksam nur im Gelände der Fassung 19 (Lader `terrain/inputs.ts`).
--
-- Geschrieben mit dem Netz in `area.gebirge` (`terrain/gebirge-editor.ts`, ganz ersetzt). Die Tafel hängt an der Teilfläche (`region_area`),
-- wie Kämme, Nebengipfel, Täler und Mulden (0212, 0215).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Tafel. Das vorige Release liest und schreibt sie nicht; schreibt es ein Netz, bleiben
-- die Höhen stehen (es nennt sie nicht). Die App-Rolle bekommt die Tafel über das Default-Privileg der Migrationsrolle
-- (`ops/runtime/runtime-foundation.sh`), wie 0212.

CREATE TABLE IF NOT EXISTS terrain_water_height (
    id BIGSERIAL PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES region_area (id) ON DELETE CASCADE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    art TEXT NOT NULL CHECK (art IN ('fluss', 'see')),
    -- Die Folge je Art, in der sie geschrieben wurden; Lesen und Protokoll bleiben damit stabil.
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    geom geometry(Point, 0) NOT NULL,
    -- Grenzen wie `terrain_peak.height_schritt`.
    height_schritt INTEGER NOT NULL CHECK (height_schritt BETWEEN 0 AND 65535),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_water_height_ordinal_unique UNIQUE (area_id, art, ordinal),
    CONSTRAINT terrain_water_height_inside CHECK (map_domain_contains(map_domain_id, geom))
);

COMMENT ON TABLE terrain_water_height IS
    'Eigene Hoehen an Fluessen und Seen je Gebirgsflaeche (WI-0249): Lage und Hoehe; geschrieben mit dem Netz in area.gebirge.';

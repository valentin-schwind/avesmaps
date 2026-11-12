-- JOBS-0001 Etappe 2, Variante B (WI-0125, Betreiber 2026-10-09 zu D6: „ja, beide starten“): Gelände lokal neu rechnen und
-- Kachel für Kachel veröffentlichen. Ein gesammelter voller Lauf bleibt die Wahrheit.
--
-- 🔴 REIN ADDITIV (AGENTS.md „erst erweitern, dann umstellen, dann entfernen“, Kap. 8.1 von JOBS-0001): neue Spalten nullable oder
-- mit DEFAULT, ein Trigger, ein Index. Der alte Code liest die Pyramidenrevision weiter: Jede Revision trägt wie bisher ALLE ihre
-- Kacheln in `terrain_dem_tile` (die unveränderten werden beim lokalen Veröffentlichen kopiert). Das Entfernen der Kopie ist ein
-- späterer Schritt, frühestens nach dem Stage-Release dieses Standes.

-- 1. Die Revision je Kachel: der Inhalts-Hash ihrer Bytes (die ersten 16 Hexzeichen des SHA-256). Unter ihr ist eine Kachel
--    unveränderlich adressierbar (`/tiles/terrain/dem/k/<revision>/<z>/<x>/<y>.webp`); eine Kachel, deren Bytes gleich bleiben,
--    behält ihre Adresse über jede neue Pyramidenrevision hinweg. Der Trigger rechnet sie aus den Bytes, für jeden Schreiber, auch
--    für den alten Code im Wechsel zweier Server: Sie kann nie von den Bytes abweichen. `dem-tiles.ts` (`tileRevision`) rechnet
--    dieselbe Zahl, ein Test hält beide zusammen.
ALTER TABLE terrain_dem_tile ADD COLUMN IF NOT EXISTS tile_revision TEXT;

CREATE OR REPLACE FUNCTION terrain_dem_tile_set_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.tile_revision := left(encode(sha256(NEW.png), 'hex'), 16);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS terrain_dem_tile_revision ON terrain_dem_tile;
CREATE TRIGGER terrain_dem_tile_revision
    BEFORE INSERT OR UPDATE ON terrain_dem_tile
    FOR EACH ROW EXECUTE FUNCTION terrain_dem_tile_set_revision();

-- Die vorhandenen Zeilen (der Trigger rechnet bei jedem UPDATE dasselbe noch einmal).
UPDATE terrain_dem_tile SET tile_revision = left(encode(sha256(png), 'hex'), 16) WHERE tile_revision IS NULL;

CREATE INDEX IF NOT EXISTS terrain_dem_tile_by_tile_revision ON terrain_dem_tile (tile_revision, z, x, y);

COMMENT ON COLUMN terrain_dem_tile.tile_revision IS
    'Revision der Kachel (JOBS-0001 V2, WI-0125): die ersten 16 Hexzeichen des SHA-256 ihrer Bytes, vom Trigger gesetzt. Das Manifest einer Pyramidenrevision sind ihre Zeilen (z, x, y, tile_revision).';

-- 2. Der vorläufige Master einer lokalen Veröffentlichung (`dem_publish`): der vorige Master, in den die Rechenkacheln des
--    Fußabdrucks eingesetzt sind. Er gehört zu keinem vollen Lauf; `derive:terrain` erkennt ihn nie als „schon gerechnet“
--    (seine `input_fingerprint` beginnt mit `lokal:`), und der nächste volle Lauf löst ihn ab.
ALTER TABLE terrain_domain_raster ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE terrain_domain_raster ADD COLUMN IF NOT EXISTS base_fingerprint TEXT;
ALTER TABLE terrain_domain_raster ADD COLUMN IF NOT EXISTS local_tiles SMALLINT[];
-- 3. Was in den Master eingegangen ist, je Objekt (Fingerabdruck und Rahmen): daraus bestimmt `terrain_local` den Fußabdruck
--    einer Änderung (JOBS-0001 4.1: aus Fingerabdrücken, nicht aus dem Dirty Set des Clients). Fehlt es, braucht der lokale Job
--    einen ausdrücklichen Bereich oder einen vollen Lauf.
ALTER TABLE terrain_domain_raster ADD COLUMN IF NOT EXISTS input_index JSONB;

COMMENT ON COLUMN terrain_domain_raster.provisional IS
    'Vorläufig (JOBS-0001 D6 = B): ein lokal veröffentlichter Master, Rechenkacheln des Fußabdrucks in base_fingerprint eingesetzt. Der volle Lauf bleibt die Wahrheit.';
COMMENT ON COLUMN terrain_domain_raster.base_fingerprint IS 'Nur vorläufig: der Master, in den eingesetzt wurde.';
COMMENT ON COLUMN terrain_domain_raster.local_tiles IS
    'Nur vorläufig: die ersetzten Rechenkacheln (Index ty * 8 + tx, 1024² je Kachel, Zeile 0 im Norden).';
COMMENT ON COLUMN terrain_domain_raster.input_index IS
    'Je Eingabeobjekt Fingerabdruck und Rahmen (domain/input-index.ts): Grundlage des Fußabdrucks einer lokalen Änderung.';

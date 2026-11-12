-- Merkmale am Ort (WI-0128; EDIT-0001 D21, E21; WI-0126 §11i; Betreiber 2026-10-10 und 2026-10-11).
--
-- 1. Zwei neue Merkmale, nicht aus Legacy (Betreiber 2026-10-10: „Unterirdisch (manch Ort liegt nicht auf der Oberfläche)“ und
--    „Unauffindbar/Entrückt (im Limbus und nicht auf der Route)“): `is_underground` und `is_withdrawn`. Eigene Daten von Avesmaps3D,
--    Vorgabe aus; kein Import schreibt sie (sie stehen in keiner Spaltenliste eines Imports), das Zurücksetzen der Testwelt setzt sie zurück.
-- 2. Der Ort ohne Lage (0105) trägt dieselben Merkmale wie ein Ort: dazu `is_seaport` (Betreiber 2026-10-11: Seehafen ist ein Merkmal,
--    das der Editor setzt; Seewege entscheiden es nicht, „seewege werden verschwinden und sind auf avesmaps3d tot“).
-- 3. Die Revision zählt auch bei den neuen Spalten (Trigger wie 0091 und 0105, um die Spalten erweitert).
--
-- Additiv: `ADD COLUMN … NOT NULL DEFAULT FALSE` erträgt das vorige Release, das die Spalten nicht kennt.

ALTER TABLE place ADD COLUMN IF NOT EXISTS is_underground BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place ADD COLUMN IF NOT EXISTS is_withdrawn BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE place_unplaced ADD COLUMN IF NOT EXISTS is_seaport BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place_unplaced ADD COLUMN IF NOT EXISTS is_underground BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place_unplaced ADD COLUMN IF NOT EXISTS is_withdrawn BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE TRIGGER place_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, geom, is_active, is_hidden, is_ruined, is_nodix, is_seaport, place_kind,
                     source_system, legacy_public_id, is_underground, is_withdrawn, revision
    ON place
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER place_unplaced_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, place_kind, is_hidden, is_ruined, is_nodix, is_seaport, is_underground,
                     is_withdrawn, description, einwohner, lage, oberhaupt, is_active, revision
    ON place_unplaced
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN place.is_underground IS
    'Unterirdisch (WI-0128, Betreiber 2026-10-10): Der Ort liegt nicht auf der Oberfläche; einzige Wirkung, das Infopanel nennt es hinter dem Ortstyp. Eigene Daten von Avesmaps3D.';
COMMENT ON COLUMN place.is_withdrawn IS
    'Unauffindbar/Entrückt (WI-0128, Betreiber 2026-10-10): Die Wegfindung nennt den Ort nicht, auch wenn die Route durch ihn führt; auf der Karte bleibt er sichtbar. Eigene Daten von Avesmaps3D.';

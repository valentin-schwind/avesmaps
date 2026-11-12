-- 0263: Merkmal „ungefähre Lage“ am Ort (WI-0267). Kanal OPS-000067, Thomas 2026-10-26: „Unter Merkmale eine neues Merkmal für Orte mit nicht
-- genauer Ortsangabe - "ungefähre Lage" oder "ungenaue Ortsangabe"“; Vali 2026-10-31 „A und B“: Haken im Ortseditor, Zusatz im Kopf der Infobox
-- und ein Zeichen auf der Karte.
--
-- Wie `is_underground` (0108): eigene Daten von Avesmaps3D, Vorgabe aus; kein Import schreibt sie (sie steht in keiner Spaltenliste eines
-- Imports), das Zurücksetzen der Testwelt setzt sie zurück. Der Ort ohne Lage (0105) trägt dieselben Merkmale wie ein Ort. Die Revision zählt auch
-- bei der neuen Spalte (Trigger wie 0115, um die Spalte erweitert).
--
-- Additiv: `ADD COLUMN … NOT NULL DEFAULT FALSE` erträgt das vorige Release, das die Spalte nicht kennt.

ALTER TABLE place ADD COLUMN IF NOT EXISTS is_approximate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place_unplaced ADD COLUMN IF NOT EXISTS is_approximate BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE TRIGGER place_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, geom, is_active, is_hidden, is_ruined, is_nodix, is_seaport, place_kind,
                     source_system, legacy_public_id, is_underground, is_withdrawn, is_approximate, revision
    ON place
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

CREATE OR REPLACE TRIGGER place_unplaced_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, place_kind, is_hidden, is_ruined, is_nodix, is_seaport, is_underground,
                     is_withdrawn, is_approximate, description, einwohner, lage, oberhaupt, is_active, revision
    ON place_unplaced
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

COMMENT ON COLUMN place.is_approximate IS
    'Ungefähre Lage (WI-0267, Kanal OPS-000067): Die genaue Lage des Orts ist nicht bekannt; das Infopanel nennt es hinter dem Ortstyp, die Karte zeigt ein Zeichen. Eigene Daten von Avesmaps3D.';
COMMENT ON COLUMN place_unplaced.is_approximate IS
    'Ungefähre Lage (WI-0267), wie place.is_approximate; ein Ort ohne Lage trägt dieselben Merkmale.';

-- 0310: „Auf der Karte anzeigen“ meint an der Landmarke nur noch den Text (WI-0271 §18; Vali 2026-11-04: Die Beschriftung darf das Symbol nicht mit verbergen, nur der Text
--   verschwindet; eine verborgene Landmarke zeigt Zeichen und, wenn gewollt, Namen ab Zoom 8).
--
--   1. `terrain_peak_render` liefert auch Landmarken ohne Beschriftung und hängt `show_name` an: Die Karte lässt dann nur den Text weg. Martin liest die neue Spalte erst nach
--      einem Neustart (auto-stage und Release); solange steht auf der Karte, was auch vorher dort stand, weil das Feld fehlt und der Client dann den Namen zeigt.
--   2. Das Merkmal `nur_gelaende` (Katalog `LANDMARKEN_MERKMALE`, nur an Berggipfel und Vulkan): Der Punkt formt das Gelände und steht weder auf der Karte noch in einer Suche.
--      So bleiben die Hilfspunkte des Geländes aus Legacy weg, die bisher nur `show_name = false` trugen (`1300er Felsnadel Grimmfrostöde`, `Gipfel Finsterkamm Nord` …).
--   3. `terrain_peak_gelaende` hängt `merkmale` an: Das Gebirgsfenster zeigt seine Gipfel über diese Sicht und markiert die für Besucher verborgenen.
--
-- 🔴 Kartenänderung (Map Mutation Guard): Der Datenschritt setzt das Merkmal an genau den aktiven Berggipfeln und Vulkanen ohne Beschriftung. Vali hat das am 2026-11-04 für
-- diesen Umfang gewählt (Antwort „Merkmal Nur Gelände“ auf die Frage nach den Hilfspunkten; in Production erst mit seinem Release-Test). Eine Operation mit einem Eintrag je
-- Zeile; der Schritt ist auf die Zeilen begrenzt, die das Merkmal noch nicht tragen. `show_name` bleibt, wie es ist. Die Umgebung nimmt er von der letzten Operation dieser
-- Datenbank, die Migration kennt sie sonst nicht.
--
-- 🔴 Nur gelockert und angehängt (AGENTS.md, „erst erweitern“): Das vorige Release schreibt das neue Merkmal nicht, jede bestehende Zeile erfüllt die weitere Bedingung, die neuen
-- Spalten der Sichten stehen hinten. Das vorige Release zeigt Landmarken ohne Beschriftung für die Dauer der Überlappung mit Namen; den Hilfspunkten nimmt das Merkmal das schon.

ALTER TABLE terrain_peak DROP CONSTRAINT IF EXISTS terrain_peak_merkmale_known;
ALTER TABLE terrain_peak
    ADD CONSTRAINT terrain_peak_merkmale_known
        CHECK (merkmale <@ ARRAY['heilig', 'magisch', 'gefaehrlich', 'unzugaenglich', 'verborgen', 'nodix', 'unterirdisch', 'entrueckt', 'ungefaehr', 'nur_gelaende']::TEXT[]);

DO $$
DECLARE
    v_operation CONSTANT UUID := 'c0271310-0271-4310-8000-000000000001';
    v_umgebung TEXT;
    v_erste BOOLEAN := TRUE;
    v_zeile RECORD;
    v_revision terrain_peak.revision%TYPE;
BEGIN
    FOR v_zeile IN
        SELECT public_id, map_domain_id, merkmale, revision
          FROM terrain_peak
         WHERE is_active AND NOT show_name AND subtype IN ('berggipfel', 'vulkan') AND NOT 'nur_gelaende' = ANY (merkmale)
         ORDER BY public_id
           FOR UPDATE
    LOOP
        IF v_erste THEN
            SELECT environment INTO v_umgebung FROM map_operation ORDER BY seq DESC LIMIT 1;
            INSERT INTO map_operation (operation_id, map_domain_id, action, source, summary, environment, actor_kind, actor_label, approval_ref)
            VALUES (v_operation, v_zeile.map_domain_id, 'peak.update', 'import',
                    'Geländehilfspunkte ohne Beschriftung: Merkmal „nur Gelände“', COALESCE(v_umgebung, 'development'), 'agent', 'claudia',
                    'Vali 2026-11-04: Merkmal „Nur Gelände“ an den aktiven Berggipfeln und Vulkanen ohne Beschriftung, Migration 0310');
            v_erste := FALSE;
        END IF;
        UPDATE terrain_peak SET merkmale = merkmale || 'nur_gelaende'::TEXT WHERE public_id = v_zeile.public_id RETURNING revision INTO v_revision;
        INSERT INTO map_audit_event (operation_id, action, peak_public_id, revision_before, revision_after, changes)
        VALUES (v_operation, 'peak.updated', v_zeile.public_id, v_zeile.revision, v_revision,
                jsonb_build_object('merkmale', jsonb_build_object('before', to_jsonb(v_zeile.merkmale), 'after', to_jsonb(v_zeile.merkmale || 'nur_gelaende'::TEXT))));
    END LOOP;
END
$$;

COMMENT ON COLUMN terrain_peak.merkmale IS
    'Merkmale der Landmarke (WI-0271): heilig, magisch, gefaehrlich, unzugaenglich ohne Wirkung auf die Karte; verborgen, nodix, unterirdisch, entrueckt, ungefaehr wirken wie am Ort (0297); nur_gelaende (0310, nur Berggipfel und Vulkan): formt das Gelaende, steht weder auf der Karte noch in einer Suche. Ruine und Seehafen gibt es an einer Landmarke nicht.';

COMMENT ON COLUMN terrain_peak.show_name IS
    'Auf der Karte anzeigen (WI-0178, seit 0310 nur die Beschriftung): aus nimmt nur den Text von der Karte, das Zeichen bleibt.';

CREATE OR REPLACE VIEW terrain_peak_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.height_schritt AS height,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
    p.subtype IN ('berggipfel', 'vulkan') AS formt_gelaende,
    'verborgen' = ANY (p.merkmale) AS is_hidden,
    'ungefaehr' = ANY (p.merkmale) AS is_approximate,
    p.show_name
FROM terrain_peak p
WHERE p.is_active AND NOT 'nur_gelaende' = ANY (p.merkmale)
ORDER BY p.public_id;

CREATE OR REPLACE VIEW terrain_peak_gelaende AS
SELECT
    p.id,
    p.public_id,
    p.map_domain_id,
    p.name,
    p.subtype,
    p.geom,
    p.height_schritt,
    p.is_active,
    p.source_system,
    p.legacy_public_id,
    p.legacy_revision,
    p.migration_run_id,
    p.imported_at,
    p.created_at,
    p.updated_at,
    p.show_name,
    p.revision,
    p.merkmale
FROM terrain_peak p
WHERE p.subtype IN ('berggipfel', 'vulkan');

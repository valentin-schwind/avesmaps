-- 0205: Gipfel und Vulkane werden Objekte des Derographie-Editors (WI-0178 P1; EDIT-0003 T55, Betreiber 2026-10-18, wörtlich:
-- „Berggipfel und Vulkane sind "derographische" objekte und haben eine höhe. diese höhe soll sowohl durch klick auf das objekt als auch in
-- der gipfel-liste der gebirge verändert werden“; Rückmeldung von der Stage: „es gibt keine möglichkeit berge zu verschieben, weil man kann
-- nicht draufklicken :)“).
--
--   1. `terrain_peak.revision`, gezählt allein vom Trigger `public.revision_bump()` (0079; er setzt auch `updated_at`), wie an Fläche,
--      Weg und Kraftlinie (G5 „Revision je Objekt“): Jedes Speichern im Editor schreibt gegen sie, ein Konflikt ist 409.
--   2. Die gemeinsame Sperre kennt den Gipfel (`editor_lock.object_kind` = 'peak', EDIT-0003 §4): Wer ihn bearbeitet, hält ihn.
--   3. Das Fachprotokoll kennt den Gipfel als Ziel (unten).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe 1 und ein Trigger; die Bedingung der Sperre wird nur weiter. Das vorige
-- Release liest die Spalte nie und schreibt nie 'peak'. Der Landschaften-Zug (I10) schreibt Gipfel weiter wie bisher; ändert er einen,
-- zählt der Trigger die Revision mit, und ein offener Entwurf sieht den Konflikt.

ALTER TABLE terrain_peak ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN terrain_peak.revision IS
    'Revision des Gipfels fuer den Editor (WI-0178 P1): zaehlt der Trigger terrain_peak_revision bei jeder Aenderung eines Feldes.';

CREATE OR REPLACE TRIGGER terrain_peak_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, geom, height_schritt, show_name, is_active, source_system, legacy_public_id,
                     revision
    ON terrain_peak
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

ALTER TABLE editor_lock DROP CONSTRAINT IF EXISTS editor_lock_object_kind_check;
ALTER TABLE editor_lock ADD CONSTRAINT editor_lock_object_kind_check
    CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline', 'peak'));

-- 3. Das Fachprotokoll kennt den Gipfel als Ziel (`peak_public_id`, ohne Fremdschlüssel wie die anderen Ziele: ein Protokoll überlebt
--    seinen Gegenstand), wie die Kraftlinie in 0143 und das Gebiet in 0145.
ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS peak_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_peak ON map_audit_event (peak_public_id, id DESC)
    WHERE peak_public_id IS NOT NULL;

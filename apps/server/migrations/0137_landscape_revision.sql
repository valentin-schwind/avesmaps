-- Revision, Fachprotokoll und Beschriftungen je Beschriftung für den Landschaftseditor (WI-0178 Paket B1; EDIT-0004 §3 M1, §1.3 Fund 1).
--
--   1. `region.revision`, `region_area.revision`, `map_label.revision`, gezählt allein vom Trigger `public.revision_bump()` (0079; er
--      setzt auch `updated_at`), wie `place` und `path` (0091). Gezählt wird nur, wenn sich eine FACHLICHE Spalte ändert: `migration_run_id`,
--      `imported_at`, `legacy_revision` und der Fingerabdruck `geometry_revision` (ADR-0007) bescheren einem offenen Entwurf keinen
--      Bearbeitungskonflikt. `revision` steht selbst in der Liste: Eine Operation, die nur eine Beschriftung ändert, berührt die Region mit
--      `SET revision = revision … AND revision = $baseRevision`; das zählt und ist zugleich die Konfliktprüfung (EDIT-0001 §6.1 Nr. 1).
--      Der Import schreibt nur, was sich unterscheidet (`migration/region-import.ts`, `WHERE … IS DISTINCT FROM`), und zählt dann mit.
--      Weil der Trigger `updated_at` setzt, erkennt das Glätten eine geänderte Fläche weiter an `source_updated_at` (`smooth-scope.ts`).
--   2. `map_audit_event` bekommt die Ziele `region_public_id`, `region_area_public_id`, `map_label_public_id` (ohne Fremdschlüssel: ein
--      Protokoll überlebt seinen Gegenstand), die Bedingung „mindestens ein Ziel“ über alle fünf und je Ziel einen Teilindex. Die
--      Positivlisten der Felder stehen in `apps/server/src/editor/map-operation.ts` (`MAP_AUDIT_FIELDS`).
--   3. Je Beschriftung (Betreiber 2026-10-15, B1: „mehrere beschriftungen für eine landschaft …, die teil des objekt sind“): `placement`
--      (`punkt` oder `entlang`), `curve_count` (1 bis 3, nur bei `entlang`), `sort_order`, `text_follows_name`. 💣 NULLBAR, und NULL heißt
--      „noch nicht vom Import gefüllt“, nicht `punkt` oder `true`: Eine Vorgabe behauptete für die Kurvenregionen eine Lage, die niemand
--      gesetzt hat (dieselbe Falle wie `region.label_curve_enabled`, 0010). Der Import füllt sie beim nächsten Lauf aus Legacys
--      Regionswerten (EDIT-0004 §4 Nr. 2); bis dahin gilt, was die Region sagt, und das liest heute jeder Leser (Umstellen ist M2, D5).
--   4. Eine neue Landschaft, Fläche oder Beschriftung von Avesmaps3D (`source_system = 'avesmaps3d'`) trägt keine `legacy_public_id`.
--
-- Die Jobarten `land_smooth` und `label_runs` (EDIT-0004 §3 M1 Nr. 5) kommen mit Paket B3 in eigener Migration: Ihre Slots, Speicherwerte
-- und die Rechte der Jobs-Rolle stimmt Claudio vorher ab; eine Art, die niemand ausführen kann, gehört nicht in die Positivliste.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): Spalten mit Vorgabe oder nullbar, Trigger, gelockerte und neue Bedingungen, die das vorige
-- Release nicht verletzen kann (es schreibt nie `avesmaps3d`, nie die neuen Spalten und nur Ziele an Ort und Weg). Es liest und schreibt
-- weiter; sein Import zählt die Revision über den Trigger mit. Keine Datenänderung. Die Rechte der App-Rolle stehen in
-- `apps/server/src/db/map-grants.psql`.

-- 1. REVISION ----------------------------------------------------------------------------------------------------------------------

ALTER TABLE region ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE region_area ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE map_label ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

-- 3. BESCHRIFTUNG JE BESCHRIFTUNG (vor den Triggern, die sie zählen) ----------------------------------------------------------------

ALTER TABLE map_label ADD COLUMN IF NOT EXISTS placement TEXT;
ALTER TABLE map_label ADD COLUMN IF NOT EXISTS curve_count SMALLINT;
ALTER TABLE map_label ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE map_label ADD COLUMN IF NOT EXISTS text_follows_name BOOLEAN;

ALTER TABLE map_label
    DROP CONSTRAINT IF EXISTS map_label_placement_known,
    ADD CONSTRAINT map_label_placement_known CHECK (placement IS NULL OR placement IN ('punkt', 'entlang'));
-- Eine Anzahl gibt es nur entlang der Fläche, und entlang der Fläche gibt es sie immer.
ALTER TABLE map_label
    DROP CONSTRAINT IF EXISTS map_label_curve_count_with_placement,
    ADD CONSTRAINT map_label_curve_count_with_placement CHECK (
        (placement = 'entlang' AND curve_count BETWEEN 1 AND 3)
        OR (placement IS DISTINCT FROM 'entlang' AND curve_count IS NULL)
    );
ALTER TABLE map_label
    DROP CONSTRAINT IF EXISTS map_label_sort_order_positive,
    ADD CONSTRAINT map_label_sort_order_positive CHECK (sort_order IS NULL OR sort_order >= 0);

COMMENT ON COLUMN map_label.placement IS
    'Lage der Beschriftung: punkt oder entlang (der Fläche). NULL = noch nicht vom Import gefüllt; dann gilt region.label_curve_enabled (WI-0178 B1).';
COMMENT ON COLUMN map_label.curve_count IS
    'Wie oft entlang der Fläche, 1..3; nur bei placement = entlang. NULL sonst (WI-0178 B1).';
COMMENT ON COLUMN map_label.sort_order IS
    'Reihenfolge der Beschriftungen einer Landschaft im Editor, ab 0. NULL = noch nicht vom Import gefüllt (WI-0178 B1).';
COMMENT ON COLUMN map_label.text_follows_name IS
    'Der Text folgt dem Namen der Landschaft (landscape.update schreibt ihn mit). false: ein abweichender Text aus Legacy bleibt. NULL = noch nicht vom Import gefüllt (WI-0178 B1).';

CREATE OR REPLACE TRIGGER region_revision
    BEFORE UPDATE OF map_domain_id, name, region_layer, region_type, stack_order, is_locked, wiki_url, wiki_region_key,
                     label_curve_enabled, label_curve_max, label_curve_degree, primary_label_id, is_active, source_system,
                     legacy_public_id, revision
    ON region
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER region_area_revision
    BEFORE UPDATE OF map_domain_id, region_id, geom, affects_paths, is_active, source_system, legacy_public_id, revision
    ON region_area
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER map_label_revision
    BEFORE UPDATE OF map_domain_id, region_id, name, subtype, geom, label_min_zoom, label_max_zoom, label_size, label_priority,
                     rotation, show_name, is_nodix, placement, curve_count, sort_order, text_follows_name, is_active, source_system,
                     legacy_public_id, revision
    ON map_label
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN region.revision IS
    'Fachrevision (WI-0178 B1): zählt der Trigger region_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN region_area.revision IS
    'Fachrevision (WI-0178 B1): zählt der Trigger region_area_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN map_label.revision IS
    'Fachrevision (WI-0178 B1): zählt der Trigger map_label_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. FACHPROTOKOLL -----------------------------------------------------------------------------------------------------------------

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS region_public_id UUID;
ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS region_area_public_id UUID;
ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS map_label_public_id UUID;

-- Gelockert, nicht verengt: Was vorher ein Ziel hatte (Ort oder Weg), hat es weiter.
ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_region ON map_audit_event (region_public_id, id DESC)
    WHERE region_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_audit_event_region_area ON map_audit_event (region_area_public_id, id DESC)
    WHERE region_area_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_audit_event_map_label ON map_audit_event (map_label_public_id, id DESC)
    WHERE map_label_public_id IS NOT NULL;

-- 4. NEUE LANDSCHAFTEN -------------------------------------------------------------------------------------------------------------
--
-- Das vorige Release schreibt nie `avesmaps3d` (sein Import schreibt `legacy`); die Bedingung trifft keine bestehende Zeile.
ALTER TABLE region
    DROP CONSTRAINT IF EXISTS region_own_without_legacy_id,
    ADD CONSTRAINT region_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);
ALTER TABLE region_area
    DROP CONSTRAINT IF EXISTS region_area_own_without_legacy_id,
    ADD CONSTRAINT region_area_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);
ALTER TABLE map_label
    DROP CONSTRAINT IF EXISTS map_label_own_without_legacy_id,
    ADD CONSTRAINT map_label_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);

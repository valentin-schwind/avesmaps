-- Revision und Fachprotokoll für den Herrschaftsgebiete-Editor (WI-0209 Paket B1; EDIT-0005 §4 M1), nach dem Muster der Landschaften
-- (0137) und Kraftlinien (0143).
--
--   1. `territory.revision`, `territory_area.revision`, `territory_claim.revision`, gezählt allein vom Trigger `public.revision_bump()`
--      (0079; er setzt auch `updated_at`). Gezählt wird nur, wenn sich eine FACHLICHE Spalte ändert: nicht `migration_run_id`,
--      `imported_at`, `legacy_updated_at` und nicht die abgelegten Wappenspalten `coat_ref`, `coat_license_status`, `coat_origin` (F8,
--      die Wappen gehören dem Media Core). `revision` steht selbst in der Liste: Eine Operation, die nur eine Fläche ändert, berührt das
--      Gebiet mit `SET revision = revision … AND revision = $baseRevision`; das zählt und ist zugleich die Konfliktprüfung. Der
--      Gebietsimport schreibt nur, was sich unterscheidet (`migration/territory-import.ts`, `ON CONFLICT … WHERE … IS DISTINCT FROM`),
--      und zählt dann mit.
--   2. `map_audit_event` bekommt die Ziele `territory_public_id` und `territory_area_public_id` (ohne Fremdschlüssel: ein Protokoll
--      überlebt seinen Gegenstand), die Bedingung „mindestens ein Ziel“ über alle neun und je Ziel einen Teilindex. Ein Anspruch
--      (`territory_claim`, ohne eigene öffentliche Kennung) protokolliert sich am beanspruchten Gebiet.
--   3. Ein neues Gebiet oder eine neue Fläche von Avesmaps3D (`source_system = 'avesmaps3d'`) trägt keine `legacy_public_id`.
--   4. Kein Zyklus im Baum. Legacy prüft nur den Selbstbezug (`territory_not_own_parent`, 0055); unser Gebietsimport lehnt einen
--      Zyklus schon heute ab, bevor er schreibt (`detectCycle` in `migration/territories.ts`, MigrationAborted). Für das Umhängen im
--      Editor (EDIT-0005 D1) hält es jetzt auch die Datenbank: ein aufgeschobener Constraint-Trigger, der am Ende der Transaktion von
--      jedem geänderten Gebiet die Kette hinaufgeht. Aufgeschoben, damit ein Tausch zweier Eltern in EINER Transaktion nicht an einem
--      Zwischenstand scheitert. Der Editor prüft vorher und sagt es mit Satz; dies ist die Grenze dahinter.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): Spalten mit Vorgabe, Trigger, gelockerte und neue Bedingungen, die das vorige Release nicht
-- verletzen kann (es schreibt nie `avesmaps3d` und nur Ziele an Ort, Weg, Landschaft und Kraftlinie). Es liest und schreibt weiter; sein
-- Import zählt die Revision über den Trigger mit. Keine Datenänderung. Die Rechte der App-Rolle stehen in
-- `apps/server/src/db/map-grants.psql`.

-- 1. REVISION ----------------------------------------------------------------------------------------------------------------------

ALTER TABLE territory ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE territory_area ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE territory_claim ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE TRIGGER territory_revision
    BEFORE UPDATE OF map_domain_id, parent_id, name, short_name, territory_type, wiki_type, status_text, color, opacity, min_zoom,
                     max_zoom, valid_from_bf, valid_to_bf, valid_label, wiki_key, wiki_url, capital_place_public_id,
                     seat_place_public_id, sort_order, is_active, source_system, legacy_public_id, revision
    ON territory
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER territory_area_revision
    BEFORE UPDATE OF map_domain_id, territory_id, geom, valid_from_bf, valid_to_bf, min_zoom, max_zoom, is_active, source_system,
                     legacy_public_id, revision
    ON territory_area
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER territory_claim_revision
    BEFORE UPDATE OF territory_id, claimant_id, sort_order, source, is_active, revision
    ON territory_claim
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN territory.revision IS
    'Fachrevision (WI-0209 B1): zählt der Trigger territory_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN territory_area.revision IS
    'Fachrevision (WI-0209 B1): zählt der Trigger territory_area_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN territory_claim.revision IS
    'Fachrevision (WI-0209 B1): zählt der Trigger territory_claim_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. FACHPROTOKOLL -----------------------------------------------------------------------------------------------------------------

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS territory_public_id UUID;
ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS territory_area_public_id UUID;

-- Gelockert, nicht verengt: Was vorher ein Ziel hatte (Ort, Weg, Landschaft, Kraftlinie), hat es weiter.
ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_territory ON map_audit_event (territory_public_id, id DESC)
    WHERE territory_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_audit_event_territory_area ON map_audit_event (territory_area_public_id, id DESC)
    WHERE territory_area_public_id IS NOT NULL;

-- 4. KEIN ZYKLUS ------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION territory_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    aktuell BIGINT := NEW.parent_id;
    schritte INTEGER := 0;
BEGIN
    WHILE aktuell IS NOT NULL LOOP
        IF aktuell = NEW.id THEN
            RAISE EXCEPTION 'territory_cycle: Gebiet % läge unter sich selbst', NEW.public_id USING ERRCODE = '23514';
        END IF;
        schritte := schritte + 1;
        -- Ein Kreis weiter oben, an dem dieses Gebiet nicht beteiligt ist, beendet die Suche (er stammt nicht aus dieser Änderung).
        EXIT WHEN schritte > 1000;
        SELECT parent_id INTO aktuell FROM territory WHERE id = aktuell;
    END LOOP;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION territory_no_cycle() IS
    'Lehnt am Ende der Transaktion einen Elter ab, der unter dem Gebiet selbst liegt (WI-0209 B1, EDIT-0005 D1).';

-- CREATE OR REPLACE kennt PostgreSQL für Constraint-Trigger nicht; so bleibt die Migration ein zweites Mal ohne Wirkung.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'territory_no_cycle' AND tgrelid = 'territory'::regclass) THEN
        CREATE CONSTRAINT TRIGGER territory_no_cycle
            AFTER INSERT OR UPDATE OF parent_id ON territory
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION territory_no_cycle();
    END IF;
END;
$$;

-- 3. NEUE GEBIETE UND FLÄCHEN ------------------------------------------------------------------------------------------------------
--
-- Das vorige Release schreibt nie `avesmaps3d` (sein Import schreibt `legacy`); die Bedingung trifft keine bestehende Zeile.
ALTER TABLE territory
    DROP CONSTRAINT IF EXISTS territory_own_without_legacy_id,
    ADD CONSTRAINT territory_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);
ALTER TABLE territory_area
    DROP CONSTRAINT IF EXISTS territory_area_own_without_legacy_id,
    ADD CONSTRAINT territory_area_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);

-- Revision, Beschreibung und Fachprotokoll für den Kraftlinien-Editor (WI-0205 Pakete K4 und K6; §3 Nr. 1 und 2; Muster
-- 0137_landscape_revision.sql).
--
--   1. `powerline.revision` und `nodix.revision`, gezählt allein vom Trigger `public.revision_bump()` (0079; er setzt auch `updated_at`),
--      wie Ort, Weg und Landschaft. Gezählt wird nur, wenn sich eine FACHLICHE Spalte ändert. 🔴 `drawn_geom` zählt NICHT: Die
--      gezeichnete Bahn ist abgeleitet (aus den Lagen der Knoten und der Kurve) und ändert sich, wenn ein Ort verschoben wird oder der
--      Import neu rechnet; einem offenen Entwurf an der Linie beschert das keinen Bearbeitungskonflikt. Ebenso wenig `migration_run_id`
--      und `imported_at`. `revision` steht selbst in der Liste: Eine Operation an einer Linie (der Gruppe gleichen Namens) berührt jeden
--      Abschnitt mit `SET revision = revision … AND revision = $base`; das zählt und ist zugleich die Konfliktprüfung (EDIT-0001 §6.1
--      Nr. 1). Die Wiki-Zuordnung je Abschnitt (`powerline_wiki_assignment`) hat keine eigene Revision: Sie ändert sich nur mit ihrem
--      Abschnitt, und der zählt.
--   2. `map_audit_event` bekommt die Ziele `powerline_public_id` und `nodix_public_id` (ohne Fremdschlüssel: ein Protokoll überlebt
--      seinen Gegenstand), die Bedingung „mindestens ein Ziel“ über alle sieben und je Ziel einen Teilindex. Die Positivlisten der Felder
--      stehen in `apps/server/src/editor/map-operation.ts` (`MAP_AUDIT_FIELDS.powerline`, `.nodix`).
--   3. Eine neue Kraftlinie oder ein neuer Kraftlinienpunkt von Avesmaps3D (`source_system = 'avesmaps3d'`) trägt keine
--      `legacy_public_id`.
--   4. `powerline.description` (KF1): Legacys Kraftlinien-Editor führt eine Beschreibung je Linie (`update_powerline_line` schreibt
--      sie an alle Abschnitte); im Bestand ist sie an keinem der 174 Abschnitte gefüllt, der Vertrag `powerlines.yaml` übernimmt sie
--      deshalb nicht. NULLBAR, NULL heißt „keine“. Die Testwelt setzt sie zurück (`editor/testwelt.ts`), weil kein Import sie
--      schreibt; sie zählt als Fachspalte für die Revision.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): Spalten mit Vorgabe oder nullbar, Trigger, gelockerte und neue Bedingungen, die das vorige
-- Release nicht verletzen kann (es schreibt nie `avesmaps3d` und nur Ziele an Ort, Weg und Landschaft). Es liest und schreibt weiter; sein
-- Import zählt die Revision über den Trigger mit. Keine Datenänderung. Die Rechte der App-Rolle stehen in
-- `apps/server/src/db/map-grants.psql`.

-- 1. REVISION ----------------------------------------------------------------------------------------------------------------------

ALTER TABLE powerline ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE nodix ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE powerline ADD COLUMN IF NOT EXISTS description TEXT;

CREATE OR REPLACE TRIGGER powerline_revision
    BEFORE UPDATE OF map_domain_id, name, label_visible, from_public_id, to_public_id, curve, description, geom, is_active,
                     source_system, legacy_public_id, revision
    ON powerline
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE TRIGGER nodix_revision
    BEFORE UPDATE OF map_domain_id, legacy_name, legacy_kind, geom, is_active, source_system, legacy_public_id, revision
    ON nodix
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN powerline.revision IS
    'Fachrevision (WI-0205 K4): zählt der Trigger powerline_revision bei jeder Änderung einer fachlichen Spalte (nicht drawn_geom); die Anwendung schreibt sie nie.';
COMMENT ON COLUMN powerline.description IS
    'Beschreibung der Kraftlinie, an allen Abschnitten gleich (WI-0205 K6, KF1; Legacy update_powerline_line). NULL = keine. Nicht aus Legacy importiert (alle leer).';
COMMENT ON COLUMN nodix.revision IS
    'Fachrevision (WI-0205 K4): zählt der Trigger nodix_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. FACHPROTOKOLL -----------------------------------------------------------------------------------------------------------------

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS powerline_public_id UUID;
ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS nodix_public_id UUID;

-- Gelockert, nicht verengt: Was vorher ein Ziel hatte (Ort, Weg, Landschaft), hat es weiter.
ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_powerline ON map_audit_event (powerline_public_id, id DESC)
    WHERE powerline_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_audit_event_nodix ON map_audit_event (nodix_public_id, id DESC)
    WHERE nodix_public_id IS NOT NULL;

-- 3. NEUE KRAFTLINIEN UND KRAFTLINIENPUNKTE ----------------------------------------------------------------------------------------
--
-- Das vorige Release schreibt nie `avesmaps3d` (sein Import schreibt `legacy`); die Bedingung trifft keine bestehende Zeile.
ALTER TABLE powerline
    DROP CONSTRAINT IF EXISTS powerline_own_without_legacy_id,
    ADD CONSTRAINT powerline_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);
ALTER TABLE nodix
    DROP CONSTRAINT IF EXISTS nodix_own_without_legacy_id,
    ADD CONSTRAINT nodix_own_without_legacy_id CHECK (source_system <> 'avesmaps3d' OR legacy_public_id IS NULL);

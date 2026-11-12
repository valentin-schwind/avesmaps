-- 0330: Neue Orts- und Bauwerk-Artikel als Einträge der Ortsliste (WI-0295 Teil 2; Vali 2026-11-09: „gut leg los“).
--
--   Auslöser: Seit dem Cutoff am 02.11. kommen neue Wiki-Artikel nicht mehr in die Ortsliste („Nicht auf der Karte“) und nicht in die Wiki-Box, weil `wiki_settlement_registry` und
--   `wiki_settlement_snapshot` nur der Legacy-Zug füllte. Der WikiSync führt diese Artikel jetzt selbst, artikelzentriert im Bereich `ort` (Objektart `ort_artikel`, Muster 0319).
--
--   1. `wiki_settlement_registry` bekommt, was der Abgleich an einem eigenen Objekt braucht: eine Kennung für Bericht und Fachprotokoll (`public_id`), die Fachrevision (`revision`, gezählt vom Trigger) und
--      die Stilllegung durch den WikiSync (`retired_origin = 'wikisync'`). Neue Zeilen tragen `source_system = 'wikisync'`; Legacys Zeilen bleiben, wie sie sind.
--   2. `wiki_settlement_snapshot` lässt dieselbe Stilllegung zu (der Wiki-Stand eines Orts-Artikels, solange kein Ort ihn trägt).
--   3. Die Tafeln des WikiSync lernen die Objektart `ort_artikel`, das Fachprotokoll die Zielspalte `ort_artikel_public_id`.
--
-- 🔴 ADDITIV (`docs/regeln/entwicklung.md`, „erst erweitern“): Spalten mit Vorgabe, nullbare Spalte am Fachprotokoll, nur gelockerte Prüfungen. Das vorige Release schreibt keines der neuen Wörter, setzt die
-- neuen Spalten nie und liest sie nicht; was vorher erlaubt war, bleibt erlaubt. Keine Datenänderung.
--
-- Rechte (`apps/server/src/db/system-grants.psql`, hinter JEDE Migration): Die Jobs-Rolle legt Zeilen an, schreibt ihre Felder und legt sie still; die App liest weiter nur.

-- 1. DIE REGISTRY -----------------------------------------------------------------------------------------------------------------

ALTER TABLE wiki_settlement_registry ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE wiki_settlement_registry ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE wiki_settlement_registry DROP CONSTRAINT IF EXISTS wiki_settlement_registry_public_id_unique;
ALTER TABLE wiki_settlement_registry ADD CONSTRAINT wiki_settlement_registry_public_id_unique UNIQUE (public_id);

ALTER TABLE wiki_settlement_registry DROP CONSTRAINT IF EXISTS wiki_settlement_registry_retired_consistent;
ALTER TABLE wiki_settlement_registry
    ADD CONSTRAINT wiki_settlement_registry_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

CREATE OR REPLACE TRIGGER wiki_settlement_registry_revision
    BEFORE UPDATE OF title, wiki_url, settlement_class, building_type, is_ruined, continent, lage, standort, is_active, retired_origin, revision
    ON wiki_settlement_registry
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN wiki_settlement_registry.public_id IS
    'Kennung für den Bericht des WikiSync und das Fachprotokoll (WI-0295); die interne id verlässt den Server nicht.';
COMMENT ON COLUMN wiki_settlement_registry.revision IS
    'Fachrevision (ADR-0020, WI-0295): zählt der Trigger wiki_settlement_registry_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN wiki_settlement_registry.source_system IS
    'legacy: aus Legacys Registry (X3), der WikiSync fasst sie nie an; wikisync (WI-0295): ein Orts- oder Bauwerk-Artikel, den der WikiSync angelegt hat und führt.';
COMMENT ON COLUMN wiki_settlement_registry.retired_origin IS
    'import oder editor wie bisher; wikisync (WI-0295): Ein Orts-Artikel ist aus dem Wiki verschwunden oder gehört nicht mehr dazu. Kommt er zurück, lebt die Zeile wieder auf.';

-- 2. DER WIKI-STAND ---------------------------------------------------------------------------------------------------------------

ALTER TABLE wiki_settlement_snapshot DROP CONSTRAINT IF EXISTS wiki_settlement_snapshot_retired_consistent;
ALTER TABLE wiki_settlement_snapshot
    ADD CONSTRAINT wiki_settlement_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

-- 3. DIE TAFELN DES WIKISYNC UND DAS FACHPROTOKOLL --------------------------------------------------------------------------------

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'landmarke_artikel', 'region_artikel', 'ort_artikel', 'article')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'landmarke_artikel', 'region_artikel', 'ort_artikel')
    );

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS ort_artikel_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id, corpus_public_id, sprache_artikel_public_id,
                     sprache_public_id, sprache_flaeche_public_id, landmarke_artikel_public_id, region_artikel_public_id,
                     ort_artikel_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_ort_artikel ON map_audit_event (ort_artikel_public_id, id DESC)
    WHERE ort_artikel_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.ort_artikel_public_id IS
    'Ziel: ein Orts- oder Bauwerk-Artikel ohne Ort (WI-0295, wiki_settlement_registry.public_id), ohne Fremdschlüssel; die Aktionen heißen ort_artikel.*.';

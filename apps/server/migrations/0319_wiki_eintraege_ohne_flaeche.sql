-- 0319: Wiki-Einträge ohne Fläche in der Derographie-Liste (WI-0284; Vali 2026-11-06: „einfach listeneinträge mit dem wiki-eintrag (halt ohne fläche)“).
--
--   Auslöser: Frühlingsstrand hat in Production eine Fläche, aber keinen Artikel, und zuweisen ließ er sich nicht, weil die Wiki-Box nur Artikel kennt, die in `wiki_region_snapshot` stehen. Diese
--   Tafel füllte bisher allein der Legacy-Import; der WikiSync zog nur nach.
--
--   1. `wiki_region_snapshot` trägt jetzt auch die Artikel mit `{{Infobox Region}}`, an denen (noch) keine Fläche hängt. Dafür bekommt sie, was der Abgleich an einem eigenen Objekt braucht: eine
--      Kennung für Bericht und Fachprotokoll (`public_id`), die Fachrevision (`revision`, gezählt vom Trigger) und die Stilllegung durch den WikiSync (`retired_origin = 'wikisync'`).
--   2. Die Tafeln des WikiSync lernen die Objektart `region_artikel`, das Fachprotokoll die Zielspalte `region_artikel_public_id` (Muster 0290).
--
-- 🔴 ADDITIV (`docs/regeln/entwicklung.md`, „erst erweitern“): nullbare Spalte am Fachprotokoll, Spalten mit Vorgabe, gelockerte Prüfungen. Das vorige Release schreibt keines der neuen Wörter,
-- setzt die neuen Spalten nie und liest sie nicht; was vorher erlaubt war, bleibt erlaubt. Keine Datenänderung.
--
-- Rechte (`apps/server/src/db/system-grants.psql`, hinter JEDE Migration): Die Jobs-Rolle legt Zeilen an und legt sie still; die App liest weiter nur.

-- 1. WIKI-EINTRÄGE ----------------------------------------------------------------------------------------------------------------

ALTER TABLE wiki_region_snapshot ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE wiki_region_snapshot ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE wiki_region_snapshot DROP CONSTRAINT IF EXISTS wiki_region_snapshot_public_id_unique;
ALTER TABLE wiki_region_snapshot ADD CONSTRAINT wiki_region_snapshot_public_id_unique UNIQUE (public_id);

ALTER TABLE wiki_region_snapshot DROP CONSTRAINT IF EXISTS wiki_region_snapshot_retired_consistent;
ALTER TABLE wiki_region_snapshot
    ADD CONSTRAINT wiki_region_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

CREATE OR REPLACE TRIGGER wiki_region_snapshot_revision
    BEFORE UPDATE OF wiki_url, name, art, region_parent, affiliation_staat, einwohner, sprache, vegetation, verkehrswege, description, continent, is_active, retired_origin, revision
    ON wiki_region_snapshot
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON COLUMN wiki_region_snapshot.public_id IS
    'Kennung für den Bericht des WikiSync, das Fachprotokoll und die Liste der Derographie (WI-0284); die interne id verlässt den Server nicht.';
COMMENT ON COLUMN wiki_region_snapshot.revision IS
    'Fachrevision (ADR-0020, WI-0284): zählt der Trigger wiki_region_snapshot_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';
COMMENT ON COLUMN wiki_region_snapshot.retired_origin IS
    'import oder editor wie bisher; wikisync (WI-0284): Ein Artikel ohne Fläche ist aus dem Wiki verschwunden oder gehört nicht mehr in die Liste. Kommt er zurück, lebt die Zeile wieder auf.';

-- 2. DIE TAFELN DES WIKISYNC UND DAS FACHPROTOKOLL --------------------------------------------------------------------------------

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'landmarke_artikel', 'region_artikel', 'article')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'landmarke_artikel', 'region_artikel')
    );

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS region_artikel_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id, corpus_public_id, sprache_artikel_public_id,
                     sprache_public_id, sprache_flaeche_public_id, landmarke_artikel_public_id, region_artikel_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_region_artikel ON map_audit_event (region_artikel_public_id, id DESC)
    WHERE region_artikel_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.region_artikel_public_id IS
    'Ziel: ein Wiki-Eintrag ohne Fläche (WI-0284, wiki_region_snapshot.public_id), ohne Fremdschlüssel; die Aktionen heißen region_artikel.*.';

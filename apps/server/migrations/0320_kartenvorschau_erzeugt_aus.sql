-- „Vorschau erzeugen“ (WI-0287 Stufe 1, Punkt 5; OPS-000091 von Nottel: „Für Karten, deren Rechte wir haben, möchte ich eine Vorschau erzeugen“).
--
-- Die Operation `citymap.preview_generate` legt ein neues Werk der Art `map_preview` an (Herkunft `project_generated`, Eingang `generated`), bindet es als Vorschau
-- des Eintrags und reiht die Jobart `citymap_preview_generate` ein, die seine Datei aus der Karte rechnet. Diese Migration gibt ihr, was die Datenbank dafür wissen muss:
--
-- 1. `media_asset.generated_from_asset_id`: der Verweis „erzeugt aus“ (nullable, Index). Fällt die Karte einmal endgültig weg (Aufbewahrung, Löschen), bleibt die Vorschau
--    mit ihren letzten Rechten stehen, statt das Löschen scheitern zu lassen (ON DELETE SET NULL).
-- 2. 🔴 Rechte folgen der Karte, DAUERHAFT (Setzung im Entwurf Fassung 5): Grundlage, Lizenz, Urheber, Inhaber, Nennung, Notiz und Prüfstand der Vorschau sind die der Karte,
--    die Entstehung (`creation_method`, daran hängt das KI-Zeichen) ebenso. Als Auslöser in der Datenbank, nicht in den Operationen: Rechte schreiben die Medienverwaltung
--    (`rights.set`, `rights.review`, `asset.metadata`), die Annahme eines Kartenvorschlags und der Medienzug aus Legacy (`migrate:media`, Rolle des Laufs); jeder Weg ist so
--    erfasst, auch ein künftiger. Ein Schreiben an der Vorschau selbst überschreibt der Auslöser mit den Werten der Karte, die Operationen weisen es vorher ab (409
--    `media_rights_follow_source`). Den Abgleich der Dateien reiht die Anwendung ein (`enqueueSettleForActiveRoles` nimmt die erzeugten Vorschauen mit).
--    Die Community-Sperre (nur der Betreiber ändert die Lizenz eines Community-Uploads, WI-0282) hängt an der Herkunft der KARTE und wirkt, weil sich die Rechte nur dort ändern.
-- 3. `job_enqueue` lernt die Jobart `citymap_preview_generate`; `CREATE OR REPLACE` behält Eigentümer und Rechte, die Signatur bleibt.
--
-- Der Notaus der Karte gilt auch für die Vorschau, obwohl sie andere Bytes hat: Das liest die Anwendung („gehaltene Quellbytes“, `media/notaus.ts`), eine Spalte braucht es nicht.
--
-- 🔴 REIN ADDITIV: eine nullbare Spalte, ein Index, vier Auslöserfunktionen samt Auslösern, eine erweiterte Liste in `job_enqueue`. Das vorige Release schreibt die Spalte nie;
-- ohne sie feuern die Auslöser ins Leere (kein Werk hat eine Karte). Kartendaten berührt das nicht.

ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS generated_from_asset_id BIGINT REFERENCES media_asset (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS media_asset_generated_from ON media_asset (generated_from_asset_id)
    WHERE generated_from_asset_id IS NOT NULL;

COMMENT ON COLUMN media_asset.generated_from_asset_id IS
    'WI-0287: Das Werk, aus dem dieses gerechnet wurde (eine erzeugte Kartenvorschau: ihre Karte). Rechte, Entstehung und Notaus folgen ihm dauerhaft (Auslöser media_rights_folgt_quelle, media_asset_entstehung_folgt_quelle; media/notaus.ts). NULL: ein gewöhnliches Werk.';

-- 2a. Die Rechte einer erzeugten Vorschau: beim Anlegen und bei jedem Schreiben die Werte ihrer Karte. Ohne Karte (gewöhnliches Werk) oder ohne Rechtezeile der Karte bleibt,
-- was geschrieben wurde.
CREATE OR REPLACE FUNCTION public.media_rights_folgt_quelle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
AS $$
DECLARE
    quelle media_rights%ROWTYPE;
BEGIN
    SELECT r.* INTO quelle
      FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.generated_from_asset_id
     WHERE a.id = NEW.media_asset_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    NEW.rights_basis := quelle.rights_basis;
    NEW.license_key := quelle.license_key;
    NEW.license_family := quelle.license_family;
    NEW.creator := quelle.creator;
    NEW.rights_holder := quelle.rights_holder;
    NEW.attribution := quelle.attribution;
    NEW.rights_note := quelle.rights_note;
    NEW.clearance_state := quelle.clearance_state;
    NEW.reviewed_by := quelle.reviewed_by;
    NEW.reviewed_by_person := quelle.reviewed_by_person;
    NEW.reviewed_at := quelle.reviewed_at;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.media_rights_folgt_quelle() IS
    'WI-0287: Die Rechte einer erzeugten Vorschau sind die ihrer Karte (media_asset.generated_from_asset_id); jedes Schreiben an ihr nimmt deren Werte.';

CREATE OR REPLACE TRIGGER media_rights_folgt_quelle BEFORE INSERT OR UPDATE ON media_rights
    FOR EACH ROW EXECUTE FUNCTION public.media_rights_folgt_quelle();

-- 2b. Ändern sich die Rechte einer Karte, ziehen die aus ihr erzeugten Vorschauen nach: Das Berühren ihrer Zeile lässt 2a die neuen Werte hineinschreiben (und zählt ihre
-- Revision hoch, `revision_bump`). Nur wenn sich ein Wert ändert, der folgt.
CREATE OR REPLACE FUNCTION public.media_rights_an_erzeugte() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        OLD.rights_basis, OLD.license_key, OLD.license_family, OLD.creator, OLD.rights_holder, OLD.attribution, OLD.rights_note,
        OLD.clearance_state, OLD.reviewed_by, OLD.reviewed_by_person, OLD.reviewed_at
    ) IS NOT DISTINCT FROM (
        NEW.rights_basis, NEW.license_key, NEW.license_family, NEW.creator, NEW.rights_holder, NEW.attribution, NEW.rights_note,
        NEW.clearance_state, NEW.reviewed_by, NEW.reviewed_by_person, NEW.reviewed_at
    ) THEN
        RETURN NULL;
    END IF;
    UPDATE media_rights r SET updated_at = now()
      FROM media_asset a
     WHERE a.generated_from_asset_id = NEW.media_asset_id AND r.media_asset_id = a.id;
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.media_rights_an_erzeugte() IS
    'WI-0287: Nach einer Änderung an den Rechten eines Werks ziehen die aus ihm erzeugten Vorschauen nach (über media_rights_folgt_quelle).';

CREATE OR REPLACE TRIGGER media_rights_an_erzeugte AFTER INSERT OR UPDATE ON media_rights
    FOR EACH ROW EXECUTE FUNCTION public.media_rights_an_erzeugte();

-- 2c. Die Entstehung (samt KI-Zeichen) einer erzeugten Vorschau ist die ihrer Karte, beim Anlegen und bei jedem Schreiben.
CREATE OR REPLACE FUNCTION public.media_asset_entstehung_folgt_quelle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
AS $$
DECLARE
    methode text;
BEGIN
    IF NEW.generated_from_asset_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT creation_method INTO methode FROM media_asset WHERE id = NEW.generated_from_asset_id;
    IF FOUND THEN
        NEW.creation_method := methode;
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.media_asset_entstehung_folgt_quelle() IS
    'WI-0287: Die Entstehung einer erzeugten Vorschau ist die ihrer Karte (media_asset.generated_from_asset_id).';

CREATE OR REPLACE TRIGGER media_asset_entstehung_folgt_quelle
    BEFORE INSERT OR UPDATE OF creation_method, generated_from_asset_id ON media_asset
    FOR EACH ROW EXECUTE FUNCTION public.media_asset_entstehung_folgt_quelle();

-- 2d. Ändert sich die Entstehung einer Karte, ziehen die aus ihr erzeugten Vorschauen nach.
CREATE OR REPLACE FUNCTION public.media_asset_entstehung_an_erzeugte() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.creation_method IS DISTINCT FROM OLD.creation_method THEN
        UPDATE media_asset SET creation_method = NEW.creation_method
         WHERE generated_from_asset_id = NEW.id AND creation_method IS DISTINCT FROM NEW.creation_method;
    END IF;
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.media_asset_entstehung_an_erzeugte() IS
    'WI-0287: Nach einer Änderung der Entstehung eines Werks ziehen die aus ihm erzeugten Vorschauen nach.';

CREATE OR REPLACE TRIGGER media_asset_entstehung_an_erzeugte AFTER UPDATE OF creation_method ON media_asset
    FOR EACH ROW EXECUTE FUNCTION public.media_asset_entstehung_an_erzeugte();

-- Auslöserfunktionen ruft niemand direkt (das Feuern prüft kein EXECUTE); PUBLIC verliert das Recht, die App verliert es in media-grants.psql.
REVOKE EXECUTE ON FUNCTION public.media_rights_folgt_quelle() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.media_rights_an_erzeugte() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.media_asset_entstehung_folgt_quelle() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.media_asset_entstehung_an_erzeugte() FROM PUBLIC;

-- 3. Die Jobart der Vorschau.
CREATE OR REPLACE FUNCTION job_enqueue(
    p_kind TEXT,
    p_kind_version SMALLINT,
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_input_ref JSONB,
    p_priority SMALLINT DEFAULT 50,
    p_not_before TIMESTAMPTZ DEFAULT NULL,
    p_scope_kind TEXT DEFAULT 'domain',
    p_scope_tiles SMALLINT[] DEFAULT '{}',
    p_depends_on BIGINT[] DEFAULT '{}'
) RETURNS TABLE (id BIGINT, public_id UUID)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN (
        'terrain_local', 'dem_publish', 'display_heights', 'routing_reload', 'media_settle', 'legacy_pull', 'legacy_media',
        'terrain_preview', 'path_profile', 'media_quarantine', 'kanal_bild', 'legacy_zug', 'production_pull',
        'land_smooth', 'label_runs', 'territory_derive', 'media_merge_all', 'path_label_runs', 'sea_derive',
        'map_series_tile', 'map_series_production', 'abzug_lokal',
        'wiki_dump_einlesen', 'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel',
        'wiki_dump_holen', 'sprache_treffer', 'community_mail_versand', 'social_senden', 'karten_svg',
        'citymap_preview_generate'
    ) THEN
        RAISE EXCEPTION 'job_enqueue: Jobart % darf die Anwendung nicht einreihen', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    -- Ein Zug einer Kategorie nennt genau eine der drei. Herrschaftsgebiete gibt es hier nicht und nie (Betreiber 2026-10-13):
    -- Die Sperre steht in der Datenbank, nicht nur im Werkzeug, damit kein Aufrufer sie umgehen kann.
    IF p_kind = 'legacy_zug' AND COALESCE(p_input_ref->>'kategorie', '') NOT IN ('landschaften', 'wege', 'orte') THEN
        RAISE EXCEPTION 'job_enqueue: legacy_zug braucht die Kategorie landschaften, wege oder orte (nicht %)',
            COALESCE(p_input_ref->>'kategorie', '(leer)') USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id FROM job_insert(
        p_kind, p_kind_version, p_map_domain_id, 'queued', p_actor_ref, NULL, NULL, p_input_ref, p_priority,
        p_not_before, p_scope_kind, p_scope_tiles, p_depends_on
    ) i;
END;
$$;

COMMENT ON FUNCTION job_enqueue IS
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt; WI-0253 §22: wiki_dump_holen; WI-0261 S4: sprache_treffer; WI-0268 C6a: community_mail_versand; WI-0268 C12a: social_senden; WI-0280: karten_svg; WI-0287: citymap_preview_generate). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

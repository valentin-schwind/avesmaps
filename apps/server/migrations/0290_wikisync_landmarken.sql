-- 0290: WikiSync kennt die Landmarken als Bereich (WI-0271 L7, §4.2; Editor-Orchestrierung 2026-11-01).
--
--   1. `wiki_landmarke_artikel`: der Wiki-Stand je Landmarken-Artikel, ARTIKELZENTRIERT wie die Sprachen (0255). Eine Zeile je Artikel mit `{{Infobox Region}}`, dessen Art die feste Abbildung
--      Wiki-Art → Landmarkenart trifft (`apps/server/src/wiki/infobox/landmarke.ts`; dazu `Kategorie:Süßwasserquelle`) und der noch an keiner Landmarke der Karte hängt: ein Kandidat
--      „nur im Wiki, nicht platziert“ (◐). Der WikiSync legt die Zeilen selbst an und still (`retired_origin = 'wikisync'`), wenn der Artikel verschwindet, keine Landmarke mehr ist oder an einer
--      Landmarke der Karte hängt (auch einer stillgelegten: ihr Artikel kommt nicht wieder, §4.2 Tombstones). 🔴 Er legt NIE ein Objekt auf die Karte und setzt nie eine Lage: Das tut ein Mensch
--      („Auf der Karte setzen“). GESCHRIEBEN VOM WIKISYNC (Jobs-Rolle); die App liest und schreibt allein die Unterdrückung (`unterdrueckt`, „nicht auf die Karte“, je Artikel, kein Lauf
--      überschreibt sie).
--   2. Die Tafeln des WikiSync (0224, 0225) lernen den Bereich `landmarken` und die Art `landmarke_artikel`; das Fachprotokoll bekommt die Zielspalte `landmarke_artikel_public_id`
--      (Muster 0255): Übernahme und Unterdrücken laufen als Operation an der Karte mit Protokoll und Rücknahme.
--
-- Die Revision zählt allein der Trigger `public.revision_bump()` (0079; er setzt auch `updated_at`), und nur bei einer Änderung einer fachlichen Spalte.
--
-- 🔴 ADDITIV (`docs/regeln/entwicklung.md`, „erst erweitern“): eine neue Tafel, eine nullbare Spalte am Fachprotokoll, gelockerte Prüfungen. Das vorige Release schreibt keines der neuen Wörter,
-- liest die neue Tafel nicht und setzt die neue Spalte nie; was vorher erlaubt war, bleibt erlaubt. Keine Datenänderung.
--
-- Rechte (`apps/server/src/db/system-grants.psql`, hinter JEDE Migration): Die Jobs-Rolle schreibt die Wiki-Spalten spaltengenau, die App liest und schreibt nur `unterdrueckt`. Die Einordnung
-- steht in `apps/server/test/support/public-rechte.ts`.

-- 1. WIKI-STAND JE LANDMARKEN-ARTIKEL ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_landmarke_artikel (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Der Titel in Vergleichsform (Unterstriche wie Leerzeichen, Leerraum einfach, klein; MediaWiki stellt den Anfangsbuchstaben frei).
    schluessel TEXT NOT NULL,
    titel TEXT NOT NULL,
    -- Die Felder der Infobox Region, die ein Mensch zum Setzen braucht: Name, Art (abgebildet und roh), Region, Höhe (nur Berg und Vulkan) und die Kurzbeschreibung (erster Absatz).
    name TEXT,
    art TEXT,
    wiki_art TEXT,
    region TEXT,
    hoehe_schritt INTEGER,
    kurzbeschreibung TEXT,
    unbekannt TEXT[] NOT NULL DEFAULT ARRAY['name', 'art', 'wiki_art', 'region', 'height', 'kurzbeschreibung']::text[],
    -- „Nicht auf die Karte“ (je Artikel; geschrieben von der App über die Schreibnaht, mit Rücknahme). Kein Lauf ändert sie, auch nicht beim Stilllegen und Beleben.
    unterdrueckt BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_landmarke_artikel_public_id_unique UNIQUE (public_id),
    CONSTRAINT wiki_landmarke_artikel_schluessel_unique UNIQUE (schluessel),
    CONSTRAINT wiki_landmarke_artikel_schluessel_not_blank CHECK (btrim(schluessel) <> ''),
    CONSTRAINT wiki_landmarke_artikel_titel_not_blank CHECK (btrim(titel) <> ''),
    CONSTRAINT wiki_landmarke_artikel_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (wiki_art IS NULL OR btrim(wiki_art) <> '')
        AND (region IS NULL OR btrim(region) <> '')
        AND (kurzbeschreibung IS NULL OR btrim(kurzbeschreibung) <> '')
    ),
    -- Dieselbe Liste wie der CHECK der Art an `terrain_peak` (0276) und `LANDMARKEN_ARTEN`.
    CONSTRAINT wiki_landmarke_artikel_art_known CHECK (
        art IS NULL OR art IN ('berggipfel', 'vulkan', 'huegel', 'hoehle', 'grotte', 'krater', 'schlucht', 'wasserfall', 'quelle', 'geysir', 'furt',
                               'strudel', 'fels', 'klippe', 'riff')
    ),
    CONSTRAINT wiki_landmarke_artikel_hoehe_range CHECK (hoehe_schritt IS NULL OR hoehe_schritt BETWEEN 0 AND 65535),
    CONSTRAINT wiki_landmarke_artikel_unbekannt_known CHECK (
        unbekannt <@ ARRAY['name', 'art', 'wiki_art', 'region', 'height', 'kurzbeschreibung']::text[]
    ),
    CONSTRAINT wiki_landmarke_artikel_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin = 'wikisync')
    )
);

CREATE OR REPLACE TRIGGER wiki_landmarke_artikel_revision
    BEFORE UPDATE OF schluessel, titel, name, art, wiki_art, region, hoehe_schritt, kurzbeschreibung, unbekannt, unterdrueckt, is_active, retired_origin, revision
    ON wiki_landmarke_artikel
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE wiki_landmarke_artikel IS
    'Wiki-Stand je Landmarken-Artikel ohne Landmarke auf der Karte (WI-0271 L7, 0290): ein Kandidat ◐. Geschrieben vom WikiSync (Jobs-Rolle, anlegen, ändern, still legen); die App liest und schreibt nur unterdrueckt. Gelöscht wird nie.';
COMMENT ON COLUMN wiki_landmarke_artikel.public_id IS 'Kennung für die Schnittstelle, den Bericht des WikiSync und das Fachprotokoll; die interne id verlässt den Server nicht.';
COMMENT ON COLUMN wiki_landmarke_artikel.schluessel IS 'Der Titel in Vergleichsform: daran findet der WikiSync den Artikel wieder. Stabil.';
COMMENT ON COLUMN wiki_landmarke_artikel.art IS 'Die Landmarkenart aus der festen Abbildung der Wiki-Art (infobox/landmarke.ts); die Vorgabe beim Setzen, der Mensch darf sie ändern.';
COMMENT ON COLUMN wiki_landmarke_artikel.wiki_art IS 'Die Wiki-Art, wie das Wiki sie nennt (der Bestandteil von Art=, der die Abbildung traf), oder „Süßwasserquelle“ aus der Kategorie.';
COMMENT ON COLUMN wiki_landmarke_artikel.hoehe_schritt IS 'Höhe=, ganze Schritt; nur bei Berg und Vulkan (CHECK an terrain_peak), sonst NULL.';
COMMENT ON COLUMN wiki_landmarke_artikel.unterdrueckt IS
    'Nicht auf die Karte (WI-0271 §4.2, je Artikel): Die Liste zeigt den Kandidaten nicht mehr an. Gesetzt und gelöst über die Schreibnaht (Operation wikisync.landmarke_unterdruecken, mit Rücknahme); kein Lauf überschreibt sie.';
COMMENT ON COLUMN wiki_landmarke_artikel.unbekannt IS
    'Felder (Namen des Plans), deren Wiki-Wert noch nie geschrieben wurde. NULL an einem Feld, das hier nicht steht, heißt: das Wiki kennt nichts.';
COMMENT ON COLUMN wiki_landmarke_artikel.retired_origin IS
    'wikisync: Der Artikel ist verschwunden, keine Landmarke mehr oder hängt an einer Landmarke der Karte. Kommt er zurück, lebt die Zeile wieder auf.';
COMMENT ON COLUMN wiki_landmarke_artikel.revision IS
    'Fachrevision (ADR-0020): zählt der Trigger wiki_landmarke_artikel_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. DIE TAFELN DES WIKISYNC UND DAS FACHPROTOKOLL --------------------------------------------------------------------------------

ALTER TABLE wikisync_lauf DROP CONSTRAINT IF EXISTS wikisync_lauf_bereiche_bekannt;
ALTER TABLE wikisync_lauf
    ADD CONSTRAINT wikisync_lauf_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1
        AND bereiche <@ ARRAY['ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen', 'landmarken']::text[]
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_bereich_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen', 'landmarken')
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'landmarke_artikel', 'article')
    );

ALTER TABLE wikisync_bereich_setting DROP CONSTRAINT IF EXISTS wikisync_bereich_setting_bereich_check;
ALTER TABLE wikisync_bereich_setting
    ADD CONSTRAINT wikisync_bereich_setting_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen', 'landmarken')
    );

ALTER TABLE wikisync_uebernahme DROP CONSTRAINT IF EXISTS wikisync_uebernahme_bereich_check;
ALTER TABLE wikisync_uebernahme
    ADD CONSTRAINT wikisync_uebernahme_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen', 'landmarken')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'landmarke_artikel')
    );

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS landmarke_artikel_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id, corpus_public_id, sprache_artikel_public_id,
                     sprache_public_id, sprache_flaeche_public_id, landmarke_artikel_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_landmarke_artikel ON map_audit_event (landmarke_artikel_public_id, id DESC)
    WHERE landmarke_artikel_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.landmarke_artikel_public_id IS
    'Ziel: ein Landmarken-Artikel des WikiSync (WI-0271 L7, wiki_landmarke_artikel.public_id), ohne Fremdschlüssel; die Aktionen heißen landmarke_artikel.*.';

-- 0255: WikiSync kennt die Sprachen als Bereich (WI-0261 S3; Betreiber 2026-10-30: „die dinger müssten auch mit wikisync und diese liste verlinkt werden“, O1, O6).
--
--   1. `wiki_sprache_artikel`: der Wiki-Stand je aventurischem Sprachartikel, ARTIKELZENTRIERT. Eine Zeile je Artikel mit `{{Infobox Sprache}}`, der die Vorlage
--      `{{Aventurien}}` oder die Navigationsleiste `{{Nav Sprachen}}` trägt, auch ohne Zuordnung zu einer Sprache (`sprache`, 0254): „nur im Wiki, nicht platziert“ (O1). Anders als
--      bei den übrigen Bereichen legt der WikiSync die Zeilen selbst an (ein neuer aventurischer Artikel) und legt sie still (`retired_origin = 'wikisync'`), wenn der Artikel aus dem Dump
--      oder aus der aventurischen Menge verschwindet; ein Artikel, der zurückkommt, lebt in seiner alten Zeile wieder auf. GESCHRIEBEN NUR VOM WIKISYNC (Jobs-Rolle), die App liest.
--      Die sieben Felder der Infobox stehen bereinigt (`name` … `weitere_verbreitung`), die Listenfelder zusätzlich roh mit allen Links (`*_roh`, wie `wiki_lore_snapshot`, 0247), dazu
--      die Kurzbeschreibung aus dem Text des Artikels (wie bei den Vorkommen, WI-0260) und die Navigationsleisten der Sprachfamilie (`navigation`, etwa `Nav Sprachfamilie Garethi`).
--      `unbekannt` nennt die Felder (Namen des Plans), deren Wiki-Wert noch nie geschrieben wurde; der WikiSync legt eine Zeile mit allen gelesenen Werten an, die Marke bleibt nur
--      an einem Wert, den die Vorschau gekürzt hat (er wird nie geschrieben). NULL an einem Feld, das hier nicht steht, heißt: das Wiki kennt nichts.
--   2. `sprache_wiki`: die Zuordnung Artikel → Sprache, geordnet (die Pillen des Spracheditors; O1: eine Sprache je Kartengruppe trägt einen oder mehrere Artikel). Ein Artikel gehört
--      höchstens EINER aktiven Sprache, die Stelle ist je Sprache unter den aktiven eindeutig. Herkunft `import` (S6) oder `redaktion` (Spracheditor, S5); gelöscht wird nie.
--      🔴 Der WikiSync schreibt diese Tafel NIE (O6): Er überschreibt nur Wiki-Felder, nie Fläche, Farbe oder Zuordnung. In S3 entsteht nur das Schema.
--   3. Die Tafeln des WikiSync (0224, 0225) lernen den Bereich `sprachen` (`wikisync_lauf.bereiche`, `wikisync_lauf_zeile.bereich`, `wikisync_bereich_setting.bereich`,
--      `wikisync_uebernahme.bereich`) und die Art `sprache_artikel` (`wikisync_lauf_zeile.objekt_art`, `wikisync_uebernahme_befund.objekt_art`); das Fachprotokoll bekommt die
--      Zielspalte `sprache_artikel_public_id` (Muster 0234, 0236), denn die Übernahme läuft wie in jedem Bereich als Operation an der Karte mit Protokoll und Rücknahme.
--
-- Die Revision zählt allein der Trigger `public.revision_bump()` (0079; er setzt auch `updated_at`), und nur bei einer Änderung einer fachlichen Spalte (Muster 0254).
--
-- 🔴 ADDITIV (`docs/regeln/entwicklung.md`, „erst erweitern“): zwei neue Tafeln, eine nullbare Spalte am Fachprotokoll, gelockerte Prüfungen. Das vorige Release schreibt keines
-- der neuen Wörter, liest keine der neuen Tafeln und setzt die neue Spalte nie; was vorher erlaubt war, bleibt erlaubt. Keine Datenänderung.
--
-- Rechte: Die Jobs-Rolle schreibt `wiki_sprache_artikel` spaltengenau, die App liest nur (`apps/server/src/db/system-grants.psql`); an `sprache_wiki` nimmt die Vorlage der
-- App DELETE und TRUNCATE (`apps/server/src/db/map-grants.psql`). Beide gehören hinter JEDE Migration. Die Einordnung steht in `apps/server/test/support/public-rechte.ts`.

-- 1. WIKI-STAND JE SPRACHARTIKEL --------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_sprache_artikel (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Der Titel in der Form, in der der WikiSync Titel vergleicht: Unterstriche wie Leerzeichen, Leerraum einfach, klein (MediaWiki stellt den Anfangsbuchstaben frei).
    schluessel TEXT NOT NULL,
    titel TEXT NOT NULL,
    -- Die sieben Felder der Infobox, bereinigt (Links zu ihrem Text, Vorlagen und Auszeichnung weg), und die Kurzbeschreibung aus dem Text des Artikels.
    name TEXT,
    sprachfamilie TEXT,
    vorstufen TEXT,
    schrift TEXT,
    sprecheranzahl TEXT,
    offizielle_sprache TEXT,
    weitere_verbreitung TEXT,
    kurzbeschreibung TEXT,
    -- Die Listenfelder roh, so wie das Wiki sie führt (Zeichenverweise einmal aufgelöst, Leerraum an den Rändern weg), mit allen Links.
    vorstufen_roh TEXT,
    schrift_roh TEXT,
    offizielle_sprache_roh TEXT,
    weitere_verbreitung_roh TEXT,
    -- Die Navigationsleisten der Sprachfamilie, die der Artikel einbindet (Name der Vorlage, in der Reihenfolge des Texts).
    navigation TEXT[] NOT NULL DEFAULT '{}'::text[],
    unbekannt TEXT[] NOT NULL DEFAULT ARRAY[
        'name', 'sprachfamilie', 'vorstufen', 'schrift', 'sprecheranzahl', 'offizielle_sprache', 'weitere_verbreitung', 'kurzbeschreibung', 'navigation',
        'roh_vorstufen', 'roh_schrift', 'roh_offizielle_sprache', 'roh_weitere_verbreitung'
    ]::text[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_sprache_artikel_public_id_unique UNIQUE (public_id),
    CONSTRAINT wiki_sprache_artikel_schluessel_unique UNIQUE (schluessel),
    CONSTRAINT wiki_sprache_artikel_schluessel_not_blank CHECK (btrim(schluessel) <> ''),
    CONSTRAINT wiki_sprache_artikel_titel_not_blank CHECK (btrim(titel) <> ''),
    CONSTRAINT wiki_sprache_artikel_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (sprachfamilie IS NULL OR btrim(sprachfamilie) <> '')
        AND (vorstufen IS NULL OR btrim(vorstufen) <> '')
        AND (schrift IS NULL OR btrim(schrift) <> '')
        AND (sprecheranzahl IS NULL OR btrim(sprecheranzahl) <> '')
        AND (offizielle_sprache IS NULL OR btrim(offizielle_sprache) <> '')
        AND (weitere_verbreitung IS NULL OR btrim(weitere_verbreitung) <> '')
        AND (kurzbeschreibung IS NULL OR btrim(kurzbeschreibung) <> '')
        AND (vorstufen_roh IS NULL OR btrim(vorstufen_roh) <> '')
        AND (schrift_roh IS NULL OR btrim(schrift_roh) <> '')
        AND (offizielle_sprache_roh IS NULL OR btrim(offizielle_sprache_roh) <> '')
        AND (weitere_verbreitung_roh IS NULL OR btrim(weitere_verbreitung_roh) <> '')
    ),
    CONSTRAINT wiki_sprache_artikel_navigation_not_blank CHECK (array_position(navigation, NULL) IS NULL AND NOT ('' = ANY (navigation))),
    CONSTRAINT wiki_sprache_artikel_unbekannt_known CHECK (
        unbekannt <@ ARRAY[
            'name', 'sprachfamilie', 'vorstufen', 'schrift', 'sprecheranzahl', 'offizielle_sprache', 'weitere_verbreitung', 'kurzbeschreibung', 'navigation',
            'roh_vorstufen', 'roh_schrift', 'roh_offizielle_sprache', 'roh_weitere_verbreitung'
        ]::text[]
    ),
    CONSTRAINT wiki_sprache_artikel_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin = 'wikisync')
    )
);

CREATE OR REPLACE TRIGGER wiki_sprache_artikel_revision
    BEFORE UPDATE OF schluessel, titel, name, sprachfamilie, vorstufen, schrift, sprecheranzahl, offizielle_sprache, weitere_verbreitung, kurzbeschreibung,
        vorstufen_roh, schrift_roh, offizielle_sprache_roh, weitere_verbreitung_roh, navigation, unbekannt, is_active, retired_origin, revision
    ON wiki_sprache_artikel
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE wiki_sprache_artikel IS
    'Wiki-Stand je aventurischem Sprachartikel (WI-0261 S3, 0255): eine Zeile je Artikel mit Infobox Sprache und {{Aventurien}} oder {{Nav Sprachen}}, auch ohne Sprache. Geschrieben nur vom WikiSync (Jobs-Rolle, anlegen, ändern, still legen), die App liest. Gelöscht wird nie.';
COMMENT ON COLUMN wiki_sprache_artikel.public_id IS 'Kennung für die Schnittstelle, den Bericht des WikiSync und das Fachprotokoll; die interne id verlässt den Server nicht.';
COMMENT ON COLUMN wiki_sprache_artikel.schluessel IS
    'Der Titel in Vergleichsform (Unterstriche wie Leerzeichen, Leerraum einfach, klein): daran findet der WikiSync den Artikel wieder. Stabil.';
COMMENT ON COLUMN wiki_sprache_artikel.titel IS 'Der Titel des Artikels, wie der Dump ihn führt (mit Präfix des Namensraums, falls nicht der Hauptraum).';
COMMENT ON COLUMN wiki_sprache_artikel.navigation IS
    'Die Navigationsleisten der Sprachfamilie, die der Artikel einbindet (Vorlagen, deren Name „Sprachfamilie“ enthält oder auf „dialekte“ endet), in der Reihenfolge des Texts.';
COMMENT ON COLUMN wiki_sprache_artikel.unbekannt IS
    'Felder (Namen des Plans), deren Wiki-Wert noch nie geschrieben wurde. NULL an einem Feld, das hier nicht steht, heißt: das Wiki kennt nichts.';
COMMENT ON COLUMN wiki_sprache_artikel.retired_origin IS
    'wikisync: Der Artikel ist aus dem Dump oder aus der aventurischen Menge verschwunden. Kommt er zurück, lebt die Zeile wieder auf.';
COMMENT ON COLUMN wiki_sprache_artikel.revision IS
    'Fachrevision (ADR-0020): zählt der Trigger wiki_sprache_artikel_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. ZUORDNUNG ARTIKEL → SPRACHE --------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sprache_wiki (
    id BIGSERIAL PRIMARY KEY,
    sprache_id BIGINT NOT NULL REFERENCES sprache (id),
    wiki_sprache_artikel_id BIGINT NOT NULL REFERENCES wiki_sprache_artikel (id),
    position SMALLINT NOT NULL,
    herkunft TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sprache_wiki_position_nonnegative CHECK (position >= 0),
    CONSTRAINT sprache_wiki_herkunft_known CHECK (herkunft IN ('import', 'redaktion')),
    CONSTRAINT sprache_wiki_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

-- Ein Artikel gehört höchstens einer aktiven Sprache; die Stelle ist je Sprache unter den aktiven eindeutig (die Reihenfolge der Pillen). 🪤 Ein Teilindex lässt sich nicht
-- aufschieben: Wer zwei Pillen tauscht, schreibt in zwei Schritten (erst still legen oder auf eine freie Stelle, dann die neue).
CREATE UNIQUE INDEX IF NOT EXISTS sprache_wiki_artikel_aktiv ON sprache_wiki (wiki_sprache_artikel_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS sprache_wiki_position_aktiv ON sprache_wiki (sprache_id, position) WHERE is_active;
CREATE INDEX IF NOT EXISTS sprache_wiki_sprache ON sprache_wiki (sprache_id) WHERE is_active;

CREATE OR REPLACE TRIGGER sprache_wiki_revision
    BEFORE UPDATE OF sprache_id, wiki_sprache_artikel_id, position, herkunft, is_active, retired_origin, revision
    ON sprache_wiki
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE sprache_wiki IS
    'Wiki-Artikel einer Sprache (WI-0261 S3, O1): die geordneten Pillen des Spracheditors. Ein Artikel gehört höchstens einer aktiven Sprache. Geschrieben vom Import (S6) und vom Spracheditor (S5), NIE vom WikiSync (O6). Stillgelegt wird, nie gelöscht.';
COMMENT ON COLUMN sprache_wiki.position IS 'Stelle der Pille in der Sprache, aufsteigend ab 0; unter den aktiven Zeilen einer Sprache eindeutig.';
COMMENT ON COLUMN sprache_wiki.herkunft IS 'import (Zuordnung beim Einspielen, S6) | redaktion (im Spracheditor gesetzt, S5).';
COMMENT ON COLUMN sprache_wiki.retired_origin IS 'import (der Import nennt die Zuordnung nicht mehr) | editor (die Redaktion hat sie gelöst).';
COMMENT ON COLUMN sprache_wiki.revision IS
    'Fachrevision (ADR-0020): zählt der Trigger sprache_wiki_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 3. DIE TAFELN DES WIKISYNC UND DAS FACHPROTOKOLL --------------------------------------------------------------------------------

ALTER TABLE wikisync_lauf DROP CONSTRAINT IF EXISTS wikisync_lauf_bereiche_bekannt;
ALTER TABLE wikisync_lauf
    ADD CONSTRAINT wikisync_lauf_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1
        AND bereiche <@ ARRAY['ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen']::text[]
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_bereich_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen')
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel', 'article')
    );

ALTER TABLE wikisync_bereich_setting DROP CONSTRAINT IF EXISTS wikisync_bereich_setting_bereich_check;
ALTER TABLE wikisync_bereich_setting
    ADD CONSTRAINT wikisync_bereich_setting_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen')
    );

ALTER TABLE wikisync_uebernahme DROP CONSTRAINT IF EXISTS wikisync_uebernahme_bereich_check;
ALTER TABLE wikisync_uebernahme
    ADD CONSTRAINT wikisync_uebernahme_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen', 'sprachen')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'sprache_artikel')
    );

ALTER TABLE map_audit_event ADD COLUMN IF NOT EXISTS sprache_artikel_public_id UUID;

ALTER TABLE map_audit_event
    DROP CONSTRAINT IF EXISTS map_audit_event_has_target,
    ADD CONSTRAINT map_audit_event_has_target CHECK (
        num_nonnulls(place_public_id, path_public_id, region_public_id, region_area_public_id, map_label_public_id,
                     powerline_public_id, nodix_public_id, territory_public_id, territory_area_public_id, peak_public_id,
                     source_public_id, work_public_id, lore_public_id, corpus_public_id, sprache_artikel_public_id) >= 1
    );

CREATE INDEX IF NOT EXISTS map_audit_event_sprache_artikel ON map_audit_event (sprache_artikel_public_id, id DESC)
    WHERE sprache_artikel_public_id IS NOT NULL;

COMMENT ON COLUMN map_audit_event.sprache_artikel_public_id IS
    'Ziel: ein Sprachartikel des WikiSync (WI-0261 S3, wiki_sprache_artikel.public_id), ohne Fremdschlüssel; die Aktionen heißen sprache_artikel.*.';

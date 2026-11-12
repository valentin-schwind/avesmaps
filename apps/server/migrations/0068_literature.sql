-- Spielliteratur: Werke, Ortsbezug, weitere Links, Herkunftsvermerke und die Bindung zum Cover (WI-0063 P3, Vertrag
-- `project-control/migration/contracts/literature.yaml`, D3).
--
-- 🔴 Das WERK (`adventure`) ist die Wurzel: Es trägt seine Identität (`public_id`) und alle seine Teile. Ein Ortsbezug und ein weiterer
-- Link gehören genau einem Werk. Die ZIELE der Ortsbezüge (Ort, Gebiet, Landschaft, Gipfel, Weg) bleiben in ihren eigenen Domänen; das
-- Werk hängt nur einen typisierten Fremdschlüssel an sie. Wiki-Identität ist niemals automatisch Objektidentität: `wiki_key` ist
-- Information und Verbindung zur Quelle (derselbe Schlüsselraum wie `wikipub:<wiki_key>` in `feature_source`), nie ein Fremdschlüssel.
--
-- 🔴 Echte Fremdschlüssel je Zielart (`place_id`, `territory_id`, `region_id`, `terrain_peak_id`, `path_id`) und ein `target_state`
-- (`resolved`, `unresolved`, `unmatched`) statt einer `entity_type`-Spalte mit öffentlicher ID. Der Ortsbezug ist eine Aussage des
-- Werks (`start` „beginnt hier“, `play` „spielt hier“, `covers` „beschreibt“); `play` IST der Spoiler (keine eigene Spalte, keine zweite
-- Wahrheit). Wo Avesmaps3D das Ziel nicht kennt, bleibt der Bezug mit Rohname und den Legacy-Angaben (`legacy_target_*`, als Text, keine
-- Verweise) stehen und wird bei jedem Lauf neu aufgelöst. Ein Name wird nie gegen Objekte verglichen (Legacys Namensauflöser ist nicht
-- nachgebaut).
--
-- 🔴 Keine EAV-Tabelle, keine JSON-Spalte, keine `entity_type`-Haupttabelle, kein gespeicherter Gebietspfad (abgeleiteter Kontext: der
-- Leser bildet die Kette aus dem Gebietsbaum), keine gespeicherten berechneten Links (Shop, Wiki, DNB), kein Linkprüfzustand, kein
-- Cover-Pfad. Die Reihenfolge der Ortsliste ist Aussage (`sort_order`, der kleinste ist der Startort): sie wird nie neu sortiert.
--
-- Medien: nur die BEZIEHUNG (`adventure_media`, Rolle `literature_cover`), nach dem Muster von `place_media` (Migration 0064). Medienzeilen
-- und die Freigaberegel (`publication_rule`, fan_policy, G1 = A) schreibt später der Medienimport (MEDIA-M8), nicht der Fachimport.
--
-- Grenze zu WI-0068: Diese Migration legt Schema an. Geschrieben wird es vorerst nur vom Import (`migrate:literature`); kein Endpunkt
-- ändert Werke. `state suppressed`, `target_origin editor`, `retired_origin editor` und die Herkunft `editor` sind RESERVIERT: Legacy
-- liefert sie nicht (oder erst mit E5+), der Import schreibt sie nie aus eigenem Antrieb und überschreibt sie nie (Kapitel 9.37).
--
-- Gemeinsame Spalten (Vertrag `zielmodell.gemeinsame_spalten`): source_system, migration_run_id, imported_at, is_active, retired_at,
-- retired_origin (import | editor), created_at, updated_at. Stillgelegt wird, nie gelöscht. `state` (active | retired | suppressed) ist
-- die fachliche Aussage und bleibt mit `is_active` gleichlaufend (`state = 'active'` ⇔ `is_active`).
--
-- Längen: Legacys Obergrenzen (Titel 300, Genre 160, Autoren 500, Rohname 300, Link-Titel 120, Adresse 500 Zeichen und die übrigen)
-- stehen hier NICHT als CHECK. Ein längerer Quelltext würde sonst den ganzen Import anhalten (Betreiber 2026-10-03: nur selbst definierte
-- Prüfungen halten an, wie in 0065 und 0066); der Import meldet ihn als Befund `text_exceeds_legacy_limit` und speichert ihn unverändert.

-- WERK ----------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS adventure (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys UUID. Identität im Import, im zweiten Lauf und für die Medienbindung.
    public_id UUID NOT NULL,
    legacy_public_id UUID,
    -- Die Wiki-Identität des WERKS (Slug des normalisierten Seitentitels, ohne Präfix). Nur mit E5; manuell angelegte Werke bleiben NULL.
    wiki_key TEXT,
    wiki_url TEXT,
    title TEXT NOT NULL,
    -- Offenes Vokabular, kein Katalog: jede Art mit „abenteuer“ oder „kampagne“ im Namen plus szenario, anthologie, metaband, roman,
    -- kurzgeschichte, regionalspielhilfe, spielhilfe. Wörtlich übernommen; die Werkart wird abgeleitet, nie gespeichert.
    product_type TEXT NOT NULL,
    edition TEXT,
    bf_year INTEGER,
    bf_label TEXT,
    genre TEXT,
    complexity_gm TEXT,
    complexity_pl TEXT,
    -- Legacy: NOT NULL, Vorgabe 1. Keine Dreiwertigkeit.
    is_official BOOLEAN NOT NULL,
    -- Nur mit E5 (Autoren veröffentlichter Werke: öffentliche Angabe).
    authors TEXT,
    series TEXT,
    fshop_code TEXT,
    link_ulisses TEXT,
    link_fshop TEXT,
    isbn TEXT,
    contained_in TEXT,
    -- Nur mit E5; der Import setzt ihn nie selbst.
    synced_at TIMESTAMPTZ,
    legacy_origin TEXT NOT NULL DEFAULT 'unknown',
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT adventure_public_id_unique UNIQUE (public_id),
    CONSTRAINT adventure_wiki_key_unique UNIQUE (wiki_key),
    CONSTRAINT adventure_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT adventure_product_type_not_blank CHECK (btrim(product_type) <> ''),
    CONSTRAINT adventure_text_not_blank CHECK (
        (wiki_key IS NULL OR btrim(wiki_key) <> '')
        AND (edition IS NULL OR btrim(edition) <> '')
        AND (bf_label IS NULL OR btrim(bf_label) <> '')
        AND (genre IS NULL OR btrim(genre) <> '')
        AND (complexity_gm IS NULL OR btrim(complexity_gm) <> '')
        AND (complexity_pl IS NULL OR btrim(complexity_pl) <> '')
        AND (authors IS NULL OR btrim(authors) <> '')
        AND (series IS NULL OR btrim(series) <> '')
        AND (fshop_code IS NULL OR btrim(fshop_code) <> '')
        AND (isbn IS NULL OR btrim(isbn) <> '')
        AND (contained_in IS NULL OR btrim(contained_in) <> '')
    ),
    -- Eine Adresse geht als href an den Leser: nur http und https (Befund link_scheme_rejected).
    CONSTRAINT adventure_urls_http CHECK (
        (wiki_url IS NULL OR wiki_url ~* '^https?://')
        AND (link_ulisses IS NULL OR link_ulisses ~* '^https?://')
        AND (link_fshop IS NULL OR link_fshop ~* '^https?://')
    ),
    CONSTRAINT adventure_legacy_origin_known CHECK (legacy_origin IN ('manual', 'wiki', 'unknown')),
    CONSTRAINT adventure_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT adventure_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT adventure_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE adventure IS
    'Werk der Spielliteratur (D3): Wurzel mit Identität (public_id), Stammfeldern, geordneter Ortsliste und weiteren Links. Die Anzeige heißt Literatur. Ein Werk IST eine Publikation und trägt keine eigenen Quellen.';
COMMENT ON COLUMN adventure.public_id IS 'Legacys UUID; Identität im Import und für die Medienbindung (adventure_media). Die sechs Bootstrap-Beispielwerke (a0e17e10-0000-4000-8000-00000000000n) gelten als Werke wie alle.';
COMMENT ON COLUMN adventure.wiki_key IS
    'Wiki-Identität des Werks (Slug des Seitentitels, ohne Präfix), nur mit E5. Derselbe Schlüsselraum wie wikipub:<wiki_key> in feature_source (D1), aber kein Fremdschlüssel: ein Leser darf über Gleichheit verbinden. Wiki-Identität ist nie Objektidentität.';
COMMENT ON COLUMN adventure.product_type IS 'Offenes Vokabular, wörtlich. Die Werkart (Abenteuer, Regionalspielhilfe, Spielhilfe, Roman, Kurzgeschichte) wird daraus abgeleitet und nie gespeichert; ein unbekannter Wert gilt als Abenteuer.';
COMMENT ON COLUMN adventure.is_official IS 'Legacy-Vorgabe true (der Wiki-Abgleich schreibt ihn nicht); keine Auskunft aus dem Namensraum.';
COMMENT ON COLUMN adventure.synced_at IS 'Stempel des Legacy-Wiki-Abgleichs (E5). Der Import setzt ihn nie selbst.';
COMMENT ON COLUMN adventure.legacy_origin IS 'manual | wiki | unknown. Ohne E5 ist jede Zeile unknown (ehrlich: nicht bekannt). Nur ein grober Hinweis, der Schutz je Feld steht in adventure_field_origin.';
COMMENT ON COLUMN adventure.state IS 'active | retired (der Zug nennt das Werk nicht mehr) | suppressed (RESERVIERT; Legacy schreibt heute kein Unterdrücken eines Werks).';

-- Welches Feld eines Werks aus dem Wiki kam und welches von Hand gesetzt wurde (Legacy `field_origins_json`, E5). Keine Werte, nur
-- Herkunft; die Werte stehen in den typisierten Spalten. Ein fehlender Eintrag heißt „nicht bekannt“, NIE „wiki“. Eine feste Liste von
-- Feldnamen (CHECK): das ist der Herkunftsvermerk aus Kapitel 9.38, keine EAV-Ablage.
CREATE TABLE IF NOT EXISTS adventure_field_origin (
    adventure_id BIGINT NOT NULL REFERENCES adventure (id),
    field TEXT NOT NULL,
    origin TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (adventure_id, field),
    CONSTRAINT adventure_field_origin_field_known CHECK (
        field IN (
            'title', 'product_type', 'edition', 'bf_year', 'bf_label', 'genre', 'complexity_gm', 'complexity_pl', 'is_official',
            'authors', 'series', 'fshop_code', 'cover_url', 'wiki_url', 'wiki_key', 'link_ulisses', 'link_fshop', 'isbn',
            'contained_in'
        )
    ),
    CONSTRAINT adventure_field_origin_origin_known CHECK (origin IN ('wiki', 'manual'))
);

COMMENT ON TABLE adventure_field_origin IS
    'Herkunftsvermerk je Feld eines Werks (E5): wiki oder manual, ohne Werte. Ein fehlender Eintrag heißt nicht bekannt, nie wiki. Das Feld cover_url steuert die Herkunft der Cover-Bindung (adventure_media.origin).';

-- ORTSBEZUG -----------------------------------------------------------------------------------------------------------------

-- Schlüssel: (Werk, sort_order, name_key, dup_ordinal). Legacy exportiert keine Kennung des Ortsbezugs; die laufende Zeilennummer ist nicht
-- stabil und wird nie exportiert. `name_key` ist lower(trim(raw_name)) (Legacys eigener PlaceNameKey), `dup_ordinal` zählt gleiche
-- (sort_order, name_key) im selben Werk in Ausgabereihenfolge (0 für die erste). `export_ordinal` ist der Index in der Ausgabe des Werks und
-- bricht nur den Gleichstand im sort_order: die Lesereihenfolge ist (sort_order, export_ordinal). Weder Zeilennummer noch Listenposition
-- ist Identität.
CREATE TABLE IF NOT EXISTS adventure_place (
    id BIGSERIAL PRIMARY KEY,
    adventure_id BIGINT NOT NULL REFERENCES adventure (id),
    sort_order INTEGER NOT NULL,
    export_ordinal INTEGER NOT NULL,
    name_key TEXT NOT NULL,
    dup_ordinal SMALLINT NOT NULL DEFAULT 0,
    raw_name TEXT NOT NULL,
    role TEXT NOT NULL,
    target_state TEXT NOT NULL,
    resolved_by TEXT,
    place_id BIGINT REFERENCES place (id),
    territory_id BIGINT REFERENCES territory (id),
    region_id BIGINT REFERENCES region (id),
    terrain_peak_id BIGINT REFERENCES terrain_peak (id),
    -- Das ANKERSEGMENT des Wegs: die Wegegruppe löst der Leser aus dem Anker auf, nie umgekehrt.
    path_id BIGINT REFERENCES path (id),
    -- Worauf Legacy zeigte, als Text (Herkunft der Aussage, keine Verweise). Bei resolved zur Gegenprobe.
    legacy_target_kind TEXT,
    legacy_target_public_id TEXT,
    legacy_target_wiki_key TEXT,
    -- `editor` ist RESERVIERT (Ziel von Hand gesetzt, erst nach dem Cutover möglich) und wird nie überschrieben.
    target_origin TEXT NOT NULL DEFAULT 'legacy_import',
    legacy_origin TEXT NOT NULL DEFAULT 'unknown',
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT adventure_place_key_unique UNIQUE (adventure_id, sort_order, name_key, dup_ordinal),
    CONSTRAINT adventure_place_raw_name_not_blank CHECK (btrim(raw_name) <> '' AND btrim(name_key) <> ''),
    CONSTRAINT adventure_place_ordinals_nonnegative CHECK (export_ordinal >= 0 AND dup_ordinal >= 0),
    CONSTRAINT adventure_place_role_known CHECK (role IN ('start', 'play', 'covers')),
    CONSTRAINT adventure_place_target_state_known CHECK (target_state IN ('resolved', 'unresolved', 'unmatched')),
    CONSTRAINT adventure_place_resolved_by_known CHECK (resolved_by IS NULL OR resolved_by IN ('public_id', 'wiki_key')),
    CONSTRAINT adventure_place_resolved_by_iff_resolved CHECK ((target_state = 'resolved') = (resolved_by IS NOT NULL)),
    -- Genau EIN Fremdschlüssel bei resolved, sonst keiner.
    CONSTRAINT adventure_place_one_target_when_resolved CHECK (
        num_nonnulls(place_id, territory_id, region_id, terrain_peak_id, path_id) = CASE WHEN target_state = 'resolved' THEN 1 ELSE 0 END
    ),
    CONSTRAINT adventure_place_legacy_target_not_blank CHECK (
        (legacy_target_kind IS NULL OR btrim(legacy_target_kind) <> '')
        AND (legacy_target_public_id IS NULL OR btrim(legacy_target_public_id) <> '')
        AND (legacy_target_wiki_key IS NULL OR btrim(legacy_target_wiki_key) <> '')
    ),
    CONSTRAINT adventure_place_target_origin_known CHECK (target_origin IN ('legacy_import', 'editor')),
    CONSTRAINT adventure_place_legacy_origin_known CHECK (legacy_origin IN ('manual', 'wiki', 'unknown')),
    CONSTRAINT adventure_place_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT adventure_place_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT adventure_place_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

-- Rückwärts lesen („welche Werke gehören zu diesem Ort / Gebiet / dieser Landschaft / diesem Weg“).
CREATE INDEX IF NOT EXISTS adventure_place_place ON adventure_place (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adventure_place_territory ON adventure_place (territory_id) WHERE territory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adventure_place_region ON adventure_place (region_id) WHERE region_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adventure_place_terrain_peak ON adventure_place (terrain_peak_id) WHERE terrain_peak_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adventure_place_path ON adventure_place (path_id) WHERE path_id IS NOT NULL;

COMMENT ON TABLE adventure_place IS
    'Ortsbezug eines Werks (D3), geordnet nach sort_order (kleinster = Startort), mit Rolle, Rohname und typisiertem Ziel. Das Ziel ist ein echter Fremdschlüssel je Zielart; ohne Ziel steht der Rohname mit den Legacy-Angaben da.';
COMMENT ON COLUMN adventure_place.sort_order IS 'Legacys Position in der Ort-Liste, unverändert (Lücken und Gleichstand eingeschlossen). Nie neu sortieren, nicht beim Import und nicht beim Lesen.';
COMMENT ON COLUMN adventure_place.export_ordinal IS 'Index des Orts in der Ausgabe seines Werks (0-basiert); bricht nur den Gleichstand im sort_order.';
COMMENT ON COLUMN adventure_place.name_key IS 'lower(trim(raw_name)): Legacys PlaceNameKey, Teil der Identität (ein umbenannter Ort ist eine neue Zeile).';
COMMENT ON COLUMN adventure_place.role IS 'start (beginnt hier) | play (spielt hier, IST der Spoiler) | covers (beschreibt, spoilerfrei). Ein unbekannter Legacy-Wert wird play (Richtung: lieber verschleiern als verraten).';
COMMENT ON COLUMN adventure_place.target_state IS
    'resolved (genau ein Fremdschlüssel, das Ziel ist aktiv) | unresolved (Legacy selbst hat kein Ziel: nur Rohname) | unmatched (Legacy nennt ein Ziel, Avesmaps3D findet es nicht, findet mehrere oder nur ein inaktives).';
COMMENT ON COLUMN adventure_place.resolved_by IS 'Womit aufgelöst wurde: public_id (Kennung, Vorrang) | wiki_key (Wiki-Schlüssel über die Zuordnung aus D6). Wird bei jedem Lauf aus den Trägertabellen neu gerechnet.';
COMMENT ON COLUMN adventure_place.path_id IS 'Das Ankersegment des Wegs; die Wegegruppe liest der Leser aus dem Anker, nie umgekehrt.';
COMMENT ON COLUMN adventure_place.target_origin IS 'legacy_import | editor (RESERVIERT: Ziel von Hand gesetzt, wird von keinem Import überschrieben).';

-- WEITERE LINKS -------------------------------------------------------------------------------------------------------------

-- Nur die KURATIERTEN Links (Legacy `adventure_link`, in der Antwort `extra:<n>`). Die berechneten (Ulisses, F-Shop, Wiki Aventurica, DNB)
-- bildet der Leser aus link_ulisses, link_fshop, wiki_url, isbn und Titel; sie sind keine Zeilen. Legacy ersetzt die Liste eines Werks als
-- Ganzes und hat keine Zeilenidentität: die Adresse ist, was der Leser folgt (Schlüssel (Werk, url)); `position` zählt als Update.
CREATE TABLE IF NOT EXISTS adventure_link (
    id BIGSERIAL PRIMARY KEY,
    adventure_id BIGINT NOT NULL REFERENCES adventure (id),
    url TEXT NOT NULL,
    label TEXT NOT NULL,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT adventure_link_url_unique UNIQUE (adventure_id, url),
    CONSTRAINT adventure_link_url_http CHECK (url ~* '^https?://'),
    CONSTRAINT adventure_link_label_not_blank CHECK (btrim(label) <> ''),
    CONSTRAINT adventure_link_position_nonnegative CHECK (position >= 0),
    CONSTRAINT adventure_link_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT adventure_link_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT adventure_link_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE adventure_link IS
    'Kuratierter weiterer Link eines Werks (Rezension, Errata, Fanmaterial): Titel, Adresse, Reihenfolge. Die berechneten Links (Shop, Wiki, DNB) und der Prüfzustand der Links sind keine Zeilen.';
COMMENT ON COLUMN adventure_link.position IS 'Ausgabereihenfolge der kuratierten Links, 0-basiert. Keine Identität.';

-- BEZIEHUNG ZUM COVER -------------------------------------------------------------------------------------------------------

-- Wie `place_media` (Migration 0064): ein Werk kennt ein Cover in der Einzelrolle `literature_cover`, höchstens EINE aktive Bindung.
-- Keine Reihenfolge (die Einzelrolle braucht keine). Die Zeilen schreibt der Medienimport (MEDIA-M8), nicht der Fachimport; Dateien,
-- Rechte, Lizenzliste und Pfade stehen im Media Core (media.yaml). Die Herkunft ist `wiki_localized`, wenn Legacy das Wiki-Cover geholt
-- und lokal abgelegt hat, `legacy` bei einem eigenen Upload; `editor` ist für WI-0068 reserviert.
CREATE TABLE IF NOT EXISTS adventure_media (
    id BIGSERIAL PRIMARY KEY,
    adventure_id BIGINT NOT NULL REFERENCES adventure (id),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    publication_override TEXT NOT NULL DEFAULT 'none',
    override_decided_on DATE,
    override_operator_quote TEXT,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT adventure_media_unique UNIQUE (adventure_id, media_asset_id, role),
    CONSTRAINT adventure_media_role_known CHECK (role IN ('literature_cover')),
    CONSTRAINT adventure_media_origin_known CHECK (origin IN ('legacy', 'wiki_localized', 'editor')),
    CONSTRAINT adventure_media_override_known CHECK (publication_override IN ('none', 'approved', 'blocked')),
    CONSTRAINT adventure_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (override_decided_on IS NOT NULL AND btrim(coalesce(override_operator_quote, '')) <> '')
    )
);

-- Höchstens EINE aktive Bindung je Werk und Rolle; zurückgezogene bleiben als Verlauf stehen.
CREATE UNIQUE INDEX IF NOT EXISTS adventure_media_one_active_per_role ON adventure_media (adventure_id, role) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS adventure_media_asset ON adventure_media (media_asset_id);

COMMENT ON TABLE adventure_media IS
    'Bindung Werk - Asset in der Einzelrolle literature_cover (WI-0063 26.7, media.yaml bindings). Echte Fremdschlüssel statt entity_type + url. Die Zeilen schreibt der Medienimport; die Freigabe regelt publication_rule (fan_policy, G1 = A).';

-- Kartensammlung: Karten, Typen, Beziehungen, Ortsbezug, Fundstellen, Quellenverknüpfung, Zuordnung des eigenen Wiki-Artikels und die
-- Bindung zu Vollkarte und Vorschau (WI-0063 P3, Vertrag `project-control/migration/contracts/citymaps.yaml`, D2).
--
-- 🔴 Die KARTE (`citymap`) ist ein Nachschlageeintrag „welche Karten gibt es von diesem Ort, wo bekomme ich sie“, KEIN Bild-Asset: ein
-- eigenes Objekt mit Eigenschaften, Orten, Fundstellen und Quellen, das auf höchstens zwei Bilder zeigt (Vollkarte, Vorschau). Die Ziele
-- der Ortsbezüge bleiben in ihren Domänen, die Quellen im Quellenkatalog (D1), die Bilder im Media Core.
--
-- 🔴 Ortsbezug wie in D3 (Migration 0068, wortgleich außer: eine Karte bildet einen Ort ab, sie „beginnt“ und „spielt“ nirgends, es gibt
-- also KEINE Rolle und keine Startzeile): echte Fremdschlüssel je Zielart und `target_state`, nie ein `entity_type`; Rohname und
-- Legacy-Angaben bleiben als Text stehen; die Reihenfolge `sort_order` wird nie neu sortiert; kein gespeicherter Gebietspfad.
--
-- 🔴 Eigenschaften sind DREIWERTIG: jede Eigenschaft außer Titel und Karten-Link ist optional, und NULL heißt UNBEKANNT, nie „nein“
-- (Legacy-Kernregel). `is_paid` ist eine Eigenschaft der FUNDSTELLE (`citymap_link.is_paid`), nicht der Karte: dieselbe Ausgabe kann im
-- Shop bezahlt und auf der Wiki-Seite frei sein. `is_color` gibt es nicht mehr (Legacy hat es in `color_mode` überführt); `color_mode`
-- kennt „unbekannt“ nur als NULL.
--
-- 🔴 Quellen werden NICHT vererbt (`citymap_source`, nach dem Muster der Verknüpfungen in Migration 0066): je Karte genau die Quellen, die
-- Legacy ihr zuordnet. Kein Kanon je Karte (Legacy kennt keinen; ihre Aussage „offiziell“ ist `is_official`).
--
-- Medien: nur die BEZIEHUNG (`citymap_media`, Rollen `map_full` und `map_preview`), nach dem Muster von `place_media` (Migration 0064).
-- Die Vorschau ist in Legacy IMMER ein eigener Upload oder ein Verlagscover der Publikation, nie ein Ausschnitt der Vollkarte: sie ist ein
-- eigenes Asset mit eigenen Rechten. `thumb_auto_url` (Fremdbild ohne Rechte) und `thumb_url` (externer Vorschlagslink) werden NIE Asset.
-- Medienzeilen und die Freigaberegel (`publication_rule`, fan_policy, G1 = A) schreibt der Medienimport (MEDIA-M8), nicht der Fachimport.
--
-- Grenze zu WI-0068: Diese Migration legt Schema an. Geschrieben wird es vorerst nur vom Import (`migrate:citymaps`). `state suppressed`,
-- `target_origin editor`, `retired_origin editor` und die Herkunft `editor` sind RESERVIERT (Kapitel 9.37).
--
-- Gemeinsame Spalten (Vertrag `zielmodell.gemeinsame_spalten`): source_system, migration_run_id, imported_at, is_active, retired_at,
-- retired_origin (import | editor), created_at, updated_at. Stillgelegt wird, nie gelöscht. `state` (active | retired | suppressed) bleibt
-- mit `is_active` gleichlaufend. Die Typen, Beziehungen und Quellenverknüpfungen tragen zusätzlich eine laufende `id` (der gemeinsame
-- Abgleich `sync-table.ts` führt jede Tabelle über einen einspaltigen Schlüssel); ihre fachliche Eindeutigkeit steht in einem UNIQUE.
--
-- Längen: Legacys Obergrenzen (Titel 300, Autor 300, Verlag 160, Format 120, Notiz 2.000, Link-Titel 200, Adresse 500, Rohname 300)
-- stehen hier NICHT als CHECK, aus demselben Grund wie in 0065, 0066 und 0068: ein längerer Quelltext hielte den Import an (Betreiber
-- 2026-10-03). Der Import meldet ihn als Befund `text_exceeds_legacy_limit` und speichert ihn unverändert.

-- KARTE ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS citymap (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys UUID. Identität im Import, im zweiten Lauf und für die Medienbindung. Eine Wiki-Karte, die der Legacy-Abgleich löscht und
    -- später neu anlegt, bekommt eine NEUE public_id: für uns Stilllegen plus neue Karte (Befund citymap_recreated).
    public_id UUID NOT NULL,
    legacy_public_id UUID,
    -- Die übergeordnete Karte; nur wenn sie im selben Katalog steht, nie die Karte selbst, nie ein Zyklus (Befund citymap_parent_cycle).
    parent_id BIGINT REFERENCES citymap (id),
    title TEXT NOT NULL,
    art TEXT,
    color_mode TEXT,
    -- Dreiwertig: true, false oder NULL (unbekannt), nie gezwungen.
    is_multilevel BOOLEAN,
    is_labeled BOOLEAN,
    is_official BOOLEAN,
    is_spoiler BOOLEAN,
    has_scale BOOLEAN,
    -- Angaben der Karte, kein Dateimaß (das gemessene Dateimaß entsteht im Media Core).
    width_px INTEGER,
    height_px INTEGER,
    -- Das gedruckte Blattformat („A2“, „43 x 57 cm“): Freitext, nie geparst.
    format TEXT,
    valid_from_bf INTEGER,
    -- 9999 ist in Legacy das offene Ende; verbatim gespeichert, nicht zu NULL umgeschrieben (NULL hieße hier „unbekannt“, nicht „offen“).
    valid_to_bf INTEGER,
    -- Zeichner und Verlag bleiben getrennt: der Verlag wird nie in author gelegt (das wäre eine falsche Zuschreibung).
    author TEXT,
    publisher TEXT,
    -- Verbatim; kann halbstrukturierten Abgleichstext tragen („Format: A4 . Maßstab: Ja“), nie zerlegt (Befund note_semistructured).
    note TEXT,
    -- Der Bauschlüssel „index:stadt-oder-titel:quelle:variante“ des Legacy-Wiki-Abgleichs (E5): KEINE Seitenidentität, nie ein
    -- Fremdschlüssel, nur Information; kein UNIQUE (zwei Karten können ihn teilen, Befund citymap_recreated).
    legacy_wiki_key TEXT,
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
    CONSTRAINT citymap_public_id_unique UNIQUE (public_id),
    CONSTRAINT citymap_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT citymap_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT citymap_art_known CHECK (art IS NULL OR art IN ('politisch', 'derographisch', 'topologisch', 'skizze')),
    CONSTRAINT citymap_color_mode_known CHECK (color_mode IS NULL OR color_mode IN ('graustufen', 'braun', 'farbig')),
    CONSTRAINT citymap_text_not_blank CHECK (
        (format IS NULL OR btrim(format) <> '')
        AND (author IS NULL OR btrim(author) <> '')
        AND (publisher IS NULL OR btrim(publisher) <> '')
        AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_wiki_key IS NULL OR btrim(legacy_wiki_key) <> '')
    ),
    CONSTRAINT citymap_legacy_origin_known CHECK (legacy_origin IN ('manual', 'community', 'wiki', 'unknown')),
    CONSTRAINT citymap_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT citymap_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT citymap_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS citymap_parent ON citymap (parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON TABLE citymap IS
    'Karte der Kartensammlung (D2): Nachschlageeintrag mit Eigenschaften, Typen, Orten, Fundstellen und Quellen; höchstens zwei Bilder (Vollkarte, Vorschau) über citymap_media. Kein Bild-Asset.';
COMMENT ON COLUMN citymap.is_official IS 'Dreiwertig, NULL = unbekannt (nie „nein“). Gilt für is_multilevel, is_labeled, is_spoiler und has_scale ebenso.';
COMMENT ON COLUMN citymap.is_spoiler IS 'NULL ist KEIN Spoiler: nur ein ausdrücklich gesetztes true zählt (Legacy cityMapIsSpoiler).';
COMMENT ON COLUMN citymap.art IS 'politisch | derographisch | topologisch | skizze; die Schreibweise „derographisch“ ist Legacys Schlüssel und bleibt. Ein anderer Wert wird NULL.';
COMMENT ON COLUMN citymap.color_mode IS 'graustufen (Schwarzweiß bzw. Graustufen) | braun (nur von Hand, das Wiki kennt es nicht) | farbig; NULL = unbekannt. „unknown“ wird nie gespeichert.';
COMMENT ON COLUMN citymap.valid_to_bf IS '9999 ist Legacys offenes Ende (keine Jahreszahl für den Leser); wörtlich gespeichert. Der Leser behandelt 9999 als offen.';
COMMENT ON COLUMN citymap.legacy_wiki_key IS 'Bauschlüssel des Legacy-Wiki-Abgleichs (E5): sagt, aus welcher Zeile welcher Wiki-Indexseite die Karte stammt. Keine Seitenidentität, kein Fremdschlüssel.';
COMMENT ON COLUMN citymap.legacy_origin IS 'manual | community | wiki | unknown. Der Schutz gilt der Karte als Ganzes (kein Herkunftsvermerk je Feld). Ohne E5 unknown.';

-- TYPEN UND BEZIEHUNGEN -----------------------------------------------------------------------------------------------------

-- Mehrfachauswahl, 16 feste Schlüssel (Menge, keine Reihenfolge; Legacy liefert sie alphabetisch).
CREATE TABLE IF NOT EXISTS citymap_type (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    type_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT citymap_type_unique UNIQUE (citymap_id, type_key),
    CONSTRAINT citymap_type_key_known CHECK (
        type_key IN (
            'ortsplan', 'stadtplan', 'bezirk', 'viertel', 'lageplan', 'uebersicht', 'schauplatz', 'grundriss', 'befestigungen',
            'dungeon', 'hoehlen', 'krypten', 'katakomben', 'schatzkarte', 'region', 'sonstige'
        )
    ),
    CONSTRAINT citymap_type_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT citymap_type_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT citymap_type_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE citymap_type IS 'Typ einer Karte (16 feste Schlüssel, mehrere je Karte): eine Menge, keine Reihenfolge. Ein anderer Schlüssel wird nicht gespeichert (Befund type_unknown).';

-- Verwandte Karten: das UNSORTIERTE Paar. Legacy speichert beide Richtungen und der Export nennt beide; ein einseitiges Vorkommen ist
-- trotzdem ein Paar (Befund related_asymmetric). Die Kennungen sind die `id`s der Karten (kleinere zuerst).
CREATE TABLE IF NOT EXISTS citymap_related (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    related_citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT citymap_related_unique UNIQUE (citymap_id, related_citymap_id),
    CONSTRAINT citymap_related_ordered CHECK (citymap_id < related_citymap_id),
    CONSTRAINT citymap_related_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT citymap_related_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT citymap_related_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS citymap_related_other ON citymap_related (related_citymap_id);

COMMENT ON TABLE citymap_related IS 'Verwandte Karten als unsortiertes Paar (citymap_id < related_citymap_id). Beide Karten stehen im Katalog; eine unbekannte wird nicht angelegt (Befund citymap_related_unknown).';

-- ORTSBEZUG -----------------------------------------------------------------------------------------------------------------

-- Wie `adventure_place` (0068), ohne Rolle. Eine Wiki-Karte hat genau einen Ort (sort_order 0, Name aus dem Titel der Indexzeile, kann
-- Zusatztext tragen: wörtlich gespeichert, nie bereinigt); manuell angelegte Karten können mehrere haben.
CREATE TABLE IF NOT EXISTS citymap_place (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    sort_order INTEGER NOT NULL,
    export_ordinal INTEGER NOT NULL,
    name_key TEXT NOT NULL,
    dup_ordinal SMALLINT NOT NULL DEFAULT 0,
    raw_name TEXT NOT NULL,
    target_state TEXT NOT NULL,
    resolved_by TEXT,
    place_id BIGINT REFERENCES place (id),
    territory_id BIGINT REFERENCES territory (id),
    region_id BIGINT REFERENCES region (id),
    terrain_peak_id BIGINT REFERENCES terrain_peak (id),
    path_id BIGINT REFERENCES path (id),
    legacy_target_kind TEXT,
    legacy_target_public_id TEXT,
    legacy_target_wiki_key TEXT,
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
    CONSTRAINT citymap_place_key_unique UNIQUE (citymap_id, sort_order, name_key, dup_ordinal),
    CONSTRAINT citymap_place_raw_name_not_blank CHECK (btrim(raw_name) <> '' AND btrim(name_key) <> ''),
    CONSTRAINT citymap_place_ordinals_nonnegative CHECK (export_ordinal >= 0 AND dup_ordinal >= 0),
    CONSTRAINT citymap_place_target_state_known CHECK (target_state IN ('resolved', 'unresolved', 'unmatched')),
    CONSTRAINT citymap_place_resolved_by_known CHECK (resolved_by IS NULL OR resolved_by IN ('public_id', 'wiki_key')),
    CONSTRAINT citymap_place_resolved_by_iff_resolved CHECK ((target_state = 'resolved') = (resolved_by IS NOT NULL)),
    CONSTRAINT citymap_place_one_target_when_resolved CHECK (
        num_nonnulls(place_id, territory_id, region_id, terrain_peak_id, path_id) = CASE WHEN target_state = 'resolved' THEN 1 ELSE 0 END
    ),
    CONSTRAINT citymap_place_legacy_target_not_blank CHECK (
        (legacy_target_kind IS NULL OR btrim(legacy_target_kind) <> '')
        AND (legacy_target_public_id IS NULL OR btrim(legacy_target_public_id) <> '')
        AND (legacy_target_wiki_key IS NULL OR btrim(legacy_target_wiki_key) <> '')
    ),
    CONSTRAINT citymap_place_target_origin_known CHECK (target_origin IN ('legacy_import', 'editor')),
    CONSTRAINT citymap_place_legacy_origin_known CHECK (legacy_origin IN ('manual', 'community', 'wiki', 'unknown')),
    CONSTRAINT citymap_place_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT citymap_place_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT citymap_place_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS citymap_place_place ON citymap_place (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS citymap_place_territory ON citymap_place (territory_id) WHERE territory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS citymap_place_region ON citymap_place (region_id) WHERE region_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS citymap_place_terrain_peak ON citymap_place (terrain_peak_id) WHERE terrain_peak_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS citymap_place_path ON citymap_place (path_id) WHERE path_id IS NOT NULL;

COMMENT ON TABLE citymap_place IS
    'Ortsbezug einer Karte (D2), geordnet nach sort_order, ohne Rolle: typisiertes Ziel wie in adventure_place, ohne Ziel der Rohname mit den Legacy-Angaben.';
COMMENT ON COLUMN citymap_place.target_state IS 'resolved | unresolved | unmatched, wie adventure_place.target_state.';

-- FUNDSTELLEN ---------------------------------------------------------------------------------------------------------------

-- Der KARTEN-LINK (Legacy `map_url`, in der Antwort der erste Link mit key `map`) ist die Zeile `link_role = primary` (höchstens eine
-- aktive je Karte); die weiteren Fundstellen (`link:<n>`, höchstens 2 je Karte [D]) sind `further`. Bei Wiki-Karten zeigt der Karten-Link auf
-- die PUBLIKATION (Wiki-Seite oder Shop), nie auf die Karte selbst: die Anzeige nennt ihn Fundstelle. `is_paid` gehört zum LINK (dreiwertig);
-- `kostenlos` ist die Frage „gibt es einen Link mit is_paid false“, ein unbekanntes is_paid ist weder Beleg für frei noch für bezahlt.
CREATE TABLE IF NOT EXISTS citymap_link (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    link_role TEXT NOT NULL,
    url TEXT NOT NULL,
    label TEXT NOT NULL,
    is_paid BOOLEAN,
    position INTEGER NOT NULL,
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
    CONSTRAINT citymap_link_url_unique UNIQUE (citymap_id, url),
    CONSTRAINT citymap_link_role_known CHECK (link_role IN ('primary', 'further')),
    CONSTRAINT citymap_link_url_http CHECK (url ~* '^https?://'),
    CONSTRAINT citymap_link_label_not_blank CHECK (btrim(label) <> ''),
    CONSTRAINT citymap_link_position_nonnegative CHECK (position >= 0),
    CONSTRAINT citymap_link_legacy_origin_known CHECK (legacy_origin IN ('manual', 'community', 'wiki', 'unknown')),
    CONSTRAINT citymap_link_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT citymap_link_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT citymap_link_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

-- Höchstens EIN aktiver Karten-Link je Karte.
CREATE UNIQUE INDEX IF NOT EXISTS citymap_link_one_active_primary ON citymap_link (citymap_id) WHERE link_role = 'primary' AND state = 'active';

COMMENT ON TABLE citymap_link IS
    'Fundstelle einer Karte: der Karten-Link (primary) und weitere (further), je mit Titel, Adresse und is_paid (dreiwertig). Kein Prüfzustand des Links.';
COMMENT ON COLUMN citymap_link.is_paid IS 'Dreiwertig, NULL = unbekannt. Nur am Link: die Karteneigenschaft is_paid der Antwort ist gleich is_paid des Karten-Links und wird nicht zusätzlich gespeichert.';
COMMENT ON COLUMN citymap_link.label IS 'Das Label „Karte“ des Karten-Links ist, wo Legacys map_url_label leer war, ein serverseitiger Rückfall und wird so übernommen.';

-- QUELLEN -------------------------------------------------------------------------------------------------------------------

-- Wie `place_source` (0066): (Karte, Quelle) eindeutig; Art (reference_kind NULL ist eine ECHTE QUELLE), Seiten, Notiz, Reihenfolge. Je
-- Karte in der Regel EINE Quelle, die Publikation, in der die Karte abgedruckt ist. Nicht vererbt, nichts aggregiert.
CREATE TABLE IF NOT EXISTS citymap_source (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung (E1+: manual, wiki_publication, …); NULL = nicht bekannt.
    legacy_origin TEXT,
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
    CONSTRAINT citymap_source_pair_unique UNIQUE (citymap_id, source_id),
    CONSTRAINT citymap_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT citymap_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT citymap_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT citymap_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT citymap_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_origin IS NULL OR btrim(legacy_origin) <> '')
    ),
    CONSTRAINT citymap_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS citymap_source_source ON citymap_source (source_id);

COMMENT ON TABLE citymap_source IS 'Verknüpfung Karte - Quelle (D1): die Aussage der Karte, mit Art, Seiten, Notiz und Reihenfolge. Wird nicht vererbt; keine Kanon-Tafel je Karte.';
COMMENT ON COLUMN citymap_source.reference_kind IS 'NULL ist eine ECHTE QUELLE; gesetzt ist eine PUBLIKATION (ausfuehrlich | ergaenzend | erwaehnung).';
COMMENT ON COLUMN citymap_source.position IS 'Legacys Anzeigereihenfolge, 0-basiert. Keine Identität.';

-- ZUORDNUNG DES EIGENEN WIKI-ARTIKELS (E5+) ----------------------------------------------------------------------------------

-- Eine redaktionelle Entscheidung wie die Zuordnungen in 0065: `assigned` bei gesetzter Adresse, `separated` bei Legacys `no_article`
-- („bewusst kein Wiki-Artikel“). KEINE Zeile heißt: kein Entscheid, nie dasselbe wie `separated`. Ohne E5+ entsteht keine Zeile (kein Fehler;
-- Legacy zeigt die Zuordnung nur im Editor). Bei `legacy_wiki_publication` ist die Adresse die PUBLIKATIONSSEITE, nicht der Artikel der Karte
-- (die Anzeige gibt sie nie als eigenen Artikel aus). `separated` durch Avesmaps3D-Editoren schreibt kein Import und überschreibt keiner.
CREATE TABLE IF NOT EXISTS citymap_wiki_assignment (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    wiki_url TEXT,
    article_key TEXT,
    article_title TEXT,
    assignment_state TEXT NOT NULL,
    assignment_origin TEXT NOT NULL DEFAULT 'unknown',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT citymap_wiki_assignment_citymap_unique UNIQUE (citymap_id),
    CONSTRAINT citymap_wiki_assignment_state_known CHECK (assignment_state IN ('assigned', 'separated')),
    CONSTRAINT citymap_wiki_assignment_origin_known CHECK (
        assignment_origin IN ('legacy_editor', 'legacy_wiki_publication', 'unknown')
    ),
    -- assigned trägt die Adresse (http oder https), separated keine.
    CONSTRAINT citymap_wiki_assignment_url_iff_assigned CHECK (
        (assignment_state = 'assigned' AND wiki_url IS NOT NULL AND wiki_url ~* '^https?://')
        OR (assignment_state = 'separated' AND wiki_url IS NULL AND article_key IS NULL AND article_title IS NULL)
    ),
    CONSTRAINT citymap_wiki_assignment_text_not_blank CHECK (
        (article_key IS NULL OR btrim(article_key) <> '') AND (article_title IS NULL OR btrim(article_title) <> '')
    ),
    CONSTRAINT citymap_wiki_assignment_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE citymap_wiki_assignment IS
    'Zuordnung des EIGENEN Wiki-Artikels einer Karte (E5+): assigned mit Adresse oder separated (Legacy no_article). Keine Zeile heißt kein Entscheid, nie dasselbe wie separated.';

-- BEZIEHUNG ZU VOLLKARTE UND VORSCHAU ----------------------------------------------------------------------------------------

-- Wie `place_media` (Migration 0064): eine Karte kennt eine Vollkarte (`map_full`, Legacy-Slot map: unverändert gespeichert, bis 12 MB) und
-- eine Vorschau (`map_preview`, Legacy-Slot thumb: WebP, längste Kante 400 px), je höchstens EINE aktive Bindung je Rolle. Keine Reihenfolge.
-- Die Vorschau ist immer ein eigenes Asset mit eigenen Rechten (media.yaml); Vollkarte und Vorschau haben getrennte Rechte. Die Zeilen
-- schreibt der Medienimport (MEDIA-M8), nicht der Fachimport.
CREATE TABLE IF NOT EXISTS citymap_media (
    id BIGSERIAL PRIMARY KEY,
    citymap_id BIGINT NOT NULL REFERENCES citymap (id),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    publication_override TEXT NOT NULL DEFAULT 'none',
    override_decided_on DATE,
    override_operator_quote TEXT,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT citymap_media_unique UNIQUE (citymap_id, media_asset_id, role),
    CONSTRAINT citymap_media_role_known CHECK (role IN ('map_full', 'map_preview')),
    CONSTRAINT citymap_media_origin_known CHECK (origin IN ('legacy', 'wiki_localized', 'editor')),
    CONSTRAINT citymap_media_override_known CHECK (publication_override IN ('none', 'approved', 'blocked')),
    CONSTRAINT citymap_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (override_decided_on IS NOT NULL AND btrim(coalesce(override_operator_quote, '')) <> '')
    )
);

-- Höchstens EINE aktive Bindung je Karte und Rolle; zurückgezogene bleiben als Verlauf stehen.
CREATE UNIQUE INDEX IF NOT EXISTS citymap_media_one_active_per_role ON citymap_media (citymap_id, role) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS citymap_media_asset ON citymap_media (media_asset_id);

COMMENT ON TABLE citymap_media IS
    'Bindung Karte - Asset in den Einzelrollen map_full und map_preview (WI-0063 26.7, media.yaml bindings). thumb_auto_url und thumb_url werden nie Asset. Die Zeilen schreibt der Medienimport; die Freigabe regelt publication_rule (fan_policy für map_preview, G1 = A).';

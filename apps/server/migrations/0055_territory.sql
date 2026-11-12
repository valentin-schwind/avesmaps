-- Die Domäne der Herrschaftsgebiete (WI-0062, ADR-0014, Betreiberentscheidungen F1 bis F10 vom 2026-09-29).
--
-- 🔴 WAHRHEIT sind `territory` (der Baum), `territory_area` (die Quellflächen) und `territory_claim` (umstrittene
-- Gebiete). Bis zum Cutover führt Legacy die Redaktion; der Import ist eine wiederholbare, geprüfte Übersetzung
-- (`source_system = 'legacy'`). Alles andere hier ist ABGELEITET und wird nie importiert und nie von Hand
-- geschrieben: `territory_display_area`, `territory_shape`, `territory_border`, `territory_capital_band`.
-- Eine verwaiste Hülle ist damit nicht mehr möglich - sie entsteht aus den Flächen und stirbt mit ihnen (MCS-022).
--
-- Geometrie liegt im Kartenraum mit SRID 0 (Kapitel 4.13). Die Renderprojektion (3857) steht nur in den
-- abgeleiteten Tabellen, mit Index, wie bei den Anzeigehöhen (ADR-0012).
--
-- 🪤 Martin liest Katalog und Kacheln beim Start: nach dieser Migration Martin neu starten.

-- Legacys Wahrheit: der Baum.
CREATE TABLE IF NOT EXISTS territory (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys `public_id` bleibt die Identität. Verknüpft wird nur darüber, nie über den Namen (Namen sind nicht
    -- eindeutig: „Emirsland Yerkesh“ und „Emirsland Yerkesh (Teilgebiet)“).
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- 0..1 Elter, 0..n Kinder, keine Zyklen (Prüfer). NULL heißt Wurzel, ein eigenständiges Reich.
    parent_id BIGINT REFERENCES territory (id),
    name TEXT NOT NULL,
    short_name TEXT,
    -- Legacy `type` (Baronie, Grafschaft, Königreich …) und `wiki_type` (mit Klammerzusatz), unverändert.
    territory_type TEXT,
    wiki_type TEXT,
    -- Legacy `status`: freier Text („abhängige Provinz“, „eigenständiger Staat“ …), unverändert.
    status_text TEXT,
    color TEXT NOT NULL,
    -- Deckkraft der Fläche (F4: Farbe und Deckkraft je Gebiet aus Legacy; 0,7 bei 1.576, 0,33 bei 79, 0,5 bei 21).
    opacity NUMERIC(3, 2) NOT NULL,
    -- Legacys Zoomband, in Legacy-Zoom (0 bis 6). NULL heißt unbegrenzt; die Karte rechnet um (Band + 1).
    min_zoom SMALLINT,
    max_zoom SMALLINT,
    -- Gültigkeit in BF. 💣 NULL heißt OFFEN; Legacys Sentinel 9999 wird beim Import zu NULL (beides heißt offen).
    valid_from_bf INTEGER,
    valid_to_bf INTEGER,
    valid_label TEXT,
    wiki_key TEXT,
    wiki_url TEXT,
    -- Hauptstadt und Sitz: die UUID des Ortes, OHNE Fremdschlüssel. Legacy heilt hängende Verweise nicht
    -- (Wengenholmer Grafenland zeigt auf den gelöschten Ort Wengenholm), und der Ortsimport läuft in eigenem Takt.
    -- Ein Verweis ins Leere ist ein Befund, kein Fehler.
    capital_place_public_id UUID,
    seat_place_public_id UUID,
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- Wappen: abgelegt, NICHT genutzt (F8, WI-0063 Abschnitt 26.8: erst nach dem Media Core). Der Verweis ist
    -- relativ zur Legacy-Wurzel und trägt einen `?v=`-Cachebuster; ein Wappen unter nicht öffentlicher Lizenz
    -- kommt leer heraus. Der Export unterscheidet „kein Entscheid“ nicht von „ausdrücklich kein Wappen“.
    coat_ref TEXT,
    coat_license_status TEXT,
    coat_origin TEXT,
    -- Legacys Änderungszeit (ohne Zeitzone: so liefert sie der Export).
    legacy_updated_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_public_id_unique UNIQUE (public_id),
    CONSTRAINT territory_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT territory_color_hex CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT territory_opacity_range CHECK (opacity BETWEEN 0 AND 1),
    CONSTRAINT territory_zoom_range CHECK (
        (min_zoom IS NULL OR min_zoom BETWEEN 0 AND 8) AND (max_zoom IS NULL OR max_zoom BETWEEN 0 AND 8)
    ),
    CONSTRAINT territory_zoom_ordered CHECK (min_zoom IS NULL OR max_zoom IS NULL OR min_zoom <= max_zoom),
    CONSTRAINT territory_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS territory_legacy_public_id_unique
    ON territory (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS territory_parent ON territory (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS territory_wiki_key ON territory (wiki_key) WHERE wiki_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS territory_domain_active ON territory (map_domain_id) WHERE is_active;

COMMENT ON TABLE territory IS
    'Herrschaftsgebiet als Knoten eines Baums (WI-0062, ADR-0014). Legacy political_territory. Wahrheit, nicht abgeleitet.';
COMMENT ON COLUMN territory.valid_to_bf IS
    'Ende der Gültigkeit in BF. NULL = offen (Legacy: NULL oder 9999). Das Anzeigejahr steht in der Kartografie, nicht hier.';
COMMENT ON COLUMN territory.capital_place_public_id IS
    'UUID des Ortes, ohne Fremdschlüssel: hängende Verweise sind ein Befund (ADR-0014).';
COMMENT ON COLUMN territory.coat_ref IS
    'Wappenverweis relativ zur Legacy-Wurzel. Abgelegt für MEDIA-4, nie geladen und nie angezeigt (WI-0062 F8).';

-- Die Quellfläche: 0..n je Gebiet, und JEDE gehört genau einem Gebiet (NOT NULL). Eine Fläche ohne Gebiet, die
-- nur in manchen Zoomstufen auftaucht, war Legacys Altlast (MCS-022) und ist hier im Schema unmöglich.
CREATE TABLE IF NOT EXISTS territory_area (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    territory_id BIGINT NOT NULL REFERENCES territory (id),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- 💣 So gespeichert, wie Legacy sie liefert (Parität zur Datei prüfbar). Ausnahme: entartete Ringe fallen beim
    -- Import weg. Ungültiges (Schleifen, Löcher außerhalb) repariert die Ableitung BEIM LESEN.
    geom geometry(MultiPolygon, 0) NOT NULL,
    is_valid BOOLEAN GENERATED ALWAYS AS (ST_IsValid(geom)) STORED,
    valid_from_bf INTEGER,
    valid_to_bf INTEGER,
    -- Ein eigenes Zoomband der Fläche (Legacy `geometry.min_zoom`); wirkt, wenn sie sich selbst zeigt.
    min_zoom SMALLINT,
    max_zoom SMALLINT,
    legacy_updated_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_area_public_id_unique UNIQUE (public_id),
    CONSTRAINT territory_area_zoom_range CHECK (
        (min_zoom IS NULL OR min_zoom BETWEEN 0 AND 8) AND (max_zoom IS NULL OR max_zoom BETWEEN 0 AND 8)
    ),
    CONSTRAINT territory_area_zoom_ordered CHECK (min_zoom IS NULL OR max_zoom IS NULL OR min_zoom <= max_zoom),
    CONSTRAINT territory_area_inside_domain CHECK (map_domain_contains(map_domain_id, geom))
);

CREATE UNIQUE INDEX IF NOT EXISTS territory_area_legacy_public_id_unique
    ON territory_area (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS territory_area_geom_gist ON territory_area USING GIST (geom);
CREATE INDEX IF NOT EXISTS territory_area_territory ON territory_area (territory_id) WHERE is_active;

COMMENT ON TABLE territory_area IS
    'Quellfläche eines Herrschaftsgebiets (Polygon oder MultiPolygon). Wahrheit; territory_id ist NOT NULL (ADR-0014).';
COMMENT ON COLUMN territory_area.geom IS
    'Authoritative Geometrie, SRID 0, unverändert bis auf entartete Ringe. Niemals eine Renderprojektion.';

-- Ungültige Flächen repariert nur die Ableitung, und nur die ungültigen (`method=structure`, wie bei den
-- Landschaftsflächen). Geliefert wird immer eine Fläche (Typ 3), nie eine Sammlung.
CREATE OR REPLACE FUNCTION territory_area_valid(g geometry) RETURNS geometry
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT CASE WHEN ST_IsValid(g) THEN g
                    ELSE ST_CollectionExtract(ST_MakeValid(g, 'method=structure'), 3) END
    $$;

COMMENT ON FUNCTION territory_area_valid(geometry) IS
    'Die Fläche, wie die Ableitung sie liest: gültige unverändert, ungültige mit MakeValid (structure) repariert.';

-- Umstrittene Gebiete (Legacy political_territory_claim): gespeichert, nicht gezeigt (WI-0062).
CREATE TABLE IF NOT EXISTS territory_claim (
    id BIGSERIAL PRIMARY KEY,
    territory_id BIGINT NOT NULL REFERENCES territory (id),
    claimant_id BIGINT NOT NULL REFERENCES territory (id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_claim_pair_unique UNIQUE (territory_id, claimant_id),
    CONSTRAINT territory_claim_source_known CHECK (source IN ('wiki', 'manual')),
    CONSTRAINT territory_claim_not_self CHECK (territory_id <> claimant_id)
);

COMMENT ON TABLE territory_claim IS
    'Anspruch eines Gebiets auf ein umstrittenes anderes (n:m, selbstbezüglich). Gespeichert, nicht gezeigt (WI-0062).';

-- Eine Zeile je Kartendomäne: welcher Quellstand liegt, und welche Ableitung gilt.
CREATE TABLE IF NOT EXISTS territory_state (
    map_domain_id TEXT PRIMARY KEY REFERENCES map_domain (id),
    -- Legacys `territories_revision` (Stempel der Gebietstabellen) und der Inhalts-ETag des Exports.
    source_stamp TEXT,
    source_etag TEXT,
    source_map_revision BIGINT,
    imported_at TIMESTAMPTZ,
    -- Die Revision der Ableitung (zwölf Zeichen), das Jahr, für das sie gilt, und wann. NULL = nichts abgeleitet;
    -- der Import setzt sie auf NULL, sobald er etwas geändert hat (die Ableitung ist dann veraltet).
    derived_revision TEXT,
    derived_year_bf INTEGER,
    derived_at TIMESTAMPTZ,
    CONSTRAINT territory_state_revision_format CHECK (derived_revision IS NULL OR derived_revision ~ '^[0-9a-f]{12}$')
);

COMMENT ON TABLE territory_state IS
    'Quellstempel des letzten Imports und Revision der Ableitung, eine Zeile je Kartendomäne (ADR-0014).';

-- =============================================================================================================
-- ABGELEITET. Niemals Source of Truth. Die Ableitung (derive:territories) schreibt sie in EINER Transaktion.
-- =============================================================================================================

-- Welches Gebiet zeigt eine Fläche in welchem Band? Die eine Stelle, an der „Lücken und Überlappungen“ (F2)
-- sichtbar werden: eine Fläche ohne Zeile in einem Band wird dort nicht gezeigt.
CREATE TABLE IF NOT EXISTS territory_display_area (
    band SMALLINT NOT NULL CHECK (band BETWEEN 0 AND 8),
    area_id BIGINT NOT NULL REFERENCES territory_area (id) ON DELETE CASCADE,
    territory_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE,
    PRIMARY KEY (band, area_id)
);
CREATE INDEX IF NOT EXISTS territory_display_area_territory ON territory_display_area (band, territory_id);

-- Was ein Band von einem Gebiet zeigt: die Vereinigung seiner Flächen, dazu die Ankerstelle des Namens.
CREATE TABLE IF NOT EXISTS territory_shape (
    band SMALLINT NOT NULL CHECK (band BETWEEN 0 AND 8),
    territory_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE,
    -- Der wirksame Elter im Anzeigejahr (ein abgelaufener Elter fällt aus der Kette) und die Tiefe darin.
    parent_id BIGINT REFERENCES territory (id) ON DELETE CASCADE,
    depth SMALLINT NOT NULL CHECK (depth >= 0),
    source_count INTEGER NOT NULL CHECK (source_count > 0),
    area DOUBLE PRECISION NOT NULL,
    geom geometry(MultiPolygon, 0) NOT NULL,
    render_geom geometry(MultiPolygon, 3857) NOT NULL,
    -- Pol der Unzugänglichkeit des größten Teils: hier steht der Name in der Fläche.
    label_geom geometry(Point, 0) NOT NULL,
    PRIMARY KEY (band, territory_id)
);
CREATE INDEX IF NOT EXISTS territory_shape_render_gist ON territory_shape USING GIST (render_geom);

-- Die Grenzlinien: `outer` ist die Hülle eines Vorfahren (oder das Reich selbst), `inner` sind die geteilten Kanten
-- der direkten Kinder eines Elters. `level` ist die Tiefe des Eigners (0 = Reich).
CREATE TABLE IF NOT EXISTS territory_border (
    id BIGSERIAL PRIMARY KEY,
    band SMALLINT NOT NULL CHECK (band BETWEEN 0 AND 8),
    kind TEXT NOT NULL CHECK (kind IN ('outer', 'inner')),
    level SMALLINT NOT NULL CHECK (level >= 0),
    territory_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE,
    geom geometry(MultiLineString, 0) NOT NULL,
    render_geom geometry(MultiLineString, 3857) NOT NULL,
    CONSTRAINT territory_border_owner_unique UNIQUE (band, kind, territory_id)
);
CREATE INDEX IF NOT EXISTS territory_border_render_gist ON territory_border USING GIST (render_geom);
CREATE INDEX IF NOT EXISTS territory_border_band ON territory_border (band);

-- Hauptstädte gezeigter Gebiete: ein Ort, und in welchen Bändern er es ist (Ziffern, sortiert: „0145“).
CREATE TABLE IF NOT EXISTS territory_capital_band (
    place_public_id UUID PRIMARY KEY,
    bands TEXT NOT NULL CHECK (bands ~ '^[0-8]+$')
);

COMMENT ON TABLE territory_display_area IS 'Abgeleitet: welches Gebiet eine Fläche in welchem Band zeigt. Niemals Source of Truth.';
COMMENT ON TABLE territory_shape IS 'Abgeleitet: die Fläche eines Gebiets in einem Band (Vereinigung seiner Flächen). Niemals Source of Truth.';
COMMENT ON TABLE territory_border IS 'Abgeleitet: Außen- und Innengrenzen je Band. Niemals Source of Truth.';
COMMENT ON TABLE territory_capital_band IS 'Abgeleitet: in welchen Bändern ein Ort Hauptstadt eines gezeigten Gebiets ist.';

-- Das Band, das ein Kachelzoom zeigt: Band = z - 1 (Legacy z + 1 = MapLibre z), auf 0 bis 6 begrenzt (Legacy klemmt
-- jede höhere Anfrage auf 6). `packages/shared` rechnet dasselbe (`politicalBandForTileZoom`); ein Test hält beide gleich.
CREATE OR REPLACE FUNCTION territory_band_for_zoom(z integer) RETURNS smallint
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT LEAST(6, GREATEST(0, z - 1))::smallint $$;

-- Kachelquellen für Martin. Die Sichten tragen, was der Stil liest; die Kachelfunktionen wählen das Band aus dem Zoom.
CREATE OR REPLACE VIEW territory_fill_render AS
SELECT
    s.band,
    t.public_id AS territory_public_id,
    t.name,
    t.territory_type,
    p.public_id AS parent_public_id,
    p.name AS parent_name,
    t.color,
    t.opacity::double precision AS opacity,
    t.sort_order,
    s.depth,
    round(s.area::numeric, 2)::double precision AS area,
    s.render_geom AS geom
FROM territory_shape s
JOIN territory t ON t.id = s.territory_id
LEFT JOIN territory p ON p.id = s.parent_id
WHERE t.is_active
ORDER BY s.band, t.public_id;

CREATE OR REPLACE VIEW territory_label_render AS
SELECT
    s.band,
    t.public_id AS territory_public_id,
    t.name,
    t.territory_type,
    t.sort_order,
    s.depth,
    round(s.area::numeric, 2)::double precision AS area,
    map_domain_to_render(t.map_domain_id, s.label_geom)::geometry(Point, 3857) AS geom
FROM territory_shape s
JOIN territory t ON t.id = s.territory_id
WHERE t.is_active
ORDER BY s.band, t.public_id;

CREATE OR REPLACE VIEW territory_border_render AS
SELECT
    b.band,
    b.kind,
    b.level,
    t.public_id AS territory_public_id,
    b.render_geom AS geom
FROM territory_border b
JOIN territory t ON t.id = b.territory_id
WHERE t.is_active
ORDER BY b.band, b.kind, t.public_id;

COMMENT ON VIEW territory_fill_render IS 'Abgeleitete Renderansicht der Gebietsflächen für Martin. Niemals Source of Truth (Kapitel 4.17.4).';
COMMENT ON VIEW territory_label_render IS 'Abgeleitete Namensanker der Gebiete für Martin. Niemals Source of Truth.';
COMMENT ON VIEW territory_border_render IS 'Abgeleitete Grenzlinien der Gebiete für Martin. Niemals Source of Truth.';

-- Füllung und Namen in EINER Kachel: das Band folgt dem Zoom, der Anhang `?rev=` der Adresse (Revision der
-- Ableitung) bricht nur den Cache des Browsers und wird nicht gelesen. Unter Kachelstufe 8 auf einen halben
-- Bildpunkt einer 512er-Kachel vereinfacht, wie die Höhenlinien (ADR-0012).
-- 🔴 Liest nur die `*_render`-Sichten (render-grants.test.ts); die Schichten heißen wie die Sichten.
CREATE OR REPLACE FUNCTION territory_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    wanted smallint := territory_band_for_zoom(z);
    fill bytea;
    labels bytea;
BEGIN
    SELECT ST_AsMVT(source, 'territory_fill_render', 4096, 'geom')
    INTO fill
    FROM (
        SELECT
            f.territory_public_id, f.name, f.territory_type, f.parent_public_id, f.parent_name,
            f.color, f.opacity, f.sort_order, f.depth, f.area,
            ST_AsMVTGeom(ST_Simplify(f.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_fill_render f
        WHERE f.band = wanted AND f.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY f.sort_order, f.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    SELECT ST_AsMVT(source, 'territory_label_render', 4096, 'geom')
    INTO labels
    FROM (
        SELECT
            l.territory_public_id, l.name, l.territory_type, l.sort_order, l.depth, l.area,
            ST_AsMVTGeom(l.geom, envelope, 4096, 64, true) AS geom
        FROM territory_label_render l
        WHERE l.band = wanted AND l.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY l.sort_order, l.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(fill, ''::bytea) || COALESCE(labels, ''::bytea);
END;
$$;

-- Die Linien allein: Standard und Landschaften laden mit dem Schalter „Grenzen“ nur diese Kachel, nicht die Flächen.
CREATE OR REPLACE FUNCTION territory_border_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    wanted smallint := territory_band_for_zoom(z);
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'territory_border_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            b.kind, b.level, b.territory_public_id,
            ST_AsMVTGeom(ST_Simplify(b.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_border_render b
        WHERE b.band = wanted AND b.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY b.kind, b.level, b.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION territory_tile(integer, integer, integer, json) IS
    'Kachel der Gebietsflächen und -namen für das Band des Zooms. Der Anhang ?rev= ist nur ein Cache-Brecher.';
COMMENT ON FUNCTION territory_border_tile(integer, integer, integer, json) IS
    'Kachel der Gebietsgrenzen (außen und innen) für das Band des Zooms.';

-- Die Hauptstädte der gezeigten Gebiete tragen den Ort in der politischen Ansicht, auch wo die Orte sonst aus sind
-- (Legacy `shouldShowLocationMarker`). Die Spalte kommt HINTEN an die Sicht; alles davor bleibt wie in
-- render-definitions.sql (0038 und Nachfolger), abgeschrieben von der aktuellen Definition, nicht von einer alten.
CREATE OR REPLACE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    p.is_ruined,
    p.is_nodix,
    tcb.bands AS capital_bands
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
WHERE p.is_active
ORDER BY p.public_id;

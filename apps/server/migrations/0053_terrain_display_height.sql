-- Anzeigehoehen, Hoehenlinien, Hoehenstufen und Gipfelnamen der Topographie (WI-0055, ADR-0012). Alles hier
-- ausser der Gipfelsicht ist Derived Data aus Gelaende und Relief: ein Verlust kostet einen Lauf von
-- `derive:display-heights`, keinen Import.
--
-- 🔴 Nur Anzeige (Betreiber 2026-09-28: Reisezeiten unberuehrt). Routing, Wegprofile, Steigung,
-- Querfeldein, Flug und das Gelaende (`setTerrain`) lesen diese Tabellen nie; die einzige Hoehe fuer
-- Rechnungen bleibt terrain_raster (Migration 0048).

-- Eine Revision: Hoehenlinien und Hoehenstufen, unter einer Revision unveraenderlich.
CREATE TABLE IF NOT EXISTS terrain_display_height (
    revision TEXT PRIMARY KEY CHECK (revision ~ '^[0-9a-f]{12}$'),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Ueber Generator, Parameter, Linienregeln, Stufen, Gelaende- und Reliefrevision samt Reliefeingaben.
    fingerprint TEXT NOT NULL,
    -- Herkunft, ohne Fremdschluessel: alte Revisionen dort werden aufgeraeumt.
    dem_revision TEXT NOT NULL CHECK (dem_revision ~ '^[0-9a-f]{12}$'),
    relief_revision TEXT NOT NULL CHECK (relief_revision ~ '^[0-9a-f]{12}$'),
    generator_version TEXT NOT NULL,
    params JSONB NOT NULL,
    contours INTEGER NOT NULL,
    contour_points INTEGER NOT NULL,
    band_pieces INTEGER NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS terrain_display_height_one_current
    ON terrain_display_height (map_domain_id) WHERE is_current;

-- Die Hoehenlinien. `render_geom` ist dieselbe Linie in Renderkoordinaten, beim Schreiben einmal
-- gerechnet und indiziert: Martin fragt je Kachel mit dem Kachelrahmen, und eine Sicht, die jede
-- Linie erst umrechnet, koennte keinen Index nutzen (rund 1,3 Mio. Stuetzpunkte). Am geglaetteten Ufer
-- abgeschnitten (terrain_water_smooth unten): Eine Linie, die einen See quert, steht hier in Stuecken.
CREATE TABLE IF NOT EXISTS terrain_contour (
    id BIGSERIAL PRIMARY KEY,
    revision TEXT NOT NULL REFERENCES terrain_display_height (revision) ON DELETE CASCADE,
    ele INTEGER NOT NULL,
    -- 2 Tausender (dick), 1 Fuenfhunderter, 0 Hunderter.
    level SMALLINT NOT NULL CHECK (level IN (0, 1, 2)),
    -- Ein Stueck einer feinen Linie im Gebirge: eigene Kachelquelle, erst aus der Naehe gezeigt.
    detail BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT detail OR level = 0),
    geom geometry(LineString, 0) NOT NULL,
    render_geom geometry(LineString, 3857) NOT NULL
);

CREATE INDEX IF NOT EXISTS terrain_contour_revision ON terrain_contour (revision);
CREATE INDEX IF NOT EXISTS terrain_contour_render_geom ON terrain_contour USING gist (render_geom);

-- Die Hoehenstufen als Flaechen: je Stufe die Flaeche „hoeher als ihre Schwelle“, deren Raender genau die
-- Hoehenlinien sind (Betreiber 2026-09-28: keine „ungenauen farbumfuellungen“). Stufe 0 ist die ganze
-- Karte. In Stuecke geteilt (ST_Subdivide), damit eine Kachel nur ihre Stuecke liest und nie den ganzen
-- Kontinent; die Stuecknaehte liegen unter der Farbe derselben Stufe und sind unsichtbar.
CREATE TABLE IF NOT EXISTS terrain_height_band (
    id BIGSERIAL PRIMARY KEY,
    revision TEXT NOT NULL REFERENCES terrain_display_height (revision) ON DELETE CASCADE,
    -- Index in topography.heightSteps des Designkanons; die Farbe ist colour.mapHeight<step>.
    step SMALLINT NOT NULL CHECK (step >= 0),
    geom geometry(Polygon, 0) NOT NULL,
    render_geom geometry(Polygon, 3857) NOT NULL
);

CREATE INDEX IF NOT EXISTS terrain_height_band_revision ON terrain_height_band (revision);
CREATE INDEX IF NOT EXISTS terrain_height_band_render_geom ON terrain_height_band USING gist (render_geom);

-- Kachelquellen fuer Martin: nur die aktuelle Revision.
CREATE OR REPLACE VIEW terrain_contour_render AS
SELECT
    c.id,
    c.ele,
    c.level,
    c.render_geom AS geom
FROM terrain_contour c
JOIN terrain_display_height h ON h.revision = c.revision AND h.is_current
WHERE NOT c.detail
ORDER BY c.id;

-- Die feinen Linien im Gebirge, eigene Quelle: Die Karte fragt sie erst aus der Naehe ab (Kachelquelle mit
-- minzoom), von weitem traegt keine Kachel ihr Gewicht (Betreiber 2026-09-28: Linien sollen nicht mitten
-- auf dem Talboden enden).
CREATE OR REPLACE VIEW terrain_contour_detail_render AS
SELECT
    c.id,
    c.ele,
    c.level,
    c.render_geom AS geom
FROM terrain_contour c
JOIN terrain_display_height h ON h.revision = c.revision AND h.is_current
WHERE c.detail
ORDER BY c.id;

CREATE OR REPLACE VIEW terrain_height_band_render AS
SELECT
    b.id,
    b.step,
    b.render_geom AS geom
FROM terrain_height_band b
JOIN terrain_display_height h ON h.revision = b.revision AND h.is_current
ORDER BY b.id;

-- Die Kacheln der Hoehenlinien und Hoehenstufen, je Zoom zugeschnitten (Betreiber 2026-09-28: Performance
-- „ohne signifikante qualitaetsverluste“). Gemessen am echten Satz: Eine Linienkachel der Uebersicht trug alle
-- Linien (z3 190 KB), sichtbar sind dort nur die Tausender (8 KB); die Stufenkachel z0 779 KB statt 152 KB.
-- - Nur die Stufen, die die Karte bei diesem Zoom zeigt (topography.contour.minZoom im Designkanon, abgerundet;
--   ein Test haelt beides gleich).
-- - Unter der hoechsten Kachelstufe (8) auf einen halben Bildpunkt einer 512er-Kachel vereinfacht: feiner zeichnet
--   die Karte nicht. Die Kachel 8 bleibt ungeschmaelert, sie wird bis in die naechste Naehe hochgezogen.
-- 🔴 Lesen nur die `*_render`-Sichten (render-grants.test.ts); die Schicht heisst wie die Sicht.
CREATE OR REPLACE FUNCTION terrain_contour_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 1024.0 ELSE 0 END;
    niedrigste smallint := CASE WHEN z < 4 THEN 2 WHEN z < 5 THEN 1 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_contour_render', 4096, 'geom', 'id')
    INTO tile
    FROM (
        SELECT c.id, c.ele, c.level, ST_AsMVTGeom(ST_Simplify(c.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_contour_render c
        WHERE c.level >= niedrigste AND c.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY c.id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

CREATE OR REPLACE FUNCTION terrain_contour_detail_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 1024.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_contour_detail_render', 4096, 'geom', 'id')
    INTO tile
    FROM (
        SELECT c.id, c.ele, c.level, ST_AsMVTGeom(ST_Simplify(c.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_contour_detail_render c
        WHERE c.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY c.id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

-- 🪤 Die Stufen sind in Stuecke geschnitten (ST_Subdivide); deren Schnittkanten sind Geraden, die die
-- Vereinfachung mit beiden Endpunkten stehen laesst: keine Fugen zwischen den Stuecken.
CREATE OR REPLACE FUNCTION terrain_height_band_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 1024.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_height_band_render', 4096, 'geom', 'id')
    INTO tile
    FROM (
        SELECT b.id, b.step, ST_AsMVTGeom(ST_Simplify(b.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_height_band_render b
        WHERE b.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY b.id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

-- Die Gewaesser der Topographie, geglaettet (Betreiber 2026-09-28: „geht das glaetten auch bei meeren und
-- seen?“). Legacys Seen und Meere sind von einem Raster abgezeichnet (Ecken auf 0,125 E) und zeigen im
-- nahen Bild Treppen. Nur Anzeige: region_area bleibt, wie es ist. Die Ableitung schneidet die Hoehenlinien
-- an GENAU dieser Form ab (keine Linie und keine Zahl im Wasser); wer die Glaettung aendert, erhoeht
-- WATER_SMOOTHING in display-height/contours.ts (Test) und leitet neu ab.
CREATE OR REPLACE FUNCTION terrain_water_smooth(geom geometry) RETURNS geometry
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT ST_ChaikinSmoothing(geom, 3) $$;

-- Live, nicht abgeleitet: Rund 450 Flaechen glaetten dauert unter 20 ms, und eine Aenderung am Wasser
-- zeigt sich sofort (die Linien folgen mit der naechsten Ableitung).
CREATE OR REPLACE VIEW terrain_water_render AS
SELECT
    a.public_id,
    r.region_type,
    map_domain_to_render(a.map_domain_id, terrain_water_smooth(a.geom))::geometry(Geometry, 3857) AS geom,
    -- Wie `region_area_render`: Die Kartenauswahl (WI-0043) waehlt einen See oder ein Meer auch hier.
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
FROM region_area a
JOIN region r ON r.id = a.region_id
WHERE a.is_active AND r.is_active AND r.region_type IN ('see', 'meer')
ORDER BY a.public_id;

-- Gipfel und Vulkane als Namen (Betreiber 2026-09-28: mit Dreieck in Standard und Landschaften, in der
-- Topographie mit Hoehenzahl). Nur eine Sicht ueber die Gelaende-Eingabe von WI-0049; die Tabelle bleibt
-- dort. `height` NULL heisst: Legacy kennt keine Hoehe, dann steht keine Zahl an der Karte (WI-0049:
-- lieber keine Zahl als eine erfundene).
CREATE OR REPLACE VIEW terrain_peak_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.height_schritt AS height,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom
FROM terrain_peak p
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON TABLE terrain_display_height IS
    'Anzeigehoehen der ganzen Karte (WI-0055): Hoehenlinien und Hoehenstufen der Topographie. Nur Anzeige, nie Rechengrundlage.';
COMMENT ON TABLE terrain_contour IS
    'Hoehenlinien aus den Anzeigehoehen (WI-0055): 1.000 dick, 500 duenn, 100 fein (im Gebirge erst aus der Naehe).';
COMMENT ON TABLE terrain_height_band IS
    'Hoehenstufen als Flaechen (WI-0055): je Stufe die Flaeche ueber ihrer Schwelle, begrenzt von den Hoehenlinien.';
COMMENT ON VIEW terrain_contour_render IS
    'Hoehenlinien der aktuellen Revision fuer die Kachel (WI-0055).';
COMMENT ON VIEW terrain_contour_detail_render IS
    'Feine Hoehenlinien im Gebirge der aktuellen Revision, erst aus der Naehe (WI-0055).';
COMMENT ON VIEW terrain_height_band_render IS
    'Hoehenstufen der aktuellen Revision fuer die Kachel (WI-0055).';
COMMENT ON VIEW terrain_peak_render IS
    'Gipfel und Vulkane als Kartennamen (WI-0055), aus der Gelaende-Eingabe terrain_peak (WI-0049).';
COMMENT ON FUNCTION terrain_water_smooth(geometry) IS
    'Die Anzeigeform eines Sees oder Meeres (WI-0055): Chaikin, drei Durchgaenge. Nur Anzeige.';
COMMENT ON VIEW terrain_water_render IS
    'Seen und Meere geglaettet fuer die Topographie (WI-0055); die Hoehenlinien enden an dieser Form.';
COMMENT ON FUNCTION terrain_contour_tile(integer, integer, integer) IS
    'Hoehenlinien je Zoom: nur sichtbare Stufen, unter z8 auf einen halben Bildpunkt vereinfacht (WI-0055).';
COMMENT ON FUNCTION terrain_contour_detail_tile(integer, integer, integer) IS
    'Feine Hoehenlinien im Gebirge, unter z8 auf einen halben Bildpunkt vereinfacht (WI-0055).';
COMMENT ON FUNCTION terrain_height_band_tile(integer, integer, integer) IS
    'Hoehenstufen, unter z8 auf einen halben Bildpunkt vereinfacht (WI-0055).';

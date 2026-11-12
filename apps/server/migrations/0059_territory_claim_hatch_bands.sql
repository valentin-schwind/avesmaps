-- Schraffur umstrittener Gebiete und Bänder je Kamerazoom (WI-0062 Nachtrag „Schraffur, Band nach Kameraabstand,
-- Sichtbarkeit, Zoomvorzug“, Betreiber 2026-09-30).
--
-- 🔴 1. DAS BAND HÄNGT NUR AM KAMERAZOOM. Bisher wählte die Kachelfunktion das Band aus dem ZOOM DER KACHEL. Mit Gelände lädt
-- MapLibre in der geneigten Ansicht die fernen Kacheln in niedrigerem Zoom (Level of Detail, gemessen: zwei Stufen darunter,
-- eine darüber), und jede Kachel zeigte ihr eigenes Band: das Bild wurde quer durch zerschnitten, die Grafschaft endete an
-- einer geraden Linie, Grenzen hörten mitten im Bild auf. Jetzt liefert jede Kachel ALLE Bänder, die im Anzeigebereich ihrer
-- Zoomstufe vorkommen können, jede Zeile mit ihrer Bandnummer (`band`); der Stil wählt das eine Band der ganzen Ansicht aus
-- dem Kamerazoom (`politicalBandForCameraZoom`, globaler Zustand `territoryBand`).
--
-- Welche Bänder eine Kachel tragen muss: Eine Kachel im Zoom z erscheint bei einem Kamerazoom von höchstens z + 2 (die
-- fernen Kacheln liegen tiefer als die Kamera) bis mindestens z − 2 (die nahen liegen höher). Das Band der Kamera ist
-- floor(Zoom) − 1 + Vorzug (0 bis 2); nach unten braucht die Kachel also nie ein Band unter z − 3, nach oben immer alle. Die
-- Untergrenze steht in beiden Kachelfunktionen als `GREATEST(0, z - 3)`; `packages/shared` rechnet dasselbe
-- (`politicalTileMinBand`), ein Test hält beide gleich. Die Kachel eines hohen Zooms trägt so nur die feinen Bänder, die
-- Kachel eines niedrigen alle. 🔴 Bewusst KEINE Hilfsfunktion: Ein Aufruf innerhalb einer PL/pgSQL-Kachelfunktion steht nicht
-- in pg_depend, und die Kachelrolle darf ihn auf Stage nicht ausführen (Koordination 2026-09-30, Hotfix 0058).
--
-- 🔴 Damit jede Kachel nicht siebenfach so groß wird, tragen Formen und Linien ihre Geometrie nur EINMAL je Durchlauf gleicher
-- Bänder: Ein Gebiet sieht in benachbarten Bändern oft gleich aus (eine Baronie in den Bändern 4 bis 6, ein Reich in 0 und
-- 1), gemessen 1.013 verschiedene Formen in 3.068 Zeilen und 217 verschiedene Außengrenzen in 674. Die Ableitung trägt je Zeile
-- `run_from` und `run_to` (das erste und letzte Band des Durchlaufs); die Sichten liefern nur die erste Zeile eines
-- Durchlaufs, mit `band` (Beginn) und `band_to` (Ende). Der Stil zeichnet, wo `band ≤ Kartenband ≤ band_to`.
--
-- 🔴 2. DIE SCHRAFFUR. Legacy schraffiert Gebiete mit mehreren Anspruchstellern (`political_territory_claim`) diagonal in den
-- Farben der Parteien und schneidet das Gebiet aus der Füllung heraus (Option A, docs/feature-umstrittene-gebiete.md):
-- Die Streifen liegen über dem Kartenbild, nicht über der Farbe des Reiches. Abgeleitet, nie Wahrheit:
--  - `territory_claim_shape`: je Band und umstrittenem Gebiet die Vereinigung seiner Flächen, die das Band zeigt, und das
--    Gebiet, unter dem sie erscheinen (das Gebiet selbst oder sein Vorfahr);
--  - `territory_shape.fill_render_geom`: die Form OHNE die umstrittenen Flächen (für die Füllung; Grenzen, Namensanker und
--    Auswahl bleiben an der ganzen Form) und `hatched`: die Form ist ganz umstritten, ihre Füllung entfällt, die Fläche
--    bleibt als Ziel des Klicks stehen.
--
-- Additiv: neue Tabelle `territory_claim_shape`, sechs neue Spalten (`run_from`, `run_to` an Form und Linie, `fill_render_geom`
-- und `hatched` an der Form), `territory_fill_render`, `territory_label_render` und `territory_border_render` bekommen ihre neuen
-- Spalten HINTEN, neue Sicht `territory_claim_render`, beide Kachelfunktionen neu. Die Vorlage der Definitionen ist die aktuelle (0055, 0056), nicht
-- eine ältere Fassung. `territory_band_for_zoom` entfällt: nichts wählt mehr ein Band aus einem Kachelzoom (die Funktion
-- hat sonst keinen Aufrufer mehr).
--
-- 🔴 Die Kachelfunktionen tragen `SECURITY DEFINER SET search_path = public, pg_temp` (Hotfix 0058): `CREATE OR REPLACE` ersetzt auch
-- die Attribute, ein Weglassen nähme den Hotfix zurück. Sie rufen keine eigene Hilfsfunktion auf (die Untergrenze der Bänder
-- steht inline) und lesen nur `*_render`-Relationen.
--
-- 🪤 Martin liest Katalog UND Kacheln beim Start: nach dieser Migration und nach `derive:territories` Martin neu starten.

CREATE TABLE IF NOT EXISTS territory_claim_shape (
    band SMALLINT NOT NULL CHECK (band BETWEEN 0 AND 8),
    -- Das umstrittene Gebiet (Träger der Ansprüche) und das Gebiet, unter dem seine Flächen im Band erscheinen.
    territory_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE,
    display_territory_id BIGINT NOT NULL REFERENCES territory (id) ON DELETE CASCADE,
    geom geometry(MultiPolygon, 0) NOT NULL,
    render_geom geometry(MultiPolygon, 3857) NOT NULL,
    PRIMARY KEY (band, territory_id)
);
CREATE INDEX IF NOT EXISTS territory_claim_shape_render_gist ON territory_claim_shape USING GIST (render_geom);
CREATE INDEX IF NOT EXISTS territory_claim_shape_display ON territory_claim_shape (band, display_territory_id);

COMMENT ON TABLE territory_claim_shape IS
    'Abgeleitet: die Schraffurfläche eines umstrittenen Gebiets je Band. Niemals Source of Truth (WI-0062, Betreiber 2026-09-30).';

-- Durchläufe gleicher Zeilen über benachbarte Bänder (siehe oben). NULL = noch nicht abgeleitet: die Sichten nehmen dann die
-- Zeile selbst (Beginn = Ende = Band).
ALTER TABLE territory_shape ADD COLUMN IF NOT EXISTS run_from SMALLINT;
ALTER TABLE territory_shape ADD COLUMN IF NOT EXISTS run_to SMALLINT;
ALTER TABLE territory_border ADD COLUMN IF NOT EXISTS run_from SMALLINT;
ALTER TABLE territory_border ADD COLUMN IF NOT EXISTS run_to SMALLINT;
ALTER TABLE territory_shape ADD COLUMN IF NOT EXISTS fill_render_geom geometry(MultiPolygon, 3857);
ALTER TABLE territory_shape ADD COLUMN IF NOT EXISTS hatched BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN territory_shape.run_from IS
    'Abgeleitet: erstes Band des Durchlaufs gleicher Zeilen, zu dem diese gehört. Die Sicht liefert nur die Zeile mit band = run_from.';
COMMENT ON COLUMN territory_shape.run_to IS 'Abgeleitet: letztes Band des Durchlaufs gleicher Zeilen (siehe run_from).';
COMMENT ON COLUMN territory_border.run_from IS 'Abgeleitet: erstes Band des Durchlaufs gleicher Linien (siehe territory_shape.run_from).';
COMMENT ON COLUMN territory_border.run_to IS 'Abgeleitet: letztes Band des Durchlaufs gleicher Linien.';
COMMENT ON COLUMN territory_shape.fill_render_geom IS
    'Abgeleitet: die Form ohne die schraffierten Flächen, für die Füllung. NULL, wo nichts herausgeschnitten wird.';
COMMENT ON COLUMN territory_shape.hatched IS
    'Abgeleitet: die Form besteht ganz aus umstrittenen Flächen; ihre Füllung entfällt, die Schraffur liegt darauf.';

DROP FUNCTION IF EXISTS territory_band_for_zoom(integer);

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
    COALESCE(s.fill_render_geom, s.render_geom)::geometry(MultiPolygon, 3857) AS geom,
    s.hatched,
    COALESCE(s.run_to, s.band) AS band_to
FROM territory_shape s
JOIN territory t ON t.id = s.territory_id
LEFT JOIN territory p ON p.id = s.parent_id
WHERE t.is_active AND s.band = COALESCE(s.run_from, s.band)
ORDER BY s.band, t.public_id;

COMMENT ON VIEW territory_fill_render IS 'Abgeleitete Renderansicht der Gebietsflächen für Martin. Niemals Source of Truth (Kapitel 4.17.4).';

-- Der Namensanker: nur die erste Zeile eines Durchlaufs (siehe oben).
CREATE OR REPLACE VIEW territory_label_render AS
SELECT
    s.band,
    t.public_id AS territory_public_id,
    t.name,
    t.territory_type,
    t.sort_order,
    s.depth,
    round(s.area::numeric, 2)::double precision AS area,
    map_domain_to_render(t.map_domain_id, s.label_geom)::geometry(Point, 3857) AS geom,
    COALESCE(s.run_to, s.band) AS band_to
FROM territory_shape s
JOIN territory t ON t.id = s.territory_id
WHERE t.is_active AND s.band = COALESCE(s.run_from, s.band)
ORDER BY s.band, t.public_id;

COMMENT ON VIEW territory_label_render IS 'Abgeleitete Namensanker der Gebiete für Martin. Niemals Source of Truth.';

-- Die Grenzlinien: nur die erste Zeile eines Durchlaufs (siehe oben); `label_name` steht nur an den `name`-Linien.
CREATE OR REPLACE VIEW territory_border_render AS
SELECT
    b.band,
    b.kind,
    b.level,
    t.public_id AS territory_public_id,
    b.render_geom AS geom,
    b.label_name,
    COALESCE(b.run_to, b.band) AS band_to
FROM territory_border b
JOIN territory t ON t.id = b.territory_id
WHERE t.is_active AND b.band = COALESCE(b.run_from, b.band)
ORDER BY b.band, b.kind, t.public_id;

COMMENT ON VIEW territory_border_render IS 'Abgeleitete Grenzlinien der Gebiete für Martin. Niemals Source of Truth.';

-- Die Schraffurflächen: Name und Obergebiet sind die des Gebiets, unter dem die Fläche im Band erscheint (ein Klick wählt
-- dieses Gebiet, wie die Füllung daneben), `pattern` benennt das Muster (Band und Farben der Parteien: das umstrittene
-- Gebiet zuerst, dann die Anspruchsteller nach `sort_order`, wie Legacy `avesmapsPoliticalAttachContestedParties`).
CREATE OR REPLACE VIEW territory_claim_render AS
SELECT
    cs.band,
    d.public_id AS territory_public_id,
    d.name,
    d.territory_type,
    p.public_id AS parent_public_id,
    p.name AS parent_name,
    round(sh.area::numeric, 2)::double precision AS area,
    x.public_id AS claimed_public_id,
    ('claim-' || cs.band::text || '-' || stripes.colors) AS pattern,
    cs.render_geom AS geom
FROM territory_claim_shape cs
JOIN territory x ON x.id = cs.territory_id AND x.is_active
JOIN territory d ON d.id = cs.display_territory_id AND d.is_active
JOIN territory_shape sh ON sh.band = cs.band AND sh.territory_id = cs.display_territory_id
LEFT JOIN territory p ON p.id = sh.parent_id
CROSS JOIN LATERAL (
    SELECT lower(replace(x.color, '#', '')) || COALESCE(
               '-' || string_agg(lower(replace(c.color, '#', '')), '-' ORDER BY tc.sort_order, tc.id), ''
           ) AS colors
    FROM territory_claim tc
    JOIN territory c ON c.id = tc.claimant_id AND c.is_active
    WHERE tc.territory_id = x.id AND tc.is_active
) stripes
ORDER BY cs.band, x.public_id;

COMMENT ON VIEW territory_claim_render IS 'Abgeleitete Schraffurflächen umstrittener Gebiete für Martin. Niemals Source of Truth.';

-- Füllung, Namen und Schraffur in EINER Kachel. Jede Zeile trägt ihre Bandnummer; die Kachel liefert alle Bänder ab
-- Zoom − 3, der Stil wählt das Band der Kamera (Betreiber 2026-09-30). Der Anhang `?rev=` der Adresse
-- (Revision der Ableitung) bricht nur den Cache des Browsers und wird nicht gelesen. Unter Kachelstufe 8 auf einen halben
-- Bildpunkt einer 512er-Kachel vereinfacht, wie die Höhenlinien (ADR-0012).
-- 🔴 Liest nur die `*_render`-Sichten (render-grants.test.ts); die Schichten heißen wie die Sichten.
CREATE OR REPLACE FUNCTION territory_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    -- Die niedrigste Bandnummer, die eine Kachel dieses Zooms tragen muss (siehe oben); nach oben trägt jede Kachel alle Bänder.
    lowest smallint := GREATEST(0, z - 3);
    fill bytea;
    labels bytea;
    claims bytea;
BEGIN
    SELECT ST_AsMVT(source, 'territory_fill_render', 4096, 'geom')
    INTO fill
    FROM (
        SELECT
            f.band, f.band_to, f.territory_public_id, f.name, f.territory_type, f.parent_public_id, f.parent_name,
            f.color, f.sort_order, f.depth, f.area, f.hatched,
            ST_AsMVTGeom(ST_Simplify(f.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_fill_render f
        WHERE f.band_to >= lowest AND f.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY f.band, f.sort_order, f.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    SELECT ST_AsMVT(source, 'territory_label_render', 4096, 'geom')
    INTO labels
    FROM (
        SELECT
            l.band, l.band_to, l.territory_public_id, l.name, l.territory_type, l.sort_order, l.depth, l.area,
            ST_AsMVTGeom(l.geom, envelope, 4096, 64, true) AS geom
        FROM territory_label_render l
        WHERE l.band_to >= lowest AND l.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY l.band, l.sort_order, l.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    SELECT ST_AsMVT(source, 'territory_claim_render', 4096, 'geom')
    INTO claims
    FROM (
        SELECT
            c.band, c.territory_public_id, c.name, c.territory_type, c.parent_public_id, c.parent_name, c.area,
            c.claimed_public_id, c.pattern,
            ST_AsMVTGeom(ST_Simplify(c.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_claim_render c
        WHERE c.band >= lowest AND c.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY c.band, c.claimed_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(fill, ''::bytea) || COALESCE(labels, ''::bytea) || COALESCE(claims, ''::bytea);
END;
$$;

-- Die Linien allein: Standard und Landschaften laden mit dem Schalter „Grenzen“ nur diese Kachel, nicht die Flächen. Auch
-- sie trägt alle Bänder ab Zoom − 3, jede Linie mit ihrer Bandnummer.
CREATE OR REPLACE FUNCTION territory_border_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    -- Die niedrigste Bandnummer, die eine Kachel dieses Zooms tragen muss (siehe oben); nach oben trägt jede Kachel alle Bänder.
    lowest smallint := GREATEST(0, z - 3);
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'territory_border_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            b.band, b.band_to, b.kind, b.level, b.territory_public_id, b.label_name,
            ST_AsMVTGeom(ST_Simplify(b.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_border_render b
        WHERE b.band_to >= lowest AND b.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY b.band, b.kind, b.level, b.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION territory_tile(integer, integer, integer, json) IS
    'Kachel der Gebietsflächen, -namen und Schraffuren: alle Bänder ab Zoom − 3, jede Zeile mit ihrem Band. Der Anhang ?rev= ist nur ein Cache-Brecher.';
COMMENT ON FUNCTION territory_border_tile(integer, integer, integer, json) IS
    'Kachel der Gebietsgrenzen (außen, innen und die Pfade der Namen): alle Bänder ab Zoom − 3, jede Linie mit ihrem Band.';

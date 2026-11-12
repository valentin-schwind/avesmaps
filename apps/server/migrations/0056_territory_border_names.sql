-- Die Gebietsnamen ENTLANG der Außengrenzen (WI-0062 Nachtrag, Betreiber 2026-09-29: „die aussengrenzen von grafschaften
-- und darüber sind in legacy beschriftet, kannst du das nachziehen?“). Legacy setzt den Namen einer Hülle als Schrift
-- auf ihre Außenkontur (`drawTerritoryBorderLabels`, boundary-canvas-overlay.js); die Karte braucht dafür den Umriss
-- des größten Teils der Hülle, ausgerichtet, und den Namen dazu.
--
-- 🔴 ABGELEITET, nie Wahrheit. Die Zeilen der neuen Grenzart `name` schreibt allein die Ableitung
-- (`npm run derive:territories`), aus den Hüllen und der Tafel `config/map-cartography/aventuria-political.json`
-- (`borderName`: ab welchem Band, welche Namen ausgenommen sind, wie viele Stützpunkte mindestens). Gezeichnet wird die
-- Linie nie - sie ist der Pfad, auf dem MapLibre den Namen setzt.
--
-- Additiv:
--  - `territory_border.kind` erlaubt zusätzlich `name`,
--  - `territory_border.label_name` trägt den Namen (nur bei `name`),
--  - `territory_border_render` bekommt `label_name` HINTEN (CREATE OR REPLACE VIEW erlaubt neue Spalten nur am Ende),
--  - `territory_border_tile` liefert die Spalte mit.
-- Die Vorlage beider Definitionen ist die aktuelle aus 0055, nicht eine ältere Fassung.
--
-- 🪤 Martin liest Katalog UND Kacheln beim Start: nach dieser Migration und nach `derive:territories` Martin neu starten.

ALTER TABLE territory_border DROP CONSTRAINT IF EXISTS territory_border_kind_check;
ALTER TABLE territory_border ADD CONSTRAINT territory_border_kind_check CHECK (kind IN ('outer', 'inner', 'name'));
ALTER TABLE territory_border ADD COLUMN IF NOT EXISTS label_name TEXT;
ALTER TABLE territory_border DROP CONSTRAINT IF EXISTS territory_border_label_name_check;
ALTER TABLE territory_border ADD CONSTRAINT territory_border_label_name_check
    CHECK ((kind = 'name') = (label_name IS NOT NULL));

COMMENT ON COLUMN territory_border.label_name IS
    'Abgeleitet: der Name, der entlang dieser Linie steht (nur kind = name). Niemals Source of Truth.';

CREATE OR REPLACE VIEW territory_border_render AS
SELECT
    b.band,
    b.kind,
    b.level,
    t.public_id AS territory_public_id,
    b.render_geom AS geom,
    b.label_name
FROM territory_border b
JOIN territory t ON t.id = b.territory_id
WHERE t.is_active
ORDER BY b.band, b.kind, t.public_id;

COMMENT ON VIEW territory_border_render IS 'Abgeleitete Grenzlinien der Gebiete für Martin. Niemals Source of Truth.';

-- Die Linien allein: Standard und Landschaften laden mit dem Schalter „Grenzen“ nur diese Kachel, nicht die Flächen.
-- `label_name` steht nur an den `name`-Linien.
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
            b.kind, b.level, b.territory_public_id, b.label_name,
            ST_AsMVTGeom(ST_Simplify(b.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_border_render b
        WHERE b.band = wanted AND b.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY b.kind, b.level, b.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION territory_border_tile(integer, integer, integer, json) IS
    'Kachel der Gebietsgrenzen (außen, innen und die Pfade der Namen) für das Band des Zooms.';

-- Die Kraftlinien (WI-0025, Contract project-control/migration/contracts/powerlines.yaml).
-- Betreiberfreigabe 2026-09-23, woertlich "kraftlinien uebernehmen, freigegeben": die 174 Linien aus
-- Snapshot 140088 in die LOKALE Entwicklungsdatenbank. Stage und Production brauchen je eine eigene.
--
-- Eine Kraftlinie ist in Legacy eine Zeile in map_features (feature_type = 'powerline'): eine Strecke
-- von Knoten A nach Knoten B, dazu ein Name, der Segmente zu einer Linie bindet, und ein Bogen.
-- Geometrie liegt im Kartenraum mit SRID 0, wie bei Orten, Regionen und Wegen (Kapitel 4.13).
--
-- 🔴 ZWEI GEOMETRIEN, UND NUR EINE DAVON IST DATEN.
--   geom        Legacys gespeicherte Linie, unveraendert uebernommen. Sie ist in Legacy nur noch der
--               Rueckfall: gezeichnet wird von den KNOTEN aus (getPowerlineLatLngs), und 64 der 334
--               aufloesbaren Enden liegen heute bis 55 Einheiten neben ihrem Knoten. Befund, keine
--               Korrektur (Cutoff-Regel).
--   drawn_geom  Die Bahn, die die Karte zeichnet: von den Knoten aus, sonst von geom, mit Legacys Bogen
--               (Parabel, powerline-curve.ts). ABGELEITET, bei jedem Import neu gerechnet, nie redigiert.

CREATE TABLE IF NOT EXISTS powerline (
    id BIGSERIAL PRIMARY KEY,
    -- Legacy-UUID bleibt die oeffentliche Identitaet. Im Snapshot 174 von 174, eindeutig.
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Der Name bindet in Legacy die Segmente einer Linie ("Basiliuslinie" = 16 Zeilen). Ein leerer Name
    -- ist dort erlaubt und bildet bewusst KEINE Gruppe; im Bestand kommt er nicht vor.
    name TEXT NOT NULL,
    -- Wie bei den Wegen: ein fehlender Wert heisst AUS. Legacy liest ihn auf beiden Seiten so
    -- (Server `(bool) ($properties['show_label'] ?? false)`, Client nur ein ausdruecklicher Wahrheitswert).
    label_visible BOOLEAN NOT NULL DEFAULT FALSE,
    -- Die fachliche Aussage: von welchem Knoten zu welchem. Ein Knoten ist ein Ort ODER eine Kreuzung,
    -- deshalb kein Fremdschluessel - und 6 Knoten (14 Verweise) fehlen im Snapshot ganz.
    from_public_id UUID NOT NULL,
    to_public_id UUID NOT NULL,
    -- Der Bogen in Prozent der Sehne. NULL heisst "nicht gespeichert" und zeichnet gerade, wie eine 0;
    -- beides bleibt unterscheidbar, weil Legacy beides fuehrt (161 ohne, 11 mit 0, 2 gebogen).
    -- Unveraendert gespeichert; geklemmt auf +-45 wird beim Zeichnen, wie in Legacy.
    curve DOUBLE PRECISION,
    geom geometry(LineString, 0) NOT NULL,
    drawn_geom geometry(LineString, 0) NOT NULL,

    source_system TEXT NOT NULL,
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS powerline_public_id_key ON powerline (public_id);

COMMENT ON TABLE powerline IS
    'Kraftlinien (WI-0025). Eine Zeile ist ein Segment von Knoten zu Knoten; die "ganze Linie" bindet Legacy ueber den Namen. Kein Editor, keine Topologie, keine Wiki-Daten in diesem Schritt.';
COMMENT ON COLUMN powerline.geom IS
    'Legacys gespeicherte Linie, unveraendert. In Legacy nur der Rueckfall, wenn ein Knoten fehlt - gezeichnet wird drawn_geom.';
COMMENT ON COLUMN powerline.drawn_geom IS
    'ABGELEITET: die gezeichnete Bahn, von den Knoten aus (sonst von geom), mit Legacys Bogen. Bei jedem Import neu gerechnet, nie redaktionell bearbeitet.';
COMMENT ON COLUMN powerline.curve IS
    'Bogen in Prozent der Sehne, wie in Legacy gespeichert (NULL = nicht gespeichert = gerade). Beim Zeichnen auf +-45 geklemmt.';

-- Die Renderrelation. Feste Zeilenreihenfolge seit Migration 0016: `public_id` ist ein Tie-Breaker
-- fuer gleiche Kachelbytes und sagt NICHTS ueber fachliche Wichtigkeit.
CREATE OR REPLACE VIEW powerline_render AS
SELECT
    p.public_id,
    p.name,
    p.label_visible,
    map_domain_to_render(p.map_domain_id, p.drawn_geom)::geometry(LineString, 3857) AS geom
FROM powerline p
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW powerline_render IS
    'Kraftlinien fuer die Kachel: die gezeichnete Bahn (drawn_geom). Feste Reihenfolge nach public_id (0016).';

-- Die Namen der Kraftlinien, UNBESCHNITTEN.
--
-- 💣 Eine Sicht liefert Martin beschnitten an jede Kachel, und MapLibre setzt einen Namen mit
-- `line-center` in die Mitte des STUECKS, das es bekommt - an jeder Kachelgrenze stuende er dann
-- doppelt und nie in der Mitte der Linie. Deshalb dieselbe Bauform wie die Schriftlaeufe (ADR-0007):
-- die ganze Linie, `clip_geom => false`, und nur in Kacheln nahe ihrer Mitte. MapLibre setzt den Anker
-- nur in der Kachel, in der er liegt; die Nachbarn verwerfen ihn.
--
-- 🔴 Liest nur `powerline_render` - die Kachelrolle sieht nur `*_render` (render-grants.test.ts).
CREATE OR REPLACE FUNCTION powerline_label_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    -- Ein Achtel Kachel Rand: eine Mitte genau auf der Kachelgrenze faellt sonst je nach Rundung in
    -- keine der beiden. Doppelt ist harmlos, fehlend nicht.
    rand double precision := (ST_XMax(envelope) - ST_XMin(envelope)) / 8.0;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'powerline_label' ORDER BY source.public_id)
    INTO tile
    FROM (
        SELECT
            line.public_id,
            line.name,
            ST_AsMVTGeom(line.geom, envelope, 4096, 4096, false) AS geom
        FROM powerline_render line
        WHERE line.label_visible
          AND line.name <> ''
          AND ST_Intersects(ST_LineInterpolatePoint(line.geom, 0.5), ST_Expand(envelope, rand))
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION powerline_label_tile(integer, integer, integer) IS
    'Namen der Kraftlinien, unbeschnitten, nur in Kacheln nahe der Linienmitte (MapLibre line-center). WI-0025.';

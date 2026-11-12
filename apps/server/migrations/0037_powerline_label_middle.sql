-- Die Namen der Kraftlinien: nur das Mittelstueck der Linie ausliefern (WI-0025, Nachtrag zu 0036).
--
-- 💣 Befund aus dem Browsertest, nicht aus einer Ueberlegung: nah dran fehlte der Name einer langen
-- Linie ("Runenpfad der Hjaldinger", 334 Einheiten) - bei z7,2 gar kein Name mehr. MapLibre klemmt beim
-- Laden jede Koordinate, die mehr als vier Kachelbreiten vor dem Kachelrand liegt ("Geometry exceeds
-- allowed extent, reduce your vector tile buffer size"), und zwar JE PUNKT: eine unbeschnittene Linie
-- ueber die halbe Karte verliert dabei Richtung und Mitte, der Anker von `line-center` rutscht aus der
-- Kachel, und der Name faellt weg.
--
-- ⭐ Dieselbe Loesung wie bei den Schriftlaeufen (ADR-0007): nur das Stueck ausliefern, das der Name
-- braucht. Hier anderthalb Kachelbreiten je Seite der Mitte - laenger als jeder Kraftliniename
-- (18 px, einige hundert Pixel gegen 512 je Kachel), und kurz genug, dass kein Punkt geklemmt wird
-- (die Mitte liegt hoechstens 1/8 Kachel ausserhalb, also bleibt alles innerhalb von 2,7 Kachelbreiten).
-- Geschnitten wird nach LAENGE, symmetrisch um die Mitte: die Mitte des Stuecks ist die Mitte der Linie,
-- auch auf einem Bogen. Eine Linie, die kuerzer ist, bleibt ganz - und faellt weiterhin weg, wenn ihr
-- Name nicht darauf passt, wie in Legacy.
CREATE OR REPLACE FUNCTION powerline_label_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    kachel double precision := ST_XMax(envelope) - ST_XMin(envelope);
    -- Ein Achtel Kachel Rand: eine Mitte genau auf der Kachelgrenze faellt sonst je nach Rundung in
    -- keine der beiden. Doppelt ist harmlos, fehlend nicht.
    rand double precision := kachel / 8.0;
    halb double precision := kachel * 1.5;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'powerline_label' ORDER BY source.public_id)
    INTO tile
    FROM (
        SELECT
            line.public_id,
            line.name,
            ST_AsMVTGeom(ST_LineSubstring(line.geom, 0.5 - anteil.h, 0.5 + anteil.h), envelope, 4096, 4096, false)
                AS geom
        FROM powerline_render line
        -- LEAST uebergeht NULL: eine Linie der Laenge 0 bleibt ganz (0,5 je Seite).
        CROSS JOIN LATERAL (SELECT LEAST(0.5, halb / NULLIF(ST_Length(line.geom), 0)) AS h) anteil
        WHERE line.label_visible
          AND line.name <> ''
          AND ST_Intersects(ST_LineInterpolatePoint(line.geom, 0.5), ST_Expand(envelope, rand))
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION powerline_label_tile(integer, integer, integer) IS
    'Namen der Kraftlinien: das Mittelstueck (je Seite 1,5 Kachelbreiten), unbeschnitten, nur in Kacheln nahe der Linienmitte (MapLibre line-center). WI-0025, 0037.';

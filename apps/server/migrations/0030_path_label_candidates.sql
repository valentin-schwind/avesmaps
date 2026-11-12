-- Wegnamen duerfen an ihrer Linie ausweichen (Betreiberentscheidung 2026-09-23: „wie bei Avesmaps").
--
-- Legacy laesst einen Wegnamen bis 160 px entlang seiner Linie rutschen, bis die Stelle frei ist.
-- MapLibre kennt fuer Linienbeschriftungen keine Ausweichstellen: line-center setzt den Namen in
-- die Mitte, und ist sie belegt, entfaellt er. Gemessen: auf Band 4 ueber Gareth verloren so ALLE
-- Wegnamen gegen Orts- und Landschaftsnamen, waehrend Legacy dort Reichsstrasse 2, Rakula und Warna
-- zeigt.
--
-- ⭐ Die Kachel liefert deshalb je Lauf bis zu FUENF Kandidaten: die Mitte (candidate 0), dann
-- je 1/8 und 1/4 der Namenslaenge vor und zurueck. Der Stil sortiert nach candidate, die Mitte wird
-- also zuerst versucht. Weil sich die Kandidaten GEGENSEITIG ueberdecken, steht hoechstens einer.
--
-- 💣 DIE GRENZE 1/4 IST HART. Kandidaten werden auf der ganzen Stufe z geschnitten und bis z + 0,99
-- gezeichnet; dort ist der Name auf der Karte nur noch halb so lang wie beim Schneiden. Zwei
-- Kandidaten, deren Mitten mehr als eine halbe Namenslaenge auseinanderliegen, ueberdecken sich dann
-- NICHT mehr - und derselbe Name stuende zweimal. +-1/4 je Richtung ist genau die halbe Laenge.
-- Die Ableitung (SLIDE_SHARE, path-runs.ts) verlaengert jeden Lauf um genau diesen Raum.
--
-- 🪤 Ein verschobener Kandidat wird NUR geliefert, wenn er ganz auf dem Lauf liegt. Die Mitte wird
-- wie bisher notfalls auf den Lauf gekappt - sie ist das Versprechen der Ableitung.
--
-- CREATE OR REPLACE FUNCTION behaelt das EXECUTE-Recht der Kachelrolle; die Signatur bleibt.

CREATE OR REPLACE FUNCTION path_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    SELECT ST_AsMVT(
               source,
               'path_label_run'
               ORDER BY source.name, source.subtype, source.part, source.instance, source.candidate
           )
    INTO tile
    FROM (
        SELECT
            run.name,
            run.subtype,
            run.part,
            run.instance,
            run.instance_count,
            run.collision_rank,
            kandidat.ordnung AS candidate,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM path_label_run_render run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd.
        CROSS JOIN LATERAL (
            VALUES (0, 0.0), (1, 0.125), (2, -0.125), (3, 0.25), (4, -0.25)
        ) AS kandidat(ordnung, versatz)
        CROSS JOIN LATERAL (
            SELECT 0.5 + kandidat.versatz * need.target / need.laenge AS mitte,
                   (need.target / 2.0) / need.laenge AS halb
        ) lage
        CROSS JOIN LATERAL (
            SELECT GREATEST(0.0, lage.mitte - lage.halb) AS lo,
                   LEAST(1.0, lage.mitte + lage.halb) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND (
                kandidat.ordnung = 0
                OR (lage.mitte - lage.halb >= 0.0 AND lage.mitte + lage.halb <= 1.0)
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION path_label_run_tile(integer, integer, integer) IS
    'Wegnamen-Schriftlaeufe je Zoom zugeschnitten, unbeschnitten ausgeliefert, mit bis zu fuenf sich ueberdeckenden Ausweichkandidaten je Lauf (0030, candidate 0 = Mitte). Liest die SICHT path_label_run_render, nicht die Tabelle - die Funktion laeuft mit den Rechten des Aufrufers (0025).';

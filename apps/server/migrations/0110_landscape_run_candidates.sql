-- Kurvennamen duerfen an ihrem Lauf ausweichen (Betreiber 2026-10-11: „A, ueberlappungen sind einfach scheisse. kannst du nicht
-- versuchen etwas auszuweichen, wenn du schon laengere laeufe baust?“).
--
-- Gemessen am Satz 179380: Sieben Kurvennamen fehlten auf ihrer Stufe, weil ein hoeher eingestufter Name die Mitte ihres Laufs
-- belegte (Dairuchsee z5 gegen Blutzinnen, Schwarzberger Forst z5 gegen den Gipfel Schroffenstein, ...). Ein Ueberlappen wie in
-- Legacy hat der Betreiber abgelehnt. Die Ableitung kennt die Kaesten der anderen Namen nicht (Ortsnamen waehlen ihre Seite im
-- Browser), also entscheidet MapLibre: wie bei den Wegnamen (0030).
--
-- ⭐ Die Kachel liefert je EINZELLAUF bis zu FUENF Kandidaten: die Mitte (candidate 0), dann je 1/8 und 1/4 der Namenslaenge vor und
-- zurueck. Der Stil sortiert innerhalb eines Rangs nach candidate, die Mitte wird also zuerst versucht. Weil sich die Kandidaten
-- GEGENSEITIG ueberdecken, steht hoechstens einer. Den Platz dafuer legt die Ableitung an (ALGORITHM_VERSION 7, `ausweichLauf`):
-- ein Viertel der Namenslaenge an beiden Enden, entlang der Sehne.
--
-- 💣 DIE GRENZE 1/4 IST HART, wie in 0030: Kandidaten werden auf der ganzen Stufe z geschnitten und bis z + 0,99 gezeichnet; liegen
-- ihre Mitten mehr als eine halbe Namenslaenge auseinander, ueberdecken sie sich dort nicht mehr, und derselbe Name stuende zweimal.
--
-- 🪤 Ein Satz mit MEHREREN Instanzen weicht nicht aus: Seine Luecke ist kleiner als zwei Ausweichraeume, und die Kandidaten zweier
-- Instanzen verdraengten sich gegenseitig. Er liefert wie bisher nur die Mitte.
--
-- 🪤 Ein verschobener Kandidat wird NUR geliefert, wenn er ganz auf dem Lauf liegt. Die Mitte wird wie bisher notfalls auf den Lauf
-- gekappt. Deshalb ertraegt die Funktion das vorige Release: Laeufe vor ALGORITHM_VERSION 7 haben keinen Ausweichraum und liefern
-- nur die Mitte, genau wie vor dieser Migration. Und ein Stil ohne `candidate` sieht hoechstens Kandidaten, die sich gegenseitig
-- verdraengen; die Reihenfolge im Aggregat stellt die Mitte zuerst.
--
-- Nur hinzugefuegt: die Eigenschaft `candidate`. Signatur und alle bisherigen Eigenschaften bleiben. CREATE OR REPLACE FUNCTION
-- behaelt das EXECUTE-Recht der Kachelrolle.
CREATE OR REPLACE FUNCTION landscape_label_run_tile(z integer, x integer, y integer)
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
    -- Die Sortierung steht im Aggregat (render-order.test.ts): erst die Mitte je Lauf.
    SELECT ST_AsMVT(source, 'landscape_label_run' ORDER BY source.region_public_id, source.instance_count, source.instance, source.candidate)
    INTO tile
    FROM (
        SELECT
            run.run_id,
            run.region_public_id,
            run.name,
            run.region_layer,
            run.region_type,
            run.label_type,
            run.label_size,
            run.label_priority,
            run.collision_rank,
            run.instance,
            run.instance_count,
            kandidat.ordnung AS candidate,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM landscape_label_run_render run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd (wie 0030).
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
                OR (
                    run.instance_count = 1
                    AND lage.mitte - lage.halb >= 0.0
                    AND lage.mitte + lage.halb <= 1.0
                )
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION landscape_label_run_tile(integer, integer, integer) IS
    'Kurvennamen-Schriftlaeufe je Zoom zugeschnitten, unbeschnitten ausgeliefert, je Einzellauf mit bis zu fuenf sich ueberdeckenden Ausweichkandidaten (0110, candidate 0 = Mitte; Muster 0030). Liest die SICHT landscape_label_run_render, nicht die Tabelle.';

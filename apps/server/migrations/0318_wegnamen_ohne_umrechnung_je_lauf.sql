-- 0318: Die Wegnamen-Kachel rechnet nur noch die Läufe um, die sie zeichnet (WI-0283 K2; Claudio 2026-11-06: `path_label_run_tile` 876.000 Aufrufe und
-- 53.336 s in acht Tagen Production, die zweitgrößte Kachelfunktion nach `path_tile`).
--
-- Dieselbe Ursache wie in 0315, gemessen auf der Entwicklungsdatenbank: `path_label_run_render` rechnet `map_domain_to_render` in seiner Spalte `geom`
-- und schlägt je Zeile das Kennzeichen der Kette nach, beides für jeden Lauf des Zoombands, auch für die, die weit neben der Kachel liegen. Zoom 8: 74 ms.
-- Mit dieser Fassung 6 ms, Zoom 7 von 51 auf 5 ms, und 1.614 Kacheln bytegleich zum alten Weg.
--
-- Der GiST-Index hilft hier nicht: Ob ein Lauf in die Kachel gehört, entscheidet seine MITTE gegen die Kachel, erweitert um seine halbe Länge. Sein Kasten muss
-- die Kachel also gar nicht berühren, und ein Filter auf den Kasten ließe Namen aus. Darum filtert die Funktion dieselbe Bedingung in Kartenkoordinaten, ein
-- wenig großzügiger (Rand 1e-6, kleinster Maßstab aller Domänen), rechnet die Treffer um und prüft sie danach mit der unveränderten alten Bedingung.
--
-- 🔴 Kachelvertrag unverändert (`render-grants.test.ts`): Die Funktion liest nur `*_render`, ruft keine eigene Funktion und läuft als Aufrufer. Die Kachelrolle
-- bekommt SELECT auf die neue Sicht von `avesmaps3d-db-grants`; `migrate` und `db-grants` laufen unmittelbar hintereinander (`docs/regeln/entwicklung.md`).
-- `domain_geom` trägt SRID 0, Martin veröffentlicht die Sicht nicht.
--
-- 🔴 ERWEITERND („erst erweitern“): eine neue Sicht, die Funktion mit gleicher Signatur und gleicher Ausgabe. `path_label_run_render` bleibt für das vorige
-- Release und für Claudios Proben. Keine Kartendaten.

CREATE OR REPLACE VIEW path_label_run_basis_render AS
SELECT
    r.name,
    r.subtype,
    r.part,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    k.mark,
    r.is_bach,
    r.map_domain_id,
    r.geom AS domain_geom
FROM path_label_run r
LEFT JOIN LATERAL (
    SELECT p.mark
      FROM path p
     WHERE p.map_domain_id = r.map_domain_id AND p.name = r.name AND p.subtype = r.subtype
       AND p.mark IS NOT NULL AND p.is_active
     LIMIT 1
) k ON TRUE
ORDER BY r.name, r.subtype, r.part, r.instance;

COMMENT ON VIEW path_label_run_basis_render IS
    'Die Zeilen von path_label_run_render in Kartenkoordinaten: Ein Filter auf domain_geom erreicht die Tafel, bevor umgerechnet und das Kennzeichen nachgeschlagen wird (WI-0283).';

CREATE OR REPLACE FUNCTION path_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    karte geometry;
    kleinste_skala double precision;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
               (ST_XMin(envelope) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
               (ST_YMin(envelope) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
               (ST_XMax(envelope) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
               (ST_YMax(envelope) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
               0
           ))),
           min(d.skala)
    INTO karte, kleinste_skala
    FROM map_domain_bounds_render d;

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
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom,
            run.mark,
            run.is_bach
        FROM (
            SELECT
                b.name, b.subtype, b.part, b.instance, b.instance_count, b.name_width_px, b.collision_rank, b.mark, b.is_bach,
                ST_SetSRID(
                    ST_Translate(ST_Scale(ST_Translate(b.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244),
                    3857
                )::geometry(LineString, 3857) AS geom
            FROM path_label_run_basis_render b
            JOIN map_domain_bounds_render d ON d.map_domain_id = b.map_domain_id
            WHERE z BETWEEN b.run_min_zoom AND b.run_max_zoom
              AND ST_Intersects(
                      ST_LineInterpolatePoint(b.domain_geom, 0.5),
                      ST_Expand(karte, GREATEST(b.name_width_px * units_per_pixel / kleinste_skala, ST_Length(b.domain_geom)) / 2.0)
                  )
            OFFSET 0
        ) run
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
        WHERE (
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
$function$;

-- Der Rechtevertrag: die Kachelrolle liest NUR `*_render` (Befund Claudio, 2026-09-22).
--
-- 💣 MIGRATION 0023 HAT IHN GEBROCHEN. `path_label_run_tile` las direkt aus der Tabelle
-- `path_label_run`, und der Deploy nach Staging ist daran korrekt gescheitert:
--
--     FAIL  NACH postmigrate: path_label_run_tile -- permission denied for table path_label_run
--
-- 🪤 Der Grund ist subtil und steckt im Unterschied zwischen Sicht und Funktion. Eine SICHT läuft
-- mit den Rechten ihres Besitzers — deshalb darf `path_render` die Tabelle `path` lesen, obwohl
-- die Kachelrolle das nicht darf. Eine FUNKTION ohne `SECURITY DEFINER` läuft mit den Rechten des
-- AUFRUFERS, also der Kachelrolle. Sie sieht damit genau das, was die Rolle sehen darf: Relationen
-- auf `_render`.
--
-- ⭐ `landscape_label_run_tile` macht es seit 0012 richtig — sie liest die SICHT
-- `landscape_label_run_render`, nicht die Tabelle darunter. Ich habe die Bauform übernommen und
-- diesen Teil übersehen; er sieht wie eine Namenskonvention aus und ist ein Sicherheitsvertrag.
--
-- Claudios Werkzeug hat den Fall vor dem Umschalten gefangen (Gate D6, nach dem Postmigrate).
-- Keine Produktionswirkung, kein Datenverlust — und ausdrücklich keine Ausnahme im Rechtemuster:
-- „das wuerde den Sicherheitsvertrag an einer Stelle aufweichen, die absichtlich eng ist."

CREATE OR REPLACE VIEW path_label_run_render AS
SELECT
    r.name,
    r.subtype,
    r.part,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(r.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
FROM path_label_run r
-- Feste Reihenfolge wie in 0016; der Schluessel dieser Relation ist Name, Art, Teil und Instanz.
ORDER BY r.name, r.subtype, r.part, r.instance;

COMMENT ON VIEW path_label_run_render IS
    'Wegnamen-Schriftlaeufe in Renderkoordinaten. Sie existiert, weil die Kachelfunktion mit den Rechten des AUFRUFERS laeuft und die Kachelrolle nur *_render lesen darf - eine Sicht laeuft dagegen mit den Rechten ihres Besitzers (Befund Claudio 2026-09-22).';

-- Die Kachelfunktion liest jetzt die Sicht. Der Zuschnitt bleibt unveraendert: je Zoom
-- zugeschnitten, unbeschnitten ausgeliefert (`clip_geom => false`) - ein Lauf, der an der
-- Kachelgrenze endet, verlöre sonst seinen Namen.
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
    SELECT ST_AsMVT(source, 'path_label_run' ORDER BY source.name, source.subtype, source.part, source.instance)
    INTO tile
    FROM (
        SELECT
            run.name,
            run.subtype,
            run.part,
            run.instance,
            run.instance_count,
            run.collision_rank,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM path_label_run_render run
        CROSS JOIN LATERAL (SELECT run.name_width_px * units_per_pixel AS target) need
        CROSS JOIN LATERAL (
            SELECT
                GREATEST(0.0, 0.5 - (need.target / 2.0) / NULLIF(ST_Length(run.geom), 0)) AS lo,
                LEAST(1.0, 0.5 + (need.target / 2.0) / NULLIF(ST_Length(run.geom), 0)) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION path_label_run_tile(integer, integer, integer) IS
    'Wegnamen-Schriftlaeufe je Zoom zugeschnitten, unbeschnitten ausgeliefert. Liest die SICHT path_label_run_render, nicht die Tabelle - die Funktion laeuft mit den Rechten des Aufrufers (0025).';

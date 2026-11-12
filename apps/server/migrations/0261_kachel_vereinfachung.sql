-- 0261: Gegenden, Gewässer und Wege kommen als Kachelfunktion mit Vereinfachung je Zoom (WI-0266; Vali 2026-10-31: „die performance des
-- viewports … ist unterirdisch schlecht und fängt alles an zu ruckeln“).
--
-- Bisher las Martin die Sichten `region_area_render`, `terrain_water_render` und `path_render` selbst aus, nur auf das Kachelraster gerundet.
-- Gemessen 2026-10-31 auf der Stage: eine Kachel der Gegenden wog auf Stufe 0 2,8 MB, auf Stufe 1 1,5 MB, auf Stufe 2 1,1 MB; bei Zoom 2,3 lagen
-- 1,79 Mio. Stützpunkte im Speicher, eine Wegekachel auf Stufe 2 542 KB. Jede Ebene an diesen Quellen (Füllung, Leuchten der Suche, Namen in
-- Flächen) zahlte das in jedem Bild auf der Grafikkarte und beim Zerlegen jeder neuen Kachel.
--
-- Die drei Funktionen liefern dieselben Schichten mit denselben Namen und Eigenschaften wie die Sichten, nur unter Kachelstufe 8 vereinfacht -
-- mit DERSELBEN Regel wie die Gebiete (`territory_tile`, 0059): Toleranz = Kachelbreite / 2048, also ein Viertel Bildpunkt einer 512er-Kachel.
-- Eine Fläche, die dabei verschwindet, wäre ohnehin kleiner als ein Bildpunkt. Ab Stufe 8 (`VECTOR_TILE_MAX_ZOOM`) bleibt die Form, wie sie ist.
-- 🪤 `ST_Simplify` vereinfacht jede Fläche für sich; zwei Nachbarn können entlang ihrer gemeinsamen Kante um weniger als einen Viertel Bildpunkt
-- auseinanderlaufen. Die Gebiete leben seit 0059 so.
--
-- 🔴 ADDITIV („erst erweitern“, `docs/regeln/entwicklung.md`): drei neue Funktionen, keine geänderte Sicht. Das vorige Release liest weiter die
-- Sichten unter ihrem alten Kachelpfad; der Browser liest die Funktionen erst mit dem Release, das die Adressen in `app.vue` umstellt.
-- Der Anhang `?rev=` der Adresse (`edit-revision.ts`) bricht nur den Cache und wird nicht gelesen.
--
-- Rechte: keine neuen Zeilen. Die Kachelrolle bekommt EXECUTE auf jede Funktion mit Martin-Signatur von selbst (`avesmaps3d-db-grants`,
-- `grants_sql_tmpl` in `ops/runtime/runtime-foundation.sh`); sie liest nur die `*_render`-Sichten, die sie schon lesen darf. Martin findet neue
-- Funktionen erst nach einem Neustart.

CREATE OR REPLACE FUNCTION region_area_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'region_area_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            a.public_id, a.region_public_id, a.name, a.region_layer, a.region_type, a.stack_order, a.is_locked, a.area,
            ST_AsMVTGeom(ST_Simplify(a.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM region_area_render a
        WHERE a.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY a.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

CREATE OR REPLACE FUNCTION terrain_water_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_water_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            w.public_id, w.region_type, w.region_public_id, w.name, w.area,
            ST_AsMVTGeom(ST_Simplify(w.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_water_render w
        WHERE w.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY w.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

CREATE OR REPLACE FUNCTION path_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'path_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.label_visible, p.is_bach, p.collision_rank, p.flow_direction, p.is_tunnel, p.mark,
            ST_AsMVTGeom(ST_Simplify(p.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM path_render p
        WHERE p.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY p.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION region_area_tile(integer, integer, integer, json) IS
    'Kachel der Gegenden (Schicht region_area_render), unter Stufe 8 auf Kachelbreite/2048 vereinfacht (WI-0266). Der Anhang ?rev= ist nur ein Cache-Brecher.';
COMMENT ON FUNCTION terrain_water_tile(integer, integer, integer, json) IS
    'Kachel der geglätteten Seen und Meere (Schicht terrain_water_render), unter Stufe 8 auf Kachelbreite/2048 vereinfacht (WI-0266).';
COMMENT ON FUNCTION path_tile(integer, integer, integer, json) IS
    'Kachel der Wege (Schicht path_render), unter Stufe 8 auf Kachelbreite/2048 vereinfacht (WI-0266).';

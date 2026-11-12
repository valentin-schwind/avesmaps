-- 0315: Kachelquellen filtern über den vorhandenen Index, statt jedes Objekt je Kachel umzurechnen (WI-0283 K2, K3; Claudio 2026-11-06:
-- `map_domain` 23,5 Mrd. Durchläufe in sieben Tagen, `territory_capital_band` 35 Mrd. gelesene Zeilen).
--
-- Gemessen auf der Entwicklungsdatenbank, Kachel 7/65/64: `region_area_tile` 145 ms, davon 141 ms für den Rückfallzweig, der keine einzige Zeile
-- liefert, aber 6.381 Flächen umrechnet; `path_tile` 158 ms bei 26 Treffern von 11.310; `place_render` 60 ms bei 11 von 5.900; `ley_node_render`
-- 71 ms bei 0 Treffern. Die Sichten rechnen `map_domain_to_render` in ihrer Spalte `geom`; ein Filter darauf kann keinen Index nutzen und ruft die
-- Funktion (nicht inlinebar: SECURITY DEFINER, liest `map_domain`) für jede Zeile.
--
-- Darum filtern die Kachelfunktionen jetzt in Kartenkoordinaten auf der Basisgeometrie, wo der GiST-Index liegt, und rechnen nur die Treffer um:
-- - `map_domain_bounds_render`: die Umrechnung der Domäne, einmal je Kachel gelesen.
-- - `*_basis_render`, `*_rund_render`, `*_eckig_render`: dieselben Zeilen wie die alten Sichten, mit `domain_geom` statt der fertig umgerechneten
--   Spalte. Sie ersetzen nichts: `place_render` und `ley_node_render` bleiben für das vorige Release und für Claudios Proben.
-- - Dieselbe Rechnung Schritt für Schritt wie `map_domain_to_render` (Translate, Scale, Translate), also dieselben Bytes. Der Vergleich steht in
--   `apps/server/test/kacheln-ueber-den-index.test.ts`.
--
-- 🔴 Kachelvertrag unverändert (`render-grants.test.ts`): Die Kachelfunktionen lesen nur `*_render`, rufen keine eigene Funktion und laufen als Aufrufer.
-- Die Kachelrolle bekommt SELECT auf die neuen Sichten und EXECUTE auf die neuen Funktionen von `avesmaps3d-db-grants`; `migrate` und `db-grants` laufen
-- unmittelbar hintereinander (`docs/regeln/entwicklung.md`). `domain_geom` trägt SRID 0, Martin veröffentlicht solche Spalten nicht.
--
-- 🔴 ERWEITERND („erst erweitern“): neue Sichten, zwei neue Funktionen (`place_tile`, `ley_node_tile`), drei Rümpfe mit gleicher Signatur und gleicher
-- Ausgabe. Kein DROP. Der Browser liest die neuen Adressen erst mit dem Release, das `app.vue` umstellt. Martin findet die neuen Funktionen nach dem
-- Neustart durch `postmigrate --changed yes`. Keine Kartendaten.
--
-- Chaikin bleibt in der konvexen Hülle: Der Rahmen auf der ungeglätteten Fläche lässt keine Zeile aus. Die Kachelfunktion ruft `ST_ChaikinSmoothing` selbst
-- (dieselbe Rechnung wie `terrain_water_smooth`, 0053): Eine eigene Funktion dürfte sie als Aufrufer nicht rufen, und in der Sicht liefe die Glättung schon
-- für jeden Kastentreffer, auch für Flächen, die gar kein Gewässer sind (gemessen: 540 ms bei Zoom 1).

CREATE OR REPLACE VIEW map_domain_bounds_render AS
SELECT d.id AS map_domain_id, d.min_x, d.min_y,
       (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y) AS skala
FROM map_domain d
ORDER BY d.id;
COMMENT ON VIEW map_domain_bounds_render IS
    'Die Umrechnung einer Kartendomaene in Renderkoordinaten, je Kachel einmal gelesen (WI-0283). Dieselbe Rechnung wie map_domain_to_render.';

CREATE OR REPLACE VIEW place_basis_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    p.is_ruined,
    p.is_nodix,
    tcb.bands AS capital_bands,
    p.is_approximate,
    COALESCE(
        pc.canon = 'unofficial',
        (SELECT s.display FROM canon_object_label_setting s WHERE s.object_kind = 'place'),
        false
    ) AS is_unofficial,
    p.map_domain_id,
    p.geom AS domain_geom
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
LEFT JOIN place_canon pc ON pc.place_id = p.id
WHERE p.is_active
ORDER BY p.public_id;
COMMENT ON VIEW place_basis_render IS 'Die Zeilen von place_render in Kartenkoordinaten, fuer place_tile (WI-0283).';

CREATE OR REPLACE VIEW ley_node_basis_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    p.is_ruined,
    'place'::text AS node_kind,
    p.map_domain_id,
    p.geom AS domain_geom
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
WHERE p.is_active
  AND (
      p.is_nodix
      OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.from_public_id = p.public_id)
      OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.to_public_id = p.public_id)
  )
UNION ALL
SELECT
    l.public_id,
    l.name,
    'stadt'::text,
    FALSE,
    NULL::smallint,
    NULL::smallint,
    NULL::boolean,
    NULL::numeric(4, 1),
    label_collision_rank(cr.rank, NULL::smallint, NULL::smallint),
    FALSE,
    'label'::text,
    l.map_domain_id,
    l.geom
FROM map_label l
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = 'stadt'
WHERE l.is_active
  AND (
      l.is_nodix IS TRUE
      OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.from_public_id = l.public_id)
      OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.to_public_id = l.public_id)
  )
UNION ALL
SELECT
    n.public_id,
    NULL::text,
    'dorf'::text,
    FALSE,
    NULL::smallint,
    NULL::smallint,
    NULL::boolean,
    NULL::numeric(4, 1),
    label_collision_rank(cr.rank, NULL::smallint, NULL::smallint),
    FALSE,
    'nodix'::text,
    n.map_domain_id,
    n.geom
FROM nodix n
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = 'dorf'
WHERE n.is_active
UNION ALL
SELECT
    t.public_id,
    t.name,
    'gebaeude'::text,
    'verborgen' = ANY (t.merkmale),
    NULL::smallint,
    NULL::smallint,
    NULL::boolean,
    NULL::numeric(4, 1),
    label_collision_rank(cr.rank, NULL::smallint, NULL::smallint),
    FALSE,
    'landmark'::text,
    t.map_domain_id,
    t.geom
FROM terrain_peak t
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = 'gebaeude'
WHERE t.is_active
  AND (
      'nodix' = ANY (t.merkmale)
      OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.from_public_id = t.public_id)
      OR EXISTS (SELECT 1 FROM powerline pl WHERE pl.is_active AND pl.to_public_id = t.public_id)
  )
ORDER BY 1;
COMMENT ON VIEW ley_node_basis_render IS 'Die Zeilen von ley_node_render in Kartenkoordinaten, fuer ley_node_tile (WI-0283).';

CREATE OR REPLACE VIEW path_basis_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction,
    p.is_tunnel,
    p.mark,
    p.map_domain_id,
    v.geom AS domain_geom
FROM path p
JOIN path_visual v ON v.path_id = p.id
WHERE p.is_active
UNION ALL
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint),
    p.flow_direction,
    p.is_tunnel,
    p.mark,
    p.map_domain_id,
    p.geom
FROM path p
WHERE p.is_active AND NOT EXISTS (SELECT 1 FROM path_visual v WHERE v.path_id = p.id)
ORDER BY 1;
COMMENT ON VIEW path_basis_render IS
    'Die Zeilen von path_render in Kartenkoordinaten, je Zweig ueber seinen eigenen Index: die gezeichnete Kurve, sonst die rohe Linie (WI-0283).';

CREATE OR REPLACE VIEW region_area_rund_render AS
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    s.render_geom AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden
  ORDER BY a.public_id;
COMMENT ON VIEW region_area_rund_render IS 'Der gerundete Zweig von region_area_render, mit fertiger Renderform und ihrem Index (WI-0283).';

CREATE OR REPLACE VIEW region_area_eckig_render AS
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    a.map_domain_id,
    a.geom AS domain_geom
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)))
  ORDER BY a.public_id;
COMMENT ON VIEW region_area_eckig_render IS 'Der Rueckfallzweig von region_area_render (noch nicht gerundet), in Kartenkoordinaten (WI-0283).';

CREATE OR REPLACE VIEW terrain_water_rund_render AS
SELECT a.public_id,
    r.region_type,
    s.render_geom AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text]))
  ORDER BY a.public_id;
COMMENT ON VIEW terrain_water_rund_render IS 'Der gerundete Zweig von terrain_water_render (WI-0283).';

CREATE OR REPLACE VIEW terrain_water_eckig_render AS
SELECT a.public_id,
    r.region_type,
    r.public_id AS region_public_id,
    r.name,
    a.map_domain_id,
    a.geom AS domain_geom
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text])) AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at))
  ORDER BY a.public_id;
COMMENT ON VIEW terrain_water_eckig_render IS
    'Der Rueckfallzweig von terrain_water_render, in Kartenkoordinaten; die Kachelfunktion glaettet nur die Treffer (WI-0283).';

CREATE OR REPLACE FUNCTION place_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'place_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.is_hidden, p.label_min_zoom_override, p.label_max_zoom_override, p.label_visible_override,
            p.label_size_override, p.collision_rank, p.is_ruined, p.is_nodix, p.capital_bands, p.is_approximate, p.is_unofficial,
            ST_AsMVTGeom(
                ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(p.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857),
                envelope, 4096, 64, true
            ) AS geom
        FROM place_basis_render p
        JOIN map_domain_bounds_render d ON d.map_domain_id = p.map_domain_id
        WHERE p.domain_geom && karte
        ORDER BY p.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

CREATE OR REPLACE FUNCTION ley_node_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'ley_node_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.is_hidden, p.label_min_zoom_override, p.label_max_zoom_override, p.label_visible_override,
            p.label_size_override, p.collision_rank, p.is_ruined, p.node_kind,
            ST_AsMVTGeom(
                ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(p.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857),
                envelope, 4096, 64, true
            ) AS geom
        FROM ley_node_basis_render p
        JOIN map_domain_bounds_render d ON d.map_domain_id = p.map_domain_id
        WHERE p.domain_geom && karte
        ORDER BY p.public_id, p.node_kind
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
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'path_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.label_visible, p.is_bach, p.collision_rank, p.flow_direction, p.is_tunnel, p.mark,
            ST_AsMVTGeom(
                ST_Simplify(
                    ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(p.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)::geometry(LineString, 3857),
                    toleranz
                ),
                envelope, 4096, 64, true
            ) AS geom
        FROM path_basis_render p
        JOIN map_domain_bounds_render d ON d.map_domain_id = p.map_domain_id
        WHERE p.domain_geom && karte
        ORDER BY p.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

CREATE OR REPLACE FUNCTION region_area_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'region_area_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            a.public_id, a.region_public_id, a.name, a.region_layer, a.region_type, a.stack_order, a.is_locked, a.area,
            ST_AsMVTGeom(ST_Simplify(a.render_form, toleranz), envelope, 4096, 64, true) AS geom
        FROM (
            SELECT r.public_id, r.region_public_id, r.name, r.region_layer, r.region_type, r.stack_order, r.is_locked, r.area,
                   r.geom AS render_form
            FROM region_area_rund_render r
            WHERE r.geom && rahmen
            UNION ALL
            SELECT e.public_id, e.region_public_id, e.name, e.region_layer, e.region_type, e.stack_order, e.is_locked,
                   round(ST_Area(e.domain_geom)::numeric, 2)::double precision,
                   ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(e.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)
            FROM region_area_eckig_render e
            JOIN map_domain_bounds_render d ON d.map_domain_id = e.map_domain_id
            WHERE e.domain_geom && karte
        ) a
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
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'terrain_water_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            w.public_id, w.region_type, w.region_public_id, w.name, w.area,
            ST_AsMVTGeom(ST_Simplify(w.render_form, toleranz), envelope, 4096, 64, true) AS geom
        FROM (
            SELECT r.public_id, r.region_type, r.region_public_id, r.name, r.area, r.geom AS render_form
            FROM terrain_water_rund_render r
            WHERE r.geom && rahmen
            UNION ALL
            SELECT e.public_id, e.region_type, e.region_public_id, e.name,
                   round(ST_Area(e.domain_geom)::numeric, 2)::double precision,
                   ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(ST_ChaikinSmoothing(e.domain_geom, 3), -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)
            FROM terrain_water_eckig_render e
            JOIN map_domain_bounds_render d ON d.map_domain_id = e.map_domain_id
            WHERE e.domain_geom && karte
        ) w
        ORDER BY w.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION place_tile(integer, integer, integer, json) IS
    'Kachel der Orte (Schicht place_render), gefiltert in Kartenkoordinaten ueber den Index (WI-0283). Der Anhang ?r= ist nur ein Cache-Brecher.';
COMMENT ON FUNCTION ley_node_tile(integer, integer, integer, json) IS
    'Kachel der Kraftlinien-Knoten (Schicht ley_node_render), gefiltert in Kartenkoordinaten ueber den Index (WI-0283).';

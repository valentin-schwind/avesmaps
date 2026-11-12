-- 0342: Die gefährlichen Gebiete als eigene kleine Kachelquelle (WI-0308 Paket 2; Vali 2026-11-11 Antwort 8 „rot schraffiert“, 2026-11-12
-- Antwort 11 „immer sichtbar“, ohne eigenen Schalter).
--
--   1. `region_area_rund_render` und `region_area_eckig_render` (0315) bekommen am ENDE die Spalte `gefahr`: TRUE, wenn die Landschaft
--      mindestens eine Gefahrenart trägt (`region.hazards`, 0341) UND in einer Ebene liegt, in der die Gefahrenlage wirkt (Derographie,
--      Vegetation, Topographie; `gefahrWirkt` in `packages/shared/src/gefahren.ts`), sonst NULL. `region_area_tile` nennt seine Spalten
--      einzeln und liefert dieselben Bytes wie vorher (`kacheln-ueber-den-index.test.ts`).
--   2. Die neue Kachelfunktion `region_gefahr_tile` (Schicht `region_gefahr_render`) liefert NUR die Flächen mit `gefahr`, in derselben
--      Form wie `region_area_tile`: gerundet oder eckig, unter Stufe 8 vereinfacht. Die Schraffur steht in jeder Ansicht (auch dort, wo keine
--      Landschaftsflächen gezeichnet werden); eine eigene Quelle hält diese Kacheln winzig, statt überall alle Flächen zu laden. Ohne
--      gefährliches Gebiet ist jede Kachel leer.
--
-- 🔴 ERWEITERND („erst erweitern“): zwei Sichten mit einer Spalte mehr am Ende, eine neue Funktion mit Martins Signatur, die nur `*_render`
-- liest, keine eigene Funktion ruft und als Aufrufer läuft (`render-grants.test.ts`). Die Kachelrolle bekommt EXECUTE von
-- `avesmaps3d-db-grants` (`avesmaps3d-postmigrate --changed yes`), Martin findet die Funktion nach dem Neustart; das vorige Release fragt sie
-- nie an. Keine Kartendaten.

CREATE OR REPLACE VIEW region_area_rund_render AS
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    s.render_geom AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area,
    CASE WHEN cardinality(r.hazards) > 0 AND r.region_layer IN ('derographisch', 'vegetation', 'topographie') THEN TRUE END AS gefahr
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden
  ORDER BY a.public_id;
COMMENT ON VIEW region_area_rund_render IS
    'Der gerundete Zweig von region_area_render, mit fertiger Renderform und ihrem Index (WI-0283); gefahr TRUE bei wirksamer Gefahrenlage (WI-0308), sonst NULL.';

CREATE OR REPLACE VIEW region_area_eckig_render AS
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    a.map_domain_id,
    a.geom AS domain_geom,
    CASE WHEN cardinality(r.hazards) > 0 AND r.region_layer IN ('derographisch', 'vegetation', 'topographie') THEN TRUE END AS gefahr
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)))
  ORDER BY a.public_id;
COMMENT ON VIEW region_area_eckig_render IS
    'Der Rueckfallzweig von region_area_render (noch nicht gerundet), in Kartenkoordinaten (WI-0283); gefahr wie im gerundeten Zweig (WI-0308).';

CREATE OR REPLACE FUNCTION region_gefahr_tile(z integer, x integer, y integer, query_params json)
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
    SELECT ST_AsMVT(source, 'region_gefahr_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            a.public_id, a.region_public_id, a.name, a.region_layer, a.region_type,
            ST_AsMVTGeom(ST_Simplify(a.render_form, toleranz), envelope, 4096, 64, true) AS geom
        FROM (
            SELECT r.public_id, r.region_public_id, r.name, r.region_layer, r.region_type, r.geom AS render_form
            FROM region_area_rund_render r
            WHERE r.gefahr AND r.geom && rahmen
            UNION ALL
            SELECT e.public_id, e.region_public_id, e.name, e.region_layer, e.region_type,
                   ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(e.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)
            FROM region_area_eckig_render e
            JOIN map_domain_bounds_render d ON d.map_domain_id = e.map_domain_id
            WHERE e.gefahr AND e.domain_geom && karte
        ) a
        ORDER BY a.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;
COMMENT ON FUNCTION region_gefahr_tile(integer, integer, integer, json) IS
    'Die Flaechen mit wirksamer Gefahrenlage (WI-0308) als Schicht region_gefahr_render, fuer die rote Schraffur; ohne gefaehrliches Gebiet leer.';

-- Die Landflächen der Topographie, nahtlos geglättet (WI-0055, Betreiber 2026-10-04: Option A, „nahtlos glätten, jede
-- gemeinsame Kante einmal“, nachdem der Aufwand mit „2–3 Tage“ beziffert war).
--
-- Nur Anzeige: `region_area` bleibt, wie es ist (Map Mutation Guard). Abgeleitet wird eine zweite Form je Fläche, die nur die
-- Renderansicht `region_area_render` liest. Wer eine Landfläche glatt zeichnen will, bekommt sie dort; Vegetation,
-- Derographisch und Klima bleiben eckig, und die Seen glättet weiter `terrain_water_smooth` (Migration 0053).
--
-- 🔴 Warum nicht jede Fläche einzeln glätten (Option B): Zwei Nachbarn teilen eine Grenze, aber glättet man jeden Ring für
-- sich, schneidet er an den Ecken seiner Nachbarschaft anders ab als der andere. An den Knoten, wo drei oder mehr Flächen
-- zusammenstoßen, und überall dort, wo ein Nachbar an der Grenze andere Punkte hat, bleiben Spalten und Überlappungen. Hier
-- wird darum die Grenze selbst geglättet, genau einmal, und beide Flächen benutzen sie:
--   1. Punkte, die höchstens 0,001 E auseinanderliegen, werden zu einem Punkt (Legacys Editor rastet nur ein und verschweißt
--      nicht, Owner-Entscheid 2026-07-29: Nachbarn haben oft fast dieselbe Grenze mit anderen Punkten; gemessen liegen 945 von
--      122.041 Stützpunkten höchstens 0,001 E neben dem Rand einer anderen Fläche und nicht darauf).
--      Liegt ein Punkt einer anderen Fläche höchstens so weit neben einem Randstück, wird er dort eingefügt.
--   2. Alle Ränder werden verknotet (ST_UnaryUnion) und in Kanten zwischen den Knoten zerlegt (ST_LineMerge). Knoten sind
--      die Punkte, an denen drei oder mehr Ränder zusammentreffen; sie bleiben fest.
--   3. Jede Kante wird einmal geglättet: Chaikin, drei Durchgänge wie `terrain_water_smooth`, Endpunkte fest.
--      Eine Kante ohne Knoten (eine einzelne Insel) ist ein Ring und rundet sich genau wie ein Gewässer. Danach wird jede Kante
--      auf einen halben Bildpunkt der größten Zoomstufe vereinfacht (0,004 E), für beide Nachbarn gleich.
--   4. Jede Fläche setzt sich aus den Kanten zusammen, die ihr Rand trägt (ST_Polygonize). Eine gemeinsame Kante liegt in
--      beiden Nachbarn als dieselbe Linie: kein Spalt, keine Überlappung. Verschachtelte Flächen (Schneckenkamm in den
--      Windhagbergen) und echte Überlappungen bleiben, was sie sind: Jede Fläche behält ihren eigenen Rand, keine wird einer
--      anderen zugeschlagen.
--
-- Dabei sind auch Meere Teil des Netzes (das Gewässer der Topographie ist dort die Lasur der Ebene und stößt an die Küsten
-- des Landes); Seen nicht, sie liegen als deckende Fläche aus `terrain_water_render` darüber. Welche Flächen mitzählen,
-- steht an EINER Stelle: `region_area_is_smoothed`.
--
-- Eine Fläche, deren Ergebnis ungültig ist oder mehr als die Hälfte ihrer Fläche verloren hätte, behält ihre Ausgangsform (Zeile
-- mit `status` fallback_*): Das ist ein Befund, kein Abbruch, und die Karte zeigt sie eckig.
--
-- 🪤 Martin cacht Kacheln. Nach dieser Migration und nach jeder Ableitung Martin neu starten.

CREATE TABLE IF NOT EXISTS region_area_smooth (
    region_area_id BIGINT PRIMARY KEY REFERENCES region_area (id) ON DELETE CASCADE,
    -- Die geglättete Form im Kartenraum (SRID 0), gültig; bei einem Rückfall die gültig gemachte Ausgangsform.
    geom geometry(Geometry, 0) NOT NULL,
    -- Dieselbe Form in Renderkoordinaten, beim Schreiben einmal gerechnet und indiziert: Martin fragt je Kachel mit dem Kachelrahmen,
    -- und eine Sicht, die jede Form erst umrechnet, könnte keinen Index nutzen (die acht-mal dichteren Ränder kosteten jede Kachel
    -- 60 ms mehr, gemessen an Satz map161832, ADR-0012 hat dasselbe bei den Höhenlinien gelöst).
    render_geom geometry(Geometry, 3857) NOT NULL,
    -- Die Fläche, aus der sie entstand: Hat sich `region_area.updated_at` seither geändert, ist sie veraltet, und die
    -- Renderansicht zeigt die Fläche eckig, bis die Ableitung neu gelaufen ist.
    source_updated_at TIMESTAMPTZ NOT NULL,
    recipe TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('smoothed', 'fallback_empty', 'fallback_invalid', 'fallback_shrunk', 'fallback_missing')),
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT region_area_smooth_is_surface CHECK (GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON'))
);

CREATE INDEX IF NOT EXISTS region_area_smooth_render_geom ON region_area_smooth USING gist (render_geom);

-- Welche Flächen werden geglättet: die der Ebene Topographie außer den Seen (die zeichnet `terrain_water_render`).
CREATE OR REPLACE FUNCTION region_area_is_smoothed(p_layer TEXT, p_type TEXT) RETURNS BOOLEAN
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT p_layer = 'topographie' AND p_type IS DISTINCT FROM 'see' $$;

-- Das Rezept: Ändert sich Toleranz, Durchgangszahl oder das Verfahren, steigt die Nummer, und die Ableitung rechnet neu.
CREATE OR REPLACE FUNCTION region_area_smooth_recipe() RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT 'v1 chaikin3 simplify0.004 merge0.001 net' $$;

-- Ist die Ableitung veraltet? Eine Fläche ohne frische Zeile, eine Zeile ohne Fläche oder ein anderes Rezept.
CREATE OR REPLACE FUNCTION region_area_smooth_is_stale(p_domain TEXT DEFAULT 'aventuria') RETURNS BOOLEAN
    LANGUAGE sql STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = p_domain AND a.is_active AND r.is_active
          AND region_area_is_smoothed(r.region_layer, r.region_type)
          AND NOT EXISTS (
              SELECT 1 FROM region_area_smooth s
              WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND s.recipe = region_area_smooth_recipe()
          )
    ) OR EXISTS (
        SELECT 1
        FROM region_area_smooth s
        JOIN region_area a ON a.id = s.region_area_id
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = p_domain
          AND NOT (a.is_active AND r.is_active AND region_area_is_smoothed(r.region_layer, r.region_type))
    )
$$;

-- Die Ableitung. Gibt einen Bericht als jsonb zurück; ohne Änderung der Eingaben rechnet sie nichts (`p_force` erzwingt es).
-- 🪤 SECURITY DEFINER mit festem search_path wie jede Funktion, die eine Basistabelle liest (`render-grants.test.ts`).
CREATE OR REPLACE FUNCTION region_area_smooth_derive(p_domain TEXT DEFAULT 'aventuria', p_force BOOLEAN DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Punkte, die höchstens so weit auseinanderliegen, gelten als derselbe (E; Legacy rundet auf Tausendstel).
    c_tolerance CONSTANT double precision := 0.001;
    -- Dieselbe Rundung wie `terrain_water_smooth` (Migration 0053): Chaikin, drei Durchgänge.
    c_passes CONSTANT integer := 3;
    -- Die Auflösung der Karte: ein halber Bildpunkt der größten Kamerazoomstufe (Zoom 8, 128 Bildpunkte je E), in E. Feiner zeichnet
    -- die Karte nicht, und die Rundung trägt ohne diese Vereinfachung achtmal so viele Punkte wie die Ausgangsform (die Kacheln der
    -- Übersicht wurden damit um bis zu 70 % schwerer, gemessen).
    c_resolution CONSTANT double precision := 0.004;
    -- Ein Ergebnis, das weniger als die Hälfte der Ausgangsfläche behielte, ist ein misslungener Zusammenbau, keine Rundung.
    c_min_share CONSTANT double precision := 0.5;
    v_started timestamptz := clock_timestamp();
    v_members integer;
    v_edges integer;
    v_shared integer;
    v_merged integer;
    v_inserted integer;
    v_fallback jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('avesmaps3d:region_area_smooth'), hashtext(p_domain));
    -- Die ungültigen Legacy-Flächen melden sich bei jeder Prüfung mit einer NOTICE; hier sind sie erwartet.
    PERFORM set_config('client_min_messages', 'warning', true);
    IF NOT p_force AND NOT region_area_smooth_is_stale(p_domain) THEN
        RETURN jsonb_build_object(
            'computed', false,
            'recipe', region_area_smooth_recipe(),
            'areas', (SELECT count(*) FROM region_area_smooth s JOIN region_area a ON a.id = s.region_area_id WHERE a.map_domain_id = p_domain),
            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
        );
    END IF;

    DROP TABLE IF EXISTS ras_in, ras_use, ras_pts, ras_cl, ras_merged, ras_vtx, ras_snapped, ras_edges, ras_sedges, ras_bnd,
        ras_owner, ras_out, ras_final;

    -- Eingabe: die Flächen der Ebene, gültig gemacht (nur beim Lesen; 20 Legacy-Flächen sind ungültig, die Daten bleiben).
    CREATE TEMP TABLE ras_in ON COMMIT DROP AS
        SELECT a.id AS aid, a.updated_at, a.geom AS raw,
               ST_Multi(ST_CollectionExtract(
                   CASE WHEN ST_IsValid(a.geom) THEN a.geom ELSE ST_MakeValid(a.geom, 'method=structure') END, 3)) AS g
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = p_domain AND a.is_active AND r.is_active AND region_area_is_smoothed(r.region_layer, r.region_type);
    SELECT count(*) INTO v_members FROM ras_in;
    CREATE TEMP TABLE ras_use ON COMMIT DROP AS SELECT aid, g FROM ras_in WHERE NOT ST_IsEmpty(g);

    -- 1. Fast gleiche Punkte zu einem machen (der lexikografisch kleinste bleibt), und einen Punkt, der neben dem Randstück
    --    einer anderen Fläche liegt, dort einfügen.
    CREATE TEMP TABLE ras_pts ON COMMIT DROP AS
        SELECT s.aid, d.path AS pth, d.geom AS pt FROM ras_use s, LATERAL ST_DumpPoints(s.g) d;
    CREATE TEMP TABLE ras_cl ON COMMIT DROP AS
        SELECT aid, pth, pt, ST_ClusterDBSCAN(pt, c_tolerance, 1) OVER () AS cid FROM ras_pts;
    SELECT count(*) INTO v_merged FROM (
        SELECT cid FROM ras_cl GROUP BY cid HAVING count(DISTINCT (ST_X(pt), ST_Y(pt))) > 1
    ) multiple;
    CREATE TEMP TABLE ras_merged ON COMMIT DROP AS
        WITH rep AS (
            SELECT cid, (array_agg(pt ORDER BY ST_X(pt), ST_Y(pt)))[1] AS r FROM ras_cl GROUP BY cid
        ), rings AS (
            SELECT c.aid, c.pth[1] AS poly, c.pth[2] AS ring,
                   ST_RemoveRepeatedPoints(ST_MakeLine(rep.r ORDER BY c.pth[3])) AS ln
            FROM ras_cl c JOIN rep USING (cid)
            GROUP BY c.aid, c.pth[1], c.pth[2]
        ), polys AS (
            SELECT aid, poly,
                   (array_agg(ln ORDER BY ring) FILTER (WHERE ring = 1 AND ST_NPoints(ln) >= 4))[1] AS shell,
                   array_remove(array_agg(CASE WHEN ring > 1 AND ST_NPoints(ln) >= 4 THEN ln END ORDER BY ring), NULL) AS holes
            FROM rings GROUP BY aid, poly
        )
        SELECT aid, ST_Multi(ST_Collect(ST_MakePolygon(shell, holes))) AS g
        FROM polys WHERE shell IS NOT NULL GROUP BY aid;
    UPDATE ras_merged m SET g = ST_Multi(ST_CollectionExtract(ST_MakeValid(m.g, 'method=structure'), 3)) WHERE NOT ST_IsValid(m.g);
    -- Eine Fläche, die dabei verschwand, behält ihre Ausgangsform.
    DELETE FROM ras_merged WHERE ST_IsEmpty(g);
    INSERT INTO ras_merged SELECT u.aid, u.g FROM ras_use u WHERE u.aid NOT IN (SELECT aid FROM ras_merged);
    CREATE TEMP TABLE ras_vtx ON COMMIT DROP AS SELECT m.aid, d.geom AS pt FROM ras_merged m, LATERAL ST_DumpPoints(m.g) d;
    CREATE INDEX ON ras_vtx USING gist (pt);
    CREATE TEMP TABLE ras_snapped ON COMMIT DROP AS
        SELECT m.aid,
               COALESCE(ST_Snap(m.g, (
                   SELECT ST_Collect(DISTINCT v.pt) FROM ras_vtx v WHERE v.aid <> m.aid AND v.pt && ST_Expand(m.g, c_tolerance)
               ), c_tolerance), m.g) AS g,
               m.g AS merged
        FROM ras_merged m;
    UPDATE ras_snapped x SET g = ST_Multi(ST_CollectionExtract(ST_MakeValid(x.g, 'method=structure'), 3)) WHERE NOT ST_IsValid(x.g);
    UPDATE ras_snapped x SET g = x.merged WHERE ST_IsEmpty(x.g) OR ST_Area(x.g) < c_min_share * ST_Area(x.merged);
    SELECT COALESCE(sum(ST_NPoints(s.g) - ST_NPoints(s.merged)), 0) INTO v_inserted FROM ras_snapped s;

    -- 2. Verknoten, in Kanten zwischen den Knoten zerlegen. Eine gemeinsame Kante entsteht dabei nur einmal.
    CREATE TEMP TABLE ras_edges ON COMMIT DROP AS
        SELECT row_number() OVER () AS id, e
        FROM (SELECT (ST_Dump(ST_LineMerge(ST_UnaryUnion(ST_Collect(ST_Boundary(g)))))).geom AS e FROM ras_snapped) s;
    CREATE INDEX ON ras_edges USING gist (e);
    SELECT count(*) INTO v_edges FROM ras_edges;

    -- 3. Jede Kante einmal glätten, die Endpunkte (die Knoten) fest, und auf die Auflösung der Karte vereinfachen (Kante für Kante,
    --    also für beide Nachbarn gleich). Ein Ring ohne Knoten ist eine Insel und rundet sich wie ein Gewässer; eine geschlossene
    --    Kante, die an einem Knoten hängt (eine Schleife), behält diesen Punkt.
    CREATE TEMP TABLE ras_sedges ON COMMIT DROP AS
        SELECT n.id, n.e,
               ST_SimplifyPreserveTopology(
                   CASE
                       WHEN ST_IsClosed(n.e) AND ST_NPoints(n.e) >= 4
                            AND NOT EXISTS (SELECT 1 FROM ras_edges o WHERE o.id <> n.id AND ST_Intersects(o.e, ST_StartPoint(n.e)))
                       THEN ST_ExteriorRing(ST_ChaikinSmoothing(ST_MakePolygon(n.e), c_passes))
                       ELSE ST_ChaikinSmoothing(n.e, c_passes, true)
                   END,
                   c_resolution
               ) AS se
        FROM ras_edges n;

    -- 4. Wem gehört jede Kante? Dem, dessen Rand sie trägt (in der Mitte der Kante geprüft, mit Spiel für Rundungsfehler).
    CREATE TEMP TABLE ras_bnd ON COMMIT DROP AS SELECT aid, ST_Boundary(g) AS b FROM ras_snapped;
    CREATE INDEX ON ras_bnd USING gist (b);
    CREATE TEMP TABLE ras_owner ON COMMIT DROP AS
        SELECT DISTINCT n.id AS eid, t.aid
        FROM ras_edges n JOIN ras_bnd t ON ST_DWithin(t.b, ST_LineInterpolatePoint(n.e, 0.5), 1e-9);
    SELECT count(*) INTO v_shared FROM (SELECT eid FROM ras_owner GROUP BY eid HAVING count(*) > 1) shared;

    -- 5. Jede Fläche aus ihren geglätteten Kanten neu bilden. Behalten wird, was in der Ausgangsfläche liegt.
    CREATE TEMP TABLE ras_out ON COMMIT DROP AS
        WITH lines AS (
            SELECT o.aid, ST_Node(ST_Collect(s.se)) AS ln FROM ras_owner o JOIN ras_sedges s ON s.id = o.eid GROUP BY o.aid
        ), faces AS (
            SELECT aid, (ST_Dump(ST_Polygonize(ln))).geom AS f FROM lines GROUP BY aid
        )
        SELECT t.aid, ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(f.f)), 3)) AS g
        FROM ras_snapped t
        JOIN faces f ON f.aid = t.aid AND ST_Intersects(t.g, ST_PointOnSurface(f.f))
        GROUP BY t.aid;
    UPDATE ras_out o SET g = ST_Multi(ST_CollectionExtract(ST_MakeValid(o.g, 'method=structure'), 3)) WHERE NOT ST_IsValid(o.g);

    CREATE TEMP TABLE ras_final ON COMMIT DROP AS
        SELECT i.aid, i.updated_at,
               CASE
                   WHEN ST_IsEmpty(i.g) THEN i.raw
                   WHEN o.aid IS NULL OR ST_IsEmpty(o.g) OR NOT ST_IsValid(o.g) OR ST_Area(o.g) < c_min_share * ST_Area(i.g) THEN i.g
                   ELSE o.g
               END AS g,
               CASE
                   WHEN ST_IsEmpty(i.g) THEN 'fallback_empty'
                   WHEN o.aid IS NULL OR ST_IsEmpty(o.g) THEN 'fallback_missing'
                   WHEN NOT ST_IsValid(o.g) THEN 'fallback_invalid'
                   WHEN ST_Area(o.g) < c_min_share * ST_Area(i.g) THEN 'fallback_shrunk'
                   ELSE 'smoothed'
               END AS status
        FROM ras_in i LEFT JOIN ras_out o ON o.aid = i.aid;

    DELETE FROM region_area_smooth s USING region_area a WHERE a.id = s.region_area_id AND a.map_domain_id = p_domain;
    INSERT INTO region_area_smooth (region_area_id, geom, render_geom, source_updated_at, recipe, status)
        SELECT f.aid, ST_SetSRID(f.g, 0), map_domain_to_render(p_domain, ST_SetSRID(f.g, 0)), f.updated_at, region_area_smooth_recipe(), f.status
        FROM ras_final f;

    SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_fallback
        FROM (SELECT status, count(*) AS n FROM ras_final WHERE status <> 'smoothed' GROUP BY status) x;
    RETURN jsonb_build_object(
        'computed', true,
        'recipe', region_area_smooth_recipe(),
        'areas', v_members,
        'smoothed', (SELECT count(*) FROM ras_final WHERE status = 'smoothed'),
        'fallbacks', v_fallback,
        'edges', v_edges,
        'sharedEdges', v_shared,
        'mergedPoints', v_merged,
        'insertedPoints', v_inserted,
        'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
    );
END;
$$;

-- Die Renderansicht: dieselben Spalten wie bisher (Migration 0052), nur die Form kommt für die Flächen der Topographie aus der
-- Ableitung. Hat eine Fläche keine frische Zeile (noch nicht abgeleitet, seither geändert), bleibt sie, wie sie ist: eckig.
-- Alles, was die Kachel dieser Quelle liest (Füllung, Kante, Überfahren, Auswahl), folgt damit derselben Form.
--
-- 🔴 Zwei Zweige, damit der Kachelrahmen den Index nutzen kann: Der erste liest die vorgerechnete Renderform als Spalte (GiST), der
-- zweite rechnet die übrigen Flächen wie bisher um. Ein COALESCE über einen äußeren Verbund hätte jede Form je Kachel gelesen und
-- umgerechnet. Die Reihenfolge ist die der Kennung wie vorher (deterministische Kachelbytes, Migration 0016).
CREATE OR REPLACE VIEW region_area_render AS
SELECT
    a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    s.render_geom AS geom,
    round(ST_Area(a.geom)::numeric, 2)::double precision AS area
FROM region_area a
JOIN region r ON r.id = a.region_id
JOIN region_area_smooth s
  ON s.region_area_id = a.id
 AND s.source_updated_at = a.updated_at
 AND region_area_is_smoothed(r.region_layer, r.region_type)
WHERE a.is_active
  AND r.is_active
UNION ALL
SELECT
    a.public_id,
    r.public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry, 3857),
    round(ST_Area(a.geom)::numeric, 2)::double precision
FROM region_area a
JOIN region r ON r.id = a.region_id
WHERE a.is_active
  AND r.is_active
  AND NOT EXISTS (
      SELECT 1
      FROM region_area_smooth s
      WHERE s.region_area_id = a.id
        AND s.source_updated_at = a.updated_at
        AND region_area_is_smoothed(r.region_layer, r.region_type)
  )
ORDER BY public_id;

COMMENT ON TABLE region_area_smooth IS
    'Die Landflächen der Topographie, nahtlos geglättet (WI-0055): Ränder verknotet, jede gemeinsame Kante einmal geglättet. Abgeleitet, nur Anzeige.';
COMMENT ON FUNCTION region_area_is_smoothed(text, text) IS
    'Welche Flächen geglättet werden: die der Ebene Topographie außer den Seen (WI-0055).';
COMMENT ON FUNCTION region_area_smooth_derive(text, boolean) IS
    'Leitet region_area_smooth ab (WI-0055); ohne Änderung der Eingaben rechnet sie nichts. Bericht als jsonb.';

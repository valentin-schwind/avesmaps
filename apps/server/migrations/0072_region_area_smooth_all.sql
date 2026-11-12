-- Alle Flächen nahtlos geglättet, Seen im selben Netz, Klimaübergänge als Kurven (WI-0077, Betreiber 2026-10-04:
-- „topographie, vegetation, derographie -> zeigen alle diesselben flächen und sind nur filter für die anzeige … ich will dass
-- alle flächen geglättet werden - und zwar auf die art und weise, die wir vorgeschlagen hatten. auch die klimazonen sollten auf
-- die art geglättet werden, dass ihre übergänge (nicht die ränder) zu kurven werden und direkt aneinander grenzen.“; „seen
-- gehören zur topographie und werden geglättet, gemeinsam angrenzend: ja“; „küsten sind normale flächen“; „klimazonen füllen
-- die ganze karte, ich will nicht, dass die kontrollpunkte and den ränder geglättet werden“).
--
-- 🔴 Die Quelle bleibt unverändert: `region_area`, `climate_divider` und `climate_band` werden nur gelesen. Glättung ist
-- abgeleitete Anzeige (Map Mutation Guard). Ein Editor bearbeitet die Stützpunkte der Quelle; danach rechnet die Ableitung
-- nur die geänderte Fläche und ihre Nachbarn neu (`npm run derive:land-smooth -- --areas <public_id>`, WI-0077).
--
-- Was diese Migration tut (erweitern, nichts entfernen):
--   1. `region_area_is_smoothed` nimmt alle Flächen aller Ebenen auf, Seen und Meere eingeschlossen. Die Rechnung selbst
--      steht seit WI-0077 in TypeScript (`apps/server/src/areas/smooth-net.ts`): Das gemeinsame Kantennetz über rund 5.000
--      Flächen brauchte in SQL (ST_UnaryUnion, ST_ClusterDBSCAN über alle Punkte) rund 400 MB im Datenbankprozess und
--      ließ sich nicht auf eine Fläche und ihre Nachbarn eingrenzen.
--   2. Das Rezept steigt auf v2: Jede vorhandene Zeile ist damit veraltet, und der nächste Lauf von I19 rechnet alles neu
--      (ohne `--force`). Bis dahin zeigt `region_area_render` die Flächen der Topographie mit der Form aus v1 und alle übrigen
--      eckig, wie bisher.
--   3. `terrain_water_render` zeigt Seen und Meere in der Form aus dem Netz, also mit demselben Ufer wie die Fläche daneben.
--      Ohne frische Zeile bleibt es die einzeln geglättete Form von bisher (`terrain_water_smooth`). Die Höhenlinien schneidet
--      weiter `terrain_water_smooth` ab (I13 läuft vor I19, WI-0077 „Wasser-Ebene“).
--   4. Die Klimabänder bekommen eine geglättete Anzeigeform (`climate_band_smooth`): jeder Teiler einmal geglättet (Chaikin,
--      drei Durchgänge, Endpunkte fest) und von beiden Zonen benutzt; die Endpunkte am Kartenrand und der Rand selbst bleiben,
--      wie sie sind. `climate_band_render` zeigt sie, solange sie zum Fingerabdruck der Bänder passt, sonst das Band.
--
-- `region_area_smooth_derive` (Migration 0067) bleibt für den Rückweg stehen; die neue Ableitung ruft sie nicht mehr.
-- Entfernen in einem späteren Release (AGENTS.md, „erst erweitern, dann umstellen, dann entfernen“).
--
-- 🪤 Martin cacht Kacheln und liest seinen Katalog beim Start: nach dieser Migration und nach der Ableitung neu starten.

-- 1. Alle Flächen im Netz.
CREATE OR REPLACE FUNCTION region_area_is_smoothed(p_layer TEXT, p_type TEXT) RETURNS BOOLEAN
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT true $$;

COMMENT ON FUNCTION region_area_is_smoothed(text, text) IS
    'Welche Flächen geglättet werden: alle Flächen aller Ebenen, Seen und Meere eingeschlossen (WI-0077; vorher nur die Topographie ohne Seen, WI-0055).';

-- 2. Das Rezept des Netzes in TypeScript: Zusammenführen und T-Stöße auf 0,001 E, Ketten nach Eigentümern, Chaikin drei
--    Durchgänge, Douglas-Peucker 0,004 E, Kartenrand fest (0,125 E).
CREATE OR REPLACE FUNCTION region_area_smooth_recipe() RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT 'v2 net-all chaikin3 simplify0.004 merge0.001 chains frame0.125' $$;

COMMENT ON TABLE region_area_smooth IS
    'Alle Flächen, nahtlos geglättet (WI-0055, WI-0077): ein Kantennetz über alle Ebenen, jede gemeinsame Kette einmal geglättet. Abgeleitet, nur Anzeige; region_area bleibt.';
COMMENT ON FUNCTION region_area_smooth_derive(text, boolean) IS
    'Abgelöst durch die Ableitung in TypeScript (WI-0077, apps/server/src/areas/smooth.ts); bleibt für den Rückweg und fällt in einem späteren Release.';

-- 3. Das Wasser aus demselben Netz. Zwei Zweige wie in `region_area_render`, damit der Kachelrahmen den Index der
--    vorgerechneten Renderform nutzt; ohne frische Zeile die einzeln geglättete Form von bisher.
CREATE OR REPLACE VIEW terrain_water_render AS
SELECT
    a.public_id,
    r.region_type,
    s.render_geom AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(ST_Area(a.geom)::numeric, 2)::double precision AS area
FROM region_area a
JOIN region r ON r.id = a.region_id
JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at
WHERE a.is_active AND r.is_active AND r.region_type IN ('see', 'meer')
UNION ALL
SELECT
    a.public_id,
    r.region_type,
    map_domain_to_render(a.map_domain_id, terrain_water_smooth(a.geom))::geometry(Geometry, 3857),
    r.public_id,
    r.name,
    round(ST_Area(a.geom)::numeric, 2)::double precision
FROM region_area a
JOIN region r ON r.id = a.region_id
WHERE a.is_active AND r.is_active AND r.region_type IN ('see', 'meer')
  AND NOT EXISTS (
      SELECT 1 FROM region_area_smooth s WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at
  )
ORDER BY public_id;

COMMENT ON VIEW terrain_water_render IS
    'Seen und Meere in der Form aus dem gemeinsamen Netz (WI-0077), dasselbe Ufer wie die Fläche daneben; ohne frische Ableitung einzeln geglättet (terrain_water_smooth).';

-- 4. Die Klimabänder, geglättet. Abgeleitet aus `climate_divider` und der Reihenfolge der Zonen, wie `climate_band` selbst
--    (`deriveBands`, WI-0005); `climate_band` bleibt die Rechengrundlage (Routing, Seewege, Zuordnung) und unverändert.
--
--    🪤 Nicht jedes Band einzeln aus seinen beiden Linien: In Legacys Daten laufen drei Teiler über weite Strecken fast
--    aufeinander (Steppen-, Wüsten- und Tropengrenze, gemessen 0,00002 bis 0,002 E auseinander). Einzeln geglättet kreuzen sie
--    sich dort, die Bänder überlappen (gemessen 1.000 E²) und eines wird ungültig. Deshalb: Jeder Teiler wird einmal geglättet,
--    die Fläche südlich von ihm (bis zum Kartenrand) ist eine Halbebene, und jede Halbebene liegt in der vorigen (geschnitten,
--    falls die Glättung sie herausschiebt). Ein Band ist die Halbebene seines oberen Teilers ohne die seines unteren. So füllen
--    die Bänder die Karte lückenlos und ohne Überlappung, benachbarte Zonen benutzen dieselbe Linie, und wo zwei Teiler fast
--    aufeinanderlagen, liegen sie jetzt aufeinander (das Band dazwischen war dort ohnehin unsichtbar). Ein Band kann dabei in
--    Teile zerfallen; die Renderansicht liefert jeden Teil als eigene Zeile.
CREATE TABLE IF NOT EXISTS climate_band_smooth (
    type_key TEXT PRIMARY KEY REFERENCES climate_zone_type (type_key) ON DELETE CASCADE,
    -- Die geglättete Form im Kartenraum (SRID 0), gültig, ein oder mehrere Teile; bei einem Rückfall das Band selbst.
    geom geometry(Geometry, 0) NOT NULL,
    -- Der Fingerabdruck des Bands, aus dem sie entstand (`climate_band.source_fingerprint`): Weicht er ab, ist sie veraltet,
    -- und die Renderansicht zeigt das Band.
    source_fingerprint TEXT NOT NULL,
    recipe TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('smoothed', 'fallback_invalid')),
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT climate_band_smooth_is_surface CHECK (GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON'))
);

COMMENT ON TABLE climate_band_smooth IS
    'Die Klimabänder mit geglätteten Übergängen (WI-0077): jeder Teiler einmal geglättet, Endpunkte am Kartenrand fest, Bänder als Differenz geschachtelter Halbebenen. Abgeleitet, nur Anzeige; climate_band bleibt.';

CREATE OR REPLACE FUNCTION climate_band_smooth_recipe() RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT 'v1 divider chaikin3 simplify0.004 ends-fixed nested' $$;

-- Veraltet: ein Band ohne frische Zeile (anderer Fingerabdruck, anderes Rezept) oder eine Zeile ohne Band.
CREATE OR REPLACE FUNCTION climate_band_smooth_is_stale() RETURNS BOOLEAN
    LANGUAGE sql STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM climate_band b
        WHERE NOT EXISTS (
            SELECT 1 FROM climate_band_smooth s
            WHERE s.type_key = b.type_key AND s.source_fingerprint = b.source_fingerprint
              AND s.recipe = climate_band_smooth_recipe()
        )
    ) OR EXISTS (
        SELECT 1 FROM climate_band_smooth s WHERE NOT EXISTS (SELECT 1 FROM climate_band b WHERE b.type_key = s.type_key)
    )
$$;

-- Die Ableitung. Bericht als jsonb; ohne Änderung der Bänder rechnet sie nichts (`p_force` erzwingt es). Misslingt ein Band
-- (leer oder ungültig), behalten alle ihre Ausgangsform: Ein einzelnes eckiges Band zwischen geglätteten Nachbarn ließe Spalten.
CREATE OR REPLACE FUNCTION climate_band_smooth_derive(p_force BOOLEAN DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Dieselbe Rundung wie die Flächen: Chaikin, drei Durchgänge, auf einen halben Bildpunkt der größten Zoomstufe vereinfacht.
    c_passes CONSTANT integer := 3;
    c_resolution CONSTANT double precision := 0.004;
    -- Der Kartenrand (`climate.ts`, MAP_MIN/MAX): Die Teiler laufen von x = 0 bis x = 1024, die Bänder füllen die Karte.
    c_min CONSTANT double precision := 0;
    c_max CONSTANT double precision := 1024;
    v_started timestamptz := clock_timestamp();
    v_map geometry := ST_MakeEnvelope(c_min, c_min, c_max, c_max, 0);
    v_above geometry;
    v_below geometry;
    v_band geometry;
    v_failed integer := 0;
    v_zone record;
    v_report jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('avesmaps3d:climate_band_smooth'));
    IF NOT p_force AND NOT climate_band_smooth_is_stale() THEN
        RETURN jsonb_build_object(
            'computed', false,
            'recipe', climate_band_smooth_recipe(),
            'bands', (SELECT count(*) FROM climate_band_smooth),
            'smoothed', (SELECT count(*) FROM climate_band_smooth WHERE status = 'smoothed'),
            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
        );
    END IF;

    -- Jeder Teiler genau einmal geglättet, seine Enden am Kartenrand fest, und die Fläche südlich von ihm bis zum Rand.
    DROP TABLE IF EXISTS cbs_half, cbs_out;
    CREATE TEMP TABLE cbs_half ON COMMIT DROP AS
        SELECT d.south_type_key AS type_key, half.g
        FROM climate_divider d
        CROSS JOIN LATERAL (
            SELECT ST_SimplifyPreserveTopology(ST_ChaikinSmoothing(d.geom, c_passes, true), c_resolution) AS line
        ) smooth
        CROSS JOIN LATERAL (
            SELECT ST_MakePolygon(ST_RemoveRepeatedPoints(ST_MakeLine(ARRAY[
                smooth.line,
                ST_MakeLine(ARRAY[
                    ST_EndPoint(smooth.line),
                    ST_SetSRID(ST_MakePoint(c_max, c_min), 0),
                    ST_SetSRID(ST_MakePoint(c_min, c_min), 0),
                    ST_StartPoint(smooth.line)
                ])
            ]))) AS raw_half
        ) built
        CROSS JOIN LATERAL (
            SELECT CASE WHEN ST_IsValid(built.raw_half) THEN built.raw_half
                        ELSE ST_CollectionExtract(ST_MakeValid(built.raw_half, 'method=structure'), 3) END AS g
        ) half;

    CREATE TEMP TABLE cbs_out (type_key TEXT, source_fingerprint TEXT, raw geometry, g geometry) ON COMMIT DROP;
    -- Von Nord nach Süd: Oben liegt die ganze Karte, unten die Halbebene des nächsten Teilers, geschnitten mit der oberen.
    v_above := v_map;
    FOR v_zone IN
        SELECT b.type_key, b.geom AS raw, b.source_fingerprint, lead(b.type_key) OVER (ORDER BY t.sort_order) AS next_key
        FROM climate_band b
        JOIN climate_zone_type t ON t.type_key = b.type_key
        ORDER BY t.sort_order
    LOOP
        IF v_zone.next_key IS NULL THEN
            v_below := NULL;
            v_band := v_above;
        ELSE
            SELECT ST_CollectionExtract(ST_Intersection(h.g, v_above), 3) INTO v_below FROM cbs_half h WHERE h.type_key = v_zone.next_key;
            v_band := CASE WHEN v_below IS NULL THEN v_above ELSE ST_CollectionExtract(ST_Difference(v_above, v_below), 3) END;
        END IF;
        -- Ein Rest von Fläche null (die Differenz zweier fast gleicher Ränder) ist kein Teil des Bands.
        SELECT ST_Multi(ST_Collect(part.geom)) INTO v_band FROM ST_Dump(v_band) part WHERE ST_Area(part.geom) > 1e-6;
        INSERT INTO cbs_out VALUES (v_zone.type_key, v_zone.source_fingerprint, v_zone.raw, v_band);
        IF v_band IS NULL OR ST_IsEmpty(v_band) OR NOT ST_IsValid(v_band) THEN
            v_failed := v_failed + 1;
        END IF;
        v_above := COALESCE(v_below, v_above);
    END LOOP;

    DELETE FROM climate_band_smooth;
    INSERT INTO climate_band_smooth (type_key, geom, source_fingerprint, recipe, status)
        SELECT type_key,
               CASE WHEN v_failed = 0 THEN ST_SetSRID(g, 0) ELSE ST_SetSRID(raw, 0) END,
               source_fingerprint, climate_band_smooth_recipe(),
               CASE WHEN v_failed = 0 THEN 'smoothed' ELSE 'fallback_invalid' END
        FROM cbs_out;

    SELECT jsonb_build_object(
        'computed', true,
        'recipe', climate_band_smooth_recipe(),
        'bands', count(*),
        'smoothed', count(*) FILTER (WHERE status = 'smoothed'),
        'fallbacks', count(*) FILTER (WHERE status <> 'smoothed'),
        'parts', sum(ST_NumGeometries(geom)),
        -- Die Bänder füllen die Karte lückenlos und ohne Überlappung: Summe der Flächen gegen die Karte, in E².
        'area', round(sum(ST_Area(geom))::numeric, 3),
        'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
    ) INTO v_report FROM climate_band_smooth;
    RETURN v_report;
END;
$$;

COMMENT ON FUNCTION climate_band_smooth_derive(boolean) IS
    'Leitet climate_band_smooth ab (WI-0077): Teiler einmal geglättet, Endpunkte am Kartenrand fest, Bänder als Differenz geschachtelter Halbebenen; ohne Änderung der Bänder rechnet sie nichts.';

-- Die Renderansicht der Bänder: dieselben Spalten wie bisher (Migration 0016), die Form aus der Ableitung, solange sie zum Band
-- passt. Ein Band aus mehreren Teilen steht mit einer Zeile je Teil darin (dieselbe Zone, dieselbe Farbe). Acht Bänder: ein
-- äußerer Verbund kostet hier nichts.
CREATE OR REPLACE VIEW climate_band_render AS
SELECT
    b.type_key,
    t.label,
    t.sort_order,
    map_domain_to_render('aventuria', part.geom)::geometry(Polygon, 3857) AS geom
FROM climate_band b
JOIN climate_zone_type t ON t.type_key = b.type_key
LEFT JOIN climate_band_smooth s ON s.type_key = b.type_key AND s.source_fingerprint = b.source_fingerprint
CROSS JOIN LATERAL ST_Dump(COALESCE(s.geom, b.geom)) part
WHERE t.is_active
ORDER BY b.type_key, part.path;

COMMENT ON VIEW climate_band_render IS
    'Klimabänder für die Kachel (WI-0005); seit WI-0077 mit geglätteten Übergängen, solange climate_band_smooth zum Band passt, eine Zeile je Teil. Niemals Source of Truth.';

-- Deterministische Kachelbytes: eine feste Zeilenreihenfolge für jede Renderrelation.
--
-- 💣 Ohne Sortierung liefert dieselbe Datenlage auf zwei Maschinen VERSCHIEDENE Kacheln. Am
-- 2026-09-21 an `place_render/5/17/16` gemessen: Stage und localhost, gleiche Größe (1721 Byte),
-- anderer Hash; die Zeichenketten beider Kacheln sortiert verglichen ergaben 61 identische
-- Einträge. Dieselben Orte, dieselben Eigenschaften, andere Anordnung.
--
-- Nachgemessen über sechs Ausführungspläne (Seq Scan, Index Scan, ohne Index, jeweils auch mit
-- erzwungener Parallelität): VIER der fünf Relationen wechseln die Reihenfolge, sobald der Plan
-- sich ändert. Dass `map_label_render` stabil blieb, war Glück, keine Zusage.
--
-- Das kostet zweimal:
--   * Der Unveränderlichkeitsnachweis des Staging-Deploys vergleicht Probekacheln byteweise. Eine
--     unsortierte Relation schlägt dort Alarm, ohne dass sich etwas geändert hat - und an solche
--     Fehlalarme gewöhnt man sich.
--   * Bei gleichrangigen Symbolen entscheidet die Reihenfolge mit, welches Label eine Kollision
--     gewinnt. Zwei Umgebungen mit identischen Daten könnten unterschiedliche Namen zeigen.
--
-- 🔴 DER SCHLÜSSEL IST EIN TIE-BREAKER, KEINE PRIORITÄT. `public_id` ordnet nur, damit überhaupt
-- eine feste Reihenfolge existiert; aus ihr folgt NICHTS über die fachliche Wichtigkeit eines
-- Labels. Wer hier später eine Rangfolge hineinliest oder hineinschreibt, vermischt zwei Dinge:
-- die Kollisionspriorität gehört in `symbol-sort-key` im Style, nicht in die Zeilenreihenfolge der
-- Kachel (siehe WI-0007).
--
-- 🪤 Warum ORDER BY in der SICHT und nicht im Aggregat: Martin baut das `ST_AsMVT` für eine Sicht
-- selbst, dort kommt keine eigene Sortierung hinein. Formal garantiert PostgreSQL nicht, dass die
-- Sortierung einer Subquery im äußeren Ergebnis erhalten bleibt - gemessen hält sie über alle
-- sechs Pläne, auch mit `Gather Merge`. Wo wir das Aggregat selbst schreiben (die Kachelfunktion
-- unten), steht die Sortierung deshalb IM AGGREGAT, wo sie zugesichert ist.

-- `place_render` (0009)
CREATE OR REPLACE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom
FROM place p
WHERE p.is_active
ORDER BY p.public_id;

-- `region_area_render` (0010)
CREATE OR REPLACE VIEW region_area_render AS
SELECT
    a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry, 3857) AS geom
FROM region_area a
JOIN region r ON r.id = a.region_id
WHERE a.is_active
  AND r.is_active
ORDER BY a.public_id;

-- `map_label_render` (0013)
CREATE OR REPLACE VIEW map_label_render AS
SELECT
    l.public_id,
    l.name,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    EXISTS (SELECT 1 FROM landscape_label_run r WHERE r.region_id = l.region_id) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point, 3857) AS geom
FROM map_label l
LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
WHERE l.is_active
ORDER BY l.public_id;

-- `climate_band_render` (0015). `type_key` ist hier der stabile Schlüssel; `sort_order` ist die
-- fachliche Nord-Süd-Ordnung und bliebe bei gleichem Wert mehrdeutig.
CREATE OR REPLACE VIEW climate_band_render AS
SELECT
    b.type_key,
    t.label,
    t.sort_order,
    map_domain_to_render('aventuria', b.geom)::geometry(Polygon, 3857) AS geom
FROM climate_band b
JOIN climate_zone_type t ON t.type_key = b.type_key
WHERE t.is_active
ORDER BY b.type_key;

-- `landscape_label_run_render` (0012). Sortiert wird nach dem FACHLICHEN Schlüssel, nicht nach
-- `run_id`: die Sequenz vergibt bei jeder Neuableitung andere Zahlen, während Region, Instanzzahl
-- und Instanz dieselbe Kurve bezeichnen. Eine Neuableitung derselben Geometrie ergibt damit
-- dieselbe Kachel.
CREATE OR REPLACE VIEW landscape_label_run_render AS
SELECT
    r.id AS run_id,
    reg.public_id AS region_public_id,
    l.name,
    reg.region_layer,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom
FROM landscape_label_run r
JOIN region reg ON reg.id = r.region_id
JOIN map_label l ON l.id = r.style_label_id
WHERE reg.is_active
  AND l.is_active
ORDER BY reg.public_id, r.instance_count, r.instance;

-- Die Kachelfunktion schreibt ihr Aggregat selbst, also steht die Sortierung dort, wo PostgreSQL
-- sie zusichert: als ORDER BY INNERHALB von `ST_AsMVT`. Die Sortierung der Sicht darüber würde
-- durch den LATERAL-Join und den Zuschnitt ohnehin nicht durchgereicht.
CREATE OR REPLACE FUNCTION landscape_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    -- Eine Kachel ist auf jeder Stufe 512 Bildschirmpixel breit; daraus wird aus Pixeln eine Länge
    -- in projizierten Einheiten, ohne dass die Funktion die Schriftart kennen müsste.
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'landscape_label_run' ORDER BY source.region_public_id, source.instance_count, source.instance)
    INTO tile
    FROM (
        SELECT
            run.run_id,
            run.region_public_id,
            run.name,
            run.region_layer,
            run.label_size,
            run.label_priority,
            run.instance,
            run.instance_count,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM landscape_label_run_render run
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

COMMENT ON FUNCTION landscape_label_run_tile(integer, integer, integer) IS
    'Schriftläufe je Zoom zugeschnitten, unbeschnitten ausgeliefert (ADR-0007). Feste Reihenfolge über das Aggregat: region_public_id, instance_count, instance - ein Tie-Breaker für gleiche Kachelbytes, keine Label-Priorität.';

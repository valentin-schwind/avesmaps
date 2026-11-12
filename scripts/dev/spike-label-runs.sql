-- Spike harness for ADR-0007: does a derived type run survive the real tile path?
--
-- 💣 NOT SCHEMA. This is a measurement fixture for the development database, applied and dropped by
-- scripts/dev/spike-label-runs.mjs. It is deliberately outside apps/server/migrations, because the
-- model it explores is not decided yet. When ADR-0007 is accepted, the real tables come as ordinary
-- migrations and this file goes away.
--
-- It publishes three Martin function sources for the same fixture, so the browser can compare them:
--
--   spike_run_clipped  the naive path - whole run, Martin's own clipping, default buffer
--   spike_run_owned    trimmed, unclipped, and elected to one tile here in SQL - measured, rejected
--   spike_run_shared   trimmed, unclipped, delivered to every touching tile - the chosen path
--
-- ⭐ What the real stack taught, and the browser-only spike could not: MapLibre elects the tile
-- itself. `addSymbolAtAnchor` drops a symbol whose anchor falls outside its own tile extent, in its
-- own words "to prevent double-drawing symbols". The test is half-open, so of all the tiles that
-- carry a run, exactly one holds its middle and exactly one draws the name.
--
-- So the duplication was never caused by buffers. It was caused by *clipping*: a clipped run
-- becomes several different lines, each with its own middle, each inside its own tile. Deliver the
-- same geometry unclipped to every tile that touches it and they all agree where the middle is.
--
-- Electing the tile in SQL (spike_run_owned) is therefore not needed, and measuring it showed it is
-- worse than not doing it: MapLibre recomputes the middle from the delivered, integer-rounded
-- geometry, and where our arithmetic and its own disagreed by a rounding step, the name was lost
-- entirely (fixture "medium" at zoom 8). The function stays in this harness as the record of that.

DROP FUNCTION IF EXISTS spike_run_clipped(integer, integer, integer);
DROP FUNCTION IF EXISTS spike_run_owned(integer, integer, integer);
DROP FUNCTION IF EXISTS spike_run_shared(integer, integer, integer);
DROP FUNCTION IF EXISTS spike_run_owns(geometry, integer, integer, integer);
DROP FUNCTION IF EXISTS spike_run_target_metres(integer);
DROP TABLE IF EXISTS spike_label_run;

CREATE TABLE spike_label_run (
    id            TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Map coordinates, exactly like place.geom. The render projection is applied per tile.
    geom          geometry(LineString, 0) NOT NULL
);

COMMENT ON TABLE spike_label_run IS
    'Spike fixture for ADR-0007. Not part of the schema; see scripts/dev/spike-label-runs.sql.';

/*
 * How long the emitted run has to be, in projected units at this zoom.
 *
 * The number is constant in screen pixels, and therefore constant in tile units, because a tile is
 * 512 screen pixels at every zoom. 480 is the reference name ("DRACHENSTEINE" at 28px with 0.3em
 * tracking is about 360px) times the 1.3 legacy keeps as headroom.
 *
 * In the real model this comes from the landscape band table rather than from a constant here.
 */
CREATE FUNCTION spike_run_target_metres(z integer)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT 480.0 * (2 * 20037508.342789244) / (512.0 * power(2, z));
$$;

/*
 * Which tile owns an anchor.
 *
 * 🪤 Measured on the real stack: `ST_Intersects(anchor, ST_TileEnvelope(...))` is **not** an
 * ownership test. An anchor that lands exactly on a tile edge intersects both neighbours, and one
 * of the fixture runs does exactly that - its middle sits on the vertical boundary that every zoom
 * shares. The result was two tiles, two anchors, two names: the very duplicate this path exists to
 * prevent, reappearing at the one position nobody probes by hand.
 *
 * Deriving the tile index from the coordinate instead makes ownership total and exclusive: every
 * anchor belongs to exactly one tile, edges included.
 */
CREATE FUNCTION spike_run_owns(anchor geometry, z integer, x integer, y integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT LEAST(GREATEST(floor((ST_X(anchor) + 20037508.342789244) / tile.width)::int, 0), tile.last) = x
       AND LEAST(GREATEST(floor((20037508.342789244 - ST_Y(anchor)) / tile.width)::int, 0), tile.last) = y
    FROM (
        SELECT (2 * 20037508.342789244) / power(2, z) AS width, (power(2, z) - 1)::int AS last
    ) tile;
$$;

/*
 * The naive path, for comparison: the whole run, clipped by Martin the way it clips everything.
 * A run that leaves the tile is cut here, and every fragment carries its own centre anchor.
 */
CREATE FUNCTION spike_run_clipped(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'spike_run_clipped') INTO tile
    FROM (
        SELECT
            run.id,
            run.label,
            ST_AsMVTGeom(projected.geom, envelope, 4096, 256, true) AS geom
        FROM spike_label_run run
        CROSS JOIN LATERAL (
            SELECT map_domain_to_render(run.map_domain_id, run.geom) AS geom
        ) projected
        WHERE ST_Intersects(projected.geom, envelope)
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

/*
 * The rejected variant: elect the owning tile here in SQL.
 *
 * It looks like the tighter rule - one anchor, one tile, no reliance on the renderer - and it is
 * the one that lost a name. MapLibre does not use our anchor; it recomputes the middle from the
 * delivered geometry after ST_AsMVTGeom has rounded every coordinate to the integer tile grid. Where
 * that recomputed middle falls a rounding step on the other side of the edge from where our
 * arithmetic put it, the elected tile discards the symbol and no other tile carries it.
 *
 * Kept because a rejected alternative that was measured is worth more than one that was argued.
 */
CREATE FUNCTION spike_run_owned(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    target double precision := spike_run_target_metres(z);
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'spike_run_owned') INTO tile
    FROM (
        SELECT
            run.id,
            run.label,
            ST_AsMVTGeom(ST_LineSubstring(projected.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM spike_label_run run
        CROSS JOIN LATERAL (
            SELECT map_domain_to_render(run.map_domain_id, run.geom) AS geom
        ) projected
        CROSS JOIN LATERAL (
            SELECT
                GREATEST(0.0, 0.5 - (target / 2.0) / ST_Length(projected.geom)) AS lo,
                LEAST(1.0, 0.5 + (target / 2.0) / ST_Length(projected.geom)) AS hi
        ) cut
        WHERE ST_Length(projected.geom) >= target
          AND spike_run_owns(ST_LineInterpolatePoint(projected.geom, 0.5), z, x, y)
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

/*
 * The chosen path.
 *
 * 1. Trim around the middle to the target length, so the emitted geometry is bounded however long
 *    the stored run is. The trim depends on the zoom alone, never on x or y - which is what makes
 *    every tile agree on the result.
 * 2. Emit unclipped (clip_geom => false), to every tile within half a run of the middle. All of
 *    them carry the identical line, so all of them compute the identical middle.
 * 3. Let MapLibre elect: exactly one of those tiles holds that middle inside its own extent, and
 *    the others drop the symbol by its own anti-double-drawing rule.
 *
 * A run too short to carry its name at this zoom is left out on purpose rather than emitted and
 * silently dropped by the renderer - that is invariant I2, made operational.
 */
CREATE FUNCTION spike_run_shared(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    target double precision := spike_run_target_metres(z);
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'spike_run_shared') INTO tile
    FROM (
        SELECT
            run.id,
            run.label,
            ST_AsMVTGeom(ST_LineSubstring(projected.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM spike_label_run run
        CROSS JOIN LATERAL (
            SELECT map_domain_to_render(run.map_domain_id, run.geom) AS geom
        ) projected
        CROSS JOIN LATERAL (
            SELECT
                GREATEST(0.0, 0.5 - (target / 2.0) / ST_Length(projected.geom)) AS lo,
                LEAST(1.0, 0.5 + (target / 2.0) / ST_Length(projected.geom)) AS hi
        ) cut
        WHERE ST_Length(projected.geom) >= target
          AND ST_Intersects(ST_LineInterpolatePoint(projected.geom, 0.5), ST_Expand(envelope, target / 2.0))
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

/*
 * The fixture: five gently curved runs in map coordinates.
 *
 * `len` is the length in map units, and the domain is 1024 units across. A tile holds 1024 / 2^z of
 * those, so the same run is well inside one tile at a low zoom and spans dozens at a high one -
 * which is the whole point. `corner` sits exactly on a tile corner at every zoom that divides 512,
 * because a run that behaves in the middle of a tile has proved nothing.
 */
INSERT INTO spike_label_run (id, label, map_domain_id, geom)
SELECT
    fixture.id,
    fixture.label,
    'aventuria',
    ST_MakeLine(ARRAY(
        SELECT ST_MakePoint(
            fixture.cx - fixture.len / 2.0 + (step / 64.0) * fixture.len,
            fixture.cy + sin(step / 64.0 * pi()) * fixture.bulge
        )
        FROM generate_series(0, 64) AS step
    ))::geometry(LineString, 0)
FROM (VALUES
    ('short',   'DRACHENSTEINE', 300.0, 300.0,  20.0,  2.0),
    ('medium',  'KOSCHBERGE',    700.0, 300.0,  80.0,  8.0),
    ('long',    'SCHWARZE SICHEL', 500.0, 700.0, 300.0, 30.0),
    ('huge',    'RASCHTULSWALL', 512.0, 880.0, 600.0, 45.0),
    ('corner',  'FINSTERKAMM',   512.0, 512.0, 300.0, 25.0)
) AS fixture (id, label, cx, cy, len, bulge);

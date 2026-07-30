<?php

declare(strict_types=1);

// V13 -- open water for the routing request, so a synthetic „Querfeldein" edge cannot be built
// across the sea. Spec: docs/superpowers/specs/2026-07-29-landschaften-v13-wasser-design.md.
//
// Three things live here, in the order the request uses them:
//   1. avesmapsLoadRouteWater()        -- read the water areas (DB), prepare them, never throw
//   2. avesmapsPrepareRouteWater()     -- pure: rows -> edges + bbox + grid
//   3. avesmapsRouteChordCrossesWater()-- pure: does this straight chord run through open water?
//
// The maths is NOT here. It is the V9 core, ported in api/_internal/app/ecosystem-line-intervals.php,
// which this file requires. A cross-country edge is a two-point line, so it is the same question V9
// already answers for ways -- no second geometry engine.

require_once __DIR__ . '/../app/ecosystem-line-intervals.php';

// ============================================================ the two screws the owner may turn
//
// Both were measured against the live stock on 2026-07-29 (spec §9). They are named constants and
// not numbers in the code precisely because the right value is a judgement, not a measurement.

// A harbour town is drawn ON the coast and the sea polygon is drawn generously over it: 571 of 4.653
// places sit geometrically INSIDE water, 55 of them named -- Belhanka, Kuslik, Salzerhaven, Neersand,
// Yaisirabad. Water within this distance of either END of a chord is therefore coastal drawing slop,
// not a crossing, and is ignored.
//
// 🔴 The distribution has NO natural step -- this is a judgement. Safe span 0 < T <= 3,0. Measured:
// at T = 1,0 exactly 23 bridges come back and all 23 are coastal hops (Kuslik, Arlinsburg, Silthrin,
// Senan, Charasim, Burg Weissenstein, Forstwehr, Qinsay); all 7 real sea crossings stay blocked. At
// T = 5,0 four of those 7 start passing again -- that is the ceiling, and it is why this is not 5.
//
// ⚠️ Consequence that belongs on the record: a chord shorter than 2 x T can never be refused, because
// nothing is left between the two clipped ends. At T = 1,0 that means hops under 2 units (~6 km)
// always pass. One real borderline case exists (Theron -> Raluenk, 1,92 units, 99 % wet). Carried
// deliberately: the x25 cost factor on Querfeldein makes such hops expensive anyway.
const AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE = 1.0;   // map units (1 unit = 3.000 Schritt)

// How many nearest candidate pairs to try when the nearest one turns out to be wet.
//
// 💣 An UNBOUNDED search is the real cost trap: measured 17 s (all transports) to 47 s (land only),
// because the hopeless components try every pair before giving up. But when an alternative exists it
// is found early -- median rank 3, p90 rank 9, max rank 16. Measured yield: cap 10 finds 26 of 85,
// cap 25 finds 28, cap 250 also finds 28 for ten times the work. 25 buys everything there is.
// Safe span 10 ... 50.
const AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT = 25;

// Cell width of the water lookup grid, in map units. 329 areas over a 1024-unit map land at 963
// cells and 2,1 areas per cell instead of 329 in a linear scan; building it costs 0,6 ms per request.
const AVESMAPS_ROUTE_WATER_GRID_CELL = 32.0;

// Water is `meer` + `see`. NOT `kueste` (that would block every coastal way), not `kontinent`, not
// `insel`. See avesmapsLoadRouteWater() for the two filters that are easy to get wrong.
const AVESMAPS_ROUTE_WATER_REGION_TYPES = ['meer', 'see'];

// ============================================================ 1. the read path

/**
 * Water areas for this request, already prepared. Returns the empty structure on ANY problem.
 *
 * ⭐ Failing inert is the designed behaviour, not laziness: if the table is missing, the query fails
 * or the stock is empty, V13 must vanish and the planner must behave exactly as it did before. A
 * routing request may never 500 because the landscape layer had a bad day.
 */
function avesmapsLoadRouteWater(array $config, ?PDO $pdo = null): array {
    try {
        $pdo ??= avesmapsCreatePdo($config['database'] ?? []);

        // 💣 NO DDL on this path. The ecosystem module owns those tables; if they do not exist yet
        // the query throws, we catch, and V13 is inert. Creating them here would put a write on the
        // hottest read in the house.
        $statement = $pdo->prepare(
            'SELECT a.geometry_geojson, a.min_x, a.min_y, a.max_x, a.max_y
             FROM ecosystem_area a
             INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
             WHERE a.is_active = 1
               AND a.is_trial = 0
               AND r.region_type IN (' . implode(', ', array_fill(0, count(AVESMAPS_ROUTE_WATER_REGION_TYPES), '?')) . ')'
        );
        $statement->execute(AVESMAPS_ROUTE_WATER_REGION_TYPES);

        $rows = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
            if (!is_array($geometry)) { continue; }
            $rows[] = [
                'geometry' => $geometry,
                'min_x' => (float) ($row['min_x'] ?? 0.0),
                'min_y' => (float) ($row['min_y'] ?? 0.0),
                'max_x' => (float) ($row['max_x'] ?? 0.0),
                'max_y' => (float) ($row['max_y'] ?? 0.0),
            ];
        }

        return avesmapsPrepareRouteWater($rows);
    } catch (Throwable) {
        return avesmapsPrepareRouteWater([]);
    }
}

// 💣 Two filters in the query above are easy to get wrong, and both were:
//
//   * `affects_paths` is NOT asked for. That is V9's compute-run filter and it stands at 0 for
//     `meer` -- exactly the areas this feature is about. Adding it here builds a feature that does
//     nothing.
//   * `is_trial = 0` IS asked for. Trial areas are experiments (V3.5); routing must not change
//     because somebody is trying something out. Side benefit: 4.100 of 13.472 edges (30 %) drop out.
//
// `ecosystem_enabled` is deliberately NOT read: that switch governs whether the LAYER is visible,
// not whether the world has oceans.

// ============================================================ 2. preparation (pure)

/**
 * Rows -> areas (edges + bbox) plus a grid over them. Built once per request.
 *
 * Each row needs `geometry` (decoded GeoJSON) and `min_x`/`min_y`/`max_x`/`max_y`.
 * ⚠️ snake_case, as the DB columns and the public payload spell it -- never `minX`.
 */
function avesmapsPrepareRouteWater(array $rows): array {
    $areas = [];
    foreach ($rows as $row) {
        if (!is_array($row)) { continue; }
        $geometry = is_array($row['geometry'] ?? null) ? $row['geometry'] : [];
        $edges = avesmapsEcosystemAreaEdges($geometry);
        if ($edges === []) { continue; }        // a label point is not an area
        $areas[] = [
            'edges' => $edges,
            'min_x' => (float) ($row['min_x'] ?? 0.0),
            'min_y' => (float) ($row['min_y'] ?? 0.0),
            'max_x' => (float) ($row['max_x'] ?? 0.0),
            'max_y' => (float) ($row['max_y'] ?? 0.0),
        ];
    }

    $grid = [];
    foreach ($areas as $index => $area) {
        $cellMinX = (int) floor($area['min_x'] / AVESMAPS_ROUTE_WATER_GRID_CELL);
        $cellMaxX = (int) floor($area['max_x'] / AVESMAPS_ROUTE_WATER_GRID_CELL);
        $cellMinY = (int) floor($area['min_y'] / AVESMAPS_ROUTE_WATER_GRID_CELL);
        $cellMaxY = (int) floor($area['max_y'] / AVESMAPS_ROUTE_WATER_GRID_CELL);
        for ($cellX = $cellMinX; $cellX <= $cellMaxX; $cellX++) {
            for ($cellY = $cellMinY; $cellY <= $cellMaxY; $cellY++) {
                $grid[$cellX . ':' . $cellY][$index] = $index;
            }
        }
    }

    return ['areas' => $areas, 'grid' => $grid];
}

// ============================================================ 3. the question (pure)

/**
 * Does the straight chord from (x1,y1) to (x2,y2) run through open water?
 *
 * The wet stretches reported by the V9 core are clipped to [T, length - T]; anything left over is a
 * crossing. Empty water -> always false, so the caller needs no special case.
 */
function avesmapsRouteChordCrossesWater(float $x1, float $y1, float $x2, float $y2, array $water): bool {
    $areas = $water['areas'] ?? [];
    if ($areas === []) { return false; }

    // The coastal tolerance, applied before any geometry: with nothing left between the clipped ends
    // there is no crossing to find. This is also what makes a chord shorter than 2 x T always dry.
    $length = hypot($x2 - $x1, $y2 - $y1);
    $low = AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE;
    $high = $length - AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE;
    if ($high <= $low) { return false; }

    $minX = $x1 < $x2 ? $x1 : $x2;
    $maxX = $x1 > $x2 ? $x1 : $x2;
    $minY = $y1 < $y2 ? $y1 : $y2;
    $maxY = $y1 > $y2 ? $y1 : $y2;

    // 💣 EVERY cell the chord's bbox spans, not just the cell its start point falls into. A chord can
    // be hundreds of units long and meet water only in its last cell; a prefilter that looked at one
    // cell would report „dry" for exactly the long ocean chords this feature exists to stop.
    $grid = $water['grid'] ?? [];
    $candidates = [];
    $cellMaxX = (int) floor($maxX / AVESMAPS_ROUTE_WATER_GRID_CELL);
    $cellMaxY = (int) floor($maxY / AVESMAPS_ROUTE_WATER_GRID_CELL);
    for ($cellX = (int) floor($minX / AVESMAPS_ROUTE_WATER_GRID_CELL); $cellX <= $cellMaxX; $cellX++) {
        for ($cellY = (int) floor($minY / AVESMAPS_ROUTE_WATER_GRID_CELL); $cellY <= $cellMaxY; $cellY++) {
            foreach ($grid[$cellX . ':' . $cellY] ?? [] as $index) {
                $candidates[$index] = $index;
            }
        }
    }

    $coordinates = [[$x1, $y1], [$x2, $y2]];
    foreach ($candidates as $index) {
        $area = $areas[$index];
        // Exact bbox rejection behind the grid: a cell is coarse, the bbox is not.
        if ($area['min_x'] > $maxX || $area['max_x'] < $minX
            || $area['min_y'] > $maxY || $area['max_y'] < $minY) { continue; }
        foreach (avesmapsEcosystemLineIntervals($coordinates, $area['edges']) as $interval) {
            if (min($interval['exit'], $high) > max($interval['enter'], $low)) { return true; }
        }
    }

    return false;
}

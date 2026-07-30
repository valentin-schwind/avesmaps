<?php
// api/_internal/routing/__tests__/water-crossing-test.php
declare(strict_types=1);

/**
 * Unit tests for the V13 water test (api/_internal/routing/water-areas.php) -- the coastal tolerance,
 * the grid prefilter and the inert-when-empty guarantee.
 *
 * Spec: docs/superpowers/specs/2026-07-29-landschaften-v13-wasser-design.md §4.1, §4.3, §4.4.
 *
 * 💣 The coastal tolerance is the finding that shaped the whole design: 571 of 4.653 places sit
 * geometrically INSIDE water because harbour towns are drawn on the coast and the sea polygon is
 * drawn over them -- Belhanka and Kuslik among them. Without the tolerance, 51 of 85 refusals are
 * short coastal hops that should never have been refused. The three named cases below are exactly
 * the ones §7 of the spec demands, and case 4 is the one that must NOT be let through.
 *
 * Pure: no DB, no HTTP. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/water-crossing-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../../app/ecosystem-line-intervals.php';
require __DIR__ . '/../water-areas.php';

// --- the two screws the owner may turn (spec §9) --------------------------------------------------
assert(AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE === 1.0,
    'coastal tolerance is 1,0 map units (safe span 0 ... 3,0 -- at 5,0 real sea crossings start passing)');
assert(AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT === 25,
    'dry-search cap is 25 (safe span 10 ... 50 -- below 10 loses alternatives, above 25 buys nothing)');

$sea = static fn(float $minX, float $maxX, float $minY, float $maxY): array => [
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$minX, $minY], [$maxX, $minY], [$maxX, $maxY], [$minX, $maxY], [$minX, $minY],
    ]]],
    // ⚠️ snake_case, as the DB columns and the payload spell it -- never minX.
    'min_x' => $minX, 'min_y' => $minY, 'max_x' => $maxX, 'max_y' => $maxY,
];

// One sea covering 0..100 square, and a second far to the east to exercise the grid.
$water = avesmapsPrepareRouteWater([$sea(0.0, 100.0, 0.0, 100.0), $sea(200.0, 260.0, 40.0, 60.0)]);
assert(count($water['areas']) === 2, 'both areas prepared');
assert($water['areas'][0]['min_x'] === 0.0 && $water['areas'][0]['max_y'] === 100.0,
    'the bbox is carried over from the row, not recomputed');

// --- 1. inert when there is no water: the failure mode V13 must degrade into (spec §4.1) ----------
$noWater = avesmapsPrepareRouteWater([]);
assert(avesmapsRouteChordCrossesWater(-20.0, 50.0, 120.0, 50.0, $noWater) === false,
    'no water rows -> V13 is inert and the planner behaves exactly as before');
assert(avesmapsPrepareRouteWater([['geometry' => ['type' => 'Point', 'coordinates' => [1, 2]],
    'min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 1.0, 'max_y' => 1.0]])['areas'] === [],
    'a row whose geometry yields no edges is dropped, not carried as an empty area');

// --- 2. a real crossing blocks, both ends on dry land ---------------------------------------------
assert(avesmapsRouteChordCrossesWater(-20.0, 50.0, 120.0, 50.0, $water) === true,
    'a chord straight across the sea crosses water');

// --- 3. a harbour endpoint passes: the wet part lies inside the tolerance -------------------------
// Starts 0,5 units inside the sea and runs 40 units onto land. Wet [0 ... 0,5], clipped away.
assert(avesmapsRouteChordCrossesWater(99.5, 50.0, 140.0, 50.0, $water) === false,
    'a place drawn just inside the coastline is coastal slop, not a crossing');
// The same at the FAR end -- the tolerance is symmetric or it is broken.
assert(avesmapsRouteChordCrossesWater(140.0, 50.0, 99.5, 50.0, $water) === false,
    'the tolerance must apply to the end of the chord as well as its start');

// --- 4. 💣 a harbour endpoint does NOT buy a real crossing ----------------------------------------
// Starts deep inside the sea and stays wet for 50 units. The tolerance clips 1 unit; 49 remain.
assert(avesmapsRouteChordCrossesWater(50.0, 50.0, 140.0, 50.0, $water) === true,
    'the tolerance may forgive drawing slop at the ends, never a real passage through open water');

// --- 5. a chord shorter than 2 x T is never refused (spec §4.3, consciously carried) --------------
assert(avesmapsRouteChordCrossesWater(50.0, 50.0, 51.0, 50.0, $water) === false,
    'a hop shorter than 2 x tolerance has no middle left to test, so it always passes');

// --- 6. dry land far from any sea ------------------------------------------------------------------
assert(avesmapsRouteChordCrossesWater(150.0, 200.0, 190.0, 250.0, $water) === false,
    'a chord nowhere near water is dry');

// --- 7. 💣 the grid must collect EVERY cell the chord spans, not just its start cell ---------------
// The chord starts in grid cell 4 (150/32) and the second sea sits in cells 6..8. A prefilter that
// only looked at the start cell -- or at one cell per chord -- would silently report "dry" here, and
// V13 would be a feature that does nothing on long chords.
assert(avesmapsRouteChordCrossesWater(150.0, 50.0, 400.0, 50.0, $water) === true,
    'a long chord must find water lying in a far grid cell');
// And a chord threading the gap between the two seas stays dry.
assert(avesmapsRouteChordCrossesWater(120.0, 50.0, 190.0, 50.0, $water) === false,
    'the gap between two seas is dry');

// --- 8. a chord along a lake shore, just outside -------------------------------------------------
assert(avesmapsRouteChordCrossesWater(-10.0, -0.001, 110.0, -0.001, $water) === false,
    'a hair outside the shore is not a crossing');

echo "water-crossing: alle Pruefungen bestanden\n";

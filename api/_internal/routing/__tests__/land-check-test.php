<?php
// api/_internal/routing/__tests__/land-check-test.php
declare(strict_types=1);

/**
 * Unit tests for the „Hierher reisen" land check (api/_internal/routing/land-areas.php).
 *
 * 💣 THE CHECK GUARDS EXACTLY ONE THING: the point the user right-clicked. It is NOT asked about
 * places. Owner, verbatim: „ORTE IM WASSER sind nicht zu überprüfen, diese können per Straße immer
 * erreicht werden." An earlier draft wanted to test places and had measured that 85 of 2.674 would
 * fail (Belhanka, Nostria) -- the wrong question, and building it would have introduced a defect
 * that never existed.
 *
 * The rule: land = inside `kontinent` or `insel` AND inside no `meer`/`see`. Water beats land.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/land-check-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../land-areas.php';

/** A square area row in the shape avesmapsPrepareRouteAreas() expects. */
$square = static function (float $x1, float $y1, float $x2, float $y2): array {
    return [
        'geometry' => ['type' => 'Polygon', 'coordinates' => [[
            [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
        ]]],
        'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2,
    ];
};

// A continent from 0..100 with a lake in its middle (40..60), plus a separate sea to the east.
$land = avesmapsPrepareRouteAreas([$square(0.0, 0.0, 100.0, 100.0)]);
$water = avesmapsPrepareRouteAreas([$square(40.0, 40.0, 60.0, 60.0), $square(200.0, 0.0, 300.0, 100.0)]);

// ============================================================ A. the four cases of the proof (§6)

// Middle of the continent -> land.
assert(avesmapsRoutePointIsOnLand(20.0, 20.0, $land, $water) === true, 'continent interior must be land');

// Open sea, in no land area at all -> refused.
assert(avesmapsRoutePointIsOnLand(250.0, 50.0, $land, $water) === false, 'the open sea is not land');

// 💣 BOTH at once -> refused. Water beats land, and this is the case that decides it: the lake sits
// geometrically INSIDE the continent, so „is it in a land area?" alone answers yes for every lake on
// the map.
assert(avesmapsRoutePointIsOnLand(50.0, 50.0, $land, $water) === false, 'water must beat land');

// In NOTHING -- neither declared land nor declared water. Measured at 0,7 % of the map (2026-07-30).
// Treated as water: inventing land where the data says nothing would be the worse error.
assert(avesmapsRoutePointIsOnLand(-50.0, -50.0, $land, $water) === false, 'undeclared ground is not land');

// ============================================================ B. an island is land, a `kueste` is not

// `insel` rides in the same structure as `kontinent` (both are read by region_type, not by kind --
// they sit on two DIFFERENT kinds since 2026-07-30, and filtering by kind loses the continents).
$island = avesmapsPrepareRouteAreas([$square(210.0, 40.0, 230.0, 60.0)]);
assert(avesmapsRoutePointIsOnLand(220.0, 50.0, $island, $water) === false, 'an island inside a sea polygon stays wet');
assert(avesmapsRoutePointIsOnLand(220.0, 50.0, $island, avesmapsPrepareRouteAreas([])) === true, 'an island without sea is land');

// ============================================================ C. inert without data

// No land areas at all -> nothing is land. The feature must refuse rather than guess, and the loader
// returns the empty structure on ANY database problem.
$empty = avesmapsPrepareRouteAreas([]);
assert(avesmapsRoutePointIsOnLand(20.0, 20.0, $empty, $empty) === false, 'no land stock -> no land');

// ============================================================ D. the grid prefilter is not a filter

// 💣 A point far outside every area must not accidentally hit a populated grid cell, and a point
// inside must be found no matter which cell it falls in. The cell width is 32 units, so this walks
// several cells of the continent.
foreach ([[1.0, 1.0], [33.0, 33.0], [65.0, 97.0], [99.0, 1.0]] as [$x, $y]) {
    assert(avesmapsRouteAreasContainPoint($x, $y, $land) === true, "continent point ($x, $y) must be found");
}
assert(avesmapsRouteAreasContainPoint(100.5, 50.0, $land) === false, 'just outside is outside');

// ============================================================ E. the boundary is not a coin toss

// The ray cast is half-open (avesmapsEcosystemPointInEdges): a point exactly on the lower/left edge
// belongs to the area, the upper/right one does not. Asserted so a later „tidy-up" of the shared
// core cannot flip it silently -- the same rule V9 and V13 depend on.
assert(avesmapsRouteAreasContainPoint(0.0, 50.0, $land) === true, 'left edge belongs to the area');
assert(avesmapsRouteAreasContainPoint(100.0, 50.0, $land) === false, 'right edge does not');

echo "land-check-test: OK\n";

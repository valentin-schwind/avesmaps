<?php

declare(strict_types=1);

/**
 * Unit test for the PURE climate-zone geometry (spec docs/superpowers/specs/2026-08-03-klimazonen-design.md
 * §4). Everything DB-bound (the seed, the rebuild, the revision) is provable only in the owner's live
 * run -- there is no local MySQL (api/config.local.php is absent). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/climate-zones-test.php
 *
 * 🔴 What this file exists to nail down: seven bands derived from six dividers TILE THE MAP -- no gap,
 * no overlap -- and two dividers can never cross. That is the whole "Klimazonen überlappen sich nicht"
 * requirement, and it is a property of the construction rather than a rule someone remembers to check.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../climate-zones.php';

function climateTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

function climateTestLine(array $points): array
{
    return avesmapsClimateNormalizeDivider(['type' => 'LineString', 'coordinates' => $points]);
}

// Shoelace, unsigned. Local to the test -- the production code never needs an area.
function climateTestRingArea(array $ring): float
{
    $sum = 0.0;
    for ($index = 0; $index < count($ring) - 1; $index++) {
        $sum += $ring[$index][0] * $ring[$index + 1][1] - $ring[$index + 1][0] * $ring[$index][1];
    }

    return abs($sum) / 2.0;
}

// ---- normalising one divider -----------------------------------------------------------------------

$straight = climateTestLine([[0, 900], [1024, 900]]);
assert($straight['type'] === 'LineString', 'a normalised divider stays a LineString');
assert($straight['coordinates'] === [[0.0, 900.0], [1024.0, 900.0]], 'positions survive as floats');

$bent = climateTestLine([[0, 900], [300, 880], [1024, 910]]);
assert(count($bent['coordinates']) === 3, 'intermediate points survive');

climateTestThrows(static fn() => climateTestLine([[10, 900], [1024, 900]]),
    'the first point must sit on the left map edge');
climateTestThrows(static fn() => climateTestLine([[0, 900], [1000, 900]]),
    'the last point must sit on the right map edge');
climateTestThrows(static fn() => climateTestLine([[0, 900], [500, 880], [400, 890], [1024, 900]]),
    'x must strictly increase -- a backwards step folds the band');
climateTestThrows(static fn() => climateTestLine([[0, 900], [500, 880], [500, 870], [1024, 900]]),
    'two points at the same x are not strictly increasing either');
climateTestThrows(static fn() => climateTestLine([[0, 900]]),
    'a divider needs at least two points');
climateTestThrows(static fn() => climateTestLine([[0, 1100], [1024, 900]]),
    'y stays inside the map');
climateTestThrows(static fn() => avesmapsClimateNormalizeDivider(['type' => 'Polygon', 'coordinates' => []]),
    'only a LineString is a divider');
climateTestThrows(static fn() => avesmapsClimateNormalizeDivider('nope'),
    'a string is not a geometry');

// ---- y at a given x --------------------------------------------------------------------------------

$ramp = climateTestLine([[0, 100], [1024, 200]]);
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 0.0) - 100.0) < 1e-9, 'y at the left edge');
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 1024.0) - 200.0) < 1e-9, 'y at the right edge');
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 512.0) - 150.0) < 1e-9, 'y interpolates linearly');

// ---- the order guard -------------------------------------------------------------------------------
// 🔴 This is what makes "no overlap" a property of the construction rather than a rule someone checks.

$ok = [
    climateTestLine([[0, 900], [1024, 880]]),
    climateTestLine([[0, 700], [1024, 720]]),
    climateTestLine([[0, 500], [1024, 500]]),
];
avesmapsClimateAssertOrder($ok);   // must not throw

// Crossing INSIDE a segment: both lines are fine at their own vertices taken alone, and they still
// cross. This is the case a naive per-vertex check on one line misses.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 900], [1024, 500]]),
    climateTestLine([[0, 600], [1024, 800]]),
]), 'two dividers crossing between their breakpoints are refused');

climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 700], [1024, 700]]),
]), 'two dividers lying on top of each other are refused');

climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 699.5], [1024, 699.5]]),
]), 'closer than the minimum gap is refused');

// The union of BOTH x sets is what gets sampled: line B's kink sits at an x that line A has no vertex
// at, and that kink is where they touch.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 800], [1024, 800]]),
    climateTestLine([[0, 400], [512, 799.9], [1024, 400]]),
]), 'a kink of the southern line reaching up to the northern one is refused');

// ---- band geometry ---------------------------------------------------------------------------------

$top = avesmapsClimateBandGeometry(null, $ok[0]);
assert($top['type'] === 'Polygon', 'a band is a Polygon');
$topRing = $top['coordinates'][0];
assert($topRing[0] === $topRing[count($topRing) - 1], 'the ring is closed');
assert(in_array([0.0, 1024.0], $topRing, true), 'the northernmost band reaches the top edge');

$bottom = avesmapsClimateBandGeometry($ok[2], null);
assert(in_array([0.0, 0.0], $bottom['coordinates'][0], true), 'the southernmost band reaches the bottom edge');

$middle = avesmapsClimateBandGeometry($ok[0], $ok[1]);
assert(count($middle['coordinates'][0]) === 5, 'two 2-point dividers make a 4-corner ring plus the closing point');

// 🔴 The whole point: n dividers make n+1 bands that tile the map exactly -- no gap, no overlap.
$dividers = avesmapsClimateDefaultDividers(6);
$total = 0.0;
for ($index = 0; $index <= count($dividers); $index++) {
    $band = avesmapsClimateBandGeometry(
        $index === 0 ? null : $dividers[$index - 1],
        $index === count($dividers) ? null : $dividers[$index]
    );
    $total += climateTestRingArea($band['coordinates'][0]);
}
assert(abs($total - 1024.0 * 1024.0) < 1e-6, 'the seven bands tile the whole map: ' . $total);

// ---- the default split -----------------------------------------------------------------------------

assert(count($dividers) === 6, 'six dividers by default');
avesmapsClimateAssertOrder($dividers);   // the default must satisfy its own guard
// 🪤 avesmapsParseMapCoordinate ROUNDS to three decimals, so the comparison rounds too. Asserting
// against the raw fraction would fail by 0.0003 and look like a formula error.
assert($dividers[0]['coordinates'][0][1] === round(1024.0 * 6 / 7, 3), 'the first divider sits at 6/7 height');
assert($dividers[5]['coordinates'][0][1] === round(1024.0 * 1 / 7, 3), 'the last one at 1/7');
assert(avesmapsClimateDefaultDividers(0) === [], 'zero dividers is a valid degenerate answer');

// ---- vocabulary and the guards (Task 2) ------------------------------------------------------------
// Only the vocabulary half: everything with a PDO is not provable locally (no local MySQL).

require __DIR__ . '/../ecosystem.php';

assert(in_array('klima', AVESMAPS_ECOSYSTEM_KINDS, true), 'klima is a known kind');
assert(count(AVESMAPS_ECOSYSTEM_KINDS) === 4, 'and it is the fourth');

$climateSeed = array_values(array_filter(
    AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED,
    static fn(array $row): bool => $row[0] === 'klima'
));
assert(count($climateSeed) === 7, 'seven climate zones are seeded');

// 🔴 sort_order is LOAD-BEARING: it says which zone lies north of which, and from that follows which
// divider bounds which band. A duplicate or a shuffled order re-sorts the map.
$sortOrders = array_column($climateSeed, 3);
$sorted = $sortOrders;
sort($sorted);
assert($sortOrders === $sorted, 'the seed is written in north-to-south order');
assert(count(array_unique($sortOrders)) === 7, 'no two zones share a sort_order');

$keys = array_column($climateSeed, 1);
assert($keys === ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht', 'subtropisch', 'tropisch'],
    'the zone keys are the agreed ones, ASCII-folded');
foreach ($keys as $key) {
    assert(preg_match('/^[a-z_]+$/', $key) === 1, "zone key {$key} is ASCII-folded (AGENTS.md §5)");
}

assert(avesmapsClimateIsDerivedKind('klima') === true, 'klima areas are derived');
assert(avesmapsClimateIsDerivedKind('vegetation') === false, 'the other three are drawn');

// The guards. They are the real protection -- a UI guard protects against a misclick, not against a
// tab that has been open since yesterday and still knows the old action.
climateTestThrows(static fn() => avesmapsClimateAssertNotDerived('klima', 'create_area'),
    'creating a klima area by hand is refused');
avesmapsClimateAssertNotDerived('vegetation', 'create_area');   // must not throw

// A klima kind survives the ecosystem kind reader, so the layer switch can send it.
assert(avesmapsEcosystemReadKind('klima') === 'klima', 'klima passes the kind reader');

fwrite(STDOUT, "climate-zones-test: OK\n");

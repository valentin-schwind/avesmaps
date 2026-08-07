<?php

declare(strict_types=1);

// CLI regression test for the cell-indexed endpoint lookup in the server route graph (plan V0.1).
// Pure fixtures, no DB. It pins the indexed search to the linear scan it replaces -- including the
// tie-break order, which is behaviour: a shared ?s= link never expires and is recomputed
// server-side on every open, so a drift here silently moves a route somebody shared weeks ago.
//
// Run: php -d zend.assertions=1 tools/routing/test-client-graph-endpoint-index.php
// Without -d zend.assertions=1 assert() checks nothing and this test reports green.

require_once __DIR__ . '/../../api/_internal/routing/client-graph.php';

// The reference is an INDEPENDENT linear implementation of the rule -- the yardstick the indexed
// search runs against, and it must never be optimised along with it or share its cell walk.
//
// 💣 Updated 2026-08-07, and the update is the point. Until then this was a verbatim copy of the
// pre-index loop: "first hit in $locations order". That pinned the ordering, which is real
// behaviour -- but it also pinned the BUG the order caused. A way end lying exactly on a place
// went to whichever neighbour sat earlier in the list, as long as it was anywhere in the same
// tolerance box (a box, not a circle: |dx| and |dy| each < 0.5 reaches to a diagonal of 0.707).
// Measured on the live map: 541 of 11,662 endpoints at the wrong place, 165 ways collapsed into
// self-loops. So the rule gained a first tier, and the yardstick has to carry it too.
//
// ⚠️ What did NOT change and is still pinned below: with no exact hit, lowest index still wins.
// That tie-break is behaviour -- a shared ?s= link never expires and is recomputed server-side on
// every open, so a drift there silently moves a route somebody shared weeks ago.
function avesmapsFindClientLocationLinearReference(array $locations, array $point): ?array {
    $x = filter_var($point[0] ?? null, FILTER_VALIDATE_FLOAT);
    $y = filter_var($point[1] ?? null, FILTER_VALIDATE_FLOAT);
    if ($x === false || $y === false) return null;

    $firstInBox = null;
    $nearestExact = null;
    $nearestExactDistance = INF;
    foreach ($locations as $location) {
        $ly = (float) $location['route_y'];
        $lx = (float) $location['route_x'];
        if (abs($ly - (float) $y) >= AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD
            || abs($lx - (float) $x) >= AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD) {
            continue;
        }
        if ($firstInBox === null) {
            $firstInBox = $location;
        }
        $distance = hypot($lx - (float) $x, $ly - (float) $y);
        if ($distance < AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT && $distance < $nearestExactDistance) {
            $nearestExactDistance = $distance;
            $nearestExact = $location;
        }
    }

    return $nearestExact ?? $firstInBox;
}

// (1) Realistic spread. route_x/route_y -- NOT 'coordinates': the routing coordinates are derived
//     in avesmapsBuildClientCompatibleRouteGraph, a raw location set has none. An index built over
//     'coordinates' would stay empty -> graph without edges -> every route "not found".
$locations = [];
for ($i = 0; $i < 4500; $i++) {
    $locations[] = [
        'name' => "Ort$i",
        'route_x' => (($i * 7) % 1024) + 0.13,
        'route_y' => (($i * 13) % 1024) + 0.37,
    ];
}
// (2) Two locations inside the same tolerance window -- 0.42 apart, so each sits in the other's
//     box. Catches the ordering trap (the linear scan takes the FIRST hit in $locations order, a
//     cell walk would take whichever cell came first) AND, since 2026-08-07, the exact-hit tier.
$locations[] = ['name' => 'ZwillingA', 'route_x' => 500.00, 'route_y' => 500.00];
$locations[] = ['name' => 'ZwillingB', 'route_x' => 500.30, 'route_y' => 500.30];

$index = avesmapsBuildClientLocationCellIndex($locations);
$mismatches = [];

// (2a) 💣 The probe sweep below only proves indexed == linear. Two implementations of the SAME
//      wrong rule agree just as happily, and that is exactly how the old behaviour survived: both
//      sides said "first in list", both were consistent, both were wrong. So state the outcome
//      itself for the twins -- once per tier, in the direction where the two tiers disagree.
$onB = avesmapsFindClientLocationAtPathEndpoint($locations, $index, [500.30, 500.30]);
assert(($onB['name'] ?? null) === 'ZwillingB',
    'exact hit beats list order: an end lying ON ZwillingB belongs to ZwillingB, not to the earlier ZwillingA');
$between = avesmapsFindClientLocationAtPathEndpoint($locations, $index, [500.15, 500.15]);
assert(($between['name'] ?? null) === 'ZwillingA',
    'no exact hit: lowest index still wins, even though ZwillingB is equally far -- the ?s= tie-break');
$onA = avesmapsFindClientLocationAtPathEndpoint($locations, $index, [500.00, 500.00]);
assert(($onA['name'] ?? null) === 'ZwillingA', 'and ZwillingA keeps its own end');

// (3) Probes at +-0.4999: exactly on the tolerance edge, where too small a neighbourhood
//     (4 cells instead of 9) would show up. +-0.2 would NOT reveal it.
foreach ($locations as $loc) {
    foreach ([[0.4999, 0.0], [-0.4999, 0.0], [0.0, 0.4999], [0.4999, -0.4999], [0.0, 0.0]] as $d) {
        $probe  = [$loc['route_x'] + $d[0], $loc['route_y'] + $d[1]];
        $linear = avesmapsFindClientLocationLinearReference($locations, $probe);
        $hashed = avesmapsFindClientLocationAtPathEndpoint($locations, $index, $probe);
        if (($linear['name'] ?? null) !== ($hashed['name'] ?? null)) {
            $mismatches[] = sprintf('%s @ %+.4f/%+.4f: linear=%s indiziert=%s',
                $loc['name'], $d[0], $d[1], $linear['name'] ?? 'null', $hashed['name'] ?? 'null');
        }
    }
}
// (4) 1000 points GUARANTEED to miss -- the failure case has to agree too.
for ($i = 0; $i < 1000; $i++) {
    $probe  = [2000.0 + $i, 3000.0 + $i];
    $linear = avesmapsFindClientLocationLinearReference($locations, $probe);
    $hashed = avesmapsFindClientLocationAtPathEndpoint($locations, $index, $probe);
    if (($linear['name'] ?? null) !== ($hashed['name'] ?? null)) { $mismatches[] = "Fehlschlag $i"; }
}

assert($mismatches === [], "Abweichungen:\n" . implode("\n", array_slice($mismatches, 0, 10)));
echo "OK: " . (count($locations) * 5 + 1000) . " Sonden deckungsgleich\n";

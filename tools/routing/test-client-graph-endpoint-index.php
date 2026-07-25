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

// The reference is a VERBATIM copy of the loop as it stood before the rebuild -- it is the
// yardstick the indexed search runs against, and must never be optimised along with it.
function avesmapsFindClientLocationLinearReference(array $locations, array $point): ?array {
    $x = filter_var($point[0] ?? null, FILTER_VALIDATE_FLOAT);
    $y = filter_var($point[1] ?? null, FILTER_VALIDATE_FLOAT);
    if ($x === false || $y === false) return null;
    foreach ($locations as $location) {
        if (abs((float) $location['route_y'] - (float) $y) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD
            && abs((float) $location['route_x'] - (float) $x) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD) {
            return $location;
        }
    }
    return null;
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
// (2) Two locations inside the same tolerance window -- catches the ordering trap: the linear scan
//     returns the FIRST hit in $locations order, a cell walk would return whichever cell came first.
$locations[] = ['name' => 'ZwillingA', 'route_x' => 500.00, 'route_y' => 500.00];
$locations[] = ['name' => 'ZwillingB', 'route_x' => 500.30, 'route_y' => 500.30];

$index = avesmapsBuildClientLocationCellIndex($locations);
$mismatches = [];

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

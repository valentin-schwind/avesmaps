<?php
// api/_internal/routing/__tests__/synthetic-distance-report-test.php
declare(strict_types=1);

/**
 * Instruction C §1: the x25 surcharge is a Dijkstra WEIGHT, not a distance -- and it had been
 * shipping in `route.segments[].distance_units` of the stable `POST /api/route/` contract. Measured
 * live 2026-08-02 on Gulbladdirstadir -> Rekheim: the cross-country leg reported 484,65 for a line
 * whose own coordinates are 19,39 apart.
 *
 * 💣 The surcharge may NOT simply be dropped: `client-graph.php` prices the edge with it in BOTH
 * modes (`distance` for „Kürzeste", `time = distance / speed` for „Schnellste"), and that is exactly
 * what keeps a repair bridge unattractive against a real road. So the weight stays and the REPORT
 * becomes honest -- distance out of the segment's own geometry, and the factor shipped as its own
 * field so `cost_units` stays derivable.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/synthetic-distance-report-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../client-graph.php';

$place = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'route_x' => $x, 'route_y' => $y,
    'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];
$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// ============================================================ A. an ordinary edge is untouched

$road = [
    'distance' => 10.0, 'time' => 2.5, 'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
    'id' => 'path-AB', 'from' => 'A', 'to' => 'B',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [6.0, 0.0], [10.0, 0.0]]],
];
$shipped = avesmapsBuildClientRouteDiagnosticSegments([$road])[0];
assert(abs($shipped['distance_units'] - 10.0) < 1e-9, 'a drawn way reports its own length: ' . $shipped['distance_units']);
assert(abs($shipped['cost_units'] - 2.5) < 1e-9, 'and its cost is unchanged');
assert(abs($shipped['cost_factor'] - 1.0) < 1e-9, 'a drawn way carries no surcharge: ' . $shipped['cost_factor']);

// ============================================================ B. the surcharge leaves the distance

// The shape the two synthetic producers build: a straight chord, priced x25.
$chordLength = hypot(15.0 - 3.0, 4.0 - 4.0);           // 12,0 units of actual line
$synthetic = [
    'distance' => $chordLength * AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR,
    'time' => ($chordLength * AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR) / 1.25,
    'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'transport_option' => 'groupFoot',
    'id' => 'synthetic-X->Y', 'from' => 'X', 'to' => 'Y',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[3.0, 4.0], [15.0, 4.0]]],
    'synthetic' => true,
    'cost_factor' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR,
];
$shipped = avesmapsBuildClientRouteDiagnosticSegments([$synthetic])[0];
assert(abs($shipped['distance_units'] - $chordLength) < 1e-9,
    'the reported distance is the line, not the weight: ' . $shipped['distance_units']);
assert(abs($shipped['cost_factor'] - 25.0) < 1e-9, 'and the surcharge is named: ' . $shipped['cost_factor']);
// ⭐ `cost_units` is NOT repaired -- it is the Dijkstra price and must stay comparable to every
// other edge's. With `distance_units` and `cost_factor` next to it, it is now derivable.
assert(abs($shipped['cost_units'] - $synthetic['time']) < 1e-9, 'the price is untouched');
assert(abs($shipped['distance_units'] * $shipped['cost_factor'] / 1.25 - $shipped['cost_units']) < 1e-9,
    'and Strecke x Faktor / Tempo reproduces it exactly');

// ============================================================ C. a segment without usable geometry

// One coordinate cannot be measured. Falling back to the raw `distance` would ship the surcharge
// again, so the factor is divided out instead.
$degenerate = $synthetic;
$degenerate['geometry'] = ['type' => 'LineString', 'coordinates' => [[3.0, 4.0]]];
$shipped = avesmapsBuildClientRouteDiagnosticSegments([$degenerate])[0];
assert(abs($shipped['distance_units'] - $chordLength) < 1e-9,
    'an unmeasurable line still reports without the surcharge: ' . $shipped['distance_units']);

// ============================================================ D. the component bridge

// Two islands of road with no connection between them: A1--A2 far west, B1--B2 far east. The bridge
// builder joins them with one synthetic chord.
$graph = [];
$edge = static function (array &$graph, string $from, string $to, float $x1, float $y1, float $x2, float $y2): void {
    $length = hypot($x2 - $x1, $y2 - $y1);
    $connection = [
        'distance' => $length, 'time' => $length / 4.0, 'route_type' => 'Strasse',
        'transport_option' => 'groupFoot', 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[$x1, $y1], [$x2, $y2]]],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};
$edge($graph, 'A1', 'A2', 0.0, 0.0, 0.0, 10.0);
$edge($graph, 'B1', 'B2', 30.0, 0.0, 30.0, 10.0);
$locations = [$place('A1', 0.0, 0.0), $place('A2', 0.0, 10.0), $place('B1', 30.0, 0.0), $place('B2', 30.0, 10.0)];

$bridges = avesmapsConnectClientCompatibleDetachedGraphComponents($graph, $locations, $request, []);
assert($bridges === 1, 'the two islands are bridged once: ' . $bridges);

$route = avesmapsFindClientCompatibleRoute(['graph' => $graph, 'statistics' => []], 'A1', 'B1', $request);
assert($route['found'] === true, 'and the bridge carries a route');
$bridge = null;
foreach ($route['segments'] as $segment) {
    if (!empty($segment['synthetic'])) { $bridge = $segment; break; }
}
assert(is_array($bridge), 'the route uses the synthetic bridge');

// 🔴 THE WEIGHT IS UNCHANGED. This is what keeps Dijkstra from preferring a chord over a road.
assert(abs((float) $bridge['distance'] - 30.0 * 25.0) < 1e-6,
    'in the graph the bridge still weighs x25: ' . $bridge['distance']);
assert(abs((float) $bridge['cost_factor'] - 25.0) < 1e-9, 'and it names its factor');

$shipped = avesmapsBuildClientRouteDiagnosticSegments([$bridge])[0];
assert(abs($shipped['distance_units'] - 30.0) < 1e-6,
    'but it REPORTS the 30 units it actually spans: ' . $shipped['distance_units']);

// ============================================================ E. the waypoint anchor

// A place 4 units north of a road it does not touch. The anchor splits the road and hangs the place
// onto the split point with a short cross-country edge -- the second x25 producer.
$anchorGraph = [];
$edge($anchorGraph, 'W1', 'W2', 0.0, 0.0, 20.0, 0.0);
$anchorGraph['Ort'] ??= [];
$anchor = avesmapsFindNearestClientLandPathAnchor($anchorGraph, 10.0, 4.0);
assert(is_array($anchor), 'the road is found as an anchor');
avesmapsAnchorClientWaypointToLandPath($anchorGraph, 'Ort', 10.0, 4.0, $anchor, 'groupFoot', 1.25, 0);

$anchorEdge = null;
foreach ($anchorGraph['Ort'] as $connections) {
    foreach ($connections as $connection) {
        if (!empty($connection['synthetic'])) { $anchorEdge = $connection; break 2; }
    }
}
assert(is_array($anchorEdge), 'the place is anchored with a synthetic edge');
assert(abs((float) $anchorEdge['distance'] - 4.0 * 25.0) < 1e-6,
    'the anchor keeps its x25 weight: ' . $anchorEdge['distance']);
$shipped = avesmapsBuildClientRouteDiagnosticSegments([$anchorEdge])[0];
assert(abs($shipped['distance_units'] - 4.0) < 1e-6,
    'and reports the 4 units it spans: ' . $shipped['distance_units']);
assert(abs($shipped['cost_factor'] - 25.0) < 1e-9, 'naming the factor: ' . $shipped['cost_factor']);

// ============================================================ F. the split sub-edges are NOT surcharged

// The two halves of the cut road are ordinary way pieces. If they had picked up a factor, every
// route through a waypoint would report 25x too far.
// ⚠️ The original W1--W2 edge SURVIVES the split -- the anchor adds sub-edges, it does not remove
// the parent. Matching on `route_type` alone would grab the 20-unit parent and prove nothing.
$slice = null;
foreach ($anchorGraph['W1'] as $connections) {
    foreach ($connections as $connection) {
        if (str_starts_with((string) ($connection['id'] ?? ''), 'wp-slice-')) { $slice = $connection; break 2; }
    }
}
assert(is_array($slice), 'the road was split');
$shipped = avesmapsBuildClientRouteDiagnosticSegments([$slice])[0];
assert(abs($shipped['cost_factor'] - 1.0) < 1e-9, 'a split road piece carries no factor: ' . $shipped['cost_factor']);
assert(abs($shipped['distance_units'] - 10.0) < 1e-6, 'and reports its real length: ' . $shipped['distance_units']);

echo "OK synthetic-distance-report-test\n";

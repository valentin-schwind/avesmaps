<?php
// api/_internal/routing/__tests__/offroad-leg-test.php
declare(strict_types=1);

/**
 * Unit tests for hanging a clicked map point onto the route graph
 * (api/_internal/routing/offroad-leg.php) and routing to it with the ORDINARY Dijkstra.
 *
 * ⭐ The point of this file is that there is nothing special to test on the routing side. The map
 * point becomes a node with one cross-country edge; avesmapsFindClientCompatibleRoute, the segment
 * builder and the renderer are untouched. If that claim is wrong, it breaks here.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-leg-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../offroad-leg.php';

$square = static function (float $x1, float $y1, float $x2, float $y2): array {
    return [
        'geometry' => ['type' => 'Polygon', 'coordinates' => [[
            [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
        ]]],
        'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2,
    ];
};
$place = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];

// A tiny world: a continent 0..100, a lake in it, and a road A -- B -- C along y = 10.
$land = avesmapsPrepareRouteAreas([$square(0.0, 0.0, 100.0, 100.0)]);
$water = avesmapsPrepareRouteAreas([$square(40.0, 40.0, 60.0, 60.0)]);
$locations = [$place('A', 5.0, 10.0), $place('B', 25.0, 10.0), $place('C', 45.0, 10.0)];

$road = static function (string $from, string $to, float $distance): array {
    return [
        'distance' => $distance, 'time' => $distance / 4.0, 'route_type' => 'Strasse',
        'transport_option' => 'groupFoot', 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 10.0], [100.0, 10.0]]],
    ];
};
$buildGraph = static function () use ($road): array {
    $graph = ['A' => [], 'B' => [], 'C' => []];
    foreach ([['A', 'B'], ['B', 'C']] as [$from, $to]) {
        avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $road($from, $to, 20.0));
        avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $road($to, $from, 20.0));
    }
    return ['graph' => $graph, 'statistics' => []];
};
$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// ============================================================ A. the ordinary case

$clientGraph = $buildGraph();
// A point on land, 6 units north of the road near B.
$report = avesmapsAttachOffroadPointToGraph($clientGraph, $locations, $request, $water, $land, null, 26.0, 16.0, '__offroad_to');
assert($report['ok'] === true, 'a dry point must attach: ' . json_encode($report));
assert($report['exit_node'] === 'B', 'the nearest GRAPH NODE is B, got ' . $report['exit_node']);
assert(isset($clientGraph['graph']['__offroad_to']), 'the point is now a node');

// 💣 The whole leg has to survive the ORDINARY Dijkstra, unmodified.
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', '__offroad_to', $request);
assert($route['found'] === true, 'the ordinary Dijkstra must reach the map point');
$segments = $route['segments'];
$last = $segments[count($segments) - 1];
assert((string) $last['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'the last leg is Querfeldein');
assert(!empty($last['offroad']), 'and it is flagged as cross-country, so the plan can say „wegloses Gelände"');
assert(count($last['geometry']['coordinates']) >= 2, 'the leg carries a real point sequence');

// The rendered leg starts at the exit node and ends EXACTLY on the clicked point (§5.4).
$coordinates = $last['geometry']['coordinates'];
$end = $coordinates[count($coordinates) - 1];
assert(abs($end[0] - 26.0) < 1e-9 && abs($end[1] - 16.0) < 1e-9, 'the line ends on the clicked point');
assert(abs($coordinates[0][0] - 25.0) < 1e-9 && abs($coordinates[0][1] - 10.0) < 1e-9, 'and starts at the exit node');

// 💣 NO x25 SURCHARGE. That factor exists to make repair bridges unattractive; this leg is the
// journey the traveller asked for, and inflating it would make the reported time 25x wrong.
$airLine = hypot(26.0 - 25.0, 16.0 - 10.0);
assert($last['distance'] >= $airLine - 1e-9, 'the leg is at least the air line');
assert($last['distance'] < $airLine * 2.0, 'and nowhere near a x25 surcharge: ' . $last['distance']);

// The diagnostic segment the API ships carries the flag through.
$diagnostic = avesmapsBuildClientRouteDiagnosticSegments($segments);
assert($diagnostic[count($diagnostic) - 1]['offroad'] === true, 'the API segment carries `offroad`');

// ============================================================ B. the reverse edge is the same line

$route = avesmapsFindClientCompatibleRoute($clientGraph, '__offroad_to', 'A', $request);
assert($route['found'] === true, 'the point must also be a starting point');
$firstLeg = $route['segments'][0];
$firstCoordinates = $firstLeg['geometry']['coordinates'];
assert(abs($firstCoordinates[0][0] - 26.0) < 1e-9, 'leaving the point starts AT the point');
assert(count($firstCoordinates) === count($coordinates), 'the way back is the same line, not a mirrored one');

// ============================================================ C. the refusals

// A point in the lake -- refused BEFORE any search. This is the one check the feature has, and it
// guards the clicked point only.
$wetGraph = $buildGraph();
$wet = avesmapsAttachOffroadPointToGraph($wetGraph, $locations, $request, $water, $land, null, 50.0, 50.0, '__offroad_to');
assert($wet['ok'] === false && $wet['error'] === 'point_not_on_land', 'a point in the lake is refused');
assert(!isset($wetGraph['graph']['__offroad_to']), 'and nothing is attached to the graph');

// A point outside every declared area -- the 0,7 % that are neither land nor water. Also refused.
$nowhere = avesmapsAttachOffroadPointToGraph($wetGraph, $locations, $request, $water, $land, null, 500.0, 500.0, '__offroad_to');
assert($nowhere['ok'] === false && $nowhere['error'] === 'point_not_on_land', 'undeclared ground is refused too');

// 💣 A PLACE IN THE WATER IS NEVER ASKED. The exit node search does not test the land rule -- if it
// did, 85 of 2.674 places (Belhanka, Nostria) would stop being usable, and the owner ruled that out
// in as many words. B sits in the lake here and must still be a perfectly good exit node.
$drowned = [$place('A', 5.0, 10.0), $place('B', 50.0, 50.0)];
$drownedGraph = ['graph' => ['A' => [], 'B' => []], 'statistics' => []];
avesmapsAddClientCompatibleGraphConnection($drownedGraph['graph'], 'A', 'B', $road('A', 'B', 20.0));
avesmapsAddClientCompatibleGraphConnection($drownedGraph['graph'], 'B', 'A', $road('B', 'A', 20.0));
$fromDrowned = avesmapsAttachOffroadPointToGraph($drownedGraph, $drowned, $request, $water, $land, null, 62.0, 50.0, '__offroad_to');
assert($fromDrowned['ok'] === true, 'a place inside water is never refused for being wet: ' . json_encode($fromDrowned));

// ⚠️ B is nonetheless not the exit here, and the reason is worth stating: it sits in the MIDDLE of a
// 20-unit lake, so no dry way leads out of it -- the coastal tolerance frees 1 unit, not 10. The
// search therefore walked on to A. That is the fallback working, not the land rule leaking into the
// place lookup: B was never rejected, it was only unreachable.
assert($fromDrowned['exit_node'] === 'A', 'the search falls back to the next node, got ' . $fromDrowned['exit_node']);
assert($fromDrowned['exit_nodes_tried'] === 2, 'and it took exactly two tries');

// 💣 THE REAL CASE IS THE OTHER ONE: a harbour town drawn just inside a generously drawn coastline.
// Belhanka and Kuslik are that, and V13 measured the slop at 1,0 map unit. Such a node must be a
// perfectly ordinary exit -- on the FIRST try.
$harbour = [$place('A', 5.0, 10.0), $place('Hafen', 40.6, 50.0)];
$harbourGraph = ['graph' => ['A' => [], 'Hafen' => []], 'statistics' => []];
avesmapsAddClientCompatibleGraphConnection($harbourGraph['graph'], 'A', 'Hafen', $road('A', 'Hafen', 20.0));
avesmapsAddClientCompatibleGraphConnection($harbourGraph['graph'], 'Hafen', 'A', $road('Hafen', 'A', 20.0));
$fromHarbour = avesmapsAttachOffroadPointToGraph($harbourGraph, $harbour, $request, $water, $land, null, 36.0, 50.0, '__offroad_to');
assert($fromHarbour['ok'] === true, 'a coastal node must work: ' . json_encode($fromHarbour));
assert($fromHarbour['exit_node'] === 'Hafen' && $fromHarbour['exit_nodes_tried'] === 1, 'and on the first try');

// An empty graph: no exit node, and a distinct code -- „nowhere to start from" is not „no way".
$emptyGraph = ['graph' => [], 'statistics' => []];
$noExit = avesmapsAttachOffroadPointToGraph($emptyGraph, [], $request, $water, $land, null, 20.0, 20.0, '__offroad_to');
assert($noExit['ok'] === false && $noExit['error'] === 'no_exit_node', 'an empty graph has no exit node');

// ============================================================ D. the answer names its cell width

assert(isset($report['cell_mapunits']) && $report['cell_mapunits'] > 0.0, 'the report names the cell width used');
assert($report['cell_mapunits'] === AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS, 'a small box uses the configured width');
assert($report['coarsened'] === false, 'and says it was not coarsened');

echo "offroad-leg-test: OK\n";

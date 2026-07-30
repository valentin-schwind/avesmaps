<?php
// api/_internal/routing/__tests__/water-bridge-test.php
declare(strict_types=1);

/**
 * Unit tests for the V13 two-stage bridge build in
 * api/_internal/routing/client-graph.php (spec §4.4) and for the capped candidate search.
 *
 * The geometry below is arranged so the dry alternative sits at RANK 3: the nearest pair is wet, the
 * second is wet too, the third is dry. That is the only arrangement that proves all three stages at
 * once -- refuse the nearest, keep looking, take the first dry one.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/water-bridge-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../client-graph.php';

// ============================================================ A. the capped candidate collector

$place = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'route_x' => $x, 'route_y' => $y,
    'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];
$lookup = avesmapsBuildClientCompatibleLocationLookup([
    $place('A1', 0.0, 0.0), $place('A2', 0.0, 10.0),
    $place('B1', 28.0, 0.0), $place('B2', 30.0, 10.0),
]);
$detached = ['B1', 'B2'];
$anchors = ['A1', 'A2'];

$capped = avesmapsCollectNearestClientComponentConnections($detached, $anchors, $lookup, 3);
assert(count($capped) === 3, 'the cap must hold: 4 pairs, limit 3, got ' . count($capped));
for ($index = 1; $index < count($capped); $index++) {
    assert($capped[$index - 1]['distance'] <= $capped[$index]['distance'],
        'the candidates must come out ascending by distance');
}
assert(abs($capped[0]['distance'] - 28.0) < 1e-9, 'the nearest pair is A1-B1 at 28, got ' . $capped[0]['distance']);
assert(abs($capped[2]['distance'] - 30.0) < 1e-9, 'rank 3 is A2-B2 at 30, got ' . $capped[2]['distance']);

// --- 💣 THE INVARIANT THE TWO-STAGE DESIGN RESTS ON ----------------------------------------------
// Stage 2 tests the single nearest pair; stage 3 then walks the capped list FROM INDEX 1, trusting
// that index 0 is the very pair stage 2 already judged. If the two searches ever disagreed on which
// pair is nearest -- on a tie, say -- stage 3 would silently skip an untested candidate and could
// refuse a bridge that was dry all along. So it is asserted, not assumed.
$single = avesmapsFindNearestClientCompatibleComponentConnection($detached, $anchors, $lookup);
assert(is_array($single), 'the existing single search must still find a pair');
assert($single['from_location']['name'] === $capped[0]['from_location']['name']
    && $single['to_location']['name'] === $capped[0]['to_location']['name'],
    'candidate 0 of the capped list MUST be the pair the single nearest search returns');

// --- a limit beyond the pair count returns every pair, still ordered ------------------------------
$all = avesmapsCollectNearestClientComponentConnections($detached, $anchors, $lookup, 99);
assert(count($all) === 4, 'four pairs exist, got ' . count($all));
assert(abs($all[3]['distance'] - hypot(30.0, 10.0)) < 1e-9, 'the farthest pair is A1-B2');

// --- defensive edges ------------------------------------------------------------------------------
assert(avesmapsCollectNearestClientComponentConnections($detached, $anchors, $lookup, 0) === [],
    'a limit of zero yields nothing rather than everything');
assert(avesmapsCollectNearestClientComponentConnections(['ghost'], $anchors, $lookup, 5) === [],
    'a node missing from the lookup is skipped, not fatal');
assert(avesmapsCollectNearestClientComponentConnections($detached, [], $lookup, 5) === [],
    'no anchors, no candidates');

// ============================================================ B. the build, end to end

require_once __DIR__ . '/../water-areas.php';

// Two two-node components, 28 to 30 units apart. Everything else in the graph is ordinary.
$network = [
    'locations' => [
        ['name' => 'A1', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
        ['name' => 'A2', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 10.0]]],
        ['name' => 'B1', 'geometry' => ['type' => 'Point', 'coordinates' => [28.0, 0.0]]],
        ['name' => 'B2', 'geometry' => ['type' => 'Point', 'coordinates' => [30.0, 10.0]]],
    ],
    'paths' => [
        ['id' => 'wA', 'public_id' => 'wA', 'client_path_id' => 'path-1', 'name' => 'Strasse',
         'subtype' => 'Strasse', 'properties' => [], 'flow' => null,
         'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [0.0, 10.0]]]],
        ['id' => 'wB', 'public_id' => 'wB', 'client_path_id' => 'path-2', 'name' => 'Strasse',
         'subtype' => 'Strasse', 'properties' => [], 'flow' => null,
         'geometry' => ['type' => 'LineString', 'coordinates' => [[28.0, 0.0], [30.0, 10.0]]]],
    ],
];
$request = [
    'transports' => AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true],
];

$rectangle = static fn(float $minX, float $maxX, float $minY, float $maxY): array => [
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$minX, $minY], [$maxX, $minY], [$maxX, $maxY], [$minX, $maxY], [$minX, $minY],
    ]]],
    'min_x' => $minX, 'min_y' => $minY, 'max_x' => $maxX, 'max_y' => $maxY,
];

$syntheticBetween = static function (array $graph, string $one, string $other): ?array {
    foreach ($graph[$one][$other] ?? [] as $connection) {
        if (($connection['synthetic'] ?? false) === true) { return $connection; }
    }

    return null;
};

// --- 1. no water: EXACTLY today's behaviour -- the nearest pair is bridged -------------------------
$plain = avesmapsBuildClientCompatibleRouteGraph($network, $request);
assert($plain['statistics']['synthetic_connection_count'] === 1,
    'without water the two components are bridged as they are today');
assert($syntheticBetween($plain['graph'], 'B1', 'A1') !== null,
    'and the bridge is the NEAREST pair, B1-A1');

// --- 2. a narrow strait: the nearest two chords are wet, rank 3 is dry -----------------------------
// Sea from x 10..20, y -5..5. A1-B1 (y=0, rank 1) and A2-B1 (rank 2) cross it; A2-B2 (y=10, rank 3)
// passes north of it.
$strait = avesmapsPrepareRouteWater([$rectangle(10.0, 20.0, -5.0, 5.0)]);
$bridged = avesmapsBuildClientCompatibleRouteGraph($network, $request, [], $strait);
assert($bridged['statistics']['synthetic_connection_count'] === 1,
    'a dry alternative exists, so a bridge must still be built');
assert($syntheticBetween($bridged['graph'], 'B1', 'A1') === null,
    'the NEAREST pair crosses the strait and must NOT be bridged');
assert($syntheticBetween($bridged['graph'], 'B2', 'A2') !== null,
    'the dry pair at rank 3 must be the one that gets the bridge');
// Both directions, as every other edge in this graph has.
assert($syntheticBetween($bridged['graph'], 'A2', 'B2') !== null,
    'a synthetic bridge is bidirectional');

// --- 3. 💣 water all the way across: NO edge at all, and the planner says „no route" ---------------
// Owner decision 2026-07-29 („Wirklich weglassen."): no fallback, no specially labelled edge.
$wall = avesmapsPrepareRouteWater([$rectangle(10.0, 20.0, -100.0, 100.0)]);
$dropped = avesmapsBuildClientCompatibleRouteGraph($network, $request, [], $wall);
assert($dropped['statistics']['synthetic_connection_count'] === 0,
    'with no dry pair anywhere, no bridge may be built');
foreach (['A1', 'A2'] as $anchor) {
    foreach (['B1', 'B2'] as $far) {
        assert($syntheticBetween($dropped['graph'], $far, $anchor) === null,
            "no synthetic edge may connect $far to $anchor across open water");
        assert($syntheticBetween($dropped['graph'], $anchor, $far) === null,
            "and none in the other direction either ($anchor to $far)");
    }
}
// The real paths are untouched -- V13 removes bridges, never drawn ways.
assert(isset($dropped['graph']['A1']['A2']), 'the drawn way inside component A must survive');
assert(isset($dropped['graph']['B1']['B2']), 'the drawn way inside component B must survive');

// --- 4. the coastal tolerance reaches all the way through the build --------------------------------
// A sea that covers B1 but only grazes the chord's end: the bridge must still be built, because a
// harbour drawn inside the coastline is drawing slop (spec §4.3, 55 named places).
$harbour = avesmapsPrepareRouteWater([$rectangle(27.6, 28.4, -0.4, 0.4)]);
$coastal = avesmapsBuildClientCompatibleRouteGraph($network, $request, [], $harbour);
assert($coastal['statistics']['synthetic_connection_count'] === 1,
    'a place drawn just inside its own coastline must not lose its land connection');
assert($syntheticBetween($coastal['graph'], 'B1', 'A1') !== null,
    'and it keeps the nearest bridge, not a detour');

// ============================================================ B2. the SECOND producer (§4.6)
//
// 💣 avesmapsConnectClientRouteWaypointsToNearestLandPath makes Querfeldein edges too -- the short
// anchor from a travel waypoint onto the nearest land path. Forget it and the lock is half built, and
// half built exactly at the places the user types in themselves.
//
// Two land paths, both vertical: one 10 units east of the waypoint, one 30 units west. A water band
// sits between the waypoint and the NEAR one, so the near anchor is wet and the far one is dry.
$landPath = static function (string $name, array $coordinates): array {
    return [
        'route_type' => 'Strasse', 'from' => $name . '-A', 'to' => $name . '-B',
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'synthetic' => false,
    ];
};
$anchorGraph = [
    'Nah-A' => ['Nah-B' => [$landPath('Nah', [[10.0, -20.0], [10.0, 20.0]])]],
    'Fern-A' => ['Fern-B' => [$landPath('Fern', [[-30.0, -20.0], [-30.0, 20.0]])]],
];

// Without water: the nearest projection wins, exactly as before V13.
$dry = avesmapsFindNearestClientLandPathAnchor($anchorGraph, 0.0, 0.0);
assert(is_array($dry) && abs($dry['distance'] - 10.0) < 1e-9,
    'without water the anchor is the nearest land path, 10 units east');
assert($dry['from'] === 'Nah-A', 'and that is the eastern path');

// A band between the waypoint and the near path: the near anchor chord is wet, the far one is dry.
$band = avesmapsPrepareRouteWater([$rectangle(4.0, 6.0, -100.0, 100.0)]);
$detour = avesmapsFindNearestClientLandPathAnchor($anchorGraph, 0.0, 0.0, $band);
assert(is_array($detour), 'a dry anchor exists further away and must be found');
assert($detour['from'] === 'Fern-A',
    'the anchor must skip the near path behind the water and take the dry one, got ' . $detour['from']);
assert(abs($detour['distance'] - 30.0) < 1e-9, 'the dry anchor is 30 units west');

// Water over the waypoint itself, reaching both paths: no dry anchor, so NO anchor (spec §4.6).
$flooded = avesmapsPrepareRouteWater([$rectangle(-100.0, 100.0, -1.0, 1.0)]);
assert(avesmapsFindNearestClientLandPathAnchor($anchorGraph, 0.0, 0.0, $flooded) === null,
    'with every anchor chord wet, the waypoint gets no anchor at all rather than a wet one');

// ============================================================ C. the dead proxy rule is gone (§4.5)
//
// AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE refused a bridge when the COMPONENT was
// „sea-connected". Measured against the live stock: it fires 0 times out of 896 in normal operation,
// and it cannot fire -- a component with a Seeweg hangs off the main component through that very
// Seeweg and is not detached at all. It only ever spoke up in the pure pedestrian case, 17 times, and
// 2 of those were wrong (dry land bridges it refused). The geometry now answers the same question
// directly, so the proxy goes away rather than being repaired.
assert(!defined('AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE'),
    'the dead 20-unit proxy rule must be GONE, not merely unused -- a dormant second gate is how a '
    . 'later reader concludes water is already handled');
assert(!function_exists('avesmapsClientComponentIsSeaConnected'),
    'the proxy predicate goes with it');

// ⚠️ BUT these two stay. Different question, different mechanism: they recognise a node reachable ONLY
// by ship (it touches a Seeweg and has no land edge). Removing them along with the proxy would let
// land bridges land on island harbours -- which is what §4.5 of the spec warns about explicitly.
assert(function_exists('avesmapsFilterOutClientWaterLockedNodes'),
    'the water-locked node filter must survive §4.5');
assert(function_exists('avesmapsClientNodeIsWaterLocked'),
    'and so must its predicate');

echo "water-bridge: alle Pruefungen bestanden\n";

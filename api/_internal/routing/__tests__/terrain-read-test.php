<?php
// api/_internal/routing/__tests__/terrain-read-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 terrain lookup on the routing path
 * (api/_internal/routing/terrain-read.php).
 *
 * The DB half is not exercised here; what is tested is the PURE matching rule -- the one that made
 * V10 fail live on the same day: a field called `id` that is not the `id`.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../client-graph.php';
// require_once, not require: client-graph.php now pulls this file in itself (task 9b), and a plain
// require here would re-include it and fatal on "Cannot redeclare function".
require_once __DIR__ . '/../terrain-read.php';
require __DIR__ . '/../map-data.php';
require __DIR__ . '/../network-data.php';

// --- 💣 THE KEY IS public_id, AND `id` IS NOT THE id ---------------------------------------------
// avesmapsBuildRoutePathData sets 'id' => public_id. A lookup by $path['id'] would translate, run,
// and miss every row -- landing on factor 1,0, the value that also means „switch off".
$feature = [
    'id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0]]],
    'properties' => [
        'public_id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'feature_type' => 'path', 'feature_subtype' => 'Strasse', 'name' => 'Strasse',
        'geometry_type' => 'LineString', 'properties' => [], 'style' => [],
        'revision' => 42, 'updated_at' => '',
    ],
];
$pathData = avesmapsBuildRoutePathData($feature, 'path-1');

// 💣 THE ONE THAT WAS MISSING: the way's own revision must survive the trip into the graph payload.
// map-data.php puts it in properties.revision; before this task avesmapsBuildRoutePathData dropped
// it, so path_revision would have been a dead comparison.
assert(array_key_exists('revision', $pathData),
    'avesmapsBuildRoutePathData must carry the way OWN revision -- path_revision compares against it');
assert($pathData['revision'] === 42, 'the revision must arrive unchanged, got ' . var_export($pathData['revision'] ?? null, true));

// --- the attachment rule -----------------------------------------------------------------------
$terrain = [
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => [
        'ascent' => 1200.0, 'descent' => 300.0, 'profile' => [[1200.0, 300.0]], 'revision' => 42,
    ],
];
$attached = avesmapsRouteAttachTerrain($pathData, $terrain);
assert($attached !== null, 'a way with a matching, current profile must get its terrain');
assert($attached['ascent'] === 1200.0, 'the ascent must arrive');

// A stale path_revision means the stored profile describes a DIFFERENT geometry -- local, specific,
// and self-healing: it is dropped, and the way falls back to factor 1,0.
$stale = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => ['ascent' => 1.0, 'descent' => 0.0, 'profile' => [[1.0, 0.0]], 'revision' => 41]];
assert(avesmapsRouteAttachTerrain($pathData, $stale) === null,
    'a profile computed against another revision of THIS way must not be used');

// An unknown way is null, not zero.
assert(avesmapsRouteAttachTerrain($pathData, []) === null, 'no row means no data, not level ground');

// A row that carries null ascent (measured: no height data here) stays null, and stays
// distinguishable from „not stored".
$noData = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => ['ascent' => null, 'descent' => null, 'profile' => null, 'revision' => 42]];
assert(avesmapsRouteAttachTerrain($pathData, $noData) === null,
    'a stored row with no height data behaves like no data');

// --- 💣 CHECKED BY SEARCH: nothing on the routing path may key terrain by $path['id'] ------------
foreach (['terrain-read.php', 'client-graph.php', 'response.php'] as $file) {
    $source = (string) file_get_contents(__DIR__ . '/../' . $file);
    assert(!preg_match('/\\$terrain\\s*\\[\\s*\\$path\\s*\\[\\s*.id.\\s*\\]/', $source),
        $file . " must not key terrain by \$path['id'] -- that field IS the public_id, and the lookup "
        . 'would miss every row while looking perfectly fine');
}

// ---- the factor in the graph -------------------------------------------------------------------
require_once __DIR__ . '/../terrain-factor.php';

// One way, three vertices, no interior node: Anfang -> Ende over 20 units, climbing 3.000 Schritt
// on the first half and falling 3.000 on the second.
$network = [
    'locations' => [
        ['name' => 'Anfang', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
        ['name' => 'Ende', 'geometry' => ['type' => 'Point', 'coordinates' => [20.0, 0.0]]],
    ],
    'paths' => [[
        'id' => 'w1', 'public_id' => 'w1', 'client_path_id' => 'path-1',
        'name' => 'Strasse', 'subtype' => 'Strasse', 'revision' => 7,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]],
        'properties' => [], 'flow' => null,
    ]],
];
$plainRequest = ['transports' => AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'], 'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// --- 💣 THE EMPTY DEFAULT IS BIT-IDENTICAL WITH TODAY --------------------------------------------
$without = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest);
$edgeWithout = $without['graph']['Anfang']['Ende'][0];
assert(!array_key_exists('terrain_time_factor', $edgeWithout),
    'with no terrain the edge must be EXACTLY the object it is today -- no new keys');
// Both directions still SHARE one object when there is no terrain (today's behaviour).
assert($without['graph']['Anfang']['Ende'][0] === $without['graph']['Ende']['Anfang'][0],
    'without terrain the two directions stay the same shared object');

$terrainMap = ['w1' => ['ascent' => 3000.0, 'descent' => 3000.0,
    'profile' => [[3000.0, 0.0], [0.0, 3000.0]], 'revision' => 7, 'stamp' => 'x']];
$with = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $terrainMap);
$forward = $with['graph']['Anfang']['Ende'][0];
$backward = $with['graph']['Ende']['Anfang'][0];

// --- the factor is applied, and the same one both ways here (equal up and down) ------------------
assert(isset($forward['terrain_time_factor']), 'a way with a profile must carry its factor');
assert(abs($forward['time'] - $edgeWithout['time'] * $forward['terrain_time_factor']) < 1e-9,
    'the time must be the base time times the factor -- nothing else');
assert($forward['ascent_schritt'] === 3000.0 && $forward['descent_schritt'] === 3000.0,
    'ascent and descent travel with the edge');

// --- 💣 DIRECTION. from/to stay the STORED orientation on both variants (the verlauf flow
// derivation's chain walk depends on that, client-graph.php:218-219). Ascent one way is descent the
// other -- that is the whole rule, and from/to are NOT swapped.
assert($forward['from'] === 'Anfang' && $backward['from'] === 'Anfang',
    'from/to must stay the stored orientation on BOTH variants');
$asym = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0,
    'profile' => [[1500.0, 0.0], [1500.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];
$asymGraph = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $asym);
$up = $asymGraph['graph']['Anfang']['Ende'][0];
$down = $asymGraph['graph']['Ende']['Anfang'][0];
assert($up['terrain_time_factor'] > 1.0, 'going up must cost more');
assert($down['terrain_time_factor'] < 1.0, 'the same way downhill must be faster');
assert($up['ascent_schritt'] === 3000.0 && $down['ascent_schritt'] === 0.0,
    'the reverse variant climbs what the forward one falls');

// --- a stale path_revision falls back to today's number, silently and correctly ------------------
$staleMap = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0, 'profile' => [[3000.0, 0.0]], 'revision' => 6, 'stamp' => 'x']];
$staleGraph = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $staleMap);
assert(abs($staleGraph['graph']['Anfang']['Ende'][0]['time'] - $edgeWithout['time']) < 1e-12,
    'a profile computed against another revision of this way must not change its time');

// --- 💣 A SLICE USES ITS OWN SEGMENTS, NEVER THE PARENT AVERAGE ---------------------------------
// Split the way at an interior node sitting on the middle vertex. The first half climbs, the second
// falls -- with a parent average both halves would come out identical, and that is exactly the
// error the back-computation makes.
$split = $network;
$split['locations'][] = ['name' => 'Mitte', 'geometry' => ['type' => 'Point', 'coordinates' => [10.0, 0.0]]];
$splitGraph = avesmapsBuildClientCompatibleRouteGraph($split, $plainRequest, $terrainMap);
$firstHalf = $splitGraph['graph']['Anfang']['Mitte'][0];
$secondHalf = $splitGraph['graph']['Mitte']['Ende'][0];
assert($firstHalf['ascent_schritt'] === 3000.0 && $firstHalf['descent_schritt'] === 0.0,
    'the first half must carry ITS climb, not half the way average');
assert($secondHalf['ascent_schritt'] === 0.0 && $secondHalf['descent_schritt'] === 3000.0,
    'the second half must carry ITS fall');
assert($firstHalf['terrain_time_factor'] > $secondHalf['terrain_time_factor'],
    'climbing half and falling half must not come out equal');

// --- 💣 THE RIVER CLAMP STAYS THE RIVER CLAMP ---------------------------------------------------
// Flow and slope MULTIPLY, and the flow factor keeps its own [1,0 ... 3,0]. Inheriting that bound
// for the slope would clamp every descent up to 1,0 and downhill would never be faster than level.
$river = $network;
$river['paths'][0]['subtype'] = 'Flussweg';
$river['paths'][0]['name'] = 'Flussweg';
$river['paths'][0]['flow'] = ['dir' => 'forward', 'factor' => 2.0];
$riverGraph = avesmapsBuildClientCompatibleRouteGraph($river, $plainRequest, $asym);
$riverUp = $riverGraph['graph']['Anfang']['Ende'][0];
assert($riverUp['flow_time_factor'] === 1.0, 'travelling WITH the current stays the base flow factor');
$riverBack = $riverGraph['graph']['Ende']['Anfang'][0];
assert($riverBack['flow_time_factor'] === 2.0, 'against the current the flow factor applies');
assert($riverBack['terrain_time_factor'] < 1.0, 'and the slope factor applies on top, independently');
$riverBase = avesmapsBuildClientCompatibleRouteGraph($river, $plainRequest)['graph']['Ende']['Anfang'][0];
assert(abs($riverBack['time'] - $riverBase['time'] * $riverBack['terrain_time_factor']) < 1e-9,
    'flow and slope must multiply, each with its own clamp');

// ---- THE SECOND TIME SITE: the waypoint anchor ------------------------------------------------
// 💣 THIS IS THE HIGHEST-RISK PATH IN THE FEATURE AND IT HAD NO COVERAGE AT ALL. It is the one that
// replaces the back-computation, and the acceptance step written for it originally asserted
// something that is TRUE OF THE BUG TOO (see task 12 step 5): the pieces sum to the parent either
// way, because the uphill part of the curve is linear. What discriminates is the FACTORS.
//
// An isolated place at (5, 5) with no path of its own gets anchored to the nearest land path, which
// is split at the projected point (5, 0) -- halfway along the way's first segment.
$anchorNetwork = [
    'locations' => [
        ['name' => 'Anfang', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
        ['name' => 'Ende', 'geometry' => ['type' => 'Point', 'coordinates' => [20.0, 0.0]]],
        ['name' => 'Einsiedel', 'geometry' => ['type' => 'Point', 'coordinates' => [5.0, 5.0]]],
    ],
    'paths' => [[
        'id' => 'w1', 'public_id' => 'w1', 'client_path_id' => 'path-1',
        'name' => 'Strasse', 'subtype' => 'Strasse', 'revision' => 7,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]],
        'properties' => [], 'flow' => null,
    ]],
];
$anchorRequest = $plainRequest + ['from' => 'Einsiedel', 'to' => 'Ende'];
// All the climb in the FIRST segment, the second dead level -- so the two pieces are unmistakably
// different ground and a parent average could not possibly describe both.
$anchorTerrain = ['w1' => ['ascent' => 6000.0, 'descent' => 0.0,
    'profile' => [[6000.0, 0.0], [0.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];

$anchored = avesmapsBuildClientCompatibleRouteGraph($anchorNetwork, $anchorRequest, $anchorTerrain);
$sliceA = null;
$sliceB = null;
foreach ($anchored['graph'] as $edges) {
    foreach ($edges as $connections) {
        foreach ($connections as $candidate) {
            $id = (string) ($candidate['id'] ?? '');
            if (str_ends_with($id, '-a')) { $sliceA = $candidate; }
            if (str_ends_with($id, '-b')) { $sliceB = $candidate; }
        }
    }
}
assert(is_array($sliceA) && is_array($sliceB),
    'the waypoint anchor must have split the path into two sub-slices');

$whole = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $anchorTerrain)['graph']['Anfang']['Ende'][0];

// 1. The two pieces carry DIFFERENT factors. With the back-computation both would carry the
//    parent's, and this is the assertion that says so out loud.
assert($sliceA['terrain_time_factor'] !== $sliceB['terrain_time_factor'],
    'the two sub-slices must not share one factor -- that is exactly the back-computation bug');
// 2. The steep piece is slower than the undivided edge; the level piece is faster. Measured:
//    parent 1,5 -- steep half 2,0 -- level remainder 1,3333.
$steep = $sliceA['ascent_schritt'] >= $sliceB['ascent_schritt'] ? $sliceA : $sliceB;
$gentle = $steep === $sliceA ? $sliceB : $sliceA;
assert($steep['terrain_time_factor'] > $whole['terrain_time_factor'],
    'the piece carrying the climb must be SLOWER than the parent average, got '
    . $steep['terrain_time_factor'] . ' vs ' . $whole['terrain_time_factor']);
assert($gentle['terrain_time_factor'] < $whole['terrain_time_factor'],
    'the level piece must be FASTER than the parent average');
// 3. The split is conservative in climb and fall: nothing is invented, nothing is lost.
assert(abs(($sliceA['ascent_schritt'] + $sliceB['ascent_schritt']) - $whole['ascent_schritt']) < 1e-6,
    'the pieces must carry exactly the parent way climb between them');
assert(abs(($sliceA['descent_schritt'] + $sliceB['descent_schritt']) - $whole['descent_schritt']) < 1e-6,
    'the pieces must carry exactly the parent way fall between them');

// 4. 💣 WITH NO TERRAIN THE SPLIT IS LOSSLESS AND INVISIBLE. This is the half that protects the
//    published numbers: the anchor already existed and must keep behaving exactly as it did.
$anchoredOff = avesmapsBuildClientCompatibleRouteGraph($anchorNetwork, $anchorRequest);
$offA = null;
$offB = null;
foreach ($anchoredOff['graph'] as $edges) {
    foreach ($edges as $connections) {
        foreach ($connections as $candidate) {
            $id = (string) ($candidate['id'] ?? '');
            if (str_ends_with($id, '-a')) { $offA = $candidate; }
            if (str_ends_with($id, '-b')) { $offB = $candidate; }
        }
    }
}
$wholeOff = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest)['graph']['Anfang']['Ende'][0];
assert(abs(($offA['time'] + $offB['time']) - $wholeOff['time']) < 1e-9,
    'without terrain the split must be exactly lossless');
assert(!array_key_exists('terrain_time_factor', $offA) && !array_key_exists('terrain_time_factor', $offB),
    'without terrain a sub-slice must carry no terrain key at all');

fwrite(STDOUT, "terrain-read-test: all asserts passed\n");

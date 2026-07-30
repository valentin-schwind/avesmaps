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
        'ascent' => 1200.0, 'descent' => 300.0, 'profile' => [[1200.0, 300.0, 0.0, 0.0]], 'revision' => 42,
    ],
];
$attached = avesmapsRouteAttachTerrain($pathData, $terrain);
assert($attached !== null, 'a way with a matching, current profile must get its terrain');
assert($attached['ascent'] === 1200.0, 'the ascent must arrive');

// A stale path_revision means the stored profile describes a DIFFERENT geometry -- local, specific,
// and self-healing: it is dropped, and the way falls back to factor 1,0.
$stale = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => ['ascent' => 1.0, 'descent' => 0.0, 'profile' => [[1.0, 0.0, 0.0, 0.0]], 'revision' => 41]];
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
    'profile' => [[3000.0, 0.0, 0.0, 0.0], [0.0, 3000.0, 0.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];
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
    'profile' => [[1500.0, 0.0, 0.0, 0.0], [1500.0, 0.0, 0.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];
$asymGraph = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $asym);
$up = $asymGraph['graph']['Anfang']['Ende'][0];
$down = $asymGraph['graph']['Ende']['Anfang'][0];
assert($up['terrain_time_factor'] > 1.0, 'going up must cost more');
// 🔴 THE MODEL CHANGED HERE ON 2026-07-30 AND THIS LINE IS THE PROOF. It used to read
// `< 1.0` -- „the same way downhill must be faster". Under the Leistungskilometer a GENTLE descent
// (this one is 5 %) is free, never a bonus: nothing is ever quicker than the level. A steep descent
// would cost, and that is what the steep sums are for.
assert($down['terrain_time_factor'] === 1.0,
    'a gentle descent is free under the Leistungskilometer -- neither a penalty nor a bonus');
assert($up['ascent_schritt'] === 3000.0 && $down['ascent_schritt'] === 0.0,
    'the reverse variant climbs what the forward one falls');

// --- 🔴 A PRE-MODEL ROW STILL SHOWS ITS ELEVATION, IT JUST IS NOT PRICED ------------------
// Rows written before 2026-07-30 hold pairs of TWO: ascent and descent, nothing about steepness.
//
// 💣 The first version of the guard threw the whole slice away, so `ascent_schritt` came back null
// and the leg display „Auf und ab“ vanished from every route until a profile run. The owner noticed
// within the hour. The elevation in such a row is not wrong -- it was walked over the same rasters by
// the same code. Only the split into steep and gentle is new, and only the PRICE needs it.
$legacy = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0,
    'profile' => [[1500.0, 0.0], [1500.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];
$legacyGraph = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $legacy);
$legacyEdge = $legacyGraph['graph']['Anfang']['Ende'][0];
assert($legacyEdge['ascent_schritt'] === 3000.0 && $legacyEdge['descent_schritt'] === 0.0,
    'a two-value row must still report its climb and fall -- the display depends on nothing else');
assert($legacyEdge['terrain_time_factor'] === 1.0,
    'but it must not be priced: without the steep sums the factor is exactly 1.0');
assert(abs($legacyEdge['time'] - $edgeWithout['time']) < 1e-12,
    'and the time must be the untouched one, to the last bit');
// The reverse direction too: elevation swapped, still unpriced.
$legacyBack = $legacyGraph['graph']['Ende']['Anfang'][0];
assert($legacyBack['ascent_schritt'] === 0.0 && $legacyBack['descent_schritt'] === 3000.0,
    'the reverse variant of a legacy row swaps its elevation like any other');
assert($legacyBack['terrain_time_factor'] === 1.0, 'and stays unpriced in both directions');

// 💣 AND THE ONE THING THAT MUST NEVER HAPPEN: reading the second value of a short row as the
// steep-descent sum. That would bill every gentle descent as a steep one, silently. A pure-descent
// legacy row is the case that would expose it -- 3.000 Schritt of gentle fall must cost NOTHING.
$legacyFall = ['w1' => ['ascent' => 0.0, 'descent' => 3000.0,
    'profile' => [[0.0, 1500.0], [0.0, 1500.0]], 'revision' => 7, 'stamp' => 'x']];
$fallEdge = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $legacyFall)['graph']['Anfang']['Ende'][0];
assert($fallEdge['descent_schritt'] === 3000.0, 'the fall is reported');
assert($fallEdge['terrain_time_factor'] === 1.0,
    'and it is NOT billed as a steep descent -- unknown steepness means unpriced, never 150-Schritt rate');

// --- a stale path_revision falls back to today's number, silently and correctly ------------------
$staleMap = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0, 'profile' => [[3000.0, 0.0, 0.0, 0.0]], 'revision' => 6, 'stamp' => 'x']];
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

// --- 🔴 WATER CARRIES NO SLOPE AT ALL (owner decision 2026-07-30) -------------------------------
// A boat does not climb. A river is already priced by its CURRENT, and the procedural height field
// knows nothing about where a river runs -- before this rule the steepest piece of the whole map was
// a river (the Vildrom, 3,6019 upstream), steeper than every mountain pass.
//
// 💣 THIS BLOCK USED TO ASSERT THE OPPOSITE ("flow and slope must multiply"). It was not wrong then:
// there was no path-type gate, and the invariant it protected -- that the slope clamp is NOT the
// river clamp [1,0 … 3,0] -- was real while the slope could fall below 1,0. Under the
// Leistungskilometer it cannot, so that particular clash is gone; the gate below is what remains,
// and it is the one that matters. Do not re-add a river version of the slope.
$river = $network;
$river['paths'][0]['subtype'] = 'Flussweg';
$river['paths'][0]['name'] = 'Flussweg';
$river['paths'][0]['flow'] = ['dir' => 'forward', 'factor' => 2.0];
$riverGraph = avesmapsBuildClientCompatibleRouteGraph($river, $plainRequest, $asym);
$riverUp = $riverGraph['graph']['Anfang']['Ende'][0];
assert($riverUp['flow_time_factor'] === 1.0, 'travelling WITH the current stays the base flow factor');
$riverBack = $riverGraph['graph']['Ende']['Anfang'][0];
assert($riverBack['flow_time_factor'] === 2.0, 'against the current the flow factor applies');

// The gate: no key at all, not a factor of 1,0 -- „untouched" and „measured flat" stay distinct.
assert(!array_key_exists('terrain_time_factor', $riverUp) && !array_key_exists('terrain_time_factor', $riverBack),
    'a Flussweg must carry NO terrain key, even when a profile exists for it');
assert(!array_key_exists('ascent_schritt', $riverBack),
    'and no ascent either -- the infobox line „Auf und ab" must stay away from rivers');

// And the flow pricing is untouched by the decision: bit-identical to the same river with no terrain.
$riverBase = avesmapsBuildClientCompatibleRouteGraph($river, $plainRequest)['graph']['Ende']['Anfang'][0];
assert($riverBack['time'] === $riverBase['time'],
    'excluding water must leave the flow-only time EXACTLY as it was');

// The same profile map on the same geometry DOES still reach a land way -- otherwise this test would
// pass on a gate that switched terrain off everywhere.
$landUp = $asymGraph['graph']['Anfang']['Ende'][0];
assert(isset($landUp['terrain_time_factor']) && $landUp['terrain_time_factor'] > 1.0,
    'the identical profile must still apply on land -- the gate must be about water, not about everything');

// --- the predicate, and the hard counter that has to agree with it -------------------------------
assert(avesmapsRouteTerrainAppliesTo('Gebirgspass') && avesmapsRouteTerrainAppliesTo('Reichsstrasse')
    && avesmapsRouteTerrainAppliesTo('Querfeldein'),
    'land types and the synthetic type keep their slope');
assert(!avesmapsRouteTerrainAppliesTo('Flussweg') && !avesmapsRouteTerrainAppliesTo('Seeweg'),
    'water gets no slope');
// 💣 A DENY LIST: an unknown/future subtype must KEEP terrain, not silently lose it.
assert(avesmapsRouteTerrainAppliesTo('Karrenweg') && avesmapsRouteTerrainAppliesTo(''),
    'an unknown subtype must keep its slope -- the list names water, it does not whitelist land');

$oneTerrainRow = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0, 'profile' => [[3000.0, 0.0, 0.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];
assert(avesmapsRouteAttachTerrain(['public_id' => 'w1', 'revision' => 7, 'subtype' => 'Flussweg'], $oneTerrainRow) === null,
    'avesmapsRouteAttachTerrain must refuse water outright');
assert(avesmapsRouteAttachTerrain(['public_id' => 'w1', 'revision' => 7, 'subtype' => 'Pfad'], $oneTerrainRow) !== null,
    'and must still serve land');
assert(avesmapsRouteCountTerrainMatches([
    ['public_id' => 'w1', 'revision' => 7, 'subtype' => 'Pfad'],
    ['public_id' => 'w1', 'revision' => 7, 'subtype' => 'Flussweg'],
    ['public_id' => 'w1', 'revision' => 7, 'subtype' => 'Seeweg'],
], $oneTerrainRow) === 1,
    'the hard counter must count what the router APPLIES -- one land way, not three');

// ---- THE SECOND TIME SITE: the waypoint anchor ------------------------------------------------
// 💣 THIS IS THE HIGHEST-RISK PATH IN THE FEATURE AND IT HAD NO COVERAGE AT ALL. It is the one that
// replaces the back-computation, and the acceptance step written for it originally asserted
// something that is TRUE OF THE BUG TOO (see task 12 step 5): the pieces sum to the parent either
// way, because the uphill part of the curve is linear. What discriminates is the FACTORS.
//
// 💣 AND THE FIRST VERSION OF THIS BLOCK COULD NOT DETECT A BROKEN SPLIT EITHER -- the same disease
// as the acceptance step it was written to replace, which is why it is worth spelling out. It cut at
// exactly t = 0,5 with all the climb in one segment, so the true split was a symmetric 3000/3000;
// then a mutation returning `[$profile, null]` (piece A gets EVERYTHING, piece B nothing) passed
// every assertion. Three reasons at once: the conservation check permits any reallocation of the
// same total, the steep/gentle labels were derived FROM the values under test so they relabelled
// themselves, and "the factors differ" was satisfied by the differing piece LENGTHS alone.
//
// So: cut at t = 0,3, give the two segments different climb AND fall, address the four edges by
// their GRAPH POSITION rather than by scanning for an id, and pin ABSOLUTE numbers.
//   way [[0,0],[10,0],[20,0]], profile [[6000,1000],[2000,0]]
//   waypoint (3,5) projects to (3,0) = t 0,3 of segment 0
//   -> piece a: 0,3 x [6000,1000]              = ascent 1800, descent 300, length 3
//   -> piece b: 0,7 x [6000,1000] + [2000,0]   = ascent 6200, descent 700, length 17
$anchorNetwork = [
    'locations' => [
        ['name' => 'Anfang', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
        ['name' => 'Ende', 'geometry' => ['type' => 'Point', 'coordinates' => [20.0, 0.0]]],
        ['name' => 'Einsiedel', 'geometry' => ['type' => 'Point', 'coordinates' => [3.0, 5.0]]],
    ],
    'paths' => [[
        'id' => 'w1', 'public_id' => 'w1', 'client_path_id' => 'path-1',
        'name' => 'Strasse', 'subtype' => 'Strasse', 'revision' => 7,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]],
        'properties' => [], 'flow' => null,
    ]],
];
$anchorRequest = $plainRequest + ['from' => 'Einsiedel', 'to' => 'Ende'];
$anchorTerrain = ['w1' => ['ascent' => 8000.0, 'descent' => 1000.0,
    'profile' => [[6000.0, 1000.0, 0.0, 0.0], [2000.0, 0.0, 0.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];

$anchored = avesmapsBuildClientCompatibleRouteGraph($anchorNetwork, $anchorRequest, $anchorTerrain)['graph'];
// The anchor node is named after the waypoint's index in from/to/via -- „Einsiedel" is index 0.
$forwardA = $anchored['Anfang']['__wp_anchor_0'][0] ?? null;
$reverseA = $anchored['__wp_anchor_0']['Anfang'][0] ?? null;
$forwardB = $anchored['__wp_anchor_0']['Ende'][0] ?? null;
assert(is_array($forwardA) && is_array($reverseA) && is_array($forwardB),
    'the waypoint anchor must have split the path and hung both directions of each piece');
foreach (['ascent_schritt', 'descent_schritt', 'terrain_time_factor'] as $key) {
    assert(array_key_exists($key, $forwardA) && array_key_exists($key, $forwardB),
        'a sub-slice with terrain must carry ' . $key . ' -- a missing key would make the numeric '
        . 'assertions below read null and silently pass');
}

// 1. ABSOLUTE values on the NAMED pieces. This is the assertion that actually pins the proportional
//    cut: a split that hands one piece everything, or divides at the wrong fraction, fails here and
//    cannot hide behind a conserved total.
assert(abs($forwardA['ascent_schritt'] - 1800.0) < 1e-6,
    'piece a is 0,3 of segment 0: 1800 Schritt of climb, got ' . $forwardA['ascent_schritt']);
assert(abs($forwardA['descent_schritt'] - 300.0) < 1e-6,
    'piece a is 0,3 of segment 0: 300 Schritt of fall, got ' . $forwardA['descent_schritt']);
assert(abs($forwardB['ascent_schritt'] - 6200.0) < 1e-6,
    'piece b is 0,7 of segment 0 plus all of segment 1: 6200 Schritt of climb, got ' . $forwardB['ascent_schritt']);
assert(abs($forwardB['descent_schritt'] - 700.0) < 1e-6,
    'piece b is 0,7 of segment 0: 700 Schritt of fall, got ' . $forwardB['descent_schritt']);

// 2. Conservation on top -- necessary, and on its own not sufficient (see the note above).
$whole = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $anchorTerrain)['graph']['Anfang']['Ende'][0];
assert(abs(($forwardA['ascent_schritt'] + $forwardB['ascent_schritt']) - $whole['ascent_schritt']) < 1e-6,
    'the pieces must carry exactly the parent way climb between them');
assert(abs(($forwardA['descent_schritt'] + $forwardB['descent_schritt']) - $whole['descent_schritt']) < 1e-6,
    'the pieces must carry exactly the parent way fall between them');

// 3. 💣 DIRECTION AT THE SECOND TIME SITE. The anchor used to hang ONE object in both graph
//    directions, so the downhill traversal was billed at the uphill factor -- measured 2,0 where
//    0,82 was right, 2,44x too slow. from/to still keep the stored orientation; only the numbers
//    turn around.
assert(abs($reverseA['ascent_schritt'] - 300.0) < 1e-6,
    'travelling piece a the other way climbs what it fell: 300, got ' . $reverseA['ascent_schritt']);
assert(abs($reverseA['descent_schritt'] - 1800.0) < 1e-6,
    'travelling piece a the other way falls what it climbed: 1800, got ' . $reverseA['descent_schritt']);
assert($reverseA['terrain_time_factor'] < $forwardA['terrain_time_factor'],
    'the downhill direction of a climbing piece must be FASTER than the uphill one');
assert((string) $reverseA['from'] === (string) $forwardA['from']
    && (string) $reverseA['to'] === (string) $forwardA['to'],
    'from/to keep the STORED orientation on both variants -- the chain walk depends on it');

// 4. 💣 WITH NO TERRAIN THE SPLIT IS LOSSLESS AND INVISIBLE. This is the half that protects the
//    published numbers: the anchor already existed and must keep behaving exactly as it did.
$anchoredOff = avesmapsBuildClientCompatibleRouteGraph($anchorNetwork, $anchorRequest)['graph'];
$offA = $anchoredOff['Anfang']['__wp_anchor_0'][0];
$offB = $anchoredOff['__wp_anchor_0']['Ende'][0];
$wholeOff = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest)['graph']['Anfang']['Ende'][0];
assert(abs(($offA['time'] + $offB['time']) - $wholeOff['time']) < 1e-9,
    'without terrain the split must be exactly lossless');
assert(!array_key_exists('terrain_time_factor', $offA) && !array_key_exists('terrain_time_factor', $offB),
    'without terrain a sub-slice must carry no terrain key at all');
assert($anchoredOff['__wp_anchor_0']['Anfang'][0] === $offA,
    'without terrain both directions must still be the SAME value -- exactly today s behaviour');

fwrite(STDOUT, "terrain-read-test: all asserts passed\n");

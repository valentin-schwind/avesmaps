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
require __DIR__ . '/../terrain-read.php';
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

fwrite(STDOUT, "terrain-read-test: all asserts passed\n");

<?php

declare(strict_types=1);

/**
 * Unit tests for the per-path transport restriction in the server route graph
 * (api/_internal/routing/client-graph.php).
 *
 * A path may carry the editor pair transport_domain + allowed_transports ("Erlaubte
 * Transportmittel", written together by api/_internal/map/features.php). The graph must only admit
 * an edge for a transport the path actually allows -- mirroring js/routing/route-engine.js
 * isTransportAllowedForPath. Real case: the upper Raller (Rallerquell -> Hirschfurt) is stored with
 * an EMPTY allowed_transports (no boat gets up there), the lower Raller allows riverBarge only.
 *
 * No DB, no HTTP: client-graph.php and request.php are side-effect-free on include (function/const
 * definitions only). Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/transport-restriction-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../client-graph.php';

const AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER = ['land' => 'groupFoot', 'river' => 'riverSailer', 'sea' => 'cargoShip', 'synthetic' => 'groupFoot'];
const AVESMAPS_TEST_TRANSPORTS_RIVER_BARGE = ['land' => 'groupFoot', 'river' => 'riverBarge', 'sea' => 'cargoShip', 'synthetic' => 'groupFoot'];
const AVESMAPS_TEST_TRANSPORTS_CARRIAGE = ['land' => 'horseCarriage', 'river' => 'riverSailer', 'sea' => 'cargoShip', 'synthetic' => 'horseCarriage'];

// Two locations 10 units apart, joined by exactly one path: does the builder admit that path?
function avesmapsTestBuildRouteNetwork(string $subtype, array $pathProperties): array {
    return [
        'locations' => [
            ['name' => 'Quellort', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
            ['name' => 'Zielort', 'geometry' => ['type' => 'Point', 'coordinates' => [10.0, 0.0]]],
        ],
        'paths' => [[
            'id' => 'feature-1',
            'public_id' => 'feature-1',
            'client_path_id' => 'path-1',
            'name' => $subtype,
            'subtype' => $subtype,
            'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0]]],
            'properties' => $pathProperties,
        ]],
    ];
}

// True when the REAL path edge made it into the graph. Synthetic Querfeldein bridges are ignored:
// once the path is rejected the builder bridges the two now-detached nodes cross-country, and that
// fallback is not what these tests are about.
function avesmapsTestGraphHasPathEdge(string $subtype, array $pathProperties, array $transports): bool {
    $result = avesmapsBuildClientCompatibleRouteGraph(
        avesmapsTestBuildRouteNetwork($subtype, $pathProperties),
        [
            'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true],
            'transports' => $transports,
        ]
    );

    foreach ($result['graph']['Quellort']['Zielort'] ?? [] as $connection) {
        if (($connection['synthetic'] ?? false) === false) {
            return true;
        }
    }

    return false;
}

// 1) Empty allowed_transports = impassable for every transport (the upper Raller).
assert(avesmapsTestGraphHasPathEdge('Flussweg', ['transport_domain' => 'river', 'allowed_transports' => []], AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER) === false);
assert(avesmapsTestGraphHasPathEdge('Flussweg', ['transport_domain' => 'river', 'allowed_transports' => []], AVESMAPS_TEST_TRANSPORTS_RIVER_BARGE) === false);
echo "empty allowed_transports blocks every river transport ok\n";

// 2) A subset is honoured per transport: the lower Raller carries barges, not sailers.
assert(avesmapsTestGraphHasPathEdge('Flussweg', ['transport_domain' => 'river', 'allowed_transports' => ['riverBarge']], AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER) === false);
assert(avesmapsTestGraphHasPathEdge('Flussweg', ['transport_domain' => 'river', 'allowed_transports' => ['riverBarge']], AVESMAPS_TEST_TRANSPORTS_RIVER_BARGE) === true);
echo "allowed_transports subset admits only the allowed transport ok\n";

// 3) A land path restricted to walkers refuses the mounted request but keeps the walker.
assert(avesmapsTestGraphHasPathEdge('Gebirgspass', ['transport_domain' => 'land', 'allowed_transports' => ['groupFoot', 'lightWalker']], AVESMAPS_TEST_TRANSPORTS_CARRIAGE) === false);
assert(avesmapsTestGraphHasPathEdge('Gebirgspass', ['transport_domain' => 'land', 'allowed_transports' => ['groupFoot', 'lightWalker']], AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER) === true);
echo "land subset honoured ok\n";

// 4) No restriction recorded -> unrestricted, exactly as before (most paths have no such property).
assert(avesmapsTestGraphHasPathEdge('Flussweg', [], AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER) === true);
assert(avesmapsTestGraphHasPathEdge('Strasse', [], AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER) === true);
echo "paths without the property stay unrestricted ok\n";

// 5) Legacy artifact: an empty list WITHOUT a transport_domain was never written by the editor
// (features.php always saves the pair) -- 26 Wuestenpfad rows carry it, among them segments of the
// Karawanenroute von Punin nach Kannemuende whose siblings allow the full land set. Treat it as "no
// restriction recorded", not as "impassable", so those desert paths keep carrying caravans.
assert(avesmapsTestGraphHasPathEdge('Wuestenpfad', ['allowed_transports' => []], AVESMAPS_TEST_TRANSPORTS_RIVER_SAILER) === true);
echo "legacy empty list without a domain does not block ok\n";

// 6) The hard subtype rule stays: no carriage on a desert path.
assert(avesmapsTestGraphHasPathEdge('Wuestenpfad', [], AVESMAPS_TEST_TRANSPORTS_CARRIAGE) === false);
assert(avesmapsTestGraphHasPathEdge('Strasse', [], AVESMAPS_TEST_TRANSPORTS_CARRIAGE) === true);
echo "Wuestenpfad still refuses horseCarriage ok\n";

echo "ALL OK\n";

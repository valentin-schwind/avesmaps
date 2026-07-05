<?php

declare(strict_types=1);

// CLI regression test for asymmetric river-flow edges in the server route graph
// (Flussrichtung spec §4). Pure fixtures, no DB. Run: php tools/routing/test-client-graph-flow.php

require __DIR__ . '/../../api/_internal/bootstrap.php';
require __DIR__ . '/../../api/_internal/routing/request.php';
require __DIR__ . '/../../api/_internal/routing/network-data.php';
require __DIR__ . '/../../api/_internal/routing/client-graph.php';

$failures = 0;
$total = 0;

function check(string $label, mixed $actual, mixed $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL {$label}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
        return;
    }
    echo "ok {$label}\n";
}

function makeLocation(string $name, float $x, float $y): array {
    return [
        'id' => $name, 'public_id' => $name, 'name' => $name, 'subtype' => 'stadt',
        'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]], 'properties' => [],
    ];
}

function makePath(string $publicId, string $subtype, array $coordinates, ?array $flow): array {
    return [
        'id' => $publicId, 'public_id' => $publicId, 'client_path_id' => $publicId,
        'name' => $subtype, 'subtype' => $subtype,
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'properties' => [], 'flow' => $flow,
    ];
}

function riverRequest(): array {
    return avesmapsNormalizeRouteRequest([
        'from' => 'test', 'to' => 'test',
        'enabled_transports' => ['land' => false, 'river' => true, 'sea' => false],
    ]);
}

function routeCost(array $paths, string $from, string $to, array $request): float {
    $networkData = ['locations' => [makeLocation('A', 0.0, 0.0), makeLocation('B', 10.0, 0.0)], 'paths' => $paths];
    $graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
    $result = avesmapsFindClientCompatibleRoute($graph, $from, $to, $request);
    if (empty($result['found'])) {
        return -1.0;
    }
    return (float) $result['cost'];
}

$request = riverRequest();
$line = [[0.0, 0.0], [10.0, 0.0]];

// Regression: river WITHOUT flow -> identical cost both directions.
$noFlowAB = routeCost([makePath('r1', 'Flussweg', $line, null)], 'A', 'B', $request);
$noFlowBA = routeCost([makePath('r1', 'Flussweg', $line, null)], 'B', 'A', $request);
check('no flow: found', $noFlowAB > 0, true);
check('no flow: symmetric', round($noFlowBA / $noFlowAB, 9), 1.0);

// dir=forward (flows A->B): downstream A->B unchanged, upstream B->A x1.5 (default factor).
$flowForward = ['dir' => 'forward', 'factor' => 1.5, 'source' => 'verlauf-sync'];
$downAB = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'A', 'B', $request);
$upBA = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'B', 'A', $request);
check('forward: downstream unchanged', round($downAB / $noFlowAB, 9), 1.0);
check('forward: upstream x1.5', round($upBA / $noFlowAB, 6), 1.5);

// dir=reverse (flows B->A): mirrored.
$flowReverse = ['dir' => 'reverse', 'factor' => 2.0, 'source' => 'editor'];
$upAB = routeCost([makePath('r1', 'Flussweg', $line, $flowReverse)], 'A', 'B', $request);
$downBA = routeCost([makePath('r1', 'Flussweg', $line, $flowReverse)], 'B', 'A', $request);
check('reverse: upstream x2.0', round($upAB / $noFlowAB, 6), 2.0);
check('reverse: downstream unchanged', round($downBA / $noFlowAB, 9), 1.0);

// Missing factor -> default 1.5; oversized factor -> clamped to 3.0.
$upDefault = routeCost([makePath('r1', 'Flussweg', $line, ['dir' => 'forward'])], 'B', 'A', $request);
check('default factor 1.5', round($upDefault / $noFlowAB, 6), 1.5);
$upClamped = routeCost([makePath('r1', 'Flussweg', $line, ['dir' => 'forward', 'factor' => 9])], 'B', 'A', $request);
check('factor clamped to 3.0', round($upClamped / $noFlowAB, 6), 3.0);

// shortest: distance stays symmetric even with flow.
$shortestRequest = avesmapsNormalizeRouteRequest([
    'from' => 'test', 'to' => 'test', 'optimize' => 'shortest',
    'enabled_transports' => ['land' => false, 'river' => true, 'sea' => false],
]);
$shortAB = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'A', 'B', $shortestRequest);
$shortBA = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'B', 'A', $shortestRequest);
check('shortest: symmetric despite flow', round($shortBA / $shortAB, 9), 1.0);

// Seeweg: flow object is IGNORED on non-river subtypes.
$seaRequest = avesmapsNormalizeRouteRequest([
    'from' => 'test', 'to' => 'test',
    'enabled_transports' => ['land' => false, 'river' => false, 'sea' => true],
]);
$seaAB = routeCost([makePath('s1', 'Seeweg', $line, $flowForward)], 'A', 'B', $seaRequest);
$seaBA = routeCost([makePath('s1', 'Seeweg', $line, $flowForward)], 'B', 'A', $seaRequest);
check('seaweg: flow ignored', round($seaBA / $seaAB, 9), 1.0);

// avesmapsBuildRoutePathData extracts top-level properties.flow.
$pathData = avesmapsBuildRoutePathData([
    'id' => 'f1',
    'geometry' => ['type' => 'LineString', 'coordinates' => $line],
    'properties' => ['public_id' => 'f1', 'feature_subtype' => 'Flussweg', 'flow' => $flowForward],
], 'path-1');
check('path data carries flow', $pathData['flow'], $flowForward);

// Diagnostic segments expose the applied factor.
$networkData = ['locations' => [makeLocation('A', 0.0, 0.0), makeLocation('B', 10.0, 0.0)], 'paths' => [makePath('r1', 'Flussweg', $line, $flowForward)]];
$graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
$route = avesmapsFindClientCompatibleRoute($graph, 'B', 'A', $request);
$diag = avesmapsBuildClientRouteDiagnosticSegments($route['segments']);
check('diagnostic flow_time_factor', round((float) ($diag[0]['flow_time_factor'] ?? 0.0), 6), 1.5);

echo "\n{$total} checks, {$failures} failures\n";
exit($failures === 0 ? 0 : 1);

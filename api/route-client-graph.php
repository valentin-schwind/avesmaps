<?php

declare(strict_types=1);

const AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD = 0.5;
const AVESMAPS_ROUTE_CLIENT_TRANSFER_PENALTY = 100.0;

const AVESMAPS_ROUTE_CLIENT_SPEED_TABLE = [
    'groupFoot' => ['Reichsstrasse' => 4.5, 'Strasse' => 4.0, 'Weg' => 3.5, 'Pfad' => 3.0, 'Gebirgspass' => 1.5, 'Wuestenpfad' => 2.5],
    'lightWalker' => ['Reichsstrasse' => 5.5, 'Strasse' => 5.0, 'Weg' => 4.5, 'Pfad' => 4.0, 'Gebirgspass' => 2.0, 'Wuestenpfad' => 3.5],
    'groupHorse' => ['Reichsstrasse' => 7.0, 'Strasse' => 6.5, 'Weg' => 5.5, 'Pfad' => 4.5, 'Gebirgspass' => 2.5, 'Wuestenpfad' => 3.0],
    'lightRider' => ['Reichsstrasse' => 8.5, 'Strasse' => 8.0, 'Weg' => 7.0, 'Pfad' => 6.0, 'Gebirgspass' => 3.0, 'Wuestenpfad' => 4.0],
    'caravan' => ['Reichsstrasse' => 4.0, 'Strasse' => 3.5, 'Weg' => 3.0, 'Pfad' => 2.5, 'Gebirgspass' => 1.5, 'Wuestenpfad' => 2.0],
    'horseCarriage' => ['Reichsstrasse' => 6.0, 'Strasse' => 5.5, 'Weg' => 4.5, 'Pfad' => 3.0, 'Gebirgspass' => 2.0, 'Wuestenpfad' => 3.0],
    'riverSailer' => ['Flussweg' => 7.5],
    'riverBarge' => ['Flussweg' => 5.0],
    'cargoShip' => ['Seeweg' => 10.0],
    'fastShip' => ['Seeweg' => 12.0],
    'galley' => ['Seeweg' => 9.0],
];

function avesmapsBuildClientCompatibleRouteGraph(array $networkData, array $request): array {
    $graph = [];
    $locations = [];
    foreach (is_array($networkData['locations'] ?? null) ? $networkData['locations'] : [] as $location) {
        if (!is_array($location)) continue;
        $name = trim((string) ($location['name'] ?? ''));
        if ($name === '') continue;
        $coords = $location['geometry']['coordinates'] ?? null;
        if (!is_array($coords) || count($coords) < 2) continue;
        $x = filter_var($coords[0], FILTER_VALIDATE_FLOAT);
        $y = filter_var($coords[1], FILTER_VALIDATE_FLOAT);
        if ($x === false || $y === false) continue;
        $location['route_x'] = (float) $x;
        $location['route_y'] = (float) $y;
        $locations[] = $location;
        $graph[$name] ??= [];
    }

    $pathIndex = 0;
    foreach (is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [] as $path) {
        if (!is_array($path)) continue;
        $pathIndex++;
        avesmapsAddClientCompatiblePathConnection($graph, $locations, $path, $pathIndex, $request);
    }

    return [
        'graph' => $graph,
        'statistics' => [
            'node_count' => count($graph),
            'path_feature_count' => $pathIndex,
        ],
    ];
}

function avesmapsAddClientCompatiblePathConnection(array &$graph, array $locations, array $path, int $pathIndex, array $request): void {
    $coordinates = avesmapsReadRoutePathLineCoordinates($path['geometry'] ?? null);
    if ($coordinates === []) return;

    $startNode = avesmapsFindClientLocationAtPathEndpoint($locations, $coordinates[0]);
    $endNode = avesmapsFindClientLocationAtPathEndpoint($locations, $coordinates[count($coordinates) - 1]);
    if (!is_array($startNode) || !is_array($endNode)) return;

    $routeType = avesmapsNormalizeClientRouteSubtype((string) ($path['subtype'] ?? $path['name'] ?? ''));
    $transportOption = avesmapsResolveClientRouteTransportOption($routeType, $request);
    if ($transportOption === null || !avesmapsIsClientTransportAllowedForPath($routeType, $transportOption)) return;

    $speed = AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transportOption][$routeType] ?? null;
    if (!is_numeric($speed) || (float) $speed <= 0.0) return;

    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    $connection = [
        'distance' => $distance,
        'time' => $distance / (float) $speed,
        'route_type' => $routeType,
        'transport_option' => $transportOption,
        'id' => 'path-' . $pathIndex,
        'path_id' => 'path-' . $pathIndex,
        'feature_id' => (string) ($path['id'] ?? ''),
        'public_id' => (string) ($path['public_id'] ?? ''),
        'from' => (string) $startNode['name'],
        'to' => (string) $endNode['name'],
        'geometry' => is_array($path['geometry'] ?? null) ? $path['geometry'] : [],
    ];

    $graph[$connection['from']][$connection['to']] ??= [];
    $graph[$connection['from']][$connection['to']][] = $connection;
    $graph[$connection['to']][$connection['from']] ??= [];
    $graph[$connection['to']][$connection['from']][] = $connection;
}

function avesmapsFindClientLocationAtPathEndpoint(array $locations, array $point): ?array {
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

function avesmapsReadRoutePathLineCoordinates(mixed $geometry): array {
    if (!is_array($geometry)) return [];
    $type = (string) ($geometry['type'] ?? '');
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates)) return [];
    if ($type === 'LineString') return $coordinates;
    return [];
}

function avesmapsNormalizeClientRouteSubtype(string $subtype): string {
    $normalized = trim($subtype);
    return match ($normalized) {
        'Reichsstraße', 'Reichsstrasse' => 'Reichsstrasse',
        'Straße', 'Strasse' => 'Strasse',
        'Gebirgspfad', 'Gebirgspass' => 'Gebirgspass',
        'Wüstenpfad', 'Wuestenpfad' => 'Wuestenpfad',
        'Flussweg' => 'Flussweg',
        'Seeweg' => 'Seeweg',
        'Weg' => 'Weg',
        default => 'Pfad',
    };
}

function avesmapsResolveClientRouteTransportOption(string $routeType, array $request): ?string {
    $transports = is_array($request['transports'] ?? null) ? $request['transports'] : AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'];
    if (in_array($routeType, ['Pfad', 'Weg', 'Strasse', 'Reichsstrasse', 'Gebirgspass', 'Wuestenpfad'], true)) return (string) ($transports['land'] ?? 'groupFoot');
    if ($routeType === 'Flussweg') return (string) ($transports['river'] ?? 'riverSailer');
    if ($routeType === 'Seeweg') return (string) ($transports['sea'] ?? 'cargoShip');
    return null;
}

function avesmapsIsClientTransportAllowedForPath(string $routeType, string $transportOption): bool {
    if ($routeType === 'Wuestenpfad' && $transportOption === 'horseCarriage') return false;
    return true;
}

function avesmapsCalculateClientRouteCoordinateDistance(array $coordinates): float {
    $distance = 0.0;
    for ($index = 1; $index < count($coordinates); $index++) {
        $previous = $coordinates[$index - 1];
        $current = $coordinates[$index];
        if (!is_array($previous) || !is_array($current)) continue;
        $previousX = filter_var($previous[0] ?? null, FILTER_VALIDATE_FLOAT);
        $previousY = filter_var($previous[1] ?? null, FILTER_VALIDATE_FLOAT);
        $currentX = filter_var($current[0] ?? null, FILTER_VALIDATE_FLOAT);
        $currentY = filter_var($current[1] ?? null, FILTER_VALIDATE_FLOAT);
        if ($previousX === false || $previousY === false || $currentX === false || $currentY === false) continue;
        $distance += hypot((float) $currentX - (float) $previousX, (float) $currentY - (float) $previousY);
    }
    return $distance;
}

function avesmapsFindClientCompatibleRoute(array $clientGraph, string $startName, string $endName, array $request): array {
    $graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];
    if (!isset($graph[$startName]) || !isset($graph[$endName])) {
        return ['found' => false, 'cost' => 0.0, 'node_ids' => [], 'edge_ids' => [], 'edge_count' => 0, 'segments' => []];
    }

    $useShortestPath = (string) ($request['optimize'] ?? 'fastest') === 'shortest';
    $minimizeTransfers = !empty($request['minimize_transfers']);
    $distances = [];
    foreach (array_keys($graph) as $nodeName) $distances[$nodeName] = INF;
    $distances[$startName] = 0.0;
    $previousNodes = [];
    $previousTransport = [];
    $connectionUsed = [];

    $queue = new SplPriorityQueue();
    $queue->setExtractFlags(SplPriorityQueue::EXTR_DATA);
    $queue->insert(['node' => $startName, 'transport' => null], 0.0);

    while (!$queue->isEmpty()) {
        $item = $queue->extract();
        $currentNode = (string) ($item['node'] ?? '');
        $currentTransport = $item['transport'] ?? null;
        $currentDistance = $distances[$currentNode] ?? INF;
        foreach (is_array($graph[$currentNode] ?? null) ? $graph[$currentNode] : [] as $neighbor => $connections) {
            foreach (is_array($connections) ? $connections : [] as $connection) {
                $transport = (string) ($connection['transport_option'] ?? '');
                if ($transport === '') continue;
                $weight = $useShortestPath ? (float) ($connection['distance'] ?? 0.0) : (float) ($connection['time'] ?? 0.0);
                if ($minimizeTransfers && $currentTransport !== null && $transport !== $currentTransport) $weight += AVESMAPS_ROUTE_CLIENT_TRANSFER_PENALTY;
                $alternative = $currentDistance + $weight;
                if ($alternative < ($distances[$neighbor] ?? INF)) {
                    $distances[$neighbor] = $alternative;
                    $previousNodes[$neighbor] = $currentNode;
                    $previousTransport[$neighbor] = $transport;
                    $connectionUsed[$neighbor] = $connection;
                    $queue->insert(['node' => $neighbor, 'transport' => $transport], -$alternative);
                }
            }
        }
    }

    if (!isset($previousNodes[$endName]) && $startName !== $endName) {
        return ['found' => false, 'cost' => 0.0, 'node_ids' => [], 'edge_ids' => [], 'edge_count' => 0, 'segments' => []];
    }

    $nodeIds = [$endName];
    $segments = [];
    $cursor = $endName;
    while ($cursor !== $startName) {
        $connection = $connectionUsed[$cursor] ?? null;
        if (!is_array($connection)) break;
        array_unshift($segments, $connection);
        $cursor = (string) ($previousNodes[$cursor] ?? '');
        if ($cursor === '') break;
        array_unshift($nodeIds, $cursor);
    }

    $edgeIds = array_map(static fn(array $segment): string => (string) ($segment['id'] ?? ''), $segments);
    return [
        'found' => count($segments) > 0 || $startName === $endName,
        'cost' => (float) ($distances[$endName] ?? 0.0),
        'node_ids' => $nodeIds,
        'edge_ids' => $edgeIds,
        'edge_count' => count($edgeIds),
        'segments' => $segments,
    ];
}

function avesmapsBuildClientRouteDiagnosticSegments(array $segments): array {
    return array_map(static function (array $segment, int $index): array {
        $geometry = is_array($segment['geometry'] ?? null) ? $segment['geometry'] : [];
        $coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
        return [
            'index' => $index,
            'edge_id' => (string) ($segment['id'] ?? ''),
            'found' => true,
            'path_id' => (string) ($segment['path_id'] ?? ''),
            'feature_id' => (string) ($segment['feature_id'] ?? ''),
            'public_id' => (string) ($segment['public_id'] ?? ''),
            'from_node' => (string) ($segment['from'] ?? ''),
            'to_node' => (string) ($segment['to'] ?? ''),
            'subtype' => (string) ($segment['route_type'] ?? ''),
            'transport_type' => (string) ($segment['transport_option'] ?? ''),
            'distance_units' => (float) ($segment['distance'] ?? 0.0),
            'cost_units' => (float) ($segment['time'] ?? 0.0),
            'coordinate_count' => count($coordinates),
        ];
    }, $segments, array_keys($segments));
}

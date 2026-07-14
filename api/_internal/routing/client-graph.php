<?php

declare(strict_types=1);

const AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD = 0.5;
const AVESMAPS_ROUTE_CLIENT_TRANSFER_PENALTY = 100.0;
const AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE = 'Querfeldein';
const AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR = 25.0;
// Land path subtypes a stranded travel waypoint may be anchored to (see
// avesmapsConnectClientRouteWaypointsToNearestLandPath). Flussweg/Seeweg are excluded on purpose:
// you can trek cross-country to a road, not "to a river".
const AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES = ['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad'];

// Sea routes mark a waypoint as water-bound (island / open-sea place). There is no coastline geometry
// in the data (insel/meer/kueste are label points only), so a Seeweg edge is the reliable signal that
// reaching this node requires crossing open water. Such nodes are NOT anchored to a land path: their
// only legitimate connection is by ship, so with sea travel disabled they stay unreachable by design.
const AVESMAPS_ROUTE_CLIENT_SEA_ROUTE_TYPES = ['Seeweg'];

// A detached component that has a sea connection (contains a node touching a Seeweg) and sits farther
// than this airline distance (route units, before the x25 cost factor) from the mainland is an island /
// peninsula reachable by ship: bridging it over land fabricates a cross-water Querfeldein, so it is
// refused and land-only routing reports "no route". Below the threshold a coastal data-gap still
// bridges; a component with no sea node at all (a genuinely landlocked/jungle area) always bridges.
const AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE = 20.0;

const AVESMAPS_ROUTE_CLIENT_SPEED_TABLE = [
    'groupFoot' => ['Reichsstrasse' => 4.5, 'Strasse' => 4.0, 'Weg' => 3.5, 'Pfad' => 3.0, 'Gebirgspass' => 1.5, 'Wuestenpfad' => 2.5, 'Querfeldein' => 1.25],
    'lightWalker' => ['Reichsstrasse' => 5.5, 'Strasse' => 5.0, 'Weg' => 4.5, 'Pfad' => 4.0, 'Gebirgspass' => 2.0, 'Wuestenpfad' => 3.5, 'Querfeldein' => 1.7],
    'groupHorse' => ['Reichsstrasse' => 7.0, 'Strasse' => 6.5, 'Weg' => 5.5, 'Pfad' => 4.5, 'Gebirgspass' => 2.5, 'Wuestenpfad' => 3.0, 'Querfeldein' => 2.1],
    'lightRider' => ['Reichsstrasse' => 8.5, 'Strasse' => 8.0, 'Weg' => 7.0, 'Pfad' => 6.0, 'Gebirgspass' => 3.0, 'Wuestenpfad' => 4.0, 'Querfeldein' => 2.5],
    'caravan' => ['Reichsstrasse' => 4.0, 'Strasse' => 3.5, 'Weg' => 3.0, 'Pfad' => 2.5, 'Gebirgspass' => 1.5, 'Wuestenpfad' => 2.0, 'Querfeldein' => 1.25],
    'horseCarriage' => ['Reichsstrasse' => 6.0, 'Strasse' => 5.5, 'Weg' => 4.5, 'Pfad' => 3.0, 'Gebirgspass' => 2.0, 'Wuestenpfad' => 3.0, 'Querfeldein' => 1.7],
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

    // Index location coordinates (round-5) -> location, so paths can be split at on-route
    // crossings/settlements (interior vertices, not just endpoints) and connect there.
    $locationCoordinateIndex = [];
    foreach ($locations as $indexedLocation) {
        $coordinateKey = sprintf('%.5f:%.5f', (float) $indexedLocation['route_x'], (float) $indexedLocation['route_y']);
        if (!isset($locationCoordinateIndex[$coordinateKey])) {
            $locationCoordinateIndex[$coordinateKey] = $indexedLocation;
        }
    }

    $pathIndex = 0;
    foreach (is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [] as $path) {
        if (!is_array($path)) continue;
        $pathIndex++;
        avesmapsAddClientCompatiblePathConnection($graph, $locations, $locationCoordinateIndex, $path, $pathIndex, $request);
    }

    // Sea-bound location names come from the RAW paths (before the domain filter drops Seewege), so a
    // water-bound place (island / open sea) is recognised even in a land-only request. Both synthetic
    // land bridges below refuse a water-locked node: crossing open water on foot is never a land route.
    $seaBoundLocationNames = avesmapsCollectClientSeaBoundLocationNames($networkData, $locations, $locationCoordinateIndex);

    $syntheticConnectionCount = avesmapsConnectClientCompatibleDetachedGraphComponents($graph, $locations, $request, $seaBoundLocationNames);
    // Anchor each travel waypoint that has no land-path edge to the nearest point ON a land path (short
    // Querfeldein leg + a split of that path), so a truly landlocked isolated place reaches the road
    // network by the shortest cross-country hop instead of the far component bridge. Runs after the
    // bridges so the graph is already connected.
    avesmapsConnectClientRouteWaypointsToNearestLandPath($graph, $locations, $request, $seaBoundLocationNames);

    return [
        'graph' => $graph,
        'statistics' => [
            'node_count' => count($graph),
            'path_feature_count' => $pathIndex,
            'synthetic_connection_count' => $syntheticConnectionCount,
        ],
    ];
}

function avesmapsAddClientCompatiblePathConnection(array &$graph, array $locations, array $locationCoordinateIndex, array $path, int $pathIndex, array $request): void {
    $coordinates = avesmapsReadRoutePathLineCoordinates($path['geometry'] ?? null);
    if ($coordinates === []) return;

    $coordinateCount = count($coordinates);
    $startNode = avesmapsFindClientLocationAtPathEndpoint($locations, $coordinates[0]);
    $endNode = avesmapsFindClientLocationAtPathEndpoint($locations, $coordinates[$coordinateCount - 1]);
    if (!is_array($startNode) || !is_array($endNode)) return;

    $routeType = avesmapsNormalizeClientRouteSubtype((string) ($path['subtype'] ?? $path['name'] ?? ''));
    // Deaktivierte Domaenen (Fluss/See) NICHT in den Graphen aufnehmen, wenn der Nutzer sie im
    // Routenplaner abgeschaltet hat (allowRiver/allowSea = false).
    if (!avesmapsIsClientRouteDomainEnabled($routeType, $request)) return;
    $transportOption = avesmapsResolveClientRouteTransportOption($routeType, $request);
    if ($transportOption === null || !avesmapsIsClientTransportAllowedForPath($routeType, $transportOption, $path)) return;

    $speed = AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transportOption][$routeType] ?? null;
    if (!is_numeric($speed) || (float) $speed <= 0.0) return;

    $clientPathId = (string) ($path['client_path_id'] ?? '');
    if ($clientPathId === '') {
        $clientPathId = 'path-' . $pathIndex;
    }

    // Collect graph nodes ALONG the path: the start endpoint, every interior vertex that exactly
    // coincides (round-5) with a location/crossing, and the end endpoint. A road drawn THROUGH a
    // crossing/settlement (interior vertex) would otherwise bypass it -- leaving that place
    // reachable only via a costly synthetic "Querfeldein" edge. Splitting the path at those nodes
    // connects them, so routes can turn there.
    $nodeVertices = [['index' => 0, 'location' => $startNode]];
    for ($i = 1; $i < $coordinateCount - 1; $i++) {
        $vertexX = filter_var($coordinates[$i][0] ?? null, FILTER_VALIDATE_FLOAT);
        $vertexY = filter_var($coordinates[$i][1] ?? null, FILTER_VALIDATE_FLOAT);
        if ($vertexX === false || $vertexY === false) continue;
        $coordinateKey = sprintf('%.5f:%.5f', (float) $vertexX, (float) $vertexY);
        if (!isset($locationCoordinateIndex[$coordinateKey])) continue;
        $vertexLocation = $locationCoordinateIndex[$coordinateKey];
        $previousLocation = $nodeVertices[count($nodeVertices) - 1]['location'];
        if ((string) $vertexLocation['name'] !== (string) $previousLocation['name']) {
            $nodeVertices[] = ['index' => $i, 'location' => $vertexLocation];
        }
    }
    $nodeVertices[] = ['index' => $coordinateCount - 1, 'location' => $endNode];

    // No interior node -> single edge over the whole path (unchanged behaviour, no regression).
    if (count($nodeVertices) <= 2) {
        avesmapsAddClientCompatiblePathSliceConnection($graph, $startNode, $endNode, $coordinates, $routeType, $transportOption, (float) $speed, $clientPathId, $path);
        return;
    }

    // Split into sub-edges between consecutive on-route nodes; each keeps its own slice + sub-id.
    // feature_id/public_id stay the parent path's so the renderer can resolve the geometry.
    $segmentCount = count($nodeVertices) - 1;
    for ($segmentIndex = 0; $segmentIndex < $segmentCount; $segmentIndex++) {
        $fromVertex = $nodeVertices[$segmentIndex];
        $toVertex = $nodeVertices[$segmentIndex + 1];
        if ((string) $fromVertex['location']['name'] === (string) $toVertex['location']['name']) continue;
        $sliceCoordinates = array_slice($coordinates, $fromVertex['index'], $toVertex['index'] - $fromVertex['index'] + 1);
        if (count($sliceCoordinates) < 2) continue;
        avesmapsAddClientCompatiblePathSliceConnection($graph, $fromVertex['location'], $toVertex['location'], $sliceCoordinates, $routeType, $transportOption, (float) $speed, $clientPathId . '#' . $segmentIndex, $path);
    }
}

// Normalized river-flow object for a route path (properties.flow, Flussrichtung spec §2/§4).
// Null unless the path is a Flussweg with a valid dir; factor clamped to [1.0, 3.0], default
// 1.5. Self-contained mirror of the wiki lib's avesmapsPathFlowNormalize (routing must not
// depend on the wiki lib) and of js/routing/route-graph-routing.js getRiverFlowTimeFactors.
function avesmapsRouteClientNormalizeFlow(array $path, string $routeType): ?array {
    if ($routeType !== 'Flussweg') {
        return null;
    }
    $flow = $path['flow'] ?? null;
    if (!is_array($flow)) {
        return null;
    }
    $dir = (string) ($flow['dir'] ?? '');
    if ($dir !== 'forward' && $dir !== 'reverse') {
        return null;
    }
    $factor = is_numeric($flow['factor'] ?? null) ? (float) $flow['factor'] : 1.5;
    $factor = max(1.0, min(3.0, $factor));
    return ['dir' => $dir, 'factor' => $factor];
}

function avesmapsAddClientCompatiblePathSliceConnection(array &$graph, array $fromNode, array $toNode, array $coordinates, string $routeType, string $transportOption, float $speed, string $connectionId, array $path): void {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    $connection = [
        'distance' => $distance,
        'time' => $distance / $speed,
        'route_type' => $routeType,
        'transport_option' => $transportOption,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => (string) ($path['id'] ?? ''),
        'public_id' => (string) ($path['public_id'] ?? ''),
        'from' => (string) $fromNode['name'],
        'to' => (string) $toNode['name'],
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'synthetic' => false,
    ];

    $flow = avesmapsRouteClientNormalizeFlow($path, $routeType);
    if ($flow === null) {
        // No known flow direction: symmetric, EXACTLY today's behaviour (shared object).
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $connection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $connection);
        return;
    }

    // Asymmetric river edge (spec §4): slice coordinates are in stored drawing order and
    // from/to follow that order, so the from->to edge travels WITH dir 'forward' and AGAINST
    // dir 'reverse'. Upstream legs cost time * factor; downstream stays the exact base time.
    // from/to fields stay the STORED orientation on both variants -- the verlauf flow
    // derivation's chain walk depends on that.
    // flow_state names the traversal relative to the current: the display layer cannot
    // derive "downstream" from a neutral factor alone (downstream and no-flow both ship 1.0).
    $upstreamTime = $connection['time'] * $flow['factor'];
    $forwardConnection = $connection;
    $forwardConnection['time'] = $flow['dir'] === 'reverse' ? $upstreamTime : $connection['time'];
    $forwardConnection['flow_time_factor'] = $flow['dir'] === 'reverse' ? $flow['factor'] : 1.0;
    $forwardConnection['flow_state'] = $flow['dir'] === 'reverse' ? 'upstream' : 'downstream';
    $reverseConnection = $connection;
    $reverseConnection['time'] = $flow['dir'] === 'forward' ? $upstreamTime : $connection['time'];
    $reverseConnection['flow_time_factor'] = $flow['dir'] === 'forward' ? $flow['factor'] : 1.0;
    $reverseConnection['flow_state'] = $flow['dir'] === 'forward' ? 'upstream' : 'downstream';

    avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $forwardConnection);
    avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $reverseConnection);
}

function avesmapsConnectClientCompatibleDetachedGraphComponents(array &$graph, array $locations, array $request, array $seaBoundLocationNames): int {
    // Synthetic "Querfeldein" bridges are only legitimate when cross-country travel is enabled
    // (Querfeldein maps to the land domain). With land/synthetic disabled -- e.g. "nur ueber Fluss"
    // -- do NOT bridge the disconnected river components: a route impossible on rivers alone must
    // return "no route" rather than an absurd cross-country detour. Mirrors the client guard in
    // js/routing/route-graph-routing.js (skips synthetic when no land transport is active).
    if (!avesmapsIsClientRouteDomainEnabled(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request)) {
        return 0;
    }
    $components = avesmapsFindClientCompatibleGraphComponents($graph);
    usort($components, static fn(array $a, array $b): int => count($b['node_names']) <=> count($a['node_names']));
    if (count($components) <= 1) return 0;

    $transportOption = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $speed = AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transportOption][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE] ?? null;
    if ($transportOption === null || !is_numeric($speed) || (float) $speed <= 0.0) return 0;

    $locationLookup = avesmapsBuildClientCompatibleLocationLookup($locations);
    // Water-locked nodes (touch a Seeweg, have no land-path edge) are never valid bridge endpoints:
    // a synthetic land bridge to/from them would cross open water. Dropping them leaves a purely
    // water-bound component (e.g. an island town with sea disabled) unbridged -> unreachable by land.
    $anchorNodeNames = avesmapsFilterOutClientWaterLockedNodes($graph, $components[0]['node_names'], $seaBoundLocationNames);
    $detachedComponents = array_slice($components, 1);
    $syntheticConnectionCount = 0;

    foreach ($detachedComponents as $component) {
        if ($anchorNodeNames === []) break;
        $detachedNodeNames = avesmapsFilterOutClientWaterLockedNodes($graph, $component['node_names'], $seaBoundLocationNames);
        if ($detachedNodeNames === []) continue;
        $nearestConnection = avesmapsFindNearestClientCompatibleComponentConnection($detachedNodeNames, $anchorNodeNames, $locationLookup);
        if (!is_array($nearestConnection)) continue;

        $fromLocation = $nearestConnection['from_location'];
        $toLocation = $nearestConnection['to_location'];
        $rawDistance = (float) $nearestConnection['distance'];
        // A sea-connected detached component reached only by a long land bridge is an island/peninsula
        // whose real link is the sea (e.g. Orrehjal, reached via Lysvik): refuse the bridge so land-only
        // routing says "no route" instead of a 130u cross-water Querfeldein. It is the COMPONENT's sea
        // connection that matters, not the bridge endpoints -- the nearest node can be inland while the
        // component still has a port elsewhere. A short gap (coastal data-gap) or a component with no sea
        // node at all (a genuinely landlocked/jungle area) still bridges; a bay you can drive around is
        // one connected component, not a bridge, so it is untouched.
        if ($rawDistance > AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE
            && avesmapsClientComponentIsSeaConnected($component['node_names'], $seaBoundLocationNames)) {
            continue;
        }
        $distance = $rawDistance * AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR;
        $connectionId = 'synthetic-' . $fromLocation['name'] . '->' . $toLocation['name'];
        $connection = [
            'distance' => $distance,
            'time' => $distance / (float) $speed,
            'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
            'transport_option' => $transportOption,
            'id' => $connectionId,
            'path_id' => $connectionId,
            'feature_id' => '',
            'public_id' => '',
            'from' => (string) $fromLocation['name'],
            'to' => (string) $toLocation['name'],
            'geometry' => [
                'type' => 'LineString',
                'coordinates' => [
                    [(float) $fromLocation['route_x'], (float) $fromLocation['route_y']],
                    [(float) $toLocation['route_x'], (float) $toLocation['route_y']],
                ],
            ],
            'synthetic' => true,
        ];

        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $connection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $connection);
        $syntheticConnectionCount++;
    }

    return $syntheticConnectionCount;
}

// ===== Waypoint anchoring to the nearest land path (Meldung #39 follow-up) =====

// For each travel waypoint (from/to/via) that has no land-path edge AND no sea-route edge, splits the
// nearest land path at the point closest to the waypoint and adds a short Querfeldein edge to it. So a
// truly landlocked isolated place reaches the road network by the SHORTEST cross-country hop instead of
// the far component bridge. Water-bound nodes (any Seeweg edge) are skipped: trekking cross-country to
// them would cross open water, so they stay reachable only by ship. No-op when Querfeldein is disabled.
function avesmapsConnectClientRouteWaypointsToNearestLandPath(array &$graph, array $locations, array $request, array $seaBoundLocationNames): void {
    if (!avesmapsIsClientRouteDomainEnabled(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request)) {
        return;
    }
    $syntheticTransport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $syntheticSpeed = $syntheticTransport !== null ? (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$syntheticTransport][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE] ?? null) : null;
    if ($syntheticTransport === null || !is_numeric($syntheticSpeed) || (float) $syntheticSpeed <= 0.0) {
        return;
    }
    $locationLookup = avesmapsBuildClientCompatibleLocationLookup($locations);

    $waypointNames = [];
    $rawWaypoints = array_merge(
        [(string) ($request['from'] ?? ''), (string) ($request['to'] ?? '')],
        is_array($request['via'] ?? null) ? array_map('strval', $request['via']) : []
    );
    foreach ($rawWaypoints as $rawName) {
        $name = trim($rawName);
        if ($name !== '' && !in_array($name, $waypointNames, true)) {
            $waypointNames[] = $name;
        }
    }

    foreach ($waypointNames as $waypointIndex => $name) {
        if (!isset($graph[$name])) continue;
        if (avesmapsClientNodeHasLandPathEdge($graph, $name)) continue;
        if (isset($seaBoundLocationNames[$name])) continue;
        $location = $locationLookup[$name] ?? null;
        if (!is_array($location)) continue;
        $anchor = avesmapsFindNearestClientLandPathAnchor($graph, (float) $location['route_x'], (float) $location['route_y']);
        if ($anchor === null) continue;
        avesmapsAnchorClientWaypointToLandPath($graph, $name, (float) $location['route_x'], (float) $location['route_y'], $anchor, (string) $syntheticTransport, (float) $syntheticSpeed, (int) $waypointIndex);
    }
}

function avesmapsClientNodeHasLandPathEdge(array $graph, string $nodeName): bool {
    foreach (is_array($graph[$nodeName] ?? null) ? $graph[$nodeName] : [] as $connections) {
        foreach (is_array($connections) ? $connections : [] as $connection) {
            if (is_array($connection) && in_array((string) ($connection['route_type'] ?? ''), AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES, true)) {
                return true;
            }
        }
    }
    return false;
}

// A node is water-locked when it touches a Seeweg (sea-bound) but has no land-path edge in the built
// graph: it can only be reached by ship. Such nodes must never be a synthetic land-bridge endpoint.
function avesmapsClientNodeIsWaterLocked(array $graph, array $seaBoundLocationNames, string $nodeName): bool {
    return isset($seaBoundLocationNames[$nodeName]) && !avesmapsClientNodeHasLandPathEdge($graph, $nodeName);
}

// True when any node of a component touches a sea route -- the component has a Seeanbindung and is an
// island/peninsula rather than a landlocked inland area. Used to refuse a long land bridge to it.
function avesmapsClientComponentIsSeaConnected(array $nodeNames, array $seaBoundLocationNames): bool {
    foreach ($nodeNames as $nodeName) {
        if (isset($seaBoundLocationNames[(string) $nodeName])) {
            return true;
        }
    }
    return false;
}

// Drops water-locked nodes from a node-name list and reindexes it (empty -> no land bridge possible).
function avesmapsFilterOutClientWaterLockedNodes(array $graph, array $nodeNames, array $seaBoundLocationNames): array {
    $kept = [];
    foreach ($nodeNames as $nodeName) {
        if (!avesmapsClientNodeIsWaterLocked($graph, $seaBoundLocationNames, (string) $nodeName)) {
            $kept[] = $nodeName;
        }
    }
    return $kept;
}

// Location names a Seeweg touches (endpoint or on-route vertex), computed from the RAW network data
// BEFORE the transport-domain filter drops disabled edges. This is how a water-bound place (island /
// open sea) is recognised even in a land-only request, where the built graph carries no Seeweg edge at
// all. Mirrors the graph's node matching: endpoint tolerance for the two ends, round-5 index interior.
function avesmapsCollectClientSeaBoundLocationNames(array $networkData, array $locations, array $locationCoordinateIndex): array {
    $seaBound = [];
    foreach (is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [] as $path) {
        if (!is_array($path)) continue;
        $routeType = avesmapsNormalizeClientRouteSubtype((string) ($path['subtype'] ?? $path['name'] ?? ''));
        if (!in_array($routeType, AVESMAPS_ROUTE_CLIENT_SEA_ROUTE_TYPES, true)) continue;
        $coordinates = avesmapsReadRoutePathLineCoordinates($path['geometry'] ?? null);
        $count = count($coordinates);
        if ($count < 2) continue;
        foreach ([$coordinates[0], $coordinates[$count - 1]] as $endpoint) {
            $location = avesmapsFindClientLocationAtPathEndpoint($locations, $endpoint);
            if (is_array($location)) $seaBound[(string) $location['name']] = true;
        }
        for ($i = 1; $i < $count - 1; $i++) {
            $vertexX = filter_var($coordinates[$i][0] ?? null, FILTER_VALIDATE_FLOAT);
            $vertexY = filter_var($coordinates[$i][1] ?? null, FILTER_VALIDATE_FLOAT);
            if ($vertexX === false || $vertexY === false) continue;
            $coordinateKey = sprintf('%.5f:%.5f', (float) $vertexX, (float) $vertexY);
            if (isset($locationCoordinateIndex[$coordinateKey])) {
                $seaBound[(string) $locationCoordinateIndex[$coordinateKey]['name']] = true;
            }
        }
    }
    return $seaBound;
}

// Projects (px,py) onto every land-path edge and returns the closest hit (edge + projected point).
function avesmapsFindNearestClientLandPathAnchor(array $graph, float $px, float $py): ?array {
    $best = null;
    foreach ($graph as $fromName => $edges) {
        if (!is_array($edges)) continue;
        foreach ($edges as $toName => $connections) {
            if (!is_array($connections)) continue;
            foreach ($connections as $connection) {
                if (!is_array($connection)) continue;
                if (!in_array((string) ($connection['route_type'] ?? ''), AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES, true)) continue;
                $coordinates = $connection['geometry']['coordinates'] ?? null;
                if (!is_array($coordinates)) continue;
                $count = count($coordinates);
                for ($i = 0; $i < $count - 1; $i++) {
                    $projection = avesmapsRouteProjectPointOnSegment(
                        $px, $py,
                        (float) ($coordinates[$i][0] ?? 0.0), (float) ($coordinates[$i][1] ?? 0.0),
                        (float) ($coordinates[$i + 1][0] ?? 0.0), (float) ($coordinates[$i + 1][1] ?? 0.0)
                    );
                    if ($best === null || $projection['distance'] < $best['distance']) {
                        // Use the connection's STORED orientation (from/to match coordinates[0]/[last]),
                        // NOT the graph iteration keys: edges are stored in both directions with the same
                        // object, so the outer/inner keys can be the reverse of the geometry. Splitting
                        // with the reversed name would attach the sub-edges to the wrong endpoints and the
                        // drawn leg would jump to the far node (a gap between the anchor and the path).
                        $best = [
                            'from' => (string) ($connection['from'] ?? $fromName),
                            'to' => (string) ($connection['to'] ?? $toName),
                            'connection' => $connection,
                            'segment_index' => $i,
                            't' => $projection['t'],
                            'proj_x' => $projection['x'],
                            'proj_y' => $projection['y'],
                            'distance' => $projection['distance'],
                        ];
                    }
                }
            }
        }
    }
    return $best;
}

function avesmapsRouteProjectPointOnSegment(float $px, float $py, float $ax, float $ay, float $bx, float $by): array {
    $dx = $bx - $ax;
    $dy = $by - $ay;
    $lengthSquared = $dx * $dx + $dy * $dy;
    $t = $lengthSquared > 0.0 ? max(0.0, min(1.0, (($px - $ax) * $dx + ($py - $ay) * $dy) / $lengthSquared)) : 0.0;
    $projX = $ax + $t * $dx;
    $projY = $ay + $t * $dy;
    return ['x' => $projX, 'y' => $projY, 't' => $t, 'distance' => hypot($px - $projX, $py - $projY)];
}

// Splits the anchor path at the projected point P (unless P is an existing endpoint) and bridges the
// waypoint to P with a Querfeldein edge. Sub-path edges are shared objects in both directions, like
// the regular symmetric slice edges.
function avesmapsAnchorClientWaypointToLandPath(array &$graph, string $waypointName, float $wx, float $wy, array $anchor, string $syntheticTransport, float $syntheticSpeed, int $waypointIndex): void {
    $original = $anchor['connection'];
    $coordinates = $original['geometry']['coordinates'] ?? [];
    if (!is_array($coordinates) || count($coordinates) < 2) return;
    $count = count($coordinates);
    $i = (int) $anchor['segment_index'];
    $t = (float) $anchor['t'];
    $projX = (float) $anchor['proj_x'];
    $projY = (float) $anchor['proj_y'];
    $fromName = (string) $anchor['from'];
    $toName = (string) $anchor['to'];
    $epsilon = 1e-7;

    if ($i === 0 && $t <= $epsilon) {
        $anchorNodeName = $fromName;               // P == path start node
    } elseif ($i === $count - 2 && $t >= 1.0 - $epsilon) {
        $anchorNodeName = $toName;                  // P == path end node
    } else {
        $anchorNodeName = '__wp_anchor_' . $waypointIndex;
        $graph[$anchorNodeName] ??= [];

        $sliceFrom = array_slice($coordinates, 0, $i + 1);
        if ($t > $epsilon) { $sliceFrom[] = [$projX, $projY]; }
        $sliceTo = [];
        if ($t < 1.0 - $epsilon) { $sliceTo[] = [$projX, $projY]; }
        $sliceTo = array_merge($sliceTo, array_slice($coordinates, $i + 1));

        if (count($sliceFrom) >= 2) {
            $connectionFrom = avesmapsBuildClientRouteSubPathConnection($original, $fromName, $anchorNodeName, $sliceFrom, 'wp-slice-' . $waypointIndex . '-a');
            avesmapsAddClientCompatibleGraphConnection($graph, $fromName, $anchorNodeName, $connectionFrom);
            avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $fromName, $connectionFrom);
        }
        if (count($sliceTo) >= 2) {
            $connectionTo = avesmapsBuildClientRouteSubPathConnection($original, $anchorNodeName, $toName, $sliceTo, 'wp-slice-' . $waypointIndex . '-b');
            avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $toName, $connectionTo);
            avesmapsAddClientCompatibleGraphConnection($graph, $toName, $anchorNodeName, $connectionTo);
        }
    }

    if ($anchorNodeName === $waypointName) return;

    $airDistance = hypot($wx - $projX, $wy - $projY);
    $cost = $airDistance * AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR;
    $connectionId = 'synthetic-' . $waypointName . '->' . $anchorNodeName;
    $syntheticConnection = [
        'distance' => $cost,
        'time' => $cost / $syntheticSpeed,
        'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
        'transport_option' => $syntheticTransport,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => '',
        'public_id' => '',
        'from' => $waypointName,
        'to' => $anchorNodeName,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[$wx, $wy], [$projX, $projY]]],
        'synthetic' => true,
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $waypointName, $anchorNodeName, $syntheticConnection);
    avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $waypointName, $syntheticConnection);
}

function avesmapsBuildClientRouteSubPathConnection(array $original, string $from, string $to, array $coordinates, string $connectionId): array {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    $originalDistance = (float) ($original['distance'] ?? 0.0);
    $originalTime = (float) ($original['time'] ?? 0.0);
    $speed = $originalTime > 0.0 ? $originalDistance / $originalTime : 0.0;
    return [
        'distance' => $distance,
        'time' => $speed > 0.0 ? $distance / $speed : $originalTime,
        'route_type' => (string) ($original['route_type'] ?? ''),
        'transport_option' => (string) ($original['transport_option'] ?? ''),
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => (string) ($original['feature_id'] ?? ''),
        'public_id' => (string) ($original['public_id'] ?? ''),
        'from' => $from,
        'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'synthetic' => false,
    ];
}

function avesmapsFindClientCompatibleGraphComponents(array $graph): array {
    $visitedNodeNames = [];
    $components = [];
    foreach (array_keys($graph) as $startName) {
        if (isset($visitedNodeNames[$startName])) continue;
        $nodeNames = [];
        $stack = [$startName];
        $visitedNodeNames[$startName] = true;
        while ($stack !== []) {
            $currentName = array_pop($stack);
            $nodeNames[] = $currentName;
            foreach (array_keys(is_array($graph[$currentName] ?? null) ? $graph[$currentName] : []) as $neighborName) {
                if (isset($visitedNodeNames[$neighborName])) continue;
                $visitedNodeNames[$neighborName] = true;
                $stack[] = $neighborName;
            }
        }
        $components[] = ['node_names' => $nodeNames];
    }
    return $components;
}

function avesmapsFindNearestClientCompatibleComponentConnection(array $componentNodeNames, array $connectedNodeNames, array $locationLookup): ?array {
    $nearestConnection = null;
    foreach ($componentNodeNames as $sourceName) {
        $sourceLocation = $locationLookup[$sourceName] ?? null;
        if (!is_array($sourceLocation)) continue;
        foreach ($connectedNodeNames as $targetName) {
            $targetLocation = $locationLookup[$targetName] ?? null;
            if (!is_array($targetLocation)) continue;
            $distance = avesmapsGetClientCompatibleLocationDistance($sourceLocation, $targetLocation);
            if (!is_array($nearestConnection) || $distance < (float) $nearestConnection['distance']) {
                $nearestConnection = [
                    'from_location' => $sourceLocation,
                    'to_location' => $targetLocation,
                    'distance' => $distance,
                ];
            }
        }
    }
    return $nearestConnection;
}

function avesmapsBuildClientCompatibleLocationLookup(array $locations): array {
    $lookup = [];
    foreach ($locations as $location) {
        if (!is_array($location)) continue;
        $name = (string) ($location['name'] ?? '');
        if ($name !== '') $lookup[$name] = $location;
    }
    return $lookup;
}

function avesmapsGetClientCompatibleLocationDistance(array $firstLocation, array $secondLocation): float {
    return hypot(
        (float) $firstLocation['route_x'] - (float) $secondLocation['route_x'],
        (float) $firstLocation['route_y'] - (float) $secondLocation['route_y']
    );
}

function avesmapsAddClientCompatibleGraphConnection(array &$graph, string $fromName, string $toName, array $connection): void {
    $graph[$fromName][$toName] ??= [];
    $graph[$fromName][$toName][] = $connection;
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

function avesmapsRouteStringStartsWith(string $value, string $prefix): bool {
    return strncmp($value, $prefix, strlen($prefix)) === 0;
}

function avesmapsNormalizeClientRouteSubtype(string $subtype): string {
    $normalized = trim($subtype);
    if (avesmapsRouteStringStartsWith($normalized, 'Reichsstrasse') || avesmapsRouteStringStartsWith($normalized, 'Reichsstraße')) return 'Reichsstrasse';
    if (avesmapsRouteStringStartsWith($normalized, 'Strasse') || avesmapsRouteStringStartsWith($normalized, 'Straße')) return 'Strasse';
    if (avesmapsRouteStringStartsWith($normalized, 'Gebirgspass') || avesmapsRouteStringStartsWith($normalized, 'Gebirgspfad')) return 'Gebirgspass';
    if (avesmapsRouteStringStartsWith($normalized, 'Wueste') || avesmapsRouteStringStartsWith($normalized, 'Wuestenpfad') || avesmapsRouteStringStartsWith($normalized, 'Wüstenpfad')) return 'Wuestenpfad';
    if (avesmapsRouteStringStartsWith($normalized, 'Pfad')) return 'Pfad';
    if (avesmapsRouteStringStartsWith($normalized, 'Flussweg')) return 'Flussweg';
    if (avesmapsRouteStringStartsWith($normalized, 'Meer') || avesmapsRouteStringStartsWith($normalized, 'Seeweg')) return 'Seeweg';
    if (avesmapsRouteStringStartsWith($normalized, AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE)) return AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE;
    return 'Weg';
}

// Transport-Domaene eines Wegtyps: Flussweg=river, Seeweg=sea, alles andere=land.
function avesmapsClientRouteDomain(string $routeType): string {
    if ($routeType === 'Flussweg') return 'river';
    if ($routeType === 'Seeweg') return 'sea';
    return 'land';
}

// Ist die Domaene dieses Wegtyps erlaubt? Fehlt enabled_transports -> alle erlaubt (kompatibel).
function avesmapsIsClientRouteDomainEnabled(string $routeType, array $request): bool {
    $enabled = is_array($request['enabled_transports'] ?? null) ? $request['enabled_transports'] : [];
    return (bool) ($enabled[avesmapsClientRouteDomain($routeType)] ?? true);
}

function avesmapsResolveClientRouteTransportOption(string $routeType, array $request): ?string {
    $transports = is_array($request['transports'] ?? null) ? $request['transports'] : AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'];
    if (in_array($routeType, ['Pfad', 'Weg', 'Strasse', 'Reichsstrasse', 'Gebirgspass', 'Wuestenpfad'], true)) return (string) ($transports['land'] ?? 'groupFoot');
    if ($routeType === 'Querfeldein') return (string) ($transports['synthetic'] ?? $transports['land'] ?? 'groupFoot');
    if ($routeType === 'Flussweg') return (string) ($transports['river'] ?? 'riverSailer');
    if ($routeType === 'Seeweg') return (string) ($transports['sea'] ?? 'cargoShip');
    return null;
}

function avesmapsIsClientTransportAllowedForPath(string $routeType, string $transportOption, array $path = []): bool {
    if ($routeType === 'Wuestenpfad' && $transportOption === 'horseCarriage') return false;

    $allowedTransports = avesmapsClientRoutePathAllowedTransports($path);
    if ($allowedTransports === null) return true;

    return in_array($transportOption, $allowedTransports, true);
}

// Per-path transport restriction, the editor's "Erlaubte Transportmittel" (transport_domain +
// allowed_transports, always saved as a PAIR by avesmapsUpdatePathFeatureDetails). Null = the path
// records no restriction; a list -- INCLUDING an empty one -- is authoritative: an empty list means
// no transport at all may use this path (e.g. the upper Raller, where no boat gets past the source).
// Mirrors js/routing/route-engine.js isTransportAllowedForPath; the properties_json is NESTED under
// properties.properties in the route path shape (see avesmapsBuildRoutePathData), same as flow.
// Legacy rows carry an empty list WITHOUT a transport_domain -- a shape the editor never wrote --
// and are treated as unrestricted rather than impassable.
function avesmapsClientRoutePathAllowedTransports(array $path): ?array {
    $properties = is_array($path['properties'] ?? null) ? $path['properties'] : [];
    $allowedTransports = $properties['allowed_transports'] ?? null;
    if (!is_array($allowedTransports)) return null;
    if ($allowedTransports === [] && trim((string) ($properties['transport_domain'] ?? '')) === '') return null;

    return array_values(array_map(static fn(mixed $option): string => (string) $option, $allowedTransports));
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
            // Send the segment's own geometry (a slice for split sub-edges) so the client renders the
            // actual sub-edge instead of re-resolving the whole parent path by feature_id.
            'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
            'synthetic' => !empty($segment['synthetic']),
            'flow_time_factor' => (float) ($segment['flow_time_factor'] ?? 1.0),
            'flow_state' => (string) ($segment['flow_state'] ?? ''),
        ];
    }, $segments, array_keys($segments));
}

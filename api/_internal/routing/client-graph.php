<?php

declare(strict_types=1);

require_once __DIR__ . '/terrain-factor.php';
require_once __DIR__ . '/terrain-read.php';
require_once __DIR__ . '/water-areas.php';

const AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD = 0.5;
// Cell width of the endpoint lookup index = the endpoint tolerance. A hit therefore lies in the
// own cell or one of the eight neighbours, never further -- 9 cells instead of all 4531 locations.
const AVESMAPS_ROUTE_CLIENT_CELL_SIZE = 0.5;
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

// 💣 REMOVED IN V13 (2026-07-29): AVESMAPS_ROUTE_CLIENT_SEA_CROSSING_MIN_DISTANCE = 20.0, which
// refused a bridge when the detached COMPONENT was "sea-connected". It asked a proxy, never the
// geometry, and measured against the live stock it fired 0 times out of 896 in normal operation --
// it cannot fire, because a component holding a Seeweg hangs off the main component through that
// Seeweg and is therefore not detached at all. In the pure pedestrian case it spoke up 17 times and
// was wrong twice (it refused dry land bridges).
//
// Open water is now asked directly: api/_internal/routing/water-areas.php. Do not reintroduce a
// distance threshold here -- a long bridge is not the problem, a wet one is.

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

// $water (V13) is the prepared open-water structure from avesmapsLoadRouteWater(). Empty means the
// water test is inert and the two synthetic-bridge builders below behave exactly as they did before
// V13 -- which is also what the callers that have no business with water get (the Verlauf-Sync in
// api/_internal/wiki/path-verlauf.php, and the diagnostics).
function avesmapsBuildClientCompatibleRouteGraph(array $networkData, array $request, array $terrain = [], array $water = []): array {
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

    // Separate from the exact round-5 index above and in addition to it: that one answers "is a
    // location exactly on this interior vertex", this one answers "is a location within the
    // endpoint tolerance of this path end". Different question, different structure.
    $locationCellIndex = avesmapsBuildClientLocationCellIndex($locations);

    $pathIndex = 0;
    foreach (is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [] as $path) {
        if (!is_array($path)) continue;
        $pathIndex++;
        avesmapsAddClientCompatiblePathConnection($graph, $locations, $locationCoordinateIndex, $locationCellIndex, $path, $pathIndex, $request, $terrain);
    }

    // Sea-bound location names come from the RAW paths (before the domain filter drops Seewege), so a
    // water-bound place (island / open sea) is recognised even in a land-only request. Both synthetic
    // land bridges below refuse a water-locked node: crossing open water on foot is never a land route.
    $seaBoundLocationNames = avesmapsCollectClientSeaBoundLocationNames($networkData, $locations, $locationCoordinateIndex, $locationCellIndex);

    $syntheticConnectionCount = avesmapsConnectClientCompatibleDetachedGraphComponents($graph, $locations, $request, $seaBoundLocationNames, $water);
    // Anchor each travel waypoint that has no land-path edge to the nearest point ON a land path (short
    // Querfeldein leg + a split of that path), so a truly landlocked isolated place reaches the road
    // network by the shortest cross-country hop instead of the far component bridge. Runs after the
    // bridges so the graph is already connected.
    avesmapsConnectClientRouteWaypointsToNearestLandPath($graph, $locations, $request, $seaBoundLocationNames, $water);

    return [
        'graph' => $graph,
        'statistics' => [
            'node_count' => count($graph),
            'path_feature_count' => $pathIndex,
            'synthetic_connection_count' => $syntheticConnectionCount,
        ],
    ];
}

function avesmapsAddClientCompatiblePathConnection(array &$graph, array $locations, array $locationCoordinateIndex, array $locationCellIndex, array $path, int $pathIndex, array $request, array $terrain = []): void {
    $coordinates = avesmapsReadRoutePathLineCoordinates($path['geometry'] ?? null);
    if ($coordinates === []) return;

    $coordinateCount = count($coordinates);
    $startNode = avesmapsFindClientLocationAtPathEndpoint($locations, $locationCellIndex, $coordinates[0]);
    $endNode = avesmapsFindClientLocationAtPathEndpoint($locations, $locationCellIndex, $coordinates[$coordinateCount - 1]);
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

    // V11: this way's own profile, or null. Attached ONCE per way, and only when there is one --
    // most ways touch no raster at all, and an absent key keeps the connection object exactly as it
    // is today.
    $pathTerrain = avesmapsRouteAttachTerrain($path, $terrain);

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
        avesmapsAddClientCompatiblePathSliceConnection($graph, $startNode, $endNode, $coordinates, $routeType, $transportOption, (float) $speed, $clientPathId, $path, $pathTerrain, 0, $coordinateCount - 1);
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
        avesmapsAddClientCompatiblePathSliceConnection($graph, $fromVertex['location'], $toVertex['location'], $sliceCoordinates, $routeType, $transportOption, (float) $speed, $clientPathId . '#' . $segmentIndex, $path, $pathTerrain, (int) $fromVertex['index'], (int) $toVertex['index']);
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

/**
 * PURE: the climb and fall of ONE slice, summed from its own segments.
 *
 * `profile_json` holds one [ascent, descent] pair per STORED segment of the way, so a vertex range
 * is exactly a run of pairs -- no interpolation, no averaging. `$toVertexIndex` is exclusive as a
 * segment bound: segments [from, to) lie between vertex `from` and vertex `to`.
 *
 * Returns null when there is no profile, so the caller adds nothing at all to the connection.
 */
function avesmapsRouteSliceTerrain(?array $pathTerrain, int $fromVertexIndex, int $toVertexIndex): ?array
{
    if ($pathTerrain === null || !is_array($pathTerrain['profile'] ?? null)) {
        return null;
    }
    $profile = $pathTerrain['profile'];
    $ascent = 0.0;
    $descent = 0.0;
    $steepAscent = 0.0;
    $steepDescent = 0.0;
    $slice = [];
    for ($index = $fromVertexIndex; $index < $toVertexIndex; $index++) {
        $piece = $profile[$index] ?? null;
        // 💣 FOUR, NOT TWO -- AND THIS IS THE FORMAT GUARD. Rows written before the Leistungskilometer
        // (2026-07-30) hold pairs of two: ascent and descent, nothing about steepness. Reading such a
        // pair as if its second number were a steep-descent sum would price gentle descents as steep
        // ones and do it silently. A short entry therefore means „no height data" -- the same answer as
        // a missing row -- and the next profile run heals it.
        if (!is_array($piece) || count($piece) < 4) {
            // A gap in the profile is not a zero either: the stored geometry and the payload's
            // disagree, and inventing level ground would hide that. The whole slice goes unknown.
            return null;
        }
        $slice[] = [(float) $piece[0], (float) $piece[1], (float) $piece[2], (float) $piece[3]];
        $ascent += (float) $piece[0];
        $descent += (float) $piece[1];
        $steepAscent += (float) $piece[2];
        $steepDescent += (float) $piece[3];
    }
    if ($slice === []) {
        return null;
    }

    return [
        'ascent' => $ascent,
        'descent' => $descent,
        'steep_ascent' => $steepAscent,
        'steep_descent' => $steepDescent,
        'profile' => $slice,
    ];
}

/**
 * PURE: the four sums of a stored profile — ascent, descent, steep ascent, steep descent.
 *
 * 💣 Same format guard as avesmapsRouteSliceTerrain: an entry shorter than four is a pre-2026-07-30 row
 * and means „no height data", never „no steep ground". One helper so the rule cannot drift between the
 * three places that need it (the edge, the waypoint slice, and its reverse twin).
 *
 * @return array{ascent:float,descent:float,steep_ascent:float,steep_descent:float}|null
 */
function avesmapsRouteSumTerrainProfile(?array $profile): ?array
{
    if (!is_array($profile) || $profile === []) {
        return null;
    }
    $sums = ['ascent' => 0.0, 'descent' => 0.0, 'steep_ascent' => 0.0, 'steep_descent' => 0.0];
    foreach ($profile as $piece) {
        if (!is_array($piece) || count($piece) < 4) {
            return null;
        }
        $sums['ascent'] += (float) $piece[0];
        $sums['descent'] += (float) $piece[1];
        $sums['steep_ascent'] += (float) $piece[2];
        $sums['steep_descent'] += (float) $piece[3];
    }

    return $sums;
}

/**
 * PURE: split a slice's profile at a fraction of ONE segment, for the waypoint anchor.
 *
 * 💣 THIS IS WHAT REPLACES THE BACK-COMPUTATION. `$speed = $originalDistance / $originalTime`
 * (:546) is not a speed but a speed divided by the parent edge's AVERAGE factor; applying it to a
 * sub-slice pushes the whole way's terrain onto a piece with a different gradient. Today that is
 * correct -- the only factor in `time` is the river's, and that one is CONSTANT along the way, so
 * it cancels. The rule underneath: the back-computation holds exactly as long as the factor is
 * constant along the way. For the current it is. For the slope it never is.
 *
 * `$segmentIndex` is the segment being cut, `$t` the fraction of it that falls to the FIRST piece.
 *
 * @return array{0:?array,1:?array} the profile of the first and the second piece
 */
function avesmapsRouteSplitTerrainProfile(?array $profile, int $segmentIndex, float $t): array
{
    if (!is_array($profile)) {
        return [null, null];
    }
    $first = [];
    $second = [];
    foreach ($profile as $index => $pair) {
        if (!is_array($pair) || count($pair) < 4) {
            return [null, null];
        }
        if ($index < $segmentIndex) {
            $first[] = [(float) $pair[0], (float) $pair[1], (float) $pair[2], (float) $pair[3]];
        } elseif ($index > $segmentIndex) {
            $second[] = [(float) $pair[0], (float) $pair[1], (float) $pair[2], (float) $pair[3]];
        } else {
            // Split proportionally by length. The profile stores the SUM over a segment, not its
            // shape, so a proportional share is the only honest answer -- and it is exact in the
            // one property that matters: the two halves add back up to the whole.
            //
            // ⚠️ The steep sums are shared out the same way. That IS an approximation -- steepness is
            // not spread evenly along a segment -- but it is the same approximation the ascent already
            // makes, and it keeps the invariant that the halves sum to the whole. Anything cleverer
            // would need the samples, and those are not stored.
            $share = max(0.0, min(1.0, $t));
            $first[] = [(float) $pair[0] * $share, (float) $pair[1] * $share,
                (float) $pair[2] * $share, (float) $pair[3] * $share];
            $second[] = [(float) $pair[0] * (1.0 - $share), (float) $pair[1] * (1.0 - $share),
                (float) $pair[2] * (1.0 - $share), (float) $pair[3] * (1.0 - $share)];
        }
    }

    return [$first === [] ? null : $first, $second === [] ? null : $second];
}

function avesmapsAddClientCompatiblePathSliceConnection(array &$graph, array $fromNode, array $toNode, array $coordinates, string $routeType, string $transportOption, float $speed, string $connectionId, array $path, ?array $pathTerrain = null, int $fromVertexIndex = 0, int $toVertexIndex = 0): void {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    // V11: the slice's OWN climb and fall, summed from ITS segments of profile_json -- never the
    // parent way's average. `profile_json` holds one [ascent, descent] pair per stored segment of
    // the way, so the vertex range IS the slice.
    $sliceTerrain = avesmapsRouteSliceTerrain($pathTerrain, $fromVertexIndex, $toVertexIndex);
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

    // ---- V11: the slope ------------------------------------------------------------------------
    // 💣 The direction rule is the SAME as the river's (:218-219): from/to keep the STORED
    // orientation on BOTH variants -- the verlauf flow derivation's chain walk depends on it.
    // Ascent in drawing direction is descent against it. That is the whole rule.
    // 🔴 Each direction pays for ITS climb and ITS steep descent. Reversing swaps BOTH pairs -- with the
    // Leistungskilometer it is no longer enough to swap ascent and descent, because „steep" is a
    // property of the ground and changes sides with the traveller.
    $forwardFactor = $sliceTerrain === null ? 1.0
        : avesmapsTerrainLeistungsFactor($sliceTerrain['ascent'], $sliceTerrain['steep_descent'], $distance);
    $reverseFactor = $sliceTerrain === null ? 1.0
        : avesmapsTerrainLeistungsFactor($sliceTerrain['descent'], $sliceTerrain['steep_ascent'], $distance);
    if ($sliceTerrain !== null) {
        // Carried so the waypoint anchor can cut it; only present when there IS a profile.
        $connection['terrain_profile'] = $sliceTerrain['profile'];
    }

    $flow = avesmapsRouteClientNormalizeFlow($path, $routeType);

    // 🔴 NO FLOW AND NO TERRAIN: byte for byte today's branch -- no new key, ONE shared object in
    // both directions. This is the line that makes „switch off" bit-identical, and it is why the
    // terrain block above adds nothing to $connection when $sliceTerrain is null.
    if ($flow === null && $sliceTerrain === null) {
        // No known flow direction: symmetric, EXACTLY today's behaviour (shared object).
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $connection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $connection);
        return;
    }

    // Terrain but no flow: two objects instead of one shared, because the directions now differ.
    if ($flow === null) {
        $forwardConnection = avesmapsRouteApplyTerrainToConnection($connection, $forwardFactor, $sliceTerrain, false);
        $reverseConnection = avesmapsRouteApplyTerrainToConnection($connection, $reverseFactor, $sliceTerrain, true);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $forwardConnection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $reverseConnection);
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

    // V11: flow and slope MULTIPLY, each keeping its own clamp -- the river's [1,0 ... 3,0] (a
    // current only ever slows you down) and the slope's [0,5 ... 4,0]. Inheriting the river clamp
    // for the slope would pull every descent up to 1,0, and downhill would never be faster than
    // level: owner decision 3 silently taken back.
    $forwardConnection = avesmapsRouteApplyTerrainToConnection($forwardConnection, $forwardFactor, $sliceTerrain, false);
    $reverseConnection = avesmapsRouteApplyTerrainToConnection($reverseConnection, $reverseFactor, $sliceTerrain, true);

    avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $forwardConnection);
    avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $reverseConnection);
}

/**
 * PURE: multiply one connection's time by its slope factor and attach what the API reports.
 *
 * A null slice is a no-op that returns the connection UNTOUCHED -- not "times 1.0", untouched. The
 * difference matters: an untouched object carries no `terrain_time_factor` key at all, and that is
 * what keeps „switch off" byte-identical with today.
 *
 * `$reversed` swaps ascent and descent, because the reverse variant travels the stored line
 * backwards. from/to are NOT swapped (client-graph.php:218-219).
 */
function avesmapsRouteApplyTerrainToConnection(array $connection, float $factor, ?array $sliceTerrain, bool $reversed): array
{
    if ($sliceTerrain === null) {
        return $connection;
    }
    $connection['time'] = (float) $connection['time'] * $factor;
    $connection['terrain_time_factor'] = $factor;
    $connection['ascent_schritt'] = $reversed ? $sliceTerrain['descent'] : $sliceTerrain['ascent'];
    $connection['descent_schritt'] = $reversed ? $sliceTerrain['ascent'] : $sliceTerrain['descent'];

    return $connection;
}

/**
 * PURE: the reverse-direction twin of a waypoint sub-slice.
 *
 * Returns the connection UNTOUCHED when it carries no terrain -- and then the caller may go on
 * sharing ONE object in both directions, exactly as before V11. That is what keeps the off state
 * byte-identical.
 *
 * 💣 With terrain the forward object is NOT reusable. Its factor was computed from the STORED
 * orientation's ascent, and travelling the piece the other way climbs what it fell. from/to still
 * keep the stored orientation (see :218-219) -- only the numbers turn around.
 */
function avesmapsRouteReverseSubPathConnection(array $connection): array
{
    if (!array_key_exists('terrain_time_factor', $connection)) {
        return $connection;
    }
    $ascent = (float) $connection['ascent_schritt'];
    $descent = (float) $connection['descent_schritt'];
    $forwardFactor = (float) $connection['terrain_time_factor'];
    // Undo the forward factor to recover the slice's base time, then apply the reverse one.
    $baseTime = $forwardFactor > 0.0 ? (float) $connection['time'] / $forwardFactor : (float) $connection['time'];
    // 🔴 The reverse factor comes from the piece's OWN steep sums, not from swapping ascent and descent.
    // The connection carries its profile for exactly this; without it the steep halves are unknown and
    // the honest answer is the untouched object.
    $sums = avesmapsRouteSumTerrainProfile($connection['terrain_profile'] ?? null);
    if ($sums === null) {
        return $connection;
    }
    $reverseFactor = avesmapsTerrainLeistungsFactor($sums['descent'], $sums['steep_ascent'], (float) $connection['distance']);
    $connection['time'] = $baseTime * $reverseFactor;
    $connection['terrain_time_factor'] = $reverseFactor;
    $connection['ascent_schritt'] = $descent;
    $connection['descent_schritt'] = $ascent;

    return $connection;
}

function avesmapsConnectClientCompatibleDetachedGraphComponents(array &$graph, array $locations, array $request, array $seaBoundLocationNames, array $water = []): int {
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

        // ---- V13: the bridge may not cross open water ------------------------------------------
        // Two stages, and the order is the whole performance story. Stage one tests the ONE nearest
        // chord -- measured, that is dry for 834 of 896 bridges, and those pay nothing beyond a
        // single chord test. Only a wet nearest chord triggers stage two, which repeats the pair scan
        // keeping the 25 nearest. Generalising the scan to "always keep 25" costs 103 ms; doing it
        // twice for the few wet ones costs 66 ms. The second scan is cheaper than the bookkeeping.
        if (avesmapsRouteChordCrossesWater(
            (float) $nearestConnection['from_location']['route_x'],
            (float) $nearestConnection['from_location']['route_y'],
            (float) $nearestConnection['to_location']['route_x'],
            (float) $nearestConnection['to_location']['route_y'],
            $water
        )) {
            $nearestConnection = avesmapsFindNearestDryClientComponentConnection(
                $detachedNodeNames, $anchorNodeNames, $locationLookup, $water
            );
            // 🔴 Owner decision 2026-07-29 („Wirklich weglassen."): nothing dry, no edge. The planner
            // then reports "no route found" -- no fallback, no specially laboured edge. Half of the
            // 24 places this strands lie overseas or in legend; walking there was the actual error.
            if (!is_array($nearestConnection)) continue;
        }

        $fromLocation = $nearestConnection['from_location'];
        $toLocation = $nearestConnection['to_location'];
        $distance = (float) $nearestConnection['distance'] * AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR;
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
function avesmapsConnectClientRouteWaypointsToNearestLandPath(array &$graph, array $locations, array $request, array $seaBoundLocationNames, array $water = []): void {
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
        // V13 §4.6: no dry anchor chord -> no anchor. The waypoint then keeps whatever the component
        // bridge gave it, which is nothing when that was wet too -- and "no route" is the answer.
        $anchor = avesmapsFindNearestClientLandPathAnchor($graph, (float) $location['route_x'], (float) $location['route_y'], $water);
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
function avesmapsCollectClientSeaBoundLocationNames(array $networkData, array $locations, array $locationCoordinateIndex, array $locationCellIndex): array {
    $seaBound = [];
    foreach (is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [] as $path) {
        if (!is_array($path)) continue;
        $routeType = avesmapsNormalizeClientRouteSubtype((string) ($path['subtype'] ?? $path['name'] ?? ''));
        if (!in_array($routeType, AVESMAPS_ROUTE_CLIENT_SEA_ROUTE_TYPES, true)) continue;
        $coordinates = avesmapsReadRoutePathLineCoordinates($path['geometry'] ?? null);
        $count = count($coordinates);
        if ($count < 2) continue;
        foreach ([$coordinates[0], $coordinates[$count - 1]] as $endpoint) {
            $location = avesmapsFindClientLocationAtPathEndpoint($locations, $locationCellIndex, $endpoint);
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

/**
 * Projects (px,py) onto every land-path edge and returns the closest hit whose anchor chord stays out
 * of open water (edge + projected point), or null.
 *
 * 💣 V13, spec §4.6: this is the SECOND producer of Querfeldein edges. Without the water test here the
 * lock would be half built -- and half built precisely at the places the user types into the planner.
 *
 * With empty $water the result is bit-identical to the pre-V13 behaviour: the water test returns false
 * at once, so the nearest projection wins, as it always did. Unlike the component bridge this collects
 * the candidates unconditionally rather than in two stages -- it runs for at most three waypoints per
 * request, so the scan is not worth splitting.
 */
function avesmapsFindNearestClientLandPathAnchor(array $graph, float $px, float $py, array $water = []): ?array {
    foreach (avesmapsCollectNearestClientLandPathAnchors($graph, $px, $py, AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT) as $candidate) {
        if (!avesmapsRouteChordCrossesWater($px, $py, (float) $candidate['proj_x'], (float) $candidate['proj_y'], $water)) {
            return $candidate;
        }
    }
    return null;
}

// The $limit nearest projections, ascending by distance. Same insertion list as
// avesmapsCollectNearestClientComponentConnections, and for the same reason: never sort the full set.
function avesmapsCollectNearestClientLandPathAnchors(array $graph, float $px, float $py, int $limit): array {
    if ($limit <= 0) return [];
    $candidates = [];
    $worst = INF;
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
                    if (count($candidates) >= $limit && $projection['distance'] >= $worst) continue;
                    // Use the connection's STORED orientation (from/to match coordinates[0]/[last]),
                    // NOT the graph iteration keys: edges are stored in both directions with the same
                    // object, so the outer/inner keys can be the reverse of the geometry. Splitting
                    // with the reversed name would attach the sub-edges to the wrong endpoints and the
                    // drawn leg would jump to the far node (a gap between the anchor and the path).
                    $position = count($candidates);
                    while ($position > 0 && (float) $candidates[$position - 1]['distance'] > $projection['distance']) $position--;
                    array_splice($candidates, $position, 0, [[
                        'from' => (string) ($connection['from'] ?? $fromName),
                        'to' => (string) ($connection['to'] ?? $toName),
                        'connection' => $connection,
                        'segment_index' => $i,
                        't' => $projection['t'],
                        'proj_x' => $projection['x'],
                        'proj_y' => $projection['y'],
                        'distance' => $projection['distance'],
                    ]]);
                    if (count($candidates) > $limit) array_pop($candidates);
                    $worst = (float) $candidates[count($candidates) - 1]['distance'];
                }
            }
        }
    }
    return $candidates;
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

        // V11: the parent's profile, cut at the projected point. `$i` is the segment being cut and
        // `$t` the fraction of it that falls to the first piece.
        [$profileFrom, $profileTo] = avesmapsRouteSplitTerrainProfile($original['terrain_profile'] ?? null, $i, $t);

        if (count($sliceFrom) >= 2) {
            $connectionFrom = avesmapsBuildClientRouteSubPathConnection($original, $fromName, $anchorNodeName, $sliceFrom, 'wp-slice-' . $waypointIndex . '-a', $profileFrom);
            avesmapsAddClientCompatibleGraphConnection($graph, $fromName, $anchorNodeName, $connectionFrom);
            avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $fromName, avesmapsRouteReverseSubPathConnection($connectionFrom));
        }
        if (count($sliceTo) >= 2) {
            $connectionTo = avesmapsBuildClientRouteSubPathConnection($original, $anchorNodeName, $toName, $sliceTo, 'wp-slice-' . $waypointIndex . '-b', $profileTo);
            avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $toName, $connectionTo);
            avesmapsAddClientCompatibleGraphConnection($graph, $toName, $anchorNodeName, avesmapsRouteReverseSubPathConnection($connectionTo));
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

function avesmapsBuildClientRouteSubPathConnection(array $original, string $from, string $to, array $coordinates, string $connectionId, ?array $terrainProfile = null): array {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    $originalDistance = (float) ($original['distance'] ?? 0.0);
    $originalTime = (float) ($original['time'] ?? 0.0);

    // 💣 THE BACK-COMPUTATION IS NOT REPAIRED, IT IS MADE UNNECESSARY. `$originalDistance /
    // $originalTime` is not a speed: it is a speed divided by the parent edge's AVERAGE factor.
    // With a river that cancels, because the flow factor is constant along the way. With a slope it
    // never does -- it would push the whole way's terrain onto a piece with a different gradient.
    // So: undo the parent's OWN terrain factor first, then apply the slice's own.
    $parentFactor = (float) ($original['terrain_time_factor'] ?? 1.0);
    $baseTime = $parentFactor > 0.0 ? $originalTime / $parentFactor : $originalTime;
    $baseSpeed = $baseTime > 0.0 ? $originalDistance / $baseTime : 0.0;
    $sliceBaseTime = $baseSpeed > 0.0 ? $distance / $baseSpeed : $baseTime;

    $ascent = null;
    $descent = null;
    $factor = 1.0;
    $sums = avesmapsRouteSumTerrainProfile($terrainProfile);
    if ($sums !== null) {
        $ascent = $sums['ascent'];
        $descent = $sums['descent'];
        $factor = avesmapsTerrainLeistungsFactor($ascent, $sums['steep_descent'], $distance);
    }

    $connection = [
        'distance' => $distance,
        'time' => $sliceBaseTime * $factor,
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
    // Only when there IS terrain -- otherwise the object stays exactly what it is today.
    if ($ascent !== null) {
        $connection['terrain_time_factor'] = $factor;
        $connection['ascent_schritt'] = $ascent;
        $connection['descent_schritt'] = $descent;
        $connection['terrain_profile'] = $terrainProfile;
    }

    return $connection;
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

/**
 * V13: the $limit nearest candidate pairs, ascending by distance.
 *
 * 💣 AN INSERTION LIST, NOT A SORT. Collecting every pair and sorting it costs +3 s per request --
 * a detached component times the main component is tens of thousands of pairs, and there are ~1.000
 * detached components. The list here never grows past $limit, and the `>= $worst` guard rejects the
 * overwhelming majority of pairs with one comparison and no memory traffic at all.
 *
 * ⭐ Candidate 0 is the same pair avesmapsFindNearestClientCompatibleComponentConnection() returns:
 * the insertion walks back only over STRICTLY greater distances, so equal distances keep iteration
 * order, exactly as the single search's strict `<` does. The bridge builder relies on that to skip
 * re-testing rank 1, and water-bridge-test.php asserts it rather than trusting it.
 */
function avesmapsCollectNearestClientComponentConnections(array $componentNodeNames, array $connectedNodeNames, array $locationLookup, int $limit): array {
    if ($limit <= 0) return [];
    $candidates = [];
    $worst = INF;
    foreach ($componentNodeNames as $sourceName) {
        $sourceLocation = $locationLookup[$sourceName] ?? null;
        if (!is_array($sourceLocation)) continue;
        foreach ($connectedNodeNames as $targetName) {
            $targetLocation = $locationLookup[$targetName] ?? null;
            if (!is_array($targetLocation)) continue;
            $distance = avesmapsGetClientCompatibleLocationDistance($sourceLocation, $targetLocation);
            if (count($candidates) >= $limit && $distance >= $worst) continue;
            $position = count($candidates);
            while ($position > 0 && (float) $candidates[$position - 1]['distance'] > $distance) $position--;
            array_splice($candidates, $position, 0, [[
                'from_location' => $sourceLocation,
                'to_location' => $targetLocation,
                'distance' => $distance,
            ]]);
            if (count($candidates) > $limit) array_pop($candidates);
            $worst = (float) $candidates[count($candidates) - 1]['distance'];
        }
    }
    return $candidates;
}

/**
 * V13: the nearest candidate pair whose chord stays out of open water, or null if none of the
 * AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT nearest is dry.
 *
 * Candidate 0 is skipped: the caller has already tested it (that is what sent it here). Measured
 * against the live stock, a dry alternative -- when one exists at all -- sits at median rank 3, p90
 * rank 9, never beyond 16, so the cap of 25 loses nothing while an uncapped search costs 17-47 s.
 */
function avesmapsFindNearestDryClientComponentConnection(array $componentNodeNames, array $connectedNodeNames, array $locationLookup, array $water): ?array {
    $candidates = avesmapsCollectNearestClientComponentConnections(
        $componentNodeNames, $connectedNodeNames, $locationLookup, AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT
    );
    foreach ($candidates as $position => $candidate) {
        if ($position === 0) continue;
        if (!avesmapsRouteChordCrossesWater(
            (float) $candidate['from_location']['route_x'],
            (float) $candidate['from_location']['route_y'],
            (float) $candidate['to_location']['route_x'],
            (float) $candidate['to_location']['route_y'],
            $water
        )) {
            return $candidate;
        }
    }
    return null;
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

// Buckets the locations into 0.5-wide cells over route_x/route_y, so the endpoint lookup below can
// scan 9 cells instead of all locations. Keyed cell -> list of INDICES into $locations (not the
// location sets themselves), because the lookup has to reproduce the linear scan's order.
// The assertion is not decoration: should the tolerance ever grow past the cell width, 3x3 cells
// would no longer cover it and the search would start losing hits silently.
function avesmapsBuildClientLocationCellIndex(array $locations): array {
    assert(AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD <= AVESMAPS_ROUTE_CLIENT_CELL_SIZE,
        'Endpoint tolerance larger than the cell width -- 3x3 cells no longer suffice.');

    $index = [];
    foreach ($locations as $i => $location) {
        $x = filter_var($location['route_x'] ?? null, FILTER_VALIDATE_FLOAT);
        $y = filter_var($location['route_y'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($x === false || $y === false) continue;
        $key = ((int) round($x / AVESMAPS_ROUTE_CLIENT_CELL_SIZE)) . ':'
             . ((int) round($y / AVESMAPS_ROUTE_CLIENT_CELL_SIZE));
        $index[$key][] = $i;
    }

    return $index;
}

function avesmapsFindClientLocationAtPathEndpoint(array $locations, array $cellIndex, array $point): ?array {
    $x = filter_var($point[0] ?? null, FILTER_VALIDATE_FLOAT);
    $y = filter_var($point[1] ?? null, FILTER_VALIDATE_FLOAT);
    if ($x === false || $y === false) return null;

    $cx = (int) round($x / AVESMAPS_ROUTE_CLIENT_CELL_SIZE);
    $cy = (int) round($y / AVESMAPS_ROUTE_CLIENT_CELL_SIZE);

    // The linear scan returned the FIRST hit in $locations order. Walking cells the order would be
    // a different one -- with two locations inside the same tolerance window a different one would
    // come out, and a shared ?s= link would silently resolve to another route. So: lowest index wins.
    $best = null;
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dy = -1; $dy <= 1; $dy++) {
            foreach ($cellIndex[($cx + $dx) . ':' . ($cy + $dy)] ?? [] as $i) {
                if ($best !== null && $i >= $best) continue;
                $location = $locations[$i];
                if (abs((float) $location['route_y'] - $y) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD
                    && abs((float) $location['route_x'] - $x) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD) {
                    $best = $i;
                }
            }
        }
    }

    return $best === null ? null : $locations[$best];
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

// Which transports a way type OFFERS, and which it PRE-SELECTS when a path records nothing -- two
// different lists. Mirrors getTransportOptionsForPathSubtype and
// getDefaultAllowedTransportsForPathSubtype in js/map-features/map-features-path-domain.js.
//   Wuestenpfad -- the carriage is not offered at all, so it can never be stored either
//                  (avesmapsReadAllowedTransports filters it out when saving).
//   Pfad        -- the carriage IS offered but not pre-selected (Owner, 2026-07-30). A carriage does
//                  get through a handful of paths, so an editor may still record it; "nothing
//                  recorded" now means no carriage.
function avesmapsClientRouteTransportOptions(string $routeType): array {
    $options = match (avesmapsClientRouteDomain($routeType)) {
        'river' => AVESMAPS_ROUTE_ALLOWED_RIVER_TRANSPORTS,
        'sea' => AVESMAPS_ROUTE_ALLOWED_SEA_TRANSPORTS,
        default => AVESMAPS_ROUTE_ALLOWED_LAND_TRANSPORTS,
    };
    if ($routeType === 'Wuestenpfad') {
        return array_values(array_filter($options, static fn(string $option): bool => $option !== 'horseCarriage'));
    }

    return $options;
}

function avesmapsClientRouteDefaultAllowedTransports(string $routeType): array {
    $options = avesmapsClientRouteTransportOptions($routeType);
    if ($routeType === 'Pfad') {
        return array_values(array_filter($options, static fn(string $option): bool => $option !== 'horseCarriage'));
    }

    return $options;
}

// The one place "a stored list beats the default" is written down on the server. No separate
// Wuestenpfad clause: filtering a stored list down to what the subtype OFFERS drops a carriage
// stored on a desert path by itself. Mirrors resolvePathAllowedTransports in
// js/map-features/map-features-path-domain.js.
function avesmapsResolveClientRoutePathAllowedTransports(string $routeType, array $path): array {
    $stored = avesmapsClientRoutePathAllowedTransports($path);
    if ($stored === null) {
        return avesmapsClientRouteDefaultAllowedTransports($routeType);
    }

    $offered = avesmapsClientRouteTransportOptions($routeType);
    return array_values(array_filter($stored, static fn(string $option): bool => in_array($option, $offered, true)));
}

function avesmapsIsClientTransportAllowedForPath(string $routeType, string $transportOption, array $path = []): bool {
    return in_array($transportOption, avesmapsResolveClientRoutePathAllowedTransports($routeType, $path), true);
}

// What the path itself RECORDS, the editor's "Erlaubte Transportmittel" (transport_domain +
// allowed_transports, always saved as a PAIR by avesmapsUpdatePathFeatureDetails). Null = the path
// records no restriction; a list -- INCLUDING an empty one -- is authoritative: an empty list means
// no transport at all may use this path (e.g. the upper Raller, where no boat gets past the source).
// The properties_json is NESTED under properties.properties in the route path shape (see
// avesmapsBuildRoutePathData), same as flow. Legacy rows carry an empty list WITHOUT a
// transport_domain -- a shape the editor never wrote -- and fall back to the default rather than
// being treated as impassable.
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

    // Settled state is keyed by (node, transport), never by node alone: with minimize_transfers the
    // edge weight depends on the INCOMING transport, so $distances[$node] is not a valid label for
    // the node on its own and a node-keyed set would change the result. Without minimize_transfers
    // the transport part is simply redundant, not wrong.
    //
    // The stored value is the distance the pair was last expanded at, and the skip only fires when
    // that distance was no better than the current one. That makes it provably behaviour-preserving
    // rather than merely plausible: if $settled[key] <= $currentDistance, then every relaxation this
    // pass would produce, $currentDistance + $weight, is >= the value the earlier pass already
    // produced -- and since $distances only ever decreases, none of them can beat the neighbour's
    // current label. So the skipped work could not have changed a single distance.
    $settled = [];

    while (!$queue->isEmpty()) {
        $item = $queue->extract();
        $currentNode = (string) ($item['node'] ?? '');
        $currentTransport = $item['transport'] ?? null;
        $currentDistance = $distances[$currentNode] ?? INF;

        // Stopping at the target is sound only while the effective expansion order is monotone.
        // Without minimize_transfers the weight below does not depend on $currentTransport, so a
        // stale heap entry can only re-expand a label that was already expanded at that same
        // distance -- it produces no relaxation the earlier pass did not -- and the first
        // extraction of the target therefore already carries its final label. With
        // minimize_transfers that argument collapses: the weight is charged against the incoming
        // transport, $distances[$node] stops being a valid label for the node, and a relaxation
        // out of a stale entry can still undercut the distance the target was extracted at. So the
        // break stays off in that case. graph.php's early exit has no transport concept at all and
        // proves nothing for this loop.
        if (!$minimizeTransfers && $currentNode === $endName) break;

        $settledKey = $currentNode . "\0" . ($currentTransport ?? '');
        if (isset($settled[$settledKey]) && $settled[$settledKey] <= $currentDistance) continue;
        $settled[$settledKey] = $currentDistance;

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
            // V11. 💣 `1.0` means three different things -- terrain off, flat here, nothing known
            // here. `debug.terrain.enabled` separates the first; `null` on ascent/descent separates
            // the third from the second. Without both, a changed number is not explainable to a
            // consumer of the public API.
            'terrain_time_factor' => (float) ($segment['terrain_time_factor'] ?? 1.0),
            'ascent_schritt' => array_key_exists('ascent_schritt', $segment) ? (float) $segment['ascent_schritt'] : null,
            'descent_schritt' => array_key_exists('descent_schritt', $segment) ? (float) $segment['descent_schritt'] : null,
        ];
    }, $segments, array_keys($segments));
}

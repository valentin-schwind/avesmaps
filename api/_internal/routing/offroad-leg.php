<?php

declare(strict_types=1);

// V14 / „Hierher reisen": hang an arbitrary map point onto the route graph.
// Instruction: docs/superpowers/plans/2026-07-30-hierher-reisen-und-astar.md §2.
//
// PURITY CONTRACT: side-effect-free on include. The PDO is optional and only used to fetch the two
// box-limited inputs (height rasters, terrain factors); without it the A* still runs and simply
// prices flat, unlandscaped ground.
//
// ⭐ THE WHOLE TRICK IS THAT THERE IS NO TRICK. The clicked point becomes a NODE with exactly one
// edge -- the A* way to the nearest graph node -- and then the existing Dijkstra, the existing
// segment builder and the existing renderer do their usual work. No second route assembler, no
// special case in the response, and V10 („führt durch"), V11 (terrain) and the travel time all read
// the leg's geometry exactly as they read a drawn way's.

require_once __DIR__ . '/client-graph.php';
require_once __DIR__ . '/land-areas.php';
require_once __DIR__ . '/offroad-data.php';
require_once __DIR__ . '/offroad-grid.php';

// The node name the clicked point is inserted under. Leading underscores, like `__wp_anchor_N`:
// no real location can carry it, so it can never collide with a place called „Kartenpunkt".
const AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX = '__offroad_';

// How many exit nodes to try when the nearest one turns out to be unreachable across country.
//
// 💣 IT HAPPENS, and a test found it rather than a thought: an exit node can sit so deep inside a
// water polygon that the coastal tolerance cannot free a way out of it, and then the whole feature
// answers „kein Weg" although the next node over would have worked. Same shape as V13's problem with
// wet bridge candidates -- and the same answer, keep looking, capped.
//
// ⚠️ NOT V13's 25, and the difference is the point: V13 retries a CHORD TEST, which is nearly free.
// Every retry here is a whole A* over a box that grows with the candidate's distance. 5 keeps the
// worst case at five searches while still covering the ordinary miss (V13 measured median rank 3).
const AVESMAPS_ROUTE_OFFROAD_EXIT_SEARCH_LIMIT = 5;

/**
 * PURE: the nearest graph nodes to (x, y), by air line, nearest first, at most $limit of them.
 *
 * 🔴 GRAPH NODE, NOT „nearest NAMED place" -- owner, this session: „Dijkstra bis zum nächsten
 * Graphknoten, dann querfeldein per A*". The instruction (§2) left the two readings open and marked
 * the decision as the owner's; this is it. Crossings are graph nodes and are therefore candidates,
 * which also keeps the cross-country leg as short as it can be.
 *
 * 💣 The client's findNearestLocationToLatLng excludes crossings BY NAME (`/^Kreuzung(-\d+)?$/i`)
 * and its own file header admits ~200 `Kreuzung-auto-<n>` slip through. That filter is not copied
 * here -- not because it is broken, but because this function asks a different question.
 *
 * Only nodes that are actually IN the graph count: a location the domain filter dropped (a Seeweg-only
 * island in a land-only request) is not somewhere a traveller can be dropped off.
 */
function avesmapsFindNearestOffroadExitNodes(
    array $graph,
    array $locations,
    float $x,
    float $y,
    int $limit = AVESMAPS_ROUTE_OFFROAD_EXIT_SEARCH_LIMIT
): array {
    $candidates = [];
    foreach ($locations as $location) {
        $name = trim((string) ($location['name'] ?? ''));
        if ($name === '' || !isset($graph[$name])) { continue; }
        $coordinates = $location['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) < 2) { continue; }
        $nodeX = (float) $coordinates[0];
        $nodeY = (float) $coordinates[1];
        $candidates[] = ['name' => $name, 'x' => $nodeX, 'y' => $nodeY, 'distance' => hypot($nodeX - $x, $nodeY - $y)];
    }

    usort($candidates, static fn(array $a, array $b): int => $a['distance'] <=> $b['distance']);

    return array_slice($candidates, 0, max(1, $limit));
}

/**
 * Attach the clicked point to the graph as a node with one cross-country edge.
 *
 * Returns a report; `ok` false carries a machine `error` code the caller turns into an API error:
 *   * `point_not_on_land`   -- §1, the only check that exists, and it guards ONLY this point
 *   * `no_exit_node`        -- the graph is empty (no stock, or every domain switched off)
 *   * `no_offroad_route`    -- the A* found no dry way inside the box
 *
 * 💣 THE LAND CHECK COMES FIRST, BEFORE EVERYTHING. No Dijkstra, no grid, no A* for a point in the
 * sea -- both because it is wasted work and because the honest answer is „pick a point on land",
 * not a route that ends in the water.
 *
 * 💣 AND IT IS ASKED OF THIS POINT ONLY. Places are never tested. Owner, verbatim: „ORTE IM WASSER
 * sind nicht zu überprüfen, diese können per Straße immer erreicht werden."
 */
function avesmapsAttachOffroadPointToGraph(
    array &$clientGraph,
    array $locations,
    array $request,
    array $water,
    array $land,
    ?PDO $pdo,
    float $x,
    float $y,
    string $nodeName
): array {
    if (!avesmapsRoutePointIsOnLand($x, $y, $land, $water)) {
        return ['ok' => false, 'error' => 'point_not_on_land'];
    }

    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $speed = $transport === null
        ? null
        : (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transport][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE] ?? null);
    if ($speed === null || $speed <= 0.0) {
        return ['ok' => false, 'error' => 'no_offroad_route'];
    }

    $graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];
    $candidates = avesmapsFindNearestOffroadExitNodes($graph, $locations, $x, $y);
    if ($candidates === []) {
        return ['ok' => false, 'error' => 'no_exit_node'];
    }

    $exit = null;
    $path = null;
    $box = [];
    $rasters = [];
    $factors = '';
    $attempts = 0;
    foreach ($candidates as $candidate) {
        $attempts++;
        $box = avesmapsBuildOffroadBox($candidate['x'], $candidate['y'], $x, $y);
        $blocked = avesmapsOffroadRasteriseBlocked($box, $water);
        $factors = $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '';
        $rasters = $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];
        $heights = $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters);

        $path = avesmapsOffroadFindPath($box, $blocked, $factors, $heights, (float) $speed, $candidate['x'], $candidate['y'], $x, $y);
        if ($path !== null) { $exit = $candidate; break; }
    }

    if ($path === null || $exit === null) {
        return [
            'ok' => false, 'error' => 'no_offroad_route',
            'cell_mapunits' => $box['cell'] ?? 0.0, 'cell_count' => $box['cell_count'] ?? 0,
            'exit_nodes_tried' => $attempts,
        ];
    }

    // ⚠️ NO x25 SURCHARGE HERE, and that is deliberate. AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR
    // exists to make REPAIR bridges unattractive -- a synthetic edge that merely patches a hole in the
    // drawn network should lose against any real road. This leg is not a patch: the traveller asked to
    // go exactly there, it is the only way there, and inflating it would only make the reported travel
    // time wrong by a factor of 25.
    $connectionId = 'offroad-' . $nodeName;
    $connection = [
        'distance' => $path['distance'],
        'time' => $path['time'],
        'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
        'transport_option' => $transport,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => '',
        'public_id' => '',
        'from' => $exit['name'],
        'to' => $nodeName,
        'geometry' => ['type' => 'LineString', 'coordinates' => $path['points']],
        'synthetic' => true,
        // The flag the leg's „wegloses Gelände" note hangs off (spec §5.7). The TEXT is German UI and
        // therefore lives in the client's i18n table, not in an API payload (AGENTS.md §8).
        'offroad' => true,
        // V11's two sums, so this leg can state its climb like a drawn way does. `null` stays null.
        'ascent_schritt' => $path['ascent_schritt'],
        'descent_schritt' => $path['descent_schritt'],
    ];

    $clientGraph['graph'][$nodeName] ??= [];
    avesmapsAddClientCompatibleGraphConnection($clientGraph['graph'], $exit['name'], $nodeName, $connection);
    // The reverse edge is the SAME line walked the other way -- the geometry is reversed so a route
    // that arrives at the point and one that starts there draw the same line, not a mirrored one.
    $reverse = $connection;
    $reverse['from'] = $nodeName;
    $reverse['to'] = $exit['name'];
    $reverse['geometry']['coordinates'] = array_reverse($path['points']);
    // 💣 Climb and descent SWAP when the direction does. Carrying them unchanged would report the
    // ascent of the opposite direction -- the exact class of error V11 §6.3 is about.
    $reverse['ascent_schritt'] = $path['descent_schritt'];
    $reverse['descent_schritt'] = $path['ascent_schritt'];
    avesmapsAddClientCompatibleGraphConnection($clientGraph['graph'], $nodeName, $exit['name'], $reverse);

    return [
        'ok' => true,
        'node' => $nodeName,
        'exit_node' => $exit['name'],
        'exit_air_distance' => $exit['distance'],
        // > 1 means the nearest node(s) could not be left across country -- worth seeing in the
        // debug context, because it is the difference between „the road is far" and „the road is
        // near but behind water".
        'exit_nodes_tried' => $attempts,
        'distance_units' => $path['distance'],
        'time_hours' => $path['time'],
        'point_count' => count($path['points']),
        // 🔴 THE ANSWER SAYS WHICH CELL WIDTH IT USED. Over the cap the search coarsens for this one
        // request (instruction §2), and a route computed on a 1,0 grid is a different statement from
        // one computed on 0,5 -- at 1,0 the 24 narrowest lakes become walls.
        'cell_mapunits' => $box['cell'],
        'cell_count' => $box['cell_count'],
        'coarsened' => $box['coarsened'],
        'cells_opened' => $path['cells_opened'],
        'height_rasters' => count($rasters),
        'terrain_factors_known' => $factors !== '',
    ];
}

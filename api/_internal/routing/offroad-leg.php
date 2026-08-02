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

// Wie viele Graphknoten der Kartenpunkt als Ausstieg ANGEBOTEN bekommt.
//
// 🔴 NICHT EINER, UND DAS IST DER GANZE PUNKT. Die erste Fassung haengte den Punkt mit GENAU EINER
// Kante an den naechsten Knoten. Das hatte zwei Folgen, die der Owner beide gemeldet hat:
//   * jede Route zu dem Punkt musste durch diesen einen Knoten -- auch wenn sie gerade von dort kam,
//     also lief sie den Weg zurueck, statt weiterzugehen;
//   * ein zweiter Kartenpunkt war nur ueber denselben Knoten erreichbar, statt direkt.
// Jetzt bekommt der Punkt eine Kante je Kandidat, und DIJKSTRA sucht sich den Ausstieg aus -- nach
// den Gesamtkosten der Reise, nicht nach der Luftlinie. Genau das ist die Frage, die er beantworten
// kann und eine Nachbarschaftssuche nicht.
//
// ⚠️ Am Livebestand geeicht, nicht geraten: fuer die beiden Punkte des Owners liegt Gratenfels --
// der Knoten, den er erwartet hat -- auf Rang 4 (1,77x der naechsten Luftlinie) bzw. Rang 9 (1,74x).
// 12 Kandidaten bis zum 2,5-fachen der naechsten Luftlinie decken beide Faelle mit Luft.
const AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT = 12;
const AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR = 2.5;

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
    int $limit = AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT
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
    string $nodeName,
    bool $terrainEnabled = true
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

    // ⚠️ ZWEI STUFEN, und die zweite ist eine Rettung, kein Luxus. Die Entfernungsschranke haelt die
    // gemeinsame Suchkiste klein -- sie spannt ueber den Punkt UND alle Kandidaten, ein weit
    // entfernter Knoten zoege sie auf. Wenn aber KEINER der nahen Knoten querfeldein erreichbar ist
    // (ein Ort mitten in einem See), waere die Antwort sonst „kein Weg", obwohl der uebernaechste
    // gegangen waere. Also: erst die nahen, und nur wenn keiner traegt, alle.
    $nearest = $candidates[0]['distance'];
    $reach = max($nearest * AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR, $nearest);
    $near = array_values(array_filter($candidates, static fn(array $c): bool => $c['distance'] <= $reach + 1e-9));

    // 🔴 EINE KISTE FUER ALLE KANDIDATEN, und deshalb auch nur EIN Satz Datenbankabfragen. Vorher
    // baute jeder Kandidat seine eigene Kiste und lud Gelaende und Hoehe erneut -- bei zwoelf
    // Kandidaten waeren das vierundzwanzig Abfragen je Kartenpunkt gewesen.
    $box = [];
    $rasters = [];
    $factors = '';
    $exits = [];
    $offered = 0;
    foreach ([$near, $candidates] as $stage => $set) {
        if ($stage === 1 && ($exits !== [] || count($set) === count($near))) { break; }
        $offered = count($set);

        $spanMinX = $x; $spanMaxX = $x; $spanMinY = $y; $spanMaxY = $y;
        foreach ($set as $candidate) {
            $spanMinX = min($spanMinX, $candidate['x']); $spanMaxX = max($spanMaxX, $candidate['x']);
            $spanMinY = min($spanMinY, $candidate['y']); $spanMaxY = max($spanMaxY, $candidate['y']);
        }
        $box = avesmapsBuildOffroadBox($spanMinX, $spanMinY, $spanMaxX, $spanMaxY);
        $blocked = avesmapsOffroadRasteriseBlocked($box, $water);
        $factors = $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '';
        // 🔴 DER NOTSCHALTER GILT AUCH HIER. V11 §8.3: der Gelaendeschalter ist ein Not-Aus, und er
        // muss ueberall dasselbe bedeuten. Frueher las der A* die Hoehe unabhaengig davon -- dann
        // haette „Gelaende aus" fuer gezeichnete Wege gegolten und fuer die Querfeldein-Etappe nicht.
        $rasters = $terrainEnabled && $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];
        $heights = $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters);

        $clientGraph['graph'][$nodeName] ??= [];
        foreach ($set as $index => $candidate) {
            $path = avesmapsOffroadFindPath($box, $blocked, $factors, $heights, (float) $speed,
                $candidate['x'], $candidate['y'], $x, $y, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters);
            if ($path === null) { continue; }

            avesmapsAddOffroadEdge($clientGraph['graph'], $candidate['name'], $nodeName, $path, (string) $transport, 'offroad-' . $nodeName . '-' . $index);
            $exits[] = [
                'node' => $candidate['name'],
                'air_distance' => $candidate['distance'],
                'distance_units' => $path['distance'],
                'cost_units' => $path['time'],
                'point_count' => count($path['points']),
            ];
        }
    }

    if ($exits === []) {
        return [
            'ok' => false, 'error' => 'no_offroad_route',
            'cell_mapunits' => $box['cell'], 'cell_count' => $box['cell_count'],
            'exit_nodes_offered' => $offered,
        ];
    }

    return [
        'ok' => true,
        'node' => $nodeName,
        // 🔴 ALLE angebotenen Ausstiege, nicht „der eine". Welchen die Reise nimmt, entscheidet der
        // Dijkstra danach -- und genau diese Liste ist der Unterschied zwischen „er geht immer zu
        // demselben Pfadpunkt" und „er sucht sich einen aus".
        'exit_nodes' => $exits,
        'exit_nodes_offered' => $offered,
        'exit_nodes_connected' => count($exits),
        'nearest_exit_node' => $exits[0]['node'] ?? '',
        // 🔴 THE ANSWER SAYS WHICH CELL WIDTH IT USED. Over the cap the search coarsens for this one
        // request (instruction §2), and a route computed on a 1,0 grid is a different statement from
        // one computed on 0,5 -- at 1,0 the 24 narrowest lakes become walls.
        'cell_mapunits' => $box['cell'],
        'cell_count' => $box['cell_count'],
        'coarsened' => $box['coarsened'],
        'height_rasters' => count($rasters),
        'terrain_factors_known' => $factors !== '',
    ];
}

/**
 * Eine Querfeldein-Kante in beide Richtungen in den Graphen haengen.
 *
 * ⚠️ NO x25 SURCHARGE. AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR exists to make REPAIR
 * bridges unattractive -- a synthetic edge that merely patches a hole in the drawn network should
 * lose against any real road. This leg is not a patch: the traveller asked to go exactly there, and
 * inflating it would only make the reported travel time wrong by a factor of 25.
 */
function avesmapsAddOffroadEdge(array &$graph, string $fromName, string $toName, array $path, string $transport, string $connectionId): void
{
    $connection = [
        'distance' => $path['distance'],
        'time' => $path['time'],
        'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
        'transport_option' => $transport,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => '',
        'public_id' => '',
        'from' => $fromName,
        'to' => $toName,
        'geometry' => ['type' => 'LineString', 'coordinates' => $path['points']],
        'synthetic' => true,
        // The flag the leg's „wegloses Gelände" note hangs off (spec §5.7). The TEXT is German UI and
        // therefore lives in the client's i18n table, not in an API payload (AGENTS.md §8).
        'offroad' => true,
    ];

    // 💣 THE KEY IS ONLY SET WHEN THERE IS A MEASUREMENT. avesmapsBuildClientRouteDiagnosticSegments
    // reads these with `array_key_exists(...) ? (float) ... : null` -- so a key present with a null
    // value comes out as 0.0, which means „measured, and level". Along a stretch with no raster that
    // is a lie of exactly the kind V11 built the null/0 distinction to prevent.
    if ($path['ascent_schritt'] !== null) {
        $connection['ascent_schritt'] = $path['ascent_schritt'];
        $connection['descent_schritt'] = $path['descent_schritt'];
    }

    $graph[$fromName] ??= [];
    $graph[$toName] ??= [];
    avesmapsAddClientCompatibleGraphConnection($graph, $fromName, $toName, $connection);

    // The reverse edge is the SAME line walked the other way -- the geometry is reversed so a route
    // that arrives at the point and one that starts there draw the same line, not a mirrored one.
    $reverse = $connection;
    $reverse['from'] = $toName;
    $reverse['to'] = $fromName;
    $reverse['geometry']['coordinates'] = array_reverse($path['points']);
    // 💣 Climb and descent SWAP when the direction does. Carrying them unchanged would report the
    // ascent of the opposite direction -- the exact class of error V11 §6.3 is about.
    if ($path['ascent_schritt'] !== null) {
        $reverse['ascent_schritt'] = $path['descent_schritt'];
        $reverse['descent_schritt'] = $path['ascent_schritt'];
    }
    avesmapsAddClientCompatibleGraphConnection($graph, $toName, $fromName, $reverse);
}

/**
 * Zwei angeklickte Kartenpunkte DIREKT verbinden, querfeldein.
 *
 * 🔴 OHNE DAS GIBT ES KEINEN WEG VON EINEM FREIEN PUNKT ZUM ANDEREN. Beide haengen sonst nur an
 * Graphknoten, also fuehrte die Reise vom ersten Punkt zurueck auf einen Weg und von dort wieder
 * hinauf zum zweiten -- ein V statt einer Linie, auch wenn die beiden Punkte nebeneinander liegen.
 * Owner-Meldung, wortwoertlich: „ausserdem fehlt, dass er von einem freien Wegpunkt zum anderen
 * gehen kann."
 *
 * ⭐ Die Kante ist ein ANGEBOT, keine Vorschrift: sie kostet, was sie kostet, und der Dijkstra nimmt
 * sie nur, wenn sie guenstiger ist als der Umweg ueber die Strasse.
 */
function avesmapsConnectOffroadPoints(
    array &$clientGraph,
    array $request,
    array $water,
    ?PDO $pdo,
    array $fromPoint,
    array $toPoint,
    string $fromNode,
    string $toNode,
    bool $terrainEnabled = true,
    string $connectionId = 'offroad-direct'
): array {
    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $speed = $transport === null
        ? null
        : (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transport][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE] ?? null);
    if ($speed === null || $speed <= 0.0) {
        return ['ok' => false, 'error' => 'no_offroad_route'];
    }

    $box = avesmapsBuildOffroadBox($fromPoint['x'], $fromPoint['y'], $toPoint['x'], $toPoint['y']);
    $blocked = avesmapsOffroadRasteriseBlocked($box, $water);
    $factors = $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '';
    $rasters = $terrainEnabled && $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];
    $heights = $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters);

    $path = avesmapsOffroadFindPath($box, $blocked, $factors, $heights, (float) $speed,
        $fromPoint['x'], $fromPoint['y'], $toPoint['x'], $toPoint['y'], AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters);
    if ($path === null) {
        return ['ok' => false, 'error' => 'no_offroad_route'];
    }

    avesmapsAddOffroadEdge($clientGraph['graph'], $fromNode, $toNode, $path, (string) $transport, $connectionId);

    return [
        'ok' => true,
        'distance_units' => $path['distance'],
        'cost_units' => $path['time'],
        'point_count' => count($path['points']),
        'cell_mapunits' => $box['cell'],
        'height_rasters' => count($rasters),
    ];
}

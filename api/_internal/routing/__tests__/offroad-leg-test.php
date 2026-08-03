<?php
// api/_internal/routing/__tests__/offroad-leg-test.php
declare(strict_types=1);

/**
 * Unit tests for hanging a clicked map point onto the route graph
 * (api/_internal/routing/offroad-leg.php) and routing to it with the ORDINARY Dijkstra.
 *
 * ⭐ The point of this file is that there is nothing special to test on the routing side. The map
 * point becomes a node with one cross-country edge; avesmapsFindClientCompatibleRoute, the segment
 * builder and the renderer are untouched. If that claim is wrong, it breaks here.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-leg-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../offroad-leg.php';

$square = static function (float $x1, float $y1, float $x2, float $y2): array {
    return [
        'geometry' => ['type' => 'Polygon', 'coordinates' => [[
            [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
        ]]],
        'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2,
    ];
};
$place = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];

// Eine kleine Welt: ein Kontinent 0..100, ein See darin, und eine Strasse A -- B -- B2 -- C auf
// y = 10. B und B2 liegen dicht beieinander, damit der Kartenpunkt WIRKLICH die Wahl hat -- eine
// Vorlage mit nur einem erreichbaren Knoten koennte die Wahl gar nicht pruefen.
$land = avesmapsPrepareRouteAreas([$square(0.0, 0.0, 100.0, 100.0)]);
$water = avesmapsPrepareRouteAreas([$square(40.0, 40.0, 60.0, 60.0)]);
$locations = [$place('A', 5.0, 10.0), $place('B', 25.0, 10.0), $place('B2', 30.0, 10.0), $place('C', 45.0, 10.0)];

// 💣 DIE FIXTURE-STRASSE FOLGT DER TEMPOTABELLE, sie schreibt sie nicht ab. Worauf dieser Test
// hinauswill -- welchen Ausstieg eine Reise wählt -- entscheidet allein das VERHÄLTNIS zwischen
// Straße und Querfeldein. Stand hier eine feste 4,0, während der Router sein Querfeldein aus der
// Tabelle liest, dann verschob die Quellen-Eichung am 2026-08-03 dieses Verhältnis von 3,2 auf 4,2
// und beide Reisen stiegen plötzlich am selben Knoten aus -- der Fall prüfte nichts mehr.
$roadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];
$road = static function (string $from, string $to, float $distance) use ($roadSpeed): array {
    return [
        'distance' => $distance, 'time' => $distance / $roadSpeed, 'route_type' => 'Strasse',
        'transport_option' => 'groupFoot', 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 10.0], [100.0, 10.0]]],
    ];
};
$buildGraph = static function () use ($road): array {
    $graph = ['A' => [], 'B' => [], 'B2' => [], 'C' => []];
    foreach ([['A', 'B', 20.0], ['B', 'B2', 5.0], ['B2', 'C', 15.0]] as [$from, $to, $length]) {
        avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $road($from, $to, $length));
        avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $road($to, $from, $length));
    }
    return ['graph' => $graph, 'statistics' => []];
};
$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// ============================================================ A. the ordinary case

$clientGraph = $buildGraph();
// A point on land, 6 units north of the road near B.
$report = avesmapsAttachOffroadPointToGraph($clientGraph, $locations, $request, $water, $land, null, 26.0, 16.0, '__offroad_to');
assert($report['ok'] === true, 'a dry point must attach: ' . json_encode($report));
assert($report['nearest_exit_node'] === 'B', 'der naechste GRAPHKNOTEN ist B, nicht ' . $report['nearest_exit_node']);

// 🔴 MEHRERE AUSSTIEGE, NICHT EINER. Haengt der Punkt an genau einer Kante, muss jede Reise durch
// diesen einen Knoten -- auch wenn sie gerade von dort kam. Der Owner hat genau das gemeldet: „er
// geht immer nur zu einem bestimmten Pfadpunkt". Jetzt entscheidet der Dijkstra.
assert($report['exit_nodes_connected'] >= 2, 'der Punkt haengt an mehreren Knoten: ' . $report['exit_nodes_connected']);
$angebotene = array_column($report['exit_nodes'], 'node');
assert(in_array('B', $angebotene, true) && in_array('B2', $angebotene, true), 'B und B2 sind beide Ausstiege: ' . implode(', ', $angebotene));
// ⚠️ Aber nicht JEDER Knoten: die Entfernungsschranke haelt die gemeinsame Suchkiste klein. A liegt
// 21,8 Einheiten weg, das 3,6-fache des naechsten -- der zoege die Kiste auf, ohne je gewaehlt zu werden.
assert(!in_array('A', $angebotene, true), 'ein weit entfernter Knoten bleibt draussen: ' . implode(', ', $angebotene));
assert(isset($clientGraph['graph']['__offroad_to']), 'the point is now a node');

// 💣 The whole leg has to survive the ORDINARY Dijkstra, unmodified.
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', '__offroad_to', $request);
assert($route['found'] === true, 'the ordinary Dijkstra must reach the map point');
$segments = $route['segments'];
$last = $segments[count($segments) - 1];
assert((string) $last['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'the last leg is Querfeldein');
assert(!empty($last['offroad']), 'and it is flagged as cross-country, so the plan can say „wegloses Gelände"');
assert(count($last['geometry']['coordinates']) >= 2, 'the leg carries a real point sequence');

// The rendered leg starts at the exit node and ends EXACTLY on the clicked point (§5.4).
$coordinates = $last['geometry']['coordinates'];
$end = $coordinates[count($coordinates) - 1];
assert(abs($end[0] - 26.0) < 1e-9 && abs($end[1] - 16.0) < 1e-9, 'the line ends on the clicked point');
assert(abs($coordinates[0][0] - 25.0) < 1e-9 && abs($coordinates[0][1] - 10.0) < 1e-9, 'and starts at the exit node');

// 💣 NO x25 SURCHARGE. That factor exists to make repair bridges unattractive; this leg is the
// journey the traveller asked for, and inflating it would make the reported time 25x wrong.
$airLine = hypot(26.0 - 25.0, 16.0 - 10.0);
assert($last['distance'] >= $airLine - 1e-9, 'the leg is at least the air line');
assert($last['distance'] < $airLine * 2.0, 'and nowhere near a x25 surcharge: ' . $last['distance']);

// 💣 AND ITS COST IS IN THE GRAPH'S UNIT. Both edges price Strecke/Tempo -- the road one from the
// fixture, the cross-country one from the ROUTER. Same convention, so Dijkstra compares like with
// like; see the note in offroad-grid.php.
// ⚠️ Both speeds are READ, never typed: they changed with the source calibration on 2026-08-03.
$offroadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Querfeldein'];
$roadLeg = $segments[0];
assert(abs($roadLeg['time'] - $roadLeg['distance'] / $roadSpeed) < 1e-9, 'the road edge prices Strecke/Tempo');
assert(abs($last['time'] - $last['distance'] / $offroadSpeed) < 1e-9, 'and so does the cross-country leg');

// The diagnostic segment the API ships carries the flag through.
$diagnostic = avesmapsBuildClientRouteDiagnosticSegments($segments);
$shipped = $diagnostic[count($diagnostic) - 1];
assert($shipped['offroad'] === true, 'the API segment carries `offroad`');

// 💣 NO HEIGHT DATA MUST STAY `null` ALL THE WAY OUT. The diagnostic builder reads the sums with
// `array_key_exists(...) ? (float) ... : null`, so a key that is PRESENT and null ships as 0,0 --
// „measured, and level". Over ground with no raster that is exactly the lie V11's null/0 rule
// exists to prevent, and the only defence is not setting the key at all.
assert($shipped['ascent_schritt'] === null, 'unmeasured climb ships as null, not 0,0');
assert($shipped['descent_schritt'] === null, 'unmeasured descent ships as null, not 0,0');

// ============================================================ B. the reverse edge is the same line

$route = avesmapsFindClientCompatibleRoute($clientGraph, '__offroad_to', 'A', $request);
assert($route['found'] === true, 'the point must also be a starting point');
$firstLeg = $route['segments'][0];
$firstCoordinates = $firstLeg['geometry']['coordinates'];
assert(abs($firstCoordinates[0][0] - 26.0) < 1e-9, 'leaving the point starts AT the point');
assert(count($firstCoordinates) === count($coordinates), 'the way back is the same line, not a mirrored one');

// ============================================================ C. the refusals

// A point in the lake -- refused BEFORE any search. This is the one check the feature has, and it
// guards the clicked point only.
$wetGraph = $buildGraph();
$wet = avesmapsAttachOffroadPointToGraph($wetGraph, $locations, $request, $water, $land, null, 50.0, 50.0, '__offroad_to');
assert($wet['ok'] === false && $wet['error'] === 'point_not_on_land', 'a point in the lake is refused');
assert(!isset($wetGraph['graph']['__offroad_to']), 'and nothing is attached to the graph');

// A point outside every declared area -- the 0,7 % that are neither land nor water. Also refused.
$nowhere = avesmapsAttachOffroadPointToGraph($wetGraph, $locations, $request, $water, $land, null, 500.0, 500.0, '__offroad_to');
assert($nowhere['ok'] === false && $nowhere['error'] === 'point_not_on_land', 'undeclared ground is refused too');

// 💣 A PLACE IN THE WATER IS NEVER ASKED. The exit node search does not test the land rule -- if it
// did, 85 of 2.674 places (Belhanka, Nostria) would stop being usable, and the owner ruled that out
// in as many words. B sits in the lake here and must still be a perfectly good exit node.
$drowned = [$place('A', 5.0, 10.0), $place('B', 50.0, 50.0)];
$drownedGraph = ['graph' => ['A' => [], 'B' => []], 'statistics' => []];
avesmapsAddClientCompatibleGraphConnection($drownedGraph['graph'], 'A', 'B', $road('A', 'B', 20.0));
avesmapsAddClientCompatibleGraphConnection($drownedGraph['graph'], 'B', 'A', $road('B', 'A', 20.0));
$fromDrowned = avesmapsAttachOffroadPointToGraph($drownedGraph, $drowned, $request, $water, $land, null, 62.0, 50.0, '__offroad_to');
assert($fromDrowned['ok'] === true, 'a place inside water is never refused for being wet: ' . json_encode($fromDrowned));

// ⚠️ B is nonetheless not the exit here, and the reason is worth stating: it sits in the MIDDLE of a
// 20-unit lake, so no dry way leads out of it -- the coastal tolerance frees 1 unit, not 10. The
// search therefore walked on to A. That is the fallback working, not the land rule leaking into the
// place lookup: B was never rejected, it was only unreachable.
assert($fromDrowned['exit_nodes_connected'] >= 1, 'mindestens ein Ausstieg bleibt erreichbar');
assert(!in_array('B', array_column($fromDrowned['exit_nodes'], 'node'), true),
    'B ist als Ausstieg unerreichbar und faellt weg -- verworfen wurde die KANTE, nicht der Ort');
assert(in_array('A', array_column($fromDrowned['exit_nodes'], 'node'), true), 'A traegt die Reise');

// 💣 THE REAL CASE IS THE OTHER ONE: a harbour town drawn just inside a generously drawn coastline.
// Belhanka and Kuslik are that, and V13 measured the slop at 1,0 map unit. Such a node must be a
// perfectly ordinary exit -- on the FIRST try.
$harbour = [$place('A', 5.0, 10.0), $place('Hafen', 40.6, 50.0)];
$harbourGraph = ['graph' => ['A' => [], 'Hafen' => []], 'statistics' => []];
avesmapsAddClientCompatibleGraphConnection($harbourGraph['graph'], 'A', 'Hafen', $road('A', 'Hafen', 20.0));
avesmapsAddClientCompatibleGraphConnection($harbourGraph['graph'], 'Hafen', 'A', $road('Hafen', 'A', 20.0));
$fromHarbour = avesmapsAttachOffroadPointToGraph($harbourGraph, $harbour, $request, $water, $land, null, 36.0, 50.0, '__offroad_to');
assert($fromHarbour['ok'] === true, 'a coastal node must work: ' . json_encode($fromHarbour));
assert(in_array('Hafen', array_column($fromHarbour['exit_nodes'], 'node'), true), 'der Hafen ist ein Ausstieg');
assert($fromHarbour['nearest_exit_node'] === 'Hafen', 'und der naechste dazu');

// An empty graph: no exit node, and a distinct code -- „nowhere to start from" is not „no way".
$emptyGraph = ['graph' => [], 'statistics' => []];
$noExit = avesmapsAttachOffroadPointToGraph($emptyGraph, [], $request, $water, $land, null, 20.0, 20.0, '__offroad_to');
assert($noExit['ok'] === false && $noExit['error'] === 'no_exit_node', 'an empty graph has no exit node');

// ============================================================ D. the answer names its cell width

assert(isset($report['cell_mapunits']) && $report['cell_mapunits'] > 0.0, 'the report names the cell width used');
assert($report['cell_mapunits'] === AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS, 'a small box uses the configured width');
assert($report['coarsened'] === false, 'and says it was not coarsened');

// ============================================================ D2. DER DIJKSTRA WAEHLT DEN AUSSTIEG

// 🔴 Die Meldung des Owners: „er geht immer nur zu einem bestimmten Pfadpunkt anstatt sich andere
// rauszusuchen ... koennte er direkt nach Gratenfels ohne den Umweg ueber den Pfad (von dem er
// hergekommen ist)". Genau das prueft dieser Fall: die Reise kommt von C und will zum Punkt. Der
// NAECHSTE Knoten ist B -- aber ueber B2 ist die Reise insgesamt kuerzer, weil C an B2 haengt.
$wahlGraph = $buildGraph();
$wahl = avesmapsAttachOffroadPointToGraph($wahlGraph, $locations, $request, $water, $land, null, 29.0, 16.0, '__offroad_to');
assert($wahl['ok'] === true, 'der Punkt haengt: ' . json_encode($wahl));
assert($wahl['nearest_exit_node'] === 'B2', 'naechster Knoten ist B2');

$vonC = avesmapsFindClientCompatibleRoute($wahlGraph, 'C', '__offroad_to', $request);
$vonA = avesmapsFindClientCompatibleRoute($wahlGraph, 'A', '__offroad_to', $request);
$letzterKnoten = static function (array $route): string {
    $ids = $route['node_ids'];
    return (string) $ids[count($ids) - 2];
};
assert($vonC['found'] && $vonA['found'], 'beide Richtungen finden den Punkt');
// ⭐ Der Beleg: derselbe Punkt, zwei Startorte, ZWEI verschiedene Ausstiege. Mit einer einzigen
// Kante waere beides derselbe Knoten gewesen -- und eine der beiden Reisen ein Umweg.
assert($letzterKnoten($vonC) !== $letzterKnoten($vonA),
    'der Ausstieg haengt von der Reise ab, nicht von der Luftlinie: '
    . $letzterKnoten($vonC) . ' / ' . $letzterKnoten($vonA));

// ============================================================ D3. VON EINEM FREIEN PUNKT ZUM ANDEREN

// 🔴 Owner: „ausserdem fehlt, dass er von einem freien Wegpunkt zum anderen gehen kann." Ohne die
// direkte Kante haengt jeder Punkt nur an Strassenknoten, und die Reise liefe hinunter auf die
// Strasse und wieder hinauf -- ein V statt einer Linie.
$paarGraph = $buildGraph();
avesmapsAttachOffroadPointToGraph($paarGraph, $locations, $request, $water, $land, null, 26.0, 16.0, '__offroad_from');
avesmapsAttachOffroadPointToGraph($paarGraph, $locations, $request, $water, $land, null, 29.0, 17.0, '__offroad_to');

$ohneDirekt = avesmapsFindClientCompatibleRoute($paarGraph, '__offroad_from', '__offroad_to', $request);
assert($ohneDirekt['found'] === true, 'auch ohne direkte Kante gibt es einen Weg -- ueber die Strasse');
$umwegKosten = $ohneDirekt['cost'];

$direkt = avesmapsConnectOffroadPoints($paarGraph, $request, $water, null,
    ['x' => 26.0, 'y' => 16.0], ['x' => 29.0, 'y' => 17.0], '__offroad_from', '__offroad_to');
assert($direkt['ok'] === true, 'die direkte Kante entsteht: ' . json_encode($direkt));

$mitDirekt = avesmapsFindClientCompatibleRoute($paarGraph, '__offroad_from', '__offroad_to', $request);
assert($mitDirekt['found'] === true, 'und traegt');
assert(count($mitDirekt['segments']) === 1, 'die Reise ist EINE Etappe, kein V ueber die Strasse');
assert($mitDirekt['cost'] < $umwegKosten, 'und guenstiger als der Umweg: ' . $mitDirekt['cost'] . ' gegen ' . $umwegKosten);

// Die Linie faengt am einen Punkt an und endet am anderen -- genaeht, nicht auf Zellmitten.
$direktGeo = $mitDirekt['segments'][0]['geometry']['coordinates'];
assert(abs($direktGeo[0][0] - 26.0) < 1e-9 && abs($direktGeo[0][1] - 16.0) < 1e-9, 'Anfang am ersten Punkt');
$letzt = $direktGeo[count($direktGeo) - 1];
assert(abs($letzt[0] - 29.0) < 1e-9 && abs($letzt[1] - 17.0) < 1e-9, 'Ende am zweiten Punkt');

// ============================================================ E. the request field

require_once __DIR__ . '/../request.php';

// The normaliser only -- the whole avesmapsNormalizeRouteRequest needs the bootstrap's string
// helpers, and the point field is what this feature added.
assert(avesmapsRouteNormalizeOptionalPoint(null, 'to_point') === null, 'an absent point is null, not an error');
assert(avesmapsRouteNormalizeOptionalPoint(['x' => 12.5, 'y' => 34.0], 'to_point') === ['x' => 12.5, 'y' => 34.0], 'x and y survive');
// ⚠️ GeoJSON order, and integers become floats. The swap from Leaflet's [lat, lng] happens once, in
// the client, at the moment the click is read.
assert(avesmapsRouteNormalizeOptionalPoint(['x' => 1, 'y' => 2], 'from_point') === ['x' => 1.0, 'y' => 2.0], 'integers become floats');

// ⚠️ NAN is not in this list, and that is not an oversight: JSON has no NaN literal, so it cannot
// arrive over the wire. `is_finite` still covers it; testing it here would only make filter_var warn
// about an input the endpoint can never receive.
foreach ([['x' => 1.0], 'nonsense', ['x' => 'abc', 'y' => 1.0], ['x' => INF, 'y' => 1.0]] as $bad) {
    $refused = false;
    try { avesmapsRouteNormalizeOptionalPoint($bad, 'to_point'); } catch (InvalidArgumentException) { $refused = true; }
    assert($refused === true, 'a malformed point must be refused: ' . json_encode($bad));
}

echo "offroad-leg-test: OK\n";

<?php
// api/_internal/routing/__tests__/abgangspunkt-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL. Eine Strasse fuehrt vom Startort erst auf das Ziel zu und knickt dann weg;
 * ihr zielnaechster Punkt liegt weit hinten und verliert gegen den Direktweg. Bis zum
 * 15.08.2026 war dieser eine Punkt das GANZE Angebot der Strasse -- verlor er, existierte die
 * Strasse fuer diese Reise nicht mehr, und die Reise lief vom Startort querfeldein NEBEN ihr her.
 *
 * Nachbau der Route des Owners: Salmingen -> Kartenpunkt (504.530, 501.076) ueber den Talloner
 * Huegelsteig, auf runde Zahlen gebracht und mit groesseren Raendern, damit die Zusicherung
 * nicht an der Gitteraufloesung des A* haengt.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §1
 *
 * 🔴 GEGEN DEN ALTEN STAND ROT. Nachweis in der Sitzung vom 15.08.2026 gefuehrt:
 *   git show HEAD:api/_internal/routing/offroad-leg.php > /tmp/neu.php  (Sicherung)
 *   ... alte Fassung einspielen, Test laufen lassen, zurueckkopieren.
 *
 * Aus dem Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/abgangspunkt-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
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

$land = avesmapsPrepareRouteAreas([$square(0.0, 0.0, 100.0, 100.0)]);
$water = avesmapsPrepareRouteAreas([$square(90.0, 90.0, 95.0, 95.0)]);   // weit weg, nur damit die Struktur steht

// Die Strasse: vom Startort erst gerade auf das Ziel zu (bis (20,52)), dann nach Nordosten weg
// und in einem Bogen zurueck. Ihr ZIELNAECHSTER Punkt ist deshalb (26,50) -- 20,7 Wegeinheiten
// vom Start entfernt, waehrend (20,52) schon nach 8 erreicht ist.
$salmingen = [20.0, 60.0];
$knick     = [20.0, 52.0];
$bogen     = [28.0, 54.0];
$zielnah   = [26.0, 50.0];
$tarnelfurt = [32.0, 50.0];
$ziel = [20.0, 40.0];

$points = [$salmingen, $knick, $bogen, $zielnah, $tarnelfurt];
$roadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];
$connection = [
    'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
    'id' => 'huegelsteig#0', 'path_id' => 'huegelsteig#0',
    'from' => 'Salmingen', 'to' => 'Tarnelfurt',
    'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
    'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / $roadSpeed,
    'geometry' => ['type' => 'LineString', 'coordinates' => $points],
];

$graph = ['Salmingen' => [], 'Tarnelfurt' => []];
avesmapsAddClientCompatibleGraphConnection($graph, 'Salmingen', 'Tarnelfurt', $connection);
avesmapsAddClientCompatibleGraphConnection($graph, 'Tarnelfurt', 'Salmingen', $connection);

$locations = [$place('Salmingen', $salmingen[0], $salmingen[1]), $place('Tarnelfurt', $tarnelfurt[0], $tarnelfurt[1])];
$clientGraph = ['graph' => $graph, 'statistics' => []];
$request = ['optimize' => 'fastest',
    'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

$report = avesmapsAttachOffroadPointToGraph(
    $clientGraph, $locations, $request, $water, $land, null, $ziel[0], $ziel[1], '__offroad_to', false
);
assert($report['ok'] === true, 'der Kartenpunkt wird angebunden: ' . json_encode($report));

// ---- A: 🔴 DER KERN -- die Strasse bietet MEHR ALS EINEN Ausstieg an ----------------------
$anchorExits = array_values(array_filter(
    $report['exit_nodes'],
    static fn(array $exit): bool => str_starts_with((string) $exit['node'], AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX)
));
assert(count($anchorExits) >= 2,
    'die Strasse muss mehr als EINEN Ausstieg anbieten, gefunden: ' . count($anchorExits)
    . ' -- vor dem 15.08.2026 war es genau einer, und genau das ist der Fehler');

// ---- B: die Ortschaften bleiben im Angebot, das Angebot waechst nur -----------------------
$names = array_map(static fn(array $e): string => (string) $e['node'], $report['exit_nodes']);
assert(in_array('Salmingen', $names, true), 'der Direktweg ab Salmingen steht weiter im Angebot');
assert(in_array('Tarnelfurt', $names, true), 'die Ortschaften bleiben im Angebot');
assert(array_key_exists('exit_vertices_capped', $report), 'die Kappung wird gemeldet, auch wenn sie 0 ist');

// ---- C: die gewoehnliche Dijkstra macht daraus ZWEI Etappen -------------------------------
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'Salmingen', '__offroad_to', $request);
assert($route['found'] === true, 'die Reise wird gefunden');
$segments = $route['segments'];
assert(count($segments) === 2,
    'zwei Etappen: erst Strasse, dann Querfeldein -- gefunden: ' . count($segments)
    . ' (' . implode(' + ', array_map(static fn(array $s): string => (string) $s['route_type'], $segments)) . ')');
assert((string) $segments[0]['route_type'] === 'Strasse', 'die erste Etappe ist die Strasse');
assert((string) $segments[1]['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'die zweite ist Querfeldein');
assert(!empty($segments[1]['offroad']), 'und sie ist als Querfeldein gekennzeichnet');

// ---- D: sie steigt am KNICK aus, nicht am zielnaechsten Punkt -----------------------------
$roadCoordinates = $segments[0]['geometry']['coordinates'];
$exit = $roadCoordinates[count($roadCoordinates) - 1];
assert(abs($exit[0] - $knick[0]) < 1e-6 && abs($exit[1] - $knick[1]) < 1e-6,
    'der Ausstieg liegt auf dem Knick (20, 52), gemessen: (' . $exit[0] . ', ' . $exit[1] . ')');
assert(abs((float) $segments[0]['distance'] - 8.0) < 1e-6,
    'die Strassenetappe ist 8 Einheiten lang, gemessen: ' . $segments[0]['distance']);

// ---- E: und die Reise ist billiger als der Direktweg querfeldein --------------------------
$direct = null;
foreach ($report['exit_nodes'] as $candidate) {
    if ((string) $candidate['node'] === 'Salmingen') { $direct = (float) $candidate['cost_units']; }
}
assert($direct !== null, 'der Direktweg ist bepreist');
assert((float) $route['cost'] < $direct - 1e-9,
    'ueber die Strasse billiger als direkt querfeldein: ' . $route['cost'] . ' gegen ' . $direct);

fwrite(STDOUT, "abgangspunkt-test: OK (Strassenetappe " . round((float) $segments[0]['distance'], 3)
    . ", Gelaende " . round((float) $segments[1]['distance'], 3)
    . ", gesamt " . round((float) $route['cost'], 4) . " gegen direkt " . round($direct, 4) . ")\n");

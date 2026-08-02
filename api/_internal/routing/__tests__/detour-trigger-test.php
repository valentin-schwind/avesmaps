<?php
// api/_internal/routing/__tests__/detour-trigger-test.php
declare(strict_types=1);

/**
 * Instruction C §2: der automatische Umweg-Auslöser (V14 §5.5).
 *
 * Kein Knopf und kein Rechtsklick -- er wirkt auf jede normal geplante Route. Führt das gezeichnete
 * Netz einen absurden Bogen, rechnet derselbe A*, der „Hierher reisen" trägt, die Strecke quer und
 * BIETET sie dem Dijkstra an.
 *
 * ⭐ Der Vorfilter ist gratis: Luftlinie und gefahrene Strecke liegen nach dem ersten Dijkstra beide
 * vor. Gemessen lösen 9,1 % der nahen Ortspaare aus; die übrigen 90,9 % zahlen nichts.
 *
 * 💣 Die Schwelle allein entscheidet NICHT. Querfeldein ist mit 1,25 gegen 4,0 auf der Straße gut
 * dreimal langsamer -- ein Bogen von genau 3x ist über die Zeit immer noch der bessere Weg. Deshalb
 * ist die zweite Prüfung die ZEIT, und Fall C hier ist genau der Fall, in dem sie greift.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/detour-trigger-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../detour.php';

$place = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'route_x' => $x, 'route_y' => $y,
    'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];
$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// Eine Strasse aus einer Punktfolge -- Laenge und Zeit kommen aus der Geometrie, wie im echten Graphen.
$roadAlong = static function (array &$graph, string $from, string $to, array $points): void {
    $length = 0.0;
    for ($i = 1; $i < count($points); $i++) {
        $length += hypot($points[$i][0] - $points[$i - 1][0], $points[$i][1] - $points[$i - 1][1]);
    }
    $connection = [
        'distance' => $length, 'time' => $length / 4.0, 'route_type' => 'Strasse',
        'transport_option' => 'groupFoot', 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    $reverse = $connection;
    $reverse['from'] = $to; $reverse['to'] = $from;
    $reverse['geometry']['coordinates'] = array_reverse($points);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $reverse);
};

// ============================================================ A. das Mass ist die GEOMETRIE

// 💣 Nicht `cost` und nicht `distance`: das eine ist eine Zeit, das andere trug bis §1 den x25.
$segments = [
    ['geometry' => ['coordinates' => [[0.0, 0.0], [3.0, 4.0]]], 'time' => 99.0],
    ['geometry' => ['coordinates' => [[3.0, 4.0], [3.0, 14.0]]], 'time' => 1.0],
];
assert(abs(avesmapsRouteMeasureTravelledDistance($segments) - 15.0) < 1e-9, 'gefahren = 5 + 10');
assert(abs(avesmapsRouteMeasureTravelledTime($segments) - 100.0) < 1e-9, 'die Zeit ist die Summe der Etappenzeiten');

// ============================================================ B. der Vorfilter schweigt unter 3x

// A -- B ueber einen leichten Bogen: 18,87 gefahren zu 10,0 Luftlinie.
$graph = ['A' => [], 'B' => []];
$roadAlong($graph, 'A', 'B', [[0.0, 0.0], [5.0, 8.0], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['checked'] === true, 'geprueft wird immer');
assert(abs($report['air_distance'] - 10.0) < 1e-9, 'die Luftlinie: ' . $report['air_distance']);
assert(abs($report['ratio'] - 1.887) < 0.01, 'das Verhaeltnis: ' . $report['ratio']);
assert($report['triggered'] === false, 'unter der Schwelle passiert nichts');
assert($report['offered'] === false, 'und es wird nichts angeboten');
// ⭐ Und der A* lief gar nicht erst -- das ist der Sinn des Vorfilters, nicht ein Nebeneffekt.
assert(!isset($report['offroad']), 'unter der Schwelle wird nicht gerechnet');
assert(!isset($clientGraph['graph']['A']['B'][1]), 'und keine Kante kommt hinzu');

// ============================================================ C. der absurde Bogen wird gekappt

// A -- U -- B: der Umweg fuehrt 50 Einheiten nach Nordost und wieder zurueck, fuer 10 Luftlinie.
$graph = ['A' => [], 'U' => [], 'B' => []];
$roadAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
$roadAlong($graph, 'U', 'B', [[50.0, 50.0], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($route['segments']) === 2, 'die Graph-Route geht ueber den Umweg');

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'ein 13-facher Bogen loest aus: ' . $report['ratio']);
assert($report['offered'] === true, 'und der Querweg ist schneller, also wird er angeboten');
assert($report['offroad']['point_count'] >= 2, 'der Querweg ist eine echte Punktfolge');

// 🔴 ANGEBOT, NICHT VORSCHRIFT: der gewoehnliche Dijkstra entscheidet, genau wie bei zwei
// Kartenpunkten. Kein zweiter Routenzusammenbau, kein Sonderfall in der Antwort.
$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($after['segments']) === 1, 'die ganze Route ist jetzt EINE Etappe: ' . count($after['segments']));
assert((string) $after['segments'][0]['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'und sie ist Querfeldein');
assert(!empty($after['segments'][0]['offroad']), 'als A*-Etappe gekennzeichnet');
assert($after['cost'] < $route['cost'], 'und sie ist billiger: ' . $after['cost'] . ' gegen ' . $route['cost']);

// 💣 KEIN x25. Die Etappe ist die Reise, die der Reisende macht -- kein Notpflaster im Wegenetz.
$shipped = avesmapsBuildClientRouteDiagnosticSegments($after['segments'])[0];
assert(abs($shipped['cost_factor'] - 1.0) < 1e-9, 'die A*-Etappe traegt keinen Aufschlag');
assert($shipped['distance_units'] >= 10.0 - 1e-6, 'und ist mindestens die Luftlinie: ' . $shipped['distance_units']);

// ============================================================ D. ausgeloest, aber zeitlich unterlegen

// 💣 DER FALL, DEN DIE SCHWELLE ALLEIN FALSCH ENTSCHIEDE. 3,1x Bogen: die Strasse ist laenger, aber
// mit 4,0 gegen 1,25 immer noch schneller. Ohne die Zeitprobe wuerde hier eine langsamere Reise
// gewinnen, nur weil sie kuerzer aussieht.
$graph = ['A' => [], 'B' => []];
// 10,5 + 10 + 10,5 = 31 Einheiten fuer 10 Luftlinie: Verhaeltnis 3,1, Fahrzeit 7,75 gegen 8,0 quer.
$roadAlong($graph, 'A', 'B', [[0.0, 0.0], [0.0, 10.5], [10.0, 10.5], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'die Schwelle ist ueberschritten: ' . $report['ratio']);
assert($report['offered'] === false, 'aber die Strasse bleibt die schnellere Reise');
assert($report['reason'] === 'slower', 'und der Grund steht in der Antwort: ' . $report['reason']);

$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($after['segments']) === count($route['segments']), 'die Route ist unveraendert');
assert(abs($after['cost'] - $route['cost']) < 1e-12, 'und kostet dasselbe');

// ============================================================ E. kein trockener Weg, keine Kante

// Ein See, der die ganze Kiste zwischen A und B ausfuellt. Der A* findet nichts, und die Antwort ist
// „nichts anbieten" -- nicht etwa eine Kante durchs Wasser.
$lake = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-30.0, -30.0], [40.0, -30.0], [40.0, 40.0], [-30.0, 40.0], [-30.0, -30.0]]]],
    'min_x' => -30.0, 'min_y' => -30.0, 'max_x' => 40.0, 'max_y' => 40.0,
]]);
$graph = ['A' => [], 'U' => [], 'B' => []];
$roadAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
$roadAlong($graph, 'U', 'B', [[50.0, 50.0], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, $lake, null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'der Bogen loest aus');
assert($report['offered'] === false, 'aber durch den See geht es nicht');
assert($report['reason'] === 'no_offroad_route', 'und der Grund ist benannt: ' . $report['reason']);

$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($after['segments']) === 2, 'die Umweg-Route bleibt die Antwort');

// ============================================================ F. entartete Faelle

// Zwei Orte auf demselben Punkt: kein Verhaeltnis, keine Division durch null.
$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 5.0, 'y' => 5.0], ['x' => 5.0, 'y' => 5.0], 'A', 'B', false);
assert($report['triggered'] === false, 'null Luftlinie loest nicht aus');
assert($report['reason'] === 'no_air_distance', 'und sagt warum: ' . $report['reason']);

// Eine Route, die gar nicht gefunden wurde.
$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, [],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === false, 'ohne Etappen gibt es nichts zu vergleichen');

echo "OK detour-trigger-test\n";

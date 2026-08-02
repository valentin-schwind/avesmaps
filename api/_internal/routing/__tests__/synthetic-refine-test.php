<?php
// api/_internal/routing/__tests__/synthetic-refine-test.php
declare(strict_types=1);

/**
 * Instruction C §3: der Anker bekommt den A*.
 *
 * Die Komponentenbrücke und der Wegpunkt-Anker ziehen gerade Sehnen. Sie kennen seit V13 die
 * Wassersperre -- die Sehne wird geprüft, die Kante entsteht sonst nicht -- aber sie BIEGEN nicht:
 * kein Gelände, keine Höhe, keine Vereinfachung. In derselben Route lagen deshalb zwei fast gleich
 * lange Querfeldein-Etappen mit 2 bzw. 16 Punkten nebeneinander.
 *
 * 🔴 UND DESHALB LÄUFT DER A* NACHTRÄGLICH, NICHT BEIM GRAPHBAU. Am Livebestand gemessen
 * (2026-08-02): 876 synthetische Kanten je Graph, aber 0 bis 1 je ROUTE. Alle beim Bau zu biegen
 * hieße, 876 Suchen für eine Kante zu bezahlen -- und das für jede Anfrage.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/synthetic-refine-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../synthetic-refine.php';

$place = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'route_x' => $x, 'route_y' => $y,
    'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];
$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// Zwei Strasseninseln, dazwischen ein See, um den herum die Bruecke gehen MUSS.
//
//   A1(0,0) -- A2(0,10)          B1(40,0) -- B2(40,10)
//                  See von (12,-6) bis (28,6)
// Die Sehne A1--B1 liefe auf y=0 mitten durch den See; der A* muss noerdlich oder suedlich herum.
$lake = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[12.0, -6.0], [28.0, -6.0], [28.0, 6.0], [12.0, 6.0], [12.0, -6.0]]]],
    'min_x' => 12.0, 'min_y' => -6.0, 'max_x' => 28.0, 'max_y' => 6.0,
]]);

$road = static function (array &$graph, string $from, string $to, float $x1, float $y1, float $x2, float $y2): void {
    $length = hypot($x2 - $x1, $y2 - $y1);
    $connection = [
        'distance' => $length, 'time' => $length / 4.0, 'route_type' => 'Strasse',
        'transport_option' => 'groupFoot', 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[$x1, $y1], [$x2, $y2]]],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};

$buildWorld = static function () use ($road, $place, $request, $lake): array {
    $graph = [];
    $road($graph, 'A1', 'A2', 0.0, 0.0, 0.0, 10.0);
    $road($graph, 'B1', 'B2', 40.0, 0.0, 40.0, 10.0);
    $locations = [$place('A1', 0.0, 0.0), $place('A2', 0.0, 10.0), $place('B1', 40.0, 0.0), $place('B2', 40.0, 10.0)];
    // Die Bruecke selbst: V13 prueft die Sehne, findet sie nass und weicht auf ein trockenes Paar aus.
    avesmapsConnectClientCompatibleDetachedGraphComponents($graph, $locations, $request, [], $lake);
    return ['graph' => $graph, 'statistics' => []];
};

// ============================================================ A. die Sehne vorher

$clientGraph = $buildWorld();
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A1', 'B1', $request);
assert($route['found'] === true, 'die Bruecke traegt eine Route');
$before = null;
foreach ($route['segments'] as $segment) {
    if (!empty($segment['synthetic'])) { $before = $segment; break; }
}
assert(is_array($before), 'die Route benutzt die synthetische Bruecke');
assert(count($before['geometry']['coordinates']) === 2, 'und sie ist heute eine gerade Sehne');
assert(empty($before['offroad']), 'ohne Gelaendewissen');
$sehne = avesmapsCalculateClientRouteCoordinateDistance($before['geometry']['coordinates']);

// ============================================================ B. der A* biegt sie

$report = avesmapsRefineSyntheticRouteLegs($clientGraph, $request, $lake, null, $route['segments'], false);
assert($report['examined'] === 1, 'genau eine Sehne war zu pruefen: ' . $report['examined']);
assert($report['refined'] === 1, 'und sie wurde gebogen: ' . $report['refined']);

$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A1', 'B1', $request);
$leg = null;
foreach ($after['segments'] as $segment) {
    if (!empty($segment['synthetic'])) { $leg = $segment; break; }
}
assert(is_array($leg), 'die Etappe gibt es weiterhin');
assert(count($leg['geometry']['coordinates']) > 2, 'jetzt mit mehr als zwei Punkten: ' . count($leg['geometry']['coordinates']));
assert(!empty($leg['offroad']), 'und als A*-Etappe gekennzeichnet');

// 🔴 SIE IST LAENGER ALS DIE SEHNE, NICHT KUERZER. Ein Weg, der um einen See herumfuehrt, kann die
// Luftlinie nicht unterbieten -- eine kuerzere Zahl hiesse, dass die Laenge beim Vereinfachen
// verlorenging, und die Laenge IST eine Reisezeit.
$gebogen = avesmapsCalculateClientRouteCoordinateDistance($leg['geometry']['coordinates']);
assert($gebogen >= $sehne - 1e-9, 'der gebogene Weg ist mindestens die Sehne: ' . $gebogen . ' gegen ' . $sehne);

// 💣 UND SIE MEIDET DAS WASSER -- der Punkt der ganzen Uebung. Alle 0,1 Einheiten abgetastet.
$points = $leg['geometry']['coordinates'];
$nass = 0;
for ($i = 1; $i < count($points); $i++) {
    $length = hypot($points[$i][0] - $points[$i - 1][0], $points[$i][1] - $points[$i - 1][1]);
    $steps = max(1, (int) ceil($length / 0.1));
    for ($k = 0; $k <= $steps; $k++) {
        $t = $k / $steps;
        $x = $points[$i - 1][0] + ($points[$i][0] - $points[$i - 1][0]) * $t;
        $y = $points[$i - 1][1] + ($points[$i][1] - $points[$i - 1][1]) * $t;
        if (avesmapsRouteAreasContainPoint($x, $y, $lake)) { $nass++; }
    }
}
assert($nass === 0, 'kein einziger Punkt der Etappe liegt im See: ' . $nass);

// ============================================================ C. der x25 bleibt eine Notbruecke

// 💣 Die Geometrie wird ehrlich, die ABSCHRECKUNG bleibt. Ohne sie wuerde eine geflickte Luecke im
// Wegenetz plotzlich mit echten Strassen konkurrieren -- genau das, wogegen der Faktor steht.
assert(abs((float) $leg['cost_factor'] - AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR) < 1e-9,
    'die gebogene Bruecke traegt weiter ihren Aufschlag: ' . ($leg['cost_factor'] ?? 'fehlt'));
assert(abs((float) $leg['distance'] - $gebogen * 25.0) < 1e-6,
    'und ihr Gewicht ist die neue Laenge x25: ' . $leg['distance']);

$shipped = avesmapsBuildClientRouteDiagnosticSegments([$leg])[0];
assert(abs($shipped['distance_units'] - $gebogen) < 1e-6, 'gemeldet wird die Linie: ' . $shipped['distance_units']);

// ============================================================ D. zweimal aendert nichts mehr

// Idempotenz: eine bereits gebogene Etappe ist keine Sehne mehr und wird nicht erneut gerechnet.
$again = avesmapsRefineSyntheticRouteLegs($clientGraph, $request, $lake, null, $after['segments'], false);
assert($again['refined'] === 0, 'ein zweiter Lauf biegt nichts mehr: ' . $again['refined']);

// ============================================================ E. gezeichnete Wege bleiben unberuehrt

$clientGraph = $buildWorld();
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A1', 'A2', $request);
$report = avesmapsRefineSyntheticRouteLegs($clientGraph, $request, $lake, null, $route['segments'], false);
assert($report['examined'] === 0, 'eine reine Strassenroute hat nichts zu biegen');
$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A1', 'A2', $request);
assert(count($after['segments']) === count($route['segments']), 'und bleibt, wie sie war');
assert(abs($after['cost'] - $route['cost']) < 1e-12, 'zum selben Preis');

// ============================================================ F. kein Weg -> die Sehne bleibt

// Ein See, der die ganze Kiste ausfuellt: der A* findet nichts. Dann bleibt die Sehne stehen --
// besser eine grobe Verbindung als gar keine. Die Sehne selbst hat V13 bereits geprueft.
$wall = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-30.0, -30.0], [80.0, -30.0], [80.0, 50.0], [-30.0, 50.0], [-30.0, -30.0]]]],
    'min_x' => -30.0, 'min_y' => -30.0, 'max_x' => 80.0, 'max_y' => 50.0,
]]);
$clientGraph = $buildWorld();
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A1', 'B1', $request);
$report = avesmapsRefineSyntheticRouteLegs($clientGraph, $request, $wall, null, $route['segments'], false);
assert($report['examined'] === 1, 'die Sehne wird geprueft');
assert($report['refined'] === 0, 'aber nicht ersetzt: ' . $report['refined']);
$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A1', 'B1', $request);
assert($after['found'] === true, 'und die Route bleibt fahrbar');

echo "OK synthetic-refine-test\n";

<?php
// api/_internal/routing/__tests__/abgangspunkt-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL. Eine Strasse fuehrt vom Startort erst auf das Ziel zu und knickt dann weg; ihr
 * ZIELNAECHSTER Punkt (26,50) liegt weit hinten -- 20,7 Wegeinheiten vom Start --, waehrend der
 * Knick (20,52) schon nach 8 erreicht ist und fast genauso nah am Ziel liegt (12,0 gegen 11,66).
 * Genau daran unterscheiden sich die beiden Regeln, und deshalb ist diese Fixture der Pruefstein.
 *
 * 🔴 SEIT DEM 15.08.2026 GILT: DER AUSSTIEG IST DER NAECHSTE ERREICHBARE PUNKT DES NETZES.
 * Also (26,50), nicht der Knick. Owner, woertlich: „er soll auf dem strassensystem bleiben bis zu
 * dem punkt gehen wo er am naechsten zur freien zielmarkierung ist und von dort durch wieder durch
 * die landschaft.“
 *
 * 🪤 DIESE DATEI BEHAUPTETE BIS DAHIN DAS GEGENTEIL -- woertlich „sie steigt am KNICK aus, nicht
 * am zielnaechsten Punkt“. Das war kein Versehen, sondern die Regel jenes Tages: jeder Kandidat
 * bekam eine Kante und der Dijkstra suchte den Ausstieg nach GESAMTKOSTEN. Widerlegt an einer
 * Live-Route am selben Abend: 19,44 Meilen querfeldein ab Salmingen, waehrend 0,66 Meilen vor dem
 * Ziel eine Strasse lag.
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

// ---- A: 🔴 DER KERN -- GENAU EIN Ausstieg, und zwar der zielnaechste ----------------------
// 💣 Die Zahl ist die ganze Regel. Zwei Kanten hiessen: der Dijkstra darf wieder waehlen, und
// die Ordnung waere Zierat.
assert(count($report['exit_nodes']) === 1,
    'genau ein Ausstieg, gefunden: ' . count($report['exit_nodes'])
    . ' (' . implode(', ', array_column($report['exit_nodes'], 'node')) . ')');
assert((int) $report['exit_nodes_connected'] === 1,
    'und genau eine Kante haengt am Punkt: ' . $report['exit_nodes_connected']);
$gewaehlt = $report['exit_nodes'][0];
assert(str_starts_with((string) $gewaehlt['node'], AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX),
    'er liegt AUF der Strasse, ist also keine Ortschaft: ' . $gewaehlt['node']);
// Der zielnaechste Punkt der Strasse ist (26,50): hypot(6,10) = 11,6619...
assert(abs((float) $gewaehlt['air_distance'] - hypot(6.0, 10.0)) < 1e-6,
    'und er ist der ZIELNAECHSTE (11,662), nicht der billig erreichbare Knick (12,0): '
    . $gewaehlt['air_distance']);

// ---- B: die Ortschaften sind KEIN Ausstieg mehr, obwohl sie im Topf lagen -----------------
// 🪤 Hier stand bis zum 15.08.2026 das Gegenteil („der Direktweg ab Salmingen steht weiter im
// Angebot“). Genau dieser Direktweg ist das, was der Owner nicht mehr will: Salmingen liegt 20,0
// vom Ziel, der Ausstieg 11,66 -- wer Salmingen anbietet, bietet an, 20 Einheiten querfeldein zu
// laufen, statt auf der Strasse bis zum naechsten Punkt zu bleiben.
$names = array_map(static fn(array $e): string => (string) $e['node'], $report['exit_nodes']);
assert(!in_array('Salmingen', $names, true), 'Salmingen ist kein Ausstieg mehr: ' . implode(', ', $names));
assert(!in_array('Tarnelfurt', $names, true), 'Tarnelfurt ebenso wenig: ' . implode(', ', $names));
assert(array_key_exists('exit_vertices_capped', $report), 'die Kappung wird gemeldet, auch wenn sie 0 ist');

// ---- C: die gewoehnliche Dijkstra macht daraus Strasse + EINE Querfeldein-Etappe ----------
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'Salmingen', '__offroad_to', $request);
assert($route['found'] === true, 'die Reise wird gefunden');
$segments = $route['segments'];
// ⚠️ MEHRERE STRASSEN-ETAPPEN, GENAU EINE QUERFELDEIN. Die Strasse ist an den gerechneten
// Kandidaten geteilt und besteht deshalb aus Teilstuecken -- geometrisch bleibt es EIN Weg, und
// eine feste Zahl hier waere eine Zusicherung ueber die Zahl der Schnitte, nicht ueber die Reise.
// Was zaehlt: alles bis auf die letzte Etappe laeuft auf der Strasse, und die letzte ist Gelaende.
$strassen = array_slice($segments, 0, -1);
$letzte = $segments[count($segments) - 1];
assert($strassen !== [],
    'die Reise beginnt auf der Strasse -- gefunden: '
    . implode(' + ', array_map(static fn(array $s): string => (string) $s['route_type'], $segments)));
foreach ($strassen as $stueck) {
    assert((string) $stueck['route_type'] === 'Strasse',
        'jede Etappe vor der letzten ist Strasse -- gefunden: '
        . implode(' + ', array_map(static fn(array $s): string => (string) $s['route_type'], $segments)));
}
assert((string) $letzte['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'die letzte ist Querfeldein');
assert(!empty($letzte['offroad']), 'und sie ist als Querfeldein gekennzeichnet');

// ---- D: 🔴 sie steigt am ZIELNAECHSTEN Punkt aus, nicht am Knick --------------------------
$letzteStrasse = $strassen[count($strassen) - 1];
$roadCoordinates = $letzteStrasse['geometry']['coordinates'];
$exit = $roadCoordinates[count($roadCoordinates) - 1];
$strasseGefahren = array_sum(array_map(static fn(array $s): float => (float) $s['distance'], $strassen));
assert(abs($exit[0] - $zielnah[0]) < 1e-6 && abs($exit[1] - $zielnah[1]) < 1e-6,
    'der Ausstieg liegt auf (26, 50), gemessen: (' . $exit[0] . ', ' . $exit[1] . ')');
// 💣 GEGENPROBE: er darf NICHT auf dem Knick liegen. Ohne sie waere D auch dann gruen, wenn
// der Ausstieg aus einem ganz anderen Grund am Ende der Strassenetappe steht.
assert(abs($exit[0] - $knick[0]) > 1e-6 || abs($exit[1] - $knick[1]) > 1e-6,
    'und ausdruecklich nicht auf dem Knick (20, 52) -- das war die Regel bis zum 15.08.2026');
$strasseBisZielnah = avesmapsCalculateClientRouteCoordinateDistance([$salmingen, $knick, $bogen, $zielnah]);
assert(abs($strasseGefahren - $strasseBisZielnah) < 1e-6,
    'die gefahrene Strasse laeuft bis dorthin (' . round($strasseBisZielnah, 3) . '), gemessen: '
    . $strasseGefahren);

// ---- E: 🔴 UND SIE IST TEURER ALS DER DIREKTWEG -- DAS IST DER PREIS DER REGEL -------------
// Salmingen liegt 20,0 vom Ziel; querfeldein von dort waere billiger als 20,7 Einheiten Strasse
// plus 11,66 Gelaende. Genau diese Moeglichkeit ist seit dem 15.08.2026 abgeschafft, und dieser
// Test haelt es fest, damit sie niemand als „Optimierung“ zurueckbaut.
// ⚠️ Der Vergleich wird HIER gerechnet, weil Salmingen gar nicht mehr im Angebot steht -- die
// Kosten aus $report['exit_nodes'] gibt es fuer ihn nicht mehr.
$direktLuft = hypot($salmingen[0] - $ziel[0], $salmingen[1] - $ziel[1]);
$querTempo = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot'][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE];
$direct = ($direktLuft / $querTempo) * avesmapsOffroadRampFactor($direktLuft);
assert((float) $route['cost'] > $direct,
    'die erzwungene Route ist teurer als der abgeschaffte Direktweg -- so ist die Regel gemeint: '
    . round((float) $route['cost'], 4) . ' gegen rund ' . round($direct, 4));

fwrite(STDOUT, "abgangspunkt-test: OK (Strasse " . round($strasseGefahren, 3)
    . ", Gelaende " . round((float) $letzte['distance'], 3)
    . ", gesamt " . round((float) $route['cost'], 4)
    . " gegen abgeschafften Direktweg rund " . round($direct, 4) . ")\n");

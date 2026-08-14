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
 * 💣 Die Schwelle allein entscheidet NICHT: die zweite Prüfung ist die ZEIT, und Fall D ist der Fall,
 * in dem sie greift.
 *
 * 🔴 SEIT DEM 14.08.2026 GREIFT SIE AN LAND NICHT MEHR, und das ist eine gemessene Aussage, kein
 * Verdacht. Die Zeitprobe kann eine Route nur retten, solange das TEMPOverhältnis über der Schwelle
 * liegt: bei Querfeldein 0,96 stand die Straße mit 3,07/0,96 = 3,198 knapp über 3,0, und zwischen
 * 3,0x und 3,198x lag ein schmales Band, in dem der Bogen zwar auslöste, aber zeitlich verlor. Mit
 * dem Quellenwert 2,30 sind es 3,07/2,30 = 1,335 -- das Band ist LEER. Und es lässt sich an Land
 * auch nicht wiederherstellen: das größte Landverhältnis überhaupt ist 5,59/2,30 = 2,43
 * (Kutsche auf der Reichsstraße), immer noch unter 3,0.
 * ⚠️ Damit entscheidet an Land allein die Schwelle. Auf dem Wasser bleibt die Zeitprobe scharf
 * (Lastensegler 11,90/2,30 = 5,17), und Fall D steht deshalb seit dem 14.08.2026 auf einem Seeweg.
 * 🔧 Ob die Schwelle 3,0 danach noch die richtige ist, ist eine Owner-Frage -- der Entwurf
 * (2026-08-07-tempowerte §9) verlangt ausdrücklich, sie NACH dem Bau an echten Routen nachzumessen.
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
$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'sea' => 'cargoShip', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// Eine Strasse aus einer Punktfolge -- Laenge und Zeit kommen aus der Geometrie, wie im echten Graphen.
// 💣 DIE FIXTURE-STRASSE FOLGT DER TEMPOTABELLE. Ob der Umweg-Auslöser rechnet oder abkürzt,
// entscheidet allein das VERHÄLTNIS zwischen Straße und Querfeldein -- und das Querfeldein liest der
// Router aus derselben Tabelle. Eine feste 4,0 hier hätte bei der Quellen-Eichung am 2026-08-03 das
// Verhältnis von 3,2 auf 4,2 verschoben, und der Fall „gerechnet und doch verloren" wäre still in
// den Nachbarzweig `cannot_win` gerutscht, ohne je rot zu werden.
$roadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];
$offroadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Querfeldein'];
$seaSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['cargoShip']['Seeweg'];

// 🔴 DIE MESSUNG, DIE FALL D SEINEN SCHAUPLATZ VORSCHREIBT. Die Zeitprobe kann nur dort etwas
// retten, wo das TEMPOverhaeltnis ueber der Schwelle liegt -- sonst gewinnt der Querweg, sobald die
// Schwelle ueberhaupt anschlaegt, und die zweite Pruefung ist eine Zeile ohne Wirkung.
assert($roadSpeed / $offroadSpeed < AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD,
    'an Land liegt das Tempoverhaeltnis unter der Schwelle: ' . round($roadSpeed / $offroadSpeed, 3)
    . ' gegen ' . AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD
    . ' -- ist es wieder darueber, gehoert Fall D zurueck auf die Strasse und dieser Kommentar geaendert');
assert($seaSpeed / $offroadSpeed > AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD,
    'auf dem Wasser liegt es darueber: ' . round($seaSpeed / $offroadSpeed, 3));

$wayAlong = static function (array &$graph, string $from, string $to, array $points,
                             string $routeType, string $transport, float $speed): void {
    $length = 0.0;
    for ($i = 1; $i < count($points); $i++) {
        $length += hypot($points[$i][0] - $points[$i - 1][0], $points[$i][1] - $points[$i - 1][1]);
    }
    $connection = [
        'distance' => $length, 'time' => $length / $speed, 'route_type' => $routeType,
        'transport_option' => $transport, 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    $reverse = $connection;
    $reverse['from'] = $to; $reverse['to'] = $from;
    $reverse['geometry']['coordinates'] = array_reverse($points);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $reverse);
};

// Die beiden Schauplätze, beide mit dem Tempo aus der Tabelle statt mit einer abgeschriebenen Zahl.
$roadAlong = static function (array &$graph, string $from, string $to, array $points)
    use ($wayAlong, $roadSpeed): void {
    $wayAlong($graph, $from, $to, $points, 'Strasse', 'groupFoot', $roadSpeed);
};
$seaAlong = static function (array &$graph, string $from, string $to, array $points)
    use ($wayAlong, $seaSpeed): void {
    $wayAlong($graph, $from, $to, $points, 'Seeweg', 'cargoShip', $seaSpeed);
};
// Eine Notbruecke, wie sie avesmapsConnectClientCompatibleDetachedGraphComponents baut: der einzige
// Faden, an dem ein Ort OHNE Anschluss ans Wegenetz haengt. Genau diese Orte sind es, fuer die es
// Querfeldein ueberhaupt gibt -- und nur an ihnen darf der Ausloeser seit dem 14.08.2026 noch rechnen.
$bridgeAlong = static function (array &$graph, string $from, string $to, array $points)
    use ($wayAlong, $offroadSpeed): void {
    $wayAlong($graph, $from, $to, $points, AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'groupFoot', $offroadSpeed);
};

// ============================================================ A. das Mass ist die GEOMETRIE

// 💣 Nicht `cost` und nicht `distance`: das eine ist eine Zeit, das andere trug bis §1 den x25.
$segments = [
    ['geometry' => ['coordinates' => [[0.0, 0.0], [3.0, 4.0]]], 'time' => 99.0],
    ['geometry' => ['coordinates' => [[3.0, 4.0], [3.0, 14.0]]], 'time' => 1.0],
];
assert(abs(avesmapsRouteMeasureTravelledDistance($segments) - 15.0) < 1e-9, 'gefahren = 5 + 10');
assert(abs(avesmapsRouteMeasureTravelledTime($segments) - 100.0) < 1e-9, 'die Zeit ist die Summe der Etappenzeiten');

// 💣 UND DER x25 MUSS AUCH AUS DER ZEIT HERAUS. `time` ist `distance / Tempo` und erbt den
// Aufschlag der Notbruecken mit. Live gemessen trug Gulbladdirstadir -> Rekheim dadurch 405,09
// statt der echten 32,9 -- eine Route mit EINER kurzen Notbruecke saehe so teuer aus, dass ein
// tatsaechlich langsamerer Querweg gewaenne.
$mitBruecke = [
    ['geometry' => ['coordinates' => [[0.0, 0.0], [100.0, 0.0]]], 'time' => 25.0],
    ['geometry' => ['coordinates' => [[100.0, 0.0], [101.0, 0.0]]], 'time' => 20.0, 'cost_factor' => 25.0],
];
assert(abs(avesmapsRouteMeasureTravelledTime($mitBruecke) - 25.8) < 1e-9,
    'die Notbruecke zaehlt mit ihrer echten Zeit: ' . avesmapsRouteMeasureTravelledTime($mitBruecke));

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
//
// 🔴 UND A HAENGT AN EINER NOTBRUECKE, NICHT AN EINER STRASSE -- seit dem 14.08.2026 ist genau das
// die Bedingung dafuer, dass hier ueberhaupt etwas gerechnet wird (Fall C2). A ist der Ort ohne
// Anschluss ans Wegenetz, fuer den es Querfeldein gibt; der Bogen, den er dabei faehrt, ist der
// Schauplatz Gulbladdirstadir -> Rekheim.
// ⚠️ Ohne x25 im Gewicht: der Aufschlag ist eine Abschreckung fuer den Dijkstra, und der Bericht
// rechnet ihn ohnehin per `cost_factor` heraus (Fall A). Die gemessene Zeit ist dieselbe.
$graph = ['A' => [], 'U' => [], 'B' => []];
$bridgeAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
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

// ============================================================ C2. beide Enden am Wegenetz: nichts quer

// 🔴 DIE OWNER-REGEL VOM 14.08.2026, woertlich: „querfeldein sollen nur orte angefahren werden, die
// nicht mit dem straßennetz verbunden sind". Derselbe absurde Bogen wie in C -- aber A haengt jetzt
// an einer Strasse statt an einer Notbruecke, und damit bleibt die Reise auf dem Netz.
//
// 💣 DAS IST EINE REGEL, KEIN SCHWELLENWERT, und deshalb steht sie VOR der Zeitprobe. Luring ->
// Salmingen lief live quer (3,38 gegen 9,52 ueber Ferdok), obwohl beide Orte am Netz haengen. An der
// Schwelle zu drehen haette den Fall nur verschoben: mit dem Quellenwert 2,30 fuer Querfeldein liegt
// das Tempoverhaeltnis an Land bei 1,335, jeder Bogen ueber 3,0x gewinnt dort also auch zeitlich.
$graph = ['A' => [], 'U' => [], 'B' => []];
$roadAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
$roadAlong($graph, 'U', 'B', [[50.0, 50.0], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'der Bogen loest weiterhin aus: ' . $report['ratio']);
assert($report['chord_candidate_count'] > 0, 'und es gaebe Sehnen zu rechnen: ' . $report['chord_candidate_count']);
assert($report['chord_offnetwork_count'] === 0, 'aber keine davon erreicht einen Ort ohne Anschluss');
assert($report['offered'] === false, 'also wird nichts angeboten');
assert($report['reason'] === 'both_ends_on_network', 'und der Grund steht in der Antwort: ' . $report['reason']);
// ⭐ OHNE EINE EINZIGE GERASTERTE ZELLE. Die Regel greift vor dem A*, nicht nach ihm -- sonst waere
// sie eine Verteuerung des Servers statt einer Ersparnis.
assert(!isset($report['offroad']), 'kein A*-Lauf');
assert(!isset($clientGraph['graph']['A']['B']), 'und keine Kante kommt hinzu');

$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($after['segments']) === 2, 'die Reise bleibt auf dem Netz: ' . count($after['segments']));
assert(abs($after['cost'] - $route['cost']) < 1e-12, 'und kostet unveraendert dasselbe');

// ⚠️ DIE GEGENPROBE ZUR REGEL: es liegt an den ENDEN, nicht daran, dass ueberhaupt nichts mehr
// gerechnet wuerde. Derselbe Graph, ein Ziel Z ohne Anschluss -- und die Sehne kommt zurueck.
$graph['Z'] = [];
$bridgeAlong($graph, 'B', 'Z', [[10.0, 0.0], [10.0, 2.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'Z', $request);
$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 2.0], 'A', 'Z', false);
assert($report['chord_offnetwork_count'] > 0, 'Sehnen an den unangebundenen Ort bleiben');
assert($report['offered'] === true, 'und werden angeboten: ' . $report['reason']);

// ============================================================ D. ausgeloest, aber zeitlich unterlegen

// 💣 DER FALL, DEN DIE SCHWELLE ALLEIN FALSCH ENTSCHIEDE. 3,1x Bogen: der Weg ist laenger, aber mit
// 11,90 gegen 2,30 immer noch schneller. Ohne die Zeitprobe wuerde hier eine langsamere Reise
// gewinnen, nur weil sie kuerzer aussieht.
//
// 🔴 EIN SEEWEG, SEIT DEM 14.08.2026 -- und das ist kein Ausweichen auf einen bequemeren Fall,
// sondern der einzige, der es noch gibt. An Land ist das Tempoverhaeltnis seit dem Quellenwert
// 1,335 und damit UNTER der Schwelle 3,0: sobald der Bogen ausloest, gewinnt der Querweg dort auch
// ueber die Zeit. Die beiden Zusicherungen oben halten genau das fest.
$graph = ['A' => [], 'B' => []];
// 10,5 + 10 + 10,5 = 31 Einheiten fuer 10 Luftlinie: Verhaeltnis 3,1, Fahrzeit 2,605 gegen 4,348 quer.
$seaAlong($graph, 'A', 'B', [[0.0, 0.0], [0.0, 10.5], [10.0, 10.5], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'die Schwelle ist ueberschritten: ' . $report['ratio']);
assert($report['offered'] === false, 'aber die Strasse bleibt die schnellere Reise');
// ⭐ Und zwar OHNE Suche: 10/1,25 = 8,0 Bestzeit gegen 7,75 Fahrzeit -- das steht fest, bevor eine
// Zelle gerastert ist. Genau dieses schmale Band zwischen 3,0x und 3,2x faengt die Schranke bei
// einer Strasse ab (bei Tempo 10 auf dem Seeweg reicht sie bis zum Achtfachen).
assert($report['reason'] === 'cannot_win', 'und der Grund steht in der Antwort: ' . $report['reason']);
assert(!isset($report['offroad']), 'keine Suche gelaufen');

$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($after['segments']) === count($route['segments']), 'die Route ist unveraendert');
assert(abs($after['cost'] - $route['cost']) < 1e-12, 'und kostet dasselbe');

// ============================================================ D2. gar nicht erst rechnen

// 💣 EIN SCHNELLER WEG KANN QUERFELDEIN NICHT VERLIEREN, UND DAS WEISS MAN VORHER. Der A*-Weg ist
// nie kürzer als die Luftlinie, und sein kleinster Faktor ist EXAKT 1,0 (offroad-grid.php:315 --
// dieselbe Ungleichung, mit der dort die A*-Heuristik als zulässig begründet wird). Also ist
// `Luftlinie / Tempo` die Bestzeit, die er überhaupt erreichen könnte. Liegt schon die über der
// Graph-Route, ist die Suche verlorene Arbeit -- eine Division statt einer Rasterung.
//
// ⭐ Praktisch trifft das WASSERWEGE, und seit dem 14.08.2026 nur noch sie: an Land liegt das
// Tempoverhaeltnis mit 1,335 unter der Schwelle, dort greift die Schranke ueberhaupt nicht mehr.
// Auf dem Seeweg reicht sie mit 11,90/2,30 = 5,17 bis zum gut fuenffachen Bogen -- und genau dort
// laeuft der A* sonst leer, denn Fluesse maeandern und Kuesten sind gebogen.
$graph = ['A' => [], 'B' => []];
// 🪤 KEINE ABGESCHRIEBENE 10,0 MEHR. Hier stand das Seetempo als feste Zahl, waehrend der Querweg
// seines aus der Tabelle liest -- dieselbe Falle, vor der der Kommentar an $roadAlong warnt, und sie
// haette diesen Fall bei der naechsten Eichung still in den Nachbarzweig rutschen lassen.
// 40 Einheiten Seeweg fuer 10 Luftlinie: Verhaeltnis 4,0 -- ueber der Schwelle. Aber mit 11,90
// dauert die Fahrt 3,36, waehrend der Querweg bestenfalls 10/2,30 = 4,35 braucht.
$seaAlong($graph, 'A', 'B', [[0.0, 0.0], [0.0, 15.0], [10.0, 15.0], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'die Schwelle ist ueberschritten: ' . $report['ratio']);
assert($report['offered'] === false, 'angeboten wird nichts');
assert($report['reason'] === 'cannot_win', 'und zwar ohne zu rechnen: ' . $report['reason']);
// 💣 NICHT die Zahl hinschreiben. Das Querfeldein-Tempo steht in der Tempotabelle und hat sich mit
// der Quellen-Eichung schon einmal geändert; ein festes „8,0" hier prüfte danach nur noch sich selbst.
$querSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Querfeldein'];
assert(abs($report['best_possible_cost_units'] - 10.0 / $querSpeed) < 1e-9,
    'die Bestzeit steht in der Antwort: ' . $report['best_possible_cost_units']);

// 🔴 DER BEWEIS, DASS WIRKLICH NICHTS GERECHNET WURDE. Bei `slower` traegt der Bericht den
// `offroad`-Block der Suche; hier darf es ihn nicht geben.
assert(!isset($report['offroad']), 'kein A*-Lauf, also auch kein Suchergebnis');

$after = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
assert(count($after['segments']) === count($route['segments']), 'die Route ist unveraendert');
assert(abs($after['cost'] - $route['cost']) < 1e-12, 'und kostet dasselbe');

// ⚠️ Und die Gegenprobe: ein Bogen, den sie NICHT abfaengt, wird weiterhin gerechnet. Sonst waere
// die Schranke zu scharf und schnitte gewinnende Querwege ab.
// 🔴 A haengt wieder an der Notbruecke -- sonst kaeme die Absage schon aus der Owner-Regel (C2) und
// diese Gegenprobe pruefte die Schranke gar nicht mehr.
$graph = ['A' => [], 'U' => [], 'B' => []];
$bridgeAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
$roadAlong($graph, 'U', 'B', [[50.0, 50.0], [10.0, 0.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);
$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['reason'] === 'offered', 'der absurde Bogen wird weiterhin gerechnet: ' . $report['reason']);
assert($report['best_possible_cost_units'] < $report['graph_cost_units'],
    'weil seine Bestzeit unter der Graph-Zeit liegt');

// ============================================================ D3. gerechnet -- und doch verloren

// ⚠️ DIE SCHRANKE IST EINE UNTERE, KEINE VORHERSAGE. Sie sagt nur, was der Querweg BESTENFALLS
// schafft. Zwingt ihn ein Hindernis zum Bogen, verliert er trotzdem -- und das merkt man erst nach
// der Suche. Dieser Fall bleibt teuer, und das ist der Preis dafuer, keinen gewinnenden Querweg
// abzuschneiden.
// 🔴 AUCH DIESER FALL STEHT SEIT DEM 14.08.2026 AUF DEM WASSER, aus demselben Grund wie D: an Land
// gaebe es ihn nicht mehr. Damit ueberhaupt gesucht wird, muss die Bestzeit UNTER der Fahrzeit
// liegen -- und damit der gefundene Weg dann doch verliert, muss die Fahrzeit unter ihm liegen. An
// Land ist zwischen diesen beiden Schranken kein Platz mehr.
// Gemessen, nicht geraten: Fahrzeit 4,706 · Bestzeit 4,348 · gefunden 5,686 -- 21 % Reserve.
$graph = ['A' => [], 'B' => []];
$seaAlong($graph, 'A', 'B', [[0.0, 0.0], [0.0, 23.0], [10.0, 23.0], [10.0, 0.0]]);   // 56 Einheiten, 5,6x
$clientGraph = ['graph' => $graph, 'statistics' => []];
$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'B', $request);

// Ein See quer zwischen beiden, der die direkte Linie sperrt, aber noerdlich einen Korridor laesst.
// ⚠️ Die Oberkante 2,0 ist Teil der Pruefung: die Kiste reicht bis y = 3,0 (Rand = 30 % der
// Luftlinie), der Korridor ist also eine Handbreit -- weiter zu, und der A* findet gar nichts, weiter
// auf, und der Umweg wird zu billig, um noch zu verlieren.
$sperre = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[2.0, -10.0], [8.0, -10.0], [8.0, 2.0], [2.0, 2.0], [2.0, -10.0]]]],
    'min_x' => 2.0, 'min_y' => -10.0, 'max_x' => 8.0, 'max_y' => 2.0,
]]);
$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, $sperre, null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 10.0, 'y' => 0.0], 'A', 'B', false);
assert($report['triggered'] === true, 'die Schwelle loest aus: ' . $report['ratio']);
assert($report['best_possible_cost_units'] < $report['graph_cost_units'],
    'die Bestzeit liegt unter der Fahrzeit, also wird gerechnet');
assert(isset($report['offroad']), 'und es wurde tatsaechlich gesucht');
assert($report['offered'] === false, 'der gefundene Weg ist dann aber doch langsamer');
assert($report['reason'] === 'slower', 'das ist der Unterschied zu cannot_win: ' . $report['reason']);

// ============================================================ E. kein trockener Weg, keine Kante

// Ein See, der die ganze Kiste zwischen A und B ausfuellt. Der A* findet nichts, und die Antwort ist
// „nichts anbieten" -- nicht etwa eine Kante durchs Wasser.
$lake = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-30.0, -30.0], [40.0, -30.0], [40.0, 40.0], [-30.0, 40.0], [-30.0, -30.0]]]],
    'min_x' => -30.0, 'min_y' => -30.0, 'max_x' => 40.0, 'max_y' => 40.0,
]]);
// 🔴 A wieder an der Notbruecke: sonst sagte schon die Owner-Regel (C2) ab, und ob der A* das Wasser
// achtet, waere hier gar nicht mehr gepruft.
$graph = ['A' => [], 'U' => [], 'B' => []];
$bridgeAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
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

// 14.08.2026: mit js/config.js nachgeliefert -- der zugehoerige Deploy-Lauf wurde von einem
// nachfolgenden Push abgebrochen, und der naechste gruene Lauf diffte ab dem abgebrochenen Stand.

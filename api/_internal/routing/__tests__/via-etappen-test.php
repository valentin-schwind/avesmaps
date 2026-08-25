<?php
// api/_internal/routing/__tests__/via-etappen-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL ZU MELDUNG #92: `via` fuehrt die Route wirklich ueber die Zwischenorte.
 *
 * 💣 DER ZWISCHENORT IST EIN ZWANG, KEIN WUNSCH. Eine Reise mit `via` ist die Verkettung ihrer
 * Etappen, nicht die guenstigste Route, die zufaellig dort vorbeikommt -- sonst waere das Feld
 * wirkungslos, sobald der Umweg teurer ist als der direkte Weg. Genau das prueft Abschnitt 2:
 * die Fixture ist so gebaut, dass der Zwischenort ABSEITS liegt und die erzwungene Reise TEURER
 * ist als die direkte. Diese Zusicherung steht hier, damit sie niemand „wegoptimiert".
 *
 * 🔴 EIN KNOTEN ZWEIMAL IST EIN FEHLER. Beim Verketten gehoert der Endknoten einer Etappe UND der
 * Anfangsknoten der naechsten demselben Ort -- er darf in `node_ids` nur EINMAL stehen, sonst
 * meldet die Antwort eine Etappe mehr, als es Wegstuecke gibt, und jeder Client, der Etappe i
 * zwischen node_ids[i] und node_ids[i+1] verortet, verrutscht ab dem Zwischenort um eins.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/via-etappen-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../client-graph.php';
require_once __DIR__ . '/../request.php';

$tempo = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];

// A --- B --- C  auf einer Geraden, dazu ein Abstecher B --- H (Hartsteen) daneben.
// Die direkte Reise A -> C beruehrt H nie; `via: [H]` muss sie zwingen, hin und zurueck.
$stueck = static function (string $von, string $nach, array $punkte) use ($tempo): array {
    $strecke = avesmapsCalculateClientRouteCoordinateDistance($punkte);
    return [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => $von . '>' . $nach, 'path_id' => $von . '>' . $nach, 'public_id' => 'pub-' . $von . $nach,
        'from' => $von, 'to' => $nach,
        'distance' => $strecke, 'time' => $strecke / $tempo,
        'geometry' => ['type' => 'LineString', 'coordinates' => $punkte],
    ];
};
$beide = static function (array &$graph, array $verbindung): void {
    avesmapsAddClientCompatibleGraphConnection($graph, $verbindung['from'], $verbindung['to'], $verbindung);
    avesmapsAddClientCompatibleGraphConnection($graph, $verbindung['to'], $verbindung['from'], $verbindung);
};

$graph = ['A' => [], 'B' => [], 'C' => [], 'H' => []];
$beide($graph, $stueck('A', 'B', [[0.0, 0.0], [10.0, 0.0]]));
$beide($graph, $stueck('B', 'C', [[10.0, 0.0], [20.0, 0.0]]));
$beide($graph, $stueck('B', 'H', [[10.0, 0.0], [10.0, 7.0]]));   // der Abstecher
$clientGraph = ['graph' => $graph, 'statistics' => []];

$anfrage = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// ---- 1. Ohne Zwischenort bleibt alles, wie es war -----------------------------------------------
$direkt = avesmapsFindClientCompatibleRouteLegs($clientGraph, ['A', 'C'], $anfrage);
$einzeln = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'C', $anfrage);
assert($direkt['found'] === true, 'die direkte Reise wird gefunden');
assert($direkt['node_ids'] === $einzeln['node_ids'], 'EINE Etappe ist zeichengleich mit dem Einzellauf');
assert($direkt['edge_ids'] === $einzeln['edge_ids'], 'auch die Kantenliste');
assert(abs($direkt['cost'] - $einzeln['cost']) < 1e-12, 'auch die Kosten');
assert($direkt['node_ids'] === ['A', 'B', 'C'], 'und sie beruehrt H nicht: ' . json_encode($direkt['node_ids']));

// ---- 2. Mit Zwischenort wird der Abstecher gefahren, und er kostet ------------------------------
$ueberH = avesmapsFindClientCompatibleRouteLegs($clientGraph, ['A', 'H', 'C'], $anfrage);
assert($ueberH['found'] === true, 'die Reise ueber H wird gefunden');
assert(in_array('H', $ueberH['node_ids'], true), 'H liegt wirklich auf der Reise: ' . json_encode($ueberH['node_ids']));
assert($ueberH['node_ids'] === ['A', 'B', 'H', 'B', 'C'],
    'hin und zurueck ueber B: ' . json_encode($ueberH['node_ids']));
// 🔴 DER PREIS DER REGEL, ausdruecklich festgenagelt: erzwungen ist teurer als frei gewaehlt.
assert($ueberH['cost'] > $direkt['cost'],
    "die erzwungene Reise ist teurer ({$ueberH['cost']} gegen {$direkt['cost']})");

// ---- 3. Die Knotenliste hat den Zwischenort NICHT doppelt ---------------------------------------
// Die Naht ist die Stelle, an der sich ein Verkettungsfehler zeigt: Etappe i laeuft von
// node_ids[i] nach node_ids[i+1], also muss es genau eine Kante weniger geben als Knoten.
assert(count($ueberH['node_ids']) === count($ueberH['edge_ids']) + 1,
    'Knoten = Kanten + 1 (' . count($ueberH['node_ids']) . ' / ' . count($ueberH['edge_ids']) . ')');
assert(count($ueberH['segments']) === count($ueberH['edge_ids']), 'je Kante eine Etappe');
assert($ueberH['edge_count'] === count($ueberH['edge_ids']), 'edge_count zaehlt dieselben Kanten');

// ---- 4. Und die Etappen stehen ueber die Naht hinweg in Reiserichtung ---------------------------
// 💣 Die Verkettung ist die erste Stelle, an der Meldung #98 wieder aufbrechen kann: die zweite
// Etappe faengt mit ihrer EIGENEN Knotenliste an, und wer die nicht durchreicht, dreht nur die
// erste Haelfte der Reise richtig herum.
$etappen = avesmapsBuildClientRouteDiagnosticSegments($ueberH['segments'], $ueberH['node_ids']);
for ($i = 0, $n = count($etappen); $i < $n; $i++) {
    assert($etappen[$i]['from_node'] === $ueberH['node_ids'][$i],
        "Etappe $i beginnt bei {$ueberH['node_ids'][$i]}, gemeldet: {$etappen[$i]['from_node']}");
    assert($etappen[$i]['to_node'] === $ueberH['node_ids'][$i + 1],
        "Etappe $i endet bei {$ueberH['node_ids'][$i + 1]}, gemeldet: {$etappen[$i]['to_node']}");
}

// ---- 5. Ein unerreichbarer Zwischenort macht die GANZE Reise ungefunden -------------------------
// Nicht „die halbe Route" -- wer einen Zwischenort nennt, will dort hin.
$graphOhne = $graph;
unset($graphOhne['H']);
$graphOhne['B'] = array_diff_key($graphOhne['B'], ['H' => true]);
$verloren = avesmapsFindClientCompatibleRouteLegs(['graph' => $graphOhne, 'statistics' => []], ['A', 'H', 'C'], $anfrage);
assert($verloren['found'] === false, 'ohne H ist die Reise ueber H nicht gefunden');
assert($verloren['segments'] === [], 'und sie liefert keine halbe Etappenliste');

// ---- 6. Ein Zwischenort, der dem Nachbarn gleicht, kostet keine Etappe --------------------------
// „A, A, C" ist keine Fehleingabe, sondern eine Liste mit einer stehengebliebenen Zeile.
$doppelt = avesmapsFindClientCompatibleRouteLegs($clientGraph, ['A', 'A', 'C'], $anfrage);
assert($doppelt['node_ids'] === ['A', 'B', 'C'], 'A -> A -> C ist A -> C: ' . json_encode($doppelt['node_ids']));

// ---- 7. Der Normalisierer deckelt die Zwischenorte ----------------------------------------------
// ⚠️ Jede Etappe ist ein eigener Dijkstra ueber denselben Graphen. Der Graphbau kommt nur einmal,
// die Suche je Etappe -- ohne Deckel haengt eine Anfrage mit 500 Zwischenorten am 30-Sekunden-Limit
// des Endpunkts, und das ist auf STRATO ein besetzter PHP-Arbeiter (AGENTS.md §9).
$geht = avesmapsNormalizeRouteRequest([
    'from' => 'A', 'to' => 'C',
    'via' => array_fill(0, AVESMAPS_ROUTE_MAX_VIA, 'H'),
]);
assert(count($geht['via']) === AVESMAPS_ROUTE_MAX_VIA, 'der Deckel selbst ist noch erlaubt');

$zuviel = false;
try {
    avesmapsNormalizeRouteRequest([
        'from' => 'A', 'to' => 'C',
        'via' => array_fill(0, AVESMAPS_ROUTE_MAX_VIA + 1, 'H'),
    ]);
} catch (InvalidArgumentException) {
    $zuviel = true;
}
assert($zuviel === true, 'einer zu viel wird abgelehnt');

// ---- 8. Leere Eintraege fallen heraus, ohne die Anfrage zu verwerfen ----------------------------
// Der Planer schickt eine leere Wegpunktzeile als leeren String mit.
$mitLuecke = avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'C', 'via' => ['H', '', '  ']]);
assert($mitLuecke['via'] === ['H'], 'leere Zwischenorte werden still verworfen: ' . json_encode($mitLuecke['via']));

// ---- 9. Der Endpunkt rechnet an KEINER Stelle mehr am Zwischenort vorbei ------------------------
// 💣 DIE FALLE VOM 14.08.2026, IN KLEIN: `response.php` rechnet an DREI Stellen eine Route -- einmal
// zu Beginn, einmal nachdem der Umweg-Auslöser eine Sehne angeboten hat, einmal nachdem die
// Sehnen-Verfeinerung eine Kante gebogen hat. Bliebe an EINER davon der alte Paar-Aufruf stehen,
// verlöre die Reise ihre Zwischenorte genau dann, wenn eine der beiden Nachbesserungen greift --
// also selten, unregelmässig und ohne Fehlermeldung. Ein Test der Verkettung allein sähe das nie.
$quelle = (string) file_get_contents(__DIR__ . '/../response.php');
$ab = strpos($quelle, 'function avesmapsBuildMinimalRouteResultFromRequest');
assert($ab !== false, 'die Funktion steht in response.php');
$rumpf = substr($quelle, $ab);
assert(!str_contains($rumpf, 'avesmapsFindClientCompatibleRoute('),
    'response.php ruft den Paar-Dijkstra nicht mehr direkt -- jede Stelle geht ueber $fahreRoute()');
assert(substr_count($rumpf, '$fahreRoute()') === 3,
    'alle DREI Rechenstellen gehen ueber $fahreRoute(), gezaehlt: ' . substr_count($rumpf, '$fahreRoute()'));

// ---- 10. Und der Bauplan sieht den GEAENDERTEN Graphen ------------------------------------------
// 💣 EINE PFEILFUNKTION WAERE HIER STILL FALSCH. `avesmapsMaybeOfferOffroadDetour` und
// `avesmapsRefineSyntheticRouteLegs` nehmen `array &$clientGraph` und aendern ihn -- die eine haengt
// eine Kante hinein, die andere biegt eine. Genau deshalb wird danach neu gerechnet. Eine
// Pfeilfunktion bindet ihre Umgebung aber beim ANLEGEN und immer als Kopie: der zweite Lauf saehe
// den Graphen von vorher und damit die neue Kante nicht. Das Ergebnis waere nicht falsch genug, um
// aufzufallen -- nur nie das beste. Beim Bau am 25.08.2026 stand hier zuerst eine Pfeilfunktion.
assert(str_contains($rumpf, 'use (&$clientGraph)'),
    'der Bauplan bindet den Graphen als Verweis -- sonst rechnet er zweimal auf dem alten Stand');
assert(!preg_match('/\$fahreRoute = static fn/', $rumpf),
    'und ist keine Pfeilfunktion (die kann gar nicht als Verweis binden)');

fwrite(STDOUT, "OK via-etappen-test\n");

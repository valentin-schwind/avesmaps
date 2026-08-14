<?php

declare(strict_types=1);

// Die Kutsche fährt nicht querfeldein.
//
// 🔴 REGELWERK, NICHT PHYSIK. Das offizielle DSA-Landreisekapitel verbietet der Kutsche mehrere
// Wegarten rundheraus -- Pfade, Querfeldein, Wüsten, Eisgebiete -- statt sie über eine Steigung
// langsamer zu machen. Wüstenpfad und Pfad sind seit 2026-07-30 abgebildet (der eine hart, der
// andere als abgewählte Voreinstellung); Querfeldein war die letzte offene Wegart.
//
// 💣 VIER ERZEUGER, NICHT ZWEI. Hier stand bis zum 14.08.2026 „ZWEI ERZEUGER, NICHT EINER" -- und
// diese Zahl war die eigentliche Falle: sie las sich wie eine vollständige Liste, also prüfte
// niemand nach. Vollständig ist sie so:
//   1. avesmapsConnectClientCompatibleDetachedGraphComponents (client-graph.php) -- Komponentenbrücken
//   2. avesmapsConnectClientRouteWaypointsToNearestLandPath   (client-graph.php) -- Wegpunkt-Anker
//   3. avesmapsAttachOffroadPointToGraph                      (offroad-leg.php)  -- „Hierher reisen"
//   4. avesmapsConnectOffroadPoints                           (offroad-leg.php)  -- Punkt zu Punkt,
//      und über detour.php auch die Sehnen des automatischen Umwegs
// 1 und 2 fragten den Torwächter von Anfang an; 3 und 4 prüften nur, ob es ein TEMPO gibt -- und für
// die Kutsche gibt es querfeldein eines (3,84). Also blieb die Sperre genau an den beiden Stellen
// offen, die der NUTZER auslöst. Live gemessen am 14.08.2026: „Hierher reisen" von Luring auf einen
// Kartenpunkt, HTTP 200, zwei Etappen, eine davon Querfeldein. Dasselbe Muster, das V13 beim Wasser
// schon einmal gekostet hat.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/carriage-offroad-test.php

// 💣 OHNE assert() PRÜFT DIESE DATEI NICHTS und meldet trotzdem „all asserts passed". Der Lauf oben
// und der Deploy setzen das Flag; ein Lauf von Hand ohne es sähe wie ein grüner Test aus.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

// request.php trägt die Transportmittel-Konstanten, client-graph.php die Regeln. Beide sind beim
// Einbinden nebenwirkungsfrei (nur Funktionen und Konstanten) -- keine Datenbank, kein HTTP.
require_once __DIR__ . '/../request.php';
require_once __DIR__ . '/../client-graph.php';

// ---- die Wegart bietet der Kutsche nichts mehr an ------------------------------------------------
$offered = avesmapsClientRouteTransportOptions('Querfeldein');
assert(!in_array('horseCarriage', $offered, true), 'Querfeldein bietet der Kutsche keinen Platz mehr');
assert(in_array('caravan', $offered, true), 'die Karawane kommt querfeldein weiterhin durch');
assert(in_array('groupFoot', $offered, true), 'Fussgaenger ohnehin');
assert(in_array('lightRider', $offered, true), 'und Reiter auch');

// Die anderen Wegarten bleiben unberührt -- besonders die, an denen schon eine Regel hängt.
assert(!in_array('horseCarriage', avesmapsClientRouteTransportOptions('Wuestenpfad'), true), 'Wueste bleibt gesperrt');
assert(in_array('horseCarriage', avesmapsClientRouteTransportOptions('Pfad'), true), 'der Pfad BIETET die Kutsche weiterhin an');
assert(!in_array('horseCarriage', avesmapsClientRouteDefaultAllowedTransports('Pfad'), true), 'waehlt sie aber nicht vor');
assert(in_array('horseCarriage', avesmapsClientRouteTransportOptions('Strasse'), true), 'auf der Strasse faehrt sie');
assert(in_array('horseCarriage', avesmapsClientRouteTransportOptions('Gebirgspass'), true), 'und ueber den Pass auch');

// ---- die Sperre wirkt über den gemeinsamen Torwaechter -------------------------------------------
// 🔴 Das ist der Aufruf, den BEIDE Querfeldein-Erzeuger machen müssen. Prüft ihn direkt, damit der
// Test nicht davon abhängt, einen ganzen Graphen zu bauen.
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'horseCarriage') === false,
    'der Torwaechter sperrt die Kutsche querfeldein'
);
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'groupFoot') === true,
    'und laesst die Fussgruppe durch'
);

// 💣 Eine gespeicherte Liste darf die Sperre nicht aushebeln. `resolve…` filtert eine gespeicherte
// Liste auf das, was die Wegart ANBIETET -- genau der Mechanismus, der die Kutsche schon vom
// Wuestenpfad fernhaelt, auch wenn ein Editor sie dort einmal angehakt hat.
$withStoredCarriage = ['properties' => ['transport_domain' => 'land', 'allowed_transports' => ['horseCarriage', 'groupFoot']]];
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'horseCarriage', $withStoredCarriage) === false,
    'auch eine gespeicherte Kutsche kommt querfeldein nicht durch'
);
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'groupFoot', $withStoredCarriage) === true,
    'die uebrigen Eintraege der Liste bleiben gueltig'
);

// ---- und der Torwaechter wird an den ERZEUGERN auch wirklich gefragt -----------------------------
//
// 💣 ALLES BISHERIGE PRUEFT NUR, DASS DIE REGEL STIMMT -- nicht, dass jemand sie fragt. Genau da lag
// das Loch: die beiden Erzeuger in offroad-leg.php prueften bis zum 14.08.2026 nur, ob es fuer das
// Verkehrsmittel ein TEMPO gibt, und eines gibt es fuer die Kutsche (Querfeldein 3,84). Live
// gemessen an diesem Tag: „Hierher reisen" von Luring auf einen Kartenpunkt lieferte HTTP 200 mit
// einer Querfeldein-Etappe. Dieser Abschnitt faehrt deshalb den Kartenpunkt wirklich an, statt den
// Torwaechter ein zweites Mal einzeln zu befragen.
require_once __DIR__ . '/../offroad-leg.php';

$quadrat = static fn(float $x1, float $y1, float $x2, float $y2): array => [
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
    ]]],
    'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2,
];
// Eine kleine trockene Welt mit einer Strasse A -- B auf y = 10. Kein Wasser, damit der A* freie
// Bahn hat: geprueft wird die SPERRE, nicht die Wassermeidung.
$land = avesmapsPrepareRouteAreas([$quadrat(0.0, 0.0, 100.0, 100.0)]);
$orte = [
    ['name' => 'A', 'geometry' => ['type' => 'Point', 'coordinates' => [5.0, 10.0]]],
    ['name' => 'B', 'geometry' => ['type' => 'Point', 'coordinates' => [25.0, 10.0]]],
];
$baueGraph = static function (): array {
    $strasse = [
        'route_type' => 'Strasse', 'transport_option' => 'horseCarriage',
        'id' => 'path-AB', 'path_id' => 'path-AB', 'from' => 'A', 'to' => 'B',
        'distance' => 20.0,
        // Gelesen, nicht getippt -- die Tempotabelle wandert mit der Eichung.
        'time' => 20.0 / (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['horseCarriage']['Strasse'],
        'geometry' => ['type' => 'LineString', 'coordinates' => [[5.0, 10.0], [25.0, 10.0]]],
    ];
    $graph = ['A' => [], 'B' => []];
    avesmapsAddClientCompatibleGraphConnection($graph, 'A', 'B', $strasse);
    avesmapsAddClientCompatibleGraphConnection($graph, 'B', 'A', $strasse);
    return ['graph' => $graph, 'statistics' => []];
};
$anfrage = static fn(string $transport): array => [
    'optimize' => 'fastest',
    'transports' => ['land' => $transport, 'synthetic' => $transport],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true],
];

// ⭐ ERST DIE GEGENPROBE. Ohne sie belegt die Ablehnung unten gar nichts -- eine Vorlage, in der
// ueberhaupt kein Querfeldein-Weg zu finden ist, saehe genauso aus.
$zuFussGraph = $baueGraph();
$zuFuss = avesmapsAttachOffroadPointToGraph(
    $zuFussGraph, $orte, $anfrage('groupFoot'), [], $land, null, 15.0, 16.0, '__offroad_to'
);
assert($zuFuss['ok'] === true, 'die Fussgruppe erreicht den Kartenpunkt: ' . json_encode($zuFuss));

// 🔴 ERZEUGER 3 VON 4 -- der angeklickte Kartenpunkt („Hierher reisen").
$kutschenGraph = $baueGraph();
$kutsche = avesmapsAttachOffroadPointToGraph(
    $kutschenGraph, $orte, $anfrage('horseCarriage'), [], $land, null, 15.0, 16.0, '__offroad_to'
);
assert($kutsche['ok'] === false, 'die Kutsche erreicht keinen freien Kartenpunkt: ' . json_encode($kutsche));
assert(
    $kutsche['error'] === 'offroad_transport_not_allowed',
    'und sagt WARUM -- nicht „kein Weg gefunden", sondern „dieses Reisemittel nicht": ' . $kutsche['error']
);
// 💣 UND ZWAR BEVOR ETWAS AM GRAPHEN PASSIERT. Die Ausstiegssuche TEILT Wege (avesmapsSplit-
// ClientPathAtAnchor); eine Absage nach dem Teilen liesse einen halbierten Weg samt Fusspunkt-
// Knoten in einem Graphen zurueck, der die Kante nie bekommt.
assert(!isset($kutschenGraph['graph']['__offroad_to']), 'der Punkt haengt nicht im Graphen');
assert(array_keys($kutschenGraph['graph']) === ['A', 'B'], 'und kein Weg wurde geteilt: '
    . implode(', ', array_keys($kutschenGraph['graph'])));

// ⚠️ UND AUCH OHNE `synthetic` IN DER ANFRAGE. Der Planer schickt es immer mit (route-engine.js:55
// spiegelt es auf das Landmittel), der stabile Vertrag erlaubt es aber wegzulassen -- dann faellt
// avesmapsResolveClientRouteTransportOption auf `land` zurueck, und die Kutsche kaeme sonst genau
// ueber diese Luecke wieder herein.
// ⚠️ In eine Variable, nicht als Ausdruck: der erste Parameter ist eine Referenz, und PHP meldet
// „Only variables should be passed by reference" -- eine Notice mitten in einem gruenen Testlauf.
$ohneSynthetischGraph = $baueGraph();
$ohneSynthetisch = avesmapsAttachOffroadPointToGraph(
    $ohneSynthetischGraph, $orte,
    ['optimize' => 'fastest', 'transports' => ['land' => 'horseCarriage'],
        'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]],
    [], $land, null, 15.0, 16.0, '__offroad_to'
);
assert($ohneSynthetisch['ok'] === false, 'auch der Rueckfall auf `land` traegt die Kutsche nicht');
assert($ohneSynthetisch['error'] === 'offroad_transport_not_allowed', 'mit demselben Grund: ' . $ohneSynthetisch['error']);

// 🔴 ERZEUGER 4 VON 4 -- die direkte Kante zwischen zwei freien Punkten. Sie traegt ausserdem die
// Sehnen des automatischen Umweg-Ausloesers (detour.php), haengt also an zwei Ausloesern.
$paarGraph = $baueGraph();
$paarZuFuss = avesmapsConnectOffroadPoints(
    $paarGraph, $anfrage('groupFoot'), [], null,
    ['x' => 15.0, 'y' => 16.0], ['x' => 18.0, 'y' => 17.0], '__offroad_from', '__offroad_to'
);
assert($paarZuFuss['ok'] === true, 'zu Fuss entsteht die direkte Kante: ' . json_encode($paarZuFuss));

$paarKutscheGraph = $baueGraph();
$paarKutsche = avesmapsConnectOffroadPoints(
    $paarKutscheGraph, $anfrage('horseCarriage'), [], null,
    ['x' => 15.0, 'y' => 16.0], ['x' => 18.0, 'y' => 17.0], '__offroad_from', '__offroad_to'
);
assert($paarKutsche['ok'] === false, 'die Kutsche bekommt sie nicht: ' . json_encode($paarKutsche));
assert($paarKutsche['error'] === 'offroad_transport_not_allowed', 'mit demselben Grund: ' . $paarKutsche['error']);
assert(!isset($paarKutscheGraph['graph']['__offroad_from']), 'und keine Kante im Graphen');

echo "carriage-offroad-test: all asserts passed\n";

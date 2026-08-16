<?php
// api/_internal/routing/__tests__/detour-chords-test.php
declare(strict_types=1);

/**
 * 🔴 STAND 16.08.2026: DIESE MASCHINERIE IST STILLGELEGT UND WIRD IN DER ANTWORT NICHT MEHR
 * AUFGERUFEN. `AVESMAPS_ROUTE_OFFROAD_DETOUR_ENABLED` steht auf `false`; `response.php` ruft
 * `avesmapsMaybeOfferOffroadDetour` deshalb nicht mehr. Die Tests hier bleiben absichtlich stehen --
 * sie sind die Beschreibung, wie der Auslöser arbeitet, falls er zurückkommt. Wer sie liest, darf
 * daraus NICHT schliessen, dass Sehnen live entstehen. Begründung vollständig im Kopf von
 * `detour.php`.
 */

/**
 * Der Umweg-Auslöser bietet SEHNEN an, nicht nur die eine Kante über die ganze Reise.
 * Entwurf: docs/superpowers/specs/2026-08-14-querfeldein-teilstrecken-design.md
 *
 * 💣 DAS WAR DER FEHLER, DEN DIESE DATEI FESTHÄLT. Bis zum 14.08.2026 hängte der Auslöser genau
 * EINE Kante ein: `$fromNode -> $toNode`. Damit hatte der Dijkstra zwei Angebote -- alles über
 * Wege oder alles querfeldein -- und kein drittes. Salmingen -> Luring lief deshalb vom ersten bis
 * zum letzten Meter querfeldein, obwohl die Reichsstraße 6 das letzte Drittel trägt: 27,5 Meilen
 * quer (Zeit 9,558) schlugen 107,3 Meilen Umweg (10,963). Die Aufteilung „quer bis Spinnried, dann
 * Reichsstraße" hätte 7,448 gekostet -- sie stand dem Dijkstra nur nicht zur Wahl.
 *
 * 🔴 Der Kommentar in detour.php behauptete das Gegenteil („Er darf dabei auch etwas Drittes
 * wählen -- ein Stück Straße, dann quer"). Er DURFTE, aber er KONNTE nicht.
 *
 * ⚠️ NOCH AM SELBEN TAG ÜBERHOLT: Salmingen -> Luring darf seit der Owner-Regel vom 14.08.2026
 * überhaupt nicht mehr quer laufen -- beide Orte hängen am Wegenetz, und dann bleibt die Reise darauf
 * („querfeldein sollen nur orte angefahren werden, die nicht mit dem straßennetz verbunden sind").
 * Die Teilsehnen bleiben trotzdem richtig und nötig: sie tragen jetzt den Fall, für den es
 * Querfeldein gibt -- den Ort OHNE Anschluss am fernen Ende eines Bogens. Die Fixture unten hängt A
 * deshalb an eine Notbrücke statt an eine Straße; alles andere an ihr ist unverändert.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/detour-chords-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../detour.php';

$request = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// ⚠️ Dieselbe Fixture-Regel wie in detour-trigger-test.php: die Straße folgt der TEMPOTABELLE,
// nie einer festen Zahl. Ob eine Sehne gewinnt, entscheidet allein das Verhältnis zwischen
// Straßen- und Querfeldein-Tempo -- und beide liest der Router aus derselben Tabelle.
$roadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];
$offroadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Querfeldein'];
$wayAlong = static function (array &$graph, string $from, string $to, array $points,
                             string $routeType, float $speed): void {
    $length = 0.0;
    for ($i = 1; $i < count($points); $i++) {
        $length += hypot($points[$i][0] - $points[$i - 1][0], $points[$i][1] - $points[$i - 1][1]);
    }
    $connection = [
        'distance' => $length, 'time' => $length / $speed, 'route_type' => $routeType,
        'transport_option' => 'groupFoot', 'id' => 'path-' . $from . $to, 'from' => $from, 'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    // 💣 BEIDE RICHTUNGEN TEILEN EIN OBJEKT, und die Geometrie behält die GESPEICHERTE Orientierung
    // (client-graph.php:411-413). Der erste Punkt einer Etappe ist deshalb NICHT zwangsläufig ihr
    // Startknoten -- wer die Knotenkette aus `coordinates[0]` liest, liest sie irgendwann verkehrt.
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};
$roadAlong = static function (array &$graph, string $from, string $to, array $points)
    use ($wayAlong, $roadSpeed): void {
    $wayAlong($graph, $from, $to, $points, 'Strasse', $roadSpeed);
};
// Die Notbrücke der Komponentenbrücke: der einzige Faden eines Ortes OHNE Anschluss ans Wegenetz.
$bridgeAlong = static function (array &$graph, string $from, string $to, array $points)
    use ($wayAlong, $offroadSpeed): void {
    $wayAlong($graph, $from, $to, $points, AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $offroadSpeed);
};

// ============================================================ Die Karte des Falls
//
//   A(0,0) ~~~ U(50,50) --- B(0,20) --- C(0,30)      (~~~ Notbrücke, --- Straße)
//
// A..B ist der absurde Bogen (129,0 Einheiten für 20 Luftlinie), B..C eine kerzengerade Straße.
// Genau die Form von Salmingen -> [Umweg über Ferdok] -> Spinnried -> Luring.
//
// 🔴 A HÄNGT AN EINER NOTBRÜCKE, NICHT AN EINER STRASSE -- seit dem 14.08.2026 ist das die Bedingung
// dafür, dass hier überhaupt eine Sehne entsteht (Owner-Regel, `detour.php`:
// avesmapsRouteKeepChordsWithOffNetworkEnd). Zwischen zwei angebundenen Orten bleibt die Reise auf
// dem Netz -- das hält Fall C2 in detour-trigger-test.php fest. Der Fall, den die Teilsehnen retten,
// ist damit der ORT OHNE ANSCHLUSS am fernen Ende eines Bogens -- Gulbladdirstadir, nicht Salmingen.
$graph = ['A' => [], 'U' => [], 'B' => [], 'C' => []];
$bridgeAlong($graph, 'A', 'U', [[0.0, 0.0], [50.0, 50.0]]);
$roadAlong($graph, 'U', 'B', [[50.0, 50.0], [0.0, 20.0]]);
$roadAlong($graph, 'B', 'C', [[0.0, 20.0], [0.0, 30.0]]);
$clientGraph = ['graph' => $graph, 'statistics' => []];

$route = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'C', $request);
assert(count($route['segments']) === 3, 'die Graph-Route geht über den Umweg: ' . count($route['segments']));

$report = avesmapsMaybeOfferOffroadDetour($clientGraph, $request, [], null, $route['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 0.0, 'y' => 30.0], 'A', 'C', false);

// ---- 1. Die Knotenkette wird richtig gelesen, trotz geteilter Geometrie -------------------------
assert(isset($report['chord_nodes']), 'der Bericht nennt die Knotenkette der gefundenen Route');
assert($report['chord_nodes'] === ['A', 'U', 'B', 'C'],
    'und zwar in FAHRTRICHTUNG, nicht in Speicherrichtung: ' . implode(',', $report['chord_nodes'] ?? []));

// ---- 2. Die Teilsehne über den Bogen wird angeboten ---------------------------------------------
// 💣 DAS IST DER KERN. A->B ist der Bogen (7,07x), A->C die ganze Reise (5,05x). Beide lösen aus,
// aber nur A->B lässt die Straße B->C stehen.
assert(isset($clientGraph['graph']['A']['B']),
    'die Sehne über den Bogen (A->B) ist als Kante im Graphen -- sie war es vor dem 14.08.2026 nie');
$kanten = array_column($clientGraph['graph']['A']['B'], 'id');
assert(in_array('offroad-detour-0-2', $kanten, true),
    'unter ihrer eigenen Kennung, damit sie neben der Gesamtsehne bestehen kann: ' . implode(',', $kanten));

// ---- 3. Und der Dijkstra wählt sie, statt die ganze Reise quer zu laufen -------------------------
$neu = avesmapsFindClientCompatibleRoute($clientGraph, 'A', 'C', $request);
$typen = array_map(static fn(array $s): string => (string) ($s['route_type'] ?? ''), $neu['segments']);
assert($typen === ['Querfeldein', 'Strasse'],
    'quer über den Bogen, dann auf der Straße weiter: ' . implode(' + ', $typen));
assert($neu['cost'] < $report['graph_cost_units'],
    'und das ist billiger als der reine Netzweg: ' . $neu['cost'] . ' gegen ' . $report['graph_cost_units']);

// ⭐ Die Aufteilung ist auch billiger als die ganze Reise querfeldein. Die fehlende Kante war HIER
// das ganze Problem.
// 🔴 DIESE ZEILE SAGTE BIS ZUM 15.08.2026 „deshalb braucht es KEINEN Zuschlag, der Querfeldein
// künstlich verteuert". Das war für diesen Fall richtig und als allgemeiner Satz falsch: gemessen
// an ?s=DnbLPQq2 schlug eine Querfeldein-Etappe über 103 Meilen die Straße daneben, weil das
// Straßennetz dort 72 % Umweg macht und im Korridor keine Landschaft liegt. Seither gibt es den
// Längenaufschlag (avesmapsOffroadRampFactor). Er ändert an DIESEM Fall nichts -- die Aufteilung
// gewinnt weiterhin --, aber die Vergleichszahl muss ihn tragen, sonst steht links eine Reise MIT
// Aufschlag gegen eine handgerechnete OHNE.
// 💣 UND SEIT DEM 16.08.2026 AUCH DEN GEWICHTSFAKTOR. `$neu['cost']` ist ein Dijkstra-Gewicht, also
// KALENDERzeit (avesmapsTravelValuesWeightFactor); die Handrechnung daneben ist reine Reisezeit.
// Ohne den Faktor steht wieder eine gewichtete Zahl gegen eine ungewichtete -- genau die Falle, die
// der Absatz darueber fuer den Laengenaufschlag schon einmal beschreibt.
$ganzQuer = hypot(0.0 - 0.0, 30.0 - 0.0) / (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Querfeldein']
    * avesmapsOffroadRampFactor(30.0)
    * avesmapsTravelValuesWeightFactor('groupFoot');
assert($neu['cost'] < $ganzQuer,
    'die Aufteilung schlägt die reine Querfeldein-Reise: ' . $neu['cost'] . ' gegen ' . $ganzQuer);

// ---- 4. Der Deckel ------------------------------------------------------------------------------
// 💣 OHNE IHN IST EINE LANGE ROUTE EIN LASTPROBLEM. n Knoten haben n²/2 Sehnen; der Vorfilter ist
// gratis, der A* nicht (p50 14 ms). Auf einem Shared Host ist das die knappe Ressource.
assert(AVESMAPS_ROUTE_OFFROAD_DETOUR_MAX_CHORDS === 3, 'K = 3 (Owner-Entscheid 14.08.2026)');
assert(count($report['chords'] ?? []) <= AVESMAPS_ROUTE_OFFROAD_DETOUR_MAX_CHORDS,
    'nie mehr A*-Läufe als der Deckel erlaubt: ' . count($report['chords'] ?? []));

// ---- 5. Eine gerade Route bekommt KEINE Sehne ----------------------------------------------------
// 💣 DIE GEGENGEFAHR ZU 2. Sehnen dürfen nicht überall auftauchen: eine Route ohne Bogen hat auch
// mit drei Knoten nichts abzukürzen. Bliebe hier eine Querfeldein-Kante im Graphen, gewönne sie bei
// „Kürzeste Route" sogar -- dort entscheidet die DISTANZ, und quer ist immer die kürzere.
$graph2 = ['A' => [], 'B' => [], 'C' => []];
$roadAlong($graph2, 'A', 'B', [[0.0, 0.0], [0.0, 10.0]]);
$roadAlong($graph2, 'B', 'C', [[0.0, 10.0], [0.0, 20.0]]);
$clientGraph2 = ['graph' => $graph2, 'statistics' => []];
$route2 = avesmapsFindClientCompatibleRoute($clientGraph2, 'A', 'C', $request);
$report2 = avesmapsMaybeOfferOffroadDetour($clientGraph2, $request, [], null, $route2['segments'],
    ['x' => 0.0, 'y' => 0.0], ['x' => 0.0, 'y' => 20.0], 'A', 'C', false);
assert($report2['triggered'] === false, 'eine gerade Route löst nichts aus: ' . $report2['ratio']);
assert($report2['offered'] === false, 'und bietet nichts an: ' . $report2['reason']);
assert(($report2['chords'] ?? []) === [], 'kein einziger A*-Lauf');
assert(!isset($clientGraph2['graph']['A']['C']), 'und keine Kante kommt hinzu');

echo "detour-chords-test: alle Zusicherungen erfüllt\n";

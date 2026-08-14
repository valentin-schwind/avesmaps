<?php
// api/_internal/routing/__tests__/anchor-candidates-test.php
declare(strict_types=1);

/**
 * Die Fusspunkt-Kandidaten einer Querfeldein-Anbindung.
 * Entwurf: docs/superpowers/specs/2026-08-14-querfeldein-ausstiegspunkt-design.md
 *
 * 💣 DIE ENTDOPPLUNG IST DER ANGELPUNKT, NICHT EIN DETAIL. Ohne sie liegen die K naechsten
 * Fusspunkte alle auf demselben Weg, ein paar Karteneinheiten auseinander -- K A*-Laeufe fuer
 * praktisch denselben Ausstieg, und die schnelle Strasse zwei Taeler weiter waere nie im Angebot.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';
// ⚠️ avesmapsPrepareRouteAreas() wohnt in land-areas.php, NICHT in water-areas.php (das
// client-graph.php ohnehin zieht). Ohne diese Zeile faellt Abschnitt G mit „undefined function".
require __DIR__ . '/../land-areas.php';

$road = static function (array &$graph, string $from, string $to, array $points, string $id): void {
    $connection = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => $id, 'path_id' => $id, 'from' => $from, 'to' => $to,
        'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
        'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    // 💣 Beide Richtungen teilen EIN Objekt, wie im echten Graphen (client-graph.php:411-413).
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};

// ============================================================ A. ein Kandidat je Weg

// Ein naher Weg mit VIER Segmenten und ein ferner Weg. Ohne Entdopplung fuellen die acht
// Projektionen des nahen Weges (vier Segmente x zwei Richtungen) die Liste, und der ferne Weg
// faellt heraus -- obwohl er die eigentliche Alternative waere.
$graph = [];
$road($graph, 'A', 'B', [[0.0, 0.0], [2.0, 0.0], [4.0, 0.0], [6.0, 0.0], [8.0, 0.0]], 'path-nah');
$road($graph, 'C', 'D', [[0.0, 20.0], [8.0, 20.0]], 'path-fern');

$candidates = avesmapsCollectNearestClientLandPathAnchors($graph, 4.0, 3.0, 6);
$ids = array_map(static fn(array $c): string => (string) $c['connection']['id'], $candidates);
assert(count($candidates) === 2, 'zwei Wege, zwei Kandidaten: ' . count($candidates));
assert($ids === ['path-nah', 'path-fern'],
    'aufsteigend nach Entfernung, jeder Weg einmal: ' . implode(',', $ids));
assert(count(array_unique($ids)) === count($ids), 'kein Weg steht doppelt in der Liste');

// Und der Fusspunkt liegt wirklich auf dem Weg, nicht auf einem seiner Endknoten.
assert(abs($candidates[0]['proj_x'] - 4.0) < 1e-9, 'Fusspunkt x: ' . $candidates[0]['proj_x']);
assert(abs($candidates[0]['proj_y'] - 0.0) < 1e-9, 'Fusspunkt y: ' . $candidates[0]['proj_y']);
assert(abs($candidates[0]['distance'] - 3.0) < 1e-9, 'Entfernung: ' . $candidates[0]['distance']);

// ============================================================ B. der Deckel bleibt ein Deckel

$graph2 = [];
for ($i = 0; $i < 9; $i++) {
    $y = 10.0 + $i;
    $road($graph2, 'S' . $i, 'T' . $i, [[0.0, $y], [8.0, $y]], 'path-' . $i);
}
$limited = avesmapsCollectNearestClientLandPathAnchors($graph2, 4.0, 0.0, 6);
assert(count($limited) === 6, 'nie mehr als der Deckel: ' . count($limited));
$limitedIds = array_map(static fn(array $c): string => (string) $c['connection']['id'], $limited);
assert($limitedIds[0] === 'path-0', 'und der naechste zuerst: ' . $limitedIds[0]);

// ============================================================ C. Nicht-Landwege bleiben draussen

$graph3 = [];
$road($graph3, 'A', 'B', [[0.0, 30.0], [8.0, 30.0]], 'path-land');
$fluss = [
    'route_type' => 'Flussweg', 'id' => 'path-fluss', 'from' => 'E', 'to' => 'F',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 1.0], [8.0, 1.0]]],
];
avesmapsAddClientCompatibleGraphConnection($graph3, 'E', 'F', $fluss);
avesmapsAddClientCompatibleGraphConnection($graph3, 'F', 'E', $fluss);
$dritte = avesmapsCollectNearestClientLandPathAnchors($graph3, 4.0, 0.0, 6);
assert(count($dritte) === 1, 'nur der Landweg zaehlt: ' . count($dritte));
assert((string) $dritte[0]['connection']['id'] === 'path-land', 'und zwar er: ' . $dritte[0]['connection']['id']);

// ============================================================ D. der Fusspunkt teilt den Weg

$graph4 = [];
$road($graph4, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$anker = avesmapsCollectNearestClientLandPathAnchors($graph4, 4.0, 3.0, 6)[0];
$index = avesmapsAllocateClientAnchorIndex($graph4);
assert($index === 0, 'der erste freie Index ist 0: ' . $index);
$knoten = avesmapsSplitClientPathAtAnchor($graph4, $anker, $index);
assert($knoten === '__wp_anchor_0', 'der Knotenname traegt Ziffern, wie das JS ihn liest: ' . $knoten);
assert(isset($graph4['A']['__wp_anchor_0']), 'die erste Haelfte haengt an A');
assert(isset($graph4['__wp_anchor_0']['B']), 'die zweite Haelfte haengt an B');

// 🔴 UND DIE URSPRUNGSKANTE IST WEG. Bliebe sie, saehe der Sammler des naechsten Endpunkts den
// ungeteilten Weg erneut und teilte ihn ein zweites Mal -- zwei Fusspunkte nebeneinander auf
// demselben Weg, ohne Verbindung untereinander.
assert(!isset($graph4['A']['B']), 'A->B ist ersetzt, nicht ergaenzt');
assert(!isset($graph4['B']['A']), 'und zwar in beiden Richtungen');

// ============================================================ E. zwei Anker ergeben eine Kette

$zweiter = avesmapsCollectNearestClientLandPathAnchors($graph4, 8.0, 3.0, 6)[0];
$index2 = avesmapsAllocateClientAnchorIndex($graph4);
assert($index2 === 1, 'der naechste freie Index kommt aus dem Graphen: ' . $index2);
$knoten2 = avesmapsSplitClientPathAtAnchor($graph4, $zweiter, $index2);
assert($knoten2 === '__wp_anchor_1', 'zweiter Knoten: ' . $knoten2);

// 💣 DIE KETTE IST DER GANZE PUNKT. Die beiden Fusspunkte muessen DIREKT aneinander haengen --
// haengen sie stattdessen beide nur an A und B, laeuft die Reise zwischen ihnen ueber den
// gemeinsamen Endknoten zurueck.
assert(isset($graph4['__wp_anchor_0']['__wp_anchor_1']) || isset($graph4['__wp_anchor_1']['__wp_anchor_0']),
    'die beiden Fusspunkte sind direkt verbunden');

// ============================================================ E2. Fusspunkt auf einem Endknoten

// ⚠️ Faellt die Projektion auf einen Endknoten, gibt es nichts zu teilen -- dann muss der Teiler
// DIESEN Knoten liefern und den Graphen in Ruhe lassen. Ohne den Fall entstuende ein Anker-Knoten
// auf demselben Punkt wie eine Ortschaft, mit einer Kante der Laenge null daneben.
$graph4b = [];
$road($graph4b, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$aufKnoten = avesmapsCollectNearestClientLandPathAnchors($graph4b, -3.0, 0.0, 6)[0];
assert(abs((float) $aufKnoten['t']) < 1e-7 && (int) $aufKnoten['segment_index'] === 0,
    'die Projektion liegt auf dem Anfangsknoten: t=' . $aufKnoten['t']);
$knotenName = avesmapsSplitClientPathAtAnchor($graph4b, $aufKnoten, 0);
assert($knotenName === 'A', 'der Endknoten selbst kommt zurueck: ' . $knotenName);
assert(!isset($graph4b['__wp_anchor_0']), 'und es entsteht kein Anker-Knoten');
assert(isset($graph4b['A']['B']), 'die Strasse bleibt ungeteilt');

// ============================================================ F. eine halbe Haelfte teilt nicht

// ⚠️ Ein Anker mit einem Segmentindex hinter dem letzten Segment kann aus dem Sammler nicht kommen;
// die Schutzbedingung im Teiler faengt ihn trotzdem ab. Ohne sie bliebe nach dem Entfernen eine
// LUECKE in der Strasse -- und die sucht niemand.
$graph5 = [];
$road($graph5, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$kaputt = [
    'from' => 'A', 'to' => 'B',
    'connection' => $graph5['A']['B'][0],
    'segment_index' => 5, 't' => 0.5, 'proj_x' => 4.0, 'proj_y' => 0.0, 'distance' => 3.0,
];
avesmapsSplitClientPathAtAnchor($graph5, $kaputt, 0);
assert(isset($graph5['A']['B']), 'ohne zwei vollstaendige Haelften bleibt die Ursprungskante stehen');

// ============================================================ G. mehrere trockene Anker

$graph6 = [];
$road($graph6, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$road($graph6, 'C', 'D', [[0.0, 12.0], [10.0, 12.0]], 'path-zwei');

$trocken = avesmapsFindNearestDryClientLandPathAnchors($graph6, 5.0, 4.0, [], 6);
assert(count($trocken) === 2, 'beide Wege sind trocken erreichbar: ' . count($trocken));
assert((string) $trocken[0]['connection']['id'] === 'path-eins', 'der naechste zuerst');

// Ein Wasserband quer ueber den naechsten Weg: der faellt heraus, der zweite bleibt.
$band = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-5.0, 1.0], [15.0, 1.0], [15.0, 3.0], [-5.0, 3.0], [-5.0, 1.0]]]],
    'min_x' => -5.0, 'min_y' => 1.0, 'max_x' => 15.0, 'max_y' => 3.0,
]]);
$trockenMitSee = avesmapsFindNearestDryClientLandPathAnchors($graph6, 5.0, 4.0, $band, 6);
$idsTrocken = array_map(static fn(array $c): string => (string) $c['connection']['id'], $trockenMitSee);
assert($idsTrocken === ['path-zwei'], 'nur der trocken erreichbare Weg bleibt: ' . implode(',', $idsTrocken));

// Und die Einzahl-Huelle liefert weiterhin genau den ersten davon.
$einzeln = avesmapsFindNearestClientLandPathAnchor($graph6, 5.0, 4.0, $band);
assert(is_array($einzeln) && (string) $einzeln['connection']['id'] === 'path-zwei',
    'die Einzahl-Huelle bleibt, drei Tests haengen an ihr');

echo "OK anchor-candidates-test\n";

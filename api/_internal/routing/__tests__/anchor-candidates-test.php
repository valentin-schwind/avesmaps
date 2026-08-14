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

echo "OK anchor-candidates-test\n";

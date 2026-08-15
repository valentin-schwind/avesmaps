<?php
// api/_internal/routing/__tests__/exit-vertices-test.php
declare(strict_types=1);

/**
 * Ausstiegskandidaten: jeder gezeichnete Vertex eines Wegstuecks PLUS der Fusspunkt.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §3.1
 *
 * 💣 DIE ENTDOPPLUNG JE KANTE BLEIBT DER ANGELPUNKT. Sie ist der Grund, warum sechs
 * VERSCHIEDENE Strassen im Angebot stehen und nicht sechs Punkte auf derselben.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/exit-vertices-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';

$road = static function (array &$graph, string $from, string $to, array $points, string $id): void {
    $connection = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => $id, 'path_id' => $id, 'from' => $from, 'to' => $to,
        'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
        'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};

// ---- A: eine Strasse mit drei inneren Vertices -------------------------------------------
$graph = [];
$road($graph, 'A', 'B', [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0], [16.0, 0.0]], 'weg#0');
$sets = avesmapsCollectClientLandPathExitCandidates($graph, 8.0, 6.0, 6);

assert(count($sets) === 1, 'eine Kante, ein Satz');
$cuts = $sets[0]['cuts'];

// Innere Vertices: (4,0), (8,0), (12,0). Der Fusspunkt liegt auf (8,0) und faellt mit einem
// Vertex zusammen -- er wird nicht doppelt gefuehrt.
$xs = array_map(static fn(array $c): float => round($c['x'], 6), $cuts);
sort($xs);
assert($xs === [4.0, 8.0, 12.0], 'genau die drei inneren Vertices, Fusspunkt entdoppelt: ' . json_encode($xs));

// 🔴 Endpunkte sind KEINE Kandidaten -- das sind bereits Graphknoten.
assert(!in_array(0.0, $xs, true) && !in_array(16.0, $xs, true), 'Endpunkte bleiben draussen');

// ---- B: der Fusspunkt liegt ZWISCHEN zwei Vertices und kommt zusaetzlich ins Angebot ------
$graph2 = [];
$road($graph2, 'A', 'B', [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0]], 'weg#0');
$sets2 = avesmapsCollectClientLandPathExitCandidates($graph2, 6.0, 3.0, 6);
$xs2 = array_map(static fn(array $c): float => round($c['x'], 6), $sets2[0]['cuts']);
sort($xs2);
assert($xs2 === [4.0, 6.0], 'innerer Vertex (4,0) UND Fusspunkt (6,0): ' . json_encode($xs2));

// ---- C: die Entdopplung je Kante bleibt --------------------------------------------------
$graph3 = [];
$road($graph3, 'A', 'B', [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0]], 'weg#0');
$road($graph3, 'C', 'D', [[0.0, 20.0], [4.0, 20.0], [8.0, 20.0]], 'weg#1');
$sets3 = avesmapsCollectClientLandPathExitCandidates($graph3, 4.0, 2.0, 6);
assert(count($sets3) === 2, 'zwei Kanten, zwei Saetze -- nicht ein Satz mit allen Punkten');
$ids = array_map(static fn(array $s): string => (string) $s['anchor']['connection']['id'], $sets3);
assert($ids === ['weg#0', 'weg#1'], 'nach Naehe sortiert, je Kante einer: ' . json_encode($ids));

// ---- D: der Deckel greift und meldet sich ------------------------------------------------
$many = [];
for ($i = 0; $i <= 40; $i++) { $many[] = [(float) $i, 0.0]; }
$graph4 = [];
$road($graph4, 'A', 'B', $many, 'weg#0');
$sets4 = avesmapsCollectClientLandPathExitCandidates($graph4, 20.0, 5.0, 6);
assert(count($sets4[0]['cuts']) === AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT,
    'der Deckel begrenzt auf ' . AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT);
assert($sets4[0]['capped'] > 0, 'und die Kappung wird GEZAEHLT, nicht verschwiegen');
// Die zielnaechsten bleiben: (20,0) liegt genau unter dem Ziel.
$kept = array_map(static fn(array $c): float => $c['x'], $sets4[0]['cuts']);
assert(in_array(20.0, $kept, true), 'der zielnaechste Punkt ueberlebt den Deckel');

fwrite(STDOUT, "exit-vertices-test: OK\n");

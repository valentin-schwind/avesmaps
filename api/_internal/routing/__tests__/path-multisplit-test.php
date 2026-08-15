<?php
// api/_internal/routing/__tests__/path-multisplit-test.php
declare(strict_types=1);

/**
 * Der Mehrpunkt-Teiler: EINE Kante, k Schnitte, EIN Durchgang.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §3.2
 *
 * 💣 WARUM NICHT k-MAL DER EINZELTEILER: avesmapsSplitClientPathAtAnchor entfernt die
 * Ursprungskante, sobald beide Haelften stehen. Der zweite Aufruf faende sie nicht mehr und
 * haengte seinen Punkt ins Leere -- genau die Doppelteilung, die am 14.08.2026 zwei
 * unverbundene Fusspunkte an derselben Strasse erzeugt hat.
 *
 * Aus dem Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/path-multisplit-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';

$makeGraph = static function (array $points): array {
    $graph = [];
    $connection = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => 'weg#0', 'path_id' => 'weg#0', 'from' => 'A', 'to' => 'B',
        'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
        'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    // Beide Richtungen teilen EIN Objekt, wie im echten Graphen (client-graph.php:411-413).
    avesmapsAddClientCompatibleGraphConnection($graph, 'A', 'B', $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, 'B', 'A', $connection);
    return [$graph, $connection];
};

$edgeIds = static function (array $graph, string $from): array {
    $ids = [];
    foreach ($graph[$from] ?? [] as $connections) {
        foreach ($connections as $connection) { $ids[] = (string) $connection['id']; }
    }
    sort($ids);
    return $ids;
};

// ---- A: zwei Schnitte auf einer geraden Kante -------------------------------------------
$points = [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0]];
[$graph, $connection] = $makeGraph($points);
$anchor = ['from' => 'A', 'to' => 'B', 'connection' => $connection];

$cuts = avesmapsSplitClientPathAtPoints($graph, $anchor, [
    ['segment_index' => 1, 't' => 0.0],   // Vertex (4,0)
    ['segment_index' => 2, 't' => 0.0],   // Vertex (8,0)
]);

assert(count($cuts) === 2, 'zwei Schnitte, zwei Knoten');
assert($cuts[0]['name'] !== $cuts[1]['name'], 'jeder Schnitt bekommt einen EIGENEN Knoten');
assert(abs($cuts[0]['x'] - 4.0) < 1e-9 && abs($cuts[0]['y']) < 1e-9, 'Schnitt 0 liegt auf dem Vertex');
assert(abs($cuts[1]['x'] - 8.0) < 1e-9, 'Schnitt 1 liegt auf dem Vertex');

// 🔴 Die Ursprungskante ist WEG, und zwar genau einmal.
$idsFromA = $edgeIds($graph, 'A');
assert(!in_array('weg#0', $idsFromA, true), 'Ursprungskante entfernt');
assert(count($idsFromA) === 1, 'A haengt an genau einem Teilstueck');

// Die drei Teilstuecke haengen IN REIHE: A -> c0 -> c1 -> B, und zurueck.
assert(isset($graph['A'][$cuts[0]['name']]), 'A -> Schnitt 0');
assert(isset($graph[$cuts[0]['name']][$cuts[1]['name']]), 'Schnitt 0 -> Schnitt 1');
assert(isset($graph[$cuts[1]['name']]['B']), 'Schnitt 1 -> B');
assert(isset($graph[$cuts[1]['name']][$cuts[0]['name']]), 'und zurueck');
assert(isset($graph['B'][$cuts[1]['name']]), 'und zurueck bis B');

// Die Laengen summieren sich auf die Ursprungslaenge -- kein Stueck verloren, keins doppelt.
$sum = 0.0;
foreach ([['A', $cuts[0]['name']], [$cuts[0]['name'], $cuts[1]['name']], [$cuts[1]['name'], 'B']] as [$f, $t]) {
    foreach ($graph[$f][$t] as $c) { $sum += (float) $c['distance']; }
}
assert(abs($sum - 12.0) < 1e-6, "Summe der Teilstuecke = 12, gemessen $sum");

// ---- B: ein Schnitt auf einem Endknoten wird NICHT geschnitten ---------------------------
[$graph2, $connection2] = $makeGraph($points);
$anchor2 = ['from' => 'A', 'to' => 'B', 'connection' => $connection2];
$cuts2 = avesmapsSplitClientPathAtPoints($graph2, $anchor2, [
    ['segment_index' => 0, 't' => 0.0],   // == A
    ['segment_index' => 2, 't' => 1.0],   // == B
]);
assert($cuts2[0]['name'] === 'A', 'Anfangsknoten kommt unveraendert zurueck');
assert($cuts2[1]['name'] === 'B', 'Endknoten kommt unveraendert zurueck');
assert(in_array('weg#0', $edgeIds($graph2, 'A'), true), 'ohne echten Schnitt bleibt die Kante stehen');

// ---- C: zwei Schnitte im SELBEN Segment, t neu skaliert ----------------------------------
[$graph3, $connection3] = $makeGraph($points);
$anchor3 = ['from' => 'A', 'to' => 'B', 'connection' => $connection3];
$cuts3 = avesmapsSplitClientPathAtPoints($graph3, $anchor3, [
    ['segment_index' => 0, 't' => 0.25],  // (1,0)
    ['segment_index' => 0, 't' => 0.75],  // (3,0)
]);
assert(abs($cuts3[0]['x'] - 1.0) < 1e-9, 'erster Schnitt bei (1,0)');
assert(abs($cuts3[1]['x'] - 3.0) < 1e-9, 'zweiter Schnitt bei (3,0)');
$sum3 = 0.0;
foreach ([['A', $cuts3[0]['name']], [$cuts3[0]['name'], $cuts3[1]['name']], [$cuts3[1]['name'], 'B']] as [$f, $t]) {
    foreach ($graph3[$f][$t] as $c) { $sum3 += (float) $c['distance']; }
}
assert(abs($sum3 - 12.0) < 1e-6, "auch bei zwei Schnitten im selben Segment: Summe 12, gemessen $sum3");

// ---- D: unsortierte Eingabe wird sortiert verarbeitet, Rueckgabe bleibt in Eingabefolge ---
[$graph4, $connection4] = $makeGraph($points);
$anchor4 = ['from' => 'A', 'to' => 'B', 'connection' => $connection4];
$cuts4 = avesmapsSplitClientPathAtPoints($graph4, $anchor4, [
    ['segment_index' => 2, 't' => 0.0],
    ['segment_index' => 1, 't' => 0.0],
]);
assert(abs($cuts4[0]['x'] - 8.0) < 1e-9, 'Rueckgabe folgt der EINGABE, nicht der Sortierung');
assert(abs($cuts4[1]['x'] - 4.0) < 1e-9, 'Rueckgabe folgt der EINGABE, nicht der Sortierung');
assert(isset($graph4[$cuts4[1]['name']][$cuts4[0]['name']]), 'im Graphen stehen sie trotzdem in Reihe');

fwrite(STDOUT, "path-multisplit-test: OK\n");

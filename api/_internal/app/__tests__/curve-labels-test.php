<?php

declare(strict_types=1);

/**
 * Test des Kurvenverfahrens (docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §3).
 * Keine DB, kein HTTP. Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/curve-labels-test.php
 * Exit 0 = alle Zusicherungen halten.
 */

require_once __DIR__ . '/../curve-labels.php';

// ---------------------------------------------------------------- GRUNDLAGEN ---

// Flaeche eines Einheitsquadrats, gegen den Uhrzeigersinn positiv.
$quadrat = [[0.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0], [0.0, 0.0]];
assert(abs(avesmapsCurveRingArea($quadrat) - 12.0) < 1e-9);

// Punkt-in-Polygon, mit Loch: die Mitte des Lochs liegt DRAUSSEN.
$mitLoch = [
    [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
    [[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0], [4.0, 4.0]],
];
assert(avesmapsCurvePointInPolygon([1.0, 1.0], $mitLoch) === true);
assert(avesmapsCurvePointInPolygon([5.0, 5.0], $mitLoch) === false);
assert(avesmapsCurvePointInPolygon([-1.0, 5.0], $mitLoch) === false);

// Segmentieren: eine Kante der Laenge 4 bei Abstand 1 bekommt Zwischenpunkte, und der Ring bleibt
// in seiner Reihenfolge. Rueckgabe ist OFFEN (ohne Schlusspunkt), wie der Prototyp.
$dicht = avesmapsCurveDensifyRing($quadrat, 1.0);
assert(count($dicht) > 4);
assert($dicht[0] === [0.0, 0.0]);
foreach ($dicht as $p) {
    assert(avesmapsCurvePointInPolygon([$p[0] * 0.999 + 2.0 * 0.001, $p[1] * 0.999 + 1.5 * 0.001], [$quadrat]) === true);
}

// Vereinfachen: ein Ring mit einem Punkt exakt auf einer Geraden verliert ihn.
$mitZwischenpunkt = [[0.0, 0.0], [2.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0], [0.0, 0.0]];
$einfach = avesmapsCurveSimplifyRing($mitZwischenpunkt, 0.1);
assert(count($einfach) < count($mitZwischenpunkt));
assert(abs(abs(avesmapsCurveRingArea($einfach)) - 12.0) < 1e-6);

// 💣 Ein zu kurzer Ring wird UNVERAENDERT zurueckgegeben, nicht zu Unsinn vereinfacht.
$dreieck = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 0.0]];
assert(avesmapsCurveSimplifyRing($dreieck, 5.0) === $dreieck);

// ---------------------------------------------------------------- DELAUNAY ---

// 💣 Die Kontrollprobe, die den Bau ueberhaupt erst vertrauenswuerdig macht: fuer Punkte in
// KONVEXER Lage muss eine Delaunay-Triangulierung genau n-2 Dreiecke liefern, und ihre Flaechen
// muessen zusammen die Polygonflaeche ergeben. Faellt eine der beiden Zahlen, ist die
// Triangulierung kaputt -- und alles danach rechnet auf Sand weiter.
$n = 40;
$kreis = [];
for ($i = 0; $i < $n; $i++) {
    $w = 2 * M_PI * $i / $n;
    $kreis[] = [600.0 + (40.0 * cos($w)), 600.0 + (25.0 * sin($w))];
}
$tris = avesmapsCurveDelaunay($kreis);
assert(count($tris) === $n - 2);

$flaeche = 0.0;
foreach ($tris as [$a, $b, $c]) {
    $flaeche += abs(
        (($kreis[$b][0] - $kreis[$a][0]) * ($kreis[$c][1] - $kreis[$a][1]))
        - (($kreis[$c][0] - $kreis[$a][0]) * ($kreis[$b][1] - $kreis[$a][1]))
    ) / 2.0;
}
$ring = $kreis;
$ring[] = $kreis[0];
assert(abs($flaeche - abs(avesmapsCurveRingArea($ring))) < 1e-6);

// Kein Dreieck doppelt.
$schluessel = [];
foreach ($tris as $t) {
    $s = $t;
    sort($s);
    $k = implode(',', $s);
    assert(!isset($schluessel[$k]));
    $schluessel[$k] = true;
}

// Zu wenige Punkte ergeben kein Dreieck, nicht einen Fehler.
assert(avesmapsCurveDelaunay([[0.0, 0.0], [1.0, 0.0]]) === []);

echo "curve-labels: Grundlagen ok\n";

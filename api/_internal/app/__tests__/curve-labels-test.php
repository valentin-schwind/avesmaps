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

echo "curve-labels: Grundlagen ok\n";

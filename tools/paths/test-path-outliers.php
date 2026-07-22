<?php

declare(strict_types=1);

/**
 * Tests for the geometric outlier detector (api/_internal/wiki/path-outliers.php).
 *
 * A wiki way's segments should form ONE connected chain. A segment sitting in a separate,
 * distant cluster was assigned to the wrong way -- that is Bug #39 (an "Eisenstraße" segment
 * on the beach near Qinsay, 334 map units off its corridor).
 *
 * The detector deliberately knows NOTHING about the wiki course: it works on geometry alone,
 * so it also covers the ~354 ways that never produce a verlauf case, and it does NOT mistake a
 * road's own continuation for an error (measured 2026-07-22: "Alle unstrittigen übernehmen"
 * would have cut 17 contiguous Lettastieg segments precisely because the course-based diff
 * cannot tell an extension from a stray).
 *
 * Run:
 *     php tools/paths/test-path-outliers.php
 */

require __DIR__ . '/../../api/_internal/wiki/path-outliers.php';

$failures = 0;
$total = 0;
function check(string $label, $actual, $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL  {$label}\n      actual:   " . var_export($actual, true) . "\n      expected: " . var_export($expected, true) . "\n";
    } else {
        echo "ok    {$label}\n";
    }
}

// Helper: a straight segment from (x1,y1) to (x2,y2).
$seg = static fn(string $id, float $x1, float $y1, float $x2, float $y2): array
    => ['public_id' => $id, 'name' => $id, 'source' => 'verlauf-sync', 'points' => [[$x1, $y1], [$x2, $y2]]];

// --- One connected chain => no outliers (the Lettastieg shape: a road plus its own tail) ---

$chain = [
    $seg('a', 0, 0, 10, 0),
    $seg('b', 10, 0, 20, 0),
    $seg('c', 20, 0, 30, 0),
];
$r = avesmapsWikiPathOutlierAnalyseWay($chain);
check('connected chain is one component', count($r['components']), 1);
check('connected chain has no outliers', $r['outlier_count'], 0);
check('connected chain reports no distance', $r['max_distance'], null);

// --- A far stray => its own component, distance measured (the Weg-5099 shape) ---

$withStray = $chain;
$withStray[] = $seg('x', 300, 100, 305, 100);
$r = avesmapsWikiPathOutlierAnalyseWay($withStray);
check('stray splits into two components', count($r['components']), 2);
check('main component keeps the three chain segments', $r['components'][0]['segments'], ['a', 'b', 'c']);
check('stray is the detached one', $r['components'][1]['segments'], ['x']);
check('one segment flagged', $r['outlier_count'], 1);
// Nearest pair: chain end (30,0) to stray start (300,100) => hypot(270,100).
check('distance is measured to the main cluster', round($r['components'][1]['distance'], 2), round(hypot(270.0, 100.0), 2));
check('max distance surfaces for ranking', round($r['max_distance'], 2), round(hypot(270.0, 100.0), 2));

// --- A hairline gap must NOT read as a stray: it stays a separate component but ranks last ---

$hairline = [$seg('a', 0, 0, 10, 0), $seg('b', 10.3, 0, 20, 0)];
$r = avesmapsWikiPathOutlierAnalyseWay($hairline);
check('hairline gap is detected', count($r['components']), 2);
check('hairline distance is small enough to sink in the ranking', round($r['max_distance'], 2), 0.3);

// --- Degenerate inputs never throw and never accuse ---

check('single segment has no outliers', avesmapsWikiPathOutlierAnalyseWay([$seg('a', 0, 0, 1, 1)])['outlier_count'], 0);
check('no segments yields no components', avesmapsWikiPathOutlierAnalyseWay([])['components'], []);
check('segment without geometry is not flagged', avesmapsWikiPathOutlierAnalyseWay([
    ['public_id' => 'a', 'name' => 'a', 'source' => 'editor', 'points' => []],
])['outlier_count'], 0);

// --- Ranking: the biggest cluster wins, ties do not silently accuse half the way ---

$twoEqual = [
    $seg('a', 0, 0, 10, 0),
    $seg('b', 10, 0, 20, 0),
    $seg('y', 100, 0, 110, 0),
    $seg('z', 110, 0, 120, 0),
];
$r = avesmapsWikiPathOutlierAnalyseWay($twoEqual);
check('even split still reports both clusters', count($r['components']), 2);
check('even split is marked ambiguous', $r['ambiguous'], true);
check('lopsided split is not ambiguous', avesmapsWikiPathOutlierAnalyseWay($withStray)['ambiguous'], false);

echo $failures === 0 ? "\n{$total}/{$total} checks passed\n" : "\n{$failures} of {$total} checks FAILED\n";
exit($failures === 0 ? 0 : 1);

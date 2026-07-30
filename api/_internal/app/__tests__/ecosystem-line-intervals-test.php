<?php
// api/_internal/app/__tests__/ecosystem-line-intervals-test.php
declare(strict_types=1);

/**
 * Parity test for the V13 PHP twin of the V9 line/area core
 * (api/_internal/app/ecosystem-line-intervals.php).
 *
 * 💣 THE POINT OF THIS FILE: the rule is owned by the JS original
 * (js/map-features/map-features-ecosystem-path-assign.js, shipped with V9). The PHP twin exists only
 * because the routing endpoint cannot call JavaScript -- it is a port, not a second design. Two
 * runtimes unavoidably mean two implementations, and the ONE thing that keeps them a single rule is
 * the shared corpus below: js/map-features/__tests__/ecosystem-line-intervals-fixture.json, read by
 * this test AND by the original's own test. Drift shows up here, not in production.
 *
 * Same figure as the duplicate location-name corpus (api/_internal/map/__tests__ +
 * js/routing/__tests__), and for the same reason.
 *
 * Pure: no DB, no HTTP. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/ecosystem-line-intervals-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../ecosystem-line-intervals.php';

// The fixture lives with the original, not with the twin: whoever owns the rule owns the corpus.
$fixturePath = __DIR__ . '/../../../../js/map-features/__tests__/ecosystem-line-intervals-fixture.json';
$fixture = json_decode((string) file_get_contents($fixturePath), true, 512, JSON_THROW_ON_ERROR);

$near = static fn(float $a, float $b): bool => abs($a - $b) < 1e-9;

// --- the epsilon is part of the rule, not a local taste ------------------------------------------
assert(AVESMAPS_ECOSYSTEM_INTERVAL_EPSILON === 1e-9,
    'the twin must drop the same grazing intervals as the original (ECOSYSTEM_INTERVAL_EPSILON)');

// --- edge extraction: a hole is not a special case, a MultiPolygon contributes every part ---------
$edges = [];
foreach ($fixture['areas'] as $key => $geometry) {
    $edges[$key] = avesmapsEcosystemAreaEdges($geometry);
}
assert(count($edges['square']) === 4, 'four edges -- the closing point is not a fifth');
assert(count($edges['woodWithClearing']) === 8, 'outer ring and hole together');
assert(count($edges['twoSquares']) === 8, 'both parts of a MultiPolygon');
assert($edges['notAnArea'] === [], 'a Point is not an area and yields no edges, not an error');

// --- the ray cast, including „a hole is outside" --------------------------------------------------
assert(avesmapsEcosystemPointInEdges(50.0, 50.0, $edges['square']) === true, 'middle of the square');
assert(avesmapsEcosystemPointInEdges(150.0, 50.0, $edges['square']) === false, 'right of the square');
assert(avesmapsEcosystemPointInEdges(-50.0, 50.0, $edges['square']) === false, 'left of the square');
assert(avesmapsEcosystemPointInEdges(50.0, 50.0, $edges['woodWithClearing']) === false,
    'the clearing is a hole, and a hole is outside');

// --- the shared corpus, case by case -------------------------------------------------------------
$caseCount = 0;
foreach ($fixture['cases'] as $case) {
    $name = (string) $case['name'];
    $actual = avesmapsEcosystemLineIntervals($case['line'], $edges[$case['area']]);
    assert(count($actual) === count($case['intervals']),
        sprintf('Fixture "%s": expected %d interval(s), got %d', $name, count($case['intervals']), count($actual)));
    foreach ($case['intervals'] as $index => [$enter, $exit]) {
        assert($near((float) $actual[$index]['enter'], (float) $enter),
            sprintf('Fixture "%s" interval %d enter: expected %s, got %s', $name, $index, $enter, $actual[$index]['enter']));
        assert($near((float) $actual[$index]['exit'], (float) $exit),
            sprintf('Fixture "%s" interval %d exit: expected %s, got %s', $name, $index, $exit, $actual[$index]['exit']));
    }
    $caseCount++;
}
assert($caseCount >= 18, 'the corpus must not silently shrink -- got only ' . $caseCount . ' cases');

// --- an area with no edges at all is skipped, not an error ---------------------------------------
assert(avesmapsEcosystemLineIntervals([[-10.0, 50.0], [110.0, 50.0]], []) === [],
    'an area without edges is skipped');

printf("ecosystem-line-intervals: alle Pruefungen bestanden, davon %d aus der geteilten Fixture\n", $caseCount);

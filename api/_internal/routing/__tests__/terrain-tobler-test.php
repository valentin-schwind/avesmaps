<?php
// api/_internal/routing/__tests__/terrain-tobler-test.php
declare(strict_types=1);

/**
 * Unit tests for Tobler's hiking function as the V11 slope factor
 * (api/_internal/routing/terrain-factor.php).
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-tobler-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-factor.php';

$close = static fn (float $a, float $b, float $tolerance = 1e-9): bool => abs($a - $b) <= $tolerance;

// --- the anchors of the published function ------------------------------------------------------
// W = 6 * exp(-3.5 * |S + 0.05|). Level walking is NOT the maximum -- a 5 % descent is.
assert($close(avesmapsTerrainToblerSpeed(0.0), 6.0 * exp(-0.175)), 'level speed is 6*e^-0.175 km/h');
assert($close(avesmapsTerrainToblerSpeed(-0.05), 6.0), 'the fastest walking is a 5 % descent, at the full 6 km/h');
assert(avesmapsTerrainToblerSpeed(-0.05) > avesmapsTerrainToblerSpeed(0.0),
    'a gentle descent must be faster than the level -- that is the whole point of the offset');

// --- the factor is the ratio, and the exp form must equal it exactly ----------------------------
foreach ([-0.4, -0.25, -0.1, -0.05, 0.0, 0.1, 0.2, 0.35, 0.6] as $slope) {
    $ratio = avesmapsTerrainToblerSpeed(0.0) / avesmapsTerrainToblerSpeed($slope);
    assert($close(avesmapsTerrainToblerFactor($slope), $ratio, 1e-12),
        'the collapsed exp form must equal W(0)/W(S) at every slope');
}
assert($close(avesmapsTerrainToblerFactor(0.0), 1.0), 'level ground is exactly 1.0');

// 🔴 THE NUMBERS THE DECISION WAS MADE ON. If these move, the model moved.
assert($close(avesmapsTerrainToblerFactor(0.10), 1.4191, 1e-4), '10 % uphill costs 1,42x');
assert($close(avesmapsTerrainToblerFactor(0.20), 2.0138, 1e-4), '20 % uphill costs 2,01x');
assert($close(avesmapsTerrainToblerFactor(-0.05), 0.8395, 1e-4), 'the optimum descent is 0,84x');
assert($close(avesmapsTerrainToblerFactor(-0.25), 1.6905, 1e-4), 'a 25 % descent COSTS time: 1,69x');

// --- 💣 THE SIGN FIX: this is what the old curve got wrong -------------------------------------
// The old curve handed out a bonus down to a 25 % descent and only braked past 50 %.
assert(avesmapsTerrainToblerFactor(-0.25) > 1.0,
    'a 25 % descent must COST time under Tobler -- the old curve gave it a 19 % discount');
assert(avesmapsTerrainToblerFactor(-0.10) > avesmapsTerrainToblerFactor(-0.05),
    'past the optimum a steeper descent must cost MORE, not less');
assert($close(avesmapsTerrainToblerFactor(-0.10), 1.0, 1e-9),
    'by a 10 % descent the bonus is exactly spent -- back to level speed');

// --- integration over samples -------------------------------------------------------------------
// Level ground: every step flat -> exactly 1.0, and that exactness is what makes „switch off"
// bit-identical possible.
assert($close(avesmapsTerrainToblerFactorForSamples([100.0, 100.0, 100.0], 0.25), 1.0),
    'flat samples integrate to exactly 1.0');

// One constant slope must reproduce the closed form. 0,25 units = 750 Schritt, so +75 Schritt per
// step is a 10 % gradient.
assert($close(avesmapsTerrainToblerFactorForSamples([0.0, 75.0, 150.0], 0.25), avesmapsTerrainToblerFactor(0.10), 1e-12),
    'a constant slope must integrate to its own closed-form factor');

// 💣 CONVEXITY: up-then-down is NOT level. This is the pooling bug the old curve had.
$upDown = avesmapsTerrainToblerFactorForSamples([0.0, 150.0, 0.0], 0.25);
assert($upDown > 1.0, 'climbing 150 and falling 150 must cost MORE than level ground, never the same');
$old = avesmapsTerrainTimeFactor(150.0, 150.0, 0.5);
assert($upDown > $old,
    'and it must cost more than the old curve charged -- there the descent paid off part of the climb');

// Direction matters: the same hill walked the other way is a different number.
$climb = avesmapsTerrainToblerFactorForSamples([0.0, 100.0, 200.0], 0.25);
$fall = avesmapsTerrainToblerFactorForSamples([200.0, 100.0, 0.0], 0.25);
assert(!$close($climb, $fall), 'uphill and downhill must differ -- Tobler is not symmetric');
assert($climb > $fall, 'the climb is the expensive direction');

// --- gaps break the chain, they do not bridge it -------------------------------------------------
// Without the rule, 0 and 3000 either side of a hole would read as one enormous constant slope.
$withGap = avesmapsTerrainToblerFactorForSamples([0.0, null, 3000.0], 0.25);
assert($withGap === null, 'two covered samples with a hole between them carry no usable pair');
$partial = avesmapsTerrainToblerFactorForSamples([0.0, 75.0, null, 500.0, 575.0], 0.25);
assert($close((float) $partial, avesmapsTerrainToblerFactor(0.10), 1e-12),
    'only the covered neighbouring pairs count, and they average to their own slope');

// No coverage at all is „no data", never 1.0 -- the distinction the whole feature rests on.
assert(avesmapsTerrainToblerFactorForSamples([null, null], 0.25) === null, 'no coverage means null');
assert(avesmapsTerrainToblerFactorForSamples([100.0], 0.25) === null, 'a single sample is no pair');
assert(avesmapsTerrainToblerFactorForSamples([0.0, 75.0], 0.0) === null, 'a zero step is refused, not divided by');

// --- composability: an edge of several pieces is the length-weighted mean ------------------------
// This is what lets the profile run store one factor per piece and the router combine them.
$pieceA = avesmapsTerrainToblerFactorForSamples([0.0, 75.0, 150.0], 0.25);   // 0,5 units, 10 % up
$pieceB = avesmapsTerrainToblerFactorForSamples([150.0, 150.0], 0.25);        // 0,25 units, flat
$combined = avesmapsTerrainToblerFactorForSamples([0.0, 75.0, 150.0, 150.0], 0.25);
$weighted = ($pieceA * 0.5 + $pieceB * 0.25) / 0.75;
assert($close((float) $combined, $weighted, 1e-12),
    'the integral over two pieces must equal their length-weighted mean -- otherwise a stored per-piece factor cannot be combined');

echo "terrain-tobler-test: all asserts passed\n";

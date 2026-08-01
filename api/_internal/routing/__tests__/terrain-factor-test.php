<?php
// api/_internal/routing/__tests__/terrain-factor-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 slope model: the LEISTUNGSKILOMETER. NOT DIN 33466 -- see the note atop terrain-factor.php.
 * api/_internal/routing/terrain-factor.php
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-factor.php';

$close = static fn (float $a, float $b, float $tolerance = 1e-9): bool => abs($a - $b) <= $tolerance;
// One Meile expressed in map units -- the conversion the whole model hangs on.
$meile = 1.0 / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;

// --- 💣 THE UNIT CHAIN, because getting it wrong shipped a wrong text in public on 2026-07-30 -----
// 1 Schritt = 1 m, 1 Meile = 1.000 Schritt = 1 km, 1 map unit = 3 Meilen. So the DIN constants ARE the
// aventurian ones and 100 Schritt of climb over ONE Meile is exactly one extra Leistungsmeile.
assert($close(AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT, 3.0), 'one map unit is three Meilen (DISTANCE_SCALING_FACTOR)');
assert($close(AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE, 3000.0), 'and therefore 3.000 Schritt');
assert($close(avesmapsTerrainLeistungsFactor(100.0, 0.0, $meile), 2.0),
    '100 Schritt of climb over one Meile doubles the time -- one Meile plus one Leistungsmeile');

// --- the anchors the infobox text quotes. If these move, the text is wrong. ----------------------
assert($close(avesmapsTerrainLeistungsFactor(50.0, 0.0, $meile), 1.5), '5 % uphill: half again as long');
assert($close(avesmapsTerrainLeistungsFactor(200.0, 0.0, $meile), 3.0), '20 % uphill: three times');
assert($close(avesmapsTerrainLeistungsFactor(300.0, 0.0, $meile), 4.0), '30 % uphill: exactly the ceiling');

// --- level, missing and degenerate all answer EXACTLY 1.0 ----------------------------------------
// That exactness is what makes „terrain off" bit-identical with the pre-V11 numbers.
assert(avesmapsTerrainLeistungsFactor(0.0, 0.0, 5.0) === 1.0, 'measured level ground is exactly 1.0');
assert(avesmapsTerrainLeistungsFactor(null, 0.0, 5.0) === 1.0, 'no ascent data is 1.0, not an error');
assert(avesmapsTerrainLeistungsFactor(0.0, null, 5.0) === 1.0, 'no steep-descent data is 1.0');
assert(avesmapsTerrainLeistungsFactor(100.0, 0.0, 0.0) === 1.0, 'a degenerate distance is 1.0, never a division');
assert(avesmapsTerrainLeistungsFactor(-500.0, -500.0, $meile) === 1.0,
    'negative sums cannot buy time -- they are clamped away, not trusted');

// --- 🔴 NOTHING IS EVER FASTER THAN THE LEVEL. This is the whole point of the model change. -------
// The old curve gave a descent a bonus down to 25 % and only braked past 50 %; a DSA player took that
// apart in public and was right. Here a gentle descent is FREE and a steep one COSTS.
foreach ([0.0, 1.0, 50.0, 500.0, 5000.0] as $ascent) {
    foreach ([0.0, 1.0, 50.0, 500.0, 5000.0] as $steepDescent) {
        $factor = avesmapsTerrainLeistungsFactor($ascent, $steepDescent, $meile);
        assert($factor >= 1.0, 'no combination of climb and steep descent may fall below 1.0');
    }
}

// A gentle descent reaches the model as a ZERO steep sum, so it is free -- neither penalty nor bonus.
assert(avesmapsTerrainLeistungsFactor(0.0, 0.0, $meile) === 1.0, 'a gentle descent costs nothing');
// A steep one costs: 150 Schritt on steep ground is one extra Leistungsmeile.
assert($close(avesmapsTerrainLeistungsFactor(0.0, 150.0, $meile), 2.0),
    '150 Schritt of STEEP descent over one Meile is one extra Leistungsmeile');
// 💣 And the two rates differ on purpose: climbing is harder than dropping. Same Schritt, more time.
assert(avesmapsTerrainLeistungsFactor(150.0, 0.0, $meile) > avesmapsTerrainLeistungsFactor(0.0, 150.0, $meile),
    'the same Schritt cost more climbed than dropped -- 100 against 150');

// --- the ceiling, which under THIS model finally does something ----------------------------------
assert($close(avesmapsTerrainLeistungsFactor(100000.0, 100000.0, $meile), AVESMAPS_TERRAIN_FACTOR_MAX),
    'an absurd sum is capped, not passed through');
assert($close(AVESMAPS_TERRAIN_FACTOR_MAX, 4.0), 'the ceiling is 4,0 (owner, 2026-07-30)');
// 🔴 There is no floor constant any more, and that is deliberate: the model cannot go below 1,0.
assert(!defined('AVESMAPS_TERRAIN_FACTOR_MIN'),
    'the floor was removed with the old curve -- a floor here would be meaningless, not merely dead');

// --- additivity: what lets the profile run store per-piece sums and the router add them ----------
$whole = avesmapsTerrainLeistungsFactor(900.0, 0.0, 3.0 * $meile);
$partA = avesmapsTerrainLeistungsFactor(300.0, 0.0, 1.0 * $meile);
$partB = avesmapsTerrainLeistungsFactor(600.0, 0.0, 2.0 * $meile);
$weighted = ($partA * 1.0 + $partB * 2.0) / 3.0;
assert($close($whole, $weighted, 1e-12),
    'the factor of the sum must equal the length-weighted mean of the parts -- otherwise stored per-piece '
    . 'sums cannot be combined into an edge');

// --- the 20 % threshold, decided per sample ------------------------------------------------------
// A 0,25-unit step is 750 Schritt of ground, so 150 Schritt of drop is exactly 20 %.
assert(!avesmapsTerrainDescentIsSteep(150.0, 0.25), 'exactly 20 % is NOT steep -- the rule says above');
assert(avesmapsTerrainDescentIsSteep(150.1, 0.25), 'just past 20 % is steep');
assert(!avesmapsTerrainDescentIsSteep(149.9, 0.25), 'just under 20 % is not');
assert(!avesmapsTerrainDescentIsSteep(0.0, 0.25), 'level ground is not a steep descent');
assert(!avesmapsTerrainDescentIsSteep(-300.0, 0.25), 'a CLIMB is not a steep descent, whatever its size');
assert(!avesmapsTerrainDescentIsSteep(300.0, 0.0), 'a zero step is refused, not divided by');
// The threshold scales with the step, not with a fixed Schritt count.
assert(avesmapsTerrainDescentIsSteep(160.0, 0.25) && !avesmapsTerrainDescentIsSteep(160.0, 0.5),
    'the same drop is steep over a short step and gentle over a long one');

// --- avesmapsTerrainHasData still separates „nothing known" from „measured level" -----------------
assert(avesmapsTerrainHasData(0.0, 0.0), 'a measured level way HAS data');
assert(!avesmapsTerrainHasData(null, 0.0) && !avesmapsTerrainHasData(0.0, null), 'a null means no data');

echo "terrain-factor-test: all asserts passed\n";

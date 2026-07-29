<?php
// api/_internal/routing/__tests__/terrain-factor-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 slope factor (api/_internal/routing/terrain-factor.php).
 *
 * Pure: no DB, no HTTP, no blob. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-factor.php';

$near = static fn(float $a, float $b): bool => abs($a - $b) < 1e-9;

// --- flat ground is EXACTLY 1.0, and that is what makes „switch off" bit-identical -------------
assert(avesmapsTerrainTimeFactor(0.0, 0.0, 10.0) === 1.0, 'level ground must be exactly 1.0');

// --- no data is 1.0 too, but distinguishable ----------------------------------------------------
assert(avesmapsTerrainTimeFactor(null, null, 10.0) === 1.0, 'unknown terrain must not change the time');
assert(avesmapsTerrainHasData(null, null) === false, 'null must be readable as „unknown"');
assert(avesmapsTerrainHasData(0.0, 0.0) === true, 'measured level ground is DATA, not absence');
assert(avesmapsTerrainHasData(null, 12.0) === false, 'half a pair is not data');

// --- a degenerate distance cannot divide -------------------------------------------------------
assert(avesmapsTerrainTimeFactor(3000.0, 0.0, 0.0) === 1.0, 'zero distance must not divide');
assert(avesmapsTerrainTimeFactor(3000.0, 0.0, -1.0) === 1.0, 'negative distance must not divide');

// --- climbing costs; the anchor is the published table (Gebirgspass 1,5 vs Strasse 4,0 = 2,67x) --
// 3.000 Schritt of ascent over 3 map units = gradient 1/3 -> 1 + 5,0 * 0,3333 = 2,667
$pass = avesmapsTerrainTimeFactor(3000.0, 0.0, 3.0);
assert($pass > 2.6 && $pass < 2.75, 'a typical mountain leg must land near the published 2,67x, got ' . $pass);

// --- gentle descent is FASTER, not merely „not slower" (owner decision 3) ----------------------
$gentle = avesmapsTerrainTimeFactor(0.0, 300.0, 1.0);      // gradient 0,1 downhill
assert($gentle < 1.0, 'a gentle descent must be faster than level, got ' . $gentle);

// --- very steep descent is slower again than a gentle one --------------------------------------
$steep = avesmapsTerrainTimeFactor(0.0, 3000.0, 1.0);      // gradient 1,0 downhill
assert($steep > $gentle, 'a very steep descent must be slower than a gentle one');

// --- the clamp, in both directions -------------------------------------------------------------
$absurdUp = avesmapsTerrainTimeFactor(300000.0, 0.0, 1.0);
assert($near($absurdUp, AVESMAPS_TERRAIN_FACTOR_MAX), 'an absurd ascent must clamp at the ceiling');
assert(AVESMAPS_TERRAIN_FACTOR_MIN === 0.5 && AVESMAPS_TERRAIN_FACTOR_MAX === 4.0,
    'the clamp is [0,5 ... 4,0] -- 💣 NOT the river clamp [1,0 ... 3,0], which would silently undo owner decision 3');
foreach ([[0.0, 0.0], [9000.0, 0.0], [0.0, 9000.0], [4000.0, 4000.0]] as [$up, $down]) {
    $factor = avesmapsTerrainTimeFactor($up, $down, 1.0);
    assert($factor >= AVESMAPS_TERRAIN_FACTOR_MIN && $factor <= AVESMAPS_TERRAIN_FACTOR_MAX,
        'the factor must never leave the clamp');
}

// --- ascent and descent both act; a leg that climbs AND falls is not the same as either alone ---
// 🪤 The descent value matters here. The curve's downhill part is `-BONUS*d + PENALTY*d^2`, which
// is zero at BOTH d = 0 and d = BONUS/PENALTY = 0,5 -- so a leg falling at gradient 0,5 gives
// EXACTLY nothing back, and testing at that point would assert nothing while looking like it did.
// 750 Schritt over one map unit is d = 0,25, the point of maximum bonus.
$both = avesmapsTerrainTimeFactor(1500.0, 750.0, 1.0);
$upOnly = avesmapsTerrainTimeFactor(1500.0, 0.0, 1.0);
assert($both < $upOnly, 'the descent half of a leg must give some of the climb back');

// The neutral point itself, pinned deliberately rather than stumbled into: at a downhill gradient
// of BONUS/PENALTY the bonus and the brake cancel, and descending that steeply costs exactly what
// level ground costs. Whoever retunes the constants in task 11 will move this point; the assertion
// is written against the constants, not against a hard-coded 0,5, so it follows them.
$neutralDescent = (AVESMAPS_TERRAIN_DOWN_BONUS / AVESMAPS_TERRAIN_DOWN_PENALTY)
    * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE;
assert($near(avesmapsTerrainTimeFactor(0.0, $neutralDescent, 1.0), 1.0),
    'at gradient BONUS/PENALTY downhill the bonus and the brake cancel exactly');

// --- the unit conversion is the documented one --------------------------------------------------
// 3.000 Schritt over 1 map unit is gradient 1,0; over 3 map units it is 1/3. Use 3 map units to stay
// within the clamp (6,0 would exceed MAX of 4,0). The ratio proves the conversion: factor increases by 5,0
// per unit gradient, so over 3 units (gradient 1/3) it increases by 5,0/3 ≈ 1,667, giving ≈ 2,667.
assert($near(
    avesmapsTerrainTimeFactor(3000.0, 0.0, 3.0),
    1.0 + AVESMAPS_TERRAIN_UP_PENALTY / 3.0
), '3.000 Schritt over one map unit is gradient 1,0 -- 1 map unit = 3.000 Schritt, scaled by distance');

fwrite(STDOUT, "terrain-factor-test: all asserts passed\n");

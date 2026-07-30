<?php
// api/_internal/app/__tests__/terrain-store-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 terrain store's PURE half (api/_internal/app/terrain-store.php).
 *
 * No DB, no HTTP: the file is side-effect-free on include. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-store.php';

$throws = static function (callable $run): bool {
    try { $run(); } catch (InvalidArgumentException) { return true; }
    return false;
};

// The invariant that makes a half-read raster impossible: 2 bytes per sample, no more, no less.
avesmapsTerrainGuardRasterShape(4, 3, 0.25, 24);
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(4, 3, 0.25, 23)),
    'byte length one short must be refused, not read half');
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(4, 3, 0.25, 25)),
    'byte length one over must be refused');

// A cell size FINER than the stock resolution is refused: it would measure a larger ascent for
// the same ground (total variation grows with sampling density, x sqrt(2) per halving).
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(4, 3, 0.125, 24)),
    'cell size below the stock resolution must be refused');
avesmapsTerrainGuardRasterShape(4, 3, 0.5, 24);   // coarser is allowed

assert($throws(static fn() => avesmapsTerrainGuardRasterShape(0, 3, 0.25, 0)),
    'zero width must be refused');
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(70000, 3, 0.25, 420000)),
    'width beyond SMALLINT UNSIGNED must be refused before MySQL truncates it');
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(3000, 3000, 0.25, 18000000)),
    'pixel count beyond the per-area ceiling must be refused');

assert(AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT === 3000.0, '1 map unit is 3000 Schritt');
assert(AVESMAPS_TERRAIN_CELL_SIZE === 0.25, 'the stock resolution is fixed at 0.25 map units');

// ---- fingerprints ---------------------------------------------------------------------------
// 🔴 `ecosystem_revision` IS NOT IN ANY STAMP. It is ONE GLOBAL counter (ecosystem.php, id = 1,
// 11 call sites): every edit to any of the 686 areas bumps it, a lake included, a rename included.
// Measured in these very specs: V9 read 3082 on 2026-07-29, V11 read 3983 the SAME DAY -- 901 jumps
// in one working day. The raster stock would have been „stale" 901 times, at 8 s of recomputation
// each. After the third time nobody presses the button, and then a raster whose stamp says „stale"
// is what the map runs on.
$area = ['geometry_revision' => 4, 'terrain_grain' => 3.2, 'terrain_levels' => 3,
    'terrain_avg_height' => 2000.0, 'terrain_mean_height' => 500.0, 'region_type' => 'gebirge'];
$base = avesmapsTerrainAreaFingerprint($area);
assert(strlen($base) === 40, 'a fingerprint is a sha1');
assert(avesmapsTerrainAreaFingerprint($area) === $base, 'the same area gives the same fingerprint');
assert(avesmapsTerrainAreaFingerprint(['terrain_grain' => 4.0] + $area) !== $base,
    'turning a terrain knob must change the area fingerprint');
assert(avesmapsTerrainAreaFingerprint(['region_type' => 'huegelland'] + $area) !== $base,
    'the drawing method follows the KIND, so the kind belongs in the fingerprint');
// geometry_revision has its own column and is compared separately -- it is deliberately NOT folded in.
assert(avesmapsTerrainAreaFingerprint(['geometry_revision' => 9] + $area) === $base,
    'geometry_revision is its own column, not part of this fingerprint');

$peaks = [
    ['public_id' => 'p1', 'x' => 10.0, 'y' => 20.0, 'height_schritt' => 3000.0],
    ['public_id' => 'p2', 'x' => 30.0, 'y' => 40.0, 'height_schritt' => null],
];
$heightAreas = [['public_id' => 'a1', 'geometry_revision' => 2]];
$peakStamp = avesmapsTerrainPeaksFingerprint($peaks, $heightAreas);
assert(strlen($peakStamp) === 40, 'the peaks fingerprint is a sha1');
assert(avesmapsTerrainPeaksFingerprint(array_reverse($peaks), $heightAreas) === $peakStamp,
    'the order the rows arrive in must not change the fingerprint');

// 💣 IT MUST BE GLOBAL. `separationAt` has NO distance limit
// (map-features-ecosystem-height-field.js:198-211): delete a peak and its neighbour's separation
// jumps to the next one, wherever that is -- which moves that neighbour's radius, and through
// `field.hmax` and `noiseScale` the SCALING OF THE WHOLE AREA. Same argmax trap as §2.
$moved = $peaks;
$moved[1]['x'] = 900.0;
assert(avesmapsTerrainPeaksFingerprint($moved, $heightAreas) !== $peakStamp,
    'a peak moving ANYWHERE must invalidate every raster');
$raised = $peaks;
$raised[0]['height_schritt'] = 3100.0;
assert(avesmapsTerrainPeaksFingerprint($raised, $heightAreas) !== $peakStamp,
    'a changed peak height must invalidate');

// 💣 AND IT MUST COVER THE ASSIGNMENT. `assignEcosystemPeaksToAreas`
// (map-features-ecosystem-height-combine.js:88) gives each peak to the SMALLEST CONTAINING area.
// Draw a new, smaller overlapping area and it STEALS the old one's peaks -- while the old area's
// geometry_revision and its knobs do not change at all. Without this its raster would claim to be
// current and be wrong. This case bites TODAY, not once the stock grows.
//
// ⚠️ DEVIATION FROM THE SPEC, on purpose. §5.1 asks for „the assigned area_id" in the fingerprint.
// That assignment is point-in-polygon and exists only in JS; reproducing it in PHP would be a second
// implementation of a rule that has to agree exactly. Instead the fingerprint carries every
// HEIGHT-BEARING area with its geometry_revision -- the assignment can only change when one of those
// is redrawn, added, removed or changes kind, so this covers the same cases without the second copy.
assert(avesmapsTerrainPeaksFingerprint($peaks, [['public_id' => 'a1', 'geometry_revision' => 3]]) !== $peakStamp,
    'redrawing a height-bearing area can steal peaks and must invalidate');
assert(avesmapsTerrainPeaksFingerprint($peaks, [
    ['public_id' => 'a1', 'geometry_revision' => 2],
    ['public_id' => 'a2', 'geometry_revision' => 1],
]) !== $peakStamp, 'a NEW height-bearing area can steal peaks and must invalidate');
// A lake being redrawn does NOT appear here at all -- it carries no height field, so it cannot steal
// a peak. That is the whole point of restricting the list.

// ---- the profile derivation -------------------------------------------------------------------
require_once __DIR__ . '/../heightmap.php';

// A 5x1 ramp along x at origin (0,0), cell 1,0 (coarser than the stock resolution, allowed):
//   0  1000  2000  1000  0     -- up then down, so ascent and descent are both non-zero.
$ramp = avesmapsHeightmapDecode([
    'origin_x' => '0.0000', 'origin_y' => '0.0000', 'cell_size_mapunits' => '1.0000',
    'width_px' => 5, 'height_px' => 1,
    'samples' => gzdeflate(pack('v*', 0, 1000, 2000, 1000, 0)), 'sample_bytes' => 10,
]);
$ramp['area_id'] = 1;
$ramp['min_x'] = 0.0; $ramp['min_y'] = 0.0; $ramp['max_x'] = 4.0; $ramp['max_y'] = 0.0;

// A way straight along the ridge: 0 -> 4 in x.
$profile = avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0], [4.0, 0.0]]);
assert(is_array($profile), 'a way over a raster must produce a profile');
assert(abs($profile['ascent'] - 2000.0) < 1.0, 'climb 0 -> 2000 is 2000 Schritt, got ' . $profile['ascent']);
assert(abs($profile['descent'] - 2000.0) < 1.0, 'fall 2000 -> 0 is 2000 Schritt, got ' . $profile['descent']);
assert(count($profile['profile']) === 1, 'one segment gives one profile pair');

// Per SEGMENT, not per way: a way with three vertices gives three pairs, and their sum is the total.
$threeLegs = avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0], [2.0, 0.0], [3.0, 0.0], [4.0, 0.0]]);
assert(count($threeLegs['profile']) === 3, 'three segments give three profile pairs');
$sumUp = array_sum(array_column($threeLegs['profile'], 0));
assert(abs($sumUp - $threeLegs['ascent']) < 1.0, 'the per-segment pairs must sum to the total ascent');
assert(abs($threeLegs['profile'][0][0] - 2000.0) < 1.0, 'the first leg carries the whole climb');
assert($threeLegs['profile'][0][1] < 1.0, 'the first leg falls nowhere');
assert($threeLegs['profile'][1][0] < 1.0, 'the second leg climbs nowhere');
assert(abs($threeLegs['profile'][1][1] - 1000.0) < 1.0, 'the second leg carries half the fall');

// 💣 A WAY OUTSIDE EVERY RASTER IS null, NOT ZERO. „No height data" and „measured and level" are
// different answers, and today 51 of 67 peaks carry no height at all.
assert(avesmapsTerrainProfileForLine([$ramp], [[900.0, 900.0], [901.0, 900.0]]) === null,
    'a way beyond every bbox has NO data -- it is not level ground');

// ---- 🔴 THE STEEP SUMS: the two numbers the Leistungskilometer actually charges ----------
//
// Every piece stores FOUR values: ascent, descent, steep ascent, steep descent. The steep halves are
// what the model bills a descent by (150 Schritt per Leistungsmeile, but only past 20 % gradient), and
// a steep ascent one way IS a steep descent the other -- so both must be stored or the reverse
// direction cannot be priced.
//
// 💣 UNTESTED, THIS IS THE SILENT FAILURE: hand the threshold the SEGMENT length instead of the
// SAMPLE step and every gradient looks far gentler, every steep sum comes out zero, and every descent
// on the map becomes free. Nothing else in the suite would notice.
assert(count($profile['profile'][0]) === 4,
    'a profile piece carries four values, not two -- the count doubles as the format guard in the router');

// The ramp climbs 2.000 Schritt over 2 units = 33 % -- steep in BOTH directions, all of it.
assert(abs($profile['profile'][0][2] - 2000.0) < 1.0,
    'a 33 % climb is steep throughout, got ' . $profile['profile'][0][2]);
assert(abs($profile['profile'][0][3] - 2000.0) < 1.0,
    'and so is the 33 % fall, got ' . $profile['profile'][0][3]);

// A gentle ramp: 100 Schritt per unit = 3,3 % -- under the threshold, so NOTHING is steep.
$gentle = avesmapsHeightmapDecode([
    'origin_x' => '0.0000', 'origin_y' => '0.0000', 'cell_size_mapunits' => '1.0000',
    'width_px' => 5, 'height_px' => 1,
    'samples' => gzdeflate(pack('v*', 0, 100, 200, 100, 0)), 'sample_bytes' => 10,
]);
$gentle['area_id'] = 2;
$gentle['min_x'] = 0.0; $gentle['min_y'] = 0.0; $gentle['max_x'] = 4.0; $gentle['max_y'] = 0.0;
$gentleProfile = avesmapsTerrainProfileForLine([$gentle], [[0.0, 0.0], [4.0, 0.0]]);
assert(abs($gentleProfile['ascent'] - 200.0) < 1.0, 'the gentle ramp still climbs 200 Schritt');
assert($gentleProfile['profile'][0][2] === 0.0 && $gentleProfile['profile'][0][3] === 0.0,
    'at 3,3 % nothing is steep -- a gentle descent must cost nothing at all');

// 💣 THE ONE THAT PINS THE PER-SAMPLE RULE. This segment AVERAGES 7,5 % -- gentle -- but its
// first unit climbs 900 Schritt over one unit, which is 30 %. Decide the threshold from the average and
// the steep sum is zero; decide it per sample and it is the whole 900. Real ground is not smooth, and
// this is exactly the case the infobox warns about.
$mixed = avesmapsHeightmapDecode([
    'origin_x' => '0.0000', 'origin_y' => '0.0000', 'cell_size_mapunits' => '1.0000',
    'width_px' => 5, 'height_px' => 1,
    'samples' => gzdeflate(pack('v*', 0, 900, 900, 900, 900)), 'sample_bytes' => 10,
]);
$mixed['area_id'] = 3;
$mixed['min_x'] = 0.0; $mixed['min_y'] = 0.0; $mixed['max_x'] = 4.0; $mixed['max_y'] = 0.0;
$mixedProfile = avesmapsTerrainProfileForLine([$mixed], [[0.0, 0.0], [4.0, 0.0]]);
$averageGradient = $mixedProfile['ascent'] / (4.0 * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE);
assert($averageGradient < AVESMAPS_TERRAIN_LKM_DESCENT_THRESHOLD,
    'the segment average must be GENTLE for this test to mean anything, got '
    . round(100 * $averageGradient, 1) . ' %');
assert(abs($mixedProfile['profile'][0][2] - 900.0) < 1.0,
    'the steep stretch inside a gentle segment must be counted -- per sample, not per average, got '
    . $mixedProfile['profile'][0][2]);

// A steep sum can never exceed the total it is a part of.
foreach ([$profile, $gentleProfile, $mixedProfile] as $checked) {
    foreach ($checked['profile'] as $piece) {
        assert($piece[2] <= $piece[0] + 1e-6 && $piece[3] <= $piece[1] + 1e-6,
            'the steep half of a climb or fall cannot be larger than the climb or fall itself');
    }
}
assert(avesmapsTerrainProfileForLine([], [[0.0, 0.0], [4.0, 0.0]]) === null,
    'no raster at all is no data');

// A way that only PARTLY overlaps still answers, for the part it can measure.
$partly = avesmapsTerrainProfileForLine([$ramp], [[2.0, 0.0], [900.0, 0.0]]);
assert(is_array($partly), 'a way that touches a raster at all must answer');

// Degenerate input does not throw and does not divide.
assert(avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0]]) === null, 'a single point is not a line');
assert(avesmapsTerrainProfileForLine([$ramp], []) === null, 'an empty line is not a line');

// 💣 THE INTEGRATION RESOLUTION IS FIXED. The ascent over fractal ground is a TOTAL VARIATION: it
// grows with sampling density (x sqrt(2) per halving). Sampling a segment only at its endpoints
// would measure a fraction of the climb a finer walk sees -- and A* at 0,5 cells would then prefer
// cross-country EXACTLY in the mountains, out of a pure sampling artefact (§5.3).
$coarse = avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0], [4.0, 0.0]]);
assert($coarse['samples'] > 4, 'the walk must sample INSIDE a segment, not just its ends, got '
    . $coarse['samples']);

fwrite(STDOUT, "terrain-store-test: all asserts passed\n");

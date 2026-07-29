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

fwrite(STDOUT, "terrain-store-test: all asserts passed\n");

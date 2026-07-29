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

fwrite(STDOUT, "terrain-store-test: all asserts passed\n");

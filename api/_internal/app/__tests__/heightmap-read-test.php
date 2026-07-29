<?php
// api/_internal/app/__tests__/heightmap-read-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 height raster reader (api/_internal/app/heightmap.php).
 *
 * No DB: the pure half takes decoded raster arrays. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/heightmap-read-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-store.php';
require __DIR__ . '/../heightmap.php';

$near = static fn(?float $a, float $b): bool => $a !== null && abs($a - $b) < 1e-6;
$throws = static function (callable $run): bool {
    try { $run(); } catch (InvalidArgumentException) { return true; }
    return false;
};

// A 3x2 raster at origin (10, 20), cell 0,25. Values in SCHRITT, row-major, little-endian uint16.
//   row 0 (y = 20,00):  100  200  300
//   row 1 (y = 20,25):  400  500  600
$raw = pack('v*', 100, 200, 300, 400, 500, 600);
$row = [
    'origin_x' => '10.0000', 'origin_y' => '20.0000',
    'cell_size_mapunits' => '0.2500', 'width_px' => 3, 'height_px' => 2,
    'samples' => gzdeflate($raw), 'sample_bytes' => strlen($raw),
];
$raster = avesmapsHeightmapDecode($row);

// 🔴 THE BLOB STAYS A STRING. unpack('v*') would cost a measured 43 bytes per element -- 42 to 95 MB
// at 78 areas against 5,25 MB of blob.
assert(is_string($raster['samples']), 'the raster must stay a binary string, never a PHP array');
assert(strlen($raster['samples']) === 12, 'inflate must restore exactly width * height * 2 bytes');

// --- grid points read EXACTLY what the browser wrote -------------------------------------------
assert($near(avesmapsHeightmapSampleOne($raster, 10.00, 20.00), 100.0), 'grid point (0,0)');
assert($near(avesmapsHeightmapSampleOne($raster, 10.50, 20.00), 300.0), 'grid point (2,0)');
assert($near(avesmapsHeightmapSampleOne($raster, 10.00, 20.25), 400.0), 'grid point (0,1)');
assert($near(avesmapsHeightmapSampleOne($raster, 10.50, 20.25), 600.0), 'grid point (2,1)');

// --- between grid points it interpolates, so the ascent has no sub-cell staircase --------------
assert($near(avesmapsHeightmapSampleOne($raster, 10.125, 20.00), 150.0), 'halfway along x');
assert($near(avesmapsHeightmapSampleOne($raster, 10.00, 20.125), 250.0), 'halfway along y');
assert($near(avesmapsHeightmapSampleOne($raster, 10.125, 20.125), 300.0), 'centre of the first cell');

// --- outside the bbox is „no data", NOT 0 ------------------------------------------------------
assert(avesmapsHeightmapSampleOne($raster, 9.99, 20.0) === null, 'left of the bbox is unknown, not level');
assert(avesmapsHeightmapSampleOne($raster, 10.0, 21.0) === null, 'below the bbox is unknown, not level');
assert(avesmapsHeightmapSampleSum([], 10.0, 20.0) === null, 'no raster at all is unknown, not level');

// --- 💣 TWO OVERLAPPING RASTERS SUM. Reading only „the area that contains the point" gives a height
// that is too low in every overlap strip -- and looks perfectly ordinary while doing it (§5.0).
$second = avesmapsHeightmapDecode([
    'origin_x' => '10.0000', 'origin_y' => '20.0000',
    'cell_size_mapunits' => '0.2500', 'width_px' => 3, 'height_px' => 2,
    'samples' => gzdeflate(pack('v*', 7, 7, 7, 7, 7, 7)), 'sample_bytes' => 12,
]);
assert($near(avesmapsHeightmapSampleSum([$raster, $second], 10.00, 20.00), 107.0),
    'overlapping rasters must ADD, not shadow one another');
// A point only ONE of them covers still answers, with that one's value.
$far = avesmapsHeightmapDecode([
    'origin_x' => '500.0000', 'origin_y' => '500.0000',
    'cell_size_mapunits' => '0.2500', 'width_px' => 3, 'height_px' => 2,
    'samples' => gzdeflate(pack('v*', 1, 1, 1, 1, 1, 1)), 'sample_bytes' => 12,
]);
assert($near(avesmapsHeightmapSampleSum([$raster, $far], 10.00, 20.00), 100.0),
    'a raster that does not cover the point contributes nothing, and does not make the answer null');

// --- the invariant refuses rather than reading half --------------------------------------------
assert($throws(static fn() => avesmapsHeightmapDecode([
    'origin_x' => '0', 'origin_y' => '0', 'cell_size_mapunits' => '0.2500',
    'width_px' => 3, 'height_px' => 2, 'samples' => gzdeflate(pack('v*', 1, 2, 3)), 'sample_bytes' => 6,
])), 'width * height * 2 != inflated length must be refused, not read half');

assert($throws(static fn() => avesmapsHeightmapDecode([
    'origin_x' => '0', 'origin_y' => '0', 'cell_size_mapunits' => '0.1000',
    'width_px' => 3, 'height_px' => 2, 'samples' => gzdeflate($raw), 'sample_bytes' => 12,
])), 'a cell size below the stock resolution must be refused');

assert($throws(static fn() => avesmapsHeightmapDecode([
    'origin_x' => '0', 'origin_y' => '0', 'cell_size_mapunits' => '0.2500',
    'width_px' => 3, 'height_px' => 2, 'samples' => 'not deflate data', 'sample_bytes' => 12,
])), 'an undecompressable blob must be refused, not treated as zeros');

// --- 💣 CHECKED BY SEARCH, NOT AT RUNTIME (§9.1): the reader must never materialise the blob.
//
// 🪤 The search runs over CODE ONLY, comments stripped by the tokenizer. A plain grep over the
// whole file also matches the comment that EXPLAINS the ban -- and then the file can only pass its
// own test by euphemising the very thing it warns about, which is how the warning gets lost. The
// comments are free to spell `unpack('v*')` out; the check tests what executes.
$source = (string) file_get_contents(__DIR__ . '/../heightmap.php');
$executableCode = '';
foreach (token_get_all($source) as $token) {
    if (is_array($token) && ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT)) {
        continue;
    }
    $executableCode .= is_array($token) ? $token[1] : $token;
}
assert(!preg_match("/unpack\\(\\s*'v\\*'/", $executableCode),
    "heightmap.php must not CALL unpack('v*') -- that materialises the blob as a PHP array");
// The check must be able to fail. If this ever stops holding, the guard above is decorative.
assert(preg_match("/unpack\\(\\s*'v\\*'/", "unpack('v*', \$s)") === 1,
    'the ban regex must actually match a real violation');

fwrite(STDOUT, "heightmap-read-test: all asserts passed\n");

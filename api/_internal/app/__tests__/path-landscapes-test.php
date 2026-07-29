<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of the V10 read: request validation and the arc length of a
 * coordinate list. Everything DB-bound is provable only against the live stock -- there is no
 * local MySQL here (api/config.local.php is absent), the same limit path-ecosystem-test.php has.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-landscapes-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../path-landscapes.php';

function pathLandscapesTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

// ---- request validation ------------------------------------------------------------------
$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => [
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
    '  0166e831-1111-2222-3333-444455556666  ',
]]);
assert(count($ids) === 2, 'both ids survive');
assert(in_array('0166e831-1111-2222-3333-444455556666', $ids, true), 'surrounding blanks are trimmed');

$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => [
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
]]);
assert(count($ids) === 1, 'the same way asked for twice is asked for once');

$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => [
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
    "<script>alert('x')</script>",
    '',
    42,
]]);
assert($ids === ['8a502001-e3bd-5d9b-aae4-cae1a2ab519b'],
    'anything that is not a public_id is dropped, not escaped and asked for');

pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest(['paths' => []]),
    'an empty list is a client mistake, not an empty answer'
);
pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest(['paths' => 'nope']),
    'paths must be a list'
);
pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest([]),
    'a missing paths key is the same mistake'
);
pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest(['paths' => array_map(
        static fn (int $i) => sprintf('%08x-0000-0000-0000-000000000000', $i),
        range(1, AVESMAPS_PATH_LANDSCAPES_MAX + 1)
    )]),
    'over the ceiling the server refuses -- it never answers a truncated list, '
        . 'because half an answer looks exactly like a whole one'
);
// Exactly at the ceiling is still fine.
$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => array_map(
    static fn (int $i) => sprintf('%08x-0000-0000-0000-000000000000', $i),
    range(1, AVESMAPS_PATH_LANDSCAPES_MAX)
)]);
assert(count($ids) === AVESMAPS_PATH_LANDSCAPES_MAX, 'the ceiling itself is allowed');

// ---- arc length --------------------------------------------------------------------------
assert(abs(avesmapsPathLandscapesLineLength([[0.0, 0.0], [3.0, 4.0]]) - 5.0) < 1e-9,
    'a 3-4-5 triangle');
assert(abs(avesmapsPathLandscapesLineLength([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]) - 2.0) < 1e-9,
    'the pieces add up');
assert(avesmapsPathLandscapesLineLength([[1.0, 1.0]]) === 0.0, 'a single point has no length');
assert(avesmapsPathLandscapesLineLength([]) === 0.0, 'no points, no length');
assert(avesmapsPathLandscapesLineLength([[0.0, 0.0], [0.0, 0.0]]) === 0.0,
    'a way that goes nowhere is length zero, not a division by zero later');

echo "OK: path-landscapes request validation and arc length\n";

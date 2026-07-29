<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of the V9 assignment store: row normalisation and the run-token guard.
 * Everything DB-bound (the transactions, the id resolution, the stamp) is provable only in the
 * owner's live run -- there is no local MySQL here (api/config.local.php is absent). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-ecosystem-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../path-ecosystem.php';

function pathEcosystemTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

// ---- path rows -------------------------------------------------------------------------------
$rows = avesmapsPathEcosystemNormalizeRows('path', [
    ['path' => 'p-1', 'area' => 'a-1', 'basis' => 0, 'seq' => 0, 'enter' => 3.2812, 'exit' => 3.6789],
    ['path' => 'p-1', 'area' => 'a-1', 'basis' => 1, 'seq' => 0, 'enter' => 3.3, 'exit' => 3.7],
]);
assert(count($rows) === 2);
assert($rows[0]['basis'] === 0 && $rows[1]['basis'] === 1);
assert(abs($rows[0]['enter'] - 3.2812) < 1e-9);
assert($rows[0]['path'] === 'p-1' && $rows[0]['area'] === 'a-1');

// basis is 0 or 1 and nothing else -- a third value would create a key nobody ever reads back.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 2, 'seq' => 0, 'enter' => 0, 'exit' => 1]]),
    'basis must be 0 or 1'
);

// exit before enter is not a rounding artefact, it is a broken row.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 0, 'seq' => 0, 'enter' => 5, 'exit' => 4]]),
    'exit must not precede enter'
);

// 💣 seq is a TINYINT. More than 255 crossings of one area by one way is a broken geometry, and
// truncating it would store a plausible-looking half answer. Measured maximum on the live stock: 17.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 0, 'seq' => 256, 'enter' => 0, 'exit' => 1]]),
    'seq must fit a TINYINT'
);

// A zero-length interval is legal at the boundary of the epsilon and must not be rejected.
$rows = avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 0, 'seq' => 0, 'enter' => 2.0, 'exit' => 2.0]]);
assert(count($rows) === 1, 'enter == exit is allowed');

// An empty public id cannot be resolved and must not be stored as one.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => '', 'area' => 'a', 'basis' => 0, 'seq' => 0, 'enter' => 0, 'exit' => 1]]),
    'an empty public id is not an id'
);

// ---- overlap rows ----------------------------------------------------------------------------
$rows = avesmapsPathEcosystemNormalizeRows('overlap', [['region' => 'r-1', 'other' => 'r-2', 'share' => 0.62]]);
assert(count($rows) === 1 && abs($rows[0]['share'] - 0.62) < 1e-9);

// A share outside [0,1] means the caller measured against the wrong total -- storing it would make a
// wrong answer look computed.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('overlap', [['region' => 'r-1', 'other' => 'r-2', 'share' => 1.4]]),
    'share must be a fraction'
);

// A region cannot overlap itself: that pair would be 100 % for every region and say nothing.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('overlap', [['region' => 'r-1', 'other' => 'r-1', 'share' => 0.5]]),
    'a region may not overlap itself'
);

// ---- territory rows --------------------------------------------------------------------------
$rows = avesmapsPathEcosystemNormalizeRows('territory', [
    ['region' => 'r-1', 'territory' => 't-1', 'share' => 0.5, 'aggregate' => true],
    ['region' => 'r-1', 'territory' => 't-2', 'share' => 0.5],
]);
assert($rows[0]['is_aggregate'] === 1, 'aggregate travels as 0/1');
assert($rows[1]['is_aggregate'] === 0, 'a missing aggregate flag is 0, not null');

// ---- the empty run IS a result -----------------------------------------------------------------
assert(avesmapsPathEcosystemNormalizeRows('path', []) === [], 'an empty chunk is legal, not an error');
assert(avesmapsPathEcosystemNormalizeRows('path', null) === [], 'a missing rows key is an empty chunk');

// ---- unknown kind ------------------------------------------------------------------------------
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('nonsense', []),
    'kind must be path, overlap or territory'
);

// ---- a chunk has a ceiling ----------------------------------------------------------------------
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', array_fill(0, AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX + 1, [
        'path' => 'p', 'area' => 'a', 'basis' => 0, 'seq' => 0, 'enter' => 0, 'exit' => 1,
    ])),
    'a chunk larger than the ceiling is refused rather than half-written'
);

// ---- the token guard ---------------------------------------------------------------------------
// 💣 This is what a GET_LOCK cannot do: a connection-scoped lock dies with its request, and a run
// spans many. Two editors computing at once would otherwise interleave their chunks into one
// nonsensical result.
assert(avesmapsPathEcosystemTokenMatches('abc', 'abc') === true);
assert(avesmapsPathEcosystemTokenMatches('abc', 'def') === false);
assert(avesmapsPathEcosystemTokenMatches(null, 'abc') === false, 'no run in flight -> no chunk accepted');
assert(avesmapsPathEcosystemTokenMatches('', 'abc') === false, 'an empty stored token never matches');
assert(avesmapsPathEcosystemTokenMatches('abc', '') === false, 'an empty offered token never matches');
assert(avesmapsPathEcosystemTokenMatches('', '') === false, 'two empties are not a match either');

echo "OK: path-ecosystem row normalisation and run-token guard\n";

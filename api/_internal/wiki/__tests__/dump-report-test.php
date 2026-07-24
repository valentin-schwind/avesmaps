<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE core of api/_internal/wiki/dump-report.php (classify / delta /
 * prune-selection / normalize). No DB, no HTTP -- hand-built report arrays only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/wiki/__tests__/dump-report-test.php
 * Exit 0 = all asserts passed.
 */

// Environment guard: assert() is compiled to a silent no-op unless zend.assertions=1 is set at
// PHP startup -- it CANNOT be flipped at runtime via ini_set(). Without this guard a broken
// implementation would print every "... ok" line and exit 0: a false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../dump-report.php';

// --------------------------------------------------------------------------- NORMALIZE ---
// 💣 The whole point of the normalizer: report_json must carry SCALARS ONLY. wiki_sync_runs
// reached 99 MiB across 99 rows (~1 MiB each) because a JSON column was used as an inter-phase
// scratchpad for full record arrays. Same table shape without this guard = same accident.
$raw = [
    'started_at' => '2026-07-24T08:10:00Z',
    'finished_at' => '2026-07-24T08:20:12Z',
    'steps' => [
        'fetch_dump' => ['ok' => true],
        'read' => [
            'pages_scanned' => 123456,
            'by_kind' => ['settlement' => 5123, 'path' => 3721],
            // A driver that ever hands us the actual records must NOT be able to persist them.
            'settlement_titles' => ['Gareth', 'Havena', 'Al\'Anfa'],
        ],
        'sync_publications' => ['processed' => 1526, 'added' => 12, 'updated' => 3, 'removed' => 0],
    ],
    'selftests' => ['total' => 10, 'green' => 10, 'red' => 0, 'failed' => []],
];
$norm = avesmapsDumpReportNormalize($raw);
assert($norm['steps']['read']['pages_scanned'] === 123456);
assert($norm['steps']['read']['by_kind'] === ['settlement' => 5123, 'path' => 3721], 'by_kind survives (int map)');
assert(!isset($norm['steps']['read']['settlement_titles']), 'record lists are stripped');
assert($norm['selftests']['red'] === 0);
assert($norm['steps']['sync_publications']['added'] === 12);
echo "normalize ok\n";

// A deeply nested payload cannot smuggle a list through by hiding it one level lower.
$deep = avesmapsDumpReportNormalize(['steps' => ['read' => ['by_kind' => ['a' => ['nope']]]]]);
assert($deep['steps']['read']['by_kind'] === [], 'non-scalar kind counts dropped');
echo "normalize-depth ok\n";

// ---------------------------------------------------------------------------- CLASSIFY ---
$clean = [
    'steps' => ['fetch_dump' => ['ok' => true], 'read' => ['by_kind' => ['settlement' => 5000]]],
    'selftests' => ['total' => 10, 'green' => 10, 'red' => 0],
];
$c = avesmapsDumpReportClassify($clean, null);
assert($c['notable'] === false, 'a clean first run is quiet');
assert($c['reason'] === '');
echo "classify-clean ok\n";

// Rule 1: a red self-test.
$red = $clean;
$red['selftests'] = ['total' => 10, 'green' => 9, 'red' => 1];
$c = avesmapsDumpReportClassify($red, null);
assert($c['notable'] === true && str_contains($c['reason'], 'Selbsttest'), 'red selftest is notable');
echo "classify-selftest ok\n";

// Rule 2: a step that did not report ok.
$broken = $clean;
$broken['steps']['cleanup_state'] = ['ok' => false];
$c = avesmapsDumpReportClassify($broken, null);
assert($c['notable'] === true && str_contains($c['reason'], 'Schritt'), 'failed step is notable');
echo "classify-step ok\n";

// Rule 3: a collapse against the previous run needs BOTH thresholds.
// 💣 This is the rule that earns its keep. The Art-gate incident swallowed ~430 adventures
// silently: the run "succeeded", the numbers were merely lower, and nothing compared them.
$prev = ['steps' => ['read' => ['by_kind' => ['settlement' => 5000, 'adventure' => 1352]]]];

// 5 % drop of a big kind: below the ratio threshold -> quiet.
$small = ['steps' => ['read' => ['by_kind' => ['settlement' => 4750, 'adventure' => 1352]]],
          'selftests' => ['red' => 0]];
assert(avesmapsDumpReportClassify($small, $prev)['notable'] === false, '5% drop stays quiet');

// 40 % drop of a TINY kind: over the ratio, under the absolute -> quiet (a ratio alone would scream).
$tiny = ['steps' => ['read' => ['by_kind' => ['settlement' => 5000, 'adventure' => 1352, 'powerline' => 3]]],
         'selftests' => ['red' => 0]];
$tinyPrev = ['steps' => ['read' => ['by_kind' => ['settlement' => 5000, 'adventure' => 1352, 'powerline' => 5]]]];
assert(avesmapsDumpReportClassify($tiny, $tinyPrev)['notable'] === false, 'tiny absolute drop stays quiet');

// The real thing: ~430 adventures gone. Over both thresholds -> notable, and it names the kind.
$collapse = ['steps' => ['read' => ['by_kind' => ['settlement' => 5000, 'adventure' => 922]]],
             'selftests' => ['red' => 0]];
$c = avesmapsDumpReportClassify($collapse, $prev);
assert($c['notable'] === true, 'a 430-of-1352 collapse is notable');
assert(str_contains($c['reason'], 'adventure'), 'the reason names the kind');
echo "classify-collapse ok\n";

// GROWTH is never notable -- the wiki gaining entries is the normal case.
$grown = ['steps' => ['read' => ['by_kind' => ['settlement' => 5400, 'adventure' => 1400]]],
          'selftests' => ['red' => 0]];
assert(avesmapsDumpReportClassify($grown, $prev)['notable'] === false, 'growth is not notable');

// With no previous run rule 3 cannot fire and must not be treated as notable.
assert(avesmapsDumpReportClassify($collapse, null)['notable'] === false, 'first run cannot collapse');
// A kind that did not exist before is not a collapse either.
$newKind = ['steps' => ['read' => ['by_kind' => ['settlement' => 5000, 'adventure' => 1352, 'citymap' => 4]]],
            'selftests' => ['red' => 0]];
assert(avesmapsDumpReportClassify($newKind, $prev)['notable'] === false, 'a brand-new kind is not a collapse');
echo "classify-thresholds ok\n";

// ------------------------------------------------------------------------------- DELTA ---
$d = avesmapsDumpReportDelta($collapse, $prev);
assert($d['adventure'] === ['now' => 922, 'was' => 1352, 'diff' => -430], 'delta reports the drop');
assert($d['settlement']['diff'] === 0);
// First-ever run: everything is "now", nothing to compare.
$d = avesmapsDumpReportDelta($collapse, null);
assert($d['adventure'] === ['now' => 922, 'was' => null, 'diff' => null], 'first run has no comparison');
// A kind present only in the PREVIOUS run must still surface -- that is a kind that vanished
// entirely, which is the most severe case and must not be silently absent from the table.
$d = avesmapsDumpReportDelta(['steps' => ['read' => ['by_kind' => ['settlement' => 5000]]]], $prev);
assert($d['adventure'] === ['now' => 0, 'was' => 1352, 'diff' => -1352], 'a vanished kind is reported');
echo "delta ok\n";

// ------------------------------------------------------------------------------- PRUNE ---
// Keeps exactly the newest AVESMAPS_DUMP_REPORT_KEEP, returns the rest for deletion.
assert(avesmapsDumpReportPruneIds([9, 8, 7, 6, 5, 4, 3]) === [4, 3], 'prunes down to the newest 5');
assert(avesmapsDumpReportPruneIds([9, 8, 7]) === [], 'under the cap deletes nothing');
assert(avesmapsDumpReportPruneIds([]) === []);
// Idempotent: pruning an already-pruned set is a no-op.
assert(avesmapsDumpReportPruneIds([9, 8, 7, 6, 5]) === [], 'exactly at the cap is a no-op');
echo "prune ok\n";

echo "ALL DUMP-REPORT TESTS PASSED\n";

<?php

declare(strict_types=1);

/**
 * Pure-logic unit test for the WikiDump §9 COMPARE-TEST core
 * (api/_internal/wiki/dump-compare.php).
 * ---------------------------------------------------------------------------
 * The compare-test is the owner's safety gate: it proves the dump-reader yields
 * the SAME data the online crawler put in the DB. The FULL run (open the dump,
 * run the collectors, SELECT the real rows) needs the real ~40.8 MB dump + STRATO
 * MySQL, so it is the owner's live SSH run (scripts/wikidump-compare.php). What IS
 * locally testable -- and what this file exercises -- is the COMPARISON LOGIC: fed
 * synthetic dump-record maps + db-record maps, the pure functions must produce the
 * right diff. No DB, no dump, no mocks -- just the pure core with hand-built maps.
 *
 * WHAT THIS PROVES:
 *   A1 (avesmapsWikiDumpCompareKeyCoverage): a DB key the dump did NOT produce
 *      shows up in missing_in_dump (the HARD failure); a dump-only key shows up in
 *      new_in_dump; matched counts the overlap; a duplicated dump key is reported.
 *   A4 (avesmapsWikiDumpCompareFields): only matched keys are field-compared; only
 *      genuinely-different fields are listed (NULL vs '' is NOT a diff; a per-field
 *      normaliser folds representation differences); the totals tally per field.
 *   A2 (avesmapsWikiDumpCompareHierarchy): a differing parent is a drift; agree /
 *      both_root are counted, not listed; a parent_locked child is EXCLUDED (an
 *      editor override the dump need not reproduce); only_dump / only_db are
 *      classified.
 *   plus the index helper (avesmapsWikiDumpIndexRecordsByKey): last-write-wins map
 *      + a raw keyList (for dup detection) + a skipped count for empty keys.
 *
 * These are REAL assertions with hand-computed expected values, not tautologies
 * (never "assert f(x) === f(x)"). Exit code 0 iff every assert passes.
 *
 * HOW TO RUN (the pure core needs NO mbstring -- it does no mb_*; but the include
 * is guarded anyway for parity with the sibling tests):
 *
 *     php tools/wikidump/test-dump-compare.php
 */

// ---------------------------------------------------------------------------
// 1. Include the pure core. It is side-effect-free on include (function defs
//    only -- no DB, no headers, no I/O), so no bootstrap / PDO is required.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/wiki/dump-compare.php';

foreach ([
    'avesmapsWikiDumpCompareKeyCoverage',
    'avesmapsWikiDumpCompareFields',
    'avesmapsWikiDumpCompareHierarchy',
    'avesmapsWikiDumpIndexRecordsByKey',
] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-compare.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (no framework in this repo -- mirrors the siblings).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-52s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-52s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump-compare pure-logic test (WikiDump migration, §9 A1/A2/A4)\n";
echo "================================================================\n";
echo 'PHP version : ' . PHP_VERSION . "\n";
echo "----------------------------------------------------------------\n\n";

// ===========================================================================
// (A1) KEY COVERAGE -- missing_in_dump (hard), new_in_dump, matched, dup_keys.
// ===========================================================================
echo "-- A1  key coverage --\n";

// DB has 3 keys; the dump reproduced 2 of them and added 1 new one -> exactly one
// missing_in_dump (the hard failure) and one new_in_dump.
$dbByKey = [
    'wiki:kosch' => ['name' => 'Kosch'],
    'wiki:ferdok' => ['name' => 'Grafschaft Ferdok'],
    'wiki:huegelland' => ['name' => 'Baronie Hügelland'],
];
$dumpByKey = [
    'wiki:kosch' => ['name' => 'Kosch'],
    'wiki:ferdok' => ['name' => 'Grafschaft Ferdok'],
    'wiki:sokramor' => ['name' => 'Sokramor'], // dump-only (new_in_dump)
];
// Raw dump key list with a DUPLICATE (two pages slugged to one key -- a defect).
$dumpKeyList = ['wiki:kosch', 'wiki:ferdok', 'wiki:sokramor', 'wiki:kosch'];

$a1 = avesmapsWikiDumpCompareKeyCoverage($dumpByKey, $dbByKey, $dumpKeyList, 50);

$check('(a1.1) db_total = 3', 3, $a1['db_total'], 'three DB rows');
$check('(a1.2) dump_total = 3', 3, $a1['dump_total'], 'three distinct dump keys');
$check('(a1.3) matched = 2', 2, $a1['matched'], 'kosch + ferdok overlap');
$check('(a1.4) missing_in_dump_count = 1', 1, $a1['missing_in_dump_count'], 'huegelland absent from dump (HARD)');
$check(
    '(a1.5) missing_in_dump = [wiki:huegelland]',
    ['wiki:huegelland'],
    $a1['missing_in_dump'],
    'the exact DB row the dump did NOT re-create'
);
$check('(a1.6) new_in_dump_count = 1', 1, $a1['new_in_dump_count'], 'sokramor is dump-only');
$check('(a1.7) new_in_dump = [wiki:sokramor]', ['wiki:sokramor'], $a1['new_in_dump'], 'dump-only key listed');
$check('(a1.8) dup_keys = [wiki:kosch]', ['wiki:kosch'], $a1['dup_keys'], 'the duplicated dump key surfaces');

// Perfect coverage -> zero missing, zero new, zero dups (the GREEN case).
$green = avesmapsWikiDumpCompareKeyCoverage(
    ['a' => ['x' => 1], 'b' => ['x' => 2]],
    ['a' => ['x' => 1], 'b' => ['x' => 2]],
    ['a', 'b'],
    50
);
$check('(a1.9) green missing = 0', 0, $green['missing_in_dump_count'], 'full coverage -> no hard failure');
$check('(a1.10) green new = 0', 0, $green['new_in_dump_count'], 'no dump-only keys');
$check('(a1.11) green dups = []', [], $green['dup_keys'], 'no duplicate dump keys');
$check('(a1.12) green matched = 2', 2, $green['matched'], 'both keys overlap');

// Sample cap: many missing keys, but the sample is capped while the count is full.
$bigDb = [];
for ($i = 0; $i < 10; $i++) {
    $bigDb['k' . $i] = ['v' => $i];
}
$capped = avesmapsWikiDumpCompareKeyCoverage([], $bigDb, [], 3);
$check('(a1.13) capped missing count = 10', 10, $capped['missing_in_dump_count'], 'count is the FULL total');
$check('(a1.14) capped missing sample = 3', 3, count($capped['missing_in_dump']), 'sample honours the cap');

echo "\n";

// ===========================================================================
// (A4) FIELD DIFF -- matched-only, real diffs only, NULL==='' , normaliser.
// ===========================================================================
echo "-- A4  field diff --\n";

// db vs dump: 'ferdok' differs on settlement_class (a real editorial diff);
// 'kosch' is identical; 'auhof' has DB='' vs dump=NULL on continent (NOT a diff);
// 'sokramor' is dump-only (must NOT be field-compared -- A1 owns coverage).
$dbFields = [
    'wiki:kosch' => ['name' => 'Kosch', 'settlement_class' => 'stadt', 'continent' => 'Aventurien'],
    'wiki:ferdok' => ['name' => 'Ferdok', 'settlement_class' => 'stadt', 'continent' => 'Aventurien'],
    'wiki:auhof' => ['name' => 'Auhof', 'settlement_class' => 'dorf', 'continent' => ''],
];
$dumpFields = [
    'wiki:kosch' => ['name' => 'Kosch', 'settlement_class' => 'stadt', 'continent' => 'Aventurien'],
    'wiki:ferdok' => ['name' => 'Ferdok', 'settlement_class' => 'dorf', 'continent' => 'Aventurien'], // class differs
    'wiki:auhof' => ['name' => 'Auhof', 'settlement_class' => 'dorf', 'continent' => null], // '' vs NULL: no diff
    'wiki:sokramor' => ['name' => 'Sokramor', 'settlement_class' => 'stadt', 'continent' => 'Aventurien'],
];

$a4 = avesmapsWikiDumpCompareFields($dumpFields, $dbFields, ['name', 'settlement_class', 'continent'], [], 100);

$check('(a4.1) compared = 3', 3, $a4['compared'], 'only the 3 matched keys (sokramor excluded)');
$check('(a4.2) diff_row_count = 1', 1, $a4['diff_row_count'], 'only ferdok differs');
$check('(a4.3) diff key = wiki:ferdok', 'wiki:ferdok', $a4['diffs'][0]['key'] ?? null, 'the differing row');
$check(
    '(a4.4) diff field = settlement_class only',
    ['settlement_class'],
    array_keys($a4['diffs'][0]['fields'] ?? []),
    'name + continent agree; class differs'
);
$check(
    '(a4.5) diff old/new = stadt->dorf',
    ['old' => 'stadt', 'new' => 'dorf'],
    $a4['diffs'][0]['fields']['settlement_class'] ?? null,
    'old = DB value, new = dump value'
);
$check('(a4.6) field totals class = 1', 1, $a4['field_diff_totals']['settlement_class'] ?? 0, 'one class diff tallied');
$check('(a4.7) continent NOT in totals', false, isset($a4['field_diff_totals']['continent']), "DB '' vs dump NULL is not a diff");

// Per-field normaliser: DB is_ruined=1 (int) vs dump is_ruined=true (bool) must
// NOT be a diff once both are folded to '1'; but 0 vs 1 IS a diff.
$dbRuin = ['x' => ['is_ruined' => 1], 'y' => ['is_ruined' => 0]];
$dumpRuin = ['x' => ['is_ruined' => true], 'y' => ['is_ruined' => true]];
$ruinNorm = ['is_ruined' => static fn(mixed $v): string => !empty($v) && $v !== '0' ? '1' : '0'];
$a4ruin = avesmapsWikiDumpCompareFields($dumpRuin, $dbRuin, ['is_ruined'], $ruinNorm, 100);
$check('(a4.8) normaliser: 1 vs true = no diff', false, isset($a4ruin['diffs'][0]) && ($a4ruin['diffs'][0]['key'] ?? '') === 'x', 'int 1 folds to bool true');
$check('(a4.9) normaliser: 0 vs true = diff', 1, $a4ruin['diff_row_count'], 'only y (0 vs true) differs');

// Array field: order-independent JSON compare (same members, different order -> no diff).
$dbArr = ['k' => ['tags' => ['a', 'b']]];
$dumpArrSame = ['k' => ['tags' => ['a', 'b']]];
$a4arr = avesmapsWikiDumpCompareFields($dumpArrSame, $dbArr, ['tags'], [], 100);
$check('(a4.10) identical arrays = no diff', 0, $a4arr['diff_row_count'], 'array JSON-encoded, equal -> no diff');

echo "\n";

// ===========================================================================
// (A2) HIERARCHY DRIFT -- drift, agree, both_root, parent_locked exclusion.
// ===========================================================================
echo "-- A2  hierarchy drift --\n";

// child -> resolved parent key on each side.
//   ferdok:    db=mittelreich, dump=mittelreich          -> agree
//   huegelland:db=ferdok,      dump=kosch                -> DRIFT
//   kosch:     db=null,        dump=null                 -> both_root
//   sokramor:  db=null,        dump=horasreich           -> only_dump
//   tobrien:   db=bosparanisch,dump=null                 -> only_db
//   locked1:   db=X,           dump=Y  but parent_locked -> EXCLUDED
$dumpParent = [
    'wiki:ferdok' => 'wiki:mittelreich',
    'wiki:huegelland' => 'wiki:kosch',
    'wiki:kosch' => null,
    'wiki:sokramor' => 'wiki:horasreich',
    'wiki:tobrien' => null,
    'wiki:locked1' => 'wiki:dumpparent',
];
$dbParent = [
    'wiki:ferdok' => 'wiki:mittelreich',
    'wiki:huegelland' => 'wiki:ferdok',
    'wiki:kosch' => null,
    'wiki:sokramor' => null,
    'wiki:tobrien' => 'wiki:bosparanisch',
    'wiki:locked1' => 'wiki:dbparent',
];
$parentLocked = ['wiki:locked1'];

$a2 = avesmapsWikiDumpCompareHierarchy($dumpParent, $dbParent, $parentLocked, 100);

$check('(a2.1) locked_excluded = 1', 1, $a2['locked_excluded'], 'locked1 skipped as an editor override');
$check('(a2.2) compared = 5', 5, $a2['compared'], 'six keys minus the one locked');
$check('(a2.3) agree = 1', 1, $a2['agree'], 'ferdok parents match');
$check('(a2.4) both_root = 1', 1, $a2['both_root'], 'kosch is a root on both sides');
$check('(a2.5) drift_count = 3', 3, $a2['drift_count'], 'huegelland drift + sokramor only_dump + tobrien only_db');

// The drifts are sorted by key: huegelland, sokramor, tobrien.
$driftByKey = [];
foreach ($a2['drifts'] as $drift) {
    $driftByKey[$drift['key']] = $drift;
}
$check(
    '(a2.6) huegelland is a real drift',
    ['db_parent' => 'wiki:ferdok', 'dump_parent' => 'wiki:kosch', 'kind' => 'drift'],
    ['db_parent' => $driftByKey['wiki:huegelland']['db_parent'] ?? '', 'dump_parent' => $driftByKey['wiki:huegelland']['dump_parent'] ?? '', 'kind' => $driftByKey['wiki:huegelland']['kind'] ?? ''],
    'both parents present but different'
);
$check('(a2.7) sokramor = only_dump', 'only_dump', $driftByKey['wiki:sokramor']['kind'] ?? '', 'dump has a parent, DB does not');
$check('(a2.8) tobrien = only_db', 'only_db', $driftByKey['wiki:tobrien']['kind'] ?? '', 'DB has a parent, dump does not');
$check('(a2.9) locked1 NOT in drifts', false, isset($driftByKey['wiki:locked1']), 'the locked override never appears as a drift');

// All-agree case -> zero drifts.
$agreeOnly = avesmapsWikiDumpCompareHierarchy(
    ['a' => 'p', 'b' => null],
    ['a' => 'p', 'b' => null],
    [],
    100
);
$check('(a2.10) all agree -> 0 drifts', 0, $agreeOnly['drift_count'], 'identical hierarchies do not drift');

echo "\n";

// ===========================================================================
// (IDX) index helper -- last-write-wins map, raw keyList, skipped empties.
// ===========================================================================
echo "-- index helper --\n";

$records = [
    ['wiki_key' => 'wiki:a', 'name' => 'first A'],
    ['wiki_key' => 'wiki:b', 'name' => 'B'],
    ['wiki_key' => 'wiki:a', 'name' => 'second A'], // duplicate -> last write wins
    ['wiki_key' => '', 'name' => 'no key'],          // skipped
    ['name' => 'missing key field'],                 // skipped
];
$indexed = avesmapsWikiDumpIndexRecordsByKey($records, 'wiki_key');

$check('(idx.1) map has 2 distinct keys', 2, count($indexed['map']), 'a + b (empties dropped)');
$check('(idx.2) last write wins', 'second A', $indexed['map']['wiki:a']['name'] ?? null, 'duplicate key -> latest record');
$check('(idx.3) keyList keeps the dup', ['wiki:a', 'wiki:b', 'wiki:a'], $indexed['keyList'], 'raw sequence for dup detection');
$check('(idx.4) skipped = 2', 2, $indexed['skipped'], 'empty key + missing field both skipped');

// Round-trip: the keyList feeds A1 dup detection.
$rt = avesmapsWikiDumpCompareKeyCoverage($indexed['map'], $indexed['map'], $indexed['keyList'], 50);
$check('(idx.5) keyList drives A1 dup = [wiki:a]', ['wiki:a'], $rt['dup_keys'], 'index + coverage compose correctly');

echo "\n";

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
echo "----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);

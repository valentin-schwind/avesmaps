<?php

declare(strict_types=1);

/**
 * Unit tests for the editor activity claim (api/_internal/map/editor-activity.php).
 *
 * Only the PURE parts are covered: the whitelist, the label normaliser and above all
 * avesmapsPickEditorAreaClaim -- the function that decides who owns the write right for an
 * area. That decision deliberately does NOT live in SQL: there is no local database in this
 * project, so an ORDER BY ... LIMIT 1 would ship untested. The candidate rows are a handful
 * (one per connected editor), so filtering them in PHP costs nothing and buys a proof.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/editor-activity-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../editor-activity.php';

// --- the whitelist -------------------------------------------------------------------------
assert(avesmapsNormalizeEditorActivityArea('territories') === 'territories', 'known area survives');
assert(avesmapsNormalizeEditorActivityArea('  paths  ') === 'paths', 'whitespace is trimmed');
assert(avesmapsNormalizeEditorActivityArea('Territories') === 'territories', 'case is folded');
assert(avesmapsNormalizeEditorActivityArea('kitchen') === null, 'unknown area is dropped, not stored');
assert(avesmapsNormalizeEditorActivityArea('') === null, 'empty area clears the field');
assert(avesmapsNormalizeEditorActivityArea(null) === null, 'null clears the field');

// The label is free text (a territory name) but must not become an injection vector for the
// panel list, and must fit the column.
assert(avesmapsNormalizeEditorActivityLabel('  Fuerstentum Kosch  ') === 'Fuerstentum Kosch', 'label is trimmed');
assert(avesmapsNormalizeEditorActivityLabel('') === null, 'empty label clears the field');
assert(avesmapsNormalizeEditorActivityLabel(null) === null, 'null label clears the field');
assert(avesmapsNormalizeEditorActivityLabel("a\nb") === 'a b', 'newlines collapse to one line');
assert(mb_strlen((string) avesmapsNormalizeEditorActivityLabel(str_repeat('x', 400))) === 190, 'label is capped at the column width');

// --- the decision --------------------------------------------------------------------------
$row = static fn(int $id, string $name, int $sinceActivity, int $sinceSeen): array => [
    'user_id' => $id,
    'username' => $name,
    'activity_label' => null,
    'seconds_since_activity' => $sinceActivity,
    'seconds_since_seen' => $sinceSeen,
];

assert(avesmapsPickEditorAreaClaim([], 180) === null, 'nobody present -> no claim');

// THE core rule, and the one that inverts if someone writes ASC: seconds_since_activity is a
// DISTANCE, not a timestamp. The bigger it is, the earlier that person arrived -- and the
// earliest arrival owns the write right.
$twoEditors = [$row(7, 'Anna', 20, 5), $row(3, 'Valentin', 600, 10)];
$claim = avesmapsPickEditorAreaClaim($twoEditors, 180);
assert($claim !== null && $claim['user_id'] === 3, 'the one who arrived FIRST owns the claim, not the latest');

// Order of the input must not matter -- otherwise the answer depends on MySQL's row order.
$claimReversed = avesmapsPickEditorAreaClaim(array_reverse($twoEditors), 180);
assert($claimReversed !== null && $claimReversed['user_id'] === 3, 'input order does not change the owner');

// A stale heartbeat drops out entirely: this is what makes the claim self-releasing when a
// browser dies. 181 > 180 -> gone, and the next in line takes over.
$stale = [$row(3, 'Valentin', 600, 181), $row(7, 'Anna', 20, 5)];
$claimAfterStale = avesmapsPickEditorAreaClaim($stale, 180);
assert($claimAfterStale !== null && $claimAfterStale['user_id'] === 7, 'an expired heartbeat releases the claim');
assert(avesmapsPickEditorAreaClaim([$row(3, 'V', 600, 181)], 180) === null, 'everyone expired -> no claim');
assert(avesmapsPickEditorAreaClaim([$row(3, 'V', 600, 180)], 180) !== null, 'exactly at the limit still counts');

// Two editors opening in the same second must still produce ONE answer, identical for both.
$tie = avesmapsPickEditorAreaClaim([$row(9, 'Zoe', 42, 1), $row(4, 'Bea', 42, 1)], 180);
assert($tie !== null && $tie['user_id'] === 4, 'a tie is broken by the lower user_id, deterministically');

// The claim carries what the UI needs to say "Valentin, since 14:20".
$shape = avesmapsPickEditorAreaClaim([$row(3, 'Valentin', 600, 10)], 180);
assert($shape['username'] === 'Valentin', 'the holder name travels');
assert($shape['seconds_since_activity'] === 600, 'the age travels for the "since" line');
assert($shape['seconds_since_seen'] === 10, 'the freshness travels, so the panel can be honest about a stale holder');

// A row whose activity_since was never written (NULL -> null age) must not outrank a real one
// just because null casts to 0. It sorts last, which is the honest reading: we do not know when
// they arrived, so they do not get to claim seniority.
$withUnknown = avesmapsPickEditorAreaClaim([
    ['user_id' => 5, 'username' => 'Ohne', 'activity_label' => null, 'seconds_since_activity' => null, 'seconds_since_seen' => 5],
    $row(3, 'Valentin', 600, 10),
], 180);
assert($withUnknown['user_id'] === 3, 'a row without a known arrival time never outranks a known one');

// --- the two schema-shape predicates -------------------------------------------------------
// These decide whether the write gate stays OPEN. Getting them wrong in the "too narrow"
// direction means every territory save 500s until someone opens the presence panel; getting them
// wrong in the "too wide" direction means a genuine database fault is silently read as "nobody
// holds the claim". Both directions are covered.
assert(avesmapsIsMissingTableError(new PDOException("SQLSTATE[42S02]: Base table or view not found: 1146 Table 'x.editor_presence' doesn't exist")) === true, 'MySQL missing table detected');
assert(avesmapsIsMissingTableError(new PDOException('SQLSTATE[HY000]: General error: 1 no such table: editor_presence')) === true, 'SQLite missing table detected');
assert(avesmapsIsMissingColumnError(new PDOException("SQLSTATE[42S22]: Column not found: 1054 Unknown column 'activity_area' in 'where clause'")) === true, 'MySQL missing column detected');

// The state this whole retrofit exists for: table there, columns not yet. It must read as
// "missing column", NOT as "missing table" -- the repairs differ (ALTER vs CREATE).
$missingColumn = new PDOException("SQLSTATE[42S22]: Column not found: 1054 Unknown column 'activity_area' in 'where clause'");
assert(avesmapsIsMissingTableError($missingColumn) === false, 'a missing column is not mistaken for a missing table');

// A real fault must propagate, not be swallowed into "no claim".
$realFault = new PDOException('SQLSTATE[23000]: Integrity constraint violation');
assert(avesmapsIsMissingTableError($realFault) === false, 'an unrelated error is not a missing table');
assert(avesmapsIsMissingColumnError($realFault) === false, 'an unrelated error is not a missing column');
assert(avesmapsIsMissingColumnError(new PDOException('SQLSTATE[HY000]: MySQL server has gone away')) === false, 'a dead connection is a real failure, not a schema gap');

echo "editor-activity: ALL PASSED\n";

<?php

declare(strict_types=1);

/**
 * Unit test for the merge conflict rule (docs/quellen-wiki-key-instruction.md, step 5 + invariant 2).
 * No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/source-merge-test.php
 * Exit 0 = all asserts passed.
 *
 * This rule decides who OWNS a link after two sources are folded together. Get it wrong and
 * handwork silently becomes sync-owned -- at which point the next reconcile is entitled to
 * overwrite or delete it, and the editor who set it never finds out. Hence the test.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../feature-sources.php';

$link = static fn(string $origin, string $status = 'approved', ?string $pages = null, ?string $kind = null): array
    => ['origin' => $origin, 'status' => $status, 'pages' => $pages, 'reference_kind' => $kind];

// ---- origin precedence: manual > community > wiki_publication ----------------------------------
// Asserted in BOTH directions: the winner must not depend on which row happens to be the old one.
$out = avesmapsMergeWinningLink($link('manual'), $link('wiki_publication'));
assert($out['origin'] === 'manual', 'manual beats wiki_publication (old side)');
$out = avesmapsMergeWinningLink($link('wiki_publication'), $link('manual'));
assert($out['origin'] === 'manual', 'manual beats wiki_publication (new side)');

$out = avesmapsMergeWinningLink($link('community'), $link('wiki_publication'));
assert($out['origin'] === 'community', 'community beats wiki_publication');
$out = avesmapsMergeWinningLink($link('manual'), $link('community'));
assert($out['origin'] === 'manual', 'manual beats community');
$out = avesmapsMergeWinningLink($link('community'), $link('manual'));
assert($out['origin'] === 'manual', 'and the other way round');
echo "origin precedence ok\n";

// ---- no target row yet: the old link simply carries over ----------------------------------------
$out = avesmapsMergeWinningLink($link('community'), []);
assert($out['origin'] === 'community', 'with no existing link the old origin survives');
assert($out['status'] === 'approved', 'and stays approved');
// An unknown origin must not outrank a known one -- it ranks 0, it does not win by accident.
$out = avesmapsMergeWinningLink($link('something_new'), $link('wiki_publication'));
assert($out['origin'] === 'wiki_publication', 'an unrecognised origin never outranks a known one');
echo "missing/unknown ok\n";

// ---- suppression is a decision and survives from EITHER side ------------------------------------
// A tombstone means someone deliberately removed a wiki-derived source. A merge must not resurrect
// it -- that would silently undo the removal and the next reconcile would keep it alive.
$out = avesmapsMergeWinningLink($link('manual'), $link('wiki_publication', 'suppressed'));
assert($out['status'] === 'suppressed', 'suppressed on the target survives');
$out = avesmapsMergeWinningLink($link('wiki_publication', 'suppressed'), $link('manual'));
assert($out['status'] === 'suppressed', 'suppressed on the source survives too');
$out = avesmapsMergeWinningLink($link('manual'), $link('manual'));
assert($out['status'] === 'approved', 'two plain links stay approved');
echo "suppression ok\n";

// ---- reference details describe the citation, not the work --------------------------------------
$out = avesmapsMergeWinningLink($link('manual', 'approved', 'S. 12', 'erwaehnung'), $link('manual'));
assert($out['pages'] === 'S. 12', 'pages carry over when the target has none');
assert($out['reference_kind'] === 'erwaehnung', 'so does the coverage kind');

$out = avesmapsMergeWinningLink($link('manual', 'approved', 'S. 12'), $link('manual', 'approved', 'S. 99'));
assert($out['pages'] === 'S. 99', 'an existing target value is not overwritten');

// Empty string counts as absent, or a blank field would beat a real page number.
$out = avesmapsMergeWinningLink($link('manual', 'approved', 'S. 12'), $link('manual', 'approved', ''));
assert($out['pages'] === 'S. 12', 'an empty target value does not win over a real one');
echo "reference details ok\n";

echo "ALL OK\n";

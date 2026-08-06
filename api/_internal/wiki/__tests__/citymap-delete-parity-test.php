<?php

declare(strict_types=1);

/**
 * The two citymap delete paths must clear the same rows, in a safe order, atomically (finding A8).
 * No DB, no HTTP. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/citymap-delete-parity-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 The first version of this file let FOUR mutations through, two of which re-opened the very bugs
 * the commit claimed to fix. Every assert below was re-checked by breaking the thing it names.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// Read as TEXT: app/citymaps.php is not require-safe, and there is no database here anyway.
$syncSource = file_get_contents(__DIR__ . '/../citymap-sync.php');
$appSource = file_get_contents(__DIR__ . '/../../app/citymaps.php');
$dumpSource = file_get_contents(__DIR__ . '/../../../edit/wiki/dump.php');
assert(is_string($syncSource) && is_string($appSource) && is_string($dumpSource), 'all three sources readable');

// The cleaner's body, isolated once and used by every assert about it. Anchoring matters: an
// unanchored /s pattern happily runs past the closing brace and finds the same SQL elsewhere in a
// 2000-line file, which is how a one-sided citymap_related delete slipped through the first version.
assert(
    preg_match('/function avesmapsDeleteCitymapChildRows\([^)]*\)\s*:\s*void\s*\{(.*?)\n\}/s', $appSource, $match) === 1,
    'the shared child-row cleaner exists and its body can be isolated'
);
$cleanerBody = $match[1];

// --- 💣 One cleaner, and it clears everything that hangs off a card --------------------------------
//
// Until 2026-08-05 there were two: deleting by hand cleared citymap_related, citymap_place,
// citymap_type and citymap_link; the wiki sync cleared only place and type. Every sync-side deletion
// left orphans -- two paths, two results, for the same act.

foreach (['citymap_related', 'citymap_place', 'citymap_type', 'citymap_link'] as $childTable) {
    assert(str_contains($cleanerBody, $childTable), "the cleaner clears {$childTable}");
}
assert(
    str_contains($cleanerBody, 'citymap_id = :a OR related_citymap_id = :b'),
    'citymap_related is cleared on BOTH sides -- it links maps in both directions, and a one-sided '
        . 'delete leaves the mirror row'
);

// 💣 feature_sources hangs off entity_public_id, not citymap_id, and it is the dangerous one: citymaps
// are NOT in AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES, so the live-entity guard never filters
// them. A source reference to a deleted card keeps shipping in the PUBLIC map payload, forever. That is
// finding A6, for the one entity A6 exempted on the grounds that citymaps "keep their own delete
// semantics" -- which did not delete.
assert(
    str_contains($cleanerBody, "entity_type = 'citymap'") && str_contains($cleanerBody, 'feature_sources'),
    'the cleaner removes the card\'s source references, or they stay in the public payload for good'
);
// A sub-map points at its parent. Both readers swallow a dangling pointer silently, so the relation
// would vanish without a trace rather than come back empty.
assert(
    str_contains($cleanerBody, 'UPDATE citymap SET parent_id = NULL WHERE parent_id = :id'),
    'children of a deleted card lose their parent pointer instead of keeping a dangling one'
);

// Neither path may keep a second copy of any of this. The hand path must CALL the cleaner.
assert(
    !str_contains($syncSource, 'DELETE FROM citymap_place') && !str_contains($syncSource, 'DELETE FROM citymap_type'),
    'the sync carries no child deletes of its own -- that copy is how the two drifted apart'
);
// ⚠️ Matched by SHAPE, not by one spelling of the parameter list -- like the cleaner above. The
// signature gained a `?array $user` on 2026-08-06 (finding A16: the hand delete now writes an audit
// entry and has to name who did it), and a pinned parameter list turned this into a red test about
// nothing.
assert(
    preg_match('/function avesmapsDeleteCitymap\([^)]*\)\s*:\s*array\s*\{(.*?)\n\}/s', $appSource, $handMatch) === 1,
    'the hand path body can be isolated'
);
$handBody = $handMatch[1];
assert(
    str_contains($handBody, 'avesmapsDeleteCitymapChildRows($pdo, $id, $publicId);'),
    'the hand path calls the cleaner rather than inlining the deletes again'
);
foreach (['citymap_related', 'citymap_place', 'citymap_type', 'citymap_link'] as $childTable) {
    assert(
        !str_contains($handBody, "DELETE FROM {$childTable}"),
        "the hand path must not keep its own {$childTable} delete"
    );
}

// --- 💣 Card first, guard between, children after --------------------------------------------------
//
// The sync's DELETE carries `AND origin = 'wiki'` as a second guard. The child deletes used to run
// BEFORE it, so whenever that guard fired, the card survived having lost its places and types: the
// safeguard caused exactly the damage it existed to prevent. All THREE offsets are compared -- with
// only two, the guard can be moved below the cleanup and the same bug returns with the test green.
//
// ⚠️ The function was avesmapsCitymapRemoveVanished (a LOOP over everything the wiki dropped) until
// 2026-08-06. It is now one card per call, because the selection is made by a person in the
// Übernahme-Vorschau rather than by the catalog -- the sync only proposes (design §7). Everything
// this section asserts is about the body, and the body did not change.
assert(
    preg_match('/function avesmapsCitymapDeleteWikiRow\(PDO \$pdo, string \$wikiKey\): bool\s*\{(.*?)\n\}/s', $syncSource, $removeMatch) === 1,
    'the single-card delete body can be isolated'
);
$removeBody = $removeMatch[1];

$cardDeleteAt = strpos($removeBody, "\$delCard->execute(['id' => \$id]);");
$guardAt = strpos($removeBody, '$delCard->rowCount() < 1');
$childCleanAt = strpos($removeBody, 'avesmapsDeleteCitymapChildRows($pdo, $id, $publicId);');
assert(is_int($cardDeleteAt) && is_int($guardAt) && is_int($childCleanAt), 'all three steps are in the loop');
assert($cardDeleteAt < $guardAt, 'the card delete comes first');
assert($guardAt < $childCleanAt, 'the origin guard is checked BEFORE anything of the card is cleared');

// --- 💣 Atomic, like the hand path -----------------------------------------------------------------
//
// Order alone only swaps which damage an abort causes. Break between card and children and the card is
// gone while its children are orphaned FOREVER -- the removal list is built from LIVE citymap rows, so
// that id can never be named again. This step runs under a 43-second limit on a host with a
// FastCGI-kill history, so the window is real.
assert(str_contains($removeBody, '$pdo->beginTransaction();'), 'the per-card delete opens a transaction');
assert(str_contains($removeBody, '$pdo->commit();'), 'and commits it');
assert(str_contains($removeBody, '$pdo->rollBack();'), 'and rolls back on failure');
assert(
    str_contains($removeBody, '$ownsTransaction = !$pdo->inTransaction();'),
    'and never opens a nested one -- a caller may already own the transaction'
);

// --- ⚠️ What actually makes the runtime call work is PRESENCE, not order ---------------------------
//
// citymap-sync.php has no top-level statement at all, so it cannot observe a load order; the guard is
// evaluated at dispatch, long after every require has returned. The first version of this test asserted
// the ORDER of the two requires -- which protects nothing -- using a substring search that also matched
// a commented-out require. Commenting the require out therefore left the test green while every
// sync-side removal silently stopped cleaning up. What is asserted now is that the require exists.
assert(
    str_contains($syncSource, "if (function_exists('avesmapsDeleteCitymapChildRows')) {"),
    'the runtime call is guarded, like its neighbour'
);
assert(
    preg_match('/^\s*require(_once)?\s+__DIR__\s*\.\s*\'[^\']*_internal\/app\/citymaps\.php\'\s*;/m', $dumpSource) === 1,
    'api/edit/wiki/dump.php really REQUIRES app/citymaps.php -- without it the guarded call skips the '
        . 'cleanup without a sound and the orphans of A8 come straight back'
);

echo "citymap-delete-parity ok\n";

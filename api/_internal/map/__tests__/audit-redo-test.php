<?php

declare(strict_types=1);

/**
 * Unit tests for the change-log REDO rule (api/_internal/map/features.php):
 * avesmapsCanUndoAuditAction + avesmapsUndoColumnsForAuditAction + avesmapsRedoColumnsForUndoneAction.
 *
 * All three are pure. avesmapsUndoAuditChange itself takes a PDO and is NOT covered here -- what IS
 * covered is the part that decides WHETHER a "Rückgängig: …" entry can be undone and WHICH columns
 * that writes back, which is the whole of the redo.
 *
 * Background (2026-07-26): an undo entry used to be a dead end -- the endpoint refused it outright,
 * so an accidental Ctrl+Z could not be taken back through the UI at all. Two of the entries it ate
 * belonged to another editor.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/map/__tests__/audit-redo-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ---- a plain action is undoable, as before ---------------------------------------------------------
assert(avesmapsCanUndoAuditAction('update_point') === true, 'update_point stays undoable');
assert(avesmapsCanUndoAuditAction('wiki_sync_update_point') === true, 'wiki_sync_update_point stays undoable');
assert(avesmapsCanUndoAuditAction('create_label') === true, 'create_label stays undoable');
assert(avesmapsCanUndoAuditAction('delete_feature') === true, 'delete_feature stays undoable');
assert(avesmapsCanUndoAuditAction('acquire_lock') === false, 'an action with no undo columns stays refused');

// ---- an undo entry is now undoable -- that IS the redo button --------------------------------------
assert(avesmapsCanUndoAuditAction('undo_update_point') === true, 'undo_update_point can be restored');
assert(avesmapsCanUndoAuditAction('undo_wiki_sync_update_point') === true, 'undo_wiki_sync_update_point can be restored');
assert(avesmapsCanUndoAuditAction('undo_create_label') === true, 'undo_create_label can be restored');
assert(avesmapsCanUndoAuditAction('undo_delete_feature') === true, 'undo_delete_feature can be restored');
// The three entries the owner actually lost on 2026-07-26 -- all three must be recoverable.
foreach (['undo_wiki_sync_update_point', 'undo_update_point', 'undo_create_label'] as $lostEntry) {
    assert(avesmapsCanUndoAuditAction($lostEntry) === true, "the real incident entry {$lostEntry} is recoverable");
    assert(avesmapsUndoColumnsForAuditAction($lostEntry) !== [], "{$lostEntry} resolves to columns");
}

// ---- 💣 EXACTLY ONE LEVEL -------------------------------------------------------------------------
// A third level would push the action name past the 40-char column: avesmapsBuildUndoAuditAction()
// truncates, and "undo_undo_undo_undo_wiki_sync_update_point" (42) would be silently mangled into a
// name that no longer round-trips.
assert(avesmapsCanUndoAuditAction('undo_undo_update_point') === false, 'no second redo level');
assert(avesmapsCanUndoAuditAction('undo_undo_undo_update_point') === false, 'nor a third');
assert(strlen('undo_' . 'undo_undo_wiki_sync_update_point') <= 40, 'the deepest name the cap allows still fits the column');

// ---- 💣 THE COLUMNS: a redo writes back exactly what its undo overwrote ----------------------------
// Undoing a CREATE only deactivated the feature, so restoring it only touches is_active. Writing more
// would clobber every edit made to that feature since.
assert(avesmapsUndoColumnsForAuditAction('undo_create_label') === ['is_active'], 'restoring an undone create only flips is_active');
assert(avesmapsUndoColumnsForAuditAction('undo_create_point') === ['is_active'], 'same for a point');
assert(avesmapsUndoColumnsForAuditAction('undo_create_path') === ['is_active'], 'same for a path');

// Undoing a DELETE restored the whole row, so restoring that writes the whole row back.
assert(
    avesmapsUndoColumnsForAuditAction('undo_delete_feature') === avesmapsDeleteFeatureUndoColumns(),
    'restoring an undone delete writes the whole row'
);
assert(in_array('is_active', avesmapsDeleteFeatureUndoColumns(), true), 'and is_active is part of it');

// Everything else: the same columns the undo used, no more and no less.
foreach (['update_point', 'wiki_sync_update_point', 'update_label', 'update_path_details', 'update_powerline_details'] as $action) {
    assert(
        avesmapsUndoColumnsForAuditAction("undo_{$action}") === avesmapsUndoColumnsForAuditAction($action),
        "undo_{$action} restores exactly the columns {$action}'s undo wrote"
    );
}
assert(avesmapsUndoColumnsForAuditAction('undo_update_point') === ['name', 'feature_subtype', 'properties_json'], 'the point columns, spelled out');
assert(avesmapsUndoColumnsForAuditAction('undo_move_point') === ['geometry_json'], 'a move only moves back');

// An action that was never undoable does not become undoable by being prefixed.
assert(avesmapsUndoColumnsForAuditAction('undo_acquire_lock') === [], 'a non-undoable action stays non-undoable when prefixed');
assert(avesmapsCanUndoAuditAction('undo_acquire_lock') === false, 'and offers no button');

echo "audit redo tests passed\n";

<?php

declare(strict_types=1);

/**
 * Unit tests for the Landschaften undo gate (api/_internal/app/ecosystem.php):
 * avesmapsEcosystemCanUndoAction + avesmapsEcosystemActionLabel.
 *
 * Both are pure. avesmapsUndoEcosystemChange and avesmapsEcosystemRestoreAuditRow take a PDO and are
 * NOT covered here -- what IS covered is the decision of WHETHER a row may be taken back, which is the
 * gate the client's can_undo flag is derived from. One function, so panel and server cannot disagree.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/ecosystem-undo-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../ecosystem.php';

// ---- what may be taken back ---------------------------------------------------------------------
// The four the owner asked for: create, edit, delete, and the boolean operations -- the last of which
// are not an action of their own but a combination of the first three under one operation_id.
foreach ([
    'create_area',
    'update_area_geometry',
    'delete_area',
    'delete_area_with_region',
    'discard_trial_area',
    'create_region',
    'update_region',
    'delete_region',
    'delete_region_cascade',
    'assign_wiki_region',
] as $action) {
    assert(avesmapsEcosystemCanUndoAction($action) === true, "{$action} is undoable");
    assert(avesmapsEcosystemActionLabel($action) !== $action, "{$action} has a German label");
}

// ---- 💣 EXACTLY ONE LEVEL ------------------------------------------------------------------------
// Undoing an undo is not offered. Taking a "Rückgängig" back means doing the gesture again -- and the
// action column would grow a prefix per level.
assert(avesmapsEcosystemCanUndoAction('undo_update_area_geometry') === false, 'no undo of an undo');
assert(avesmapsEcosystemCanUndoAction('undo_create_area') === false, 'nor for a create');
assert(avesmapsEcosystemCanUndoAction('undo_undo_delete_area') === false, 'nor deeper');

// ---- actions that touch nothing restorable -------------------------------------------------------
// Everything not on the list is refused rather than silently doing nothing. A button that appears and
// then achieves nothing is worse than no button.
assert(avesmapsEcosystemCanUndoAction('set_enabled') === false, 'the kill switch is not an edit');
assert(avesmapsEcosystemCanUndoAction('promote_trial') === false, 'ending the trial is not an edit');
assert(avesmapsEcosystemCanUndoAction('') === false, 'an empty action is refused');
assert(avesmapsEcosystemCanUndoAction('nonsense') === false, 'an unknown action is refused');

// ---- the label falls back to the raw action rather than to an empty string -----------------------
// An unlabelled row still has to say something in the panel; a blank line reads as a bug.
assert(avesmapsEcosystemActionLabel('nonsense') === 'nonsense', 'unknown action falls back to itself');
assert(avesmapsEcosystemActionLabel('update_area_geometry') === 'Fläche bearbeitet', 'the edit label, spelled out');
assert(avesmapsEcosystemActionLabel('delete_area') === 'Fläche gelöscht', 'the delete label');

echo "ecosystem undo tests passed\n";

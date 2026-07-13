<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE override-safe diff core in api/_internal/wiki/adventure-sync.php.
 * No DB, no HTTP -- hand-built row arrays only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/adventure-sync-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../adventure-sync.php';

// ----------------------------------------------------------------- FIELD PLAN ---
// A changed, non-manual field is written; an unchanged field is skipped (idempotency); a manual
// override is protected; a field the wiki does not carry is left alone.
$current = ['title' => 'Siegelbruch', 'genre' => 'Alt', 'edition' => 'DSA5', 'complexity_gm' => 'mittel'];
$desired = ['title' => 'Siegelbruch', 'genre' => 'Intrige', 'edition' => 'DSA5', 'complexity_gm' => 'hoch'];
$origins = ['complexity_gm' => 'manual']; // the owner hand-set the GM complexity
$plan = avesmapsAdventureFieldPlan($current, $desired, $origins);
assert($plan['set'] === ['genre' => 'Intrige']);          // only genre changed & is not protected
assert($plan['origins'] === ['genre' => 'wiki']);
assert(!array_key_exists('title', $plan['set']));          // unchanged -> no-op
assert(!array_key_exists('edition', $plan['set']));        // unchanged -> no-op
assert(!array_key_exists('complexity_gm', $plan['set']));  // manual override protected
echo "fieldplan ok\n";

// Null vs '' are equal (no spurious write); a genuinely new value from '' is written.
$plan = avesmapsAdventureFieldPlan(['series' => null], ['series' => ''], []);
assert($plan['set'] === []);
$plan = avesmapsAdventureFieldPlan(['series' => ''], ['series' => 'Dämonenmacht & Sternenkraft'], []);
assert($plan['set'] === ['series' => 'Dämonenmacht & Sternenkraft']);
// A repeat reconcile is a full no-op.
$plan = avesmapsAdventureFieldPlan(['genre' => 'Intrige'], ['genre' => 'Intrige'], ['genre' => 'wiki']);
assert($plan['set'] === []);
echo "fieldplan-idempotent ok\n";

// ----------------------------------------------------------------- PLACE PLAN ---
// Fresh adventure (no current places): every desired place is an ADD, in order, start first.
$desiredPlaces = [
    ['sort_order' => 0, 'raw_name' => 'Mittelreich', 'role' => 'start'],
    ['sort_order' => 1, 'raw_name' => 'Gareth', 'role' => 'play'],
];
$plan = avesmapsAdventurePlacePlan([], $desiredPlaces);
assert(count($plan['add']) === 2 && $plan['update'] === [] && $plan['remove'] === []);
assert($plan['add'][0] === ['sort_order' => 0, 'raw_name' => 'Mittelreich', 'role' => 'start']);
echo "placeplan-add ok\n";

// A manual place and a suppressed wiki tombstone are untouched; a matching wiki place with a changed
// name UPDATES in place; a trailing wiki place no longer in the list is REMOVED.
$currentPlaces = [
    ['id' => 10, 'sort_order' => 0, 'raw_name' => 'Mittelreich', 'role' => 'start', 'origin' => 'wiki', 'status' => 'approved'],
    ['id' => 11, 'sort_order' => 1, 'raw_name' => 'Garethien', 'role' => 'play', 'origin' => 'wiki', 'status' => 'approved'],
    ['id' => 12, 'sort_order' => 2, 'raw_name' => 'Wagenhalt', 'role' => 'play', 'origin' => 'wiki', 'status' => 'approved'],
    ['id' => 20, 'sort_order' => 5, 'raw_name' => 'Mein Lieblingsort', 'role' => 'play', 'origin' => 'manual', 'status' => 'approved'],
    ['id' => 30, 'sort_order' => 3, 'raw_name' => 'Perricum', 'role' => 'play', 'origin' => 'wiki', 'status' => 'suppressed'],
];
$desiredPlaces = [
    ['sort_order' => 0, 'raw_name' => 'Mittelreich', 'role' => 'start'],   // unchanged
    ['sort_order' => 1, 'raw_name' => 'Königreich Garetien', 'role' => 'play'], // renamed -> update id 11
    // sort_order 2 (Wagenhalt) dropped from the list -> remove id 12
    ['sort_order' => 3, 'raw_name' => 'Perricum', 'role' => 'play'],       // tombstoned -> NOT re-added
];
$plan = avesmapsAdventurePlacePlan($currentPlaces, $desiredPlaces);
assert($plan['update'] === [['id' => 11, 'sort_order' => 1, 'raw_name' => 'Königreich Garetien', 'role' => 'play']]);
assert($plan['remove'] === [['id' => 12]]);           // trailing wiki place gone -> removed
assert($plan['add'] === []);                          // Perricum tombstoned, Mittelreich unchanged
echo "placeplan-override ok\n";

// A wiki place suppressed by the editor is not resurrected even at a fresh position.
$currentPlaces = [
    ['id' => 40, 'sort_order' => 0, 'raw_name' => 'Havena', 'role' => 'start', 'origin' => 'wiki', 'status' => 'suppressed'],
];
$plan = avesmapsAdventurePlacePlan($currentPlaces, [['sort_order' => 0, 'raw_name' => 'Havena', 'role' => 'start']]);
assert($plan['add'] === [] && $plan['update'] === [] && $plan['remove'] === []);
echo "placeplan-tombstone ok\n";

echo "ALL ADVENTURE-SYNC DIFF TESTS PASSED\n";

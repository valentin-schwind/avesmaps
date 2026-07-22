<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE collapse core of the lore_source -> feature_sources migration
 * (api/_internal/wiki/lore-source-migration.php). No DB -- hand-built row arrays only.
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/lore-source-migration-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../lore-source-migration.php';

// ------------------------------------------------------------------ WINNER ---
// A single ordinary wiki row: the two vocabularies are translated, nothing else changes.
$winner = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => 'ausfuehrlich', 'pages' => '110', 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert($winner['reference_kind'] === 'ausfuehrlich');
assert($winner['pages'] === '110');
assert($winner['note'] === null);
assert($winner['origin'] === 'wiki_publication');   // lore 'wiki' IS a wiki publication link
assert($winner['status'] === 'approved');           // lore 'active' IS feature_sources 'approved'
echo "winner-single ok\n";

// 💣 THE COLLAPSE. lore_source is unique per (entry, publication, reference_kind, sort_order),
// feature_sources per (entity, source). Several rows for ONE publication therefore become ONE
// link -- and the FIRST mention in the wiki article (lowest sort_order) supplies its detail.
$winner = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => 'erwaehnung', 'pages' => '77', 'note' => 'spaeter', 'sort_order' => 5,
     'origin' => 'wiki', 'status' => 'active'],
    ['reference_kind' => 'ausfuehrlich', 'pages' => '12', 'note' => 'zuerst', 'sort_order' => 1,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert($winner['reference_kind'] === 'ausfuehrlich');
assert($winner['pages'] === '12');
assert($winner['note'] === 'zuerst');
echo "winner-lowest-sort-order ok\n";

// Input order must not decide the outcome -- the migration has to be reproducible.
$reversed = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => 'ausfuehrlich', 'pages' => '12', 'note' => 'zuerst', 'sort_order' => 1,
     'origin' => 'wiki', 'status' => 'active'],
    ['reference_kind' => 'erwaehnung', 'pages' => '77', 'note' => 'spaeter', 'sort_order' => 5,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert($reversed === $winner);
echo "winner-order-independent ok\n";

// 💣 A HAND-MADE row wins the origin outright: the whole point of origin='manual' is that a
// later reconcile leaves it alone. Demoting it here would hand it back to the sync.
$winner = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => 'ausfuehrlich', 'pages' => '1', 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
    ['reference_kind' => 'ergaenzend', 'pages' => '2', 'note' => null, 'sort_order' => 9,
     'origin' => 'manual', 'status' => 'active'],
]);
assert($winner['origin'] === 'manual');
assert($winner['pages'] === '1'); // detail still comes from the lowest sort_order
echo "winner-manual-wins ok\n";

// 💣 A SUPPRESSED row is a tombstone -- a deliberate act. It survives the collapse, exactly as
// avesmapsMergeWinningLink keeps suppression across a source merge.
$winner = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => 'ausfuehrlich', 'pages' => null, 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
    ['reference_kind' => 'ausfuehrlich', 'pages' => null, 'note' => null, 'sort_order' => 3,
     'origin' => 'wiki', 'status' => 'suppressed'],
]);
assert($winner['status'] === 'suppressed');
echo "winner-suppressed-survives ok\n";

// Empty strings are NOT data: they must reach feature_sources as NULL, or a repeat reconcile
// would see '' vs null and rewrite the row forever (avesmapsPublicationReferenceFieldsDiffer
// treats them as equal, so a spurious difference here would be invisible but real).
$winner = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => '', 'pages' => '', 'note' => '', 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert($winner['reference_kind'] === null);
assert($winner['pages'] === null);
assert($winner['note'] === null);
echo "winner-empty-is-null ok\n";

// An unknown reference_kind is dropped rather than carried: feature_sources only knows three.
$winner = avesmapsLoreSourceMigrationWinner([
    ['reference_kind' => 'phantasie', 'pages' => null, 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert($winner['reference_kind'] === null);
echo "winner-unknown-kind-dropped ok\n";

// An empty group has no winner -- the caller must skip it, not write a blank link.
assert(avesmapsLoreSourceMigrationWinner([]) === null);
echo "winner-empty-group ok\n";

// ------------------------------------------------------------------- GROUP ---
// Flat lore_source rows -> one entry per (entry, publication) pair. THIS is where the row count
// shrinks, and the count reconciliation has to expect it.
$grouped = avesmapsLoreSourceMigrationGroup([
    ['entry_wiki_key' => 'kronenhirsch', 'publication_wiki_key' => 'zba', 'publication_title' => 'ZBA',
     'reference_kind' => 'ausfuehrlich', 'pages' => '110', 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
    ['entry_wiki_key' => 'kronenhirsch', 'publication_wiki_key' => 'zba', 'publication_title' => 'ZBA',
     'reference_kind' => 'erwaehnung', 'pages' => '250', 'note' => null, 'sort_order' => 1,
     'origin' => 'wiki', 'status' => 'active'],
    ['entry_wiki_key' => 'kronenhirsch', 'publication_wiki_key' => 'gdv', 'publication_title' => 'GdV',
     'reference_kind' => 'ergaenzend', 'pages' => '5', 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
    ['entry_wiki_key' => 'wirselkraut', 'publication_wiki_key' => 'zba', 'publication_title' => 'ZBA',
     'reference_kind' => 'ausfuehrlich', 'pages' => '9', 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert(count($grouped) === 3); // 4 rows -> 3 links: the two ZBA rows of one entry are ONE link
$byKey = [];
foreach ($grouped as $row) {
    $byKey[$row['entry_wiki_key'] . '|' . $row['publication_wiki_key']] = $row;
}
assert(isset($byKey['kronenhirsch|zba'], $byKey['kronenhirsch|gdv'], $byKey['wirselkraut|zba']));
assert($byKey['kronenhirsch|zba']['pages'] === '110'); // the lowest sort_order won
assert($byKey['kronenhirsch|zba']['publication_title'] === 'ZBA');
echo "group-collapses-pairs ok\n";

// A row without an entry or without a publication cannot become a link -- it is dropped, and the
// caller reports the number so a shortfall is explainable rather than mysterious.
$grouped = avesmapsLoreSourceMigrationGroup([
    ['entry_wiki_key' => '', 'publication_wiki_key' => 'zba', 'publication_title' => 'ZBA',
     'reference_kind' => '', 'pages' => null, 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
    ['entry_wiki_key' => 'kronenhirsch', 'publication_wiki_key' => '', 'publication_title' => '',
     'reference_kind' => '', 'pages' => null, 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
]);
assert($grouped === []);
echo "group-drops-keyless ok\n";

// The same input twice yields the same output: a re-run of the migration is a no-op, not a
// second interpretation of the data.
$input = [
    ['entry_wiki_key' => 'a', 'publication_wiki_key' => 'p', 'publication_title' => 'P',
     'reference_kind' => 'ausfuehrlich', 'pages' => '1', 'note' => null, 'sort_order' => 0,
     'origin' => 'wiki', 'status' => 'active'],
];
assert(avesmapsLoreSourceMigrationGroup($input) === avesmapsLoreSourceMigrationGroup($input));
echo "group-deterministic ok\n";

// ---------------------------------------------------------------- IDENTITY ---
// The migration MUST compute the identity the reconcile computes, or the same book lands in the
// catalogue twice. Three cases, mirroring avesmapsPublicationDesiredLinksForEntity.
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'ZBA', ['chosen_url' => 'https://shop/zba', 'has_link' => 1]);
assert($identity['url'] === 'https://shop/zba' && $identity['wiki_key'] === '');
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'ZBA', ['chosen_url' => '', 'has_link' => 0]);
assert($identity['url'] === '' && $identity['wiki_key'] === 'zba');
// Not in the catalogue at all (stale/incomplete staging): URL-less by wiki_key, so a later
// catalogue row with has_link=0 MERGES with this one instead of duplicating it.
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'ZBA', null);
assert($identity['url'] === '' && $identity['wiki_key'] === 'zba');
assert($identity['label'] === 'ZBA');
echo "identity ok\n";

// The catalogue owns the label when it has one; the stored lore title is only the fallback.
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'Alter Titel', ['chosen_url' => '', 'has_link' => 0, 'title' => 'Neuer Titel']);
assert($identity['label'] === 'Neuer Titel');
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'Alter Titel', ['chosen_url' => '', 'has_link' => 0, 'title' => '']);
assert($identity['label'] === 'Alter Titel');
echo "identity-label ok\n";

// A publication is an official source; its type comes from the catalogue when known.
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'ZBA', ['chosen_url' => '', 'has_link' => 0, 'source_type' => 'quellenband']);
assert($identity['source_type'] === 'quellenband');
$identity = avesmapsLoreSourceMigrationIdentity('zba', 'ZBA', null);
assert($identity['source_type'] === 'sonstiges');
echo "identity-type ok\n";

echo "\nALL OK\n";

<?php

declare(strict_types=1);

/**
 * The two citymap delete paths must clear the same child rows (finding A8). No DB, no HTTP. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/citymap-delete-parity-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// Both files are read as TEXT. citymap-sync.php is deliberately require-safe, but app/citymaps.php is
// not, and this test is about what the two files SAY -- there is no database here to delete anything in.
$syncSource = file_get_contents(__DIR__ . '/../citymap-sync.php');
$appSource = file_get_contents(__DIR__ . '/../../app/citymaps.php');
$dumpSource = file_get_contents(__DIR__ . '/../../../edit/wiki/dump.php');
assert(is_string($syncSource) && is_string($appSource) && is_string($dumpSource), 'all three sources readable');

// --- 💣 One cleaner, used by both paths ------------------------------------------------------------
//
// Until 2026-08-05 there were two: deleting by hand cleared citymap_related, citymap_place,
// citymap_type and citymap_link; the wiki sync cleared only place and type. Every sync-side deletion
// therefore left citymap_related and citymap_link rows behind as orphans -- two paths, two results,
// for the same act. A third table added tomorrow would have had to be remembered in two places.

assert(
    str_contains($appSource, 'function avesmapsDeleteCitymapChildRows(PDO $pdo, int $citymapId): void'),
    'the shared child-row cleaner exists'
);
foreach (['citymap_related', 'citymap_place', 'citymap_type', 'citymap_link'] as $childTable) {
    assert(
        preg_match('/function avesmapsDeleteCitymapChildRows\(.*?\n\}/s', $appSource, $body) === 1
            && str_contains($body[0], $childTable),
        "the cleaner clears {$childTable}"
    );
}
// citymap_related links maps BOTH ways, so one-sided deletion leaves the mirror row.
assert(
    preg_match('/function avesmapsDeleteCitymapChildRows\(.*?citymap_id = :a OR related_citymap_id = :b/s', $appSource) === 1,
    'and clears citymap_related on both sides'
);

// Neither path may keep its own copy of those deletes.
foreach ([[$appSource, 'app/citymaps.php'], [$syncSource, 'citymap-sync.php']] as [$source, $label]) {
    assert(
        !preg_match('/DELETE FROM citymap_place WHERE citymap_id/', $source)
            || $label === 'app/citymaps.php',
        "{$label} must not carry its own child deletes"
    );
}
assert(
    !str_contains($syncSource, 'DELETE FROM citymap_place'),
    'the sync no longer carries its own place delete -- that copy is how the two drifted'
);
assert(
    !str_contains($syncSource, 'DELETE FROM citymap_type'),
    'nor its own type delete'
);
assert(
    str_contains($syncSource, 'avesmapsDeleteCitymapChildRows($pdo, (int) $id);'),
    'the sync calls the shared cleaner instead'
);

// --- 💣 The card goes first, the children after ----------------------------------------------------
//
// The sync's DELETE carries `AND origin = 'wiki'` as a second guard. The child deletes used to run
// BEFORE it, so whenever that guard actually fired, the card survived and had lost its places and
// types: the safeguard caused exactly the damage it was there to prevent. Without a foreign key the
// order is free, so it is the right way round now -- and the cleanup only runs once the card is gone.
$removeBody = null;
if (preg_match('/function avesmapsCitymapRemoveVanished\(PDO \$pdo\): int\s*\{(.*?)\n\}/s', $syncSource, $match) === 1) {
    $removeBody = $match[1];
}
assert(is_string($removeBody), 'the vanish-remover body can be isolated');

$cardDeleteAt = strpos($removeBody, "\$delCard->execute(['id' => (int) \$id]);");
$childCleanAt = strpos($removeBody, 'avesmapsDeleteCitymapChildRows($pdo, (int) $id);');
assert(is_int($cardDeleteAt) && is_int($childCleanAt), 'both steps are in the loop');
assert($cardDeleteAt < $childCleanAt, 'the card is deleted before its children are cleared');
assert(
    preg_match('/\$delCard->rowCount\(\) < 1\)\s*\{\s*continue;/', $removeBody) === 1,
    'and a card the origin guard refused stops the loop before anything of it is touched'
);

// --- ⚠️ The runtime call depends on a load order, so the load order is asserted ---------------------
//
// citymap-sync.php deliberately requires nothing (its own header says so: the unit test must be able
// to include it without MySQL), and calls neighbouring libraries at runtime behind a function_exists
// guard -- the same shape avesmapsCitymapsEnsureTables already uses here. That guard means a missing
// library degrades to "no cleanup" rather than a fatal, so the endpoint's load order is what actually
// makes it work, and nothing else asserts it.
assert(
    str_contains($syncSource, "if (function_exists('avesmapsDeleteCitymapChildRows')) {"),
    'the runtime call is guarded, like its neighbour'
);
$appRequireAt = strpos($dumpSource, "_internal/app/citymaps.php");
$syncRequireAt = strpos($dumpSource, "_internal/wiki/citymap-sync.php");
assert(is_int($appRequireAt) && is_int($syncRequireAt), 'the dump endpoint loads both libraries');
assert(
    $appRequireAt < $syncRequireAt,
    'and loads the app library FIRST -- otherwise the guarded call silently skips the cleanup and the '
        . 'orphan rows of A8 come straight back'
);

echo "citymap-delete-parity ok\n";

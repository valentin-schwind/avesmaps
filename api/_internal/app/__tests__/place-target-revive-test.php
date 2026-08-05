<?php

declare(strict_types=1);

/**
 * A resolved place target whose element was deleted must be reset, not kept (finding A10). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/place-target-revive-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../adventure-resolve.php';

// ===== THE RULE UNDER TEST =====
// avesmapsResolvePlacesInTable only ever looked at rows that were 'unresolved' or had no territory
// path. A row resolved once was never examined again -- not even after its target had been deleted.
// Measured: 516 adventure_place rows and 14 citymap_place rows point at a public_id that no longer
// exists, and for 61 of the 75 affected names a label of the SAME NAME exists under a different id --
// the label was replaced, the pointer was not. The client's wiki-key fallback rescues 491 of the 516;
// the other 25 lose their adventure section in the infobox without a word.

function avesmapsTestPlaceSchema(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE adventure_place (
        id INTEGER PRIMARY KEY,
        status TEXT,
        raw_name TEXT,
        target_kind TEXT,
        target_public_id TEXT,
        target_wiki_key TEXT,
        target_territory_path TEXT
    )');
    $pdo->exec('CREATE TABLE map_features (public_id TEXT, is_active INTEGER)');
    $pdo->exec('CREATE TABLE political_territory (public_id TEXT)');
    $pdo->exec("INSERT INTO map_features VALUES ('lebt-1', 1), ('lebt-2', 1), ('stillgelegt', 0)");
    $pdo->exec("INSERT INTO political_territory VALUES ('terr-lebt')");

    return $pdo;
}

function avesmapsTestInsertPlace(PDO $pdo, int $id, string $status, string $kind, ?string $publicId, string $rawName): void
{
    $pdo->prepare('INSERT INTO adventure_place VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([
        $id, $status, $rawName, $kind, $publicId, 'wiki:' . $rawName, '["irgendein","pfad"]',
    ]);
}

$pdo = avesmapsTestPlaceSchema();
avesmapsTestInsertPlace($pdo, 1, 'approved', 'settlement', 'lebt-1', 'Gareth');
avesmapsTestInsertPlace($pdo, 2, 'approved', 'settlement', 'fort', 'Wildermark');
avesmapsTestInsertPlace($pdo, 3, 'approved', 'region', 'stillgelegt', 'Blautann');
avesmapsTestInsertPlace($pdo, 4, 'approved', 'territory', 'terr-lebt', 'Kosch');
avesmapsTestInsertPlace($pdo, 5, 'approved', 'territory', 'terr-fort', 'Almada');
avesmapsTestInsertPlace($pdo, 6, 'approved', 'path', 'lebt-2', 'Reichsstrasse');
avesmapsTestInsertPlace($pdo, 7, 'approved', 'unresolved', null, 'Nie aufgeloest');
avesmapsTestInsertPlace($pdo, 8, 'suppressed', 'settlement', 'fort', 'Unterdrueckt');
avesmapsTestInsertPlace($pdo, 9, 'approved', 'settlement', '', 'Leerer Zeiger');

$revived = avesmapsResetVanishedPlaceTargets($pdo, 'adventure_place');

$rows = [];
foreach ($pdo->query('SELECT * FROM adventure_place ORDER BY id')->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $rows[(int) $row['id']] = $row;
}

// --- What must be reset ----------------------------------------------------------------------------

assert($rows[2]['target_kind'] === 'unresolved', 'a pointer at a public_id that no longer exists is reset');
assert($rows[2]['target_public_id'] === null, 'and the dead id is cleared');
assert($rows[2]['target_wiki_key'] === null, 'and the stale wiki key with it');
assert($rows[2]['target_territory_path'] === null, 'and the territory path, which was computed from it');
// 💣 raw_name is the ONLY way back. Without it a dead pointer would not be reset but lost -- the
// resolver matches on raw_name, and 61 of the 75 affected names have a live label under a new id.
assert($rows[2]['raw_name'] === 'Wildermark', 'raw_name survives -- it is the only way back');

// A soft-deleted feature counts as gone: it is off the map, so the pointer is as dead as a removed one.
assert($rows[3]['target_kind'] === 'unresolved', 'a soft-deleted target counts as vanished');

assert($rows[5]['target_kind'] === 'unresolved', 'a territory that no longer exists is reset too');

// --- 💣 What must NOT be touched -- and the territory is the dangerous one -------------------------
//
// 'territory' points into political_territory, the other three into map_features. Checking a territory
// against map_features would find nothing and wipe EVERY territory assignment in the table -- a fix
// that destroys far more than the bug it repairs.
assert($rows[4]['target_kind'] === 'territory' && $rows[4]['target_public_id'] === 'terr-lebt',
    'a live territory is left alone -- it is not looked for in map_features');

assert($rows[1]['target_kind'] === 'settlement' && $rows[1]['target_public_id'] === 'lebt-1', 'a live settlement stays');
assert($rows[6]['target_kind'] === 'path' && $rows[6]['target_public_id'] === 'lebt-2', 'a live path stays');
assert($rows[7]['target_kind'] === 'unresolved', 'an already-unresolved row is not counted twice');
assert($rows[8]['target_kind'] === 'settlement', 'a row that is not approved is none of this pass\'s business');
assert($rows[9]['target_kind'] === 'settlement', 'an empty pointer is not a dead one');

assert($revived === 3, 'exactly the three dead pointers were reset, got ' . $revived);

// Running it again changes nothing -- the pass is idempotent, which matters because it runs on every
// resolve, including the two the citymap editor triggers.
assert(avesmapsResetVanishedPlaceTargets($pdo, 'adventure_place') === 0, 'a second run finds nothing left');

// An empty table must not fail or query anything further.
$emptyPdo = avesmapsTestPlaceSchema();
assert(avesmapsResetVanishedPlaceTargets($emptyPdo, 'adventure_place') === 0, 'an empty table resets nothing');

// The table name is whitelisted -- it is interpolated into the SQL.
$rejected = false;
try {
    avesmapsResetVanishedPlaceTargets($pdo, 'adventure_place; DROP TABLE map_features');
} catch (InvalidArgumentException) {
    $rejected = true;
}
assert($rejected, 'an unknown table name is refused, not interpolated');

// --- 💣 The reset must run BEFORE the resolver reads its work list ---------------------------------
//
// Resetting a row to 'unresolved' is only half a repair: the point is that the existing resolution then
// picks it up in the SAME run and finds the label under its new id. Run it afterwards and every
// repaired row waits for the next sync -- which for adventure_place is owner-triggered and rare.
$source = file_get_contents(__DIR__ . '/../adventure-resolve.php');
assert(is_string($source), 'source readable');
assert(
    preg_match('/function avesmapsResolvePlacesInTable\(PDO \$pdo, string \$table\): array\s*\n\{(.*?)\n\}/s', $source, $match) === 1,
    'the resolver body can be isolated'
);
$body = $match[1];
$resetAt = strpos($body, 'avesmapsResetVanishedPlaceTargets($pdo, $table)');
$selectAt = strpos($body, "FROM {\$table}");
assert(is_int($resetAt) && is_int($selectAt), 'both steps are in the resolver');
assert($resetAt < $selectAt, 'the reset runs first, so the freed rows are resolved in the same pass');

// ⚠️ The comparison stays in PHP on purpose: target_public_id is VARCHAR(64) and public_id is CHAR(36),
// in different tables -- a NOT EXISTS join would be the column-vs-column comparison that took two
// public endpoints to 500 on 2026-08-05, and there is no local MySQL to try it on.
assert(
    !preg_match('/NOT EXISTS\s*\(\s*SELECT[^)]*map_features/i', $source),
    'no cross-table column comparison sneaked back into SQL'
);

echo "place-target-revive ok\n";

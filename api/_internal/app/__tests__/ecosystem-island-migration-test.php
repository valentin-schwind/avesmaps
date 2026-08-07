<?php

declare(strict_types=1);

/**
 * Unit test for the 2026-07-30 island migration (api/_internal/app/ecosystem.php):
 * avesmapsEcosystemMoveIslandsToTopographie.
 *
 * Unlike its neighbours this one DOES drive the real PDO path, against sqlite::memory:. It has to:
 * the whole risk of this step sits in three SQL statements -- the guard, the move and the
 * deactivation -- and a test built on pre-cooked results would stay green while the WHERE clauses
 * moved the wrong rows. Same reasoning as game-literature-resolve-candidates-test.php.
 *
 * ⭐ HOW THE REVISION BUMP IS PROVEN WITHOUT MySQL. avesmapsNextEcosystemRevision() uses
 * `ON DUPLICATE KEY UPDATE`, which sqlite rejects with `near "DUPLICATE": syntax error`. That turns
 * the missing feature into the assertion:
 *   - first run  -> MUST throw, and the message MUST name DUPLICATE. That proves execution reached
 *                   the bump, i.e. the line is still there. Any OTHER message fails the test, so
 *                   nothing is swallowed.
 *   - second run -> MUST NOT throw at all. The only way past the bump is the guard returning early,
 *                   so this is the idempotence proof and the guard proof in one.
 * 💣 Do not "fix" this by catching Throwable broadly -- the point is that a DIFFERENT error is a
 * failure. See the vm-sandbox-stub lesson: a tolerant catch turns a test into a fallback check.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=pdo_sqlite api/_internal/app/__tests__/ecosystem-island-migration-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- re-run with -d extension=pdo_sqlite.\n");
    exit(2);
}

require __DIR__ . '/../ecosystem.php';

assert(
    function_exists('avesmapsEcosystemMoveIslandsToTopographie'),
    'the migration function exists under the name EnsureTables calls'
);

/**
 * A fresh in-memory database with the three tables the migration touches and a deliberately mixed
 * stock: islands that must move, and four rows of other kinds that must not.
 */
function islandTestDatabase(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $pdo->exec('CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        region_type TEXT NULL
    )');
    $pdo->exec('CREATE TABLE ecosystem_region_type (
        kind TEXT NOT NULL,
        type_key TEXT NOT NULL,
        label TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (kind, type_key)
    )');
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');

    // Named after the real stock so a failure reads like the map: Maraskan and Bilku are islands,
    // Bilku-Archipel is the group that shared their type and is what started this whole change.
    foreach ([
        ['Maraskan', 'derographisch', 'insel'],
        ['Bilku', 'derographisch', 'insel'],
        ['Bilku-Archipel', 'derographisch', 'insel'],
        ['Kosch', 'derographisch', 'region'],
        ['Aventurien', 'derographisch', 'kontinent'],
        ['Raschtulswall', 'topographie', 'gebirge'],
        ['Farindel', 'vegetation', 'wald'],
    ] as [$name, $kind, $type]) {
        $statement = $pdo->prepare('INSERT INTO ecosystem_region (name, kind, region_type) VALUES (?, ?, ?)');
        $statement->execute([$name, $kind, $type]);
    }

    // The seed has already run at this point in EnsureTables -- that is exactly why the migration sits
    // after it, so (topographie, insel) exists before any region is pointed at it.
    foreach ([
        ['derographisch', 'insel', 'Insel', 1],
        ['derographisch', 'inselgruppe', 'Inselgruppe', 1],
        ['derographisch', 'region', 'Region', 1],
        ['topographie', 'insel', 'Insel', 1],
        ['topographie', 'gebirge', 'Gebirge', 1],
    ] as [$kind, $typeKey, $label, $active]) {
        $statement = $pdo->prepare(
            'INSERT INTO ecosystem_region_type (kind, type_key, label, is_active) VALUES (?, ?, ?, ?)'
        );
        $statement->execute([$kind, $typeKey, $label, $active]);
    }

    return $pdo;
}

/** kind|region_type of one region, by name. */
function islandTestPlacement(PDO $pdo, string $name): string
{
    $statement = $pdo->prepare('SELECT kind, region_type FROM ecosystem_region WHERE name = ?');
    $statement->execute([$name]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row === false ? '(missing)' : ((string) $row['kind'] . '|' . (string) $row['region_type']);
}

function islandTestTypeActive(PDO $pdo, string $kind, string $typeKey): int
{
    $statement = $pdo->prepare('SELECT is_active FROM ecosystem_region_type WHERE kind = ? AND type_key = ?');
    $statement->execute([$kind, $typeKey]);

    return (int) $statement->fetchColumn();
}

/** Runs the migration and returns the exception message, or '' if it completed without throwing. */
function islandTestRun(PDO $pdo): string
{
    try {
        avesmapsEcosystemMoveIslandsToTopographie($pdo);
    } catch (PDOException $error) {
        return $error->getMessage();
    }

    return '';
}

// ---- first run: the move happens, and it reaches the revision bump -------------------------------
$pdo = islandTestDatabase();
$first = islandTestRun($pdo);

assert($first !== '', 'the first run reaches the revision bump (sqlite cannot execute it)');
assert(
    str_contains($first, 'DUPLICATE'),
    'and it fails ON THE BUMP, not somewhere else -- got: ' . $first
);

assert(islandTestPlacement($pdo, 'Maraskan') === 'topographie|insel', 'Maraskan moved');
assert(islandTestPlacement($pdo, 'Bilku') === 'topographie|insel', 'Bilku moved');
assert(islandTestPlacement($pdo, 'Bilku-Archipel') === 'topographie|insel', 'the group moved too -- nothing is reclassified by this step');

// 💣 The WHERE clause names BOTH columns. A move keyed on `kind` alone would drag Kosch and
// Aventurien along, and one keyed on `region_type` alone would be harmless today but would start
// moving rows the day another layer gains an `insel`.
assert(islandTestPlacement($pdo, 'Kosch') === 'derographisch|region', 'a derographic region stays put');
assert(islandTestPlacement($pdo, 'Aventurien') === 'derographisch|kontinent', 'the continent stays put');
assert(islandTestPlacement($pdo, 'Raschtulswall') === 'topographie|gebirge', 'a mountain range is untouched');
assert(islandTestPlacement($pdo, 'Farindel') === 'vegetation|wald', 'a wood is untouched');

assert(islandTestTypeActive($pdo, 'derographisch', 'insel') === 0, 'the derographic island type is switched off');
assert(islandTestTypeActive($pdo, 'topographie', 'insel') === 1, 'the topographic one stays active');
assert(islandTestTypeActive($pdo, 'derographisch', 'inselgruppe') === 1, 'and so does inselgruppe');
// Switched OFF, not deleted: the row may still be referenced, and is_active is this table's idiom.
$statement = $pdo->query("SELECT COUNT(*) FROM ecosystem_region_type WHERE kind = 'derographisch' AND type_key = 'insel'");
assert((int) $statement->fetchColumn() === 1, 'the old type row is deactivated, never deleted');

// ---- second run: the guard short-circuits ---------------------------------------------------------
// No exception at all is the proof: the only path that skips the (unsupported) bump is the early
// return, so this asserts idempotence and the guard in one breath.
$second = islandTestRun($pdo);
assert($second === '', 'the second run returns before the bump -- got: ' . $second);

assert(islandTestPlacement($pdo, 'Maraskan') === 'topographie|insel', 'and changes nothing');
assert(islandTestTypeActive($pdo, 'derographisch', 'insel') === 0, 'the type stays off');

// ---- a database that never had a derographic island ----------------------------------------------
// The state of every installation created after this change: the guard must find nothing and return,
// so a fresh install never bumps the revision for a migration that has no work.
$fresh = islandTestDatabase();
$fresh->exec("UPDATE ecosystem_region SET kind = 'topographie' WHERE region_type = 'insel'");
$fresh->exec("UPDATE ecosystem_region_type SET is_active = 0 WHERE kind = 'derographisch' AND type_key = 'insel'");
assert(islandTestRun($fresh) === '', 'a fresh install does no work and bumps nothing');

echo "OK: island migration -- move, both-column WHERE, deactivation, revision bump, idempotence\n";

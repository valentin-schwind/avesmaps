<?php

declare(strict_types=1);

/**
 * Unit test for the ONE part of the store that is provable without MySQL. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/social/__tests__/store-test.php
 *
 * ⚠️ There is no local MySQL, and the DDL in store.php is deliberately MySQL (InnoDB, DATETIME(3),
 * MEDIUMTEXT) -- it is not going to be watered down for testability. Everything DB-bound is therefore
 * verified live. What CAN be proved here, and is worth proving, is the ORDER of the state guard:
 *
 *   The three valid post states are checked BEFORE the database is touched.
 *
 * That ordering is the difference between a typo failing loudly at the call site and a typo being
 * written into the table, where the list filter (`state <> 'discarded'`) would silently show a post
 * that was meant to be a proposal.
 *
 * ⚠️ pdo_sqlite is required. Without it the driver is missing and the test would exit 0 having proved
 * NOTHING -- which is the dangerous direction, so it is guarded explicitly below.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this test would prove nothing and "
        . "still exit 0. Re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../store.php';

// An in-memory sqlite handle. It is a REAL PDO, so nothing here is stubbed -- but the MySQL DDL will
// fail on it, and that failure is exactly what makes the ordering visible: an invalid state must die
// with InvalidArgumentException (the guard), a valid one with PDOException (the database).
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

assert(AVESMAPS_SOCIAL_POST_STATES === ['proposal', 'released', 'discarded'],
    'exactly three states -- the list filter and the approval flow both depend on this set');

// ---- the guard runs FIRST ---------------------------------------------------------------------------

$guardFired = false;
try {
    avesmapsSocialSetPostState($pdo, 1, 'veroeffentlicht');
} catch (InvalidArgumentException) {
    $guardFired = true;
} catch (PDOException) {
    // Reached the database -> the guard is BEHIND it, and a typo would have been written.
}
assert($guardFired === true,
    'an unknown state throws InvalidArgumentException BEFORE the database is touched');

$guardFired = false;
try {
    avesmapsSocialCreatePost($pdo, ['body' => 'x', 'state' => 'entwurf'], ['probe']);
} catch (InvalidArgumentException) {
    $guardFired = true;
} catch (PDOException) {
}
assert($guardFired === true, 'and the same guard sits in front of the insert path');

// ---- a VALID state gets past the guard and reaches the database ----------------------------------------

// The counter-proof. Without it, a guard that rejected EVERYTHING would pass the asserts above while
// making the whole store unusable.
$reachedDatabase = false;
try {
    avesmapsSocialSetPostState($pdo, 1, 'released');
} catch (InvalidArgumentException) {
    // Would mean a valid state is being rejected.
} catch (PDOException) {
    $reachedDatabase = true;
} catch (Throwable) {
    $reachedDatabase = true;
}
assert($reachedDatabase === true,
    'a VALID state passes the guard and reaches the database -- otherwise the guard rejects everything');

// ---- the token reader never runs DDL ----------------------------------------------------------------------

// 💣 avesmapsSocialTokenKeys is read on the subtab's landing view. A CREATE TABLE IF NOT EXISTS in
// front of a read path is the information_schema load behind the pool incident of 2026-07-17. A
// missing table must therefore answer "nobody stored a token", not create one and not raise.
assert(avesmapsSocialTokenKeys($pdo) === [],
    'a missing social_token table yields an empty list, silently -- no DDL, no exception');
// The same holds for the map dispatch reads before every run -- it is the same read path, one query
// instead of one per channel, and it must fail just as quietly.
assert(avesmapsSocialTokenMap($pdo) === [],
    'and so does the token map -- a missing table means "nobody stored a token", not an error');
$tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll(PDO::FETCH_COLUMN);
assert($tables === [], 'and neither of them created anything on the way');

// With rows, the map answers channel_key => token. Dispatch hands exactly this to the adapter, so a
// swapped key here would hand one network another network's credentials.
//
// ⚠️ The table is created by hand, in sqlite dialect: the real DDL is MySQL and must stay so (see the
// header). Only the two columns the map reads are needed -- this proves the KEYING, not the schema.
$pdo->exec('CREATE TABLE social_token (channel_key TEXT PRIMARY KEY, access_token TEXT NOT NULL)');
$pdo->exec("INSERT INTO social_token VALUES ('facebook', 'seiten-token'), ('mastodon', 'anderes-token')");
$map = avesmapsSocialTokenMap($pdo);
assert($map['facebook'] === 'seiten-token' && $map['mastodon'] === 'anderes-token',
    'each channel gets ITS token, keyed by channel_key');
assert(!isset($map['instagram']), 'and a channel without a row appears nowhere -- the adapter then '
    . 'refuses by name instead of sending with someone else\'s token');
assert(avesmapsSocialTokenKeys($pdo) === ['facebook', 'mastodon'],
    'and the availability check sees the same two channels');

fwrite(STDOUT, "store-test: OK\n");

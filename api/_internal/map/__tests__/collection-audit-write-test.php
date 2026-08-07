<?php

declare(strict_types=1);

/**
 * Finding A16, stage 1 -- the half that runs against a REAL table.
 *
 * 🔴 "The library is correct" and "a row exists afterwards" are two different statements. The sister
 * file (collection-audit-test.php) checks the pure parts and the wiring by reading source; this one
 * lets the writer actually write, and drives the whole occurrence removal end to end.
 *
 * Runs against pdo_sqlite, because the writer and the lore removal are plain DML. The citymap and
 * adventure deletions cannot be driven here: both start with their library's MySQL DDL
 * (avesmapsCitymapsEnsureTables), which sqlite rejects. Their snapshot builders are pure and are
 * exercised below with a realistic row instead.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/collection-audit-write-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../collection-audit.php';
require __DIR__ . '/../../app/citymaps.php';
require __DIR__ . '/../../app/game-literature.php';
require __DIR__ . '/../../app/lore-edit.php';

function avesmapsTestCollectionAuditPdo(): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY,
        feature_id INTEGER NULL,
        action TEXT,
        actor_user_id INTEGER,
        before_json TEXT,
        after_json TEXT
    )');

    return $pdo;
}

// ---- The writer puts a row where the change log looks for it ---------------------------------------

$pdo = avesmapsTestCollectionAuditPdo();
avesmapsLogCollectionDeletion(
    $pdo,
    'delete_citymap',
    ['entity' => 'citymap', 'name' => 'Havena', 'citymap_public_id' => 'aaaa-1111', 'origin' => 'manual'],
    ['entity' => 'citymap', 'name' => 'Havena', 'citymap_public_id' => 'aaaa-1111', 'deleted' => true],
    ['id' => 7, 'username' => 'Valentin']
);

$rows = $pdo->query('SELECT * FROM map_audit_log')->fetchAll();
assert(count($rows) === 1, 'a deletion writes exactly ONE row -- before A16 it wrote none');
$row = $rows[0];
$after = json_decode((string) $row['after_json'], true);
$before = json_decode((string) $row['before_json'], true);

assert($row['action'] === 'delete_citymap', 'under its own action name');
// 💣 THE TRAP OF §3. The reader LEFT JOINs map_features on this column; a citymap id here hits an
// unrelated map object, because the id spaces are separate and the numbers overlap. NULL, not 0 -- a 0
// claims a feature that does not exist and survives into every later query.
assert($row['feature_id'] === null, 'feature_id is NULL -- a citymap is not a map object');
assert((int) $row['actor_user_id'] === 7, 'the editor who did it stands with their id');
assert(!array_key_exists('actor_source', $after), 'and carries no machine note');
assert($before['name'] === 'Havena' && $after['name'] === 'Havena', 'the title travels, or the entry reads "Unbenannt"');
assert($before['origin'] === 'manual', 'and whether the next sync would bring it back');
// 💣 The second half of the trap: not even under a key the reader would lift into a map-object claim.
foreach (AVESMAPS_COLLECTION_AUDIT_RESERVED_KEYS as $reserved) {
    assert(!array_key_exists($reserved, $after) && !array_key_exists($reserved, $before), "no {$reserved} in the snapshots");
}

// ---- No user: the row says so, instead of claiming a person ---------------------------------------

$pdo = avesmapsTestCollectionAuditPdo();
avesmapsLogCollectionDeletion($pdo, 'delete_adventure', ['name' => 'Nedime'], ['name' => 'Nedime'], null);
$row = $pdo->query('SELECT * FROM map_audit_log')->fetch();
assert((int) $row['actor_user_id'] === 0, 'no human -> the id stays 0');
assert((json_decode((string) $row['after_json'], true)['actor_source'] ?? '') === 'system', 'and the note says what it was');

// ---- An unknown action writes nothing --------------------------------------------------------------

$pdo = avesmapsTestCollectionAuditPdo();
avesmapsLogCollectionDeletion($pdo, 'delete_everything', ['name' => 'X'], ['name' => 'X'], ['id' => 1]);
assert(
    (int) $pdo->query('SELECT COUNT(*) AS n FROM map_audit_log')->fetch()['n'] === 0,
    'an unnamed action writes no row -- better no trail than a nameless one'
);

// ---- 💣 A trail that cannot be written must not undo a deletion that already happened --------------
//
// The row is gone by the time this runs. A throw here would answer 500 for something that WORKED, and
// the retry would then answer 404. Reproduced by leaving the table out entirely.
$brokenPdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$threw = false;
try {
    avesmapsLogCollectionDeletion($brokenPdo, 'delete_citymap', ['name' => 'X'], ['name' => 'X'], ['id' => 1]);
} catch (Throwable) {
    $threw = true;
}
assert($threw === false, 'a failing audit write does not throw');

// ---- The two snapshot builders that cannot be driven against sqlite --------------------------------
//
// Pure functions, exercised with the row their SELECT actually produces. This is what makes "the title
// reaches the change log" a checked statement rather than a hope.
$citymapSnapshots = avesmapsCitymapDeletionAuditSnapshots(
    ['id' => 412, 'title' => 'Al\'Anfa – Hafenviertel', 'origin' => 'wiki', 'art' => 'stadtplan'],
    'bbbb-2222'
);
assert($citymapSnapshots['before']['name'] === 'Al\'Anfa – Hafenviertel', 'the citymap title is the displayed name');
assert($citymapSnapshots['after']['name'] === $citymapSnapshots['before']['name'], 'in both snapshots');
assert($citymapSnapshots['before']['citymap_public_id'] === 'bbbb-2222', 'the identity travels under its own key');
assert(!array_key_exists('public_id', $citymapSnapshots['before']), 'and NEVER as public_id (it would become a dead button)');
assert($citymapSnapshots['before']['origin'] === 'wiki', 'a wiki map comes back on the next sync -- the log says so');
assert(($citymapSnapshots['after']['deleted'] ?? null) === true, 'the after state is "gone"');
assert(!array_key_exists('deleted', $citymapSnapshots['before']), 'the before state is not');

$gameLiteratureSnapshots = avesmapsGameLiteratureDeletionAuditSnapshots(
    ['id' => 88, 'title' => 'Die Verschwörung von Gareth', 'origin' => 'manual'],
    'cccc-3333',
    5,
    2
);
assert($gameLiteratureSnapshots['before']['name'] === 'Die Verschwörung von Gareth', 'the adventure title is the displayed name');
assert($gameLiteratureSnapshots['before']['adventure_public_id'] === 'cccc-3333', 'under its own key');
assert(!array_key_exists('public_id', $gameLiteratureSnapshots['before']), 'never as public_id');
// The children go with it and are unrecoverable -- how many is the one number that says how much was lost.
assert((int) $gameLiteratureSnapshots['after']['places_deleted'] === 5, 'the places that went with it are counted');
assert((int) $gameLiteratureSnapshots['after']['links_deleted'] === 2, 'and the links');

// ---- The occurrence removal, end to end ------------------------------------------------------------
//
// 5.104 rows, the largest of the three, and the only one whose library carries no DDL -- so this one can
// be driven for real. Two outcomes, and the difference is the whole point of A16: a wiki row becomes a
// tombstone (which "Ort wieder aufnehmen" can undo), a manual row is gone.
function avesmapsTestLorePdo(): PDO {
    $pdo = avesmapsTestCollectionAuditPdo();
    $pdo->exec('CREATE TABLE lore_entry (wiki_key TEXT PRIMARY KEY, name TEXT)');
    $pdo->exec('CREATE TABLE lore_place (
        entry_wiki_key TEXT,
        place_wiki_key TEXT,
        place_title TEXT,
        relation TEXT,
        sort_order INTEGER,
        origin TEXT,
        status TEXT
    )');
    $pdo->prepare('INSERT INTO lore_entry (wiki_key, name) VALUES (:wk, :n)')
        ->execute(['wk' => 'wiki:rondrarot', 'n' => 'Rondrarot']);

    return $pdo;
}

$insertPlace = static function (PDO $pdo, string $origin): void {
    $pdo->prepare(
        'INSERT INTO lore_place (entry_wiki_key, place_wiki_key, place_title, relation, sort_order, origin, status)
         VALUES (:wk, :pk, :pt, :rel, 1, :org, \'active\')'
    )->execute([
        'wk' => 'wiki:rondrarot',
        'pk' => 'gareth',
        'pt' => 'Gareth',
        'rel' => 'verbreitung',
        'org' => $origin,
    ]);
};

// -- a wiki occurrence: tombstone --
$pdo = avesmapsTestLorePdo();
$insertPlace($pdo, 'wiki');
$result = avesmapsLoreRemovePlace($pdo, 'wiki:rondrarot', 'gareth', 'verbreitung', ['id' => 7, 'username' => 'Valentin']);
assert(($result['action'] ?? '') === 'suppressed', 'a wiki occurrence becomes a tombstone, as before');
assert(
    (string) $pdo->query("SELECT status FROM lore_place")->fetchColumn() === 'suppressed',
    'and the row is still there'
);
$rows = $pdo->query('SELECT * FROM map_audit_log')->fetchAll();
assert(count($rows) === 1, 'removing an occurrence writes a row -- before A16 it wrote none');
$row = $rows[0];
$after = json_decode((string) $row['after_json'], true);
$before = json_decode((string) $row['before_json'], true);
assert($row['action'] === 'suppress_lore_place', 'and the action says it can be taken back');
assert($row['feature_id'] === null, 'feature_id NULL here too');
assert((int) $row['actor_user_id'] === 7, 'with the editor who did it');
// Which occurrence disappeared is TWO facts: from which entry, and which place. One alone does not
// answer the question the change log is read for.
assert(str_contains((string) $after['name'], 'Rondrarot') && str_contains((string) $after['name'], 'Gareth'),
    'the entry and the place are both named');
assert($before['lore_entry_key'] === 'wiki:rondrarot' && $before['lore_place_key'] === 'gareth', 'and both keys travel');
assert($before['relation'] === 'verbreitung', 'the relation too -- the same place can hang off an entry twice');
assert($before['status'] === 'active' && $after['status'] === 'suppressed', 'before and after say what changed');

// -- a manual occurrence: gone --
$pdo = avesmapsTestLorePdo();
$insertPlace($pdo, 'manual');
$result = avesmapsLoreRemovePlace($pdo, 'wiki:rondrarot', 'gareth', 'verbreitung', ['id' => 7, 'username' => 'Valentin']);
assert(($result['action'] ?? '') === 'deleted', 'a manual occurrence is deleted, as before');
assert((int) $pdo->query('SELECT COUNT(*) AS n FROM lore_place')->fetch()['n'] === 0, 'and is really gone');
$row = $pdo->query('SELECT * FROM map_audit_log')->fetch();
$after = json_decode((string) $row['after_json'], true);
assert($row['action'] === 'delete_lore_place', 'the action says there is no way back');
assert(($after['deleted'] ?? '') === '1', 'and the after state is "gone", not a status');
// 💣 The title has to be read BEFORE the DELETE -- afterwards the row is not there to read.
assert(str_contains((string) $after['name'], 'Gareth'), 'the place title survived the deletion into the log');

// -- 💣 and the removal must survive a missing lore_entry --
//
// The entry-name lookup is new and runs BEFORE the removal. A throw there would turn a removal that
// worked yesterday into a 500 today, for the sake of a nicer line in a log. Reproduced by dropping the
// table the lookup reads.
$pdo = avesmapsTestLorePdo();
$insertPlace($pdo, 'manual');
$pdo->exec('DROP TABLE lore_entry');
$result = avesmapsLoreRemovePlace($pdo, 'wiki:rondrarot', 'gareth', 'verbreitung', ['id' => 7]);
assert(($result['ok'] ?? false) === true, 'the removal still happens without the entry table');
assert((int) $pdo->query('SELECT COUNT(*) AS n FROM lore_place')->fetch()['n'] === 0, 'and really removes the row');
$after = json_decode((string) $pdo->query('SELECT after_json FROM map_audit_log')->fetchColumn(), true);
assert(str_contains((string) $after['name'], 'wiki:rondrarot'), 'the log falls back to the key instead of failing');

// -- an occurrence that is not there: no row, and no invented trail --
$pdo = avesmapsTestLorePdo();
$result = avesmapsLoreRemovePlace($pdo, 'wiki:rondrarot', 'gibtesnicht', 'verbreitung', ['id' => 7]);
assert(($result['ok'] ?? true) === false, 'a missing occurrence is still a not_found');
assert(
    (int) $pdo->query('SELECT COUNT(*) AS n FROM map_audit_log')->fetch()['n'] === 0,
    'and writes nothing -- a log that claims more than happened is worse than none'
);

echo "collection-audit-write ok\n";

<?php

declare(strict_types=1);

/**
 * Unit test for the "the element is still alive" guard on source links. Needs pdo_sqlite, no MySQL.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       -d extension=php_mbstring.dll api/_internal/app/__tests__/feature-source-live-entity-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 WHY THIS EXISTS. A source link is keyed by (entity_type, entity_public_id) and has no foreign
 * key, so nothing removes it when its element is deleted -- and the delete is SOFT on purpose, so
 * nothing ever will. On 2026-08-05 that was 216 elements with 4.714 links pointing at rows nobody
 * can see, and the PUBLIC endpoint served them: delete a place, and an anonymous caller still got
 * its sources. Reproduced live in the system test of that day (findings A6 and A7).
 *
 * 💣 THE DANGEROUS HALF OF THIS FIX IS THE OTHER DIRECTION. territory, citymap and lore do NOT live
 * in map_features -- they keep their own tables and their own delete semantics. A guard that simply
 * demanded a live map_features row would have hidden EVERY one of their sources: 878 territory and
 * 631 citymap links on the same day, silently, on the public endpoint. That is why the clause tests
 * the entity type first, and why the assert below is worth more than the one above it.
 *
 * What is tested is the shared clause, not the endpoint: avesmapsReadFeatureSources opens with
 * avesmapsEnsureFeatureSourceTables, whose DDL is MySQL-specific and cannot run here. The clause is
 * the whole fix, and it is used verbatim by both readers.
 */

require_once __DIR__ . '/../feature-sources.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(1);
}
if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1, otherwise assert() is a no-op and this proves nothing.\n");
    exit(1);
}

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

$pdo->exec('CREATE TABLE map_features (public_id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1)');
$pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT, label TEXT, source_type TEXT,
            is_official INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT "2026-01-01")');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL,
            entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT "approved")');

// Three elements in map_features: one alive, one soft-deleted, one path alive.
$pdo->exec("INSERT INTO map_features (public_id, is_active) VALUES
            ('pid-alive', 1), ('pid-deleted', 0), ('pid-path', 1)");
// Five catalog sources, one per link below.
for ($id = 1; $id <= 5; $id++) {
    $pdo->exec("INSERT INTO sources (id, url, label, source_type, is_official)
                VALUES ({$id}, 'https://example.test/{$id}', 'Quelle {$id}', 'sonstiges', 0)");
}
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES
            ('settlement', 'pid-alive',   1),
            ('settlement', 'pid-deleted', 2),
            ('path',       'pid-path',    3),
            ('territory',  'terr-1',      4),
            ('citymap',    'cmap-1',      5)");

// 💣 sqlite does not know utf8mb4_unicode_ci, so the behavioural half of this test runs the clause
// with the COLLATE stripped. That split is the honest one and it is the whole lesson of 2026-08-05:
// the BEHAVIOUR is testable here, the COLLATION is not, and shipping on a green sqlite run is
// exactly how both public readers went to 500. Step 7 at the bottom guards the part this cannot.
$behaviourClause = static fn(string $alias = 'fs'): string => str_replace(
    ' COLLATE utf8mb4_unicode_ci',
    '',
    avesmapsFeatureSourceLiveEntityClause($alias)
);

/** Runs the catalog read for one element, exactly as avesmapsReadFeatureSources builds it. */
$readFor = static function (PDO $pdo, string $type, string $publicId) use ($behaviourClause): array {
    $statement = $pdo->prepare(
        "SELECT s.id FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'"
        . $behaviourClause('fs') .
        " ORDER BY s.id"
    );
    $statement->execute(['t' => $type, 'id' => $publicId]);

    return array_map(static fn(array $r): int => (int) $r['id'], $statement->fetchAll());
};

// ---- 1. the leak itself ---------------------------------------------------------------------
assert($readFor($pdo, 'settlement', 'pid-alive') === [1], 'a living settlement keeps its source');
assert($readFor($pdo, 'settlement', 'pid-deleted') === [], 'a DELETED settlement must not serve its source');
assert($readFor($pdo, 'path', 'pid-path') === [3], 'a living path keeps its source');

// ---- 2. the other direction, which is the one that would hurt -------------------------------
// territory/citymap have no map_features row AT ALL. If the guard asked for one, both would go
// silently blank on the public endpoint -- 1.509 links on the day this was written.
assert($readFor($pdo, 'territory', 'terr-1') === [4], 'a territory source survives -- it has no map_features row by design');
assert($readFor($pdo, 'citymap', 'cmap-1') === [5], 'a citymap source survives -- it has no map_features row by design');

// ---- 3. undo comes back for free ------------------------------------------------------------
// The point of guarding the READ instead of the delete: restoring the element restores its
// sources with it, without a second piece of state anyone has to remember to flip back.
$pdo->exec("UPDATE map_features SET is_active = 1 WHERE public_id = 'pid-deleted'");
assert($readFor($pdo, 'settlement', 'pid-deleted') === [2], 'undoing the delete brings the source back');
$pdo->exec("UPDATE map_features SET is_active = 0 WHERE public_id = 'pid-deleted'");

// ---- 4. an element that never existed --------------------------------------------------------
// A link left over from a HARD delete (or a typo) points at no row at all. Same answer as deleted.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('region', 'pid-gone', 1)");
assert($readFor($pdo, 'region', 'pid-gone') === [], 'a link to an element that does not exist serves nothing');

// ---- 5. the uses counter -----------------------------------------------------------------------
// Source 2 hangs only on the deleted settlement; source 1 hangs on a live settlement AND on the
// vanished region from step 4. The counter must say 1 and 0, not 2 and 1.
$countStatement = $pdo->prepare(
    "SELECT fs.source_id, COUNT(*) AS uses FROM feature_sources fs
      WHERE fs.status = 'approved' AND fs.source_id IN (1, 2)"
    . $behaviourClause('fs') .
    " GROUP BY fs.source_id"
);
$countStatement->execute();
$uses = [];
foreach ($countStatement->fetchAll() as $row) {
    $uses[(int) $row['source_id']] = (int) $row['uses'];
}
assert(($uses[1] ?? 0) === 1, 'source 1 is used once -- its second link points at a deleted element');
assert(($uses[2] ?? 0) === 0, 'source 2 is used nowhere -- its only element is deleted');

// ---- 6. the clause names every soft-deleted type, and only those --------------------------------
// If a new entity type is ever stored in map_features, it belongs in the constant. This assert is
// the reminder: it fails the moment the list and the map_features edit handlers disagree.
assert(
    AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES === ['settlement', 'region', 'path', 'powerline'],
    'the soft-deleted entity types changed -- check api/_internal/map/features.php and update both'
);

// ---- 7. the COLLATE, which sqlite can never test ------------------------------------------------
// 💣 feature_sources carries the SERVER default collation, map_features is explicitly
// utf8mb4_unicode_ci. A bare column-to-column compare between them throws „Illegal mix of
// collations" on MySQL -- decided at PLAN time, so it fires on every call whatever the data says.
// This shipped without the COLLATE on 2026-08-05 and both public readers answered 500 within
// minutes. sqlite has no such clash and ran every assert above green through the whole outage.
// So this is a TEXT assert on purpose: it is the only guard the line can have here.
$clause = avesmapsFeatureSourceLiveEntityClause('fs');
assert(
    str_contains($clause, 'fs.entity_public_id COLLATE utf8mb4_unicode_ci'),
    'the COLLATE is gone from the live-entity clause -- MySQL will answer 500 on every read. '
    . 'See api/_internal/app/lore.php:241 and ecosystem.php:230 for the same trap.'
);
assert(
    !str_contains($clause, 'mf.public_id COLLATE'),
    'the COLLATE moved onto map_features -- that makes its UNIQUE key unusable for this lookup'
);

echo 'feature-source-live-entity-test: all asserts passed', PHP_EOL;

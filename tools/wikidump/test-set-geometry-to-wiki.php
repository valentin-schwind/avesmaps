<?php

declare(strict_types=1);

/**
 * Unit test for the WikiDump coordinate_drift resolution action
 * avesmapsWikiSyncSetGeometryToWiki (api/_internal/wiki/locations.php), the ONLY
 * new map write in the WikiDump rollout ("Auf Wiki-Position setzen").
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (Wave-2 brief's required asserts)
 * ---------------------------------------------------------------------------
 * The action is a THIN wrapper: it reuses avesmapsMovePointFeature (the SAME
 * geometry-write path drag-to-move uses -> SAME lock + expected_revision guard)
 * and then archives the case. This test runs it against a FAKE PDO that models
 * exactly the statements the two touch (map_features SELECT ... FOR UPDATE,
 * map_feature_locks SELECT, map_revision INSERT/SELECT, map_features UPDATE,
 * map_audit_log INSERT, wiki_sync_cases SELECT * + UPDATE). No live DB.
 *
 *   (A) HAPPY PATH: on a coordinate_drift case, the action writes map_features
 *       geometry_json to the WIKI position (GeoJSON [lng, lat] order, the wiki
 *       lat/lng straight through from the payload) AND archives the case
 *       (wiki_sync_cases UPDATE status='archived', resolution_json set). Returns
 *       the moved feature.
 *   (B) STALE REVISION: a mismatched expected_revision makes the reused
 *       avesmapsAssertFeatureCanBeEdited throw AvesmapsConflictException BEFORE
 *       any UPDATE -> NO geometry write, NO archive (the optimistic-concurrency
 *       guard is honoured end-to-end, not bypassed).
 *   (C) LOCK HELD BY ANOTHER USER: a live map_feature_locks row owned by a
 *       different user_id makes the same guard throw -> NO write, NO archive.
 *   (D) WRONG CASE TYPE: a non-coordinate_drift case is rejected
 *       (InvalidArgumentException) before any map write.
 *   (E) STAGING GUARD: the ONLY tables the action writes are map_features (+ its
 *       revision/audit siblings) and wiki_sync_cases -- never political_territory.
 *
 * HOW TO RUN:
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-set-geometry-to-wiki.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded (the included chain calls mb_*).\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
// The map geometry-write helper (avesmapsMovePointFeature + its guard) and the
// WikiSync helpers (avesmapsWikiSyncSetGeometryToWiki + avesmapsWikiSyncFetchCase).
require_once $repoRoot . '/api/_internal/map/features.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';

// AvesmapsConflictException is declared only at the edit-endpoint layer (and,
// guarded, in endpoint.php). Mirror that guard here so the reused move helper's
// lock/stale-revision throw resolves to a real class instead of a fatal.
if (!class_exists('AvesmapsConflictException')) {
    class AvesmapsConflictException extends RuntimeException
    {
    }
}

// ---------------------------------------------------------------------------
// Tiny assert harness.
// ---------------------------------------------------------------------------
$failures = 0;
$assertions = 0;
function check(string $label, bool $ok): void
{
    global $failures, $assertions;
    $assertions++;
    if ($ok) {
        echo "  ok   {$label}\n";
        return;
    }
    $failures++;
    echo "  FAIL {$label}\n";
}

// ---------------------------------------------------------------------------
// Fake statement + PDO modelling ONLY the statements the action touches.
// ---------------------------------------------------------------------------
final class FakeGeomStmt extends PDOStatement
{
    private array $bound = [];

    public function __construct(private string $sql, private FakeGeomPdo $pdo)
    {
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $this->bound = (array) ($params ?? []);
        $this->pdo->executedSql[] = $this->sql;

        // map_features UPDATE (the geometry write) -> capture the geometry_json.
        if (stripos($this->sql, 'UPDATE map_features') !== false) {
            $this->pdo->mapFeaturesUpdated = true;
            $this->pdo->writtenGeometryJson = (string) ($this->bound['geometry_json'] ?? '');
            $this->pdo->writtenRevision = (int) ($this->bound['revision'] ?? 0);
        }

        // wiki_sync_cases UPDATE (the archive) -> capture status + resolution.
        if (stripos($this->sql, 'UPDATE wiki_sync_cases') !== false) {
            $this->pdo->caseArchived = true;
            $this->pdo->caseArchivedStatus = (string) ($this->bound['status'] ?? '');
            $this->pdo->caseResolutionJson = (string) ($this->bound['resolution_json'] ?? '');
        }

        // map_audit_log INSERT -> just record that it fired.
        if (stripos($this->sql, 'INSERT INTO map_audit_log') !== false) {
            $this->pdo->auditWritten = true;
        }

        // Hard guard: the action must NEVER write political_territory.
        if (stripos($this->sql, 'political_territory') !== false
            && (stripos($this->sql, 'UPDATE') !== false || stripos($this->sql, 'INSERT') !== false || stripos($this->sql, 'DELETE') !== false)) {
            $this->pdo->politicalWritten = true;
        }

        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        // map_features SELECT ... FOR UPDATE -> the editable feature row.
        if (stripos($this->sql, 'FROM map_features') !== false) {
            return $this->pdo->feature;
        }
        // map_feature_locks SELECT -> the lock row (or false = no lock).
        if (stripos($this->sql, 'FROM map_feature_locks') !== false) {
            return $this->pdo->lock === null ? false : $this->pdo->lock;
        }
        // wiki_sync_cases SELECT * -> the case row.
        if (stripos($this->sql, 'FROM wiki_sync_cases') !== false) {
            return $this->pdo->case;
        }
        return false;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        // map_revision SELECT revision -> the next revision integer.
        if (stripos($this->sql, 'FROM map_revision') !== false) {
            return $this->pdo->nextRevision;
        }
        return false;
    }
}

final class FakeGeomPdo extends PDO
{
    /** @var array<string,mixed> the editable map_features row */
    public array $feature;
    /** @var array<string,mixed>|null a live lock row, or null for "no lock" */
    public ?array $lock = null;
    /** @var array<string,mixed> the wiki_sync_cases row */
    public array $case;
    public int $nextRevision = 2;

    // Captured effects.
    public bool $mapFeaturesUpdated = false;
    public string $writtenGeometryJson = '';
    public int $writtenRevision = 0;
    public bool $caseArchived = false;
    public string $caseArchivedStatus = '';
    public string $caseResolutionJson = '';
    public bool $auditWritten = false;
    public bool $politicalWritten = false;
    /** @var list<string> */
    public array $executedSql = [];
    private bool $inTx = false;

    public function __construct(array $feature, array $case)
    {
        // No real driver.
        $this->feature = $feature;
        $this->case = $case;
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeGeomStmt((string) $query, $this);
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $this->executedSql[] = (string) $statement;
        return 0;
    }

    #[\ReturnTypeWillChange]
    public function query($statement, $mode = PDO::ATTR_DEFAULT_FETCH_MODE, ...$fetchModeArgs)
    {
        $this->executedSql[] = (string) $statement;
        return new FakeGeomStmt((string) $statement, $this);
    }

    #[\ReturnTypeWillChange]
    public function beginTransaction(): bool
    {
        $this->inTx = true;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function commit(): bool
    {
        $this->inTx = false;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function rollBack(): bool
    {
        $this->inTx = false;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function inTransaction(): bool
    {
        return $this->inTx;
    }

    #[\ReturnTypeWillChange]
    public function lastInsertId($name = null)
    {
        return '1';
    }
}

// ---------------------------------------------------------------------------
// Fixtures. Map marker at (100,100); wiki position at (300,250) map units.
// ---------------------------------------------------------------------------
$PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
$WIKI_LAT = 250.0; // y (vertical)
$WIKI_LNG = 300.0; // x (horizontal)

function makeFeature(int $revision): array
{
    global $PUBLIC_ID;
    return [
        'id' => 77,
        'public_id' => $PUBLIC_ID,
        'feature_type' => 'location',
        'feature_subtype' => 'dorf',
        'name' => 'Angbar',
        'geometry_type' => 'Point',
        'geometry_json' => json_encode(['type' => 'Point', 'coordinates' => [100.0, 100.0]]),
        'properties_json' => json_encode(['name' => 'Angbar', 'feature_subtype' => 'dorf']),
        'style_json' => null,
        'revision' => $revision,
    ];
}

function makeCase(string $caseType, int $mapRevision): array
{
    global $PUBLIC_ID, $WIKI_LAT, $WIKI_LNG;
    $payload = [
        'map' => ['public_id' => $PUBLIC_ID, 'lat' => 100.0, 'lng' => 100.0, 'revision' => $mapRevision, 'name' => 'Angbar'],
        'wiki_position' => ['lat' => $WIKI_LAT, 'lng' => $WIKI_LNG],
    ];
    return [
        'id' => 909,
        'case_type' => $caseType,
        'status' => 'open',
        'map_public_id' => $PUBLIC_ID,
        'wiki_title' => 'Angbar',
        'payload_json' => json_encode($payload),
        'resolution_json' => null,
        'signature_hash' => 'sig',
    ];
}

$USER = ['id' => 5, 'username' => 'editor'];

// ===========================================================================
// (A) HAPPY PATH.
// ===========================================================================
echo "-- (A) happy path: writes wiki geometry + archives --\n";
$pdo = new FakeGeomPdo(makeFeature(3), makeCase('coordinate_drift', 3));
$result = avesmapsWikiSyncSetGeometryToWiki($pdo, [
    'case_id' => 909,
    'public_id' => $PUBLIC_ID,
    'lat' => $WIKI_LAT,
    'lng' => $WIKI_LNG,
    'expected_revision' => 3,
], $USER);

check('map_features UPDATE fired', $pdo->mapFeaturesUpdated);
$writtenGeom = json_decode($pdo->writtenGeometryJson, true);
check('geometry is a Point', is_array($writtenGeom) && ($writtenGeom['type'] ?? '') === 'Point');
// GeoJSON [x, y] = [lng, lat] -> [300, 250]. This proves lat is the vertical (y).
check('geometry coordinates are [lng, lat] = [300, 250]',
    is_array($writtenGeom['coordinates'] ?? null)
        && (float) $writtenGeom['coordinates'][0] === $WIKI_LNG
        && (float) $writtenGeom['coordinates'][1] === $WIKI_LAT);
check('audit log written', $pdo->auditWritten);
check('case archived', $pdo->caseArchived && $pdo->caseArchivedStatus === 'archived');
$resolution = json_decode($pdo->caseResolutionJson, true);
check('resolution_json records set_geometry_to_wiki', is_array($resolution) && ($resolution['resolution'] ?? '') === 'set_geometry_to_wiki');
check('returns the moved feature', is_array($result) && ($result['feature']['public_id'] ?? '') === $PUBLIC_ID);
check('(A) no political_territory write', $pdo->politicalWritten === false);

// ===========================================================================
// (B) STALE REVISION -> conflict, no writes.
// ===========================================================================
echo "\n-- (B) stale expected_revision -> AvesmapsConflictException, no write --\n";
$pdo = new FakeGeomPdo(makeFeature(9), makeCase('coordinate_drift', 3)); // feature at rev 9
$threw = false;
try {
    avesmapsWikiSyncSetGeometryToWiki($pdo, [
        'case_id' => 909,
        'public_id' => $PUBLIC_ID,
        'lat' => $WIKI_LAT,
        'lng' => $WIKI_LNG,
        'expected_revision' => 3, // != 9 -> mismatch
    ], $USER);
} catch (AvesmapsConflictException $exception) {
    $threw = true;
}
check('throws AvesmapsConflictException on revision mismatch', $threw);
check('(B) NO geometry write', $pdo->mapFeaturesUpdated === false);
check('(B) NO case archive', $pdo->caseArchived === false);

// ===========================================================================
// (C) LOCK HELD BY ANOTHER USER -> conflict, no writes.
// ===========================================================================
echo "\n-- (C) lock held by another user -> conflict, no write --\n";
$pdo = new FakeGeomPdo(makeFeature(3), makeCase('coordinate_drift', 3));
$pdo->lock = ['user_id' => 999, 'username' => 'someone-else']; // different from USER id 5
$threw = false;
try {
    avesmapsWikiSyncSetGeometryToWiki($pdo, [
        'case_id' => 909,
        'public_id' => $PUBLIC_ID,
        'lat' => $WIKI_LAT,
        'lng' => $WIKI_LNG,
        'expected_revision' => 3,
    ], $USER);
} catch (AvesmapsConflictException $exception) {
    $threw = true;
}
check('throws AvesmapsConflictException when locked by another user', $threw);
check('(C) NO geometry write', $pdo->mapFeaturesUpdated === false);
check('(C) NO case archive', $pdo->caseArchived === false);

// ===========================================================================
// (D) WRONG CASE TYPE -> rejected before any write.
// ===========================================================================
echo "\n-- (D) non-coordinate_drift case -> InvalidArgumentException, no write --\n";
$pdo = new FakeGeomPdo(makeFeature(3), makeCase('type_conflict', 3));
$threw = false;
try {
    avesmapsWikiSyncSetGeometryToWiki($pdo, [
        'case_id' => 909,
        'public_id' => $PUBLIC_ID,
        'lat' => $WIKI_LAT,
        'lng' => $WIKI_LNG,
        'expected_revision' => 3,
    ], $USER);
} catch (InvalidArgumentException $exception) {
    $threw = true;
}
check('rejects a non-drift case type', $threw);
check('(D) NO geometry write', $pdo->mapFeaturesUpdated === false);
check('(D) NO case archive', $pdo->caseArchived === false);

// ===========================================================================
// (E) STAGING GUARD across the happy path's executed SQL.
// ===========================================================================
echo "\n-- (E) staging guard: only map_features + wiki_sync_cases written --\n";
$pdo = new FakeGeomPdo(makeFeature(3), makeCase('coordinate_drift', 3));
avesmapsWikiSyncSetGeometryToWiki($pdo, [
    'case_id' => 909,
    'public_id' => $PUBLIC_ID,
    'lat' => $WIKI_LAT,
    'lng' => $WIKI_LNG,
    'expected_revision' => 3,
], $USER);
$writeSql = array_filter($pdo->executedSql, static function (string $sql): bool {
    return preg_match('/\b(UPDATE|INSERT|DELETE)\b/i', $sql) === 1;
});
$badWrites = array_filter($writeSql, static function (string $sql): bool {
    return stripos($sql, 'map_features') === false
        && stripos($sql, 'map_revision') === false
        && stripos($sql, 'map_audit_log') === false
        && stripos($sql, 'map_feature_locks') === false
        && stripos($sql, 'wiki_sync_cases') === false;
});
check('no writes outside map_* / wiki_sync_cases', count($badWrites) === 0);
check('(E) no political_territory write', $pdo->politicalWritten === false);

// ---------------------------------------------------------------------------
echo "\n";
if ($failures === 0) {
    echo "PASS: {$assertions} assertions.\n";
    exit(0);
}
echo "FAIL: {$failures} of {$assertions} assertions failed.\n";
exit(1);

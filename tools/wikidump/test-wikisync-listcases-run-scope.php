<?php

declare(strict_types=1);

/**
 * Unit test for BUG A: avesmapsWikiSyncListCases() must resolve its "latest
 * completed run" SCOPED to sync_type='location', matching the run the settlement
 * conflict cases are keyed to (avesmapsWikiDumpSettlementCaseRunId mints/reuses a
 * LOCATION run). Before the fix it called the UNTYPED
 * avesmapsWikiSyncFetchLatestCompletedRun(), which -- after "Dump holen" -- returns
 * the newer dump_read run; the reader's `WHERE last_seen_run_id = :run_id` filter
 * then matched 0 rows and the Konfliktloesung accordion showed EMPTY even though
 * the cases existed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES
 * ---------------------------------------------------------------------------
 *   (A) avesmapsWikiSyncFetchLatestCompletedRun($pdo, 'location') returns the
 *       LOCATION run even when a NEWER dump_read run exists (the typed lookup),
 *       while the untyped call still returns the newest-of-any-type (dump_read) --
 *       proving the param scopes correctly and the default is unchanged.
 *   (B) avesmapsWikiSyncListCases() resolves the LOCATION run and RETURNS the
 *       settlement cases keyed to it (non-empty accordion). The fake models the
 *       cases as reachable ONLY under run_id = the location run's id, so a reader
 *       that (wrongly) picked the dump_read run would get 0 cases -- the test fails
 *       in that case.
 *
 * A fake PDO models the two SELECT shapes the reader hits: the run-resolution
 * (typed vs untyped) and the cases list/summary (`last_seen_run_id = :run_id`).
 * No live DB.
 *
 * HOW TO RUN:
 *     php -d extension=php_mbstring.dll tools/wikidump/test-wikisync-listcases-run-scope.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded (reused helpers require mb_*).\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 2);
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';

// Endpoint-only constant the reader reads at request time (defined in
// api/edit/wiki/sync.php in production; mirror the value here).
if (!defined('AVESMAPS_WIKI_SYNC_TYPE_LOCATION')) { define('AVESMAPS_WIKI_SYNC_TYPE_LOCATION', 'location'); }

foreach (['avesmapsWikiSyncFetchLatestCompletedRun', 'avesmapsWikiSyncListCases'] as $fn) {
    if (!function_exists($fn)) {
        fwrite(STDERR, "FATAL: expected function {$fn}() is not defined.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// Assertion harness.
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;
$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-64s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-64s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " avesmapsWikiSyncListCases run-scope test (BUG A)\n";
echo "================================================================\n";

// The two runs. The dump_read run is NEWER (bigger id + later completed_at) than
// the location run -- exactly the "after Dump holen" situation that broke the reader.
const LOCATION_RUN_ID = 100;
const DUMP_READ_RUN_ID = 200;

$LOCATION_RUN = [
    'id' => LOCATION_RUN_ID,
    'public_id' => 'run-location-0001',
    'sync_type' => 'location',
    'status' => 'completed',
    'phase' => 'completed',
    'progress_current' => 4,
    'progress_total' => 4,
    'message' => 'settlement cases',
    'stats_json' => json_encode([]),
    'created_at' => '2026-07-03 09:00:00.000',
    'updated_at' => '2026-07-03 09:00:00.000',
    'completed_at' => '2026-07-03 09:00:00.000',
];
$DUMP_READ_RUN = [
    'id' => DUMP_READ_RUN_ID,
    'public_id' => 'run-dumpread-0001',
    'sync_type' => 'dump_read',
    'status' => 'completed',
    'phase' => 'completed',
    'progress_current' => 7,
    'progress_total' => 7,
    'message' => 'dump read',
    'stats_json' => json_encode([]),
    'created_at' => '2026-07-03 10:00:00.000',
    'updated_at' => '2026-07-03 10:00:00.000',
    'completed_at' => '2026-07-03 10:00:00.000', // NEWER than the location run
];

// Two settlement cases, keyed (last_seen_run_id) to the LOCATION run.
$CASES_FOR_LOCATION_RUN = [
    [
        'id' => 1,
        'case_type' => 'type_conflict',
        'status' => 'open',
        'map_public_id' => 'map-0001',
        'wiki_title' => 'Ferdok',
        'payload_json' => json_encode(['map' => ['public_id' => 'map-0001'], 'wiki' => ['title' => 'Ferdok']]),
        'resolution_json' => null,
        'signature_hash' => str_repeat('a', 64),
        'updated_at' => '2026-07-03 09:00:00.000',
    ],
    [
        'id' => 2,
        'case_type' => 'missing_wiki_with_coordinates',
        'status' => 'open',
        'map_public_id' => '',
        'wiki_title' => 'Lonelytown',
        'payload_json' => json_encode(['wiki' => ['title' => 'Lonelytown']]),
        'resolution_json' => null,
        'signature_hash' => str_repeat('b', 64),
        'updated_at' => '2026-07-03 09:00:00.000',
    ],
];

// ---------------------------------------------------------------------------
// Fake PDO/PDOStatement. Models:
//   - run resolution: prepared statement with :sync_type -> returns the row for
//     that type (location -> LOCATION_RUN); the UNTYPED query() path -> the newest
//     of any type (DUMP_READ_RUN). This is what proves the scoping.
//   - active-run lookup (prepared, status='running') -> none.
//   - cases list SELECT (prepared, `last_seen_run_id = :run_id`) -> the cases ONLY
//     when :run_id == LOCATION_RUN_ID (they are keyed to the location run).
//   - summary GROUP BY SELECT (prepared, `last_seen_run_id = :run_id`) -> one
//     grouped row per case, again ONLY when :run_id == LOCATION_RUN_ID.
// ---------------------------------------------------------------------------
final class FakeRunStmt extends PDOStatement
{
    private array $rows = [];

    public function __construct(private string $sql, private FakeRunPdo $pdo)
    {
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $bound = (array) ($params ?? []);
        $sql = $this->sql;
        $this->rows = [];

        // Run resolution (typed): SELECT * FROM wiki_sync_runs WHERE status='completed' AND sync_type=:sync_type
        if (stripos($sql, 'FROM wiki_sync_runs') !== false
            && stripos($sql, 'sync_type = :sync_type') !== false
            && stripos($sql, "status = 'completed'") !== false) {
            $type = (string) ($bound['sync_type'] ?? '');
            if ($type === 'location') {
                $this->rows = [$this->pdo->locationRun];
            } elseif ($type === 'dump_read') {
                $this->rows = [$this->pdo->dumpReadRun];
            }
            return true;
        }

        // Active-run lookup: status='running' -> none in this fixture.
        if (stripos($sql, 'FROM wiki_sync_runs') !== false
            && stripos($sql, 'status = :status') !== false) {
            $this->rows = [];
            return true;
        }

        // Cases list SELECT (has payload_json + signature_hash in the column list).
        if (stripos($sql, 'FROM wiki_sync_cases') !== false
            && stripos($sql, 'payload_json') !== false
            && stripos($sql, 'signature_hash') !== false
            && stripos($sql, 'GROUP BY') === false) {
            $runId = (int) ($bound['run_id'] ?? 0);
            $this->rows = $runId === LOCATION_RUN_ID ? $this->pdo->casesForLocationRun : [];
            return true;
        }

        // Summary GROUP BY SELECT.
        if (stripos($sql, 'FROM wiki_sync_cases') !== false && stripos($sql, 'GROUP BY') !== false) {
            $runId = (int) ($bound['run_id'] ?? 0);
            if ($runId === LOCATION_RUN_ID) {
                $grouped = [];
                foreach ($this->pdo->casesForLocationRun as $case) {
                    $key = $case['case_type'] . '|' . $case['status'];
                    $grouped[$key] = $grouped[$key] ?? ['case_type' => $case['case_type'], 'status' => $case['status'], 'case_count' => 0];
                    $grouped[$key]['case_count']++;
                }
                $this->rows = array_values($grouped);
            } else {
                $this->rows = [];
            }
            return true;
        }

        // Any other DDL/SELECT: empty.
        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        return $this->rows === [] ? false : $this->rows[0];
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        return $this->rows;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        return $this->rows === [] ? false : array_values($this->rows[0])[$column];
    }
}

final class FakeRunPdo extends PDO
{
    public function __construct(
        public array $locationRun,
        public array $dumpReadRun,
        public array $casesForLocationRun
    ) {
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeRunStmt((string) $query, $this);
    }

    #[\ReturnTypeWillChange]
    public function query($statement, $mode = PDO::ATTR_DEFAULT_FETCH_MODE, ...$fetchModeArgs)
    {
        // The UNTYPED run-resolution path (no :sync_type bind): newest of ANY type
        // = the dump_read run (the WRONG run for location cases). Used to prove the
        // default (untyped) behaviour is unchanged.
        $stmt = new FakeRunStmt((string) $statement, $this);
        if (stripos((string) $statement, 'FROM wiki_sync_runs') !== false
            && stripos((string) $statement, "status = 'completed'") !== false
            && stripos((string) $statement, 'sync_type') === false) {
            // Simulate the untyped ORDER BY completed_at DESC result directly.
            $ref = new ReflectionClass($stmt);
            $prop = $ref->getProperty('rows');
            $prop->setAccessible(true);
            $prop->setValue($stmt, [$this->dumpReadRun]);
        }
        return $stmt;
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        return 0;
    }
}

$pdo = new FakeRunPdo($LOCATION_RUN, $DUMP_READ_RUN, $CASES_FOR_LOCATION_RUN);

// ---------------------------------------------------------------------------
// (A) The typed lookup scopes to location; the untyped default does not.
// ---------------------------------------------------------------------------
echo "\n-- (A) run-resolution scoping --\n";

$typed = avesmapsWikiSyncFetchLatestCompletedRun($pdo, AVESMAPS_WIKI_SYNC_TYPE_LOCATION);
$check('(A1) typed lookup returns the LOCATION run', LOCATION_RUN_ID, (int) ($typed['id'] ?? 0),
    'scoping to sync_type=location resolves the run the cases are keyed to, not the newer dump_read run');
$check('(A2) typed lookup run is sync_type=location', 'location', (string) ($typed['sync_type'] ?? ''),
    'the resolved run is the location run specifically');

$untyped = avesmapsWikiSyncFetchLatestCompletedRun($pdo);
$check('(A3) UNTYPED (default) lookup still returns newest-of-any (dump_read)', DUMP_READ_RUN_ID,
    (int) ($untyped['id'] ?? 0),
    'the default behaviour is UNCHANGED -- other callers still get the newest completed run of any type');

// ---------------------------------------------------------------------------
// (B) avesmapsWikiSyncListCases resolves the location run and returns its cases.
// ---------------------------------------------------------------------------
echo "\n-- (B) the reader returns the settlement cases (non-empty accordion) --\n";

$result = avesmapsWikiSyncListCases($pdo);

$check('(B1) latest_run is the LOCATION run public_id', 'run-location-0001',
    (string) ($result['latest_run']['public_id'] ?? ''),
    'the reader now resolves the location run, matching the case writer');
$check('(B2) the reader returns 2 cases (NOT the empty accordion)', 2, count($result['cases'] ?? []),
    'the cases keyed to the location run are surfaced -- the BUG A symptom (0 cases) is gone');
$check('(B3) the summary case_count matches', 2, (int) ($result['summary']['case_count'] ?? -1),
    'the summary is built off the SAME (location) run, so its counts agree with the case list');

// Case types round-trip.
$types = array_map(static fn(array $c): string => (string) $c['case_type'], $result['cases'] ?? []);
sort($types);
$check('(B4) both settlement case types are present', ['missing_wiki_with_coordinates', 'type_conflict'], $types,
    'the exact cases keyed to the location run are returned');

echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);

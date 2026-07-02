<?php

declare(strict_types=1);

/**
 * PURE-logic-with-fake-PDO unit test for the "Dump holen" cleanup seam:
 * avesmapsWikiDumpHybridCleanupOldSandboxState() in
 * api/_internal/wiki/dump-hybrid-driver.php.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS
 * ---------------------------------------------------------------------------
 * The cleanup function is the ONLY new destructive operation this task adds
 * (a DELETE from wiki_dump_hybrid_state / wiki_dump_title_alias). Per the
 * brief, it must be exercised against a fake PDO for exactly these guard
 * cases:
 *
 *   (A) Multiple dump_read runs present, several completed -> only the
 *       NEWEST completed run survives; every other run's rows (state +
 *       alias) are deleted.
 *   (B) Exactly one dump_read run present (completed) -> nothing is
 *       deleted (there is no "other" run to delete).
 *   (C) No dump_read run has ever completed (only running/failed runs
 *       exist) -> nothing is deleted, kept_run_id is null. This is the
 *       case that proves the function can never wipe an in-progress-only
 *       state: the DELETE only ever executes once a kept (completed) run
 *       id is known.
 *   (D) The kept run is re-derived from wiki_sync_runs (newest completed),
 *       NEVER trusted from a caller-supplied id -- there is no id
 *       parameter at all, so this is structurally guaranteed, but the test
 *       still asserts the SELECT ordering picks the newest by
 *       completed_at/id.
 *   (E) Every write happens inside a single transaction (begin + commit
 *       observed; a thrown exception rolls back and rethrows).
 *   (F) CONCURRENCY GUARD: a second dump_read run that is still in progress
 *       (status='running') and is NOT the kept run must SURVIVE cleanup --
 *       neither its wiki_dump_hybrid_state nor its wiki_dump_title_alias
 *       rows may be deleted, because it might be mid-scan. The "other runs"
 *       delete-candidate set is scoped to TERMINAL (non-'running') runs
 *       only; a caller-supplied kept-run id is irrelevant here since the
 *       running run in this case is a completely separate id from the kept
 *       one, yet must still be excluded from the delete IN(...) list.
 *
 * This is a fake-PDO test (no live MySQL), following the same convention as
 * tools/wikidump/test-dump-hybrid-read-driver.php's FakeDriverPdo/
 * FakeDriverStmt pair -- a small PDO subclass that recognises only the
 * handful of SQL shapes the cleanup function issues (a wiring guard, not a
 * SQL engine).
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring/XMLReader caveat as the sibling
 * tools/wikidump tests -- the reused derivation functions call mb_*):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-hybrid-cleanup.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the include chain needs XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the SAME chain test-dump-hybrid-read-driver.php uses (the
//    cleanup function lives in the same file as the driver it was added to).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-category-layer.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-driver.php';
$includeOutput = (string) ob_get_clean();

if (!function_exists('avesmapsWikiDumpHybridCleanupOldSandboxState')) {
    fwrite(STDERR, "FATAL: expected function avesmapsWikiDumpHybridCleanupOldSandboxState() was not defined by dump-hybrid-driver.php.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors the sibling tools/wikidump tests).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-70s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-70s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// ---------------------------------------------------------------------------
// 3. Fake PDO/PDOStatement recognising only the SQL shapes
//    avesmapsWikiDumpHybridCleanupOldSandboxState() issues:
//      - CREATE TABLE IF NOT EXISTS wiki_dump_hybrid_state / wiki_dump_title_alias (DDL, via exec())
//      - SELECT id FROM wiki_sync_runs WHERE sync_type=... AND status='completed' ... FOR UPDATE  (the "keep" pick)
//      - SELECT id FROM wiki_sync_runs WHERE sync_type=... AND id != :keep_run_id                 (the "other runs" set)
//      - DELETE FROM wiki_dump_hybrid_state WHERE run_id IN (...)
//      - DELETE FROM wiki_dump_title_alias WHERE run_id IN (...)
//    Seeded with a fixed list of canned wiki_sync_runs rows (id/sync_type/status/completed_at)
//    and canned state/alias row counts per run_id, so DELETE rowCount() reflects "how many
//    rows existed for these run_ids" without a real table.
// ---------------------------------------------------------------------------

final class FakeCleanupStmt extends PDOStatement
{
    /** @var list<int> bound positional params (DELETE ... IN (?,?,...)) */
    public array $positionalParams = [];
    /** @var array<string,mixed> bound named params */
    public array $namedParams = [];
    private int $deletedRowCount = 0;

    public function __construct(
        private string $sql,
        private object $pdo
    ) {
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $sql = $this->sql;

        // (1) The "keep" SELECT: newest completed dump_read run, ordered by
        //     completed_at DESC, id DESC, FOR UPDATE.
        if (stripos($sql, 'FROM wiki_sync_runs') !== false && stripos($sql, "status = 'completed'") !== false) {
            $this->namedParams = (array) $params;
            return true;
        }

        // (2) The "other runs" SELECT: every dump_read run id except the kept one.
        if (stripos($sql, 'FROM wiki_sync_runs') !== false && stripos($sql, 'id != :keep_run_id') !== false) {
            $this->namedParams = (array) $params;
            return true;
        }

        // (3) The two DELETEs (positional IN (...) placeholders).
        if (stripos($sql, 'DELETE FROM wiki_dump_hybrid_state') !== false) {
            $runIds = (array) $params;
            $this->positionalParams = array_map('intval', $runIds);
            $this->deletedRowCount = 0;
            foreach ($this->positionalParams as $runId) {
                $this->deletedRowCount += (int) ($this->pdo->stateRowCounts[$runId] ?? 0);
            }
            $this->pdo->deleteStateCalls[] = $this->positionalParams;
            return true;
        }
        if (stripos($sql, 'DELETE FROM wiki_dump_title_alias') !== false) {
            $runIds = (array) $params;
            $this->positionalParams = array_map('intval', $runIds);
            $this->deletedRowCount = 0;
            foreach ($this->positionalParams as $runId) {
                $this->deletedRowCount += (int) ($this->pdo->aliasRowCounts[$runId] ?? 0);
            }
            $this->pdo->deleteAliasCalls[] = $this->positionalParams;
            return true;
        }

        throw new RuntimeException('FakeCleanupStmt: unrecognised SQL shape: ' . $sql);
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        // The "keep" SELECT: return the newest completed run's id, or false if none.
        if (stripos($this->sql, "status = 'completed'") !== false) {
            $wantedSyncType = $this->namedParams['sync_type'] ?? '';
            $completed = array_values(array_filter(
                $this->pdo->runs,
                static fn (array $run): bool => $run['sync_type'] === $wantedSyncType && $run['status'] === 'completed'
            ));
            if ($completed === []) {
                return false;
            }
            usort($completed, static function (array $a, array $b): int {
                // ORDER BY completed_at DESC, id DESC.
                $cmp = strcmp((string) $b['completed_at'], (string) $a['completed_at']);
                return $cmp !== 0 ? $cmp : ($b['id'] <=> $a['id']);
            });
            return $completed[0]['id'];
        }
        return false;
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        // The "other runs" SELECT: every TERMINAL (non-'running') run of this
        // sync_type except keep_run_id -- mirrors the real WHERE clause's
        // "AND status != 'running'" concurrency guard, so a fake run seeded with
        // status='running' is excluded here exactly as MySQL would exclude it.
        if (stripos($this->sql, 'id != :keep_run_id') !== false) {
            $syncType = $this->namedParams['sync_type'] ?? '';
            $keepId = (int) ($this->namedParams['keep_run_id'] ?? 0);
            $ids = [];
            foreach ($this->pdo->runs as $run) {
                if ($run['sync_type'] === $syncType && (int) $run['id'] !== $keepId && $run['status'] !== 'running') {
                    $ids[] = $run['id'];
                }
            }
            if ($mode === PDO::FETCH_COLUMN) {
                return $ids;
            }
            return array_map(static fn ($id) => ['id' => $id], $ids);
        }
        return [];
    }

    #[\ReturnTypeWillChange]
    public function rowCount(): int
    {
        return $this->deletedRowCount;
    }
}

final class FakeCleanupPdo extends PDO
{
    /** @var list<array{id:int,sync_type:string,status:string,completed_at:?string}> */
    public array $runs = [];
    /** @var array<int,int> run_id => row count in wiki_dump_hybrid_state */
    public array $stateRowCounts = [];
    /** @var array<int,int> run_id => row count in wiki_dump_title_alias */
    public array $aliasRowCounts = [];
    /** @var list<list<int>> each DELETE ... IN (...) call's run_id list, wiki_dump_hybrid_state */
    public array $deleteStateCalls = [];
    /** @var list<list<int>> each DELETE ... IN (...) call's run_id list, wiki_dump_title_alias */
    public array $deleteAliasCalls = [];
    public int $beginCount = 0;
    public int $commitCount = 0;
    public int $rollBackCount = 0;
    private bool $inTx = false;

    public function __construct(array $runs, array $stateRowCounts = [], array $aliasRowCounts = [])
    {
        $this->runs = $runs;
        $this->stateRowCounts = $stateRowCounts;
        $this->aliasRowCounts = $aliasRowCounts;
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        return 0; // DDL no-op (CREATE TABLE IF NOT EXISTS)
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeCleanupStmt((string) $query, $this);
    }

    #[\ReturnTypeWillChange]
    public function beginTransaction(): bool
    {
        $this->beginCount++;
        $this->inTx = true;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function commit(): bool
    {
        $this->commitCount++;
        $this->inTx = false;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function rollBack(): bool
    {
        $this->rollBackCount++;
        $this->inTx = false;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function inTransaction(): bool
    {
        return $this->inTx;
    }
}

echo "================================================================\n";
echo " dump-hybrid-driver cleanup seam test (\"Dump holen\" step 3/3, H4c-cleanup)\n";
echo "================================================================\n";

$check('(0) include produced no output', '', $includeOutput, 'the driver stays side-effect-free on include (defs only, no DB connect)');

// ===========================================================================
// (A) Multiple runs, several completed -> only the NEWEST completed survives.
// ===========================================================================
echo "\n-- (A) multiple dump_read runs, several completed --\n";

$runsA = [
    ['id' => 10, 'sync_type' => 'dump_read', 'status' => 'completed', 'completed_at' => '2026-06-30 10:00:00.000'],
    ['id' => 11, 'sync_type' => 'dump_read', 'status' => 'completed', 'completed_at' => '2026-07-01 09:00:00.000'],
    ['id' => 12, 'sync_type' => 'dump_read', 'status' => 'completed', 'completed_at' => '2026-07-02 12:00:00.000'], // newest
    ['id' => 13, 'sync_type' => 'dump_read', 'status' => 'failed', 'completed_at' => null],
    // A different sync_type sharing no ids with the dump_read runs (single AUTO_INCREMENT
    // column across the whole wiki_sync_runs table) -- must never be touched.
    ['id' => 99, 'sync_type' => 'location', 'status' => 'completed', 'completed_at' => '2026-07-02 13:00:00.000'],
];
$pdoA = new FakeCleanupPdo(
    $runsA,
    /* stateRowCounts */ [10 => 40, 11 => 55, 12 => 70, 13 => 5],
    /* aliasRowCounts */ [10 => 4, 11 => 6, 12 => 9, 13 => 1]
);
$resultA = avesmapsWikiDumpHybridCleanupOldSandboxState($pdoA);

$check(
    '(A1) the kept run is the NEWEST completed run (id 12, latest completed_at)',
    12,
    $resultA['kept_run_id'],
    'run 12 has the latest completed_at among the completed dump_read runs -> it is kept'
);
$check(
    '(A2) every OTHER dump_read run id (10, 11, 13) is deleted from -- run 13 is failed but still an "other" run',
    [10, 11, 13],
    $pdoA->deleteStateCalls[0] ?? [],
    'the delete scope is every dump_read run except the kept one, regardless of that other run\'s own status'
);
$check(
    '(A3) the alias-table DELETE targets the SAME run id set as the state-table DELETE',
    [10, 11, 13],
    $pdoA->deleteAliasCalls[0] ?? [],
    'both tables are pruned for the exact same "every other dump_read run" set'
);
$check(
    '(A4) deleted_state_rows sums the row counts of the deleted runs only (40+55+5=100), NOT the kept run\'s 70',
    100,
    $resultA['deleted_state_rows'],
    'the kept run\'s 70 sandbox rows are excluded from the deletion count'
);
$check(
    '(A5) deleted_alias_rows sums only the deleted runs\' alias rows (4+6+1=11)',
    11,
    $resultA['deleted_alias_rows'],
    'the kept run\'s 9 alias rows are excluded'
);
$check(
    '(A6) the unrelated location-sync_type run (id 99) is NEVER included in any delete call',
    false,
    in_array(99, array_merge($pdoA->deleteStateCalls[0] ?? [], $pdoA->deleteAliasCalls[0] ?? []), true),
    'the deletion scope is strictly sync_type=dump_read; a location-type run id can never appear in the IN(...) list'
);
$check(
    '(A7) the whole operation ran inside exactly one transaction (begin+commit, no rollback)',
    [1, 1, 0],
    [$pdoA->beginCount, $pdoA->commitCount, $pdoA->rollBackCount],
    'one beginTransaction + one commit; rollBack never called on the success path'
);

// ===========================================================================
// (B) Exactly one dump_read run present (completed) -> nothing deleted.
// ===========================================================================
echo "\n-- (B) exactly one dump_read run present --\n";

$runsB = [
    ['id' => 20, 'sync_type' => 'dump_read', 'status' => 'completed', 'completed_at' => '2026-07-02 08:00:00.000'],
];
$pdoB = new FakeCleanupPdo($runsB, [20 => 12], [20 => 3]);
$resultB = avesmapsWikiDumpHybridCleanupOldSandboxState($pdoB);

$check(
    '(B1) the single run becomes the kept run',
    20,
    $resultB['kept_run_id'],
    'with only one dump_read run, it is trivially the newest completed one'
);
$check(
    '(B2) NOTHING is deleted -- the "other runs" set is empty, so the DELETE statements are never even issued',
    [0, 0, [], []],
    [$resultB['deleted_state_rows'], $resultB['deleted_alias_rows'], $pdoB->deleteStateCalls, $pdoB->deleteAliasCalls],
    'a single run has no "other" run to delete; the function short-circuits before preparing any DELETE'
);
$check(
    '(B3) still ran inside a transaction (begin+commit)',
    [1, 1, 0],
    [$pdoB->beginCount, $pdoB->commitCount, $pdoB->rollBackCount],
    'the no-op path still commits its (empty) transaction cleanly'
);

// ===========================================================================
// (C) No dump_read run has EVER completed -> nothing deleted, kept_run_id null.
//     THE invariant: a cleanup call can never wipe an in-progress-only run's
//     sandbox state, because no completed run exists to become "the kept one".
// ===========================================================================
echo "\n-- (C) no completed dump_read run exists (only running/failed) --\n";

$runsC = [
    ['id' => 30, 'sync_type' => 'dump_read', 'status' => 'running', 'completed_at' => null],
    ['id' => 31, 'sync_type' => 'dump_read', 'status' => 'failed', 'completed_at' => null],
];
$pdoC = new FakeCleanupPdo($runsC, [30 => 999, 31 => 250], [30 => 40, 31 => 12]);
$resultC = avesmapsWikiDumpHybridCleanupOldSandboxState($pdoC);

$check(
    '(C1) kept_run_id is null (no completed run exists to keep)',
    null,
    $resultC['kept_run_id'],
    'never invents a "kept" run out of a running or failed one'
);
$check(
    '(C2) NOTHING is deleted -- not even the failed run\'s 12 rows -- and no DELETE is prepared at all',
    [0, 0, [], []],
    [$resultC['deleted_state_rows'], $resultC['deleted_alias_rows'], $pdoC->deleteStateCalls, $pdoC->deleteAliasCalls],
    'THE guard: a cleanup call is structurally incapable of wiping an in-progress-only (or failed-only) state -- the DELETE only ever executes once a completed kept-run id is known, and here none exists'
);
$check(
    '(C3) still ran inside a transaction that committed (the no-op is not an error)',
    [1, 1, 0],
    [$pdoC->beginCount, $pdoC->commitCount, $pdoC->rollBackCount],
    'a no-completed-run scan is a normal, successful outcome -- not a thrown error'
);

// ===========================================================================
// (F) CONCURRENCY GUARD: a second, in-progress (status='running') dump_read
//     run that is NOT the kept run must survive cleanup untouched -- proves
//     the fix for the gap where the "other runs" SELECT picked candidates by
//     sync_type alone, letting a concurrent in-flight scan's state rows be
//     deleted out from under it.
// ===========================================================================
echo "\n-- (F) a concurrent in-progress dump_read run survives cleanup --\n";

$runsF = [
    ['id' => 40, 'sync_type' => 'dump_read', 'status' => 'completed', 'completed_at' => '2026-07-02 12:00:00.000'], // newest completed -> kept
    ['id' => 41, 'sync_type' => 'dump_read', 'status' => 'completed', 'completed_at' => '2026-06-30 09:00:00.000'], // older completed -> deleted
    ['id' => 42, 'sync_type' => 'dump_read', 'status' => 'running', 'completed_at' => null], // concurrent in-flight scan -> MUST survive
];
$pdoF = new FakeCleanupPdo(
    $runsF,
    /* stateRowCounts */ [40 => 80, 41 => 60, 42 => 999],
    /* aliasRowCounts */ [40 => 9, 41 => 7, 42 => 123]
);
$resultF = avesmapsWikiDumpHybridCleanupOldSandboxState($pdoF);

$check(
    '(F1) the kept run is still the newest completed run (id 40)',
    40,
    $resultF['kept_run_id'],
    'the running run (42) never competes for "kept" status -- only completed runs do'
);
$check(
    '(F2) the delete scope is ONLY the older completed run (41) -- the running run (42) is excluded',
    [41],
    $pdoF->deleteStateCalls[0] ?? [],
    'run 42 is neither the kept run NOR eligible for deletion: it is mid-scan (status=running), so it must be excluded from the "other runs" candidate set entirely'
);
$check(
    '(F3) the alias-table DELETE also excludes the running run (42), same scope as the state-table DELETE',
    [41],
    $pdoF->deleteAliasCalls[0] ?? [],
    'both tables use the same terminal-only "other runs" id list'
);
$check(
    '(F4) deleted_state_rows counts only run 41\'s 60 rows -- NOT run 42\'s 999 in-flight rows',
    60,
    $resultF['deleted_state_rows'],
    'if run 42 had been included, this would wrongly be 60+999=1059 and would have deleted a live scan\'s sandbox state'
);
$check(
    '(F5) deleted_alias_rows counts only run 41\'s 7 rows -- NOT run 42\'s 123 in-flight rows',
    7,
    $resultF['deleted_alias_rows'],
    'same guard, alias table'
);

// ===========================================================================
// (D) A thrown exception mid-transaction rolls back and rethrows (never
//     silently swallowed, never left half-committed).
// ===========================================================================
echo "\n-- (D) exception during the DELETE phase rolls back --\n";

final class ThrowingCleanupStmt extends PDOStatement
{
    public function __construct(private string $sql)
    {
    }
    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        if (stripos($this->sql, 'DELETE FROM wiki_dump_hybrid_state') !== false) {
            throw new RuntimeException('simulated DB failure mid-cleanup');
        }
        return true;
    }
    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        return 40; // a single kept run id, forcing the code past the "other runs" branch
    }
    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        if (stripos($this->sql, 'id != :keep_run_id') !== false) {
            return [41]; // one "other" run -> the DELETE branch runs and throws
        }
        return [];
    }
}
final class ThrowingCleanupPdo extends PDO
{
    public int $beginCount = 0;
    public int $commitCount = 0;
    public int $rollBackCount = 0;
    private bool $inTx = false;

    public function __construct()
    {
        // Deliberately skip the real PDO::__construct() (no DSN needed) -- same
        // no-arg-constructor pattern as FakeCleanupPdo/FakeDriverPdo above.
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        return 0;
    }
    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new ThrowingCleanupStmt((string) $query);
    }
    #[\ReturnTypeWillChange]
    public function beginTransaction(): bool
    {
        $this->beginCount++;
        $this->inTx = true;
        return true;
    }
    #[\ReturnTypeWillChange]
    public function commit(): bool
    {
        $this->commitCount++;
        $this->inTx = false;
        return true;
    }
    #[\ReturnTypeWillChange]
    public function rollBack(): bool
    {
        $this->rollBackCount++;
        $this->inTx = false;
        return true;
    }
    #[\ReturnTypeWillChange]
    public function inTransaction(): bool
    {
        return $this->inTx;
    }
}

$throwingPdo = new ThrowingCleanupPdo();
$caught = null;
try {
    avesmapsWikiDumpHybridCleanupOldSandboxState($throwingPdo);
} catch (Throwable $exception) {
    $caught = $exception;
}
$check(
    '(D1) the exception propagates to the caller (never swallowed)',
    true,
    $caught instanceof RuntimeException && $caught->getMessage() === 'simulated DB failure mid-cleanup',
    'a mid-transaction DB failure surfaces to the caller (dump.php\'s outer catch handles the HTTP response)'
);
$check(
    '(D2) rollBack was called exactly once, commit never called',
    [1, 0, 1],
    [$throwingPdo->beginCount, $throwingPdo->commitCount, $throwingPdo->rollBackCount],
    'the partial DELETE never commits -- the transaction is rolled back before rethrowing'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);

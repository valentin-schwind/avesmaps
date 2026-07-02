<?php

declare(strict_types=1);

/**
 * Unit test for the WikiDump single-flight concurrency lock
 * (api/_internal/wiki/dump-lock.php).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (the brief's five concurrency cases + edges)
 * ---------------------------------------------------------------------------
 * The lock serializes the WHOLE dump pipeline across ALL editors. This is a
 * concurrency mechanism, so it is tested against a FAKE PDO that maintains a
 * single in-memory lock row and interprets the three statement shapes the lock
 * library issues:
 *
 *   1. INSERT ... ON DUPLICATE KEY UPDATE  (avesmapsWikiDumpLockTryAcquire)
 *   2. UPDATE ... SET heartbeat_at=NOW ... WHERE holder_user_id=:uid (heartbeat)
 *   3. UPDATE ... SET holder_user_id=NULL ... WHERE holder_user_id=:uid (release)
 *   4. SELECT holder_user_id, ..., TIMESTAMPDIFF(...) (read-back)
 *
 * The fake evaluates the ATOMIC-ACQUIRE PREDICATE by delegating to the library's
 * OWN pure avesmapsWikiDumpLockMayAcquire() -- i.e. the test exercises the real
 * free/stale/same-holder decision, not a re-implementation of it -- and models
 * the InnoDB single-row serialization by simply applying acquires sequentially
 * (two "simultaneous" acquirers are two sequential fake calls, which is exactly
 * what the id=1 row lock reduces concurrent acquires to).
 *
 * Cases (brief):
 *   (a) a SECOND acquire while a first holder is active  -> REJECTED.
 *   (b) an acquire succeeds when the prior lock is STALE -> TAKEN OVER.
 *   (c) HEARTBEAT keeps a hold alive (not stale after a heartbeat).
 *   (d) RELEASE frees the lock (next acquirer wins).
 *   (e) SAME-HOLDER RE-ENTRY is allowed (the fetch->...->cleanup chain).
 * Plus:
 *   (f) the PURE predicate directly (free / held-by-other-fresh / stale / same).
 *   (g) release is HOLDER-GUARDED (a non-holder release is a no-op).
 *   (h) heartbeat is HOLDER-GUARDED (a non-holder heartbeat does not steal).
 *   (i) acquire-or-throw raises WikiDumpLockBusyException on a lost race.
 *   (j) the include is side-effect-free (defs only).
 *
 * HOW TO RUN (dump-lock.php itself needs no mbstring or XMLReader, and it is
 * loaded after bootstrap.php which is dependency-light; no live MySQL required):
 *
 *     php tools/wikidump/test-dump-lock.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 1. Include chain: bootstrap (for InvalidArgumentException/helpers) + the lock.
//    dump-lock.php depends on nothing but PHP + PDO on include.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-lock.php';
$includeOutput = (string) ob_get_clean();

foreach ([
    'avesmapsWikiDumpLockMayAcquire',
    'avesmapsWikiDumpLockTryAcquire',
    'avesmapsWikiDumpLockAcquireOrThrow',
    'avesmapsWikiDumpLockHeartbeat',
    'avesmapsWikiDumpLockRelease',
    'avesmapsWikiDumpLockReadRow',
] as $fn) {
    if (!function_exists($fn)) {
        fwrite(STDERR, "FATAL: expected function {$fn}() was not defined by dump-lock.php.\n");
        exit(2);
    }
}
if (!class_exists('WikiDumpLockBusyException')) {
    fwrite(STDERR, "FATAL: expected class WikiDumpLockBusyException was not defined.\n");
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
        printf("PASS | %-72s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-72s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// ---------------------------------------------------------------------------
// 3. Fake PDO/PDOStatement that maintains ONE in-memory lock row and interprets
//    the exact statement shapes the lock library issues. The acquire predicate
//    is delegated to the library's OWN pure avesmapsWikiDumpLockMayAcquire(), so
//    the fake tests the real decision + the real read-back/holder-guard wiring.
//
//    Clock model: the row stores heartbeat_at / acquired_at as INTEGER "seconds"
//    on a virtual clock ($pdo->now). TIMESTAMPDIFF(SECOND, heartbeat_at, NOW) is
//    simulated as (now - heartbeat_at). Tests advance $pdo->now to age a hold.
// ---------------------------------------------------------------------------

final class FakeLockStmt extends PDOStatement
{
    public array $bound = [];
    private array $resultRow = [];

    public function __construct(
        private string $sql,
        private FakeLockPdo $pdo
    ) {
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $this->bound = (array) ($params ?? []);
        $sql = $this->sql;

        // (1) The atomic acquire: INSERT ... ON DUPLICATE KEY UPDATE.
        if (stripos($sql, 'INSERT INTO ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE) !== false) {
            $this->pdo->applyAcquire($this->bound);
            return true;
        }

        // (3) Release: UPDATE ... SET holder_user_id = NULL ... WHERE ... holder_user_id = :uid.
        if (stripos($sql, 'holder_user_id = NULL') !== false) {
            $this->pdo->lastAffected = $this->pdo->applyRelease((int) ($this->bound['uid'] ?? 0));
            return true;
        }

        // (2) Heartbeat: UPDATE ... SET heartbeat_at = NOW ... WHERE ... holder_user_id = :uid.
        if (stripos($sql, 'SET heartbeat_at') !== false && stripos($sql, 'holder_user_id = :uid') !== false) {
            $this->pdo->lastAffected = $this->pdo->applyHeartbeat(
                (int) ($this->bound['uid'] ?? 0),
                (string) ($this->bound['op'] ?? ''),
                array_key_exists('run_id', $this->bound) ? $this->bound['run_id'] : null,
                (int) ($this->bound['run_id_null'] ?? 1)
            );
            return true;
        }

        // (4) The read-back SELECT.
        if (stripos($sql, 'SELECT holder_user_id') !== false) {
            $this->resultRow = $this->pdo->projectReadRow();
            return true;
        }

        throw new RuntimeException('FakeLockStmt: unrecognised SQL shape: ' . $sql);
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        return $this->resultRow === [] ? false : $this->resultRow;
    }

    #[\ReturnTypeWillChange]
    public function rowCount(): int
    {
        return $this->pdo->lastAffected;
    }
}

final class FakeLockPdo extends PDO
{
    /**
     * The single lock row (id=1) or null if never written.
     * @var array{holder_user_id:?int, holder_username:string, operation:string, run_id:?string, acquired_at:?int, heartbeat_at:?int}|null
     */
    public ?array $row = null;
    /** Virtual clock in "seconds"; advance it to age a hold. */
    public int $now = 1000;
    /** rowCount() feed for the last UPDATE. */
    public int $lastAffected = 0;
    /** Count of real UPDATE-writes that changed the holder (for optional assertions). */
    public int $acquireWrites = 0;

    public function __construct()
    {
        // Skip the real PDO constructor (no DSN) -- same pattern as the sibling tests.
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        return 0; // DDL no-op (CREATE TABLE IF NOT EXISTS)
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeLockStmt((string) $query, $this);
    }

    /**
     * Apply the atomic acquire using the library's OWN pure predicate. This is
     * the fake's core: it reproduces the SQL IF(<free|stale|same>) gate by asking
     * avesmapsWikiDumpLockMayAcquire() whether this acquirer may take the row, and
     * if so writes the holder columns (resetting acquired_at only on a real
     * takeover by a different holder; preserving it on same-holder re-entry).
     */
    public function applyAcquire(array $bound): void
    {
        $uid = (int) ($bound['uid'] ?? 0);
        $uname = (string) ($bound['uname'] ?? '');
        $op = (string) ($bound['op'] ?? '');
        $runId = $bound['run_id'] ?? null;
        $stale = (int) ($bound['stale_a'] ?? AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS);

        $projected = $this->projectForPredicate();
        $may = avesmapsWikiDumpLockMayAcquire($projected, $uid, $stale);

        if ($this->row === null) {
            // Fresh INSERT (row absent) -> the VALUES(...) win unconditionally.
            $this->row = [
                'holder_user_id' => $uid,
                'holder_username' => $uname,
                'operation' => $op,
                'run_id' => $runId === null ? null : (string) $runId,
                'acquired_at' => $this->now,
                'heartbeat_at' => $this->now,
            ];
            $this->acquireWrites++;
            return;
        }

        if (!$may) {
            // Predicate false -> every column keeps its existing value (no-op).
            return;
        }

        $wasDifferentHolder = ($this->row['holder_user_id'] !== null) && ((int) $this->row['holder_user_id'] !== $uid);

        $this->row['holder_user_id'] = $uid;
        $this->row['holder_username'] = $uname;
        $this->row['operation'] = $op;
        $this->row['run_id'] = $runId === null ? null : (string) $runId;
        // acquired_at resets only on a takeover by a different holder; preserved on
        // same-holder re-entry (matches the SQL's acquired_at IF()).
        if ($wasDifferentHolder || $this->row['acquired_at'] === null) {
            $this->row['acquired_at'] = $this->now;
        }
        $this->row['heartbeat_at'] = $this->now;
        $this->acquireWrites++;
    }

    /** Heartbeat: holder-guarded refresh of heartbeat_at (+opt op/run_id). */
    public function applyHeartbeat(int $uid, string $op, $runId, int $runIdNull): int
    {
        if ($this->row === null || (int) ($this->row['holder_user_id'] ?? 0) !== $uid || $uid <= 0) {
            return 0; // WHERE holder_user_id=:uid did not match
        }
        $this->row['heartbeat_at'] = $this->now;
        if ($op !== '') {
            $this->row['operation'] = $op;
        }
        if ($runIdNull === 0) {
            $this->row['run_id'] = $runId === null ? null : (string) $runId;
        }
        return 1;
    }

    /** Release: holder-guarded clear back to the free state. */
    public function applyRelease(int $uid): int
    {
        if ($this->row === null || (int) ($this->row['holder_user_id'] ?? 0) !== $uid || $uid <= 0) {
            return 0;
        }
        $this->row = [
            'holder_user_id' => null,
            'holder_username' => '',
            'operation' => '',
            'run_id' => null,
            'acquired_at' => null,
            'heartbeat_at' => null,
        ];
        return 1;
    }

    /** Projection for the pure predicate (holder id + heartbeat age on the virtual clock). */
    private function projectForPredicate(): ?array
    {
        if ($this->row === null) {
            return null;
        }
        $hb = $this->row['heartbeat_at'];
        return [
            'holder_user_id' => $this->row['holder_user_id'],
            'heartbeat_age_seconds' => $hb === null ? null : ($this->now - (int) $hb),
        ];
    }

    /** The read-back SELECT projection (mirrors avesmapsWikiDumpLockReadRow's SELECT). */
    public function projectReadRow(): array
    {
        if ($this->row === null) {
            return [];
        }
        $hb = $this->row['heartbeat_at'];
        return [
            'holder_user_id' => $this->row['holder_user_id'],
            'holder_username' => $this->row['holder_username'],
            'operation' => $this->row['operation'],
            'run_id' => $this->row['run_id'],
            'heartbeat_age_seconds' => $hb === null ? null : ($this->now - (int) $hb),
        ];
    }
}

echo "================================================================\n";
echo " dump-lock single-flight concurrency lock test\n";
echo "================================================================\n";

$check('(0) include produced no output', '', $includeOutput, 'the lock lib stays side-effect-free on include (defs only, no DB connect)');

// ===========================================================================
// (f) PURE predicate avesmapsWikiDumpLockMayAcquire() -- the real decision.
// ===========================================================================
echo "\n-- (f) pure free/stale/same-holder predicate --\n";

$stale = AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS;

$check(
    '(f1) a null row (never held) is acquirable by anyone',
    true,
    avesmapsWikiDumpLockMayAcquire(null, 7, $stale),
    'no lock row -> free'
);
$check(
    '(f2) a row with holder=NULL is acquirable',
    true,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => null, 'heartbeat_age_seconds' => null], 7, $stale),
    'holder_user_id NULL -> free'
);
$check(
    '(f3) held by ANOTHER user with a FRESH heartbeat is NOT acquirable',
    false,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => 5, 'heartbeat_age_seconds' => 3], 7, $stale),
    'a live foreign holder blocks the acquire (the core rejection)'
);
$check(
    '(f4) held by another user but STALE (age >= threshold) IS acquirable',
    true,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => 5, 'heartbeat_age_seconds' => $stale], 7, $stale),
    'an abandoned hold (stale heartbeat) may be taken over'
);
$check(
    '(f5) held by another user, one second BEFORE stale, is NOT acquirable',
    false,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => 5, 'heartbeat_age_seconds' => $stale - 1], 7, $stale),
    'the boundary: just-under-threshold is still a live hold'
);
$check(
    '(f6) SAME holder is always acquirable (re-entry), even with a fresh heartbeat',
    true,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => 7, 'heartbeat_age_seconds' => 1], 7, $stale),
    'the current holder re-entering its own lock is allowed'
);
$check(
    '(f7) a foreign holder with NO heartbeat on record is treated as abandoned',
    true,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => 5, 'heartbeat_age_seconds' => null], 7, $stale),
    'a holder row with a null heartbeat cannot be proven live -> reclaimable'
);
$check(
    '(f8) userId 0 (anonymous) is NOT treated as the same holder as a stored id 0 with a fresh heartbeat',
    false,
    avesmapsWikiDumpLockMayAcquire(['holder_user_id' => 0, 'heartbeat_age_seconds' => 1], 0, $stale),
    'the same-holder arm requires userId > 0, so an anonymous acquirer cannot re-enter a (degenerate) 0-holder fresh lock; in production holder is always NULL or a real positive id, never 0'
);

// ===========================================================================
// (a) second acquire while active = REJECTED (via tryAcquire against the fake).
// ===========================================================================
echo "\n-- (a) a second acquire while a first holder is active is rejected --\n";

$pdo = new FakeLockPdo();
$pdo->now = 1000;

$firstWon = avesmapsWikiDumpLockTryAcquire($pdo, 7, 'alice', 'fetch_dump', null, $stale);
$check('(a1) user 7 (alice) acquires the free lock', true, $firstWon, 'first acquirer of a free lock wins');
$check('(a2) the row now records holder=7', 7, $pdo->row['holder_user_id'] ?? null, 'the fake row reflects the winning holder');

// A second, DIFFERENT user tries while alice is still fresh (clock barely moved).
$pdo->now = 1002;
$secondWon = avesmapsWikiDumpLockTryAcquire($pdo, 9, 'bob', 'fetch_dump', null, $stale);
$check('(a3) user 9 (bob) is REJECTED while alice holds a fresh lock', false, $secondWon, 'the second concurrent acquirer loses the race');
$check('(a4) the holder is STILL alice (7) -- bob\'s attempt was a no-op', 7, $pdo->row['holder_user_id'] ?? null, 'a lost acquire never overwrites the live holder');

// ===========================================================================
// (b) acquire succeeds when the prior lock is STALE.
// ===========================================================================
echo "\n-- (b) a stale prior lock can be taken over --\n";

// Age alice's hold past the threshold without a heartbeat.
$pdo->now = 1002 + $stale + 5;
$takeover = avesmapsWikiDumpLockTryAcquire($pdo, 9, 'bob', 'start_read', 'run-abc', $stale);
$check('(b1) user 9 (bob) takes over the STALE lock', true, $takeover, 'a hold whose heartbeat is older than the threshold is abandoned and reclaimable');
$check('(b2) the holder is now bob (9)', 9, $pdo->row['holder_user_id'] ?? null, 'the takeover rewrote the holder');
$check('(b3) the takeover reset acquired_at to now (a new, distinct hold)', $pdo->now, $pdo->row['acquired_at'] ?? null, 'a different-holder takeover starts a fresh acquired_at');
$check('(b4) the run_id was recorded on takeover', 'run-abc', $pdo->row['run_id'] ?? null, 'start_read stamps the run id onto the lock');

// ===========================================================================
// (e) SAME-HOLDER RE-ENTRY is allowed (fetch -> start_read -> read_step -> ...).
// ===========================================================================
echo "\n-- (e) same-holder re-entry across the fetch->...->cleanup chain --\n";

$pdo2 = new FakeLockPdo();
$pdo2->now = 5000;
avesmapsWikiDumpLockTryAcquire($pdo2, 3, 'carol', 'fetch_dump', null, $stale);
$acquiredAtStart = $pdo2->row['acquired_at'];

// carol proceeds through the chain in later requests (clock advances a little each time,
// but always well within the stale threshold). Every re-acquire must succeed.
$pdo2->now = 5005;
$r1 = avesmapsWikiDumpLockTryAcquire($pdo2, 3, 'carol', 'start_read', 'run-xyz', $stale);
$pdo2->now = 5010;
$r2 = avesmapsWikiDumpLockTryAcquire($pdo2, 3, 'carol', 'read_step', 'run-xyz', $stale);
$pdo2->now = 5015;
$r3 = avesmapsWikiDumpLockTryAcquire($pdo2, 3, 'carol', 'cleanup_state', null, $stale);

$check('(e1) re-entry as start_read succeeds', true, $r1, 'the holder re-enters its own lock');
$check('(e2) re-entry as read_step succeeds', true, $r2, 'each loop step re-acquires as the same holder');
$check('(e3) re-entry as cleanup_state succeeds', true, $r3, 'the terminal action re-enters before releasing');
$check(
    '(e4) acquired_at is PRESERVED across the whole chain (one continuous hold)',
    $acquiredAtStart,
    $pdo2->row['acquired_at'] ?? null,
    'same-holder re-entry never resets acquired_at -- it is one hold from fetch to cleanup'
);
$check('(e5) operation reflects the LATEST re-entry (cleanup_state)', 'cleanup_state', $pdo2->row['operation'] ?? null, 're-entry refreshes the operation label');

// A DIFFERENT user is still rejected mid-chain (carol has not released).
$pdo2->now = 5016;
$intruder = avesmapsWikiDumpLockTryAcquire($pdo2, 8, 'dave', 'fetch_dump', null, $stale);
$check('(e6) a different user is rejected mid-chain (carol still holds)', false, $intruder, 'the single-flight guard holds across the whole chain, not just the first action');

// ===========================================================================
// (c) HEARTBEAT keeps a hold alive (not stale after a heartbeat).
// ===========================================================================
echo "\n-- (c) heartbeat keeps a long run alive --\n";

$pdo3 = new FakeLockPdo();
$pdo3->now = 8000;
avesmapsWikiDumpLockTryAcquire($pdo3, 4, 'erin', 'read_step', 'run-hb', $stale);

// Advance almost to the threshold, then heartbeat -> the hold must be refreshed.
$pdo3->now = 8000 + $stale - 2;
$hb = avesmapsWikiDumpLockHeartbeat($pdo3, 4, 'read_step', 'run-hb');
$check('(c1) the holder\'s heartbeat returns true (still holds)', true, $hb, 'a holder-guarded heartbeat succeeds');
$check('(c2) heartbeat_at is bumped to now', $pdo3->now, $pdo3->row['heartbeat_at'] ?? null, 'the heartbeat refreshed the timestamp');

// Now move forward again by (threshold - 2): because the heartbeat reset the clock
// baseline, the hold is NOT yet stale, so a foreign acquire must still be REJECTED.
$pdo3->now = $pdo3->now + $stale - 2;
$foreign = avesmapsWikiDumpLockTryAcquire($pdo3, 6, 'frank', 'fetch_dump', null, $stale);
$check(
    '(c3) a foreign acquire is STILL rejected after the heartbeat (hold kept alive)',
    false,
    $foreign,
    'without the heartbeat the hold would have gone stale; the heartbeat kept erin the live holder'
);
$check('(c4) erin (4) is still the holder', 4, $pdo3->row['holder_user_id'] ?? null, 'the kept-alive hold was not taken over');

// ===========================================================================
// (h) heartbeat is HOLDER-GUARDED: a NON-holder heartbeat cannot steal/keep it.
// ===========================================================================
echo "\n-- (h) heartbeat is holder-guarded --\n";

$pdo4 = new FakeLockPdo();
$pdo4->now = 9000;
avesmapsWikiDumpLockTryAcquire($pdo4, 4, 'erin', 'read_step', 'run-x', $stale);
$notHolderHb = avesmapsWikiDumpLockHeartbeat($pdo4, 99, 'read_step', 'run-x');
$check('(h1) a non-holder heartbeat returns false', false, $notHolderHb, 'user 99 does not hold the lock, so its heartbeat is a no-op');
$check('(h2) the holder is unchanged (still erin=4)', 4, $pdo4->row['holder_user_id'] ?? null, 'a foreign heartbeat never rewrites the holder');

// ===========================================================================
// (d) RELEASE frees the lock (next acquirer wins).
// ===========================================================================
echo "\n-- (d) release frees the lock --\n";

$pdo5 = new FakeLockPdo();
$pdo5->now = 10000;
avesmapsWikiDumpLockTryAcquire($pdo5, 4, 'erin', 'cleanup_state', null, $stale);
$released = avesmapsWikiDumpLockRelease($pdo5, 4);
$check('(d1) the holder releases successfully', true, $released, 'a holder-guarded release by the actual holder frees the lock');
$check('(d2) the row is back to the free state (holder is exactly NULL)', true, ($pdo5->row !== null && $pdo5->row['holder_user_id'] === null), 'release clears the holder to NULL (the free state the next acquire treats as available)');

// A fresh, DIFFERENT user now wins immediately (no waiting for staleness).
$pdo5->now = 10001;
$afterRelease = avesmapsWikiDumpLockTryAcquire($pdo5, 6, 'frank', 'fetch_dump', null, $stale);
$check('(d3) a new user acquires immediately after release', true, $afterRelease, 'once freed, the lock is available without any stale wait');
$check('(d4) the new holder is frank (6)', 6, $pdo5->row['holder_user_id'] ?? null, 'the post-release acquire recorded the new holder');

// ===========================================================================
// (g) release is HOLDER-GUARDED: a non-holder release is a no-op (cannot free
//     another user's live lock -- important so a late release after a
//     stale-takeover does not free the NEW holder).
// ===========================================================================
echo "\n-- (g) release is holder-guarded --\n";

$pdo6 = new FakeLockPdo();
$pdo6->now = 11000;
avesmapsWikiDumpLockTryAcquire($pdo6, 6, 'frank', 'read_step', 'run-g', $stale);
$foreignRelease = avesmapsWikiDumpLockRelease($pdo6, 4); // user 4 is NOT the holder
$check('(g1) a non-holder release returns false (no-op)', false, $foreignRelease, 'user 4 does not hold the lock, so its release frees nothing');
$check('(g2) frank (6) still holds the lock after a foreign release', 6, $pdo6->row['holder_user_id'] ?? null, 'a foreign release cannot free the live holder\'s lock');

// ===========================================================================
// (i) acquire-or-throw raises WikiDumpLockBusyException on a lost race, carrying
//     the current holder for the message.
// ===========================================================================
echo "\n-- (i) acquireOrThrow raises WikiDumpLockBusyException on a lost race --\n";

$pdo7 = new FakeLockPdo();
$pdo7->now = 12000;
avesmapsWikiDumpLockTryAcquire($pdo7, 6, 'frank', 'apply', 'run-i', $stale);

$pdo7->now = 12001;
$thrown = null;
try {
    avesmapsWikiDumpLockAcquireOrThrow($pdo7, 8, 'dave', 'apply', 'run-i', $stale);
} catch (Throwable $e) {
    $thrown = $e;
}
$check(
    '(i1) a lost acquireOrThrow raises WikiDumpLockBusyException',
    true,
    $thrown instanceof WikiDumpLockBusyException,
    'the endpoint maps this exception to the {ok:false,error:{code:dump_locked}} 409 envelope'
);
$check(
    '(i2) the exception message is the German busy text',
    'Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.',
    $thrown instanceof WikiDumpLockBusyException ? $thrown->getMessage() : '',
    'the user-facing rejection message is German per the language policy'
);
$check(
    '(i3) the exception carries the current holder username (frank) for context',
    'frank',
    $thrown instanceof WikiDumpLockBusyException ? $thrown->holderUsername : '',
    'the busy exception exposes who holds the lock (display-only)'
);
$check(
    '(i4) acquireOrThrow SUCCEEDS (no throw) for the actual holder re-entering',
    true,
    (static function () use ($pdo7, $stale): bool {
        try {
            avesmapsWikiDumpLockAcquireOrThrow($pdo7, 6, 'frank', 'apply', 'run-i', $stale);
            return true;
        } catch (Throwable) {
            return false;
        }
    })(),
    'the holder re-entering via acquireOrThrow does not raise (same-holder re-entry)'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);

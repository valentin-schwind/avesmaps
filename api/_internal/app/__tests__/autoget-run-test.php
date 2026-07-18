<?php

declare(strict_types=1);

/**
 * Unit test for the autoget safety core. No real DB: the pure wrappers are exercised directly, and the
 * gate ordering (kill-switch -> lock -> step -> release) is exercised through a Fake PDO whose GET_LOCK
 * result is scripted. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/autoget-run-test.php
 *
 * STRATO has no cron and looping a heavy endpoint once saturated the pool (php-pool-hang-incident
 * 2026-07-17). This core is what makes the run safe; there is no local MySQL, so this Fake-PDO harness is
 * the ONLY place the gate ordering is provable before the owner's live run.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../autoget-run.php';

// ---- avesmapsAutogetLockAcquired: interpret a raw GET_LOCK column ------------------------------------
// GET_LOCK(name,0) returns 1 (got it), 0 (timeout/held by another connection), or NULL (error). Drivers
// may surface 1/0 as int OR string, so the predicate normalises to string.
assert(avesmapsAutogetLockAcquired('1') === true);
assert(avesmapsAutogetLockAcquired(1) === true);
assert(avesmapsAutogetLockAcquired('0') === false, '0 = held by another connection -> not acquired');
assert(avesmapsAutogetLockAcquired(0) === false);
assert(avesmapsAutogetLockAcquired(null) === false, 'NULL = GET_LOCK error -> conservatively not acquired');
assert(avesmapsAutogetLockAcquired('') === false);
assert(avesmapsAutogetLockAcquired(false) === false);
echo "lock-acquired ok\n";

// ---- avesmapsAutogetDeadlineReached: the per-step wall-clock budget ----------------------------------
assert(avesmapsAutogetDeadlineReached(1000.0, 1003.9, 4.0) === false, 'under budget -> keep going');
assert(avesmapsAutogetDeadlineReached(1000.0, 1004.0, 4.0) === true, 'exactly at budget -> stop');
assert(avesmapsAutogetDeadlineReached(1000.0, 1010.0, 4.0) === true, 'over budget -> stop');
assert(avesmapsAutogetDeadlineReached(1000.0, 1000.0, 4.0) === false, 'no time passed -> keep going');
echo "deadline ok\n";

// ---- avesmapsAutogetGuardedStep: kill-switch -> lock -> step -> release ------------------------------
// A Fake PDO/PDOStatement, built WITHOUT a driver (empty constructor), that logs every prepared query and
// hands back scripted GET_LOCK results. This lets us prove the exact gate ORDER with no MySQL.
final class FakeAutogetStmt extends PDOStatement
{
    public function __construct(private mixed $col) {}
    public function execute(?array $params = null): bool { return true; }
    public function fetchColumn(int $column = 0): mixed { return $this->col; }
}
final class FakeAutogetPdo extends PDO
{
    /** @var string[] every prepared statement text, in order */
    public array $log = [];
    /** @var array<int,mixed> scripted GET_LOCK results, consumed FIFO */
    public array $lockResults = ['1'];
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->log[] = $query;
        if (str_contains($query, 'GET_LOCK')) {
            $next = array_key_exists(0, $this->lockResults) ? array_shift($this->lockResults) : '0';
            return new FakeAutogetStmt($next);
        }
        return new FakeAutogetStmt(null); // RELEASE_LOCK etc.
    }
}

// (a) kill-switch OFF: returns stopped, never touches the DB, never runs the step.
$pdo = new FakeAutogetPdo();
$ran = false;
$out = avesmapsAutogetGuardedStep($pdo, false, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p) use (&$ran): array {
    $ran = true;
    return ['ok' => true, 'done' => true];
});
assert($out === ['ok' => true, 'stopped' => true], 'kill-switch off -> stopped envelope');
assert($ran === false, 'kill-switch off -> step never runs');
assert($pdo->log === [], 'kill-switch off -> no lock taken (checked before the lock)');
echo "guarded-step: kill-switch ok\n";

// (b) enabled + lock free: runs the step, then RELEASES the lock (in that order).
$pdo = new FakeAutogetPdo();
$pdo->lockResults = ['1'];
$ran = false;
$out = avesmapsAutogetGuardedStep($pdo, true, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p) use (&$ran): array {
    $ran = true;
    return ['ok' => true, 'done' => false, 'remaining' => 7];
});
assert($ran === true, 'lock free -> step runs');
assert($out['remaining'] === 7, 'step result is returned verbatim');
assert(count($pdo->log) === 2, 'exactly two lock statements: acquire + release');
assert(str_contains($pdo->log[0], 'GET_LOCK'), 'acquire first');
assert(str_contains($pdo->log[1], 'RELEASE_LOCK'), 'release after the step');
echo "guarded-step: run+release ok\n";

// (c) enabled + lock HELD by another connection: returns busy, never runs the step, never releases
//     (we do not hold it, so releasing would free the OTHER run's lock).
$pdo = new FakeAutogetPdo();
$pdo->lockResults = ['0'];
$ran = false;
$out = avesmapsAutogetGuardedStep($pdo, true, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p) use (&$ran): array {
    $ran = true;
    return ['ok' => true];
});
assert($out === ['ok' => true, 'busy' => true], 'lock held -> busy envelope');
assert($ran === false, 'lock held -> step never runs');
assert(count($pdo->log) === 1 && str_contains($pdo->log[0], 'GET_LOCK'), 'only the acquire, no release');
echo "guarded-step: busy ok\n";

// (d) the step THROWS: the lock is still released (finally), and the throw propagates.
$pdo = new FakeAutogetPdo();
$pdo->lockResults = ['1'];
$threw = false;
try {
    avesmapsAutogetGuardedStep($pdo, true, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p): array {
        throw new RuntimeException('boom');
    });
} catch (RuntimeException $e) {
    $threw = true;
}
assert($threw === true, 'the step exception propagates');
assert(count($pdo->log) === 2 && str_contains($pdo->log[1], 'RELEASE_LOCK'), 'lock released even on throw');
echo "guarded-step: release-on-throw ok\n";

echo "autoget-run ok\n";

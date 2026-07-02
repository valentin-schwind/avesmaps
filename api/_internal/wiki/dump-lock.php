<?php

declare(strict_types=1);

/**
 * WikiDump single-flight concurrency lock (DB-PERSISTED).
 * ---------------------------------------------------------------------------
 * This is a MULTI-USER tool: several editors with the 'edit' capability act
 * concurrently. The WikiDump pipeline (fetch_dump -> start_read -> read_step
 * loop -> apply -> cleanup_state) has NO natural serialization, and its worst
 * hazard is two users running the read/apply pass at once: both do
 * ON DUPLICATE KEY UPDATE on staging tables keyed only by wiki_key (no run_id)
 * -- wiki_path_staging / wiki_region_staging / wiki_sync_pages /
 * political_territory_wiki_test -- so overlapping titles silently mix two dump
 * snapshots into one row, last-write-wins, with no error surfaced. This lock
 * serializes the ENTIRE WikiDump operation so only ONE runs at a time across
 * ALL users; a second user attempting any dump action while one is active gets
 * a CLEAN rejection (WikiDumpLockBusyException -> {ok:false, error:{...}}),
 * never a silent second run.
 *
 * WHY A DB ROW, NOT MySQL GET_LOCK: the read AND apply flows are CLIENT-DRIVEN
 * LOOPS (js/review/review-wiki-sync.js runWikiSyncDumpLoop POSTs up to 2000
 * separate requests), each a NEW PHP request on a NEW MySQL connection. A
 * connection-scoped lock (GET_LOCK / a transaction) releases the instant that
 * request's connection closes -- i.e. BETWEEN steps -- so it cannot hold across
 * the loop. The lock state must therefore be PERSISTED in a row that survives
 * across requests; each step re-reads it and refreshes a heartbeat.
 *
 * THE ATOMIC-ACQUIRE INTERLEAVING (the crux -- reasoned about explicitly):
 *   The lock is a SINGLE row addressed by a fixed PRIMARY KEY (id = 1). Acquire
 *   is one statement:
 *
 *     INSERT INTO wiki_dump_lock (id, holder_user_id, ...)
 *       VALUES (1, :uid, ...)
 *     ON DUPLICATE KEY UPDATE
 *       holder_user_id = IF(<free-or-stale-or-same-holder>, VALUES(holder_user_id), holder_user_id),
 *       ... (every other column guarded by the SAME IF condition) ...
 *
 *   InnoDB takes an exclusive row lock on the id=1 row for the duration of that
 *   statement, so two simultaneous acquirers are SERIALIZED against that row --
 *   they cannot both execute the ON DUPLICATE KEY UPDATE at the same instant.
 *   The first (say user A) finds the row free/stale/self, so its IF() fires and
 *   it writes holder = A. The second (user B) then runs against the row A just
 *   claimed: the IF() condition <free-or-stale-or-same-holder> is now FALSE
 *   (the row is held by A, fresh, and B != A), so every column keeps its
 *   existing value -- B's write is a no-op. Both then READ THE ROW BACK and
 *   check "am I the holder?": A sees holder = A (wins), B sees holder = A
 *   (loses -> rejected). There is no interleaving in which both read back
 *   themselves as holder, because the row lock forbids their updates from
 *   overlapping and the loser's update changed nothing.
 *
 *   The read-back is mandatory: affected-rows on ON DUPLICATE KEY UPDATE is
 *   ambiguous (1 for insert, 2 for a real update, 0 for "no change" -- and a
 *   no-op self-refresh can also report 0), so we never trust rowCount(); we
 *   re-SELECT and compare holder_user_id.
 *
 * SAME-HOLDER RE-ENTRY: <same-holder> is part of the acquire condition, so a
 * user who already holds the lock re-acquires it freely. This is what lets ONE
 * user run fetch_dump -> start_read -> read_step* -> apply* -> cleanup_state as
 * a single sequence without ever locking themselves out: every action in that
 * chain is the same holder_user_id. Re-acquiring updates operation/run_id (so
 * the lock reflects the current phase) and refreshes the heartbeat, but keeps
 * acquired_at (it is the same continuous hold).
 *
 * HEARTBEAT: every read_step / apply step calls avesmapsWikiDumpLockHeartbeat()
 * for the holder, bumping heartbeat_at so a long-but-legitimate run (the read
 * pass can be dozens of bounded steps) is never judged stale mid-flight.
 *
 * STALE TAKEOVER: if heartbeat_at is older than
 * AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS the hold is considered ABANDONED and may
 * be taken over by the next acquirer (the <stale> arm of the acquire condition).
 * This also fixes "a run wedged in status = running forever": there is no
 * 'failed' status for a dump_read run, so a crashed/abandoned run would
 * otherwise block every future run permanently. The threshold (180s) is
 * comfortably larger than one bounded step's own deadline
 * (AVESMAPS_WIKI_DUMP_STEP_SECONDS, 28s) plus HTTP + retry slack, so a healthy
 * heartbeating run is never mistaken for stale -- see the constant's own
 * docblock for why this was bumped from a prior 112s.
 *
 * RELEASE: on successful completion (after cleanup_state), and on ANY
 * error/exception in a flow (the endpoint wraps each action so a throw releases
 * the lock it acquired). Release is holder-guarded: it only clears the row if
 * the caller is still the holder, so a stale-takeover by user B cannot be undone
 * by user A's late release.
 *
 * PURITY CONTRACT: side-effect-free on include (only const + function defs --
 * no top-level code, no DB connect, no headers), so tools/wikidump/test-*.php
 * can `require` it with no MySQL. Every DB touch takes a PDO explicitly; the
 * genuinely offline-decidable logic (the free/stale/same-holder predicate) is a
 * separate PURE function exercised directly by the unit test.
 */

// ===========================================================================
// Constants.
// ===========================================================================

/** Self-healing single-row lock table (schema-in-code convention). */
const AVESMAPS_WIKI_DUMP_LOCK_TABLE = 'wiki_dump_lock';

/** The single lock row is addressed by this fixed id (single-row store). */
const AVESMAPS_WIKI_DUMP_LOCK_ROW_ID = 1;

/**
 * Heartbeat-staleness threshold (seconds). A hold whose heartbeat_at is older
 * than this is abandoned and may be taken over. Chosen as a comfortable multiple
 * of one bounded step's own deadline (AVESMAPS_WIKI_DUMP_STEP_SECONDS = 28s) so a
 * healthy run that heartbeats every step is NEVER judged stale, while a truly
 * crashed run is reclaimed within a few minutes.
 *
 * ~180s ~= 6.4 * 28s. Bumped up from a prior 112s (~4 * 28s) after the
 * online_continent_map phase's PERF FIX (dump-hybrid-driver.php,
 * AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET): that phase used to be
 * dispatched with an unbounded call budget, so a single step could run for
 * ~4.5 minutes with NO heartbeat, which a 112s threshold would (correctly, but
 * dangerously) judge stale mid-run and hand the lock to a second user --
 * causing two concurrent runs and silent staging corruption (see the file
 * header's "MULTI-USER" hazard). Every phase is now bounded well under the 28s
 * step deadline, so 112s would already be safe again; 180s adds extra slack for
 * a slow-STRATO step (retries, network jitter) without letting an actually
 * abandoned run block others for more than a few minutes.
 */
const AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS = 180;

// ===========================================================================
// Exception raised on a lost acquire (a second concurrent user).
// ===========================================================================

/**
 * Thrown by avesmapsWikiDumpLockAcquireOrThrow() when the lock is already held
 * by ANOTHER live holder. The endpoint maps this to the standard
 * {ok:false, error:{code:'dump_locked', message:<German>}} envelope with HTTP
 * 409 so the frontend can show the busy message and STOP its loop gracefully
 * (rather than spinning up to 2000 times). Carries the current holder's public
 * identity (username only -- never anything sensitive) for the message.
 */
final class WikiDumpLockBusyException extends RuntimeException
{
    public function __construct(
        public readonly string $holderUsername = '',
        public readonly string $operation = ''
    ) {
        parent::__construct('Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.');
    }
}

// ===========================================================================
// Self-healing DDL.
// ===========================================================================

/**
 * Idempotently create the single-row lock table (self-healing DDL). One row
 * (id = 1) records who currently holds the whole-pipeline lock, which operation
 * they are in, the active dump_read run_id (if any), when the hold began, and
 * the last heartbeat. Every accessor below calls this first, so a caller never
 * has to remember to.
 */
function avesmapsWikiDumpLockEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . ' (
            id TINYINT UNSIGNED NOT NULL,
            holder_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
            holder_username VARCHAR(190) NOT NULL DEFAULT \'\',
            operation VARCHAR(40) NOT NULL DEFAULT \'\',
            run_id VARCHAR(36) NULL DEFAULT NULL,
            acquired_at DATETIME(3) NULL DEFAULT NULL,
            heartbeat_at DATETIME(3) NULL DEFAULT NULL,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

// ===========================================================================
// PURE predicate: may THIS acquirer take the lock, given the current row?
// ===========================================================================

/**
 * PURE: decide whether acquirer $userId may take the lock, given the current
 * lock row (or null if the row is absent / never held) and the staleness
 * threshold. This is the EXACT logic the SQL IF() condition encodes; keeping it
 * as a standalone pure function makes the free/stale/same-holder rule directly
 * unit-testable without a DB, and documents the three winning arms in one place:
 *
 *   1. FREE      -- no live holder (holder_user_id NULL, or heartbeat missing).
 *   2. STALE     -- heartbeat_at older than $staleSeconds (abandoned hold).
 *   3. SAME      -- holder_user_id === $userId (re-entry by the current holder).
 *
 * @param array{holder_user_id:?int, heartbeat_age_seconds:?int}|null $lock
 *        the current lock row projected to just the two fields the decision
 *        needs: the holder id, and how many seconds ago it last heartbeat
 *        (null age = no heartbeat on record = free).
 * @param int $userId       the acquiring user's id (0 = unknown/anonymous acquirer)
 * @param int $staleSeconds the abandonment threshold
 */
function avesmapsWikiDumpLockMayAcquire(?array $lock, int $userId, int $staleSeconds = AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS): bool
{
    // No row at all -> definitely free.
    if ($lock === null) {
        return true;
    }

    $holder = $lock['holder_user_id'] ?? null;
    // No holder recorded -> free.
    if ($holder === null) {
        return true;
    }

    // Same holder -> re-entry always allowed (the sequential fetch->...->cleanup
    // chain by one user is one continuous hold).
    if ((int) $holder === $userId && $userId > 0) {
        return true;
    }

    // A different holder: only takeable if its heartbeat is stale (abandoned).
    $age = $lock['heartbeat_age_seconds'] ?? null;
    if ($age === null) {
        // Held by someone else but no heartbeat on record -> treat as abandoned.
        return true;
    }

    return (int) $age >= $staleSeconds;
}

// ===========================================================================
// Row read (with a server-computed heartbeat age).
// ===========================================================================

/**
 * Read the current lock row, projecting a SERVER-computed heartbeat age
 * (TIMESTAMPDIFF against NOW(3), so the staleness decision uses the DB clock,
 * never PHP's -- avoiding any app/DB clock skew). Returns null if the row does
 * not exist yet. The returned shape is what avesmapsWikiDumpLockMayAcquire()
 * consumes plus the public-display fields.
 *
 * @return array{holder_user_id:?int, holder_username:string, operation:string, run_id:?string, heartbeat_age_seconds:?int}|null
 */
function avesmapsWikiDumpLockReadRow(PDO $pdo): ?array
{
    avesmapsWikiDumpLockEnsureTable($pdo);

    $statement = $pdo->prepare(
        'SELECT holder_user_id, holder_username, operation, run_id,
                TIMESTAMPDIFF(SECOND, heartbeat_at, CURRENT_TIMESTAMP(3)) AS heartbeat_age_seconds
         FROM ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute(['id' => AVESMAPS_WIKI_DUMP_LOCK_ROW_ID]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }

    $holderId = $row['holder_user_id'];
    $age = $row['heartbeat_age_seconds'];

    return [
        'holder_user_id' => $holderId === null ? null : (int) $holderId,
        'holder_username' => (string) ($row['holder_username'] ?? ''),
        'operation' => (string) ($row['operation'] ?? ''),
        'run_id' => $row['run_id'] === null ? null : (string) $row['run_id'],
        'heartbeat_age_seconds' => $age === null ? null : (int) $age,
    ];
}

// ===========================================================================
// Atomic acquire.
// ===========================================================================

/**
 * Atomically acquire the whole-pipeline lock for $userId, or return false if it
 * is currently held by another LIVE holder. The single conditional statement is
 * the crux (see the file header "THE ATOMIC-ACQUIRE INTERLEAVING"): every column
 * is written only when <free OR stale OR same-holder>, so two racing acquirers
 * serialized on the id=1 row cannot both win. We then re-read the row and return
 * true iff we are the holder.
 *
 * On a successful acquire by a DIFFERENT (or first-ever) holder, acquired_at is
 * reset to NOW(3). On same-holder re-entry, acquired_at is PRESERVED (it is one
 * continuous hold) while operation/run_id are refreshed and the heartbeat bumped.
 *
 * @param string $operation short label of the flow being started (e.g. 'fetch_dump', 'read_step', 'apply', 'cleanup_state')
 * @param ?string $runId    the dump_read run public_id once known (start_read/read_step/apply); null for fetch_dump/cleanup
 * @return bool true if the caller now holds the lock; false if another live holder has it
 */
function avesmapsWikiDumpLockTryAcquire(
    PDO $pdo,
    int $userId,
    string $username,
    string $operation,
    ?string $runId = null,
    int $staleSeconds = AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS
): bool {
    avesmapsWikiDumpLockEnsureTable($pdo);

    // The <free OR stale OR same-holder> predicate, expressed against the row's
    // current columns. `heartbeat_at IS NULL` and `holder_user_id IS NULL` are
    // the FREE arms; the TIMESTAMPDIFF arm is STALE; the holder_user_id match is
    // SAME. Bound params are used everywhere (no string interpolation).
    //
    // NOTE on affected-rows ambiguity: we deliberately do NOT branch on
    // $statement->rowCount() -- ON DUPLICATE KEY UPDATE reports 1/2/0 in ways a
    // no-op self-refresh makes unreliable. The authoritative check is the
    // read-back below.
    $sql =
        'INSERT INTO ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '
            (id, holder_user_id, holder_username, operation, run_id, acquired_at, heartbeat_at)
         VALUES
            (:id, :uid, :uname, :op, :run_id, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            holder_user_id = IF(
                ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale_a SECOND)
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id = :uid_same,
                VALUES(holder_user_id), ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id),
            holder_username = IF(
                ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale_b SECOND)
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id = :uid_same2,
                VALUES(holder_username), ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_username),
            operation = IF(
                ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale_c SECOND)
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id = :uid_same3,
                VALUES(operation), ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.operation),
            run_id = IF(
                ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale_d SECOND)
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id = :uid_same4,
                VALUES(run_id), ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.run_id),
            -- acquired_at: reset only on a fresh takeover (free/stale by a
            -- different holder); PRESERVED on same-holder re-entry so a
            -- continuous fetch->...->cleanup hold keeps one acquired_at.
            acquired_at = IF(
                (' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale_e SECOND))
                    AND ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id <> :uid_diff,
                CURRENT_TIMESTAMP(3), ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.acquired_at),
            heartbeat_at = IF(
                ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at IS NULL
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale_f SECOND)
                    OR ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.holder_user_id = :uid_same5,
                CURRENT_TIMESTAMP(3), ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '.heartbeat_at)';

    $statement = $pdo->prepare($sql);
    $statement->execute([
        'id' => AVESMAPS_WIKI_DUMP_LOCK_ROW_ID,
        'uid' => $userId,
        'uname' => $username,
        'op' => $operation,
        'run_id' => $runId,
        // The same-holder / stale params are repeated because each IF() has its
        // own copies (a placeholder cannot be reused across a prepared stmt in
        // emulation-off PDO); every :stale_* is the SAME value, every :uid_same*
        // is the SAME acquiring user id, :uid_diff too.
        'stale_a' => $staleSeconds,
        'stale_b' => $staleSeconds,
        'stale_c' => $staleSeconds,
        'stale_d' => $staleSeconds,
        'stale_e' => $staleSeconds,
        'stale_f' => $staleSeconds,
        'uid_same' => $userId,
        'uid_same2' => $userId,
        'uid_same3' => $userId,
        'uid_same4' => $userId,
        'uid_same5' => $userId,
        'uid_diff' => $userId,
    ]);

    // Authoritative check: re-read and confirm we are the holder.
    $row = avesmapsWikiDumpLockReadRow($pdo);
    if ($row === null) {
        return false;
    }

    return $row['holder_user_id'] === $userId && $userId > 0;
}

/**
 * Acquire the lock or THROW WikiDumpLockBusyException (the endpoint maps it to
 * the {ok:false, error:{code:'dump_locked'}} 409 envelope). Thin wrapper over
 * avesmapsWikiDumpLockTryAcquire() for the common "reject a second user" path;
 * on failure it re-reads the row so the exception carries the current holder's
 * username/operation for the message/telemetry.
 */
function avesmapsWikiDumpLockAcquireOrThrow(
    PDO $pdo,
    int $userId,
    string $username,
    string $operation,
    ?string $runId = null,
    int $staleSeconds = AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS
): void {
    if (avesmapsWikiDumpLockTryAcquire($pdo, $userId, $username, $operation, $runId, $staleSeconds)) {
        return;
    }

    $row = avesmapsWikiDumpLockReadRow($pdo);
    throw new WikiDumpLockBusyException(
        $row['holder_username'] ?? '',
        $row['operation'] ?? ''
    );
}

// ===========================================================================
// Heartbeat.
// ===========================================================================

/**
 * Refresh heartbeat_at (and, opportunistically, operation/run_id) for the lock
 * IFF $userId is still the holder. Called on every read_step / apply step so a
 * long legitimate run is never judged stale mid-flight. Holder-guarded: if a
 * stale-takeover has since handed the lock to someone else, this is a no-op (it
 * must NOT resurrect a lost hold). Returns true iff the caller is still the
 * holder after the call.
 *
 * @return bool true if the caller still holds the lock (heartbeat applied)
 */
function avesmapsWikiDumpLockHeartbeat(
    PDO $pdo,
    int $userId,
    string $operation = '',
    ?string $runId = null
): bool {
    avesmapsWikiDumpLockEnsureTable($pdo);

    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '
         SET heartbeat_at = CURRENT_TIMESTAMP(3),
             operation = IF(:op = \'\', operation, :op2),
             run_id = IF(:run_id_null, run_id, :run_id)
         WHERE id = :id AND holder_user_id = :uid'
    );
    $statement->execute([
        'id' => AVESMAPS_WIKI_DUMP_LOCK_ROW_ID,
        'uid' => $userId,
        'op' => $operation,
        'op2' => $operation,
        // Keep the stored run_id when the caller passes null (fetch_dump/cleanup
        // steps have no run), otherwise update it.
        'run_id_null' => $runId === null ? 1 : 0,
        'run_id' => $runId,
    ]);

    // rowCount() is reliable here (a plain UPDATE with a WHERE): >0 means the
    // holder-guarded row matched. But MySQL can report 0 for "matched but no
    // column changed"; guard against that by re-reading if 0.
    if ($statement->rowCount() > 0) {
        return true;
    }

    $row = avesmapsWikiDumpLockReadRow($pdo);
    return $row !== null && $row['holder_user_id'] === $userId && $userId > 0;
}

// ===========================================================================
// Release.
// ===========================================================================

/**
 * Release the lock IFF $userId is still the holder (holder-guarded). Clears the
 * row back to the free state (holder_user_id NULL, empty operation/run_id, null
 * timestamps) so the next acquirer sees FREE. A no-op if the caller no longer
 * holds it (e.g. a stale-takeover already reassigned the lock -- releasing then
 * would wrongly free the NEW holder's lock). Best-effort by contract: callers
 * invoke this in a finally/catch, so it must never throw for a benign reason;
 * it lets a genuine PDO failure propagate (the endpoint's outer catch handles
 * it) but does nothing surprising on the normal path.
 *
 * @return bool true if this call actually freed the lock (caller was the holder)
 */
function avesmapsWikiDumpLockRelease(PDO $pdo, int $userId): bool
{
    avesmapsWikiDumpLockEnsureTable($pdo);

    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_DUMP_LOCK_TABLE . '
         SET holder_user_id = NULL,
             holder_username = \'\',
             operation = \'\',
             run_id = NULL,
             acquired_at = NULL,
             heartbeat_at = NULL
         WHERE id = :id AND holder_user_id = :uid'
    );
    $statement->execute([
        'id' => AVESMAPS_WIKI_DUMP_LOCK_ROW_ID,
        'uid' => $userId,
    ]);

    return $statement->rowCount() > 0;
}

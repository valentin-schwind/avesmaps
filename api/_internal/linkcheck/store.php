<?php

declare(strict_types=1);

// Linkchecker: the DB layer (Spec §1.2 data model, §1.5 concurrency). Self-healing inline DDL (project
// idiom, mirror of api/_internal/app/feature-sources.php:7). This file owns every SQL statement of the
// feature; what a probe MEANS is decided in state.php, the network lives in probe.php.
//
// This module knows nothing about adventures or maps -- only URLs, their state, and who references them.
// The entity side is plugged in via providers.php.

require_once __DIR__ . '/state.php';
require_once __DIR__ . '/probe.php';

// One check_step probes at most this many links and stops after this many seconds, whichever comes
// first -- STRATO has no cron and heavy loops saturate the PHP workers (AGENTS.md §9), so the client
// drives the repetition (same pattern as the WikiSync dump driver).
const AVESMAPS_LINK_CHECK_BATCH = 40;
const AVESMAPS_LINK_CHECK_BUDGET_SECONDS = 25;
// The lease (§1.5): a selected row is pushed this far into the future BEFORE we probe it, so a parallel
// runner no longer sees it as due. No lock table, no stale takeover -- if this runner dies, the row
// simply becomes due again after five minutes.
const AVESMAPS_LINK_CHECK_LEASE_MINUTES = 5;
// A URL we refuse to fetch (bad scheme, private address) is never probeable. Do not re-ask every day.
const AVESMAPS_LINK_BLOCKED_RECHECK_DAYS = 14;
// The public status endpoint caps a lookup at this many hashes per request.
const AVESMAPS_LINK_STATUS_MAX_HASHES = 200;

function avesmapsLinkCheckEnsureTables(PDO $pdo): void
{
    // Identity is url_hash, not url: TEXT is not indexable at utf8mb4 length, so a fixed-length sha256
    // carries the UNIQUE key -- same reasoning as sources.url_hash.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS link_status (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            url TEXT NOT NULL,
            url_hash CHAR(64) NOT NULL,
            host VARCHAR(190) NOT NULL DEFAULT '',
            state VARCHAR(16) NOT NULL DEFAULT 'unchecked',
            http_status SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            redirect_url TEXT NULL,
            fail_streak INT UNSIGNED NOT NULL DEFAULT 0,
            first_failed_at DATETIME(3) NULL,
            last_checked_at DATETIME(3) NULL,
            last_online_at DATETIME(3) NULL,
            check_after DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_link_status_url_hash (url_hash),
            KEY idx_link_status_due (check_after),
            KEY idx_link_status_state (state)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    // The registry: which entity hangs on this URL. Also answers "show me all dead links".
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS link_ref (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            url_hash CHAR(64) NOT NULL,
            entity_type VARCHAR(24) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            field VARCHAR(32) NOT NULL DEFAULT '',
            label VARCHAR(200) NOT NULL DEFAULT '',
            -- ON UPDATE per Spec §1.2, but the sync never relies on it: it writes seen_at explicitly,
            -- because this clause does NOT fire when an upsert leaves every value unchanged. See the
            -- comment at the upsert in avesmapsLinkCheckSyncEntityType -- that is the load-bearing part.
            seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_link_ref (entity_type, entity_public_id, field, url_hash),
            KEY idx_link_ref_hash (url_hash),
            KEY idx_link_ref_entity (entity_type, entity_public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// {entity_public_id => {field => {state, http_status, checked_at}}} for ONE entity type -- the embedded
// path (§1.7): api/app/adventures.php ships the status inside its own payload, so a dialog needs no
// second roundtrip. One JOIN over the registry, never an IN(…) of every hash in the catalog and never
// N+1. An entity whose links were never synced is simply absent -> the caller renders 'unchecked'.
function avesmapsLinkCheckStatesByEntityType(PDO $pdo, string $entityType): array
{
    avesmapsLinkCheckEnsureTables($pdo);
    $statement = $pdo->prepare(
        "SELECT lr.entity_public_id, lr.field, ls.state, ls.http_status, ls.last_checked_at
           FROM link_ref lr
           JOIN link_status ls ON ls.url_hash = lr.url_hash
          WHERE lr.entity_type = :type"
    );
    $statement->execute(['type' => $entityType]);

    $states = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $states[(string) $row['entity_public_id']][(string) $row['field']] = [
            'state' => (string) $row['state'],
            'http_status' => (int) $row['http_status'],
            'checked_at' => $row['last_checked_at'] !== null ? (string) $row['last_checked_at'] : '',
        ];
    }
    return $states;
}

// {hash => {state, http_status, checked_at}} for up to AVESMAPS_LINK_STATUS_MAX_HASHES hashes. Backs the
// PUBLIC link-status endpoint -- the integration hatch for pages that have links but no payload of their
// own. The cap lives here as well as in the endpoint: the hash list comes straight from a client, and an
// unbounded IN(…) would be a cheap way to make us build a huge query. Unknown hashes are simply absent
// from the result (the caller renders them as unchecked).
function avesmapsLinkCheckStatesByHashes(PDO $pdo, array $hashes): array
{
    avesmapsLinkCheckEnsureTables($pdo);

    // Normalize + dedupe; a hash is 64 hex chars, anything else cannot exist in the table anyway.
    $clean = [];
    foreach ($hashes as $hash) {
        $hash = strtolower(trim((string) $hash));
        if (preg_match('/^[0-9a-f]{64}$/', $hash) === 1) {
            $clean[$hash] = true;
        }
    }
    $clean = array_slice(array_keys($clean), 0, AVESMAPS_LINK_STATUS_MAX_HASHES);
    if ($clean === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($clean), '?'));
    $statement = $pdo->prepare(
        "SELECT url_hash, state, http_status, last_checked_at
           FROM link_status WHERE url_hash IN ($placeholders)"
    );
    $statement->execute($clean);

    $states = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $states[(string) $row['url_hash']] = [
            'state' => (string) $row['state'],
            'http_status' => (int) $row['http_status'],
            'checked_at' => $row['last_checked_at'] !== null ? (string) $row['last_checked_at'] : '',
        ];
    }
    return $states;
}

// Rebuild the registry for ONE entity type from the links a provider collected.
//
// Upserts every link_ref (stamping seen_at), creates the link_status rows that do not exist yet as
// 'unchecked', then drops the link_ref rows of THIS type that were not seen in this pass -- i.e. the URL
// no longer hangs on the object. Scoping the delete by entity_type is what makes the sync restartable
// per provider without a cross-request cursor: no provider can ever delete another provider's refs.
// Returns ['seen' => int, 'created' => int, 'removed' => int].
function avesmapsLinkCheckSyncEntityType(PDO $pdo, string $entityType, array $links): array
{
    avesmapsLinkCheckEnsureTables($pdo);

    // DB clock, never PHP's: the seen_at values below are written by MySQL, so the cutoff must come from
    // the same clock or a drifting web server would delete rows it just wrote.
    $stepStart = (string) $pdo->query('SELECT NOW(3)')->fetchColumn();

    // seen_at is set EXPLICITLY on both paths. Relying on ON UPDATE CURRENT_TIMESTAMP would be a silent
    // trap: MySQL only fires it when a value actually changes, so re-syncing an unchanged row would NOT
    // refresh seen_at -- and the cleanup below would then delete the very row we just confirmed.
    $upsertRef = $pdo->prepare(
        "INSERT INTO link_ref (url_hash, entity_type, entity_public_id, field, label, seen_at)
         VALUES (:hash, :type, :pid, :field, :label, NOW(3))
         ON DUPLICATE KEY UPDATE seen_at = NOW(3), label = VALUES(label)"
    );
    // A known URL keeps its state/streak; only a genuinely new URL starts as 'unchecked' and due now.
    $insertStatus = $pdo->prepare(
        "INSERT INTO link_status (url, url_hash, host, state, check_after)
         VALUES (:url, :hash, :host, 'unchecked', NULL)
         ON DUPLICATE KEY UPDATE url = VALUES(url), host = VALUES(host)"
    );

    $seen = 0;
    $created = 0;
    foreach ($links as $link) {
        $url = trim((string) ($link['url'] ?? ''));
        if ($url === '') {
            continue;
        }
        $hash = (string) ($link['url_hash'] ?? '');
        if ($hash === '') {
            $hash = hash('sha256', $url);
        }
        $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?: ''));

        // mb_substr, not substr: the columns count CHARACTERS while substr cuts BYTES. A cut landing
        // mid-sequence in a long umlaut-heavy label would produce invalid utf8mb4 -> MySQL error 1366 ->
        // the whole sync dies with a generic 500 and no clue why. (House pattern: feature-sources.php.)
        $upsertRef->execute([
            'hash' => $hash,
            'type' => $entityType,
            'pid' => mb_substr((string) ($link['entity_public_id'] ?? ''), 0, 64),
            'field' => mb_substr((string) ($link['field'] ?? ''), 0, 32),
            'label' => mb_substr((string) ($link['label'] ?? ''), 0, 200),
        ]);
        // The ref goes in BEFORE the status row: a parallel PruneOrphans between the two statements
        // would otherwise see a brand-new status row with no ref yet and delete it, leaving a ref
        // pointing at nothing. In this order the intermediate state is "ref without status", which the
        // prune ignores (it only deletes link_status) and a reader renders as 'unchecked' for an instant.
        $insertStatus->execute(['url' => $url, 'hash' => $hash, 'host' => mb_substr($host, 0, 190)]);
        if ($insertStatus->rowCount() === 1) {
            $created++; // 1 = INSERT, 2 = UPDATE, 0 = unchanged (MySQL's ON DUPLICATE KEY convention)
        }
        $seen++;
    }

    $removeStale = $pdo->prepare('DELETE FROM link_ref WHERE entity_type = :type AND seen_at < :cutoff');
    $removeStale->execute(['type' => $entityType, 'cutoff' => $stepStart]);

    return ['seen' => $seen, 'created' => $created, 'removed' => $removeStale->rowCount()];
}

// Drop link_status rows nothing references any more -- otherwise we would probe links forever that no
// object holds. Runs at the end of a full sync pass.
function avesmapsLinkCheckPruneOrphans(PDO $pdo): int
{
    avesmapsLinkCheckEnsureTables($pdo);
    return $pdo->query(
        'DELETE ls FROM link_status ls
          LEFT JOIN link_ref lr ON lr.url_hash = ls.url_hash
         WHERE lr.id IS NULL'
    )->rowCount();
}

// Counters for the editor panel: total / online / dead / unchecked / due.
function avesmapsLinkCheckStatus(PDO $pdo): array
{
    avesmapsLinkCheckEnsureTables($pdo);
    // Counted against an explicit whitelist rather than against $status' own keys: 'total' and 'due'
    // live in the same array, and a state value colliding with either would silently overwrite a counter.
    $byState = ['unchecked' => 0, 'online' => 0, 'dead' => 0];
    $total = 0;
    foreach ($pdo->query('SELECT state, COUNT(*) AS n FROM link_status GROUP BY state')->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $state = (string) $row['state'];
        $count = (int) $row['n'];
        $total += $count;
        if (array_key_exists($state, $byState)) {
            $byState[$state] = $count;
        }
    }
    $status = ['total' => $total] + $byState + ['due' => 0];
    $status['due'] = (int) $pdo->query(
        'SELECT COUNT(*) FROM link_status WHERE check_after IS NULL OR check_after <= NOW(3)'
    )->fetchColumn();
    return $status;
}

// Force a recheck: make rows due now. Either one url_hash, or every link of one entity. Returns the
// number of rows made due.
function avesmapsLinkCheckForceRecheck(PDO $pdo, string $urlHash, string $entityType, string $entityPublicId): int
{
    avesmapsLinkCheckEnsureTables($pdo);

    $urlHash = strtolower(trim($urlHash));
    if (preg_match('/^[0-9a-f]{64}$/', $urlHash) === 1) {
        $statement = $pdo->prepare('UPDATE link_status SET check_after = NOW(3) WHERE url_hash = :hash');
        $statement->execute(['hash' => $urlHash]);
        return $statement->rowCount();
    }

    $entityType = trim($entityType);
    $entityPublicId = trim($entityPublicId);
    if ($entityType === '' || $entityPublicId === '') {
        return 0;
    }
    $statement = $pdo->prepare(
        'UPDATE link_status SET check_after = NOW(3)
          WHERE url_hash IN (SELECT url_hash FROM link_ref WHERE entity_type = :type AND entity_public_id = :pid)'
    );
    $statement->execute(['type' => $entityType, 'pid' => $entityPublicId]);
    return $statement->rowCount();
}

// Persist one probe result for one row, per the decision from state.php.
function avesmapsLinkCheckWriteResult(PDO $pdo, int $id, array $probe, array $decision): void
{
    // No verdict (throttled 429/408, or a URL we refused to fetch): move check_after and touch NOTHING
    // else. state, http_status and last_checked_at keep their last real finding -- being rate-limited
    // says something about us, not about the link.
    // The INTERVAL amounts below are interpolated as ints, not bound: a bound parameter inside an
    // INTERVAL expression behaves differently between emulated and native prepares. The value never
    // comes from a client -- it is always one of the AVESMAPS_LINK_RECHECK_* constants.
    if (!$decision['verdict']) {
        $days = (int) $decision['recheck_days'];
        $pdo->prepare(
            'UPDATE link_status SET check_after = NOW(3) + INTERVAL ' . $days . ' DAY WHERE id = :id'
        )->execute(['id' => $id]);
        return;
    }

    // first_failed_at: cleared on recovery, stamped on the FIRST failure of a streak, otherwise left as
    // it was -- so it always answers "since when has this been broken".
    $pdo->prepare(
        "UPDATE link_status SET
            state = :state,
            http_status = :http,
            redirect_url = :redirect,
            fail_streak = :streak,
            last_checked_at = NOW(3),
            last_online_at = CASE WHEN :online_a = 1 THEN NOW(3) ELSE last_online_at END,
            first_failed_at = CASE
                WHEN :online_b = 1 THEN NULL
                WHEN :streak_b = 1 THEN NOW(3)
                ELSE first_failed_at END,
            check_after = NOW(3) + INTERVAL " . (int) $decision['recheck_days'] . " DAY
          WHERE id = :id"
    )->execute([
        'state' => (string) $decision['state'],
        'http' => max(0, min(65535, (int) $probe['http_status'])),
        'redirect' => ($probe['redirect_url'] ?? '') !== '' ? (string) $probe['redirect_url'] : null,
        'streak' => (int) $decision['fail_streak'],
        // Bound twice on purpose: without emulated prepares a named parameter cannot be reused.
        'online_a' => $decision['online'] ? 1 : 0,
        'online_b' => $decision['online'] ? 1 : 0,
        'streak_b' => (int) $decision['fail_streak'],
        'id' => $id,
    ]);
}

// ONE bounded pass: lease up to AVESMAPS_LINK_CHECK_BATCH due links, probe them within the time budget,
// write each verdict. Returns {done, checked, online, dead, remaining} -- the client loops until done.
// $budgetSeconds = 0 removes the time cap (the CLI, which has no 28s ceiling).
function avesmapsLinkCheckStep(PDO $pdo, int $budgetSeconds = AVESMAPS_LINK_CHECK_BUDGET_SECONDS): array
{
    avesmapsLinkCheckEnsureTables($pdo);

    // A single probe may itself take up to the cURL timeout, so the wall clock can exceed the budget by
    // one probe. Raise the limit accordingly (pattern: dump-fetch.php:422). budget 0 means "no cap"
    // (the CLI) -- and must lift the execution limit entirely, not set it to 0+15+30.
    @set_time_limit($budgetSeconds > 0 ? $budgetSeconds + AVESMAPS_LINK_PROBE_TIMEOUT_SECONDS + 30 : 0);

    // Never-checked rows (check_after IS NULL) sort first anyway -- MySQL orders NULLs first on ASC --
    // so ordering by the raw column lets idx_link_status_due serve the sort. An expression as the
    // leading sort key would force a filesort over the whole due set just to hand back 40 rows.
    $due = $pdo->prepare(
        'SELECT id, url, url_hash, state, fail_streak
           FROM link_status
          WHERE check_after IS NULL OR check_after <= NOW(3)
          ORDER BY check_after ASC, id ASC
          LIMIT ' . AVESMAPS_LINK_CHECK_BATCH
    );
    $due->execute();
    $rows = $due->fetchAll(PDO::FETCH_ASSOC) ?: [];

    // Lease one row at a time, immediately before probing it (§1.5) -- NOT the whole batch up front.
    // A batch lease is incompatible with a time budget: the rows we run out of time for would sit
    // leased 5 minutes into the future, the due-count below would no longer see them, `remaining`
    // would read 0 and `done` would claim success while half the batch was never probed. Leasing per
    // row means an aborted batch simply leaves the rest due, and the client's next step picks them up.
    $lease = $pdo->prepare(
        'UPDATE link_status SET check_after = NOW(3) + INTERVAL ' . AVESMAPS_LINK_CHECK_LEASE_MINUTES
        . ' MINUTE WHERE id = :id'
    );

    $deadline = microtime(true) + $budgetSeconds;
    $processed = 0;
    $checked = 0;
    $online = 0;
    $dead = 0;

    foreach ($rows as $row) {
        // Out of time: stop. Everything not yet leased stays due, so the next step continues here.
        if ($budgetSeconds > 0 && microtime(true) >= $deadline) {
            break;
        }
        $lease->execute(['id' => (int) $row['id']]);

        $probe = avesmapsLinkCheckProbe((string) $row['url']);
        $processed++;

        if ($probe['blocked']) {
            // We refused to ask (bad scheme / private address). That is no evidence about the link, so
            // no verdict -- but it will never become probeable either, so do not re-ask tomorrow.
            // Counts as processed (real progress was written), just not as checked.
            avesmapsLinkCheckWriteResult($pdo, (int) $row['id'], $probe, [
                'verdict' => false,
                'recheck_days' => AVESMAPS_LINK_BLOCKED_RECHECK_DAYS,
            ]);
            continue;
        }

        $decision = avesmapsLinkCheckDecide(
            ['state' => (string) $row['state'], 'fail_streak' => (int) $row['fail_streak']],
            (int) $probe['http_status']
        );
        avesmapsLinkCheckWriteResult($pdo, (int) $row['id'], $probe, $decision);

        $checked++;
        if ($decision['state'] === 'online') {
            $online++;
        } elseif ($decision['state'] === 'dead') {
            $dead++;
        }
    }

    $remaining = (int) $pdo->query(
        'SELECT COUNT(*) FROM link_status WHERE check_after IS NULL OR check_after <= NOW(3)'
    )->fetchColumn();

    return [
        'done' => $remaining === 0,
        // processed = probed OR refused; checked = actually probed. A caller watching for "no progress"
        // must look at processed, or a batch of purely blocked URLs would look like a stall.
        'processed' => $processed,
        'checked' => $checked,
        'online' => $online,
        'dead' => $dead,
        'remaining' => $remaining,
    ];
}

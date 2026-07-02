<?php

declare(strict_types=1);

/**
 * WikiDump control endpoint (procurement + hybrid read_step orchestration).
 * ---------------------------------------------------------------------------
 * Capability-gated ('edit') control surface for the offline Wiki Aventurica
 * dump. Procurement delegates to api/_internal/wiki/dump-fetch.php; the hybrid
 * read pass is driven by api/_internal/wiki/dump-hybrid-driver.php (which loops
 * the H1/H4a/H4b step fns over the sandbox state table).
 *
 *   POST { "action": "fetch_dump", "force_refresh"?: bool }
 *        -> downloads (or serves the <24h cached) .bz2. On 401 returns
 *           { ok:false, error:{ code:"dump_unauthorized" } } so the panel can
 *           prompt for fresh credentials.
 *   POST { "action": "set_dump_credentials", "username": "...", "password": "..." }
 *        -> stores the last-working credential pair. The password is write-only:
 *           it is accepted here but NEVER returned by any action.
 *   POST { "action": "start_read" }
 *        -> creates a dump_read run (the 7-phase state-machine row) and returns
 *           { run }. The frontend then loops read_step against run.public_id.
 *   POST { "action": "read_step", "run_id": "<public_id>" }
 *        -> runs ONE bounded step of the current phase and returns
 *           { run, phase, cursor, done, progress }. SANDBOX-SAFE: phases 1-5
 *           write only the state/alias tables; phase 6 (parse_and_upsert) runs
 *           dryRun=TRUE -> NOTHING sharp. Auto-fetches the dump if absent.
 *   POST { "action": "apply", "run_id": "<public_id>" }
 *        -> THE SHARP PATH: runs the parse_and_upsert phase with dryRun=FALSE
 *           (the sole real *_staging write). A SEPARATE action the owner triggers
 *           ONLY after the H5 compare-test is green (progress.md GATE WIRING).
 *   POST { "action": "cleanup_state" }
 *        -> "Dump holen" step 3/3: deletes every dump_read run's sandbox rows
 *           from wiki_dump_hybrid_state/wiki_dump_title_alias EXCEPT the newest
 *           COMPLETED run's, so exactly one dump's sandbox state remains. Called
 *           by the frontend ONLY after its read_step loop reports done. No-op
 *           (deletes nothing) if no dump_read run has ever completed. See
 *           avesmapsWikiDumpHybridCleanupOldSandboxState() for the exact guard.
 *   GET  ?action=status
 *        -> { present, size, age_seconds, last_fetch_at, last_ok_at, username, url }.
 *           Never includes the password.
 *
 * THE GATE: read_step is dryRun/sandbox-safe; apply is the sole sharp writer and
 * a DISTINCT action. They are never folded together -- the only difference is the
 * $dryRun flag threaded into the parse_and_upsert phase by the shared driver.
 * cleanup_state is a THIRD, independent action: it never touches parse_and_upsert,
 * staging, or live tables -- it only prunes the sandbox/alias tables read_step
 * itself writes, keeping just the most recently completed run's rows.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/wiki/dump-fetch.php';

// The read_step/apply orchestration (H4c-b) drives the H1/H4a/H4b step fns, which
// need the full wiki parse chain (the SAME chain dump-hybrid-read.php documents).
require __DIR__ . '/../../_internal/political/territory.php';
require __DIR__ . '/../../_internal/wiki/sync.php';
require __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require __DIR__ . '/../../_internal/wiki/territories-tree.php';
require __DIR__ . '/../../_internal/wiki/territories-parsing.php';
require __DIR__ . '/../../_internal/wiki/territories.php';
require __DIR__ . '/../../_internal/wiki/paths.php';
require __DIR__ . '/../../_internal/wiki/regions.php';
require __DIR__ . '/../../_internal/wiki/locations.php';
require __DIR__ . '/../../_internal/wiki/settlements.php';
require __DIR__ . '/../../_internal/wiki/dump-reader.php';
require __DIR__ . '/../../_internal/wiki/dump-category-layer.php';
require __DIR__ . '/../../_internal/wiki/dump-entity-scan.php';
require __DIR__ . '/../../_internal/wiki/dump-hybrid-state.php';
require __DIR__ . '/../../_internal/wiki/dump-hybrid-read.php';
require __DIR__ . '/../../_internal/wiki/dump-hybrid-driver.php';
// Single-flight concurrency lock (DB-persisted): serializes the WHOLE dump
// pipeline (fetch_dump/start_read/read_step/apply/cleanup_state) so only ONE
// runs at a time across ALL editors. See avesmapsWikiDumpLock* in dump-lock.php.
require __DIR__ . '/../../_internal/wiki/dump-lock.php';

/**
 * Resolve the local dump path for the read_step/apply parser, auto-fetching the
 * dump (Task 5a's avesmapsWikiDumpFetch) if it is not already present. Returns
 * the path on success; on a fetch failure it sends the SAME error envelope
 * fetch_dump sends (dump_unauthorized on 401 so the panel can prompt for creds,
 * else dump_fetch_failed) and EXITS -- so callers may treat a return as "the
 * file is present". Endpoint-layer helper (it emits HTTP + exits); NOT part of
 * the include-safe driver lib.
 */
function avesmapsWikiDumpEnsureDumpPresentOrFail(PDO $pdo): string
{
    $path = avesmapsWikiDumpStoragePath();
    if (is_file($path)) {
        return $path;
    }

    $result = avesmapsWikiDumpFetch($pdo, false);
    if (($result['ok'] ?? false) === true && is_file($path)) {
        return $path;
    }

    $code = (string) ($result['code'] ?? 'dump_fetch_failed');
    if ($code === 'dump_unauthorized') {
        avesmapsErrorResponse(
            401,
            'dump_unauthorized',
            'The dump server rejected the stored credentials (HTTP 401). Enter new credentials to continue.'
        );
    }

    avesmapsErrorResponse(
        502,
        'dump_fetch_failed',
        'The dump could not be downloaded from the wiki server.'
    );
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not use the dump endpoint.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    // Editor-only surface (same capability as the WikiSync editor endpoints).
    $currentUser = avesmapsRequireUserWithCapability('edit');
    // The lock holder identity is resolved from THIS auth/capability context (the
    // same context that gates every dump action), so "who holds the pipeline" is
    // always the acting editor. user_id is the re-entry key; username is display-only.
    $lockUserId = (int) ($currentUser['id'] ?? 0);
    $lockUsername = (string) ($currentUser['username'] ?? '');
    // Tracks whether THIS request currently holds the lock, so the outer catch can
    // release it on ANY throw in a mutating flow (holder-guarded release is a no-op
    // if a stale-takeover already reassigned it). GET/status never acquires.
    $lockHeldByThisRequest = false;

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'GET') {
        $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'status'), 60);
        if ($action !== 'status') {
            avesmapsErrorResponse(400, 'invalid_request', 'Unknown dump action for GET.');
        }

        $status = avesmapsWikiDumpStatus($pdo);
        avesmapsJsonResponse(200, ['ok' => true, 'status' => $status]);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET and POST are allowed for the dump endpoint.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 60);

    switch ($action) {
        case 'fetch_dump':
            // Acquire the whole-pipeline lock: fetch_dump BEGINS the "Dump holen"
            // chain (fetch -> start_read -> read_step* -> cleanup_state). Held for
            // the whole chain (same-holder re-entry across the later actions); the
            // terminal cleanup_state releases it. A DIFFERENT live holder is rejected
            // here (WikiDumpLockBusyException -> 409), so a second editor cannot
            // start a competing fetch. NOT released on success below -- the chain
            // continues in the next request as the same holder.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'fetch_dump');
            $lockHeldByThisRequest = true;

            $forceRefresh = filter_var($payload['force_refresh'] ?? false, FILTER_VALIDATE_BOOLEAN);
            $result = avesmapsWikiDumpFetch($pdo, $forceRefresh);

            if (($result['ok'] ?? false) === true) {
                avesmapsJsonResponse(200, [
                    'ok' => true,
                    'from_cache' => (bool) ($result['from_cache'] ?? false),
                    'size' => (int) ($result['size'] ?? 0),
                    'age_seconds' => (int) ($result['age_seconds'] ?? 0),
                ]);
            }

            // Distinguish the 401 credential-prompt signal from a generic failure.
            $code = (string) ($result['code'] ?? 'dump_fetch_failed');
            if ($code === 'dump_unauthorized') {
                avesmapsErrorResponse(
                    401,
                    'dump_unauthorized',
                    'The dump server rejected the stored credentials (HTTP 401). Enter new credentials to continue.'
                );
            }

            avesmapsErrorResponse(
                502,
                'dump_fetch_failed',
                'The dump could not be downloaded from the wiki server.'
            );
            // no break -- avesmapsErrorResponse exits.

        case 'set_dump_credentials':
            // Narrower than the endpoint's 'edit' gate: writing the SHARED credential
            // pair has blast radius (a bad pair makes every editor's fetch 401 until
            // fixed), and doc §5.0 specifies the dump-credential setting is admin-only.
            avesmapsRequireUserWithCapability('admin');
            $username = (string) ($payload['username'] ?? '');
            $password = (string) ($payload['password'] ?? '');
            try {
                avesmapsWikiDumpSetCredentials($pdo, $username, $password);
            } catch (InvalidArgumentException $exception) {
                avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
            }
            // Echo the stored username back for the prefill; NEVER the password.
            avesmapsJsonResponse(200, ['ok' => true, 'username' => trim($username)]);
            // no break -- avesmapsJsonResponse exits.

        case 'start_read':
            // Acquire the whole-pipeline lock BEFORE inserting a run row. Without this
            // the pre-lock bug is exactly here: every start_read used to INSERT a fresh
            // wiki_sync_runs row unconditionally, so two users each spawned a run. Now a
            // DIFFERENT live holder is rejected (409) and no second run is created. If
            // this same user already holds the lock (the "Dump holen" chain acquired it
            // in fetch_dump, or the apply chain is re-entering), this is a same-holder
            // re-entry no-op that just refreshes the heartbeat. Held across the loop;
            // the terminal action (cleanup_state / apply-done) releases.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'start_read');
            $lockHeldByThisRequest = true;

            // Create a new dump_read run (the 7-phase state machine's row). The
            // frontend (H4c-f) then loops read_step against the returned run_id.
            $startResult = avesmapsWikiDumpHybridStartRun($pdo, $lockUserId ?: null);
            // Record the run_id on the lock so a stale-takeover diagnostic / the busy
            // message can point at the exact wedged run.
            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'start_read', (string) ($startResult['run']['public_id'] ?? '') ?: null);
            avesmapsJsonResponse(200, ['ok' => true, 'run' => $startResult['run']]);
            // no break -- avesmapsJsonResponse exits.

        case 'read_step':
            // ONE bounded step of the hybrid read pass. SANDBOX-SAFE: phases 1-5
            // write only the state/alias tables; phase 6 runs dryRun=TRUE (nothing
            // sharp). If the dump file is absent, auto-fetch it first (Task 5a).
            $runPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
            // Acquire-or-throw on EVERY step: this is both the concurrency gate for the
            // (up-to-2000-request) loop AND the heartbeat that keeps a long legit read
            // from being judged stale. Same holder -> re-entry refresh; a DIFFERENT live
            // holder is rejected (409) so a second editor's loop stops after one step
            // instead of interleaving sandbox writes. NOT released on done -- the
            // "Dump holen" chain proceeds to cleanup_state as the same holder.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'read_step', $runPublicId);
            $lockHeldByThisRequest = true;
            $dumpPath = avesmapsWikiDumpEnsureDumpPresentOrFail($pdo);
            $stepResult = avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runPublicId, $dumpPath, true);
            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => $stepResult['run'],
                'phase' => $stepResult['phase'],
                'cursor' => $stepResult['cursor'],
                'done' => $stepResult['done'],
                'progress' => $stepResult['progress'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'apply':
            // THE SHARP PATH (the ONLY real *_staging write). A SEPARATE action the
            // owner triggers ONLY after the H5 compare-test is green: it runs the
            // parse_and_upsert phase with dryRun=FALSE. Distinct from read_step by
            // design (progress.md "H4c GATE WIRING"). Same 'edit' gate as the other
            // dump write actions; one bounded step per call (the frontend loops).
            $runPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
            // The apply path is ALSO a client-driven loop, so it ALSO holds the lock:
            // acquire-or-throw on every apply step (heartbeat + concurrency gate). This
            // is the CRITICAL guard -- two concurrent applies are the worst hazard
            // (both ON DUPLICATE KEY UPDATE the run_id-less staging tables, silently
            // mixing two dump snapshots). A DIFFERENT live holder is rejected (409).
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'apply', $runPublicId);
            $lockHeldByThisRequest = true;
            $dumpPath = avesmapsWikiDumpEnsureDumpPresentOrFail($pdo);
            $applyResult = avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runPublicId, $dumpPath, false);
            // Terminal release: apply is the LAST action of the apply chain, so once its
            // state machine reports done, free the lock for the next editor. (read_step
            // deliberately does NOT release on done -- its chain continues to cleanup.)
            if (($applyResult['done'] ?? false) === true) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }
            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => $applyResult['run'],
                'phase' => $applyResult['phase'],
                'cursor' => $applyResult['cursor'],
                'done' => $applyResult['done'],
                'progress' => $applyResult['progress'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'cleanup_state':
            // "Dump holen" step 3/3 (frontend calls this ONLY after its read_step loop
            // reports done for a successful scan). Deletes every OTHER dump_read run's
            // sandbox rows, keeping just the newest COMPLETED run's -- "immer genau ein
            // Dump drin". Never touches parse_and_upsert/staging/live tables; the DELETE
            // itself is guarded inside avesmapsWikiDumpHybridCleanupOldSandboxState()
            // (transaction, re-derives the kept run server-side, no-op if no run has
            // ever completed). Same 'edit' gate as the other dump actions.
            // cleanup_state is the TERMINAL action of the "Dump holen" (read) chain.
            // Acquire-or-throw first: the holder re-enters (fetch/start_read/read_step
            // already established the hold), a DIFFERENT live holder is rejected. Then
            // run the cleanup and RELEASE -- the whole chain is now done, so the lock is
            // handed back to the next editor.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'cleanup_state');
            $lockHeldByThisRequest = true;
            $cleanupResult = avesmapsWikiDumpHybridCleanupOldSandboxState($pdo);
            avesmapsWikiDumpLockRelease($pdo, $lockUserId);
            $lockHeldByThisRequest = false;
            avesmapsJsonResponse(200, [
                'ok' => true,
                'kept_run_id' => $cleanupResult['kept_run_id'],
                'deleted_state_rows' => $cleanupResult['deleted_state_rows'],
                'deleted_alias_rows' => $cleanupResult['deleted_alias_rows'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        default:
            avesmapsErrorResponse(400, 'invalid_request', 'Unknown dump action.');
    }
} catch (WikiDumpLockBusyException $busy) {
    // A second concurrent editor tried a dump action while another holds the
    // pipeline lock. Reject cleanly (HTTP 409) with the standard envelope +
    // machine code so the frontend shows the busy message and STOPS its loop
    // gracefully (never spins up to 2000 times). This request never held the
    // lock (it lost the race), so nothing to release here.
    avesmapsErrorResponse(409, 'dump_locked', $busy->getMessage());
} catch (InvalidArgumentException $exception) {
    // Malformed JSON body etc. Safe to surface (never contains credentials).
    // Release the lock if this request acquired one before the throw (holder-guarded).
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $lockUserId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    // Do NOT leak the DB error text (it can echo bound values in some drivers).
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $lockUserId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsServerErrorResponse($exception, 'wiki-dump');
} catch (Throwable $error) {
    // ANY other failure in a mutating flow releases the lock so a crash cannot
    // wedge the pipeline (the stale-takeover is the backstop if even this fails).
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $lockUserId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsServerErrorResponse($error, 'wiki-dump');
}

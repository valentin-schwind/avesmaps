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
 *   GET  ?action=status
 *        -> { present, size, age_seconds, last_fetch_at, last_ok_at, username, url }.
 *           Never includes the password.
 *
 * THE GATE: read_step is dryRun/sandbox-safe; apply is the sole sharp writer and
 * a DISTINCT action. They are never folded together -- the only difference is the
 * $dryRun flag threaded into the parse_and_upsert phase by the shared driver.
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
    avesmapsRequireUserWithCapability('edit');

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
            // Create a new dump_read run (the 7-phase state machine's row). The
            // frontend (H4c-f) then loops read_step against the returned run_id.
            $user = avesmapsRequireUserWithCapability('edit');
            $startResult = avesmapsWikiDumpHybridStartRun($pdo, (int) ($user['id'] ?? 0) ?: null);
            avesmapsJsonResponse(200, ['ok' => true, 'run' => $startResult['run']]);
            // no break -- avesmapsJsonResponse exits.

        case 'read_step':
            // ONE bounded step of the hybrid read pass. SANDBOX-SAFE: phases 1-5
            // write only the state/alias tables; phase 6 runs dryRun=TRUE (nothing
            // sharp). If the dump file is absent, auto-fetch it first (Task 5a).
            $runPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
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
            $dumpPath = avesmapsWikiDumpEnsureDumpPresentOrFail($pdo);
            $applyResult = avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runPublicId, $dumpPath, false);
            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => $applyResult['run'],
                'phase' => $applyResult['phase'],
                'cursor' => $applyResult['cursor'],
                'done' => $applyResult['done'],
                'progress' => $applyResult['progress'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        default:
            avesmapsErrorResponse(400, 'invalid_request', 'Unknown dump action.');
    }
} catch (InvalidArgumentException $exception) {
    // Malformed JSON body etc. Safe to surface (never contains credentials).
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    // Do NOT leak the DB error text (it can echo bound values in some drivers).
    avesmapsServerErrorResponse($exception, 'wiki-dump');
} catch (Throwable $error) {
    avesmapsServerErrorResponse($error, 'wiki-dump');
}

<?php

declare(strict_types=1);

/**
 * Database-backup control endpoint (admin only).
 * ---------------------------------------------------------------------------
 * The control surface for the chunked full-database dump built by
 * api/_internal/backup/db-dump.php. Every action requires the `admin` capability
 * -- NOT `edit`: a full dump carries `users.password_hash`, every share link and
 * every report, so it is the most sensitive artifact this project produces and the
 * editor role has no business with it.
 *
 *   GET  ?action=status
 *        -> { ok:true, live:<run|null>, runs:[<run>, ...] }. The page's initial
 *           read; `live` lets a reloaded tab reattach to a backup in progress.
 *   POST { "action":"start", "include_transient"?: bool }
 *        -> creates a run (frozen table plan + empty output file) and returns
 *           { ok:true, run, progress }. Rejected with `backup_running` (409) while
 *           another backup is live -- two runs would compete for the same webspace
 *           for no benefit.
 *   POST { "action":"step", "run_id":"<public_id>" }
 *        -> runs ONE bounded step and returns { ok:true, run, done, progress }. The
 *           client loops this until `done`. A step that throws marks the run
 *           `failed` (with the reason stored for this admin-only surface) so the
 *           loop stops instead of spinning.
 *   POST { "action":"cancel", "run_id":"<public_id>" }
 *        -> stops a running backup and deletes its partial file.
 *   POST { "action":"delete", "run_id":"<public_id>" }
 *        -> deletes a finished backup's file and its row.
 *   GET  ?action=download&run_id=<public_id>
 *        -> streams the finished .sql.gz as an attachment. The ONLY way to reach
 *           the file: the storage directory itself is .htaccess-denied.
 *
 * WHY THE CLIENT DRIVES THE LOOP: a full dump is far more work than one PHP request
 * may spend on STRATO, so the work is a sequence of bounded steps -- the same shape
 * every WikiSync pass in this repo has. See the library's file header for the step
 * budget, the single-member gzip construction and the crash reconcile.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/backup/db-dump.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
if (!avesmapsApplyCorsPolicy($config)) {
    avesmapsErrorResponse(403, 'origin_not_allowed', 'Origin not allowed.');
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'OPTIONS') {
    avesmapsJsonResponse(204);
}

// Every action, including the read-only status and the download, is admin-gated.
$currentUser = avesmapsRequireUserWithCapability('admin');

try {
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
} catch (Throwable $exception) {
    avesmapsServerErrorResponse($exception, 'database-backup connect');
}

try {
    if ($requestMethod === 'GET') {
        $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'status'), 20);

        if ($action === 'download') {
            avesmapsDbBackupSendDownload($pdo, avesmapsNormalizeSingleLine((string) ($_GET['run_id'] ?? ''), 36));
        }

        if ($action !== 'status') {
            avesmapsErrorResponse(400, 'unknown_action', 'Die Aktion ist unbekannt.');
        }

        $status = avesmapsDbBackupStatus($pdo);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'live' => $status['live'],
            'runs' => $status['runs'],
        ]);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Die Methode ist nicht erlaubt.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 20);

    if ($action === 'start') {
        // Default TRUE: "Datenbank-Backup" means the complete database. The lighter
        // mode is an explicit opt-out, and even then the skipped tables keep their
        // CREATE TABLE so the restore is still a working schema.
        $includeTransient = !array_key_exists('include_transient', $payload)
            || (bool) $payload['include_transient'];

        try {
            $run = avesmapsDbBackupStartRun($pdo, $currentUser, $includeTransient);
        } catch (DbBackupBusyException $exception) {
            // The one EXPECTED refusal, and it has its own class precisely so it can
            // be told apart from a real failure here.
            avesmapsErrorResponse(409, 'backup_running', $exception->holderUsername === ''
                ? 'Es laeuft bereits ein Backup.'
                : 'Es laeuft bereits ein Backup von ' . $exception->holderUsername . '.');
        }

        $payloadOut = avesmapsDbBackupProgressPayload($run);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'run' => $payloadOut['run'],
            'done' => $payloadOut['done'],
            'progress' => $payloadOut['progress'],
        ]);
    }

    if ($action === 'step') {
        $runId = avesmapsNormalizeSingleLine((string) ($payload['run_id'] ?? ''), 36);
        if ($runId === '') {
            avesmapsErrorResponse(400, 'missing_run_id', 'Die Lauf-Kennung fehlt.');
        }

        try {
            $result = avesmapsDbBackupStep($pdo, $runId);
        } catch (InvalidArgumentException $exception) {
            avesmapsErrorResponse(404, 'run_not_found', 'Der Backup-Lauf ist unbekannt.');
        } catch (Throwable $exception) {
            // Record WHY on the run (this surface is admin-only and a backup that
            // hides its failure reason is useless), then answer with the generic
            // envelope. The client stops looping and shows the stored reason via a
            // status read.
            avesmapsDbBackupMarkFailed($pdo, $runId, $exception->getMessage());
            error_log('avesmaps database-backup step: ' . $exception->getMessage());
            avesmapsErrorResponse(500, 'backup_step_failed', 'Der Backup-Schritt ist fehlgeschlagen.');
        }

        avesmapsJsonResponse(200, [
            'ok' => true,
            'run' => $result['run'],
            'done' => $result['done'],
            'progress' => $result['progress'],
        ]);
    }

    if ($action === 'cancel' || $action === 'delete') {
        $runId = avesmapsNormalizeSingleLine((string) ($payload['run_id'] ?? ''), 36);
        if ($runId === '') {
            avesmapsErrorResponse(400, 'missing_run_id', 'Die Lauf-Kennung fehlt.');
        }

        $done = $action === 'cancel'
            ? avesmapsDbBackupCancelRun($pdo, $runId)
            : avesmapsDbBackupDeleteRun($pdo, $runId);

        if (!$done) {
            avesmapsErrorResponse(404, 'run_not_found', 'Der Backup-Lauf ist unbekannt.');
        }

        $status = avesmapsDbBackupStatus($pdo);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'live' => $status['live'],
            'runs' => $status['runs'],
        ]);
    }

    avesmapsErrorResponse(400, 'unknown_action', 'Die Aktion ist unbekannt.');
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsServerErrorResponse($exception, 'database-backup');
}

/**
 * Stream a completed backup to the browser as an attachment.
 *
 * The path is resolved through avesmapsDbBackupFilePath(), which whitelists the
 * stored file name -- so even a tampered run row cannot turn this into a path
 * traversal. Only a `completed` run is downloadable: a partial file is a valid
 * gzip PREFIX with no terminator, and handing that out as "the backup" is exactly
 * the silent-truncation failure the run's verify phase exists to prevent.
 */
function avesmapsDbBackupSendDownload(PDO $pdo, string $runId): never
{
    if ($runId === '') {
        avesmapsErrorResponse(400, 'missing_run_id', 'Die Lauf-Kennung fehlt.');
    }

    $run = avesmapsDbBackupReadRun($pdo, $runId);
    if ($run === null) {
        avesmapsErrorResponse(404, 'run_not_found', 'Der Backup-Lauf ist unbekannt.');
    }

    if ((string) $run['status'] !== 'completed') {
        avesmapsErrorResponse(409, 'backup_incomplete', 'Dieses Backup ist nicht abgeschlossen.');
    }

    $fileName = (string) $run['file_name'];
    $path = avesmapsDbBackupFilePath($fileName);
    if ($path === null || !is_file($path)) {
        avesmapsErrorResponse(404, 'backup_file_missing', 'Die Backup-Datei ist nicht mehr vorhanden.');
    }

    $size = (int) filesize($path);

    // A multi-hundred-megabyte transfer must not be cut off by the request budget,
    // and the client aborting mid-download should not leave the worker spinning.
    @set_time_limit(0);
    ignore_user_abort(false);

    // Nothing may have been echoed before this point; drop any buffer so the body is
    // byte-exact (a stray byte would corrupt the .gz).
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    // 💣 Transparent output compression would gzip the already-gzipped body and make
    // the Content-Length below a lie -- a silently corrupt download, which is the one
    // failure a backup tool must not have. It is a common shared-hosting default, so
    // it is switched off explicitly rather than assumed absent.
    @ini_set('zlib.output_compression', 'Off');

    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . $fileName . '"');
    header('Content-Length: ' . $size);
    header('Content-Transfer-Encoding: binary');
    header('X-Content-Type-Options: nosniff');
    // The file is a database dump: never cached, never stored by a proxy.
    header('Cache-Control: private, no-store, max-age=0');
    header('Pragma: no-cache');

    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        avesmapsErrorResponse(500, 'backup_unreadable', 'Die Backup-Datei ist nicht lesbar.');
    }

    while (!feof($handle)) {
        $chunk = fread($handle, 262144);
        if ($chunk === false) {
            break;
        }
        echo $chunk;
        flush();
    }
    fclose($handle);

    exit;
}

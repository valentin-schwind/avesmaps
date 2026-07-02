<?php

declare(strict_types=1);

/**
 * WikiDump procurement endpoint (thin dispatch wrapper).
 * ---------------------------------------------------------------------------
 * Capability-gated ('edit') server-fetch control surface for the offline Wiki
 * Aventurica dump. Delegates all logic to api/_internal/wiki/dump-fetch.php.
 *
 *   POST { "action": "fetch_dump", "force_refresh"?: bool }
 *        -> downloads (or serves the <24h cached) .bz2. On 401 returns
 *           { ok:false, error:{ code:"dump_unauthorized" } } so the panel can
 *           prompt for fresh credentials.
 *   POST { "action": "set_dump_credentials", "username": "...", "password": "..." }
 *        -> stores the last-working credential pair. The password is write-only:
 *           it is accepted here but NEVER returned by any action.
 *   GET  ?action=status
 *        -> { present, size, age_seconds, last_fetch_at, last_ok_at, username, url }.
 *           Never includes the password.
 *
 * This endpoint performs NO parse and writes NO staging / sandbox / map table --
 * it only procures the dump file and the credential settings row (the read_step
 * parser is a separate task).
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/wiki/dump-fetch.php';

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

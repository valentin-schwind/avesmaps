<?php

declare(strict_types=1);

// Authed Endpoint der Wege-WikiSync-Surface (Fluesse + Strassen). Getrennt von Regionen-/
// Herrschaftsgebiete-Sync, teilt aber Plumbing/Parser/Tabellen-Helfer. Cap 'review'.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/territories.php';
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/paths.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Wege-Sync nicht verwenden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'POST') {
        $payload = avesmapsReadJsonRequest();
        $action = trim((string) ($payload['action'] ?? ($_GET['action'] ?? '')));
        $options = is_array($payload['options'] ?? null) ? $payload['options'] : $payload;

        // Provenance for the assign* actions (Verlauf-Sync T1): editors may pass 'source' to
        // mark a write as owner-curated vs. sync-written. course_hash/course_hops are NOT
        // accepted over HTTP -- only server-side callers (Task 5) pass those directly.
        $assignSource = trim((string) ($payload['source'] ?? ''));
        if ($assignSource !== '' && !in_array($assignSource, ['editor', 'verlauf-sync'], true)) {
            avesmapsErrorResponse(400, 'invalid_source', 'Unknown assign source.');
        }
        $assignMeta = $assignSource === '' ? [] : ['source' => $assignSource];

        $response = match ($action) {
            'start_run' => avesmapsWikiPathStartRun(
                $pdo,
                avesmapsWikiSyncMonitorSeedsFromInput($payload['seeds'] ?? ''),
                $options
            ),
            'crawl_step' => avesmapsWikiPathCrawlStep($pdo, trim((string) ($payload['run_id'] ?? '')), $options),
            'clear' => avesmapsWikiPathClear($pdo, (string) ($payload['target'] ?? ''), (string) ($payload['run_id'] ?? '')),
            'assign' => avesmapsWikiPathAssign(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                // Schreiben NUR bei dry_run:false UND confirm:"apply".
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0),
                $assignMeta
            ),
            'clear_assign' => avesmapsWikiPathClearAssign(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0),
                ($payload['single_segment'] ?? false) === true
            ),
            'assign_all' => avesmapsWikiPathAssignAll(
                $pdo,
                array_key_exists('continent', $payload) ? (string) $payload['continent'] : 'Aventurien',
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                $assignMeta
            ),
            'assign_to' => avesmapsWikiPathAssignTo(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['public_id'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0),
                ($payload['single_segment'] ?? false) === true,
                $assignMeta
            ),
            default => null,
        };

        // map_features-Cache invalidieren, wenn echt geschrieben wurde (Clients sehen die Zuordnung).
        if (in_array($action, ['assign', 'clear_assign', 'assign_all', 'assign_to'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }

        if ($response === null) {
            avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Wege-Sync-POST-Action: ' . $action);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind erlaubt.');
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiPathBuildStatus($pdo),
        'run_status' => avesmapsWikiPathRunStatus($pdo, trim((string) ($_GET['run_id'] ?? ''))),
        'staging_sample' => avesmapsWikiPathStagingSample(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            (int) ($_GET['limit'] ?? 40)
        ),
        'match' => avesmapsWikiPathMatch($pdo, [
            'continent' => array_key_exists('continent', $_GET) ? (string) $_GET['continent'] : 'Aventurien',
            'limit' => (int) ($_GET['limit'] ?? 500),
        ]),
        'search' => avesmapsWikiPathSearch($pdo, (string) ($_GET['q'] ?? ''), (int) ($_GET['limit'] ?? 30)),
        default => null,
    };

    if ($response === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Wege-Sync-Action: ' . $action);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}

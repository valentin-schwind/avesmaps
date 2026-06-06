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
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf den Wege-Sync nicht verwenden.']);
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
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'clear_assign' => avesmapsWikiPathClearAssign(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            default => null,
        };

        // map_features-Cache invalidieren, wenn echt geschrieben wurde (Clients sehen die Zuordnung).
        if (in_array($action, ['assign', 'clear_assign'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }

        if ($response === null) {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Wege-Sync-POST-Action: ' . $action]);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
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
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Wege-Sync-Action: ' . $action]);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => $error->getMessage()]);
}

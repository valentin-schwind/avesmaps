<?php

declare(strict_types=1);

// Authed Endpoint der neuen Sync-Monitor-Surface (Herrschaftsgebiete-Crawler-Rework).
// Bewusst isoliert vom Legacy-WikiSync-Dispatcher (endpoint.php). Nutzt die geteilte
// authed Plumbing (bootstrap/auth) + den vorhandenen Wiki-API-Client/Parser und die
// Sandbox-Logik in _internal/wiki/sync-monitor.php.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/territories.php';
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf den Sync-Monitor nicht verwenden.',
        ]);
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
            'start_run' => avesmapsWikiSyncMonitorStartRun(
                $pdo,
                avesmapsWikiSyncMonitorSeedsFromInput($payload['seeds'] ?? ''),
                $options
            ),
            'crawl_step' => avesmapsWikiSyncMonitorCrawlStep(
                $pdo,
                trim((string) ($payload['run_id'] ?? '')),
                $options
            ),
            'rebuild_model' => avesmapsWikiSyncMonitorRebuildModel($pdo),
            'enrich_licenses' => avesmapsWikiSyncMonitorEnrichLicenses($pdo, $options),
            'sync_parent_cache' => avesmapsWikiSyncMonitorSyncParentCache(
                $pdo,
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst immer lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'set_parent' => avesmapsWikiSyncMonitorSetParent(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                array_key_exists('parent_wiki_key', $payload) ? ($payload['parent_wiki_key'] !== null ? (string) $payload['parent_wiki_key'] : null) : null,
                (bool) ($payload['lock'] ?? true)
            ),
            'clear' => avesmapsWikiSyncMonitorClear(
                $pdo,
                (string) ($payload['target'] ?? ''),
                (string) ($payload['run_id'] ?? '')
            ),
            default => null,
        };

        if ($response === null) {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Sync-Monitor-POST-Action: ' . $action]);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiSyncMonitorBuildStatus($pdo),
        'run_status' => avesmapsWikiSyncMonitorRunStatus($pdo, trim((string) ($_GET['run_id'] ?? ''))),
        'staging_sample' => avesmapsWikiSyncMonitorStagingSample(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            (int) ($_GET['limit'] ?? 40)
        ),
        'model_sample' => avesmapsWikiSyncMonitorModelSample(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            (int) ($_GET['limit'] ?? 40)
        ),
        'diff' => avesmapsWikiSyncMonitorDiff($pdo),
        default => null,
    };

    if ($response === null) {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Sync-Monitor-Action: ' . $action]);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => $error->getMessage(),
    ]);
}

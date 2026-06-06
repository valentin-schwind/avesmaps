<?php

declare(strict_types=1);

// Authed Endpoint der schlanken Regionen-WikiSync-Surface (natuerliche Landschaften).
// Getrennt von der Herrschaftsgebiete-Sync (sync-monitor.php), teilt aber deren Plumbing,
// Wiki-API-Client/Parser und Tabellen-Helfer. Cap 'review' wie die uebrigen Sync-Tools.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/territories.php';
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/regions.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf den Regionen-Sync nicht verwenden.',
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
            'start_run' => avesmapsWikiRegionStartRun(
                $pdo,
                avesmapsWikiSyncMonitorSeedsFromInput($payload['seeds'] ?? ''),
                $options
            ),
            'crawl_step' => avesmapsWikiRegionCrawlStep($pdo, trim((string) ($payload['run_id'] ?? '')), $options),
            'clear' => avesmapsWikiRegionClear($pdo, (string) ($payload['target'] ?? ''), (string) ($payload['run_id'] ?? '')),
            'assign' => avesmapsWikiRegionAssign(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'assign_all' => avesmapsWikiRegionAssignAll(
                $pdo,
                array_key_exists('continent', $payload) ? (string) $payload['continent'] : 'Aventurien',
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            default => null,
        };

        if ($response === null) {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Regionen-Sync-POST-Action: ' . $action]);
        }

        if (in_array($action, ['assign', 'assign_all'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiRegionBuildStatus($pdo),
        'run_status' => avesmapsWikiRegionRunStatus($pdo, trim((string) ($_GET['run_id'] ?? ''))),
        'staging_sample' => avesmapsWikiRegionStagingSample(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            (int) ($_GET['limit'] ?? 40)
        ),
        'match' => avesmapsWikiRegionMatch($pdo, [
            'continent' => array_key_exists('continent', $_GET) ? (string) $_GET['continent'] : 'Aventurien',
            'limit' => (int) ($_GET['limit'] ?? 500),
        ]),
        'search' => avesmapsWikiRegionSearch($pdo, (string) ($_GET['q'] ?? ''), (int) ($_GET['limit'] ?? 30)),
        default => null,
    };

    if ($response === null) {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Regionen-Sync-Action: ' . $action]);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => $error->getMessage(),
    ]);
}

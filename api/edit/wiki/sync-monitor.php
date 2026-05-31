<?php

declare(strict_types=1);

// Authed Endpoint der neuen Sync-Monitor-Surface (Herrschaftsgebiete-Crawler-Rework).
// Bewusst isoliert vom Legacy-WikiSync-Dispatcher (endpoint.php). Nutzt die geteilte
// authed Plumbing (bootstrap/auth) und die Sandbox-Logik in _internal/wiki/sync-monitor.php.

require __DIR__ . '/../../_internal/auth.php';
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

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiSyncMonitorBuildStatus($pdo),
        default => null,
    };

    if ($response === null) {
        avesmapsJsonResponse(400, [
            'ok' => false,
            'error' => 'Unbekannte Sync-Monitor-Action: ' . $action,
        ]);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => $error->getMessage(),
    ]);
}

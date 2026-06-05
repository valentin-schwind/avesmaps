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

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET ist derzeit erlaubt.']);
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiRegionBuildStatus($pdo),
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

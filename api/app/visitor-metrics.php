<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden', 'Origin not allowed.');
    }

    avesmapsRequireUserWithCapability('edit');

    if (!avesmapsVisitorAnalyticsEnabled()) {
        avesmapsJsonResponse(200, ['ok' => true, 'enabled' => false]);
    }

    $actor = ($_GET['actor'] ?? 'visitor') === 'editor' ? 'editor' : 'visitor';
    $days = (int) ($_GET['days'] ?? 30);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsVisitorAnalyticsEnsureTables($pdo);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'enabled' => true,
        'actor' => $actor,
        'days' => $days,
        'metrics' => avesmapsVisitorReadMetrics($pdo, $actor, $days),
        'storage' => avesmapsVisitorStorageInfo($pdo),
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Visitor statistics could not be loaded: ' . $exception->getMessage());
}

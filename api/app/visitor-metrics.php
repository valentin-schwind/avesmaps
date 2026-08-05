<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    // Hand it on rather than let the analytics helper load the same file again (A23).
    avesmapsVisitorSaltPrimedConfig($config);
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
        // ⚠️ Whether this installation still runs the salt that ships in the repository (finding A23).
        // The privacy notice promises the visitor id cannot be traced back; with the published salt it
        // can, because an IPv4 space is small enough to walk. Saying so here rather than nowhere means
        // the claim is checkable instead of taken on trust -- and this endpoint is behind the `edit`
        // capability, so the answer reaches an editor and nobody else.
        'salt_configured' => avesmapsVisitorSaltIsConfigured(),
        'actor' => $actor,
        'days' => $days,
        'metrics' => avesmapsVisitorReadMetrics($pdo, $actor, $days),
        'storage' => avesmapsVisitorStorageInfo($pdo),
        'activity' => avesmapsVisitorRecentActivity($pdo, 12),
        'geo' => avesmapsVisitorReadGeo($pdo, $days),
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Visitor statistics could not be loaded.');
}

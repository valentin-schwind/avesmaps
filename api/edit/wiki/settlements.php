<?php

declare(strict_types=1);

// Authed Endpoint der Siedlungs-WikiSync-VERBINDUNG. Verbindet Orts-Features mit ihrem
// Wiki-Datensatz ({{Infobox Siedlung}}). Additiv — die bestehende Fall-Review (sync.php /
// review-wiki-sync.js) bleibt unberührt. Cap 'review'. Nutzt die Registry wiki_sync_pages
// als Such-Quelle (kein eigener Crawl); Infobox wird beim Zuordnen on-demand geladen.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/territories.php';
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/settlements.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf den Siedlungs-Sync nicht verwenden.']);
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
        $isApply = static fn(): bool => ($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply';

        $response = match ($action) {
            'assign_to' => avesmapsWikiSettlementAssignTo(
                $pdo,
                (string) ($payload['title'] ?? ''),
                (string) ($payload['public_id'] ?? ''),
                !$isApply()
            ),
            'clear_assign' => avesmapsWikiSettlementClearAssign(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                !$isApply()
            ),
            'bulk_fix_sizes' => avesmapsWikiSettlementBulkFixSizes(
                $pdo,
                is_array($payload['public_ids'] ?? null) ? $payload['public_ids'] : [],
                !$isApply()
            ),
            default => null,
        };

        // map_features-Cache invalidieren, wenn echt geschrieben wurde.
        if (in_array($action, ['assign_to', 'clear_assign', 'bulk_fix_sizes'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }

        if ($response === null) {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Siedlungs-Sync-POST-Action: ' . $action]);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiSettlementStatus($pdo),
        'audit_sizes' => avesmapsWikiSettlementAuditSizes($pdo),
        'search' => avesmapsWikiSettlementSearch($pdo, (string) ($_GET['q'] ?? ''), (int) ($_GET['limit'] ?? 30)),
        'preview' => ['ok' => true, 'settlement' => avesmapsWikiSettlementBuildFromTitle($pdo, (string) ($_GET['title'] ?? ''))],
        default => null,
    };

    if ($response === null) {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Siedlungs-Sync-Action: ' . $action]);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => $error->getMessage()]);
}

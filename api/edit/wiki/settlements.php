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
                !$isApply(),
                (int) ($user['id'] ?? 0)
            ),
            'clear_assign' => avesmapsWikiSettlementClearAssign(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                !$isApply(),
                (int) ($user['id'] ?? 0)
            ),
            'bulk_connect' => avesmapsWikiSettlementBulkConnect(
                $pdo,
                (int) ($payload['limit'] ?? 100),
                !$isApply()
            ),
            'crawl_buildings' => avesmapsWikiSettlementCrawlBuildings($pdo),
            'enrich_details', 'backfill_continents' => avesmapsWikiSettlementEnrichDetails($pdo, (int) ($payload['limit'] ?? 100)),
            'bulk_record_ruins' => avesmapsWikiSettlementBulkRecordRuins($pdo, !$isApply()),
            'bulk_record_coats' => avesmapsWikiSettlementBulkRecordCoats($pdo, !$isApply(), (int) ($payload['limit'] ?? 150)),
            'set_coat' => avesmapsWikiSettlementSetWikiCoat($pdo, (string) ($payload['public_id'] ?? ''), !$isApply(), (int) ($user['id'] ?? 0)),
            'clear_coat' => avesmapsWikiSettlementClearCoat($pdo, (string) ($payload['public_id'] ?? ''), !$isApply(), (int) ($user['id'] ?? 0)),
            default => null,
        };

        // map_features-Cache invalidieren, wenn echt geschrieben wurde.
        if (in_array($action, ['assign_to', 'clear_assign', 'bulk_connect', 'bulk_record_ruins', 'bulk_record_coats', 'set_coat', 'clear_coat'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
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
        'connect_status' => avesmapsWikiSettlementConnectStatus($pdo),
        'enrich_status', 'continent_status' => avesmapsWikiSettlementEnrichStatus($pdo),
        'ruin_status' => avesmapsWikiSettlementRuinStatus($pdo),
        'coat_status' => avesmapsWikiSettlementCoatStatus($pdo),
        'coat_info' => avesmapsWikiSettlementCoatInfo($pdo, (string) ($_GET['public_id'] ?? '')),
        'list_locations' => avesmapsWikiSettlementListLocations($pdo),
        'assignment' => avesmapsWikiSettlementGetAssignment($pdo, (string) ($_GET['public_id'] ?? '')),
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

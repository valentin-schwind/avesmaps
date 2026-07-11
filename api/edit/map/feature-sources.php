<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

// Write logic lives in the app-layer library (multi-source system #2); the atomic
// other_source takeover needs avesmapsEncodeJson/avesmapsNextMapRevision from the
// map-features library, so both are required here (dispatcher stays thin).
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/feature-sources.php';
// Publication-link normalization (avesmapsResolvePublicationIdentityFromUrl): lets an `add` merge a
// community/editor link to a publication's wiki article with the wiki-reconciled source (same
// source_id). Side-effect-free on include; it lazy-loads its own slug chain only for wiki-aventurica URLs.
require_once __DIR__ . '/../../_internal/wiki/publication-sync.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Quellen nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $entityType = trim((string) ($payload['entity_type'] ?? ''));
    $entityPublicId = trim((string) ($payload['entity_public_id'] ?? ''));
    $allowedTypes = ['settlement', 'region', 'path', 'territory'];

    if (!in_array($entityType, $allowedTypes, true)) {
        avesmapsErrorResponse(400, 'invalid_request', 'entity_type muss settlement, region, path oder territory sein.');
    }
    if ($entityPublicId === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'entity_public_id ist erforderlich.');
    }

    $userId = (int) ($user['id'] ?? 0);
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $result = match ($action) {
        'list' => avesmapsListFeatureSourcesForEdit($pdo, $entityType, $entityPublicId, $userId),
        'add' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $url = trim((string) ($payload['url'] ?? ''));
            if ($url === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'url ist erforderlich.');
            }
            $label = (string) ($payload['label'] ?? '');
            $type = (string) ($payload['source_type'] ?? 'sonstiges');
            $official = (bool) ($payload['is_official'] ?? false);
            $pages = trim((string) ($payload['pages'] ?? ''));
            $referenceKind = trim((string) ($payload['reference_kind'] ?? ''));
            return avesmapsAddFeatureSource($pdo, $entityType, $entityPublicId, $url, $label, $type, $official, $userId, $pages, $referenceKind);
        })(),
        'remove' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $sourceId = (int) ($payload['source_id'] ?? 0);
            if ($sourceId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'source_id ist erforderlich.');
            }
            return avesmapsRemoveFeatureSource($pdo, $entityType, $entityPublicId, $sourceId, $userId);
        })(),
        '_debug_resolve' => (static function () use ($pdo, $payload): array {
            // TEMPORARY diagnostic (systematic debugging): reveals WHY publication-link normalization
            // did/did not fire for a URL. Read-only, capability-gated. REMOVE after diagnosis.
            $url = trim((string) ($payload['url'] ?? ''));
            $out = ['url' => $url, 'fn_resolver' => function_exists('avesmapsResolvePublicationIdentityFromUrl')];
            $out['title'] = function_exists('avesmapsWikiAventuricaPageTitleFromUrl') ? avesmapsWikiAventuricaPageTitleFromUrl($url) : 'FN_MISSING';
            if (!function_exists('avesmapsWikiSyncMonitorNormalizeTitle')) { @require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php'; }
            if (!function_exists('avesmapsPoliticalSlug')) { @require_once __DIR__ . '/../../_internal/political/territory.php'; }
            $out['fn_slug'] = function_exists('avesmapsPoliticalSlug');
            try {
                $out['wiki_key'] = function_exists('avesmapsPublicationResolvePublicationKey') ? avesmapsPublicationResolvePublicationKey($pdo, (string) $out['title']) : 'FN_MISSING';
            } catch (Throwable $e) { $out['wiki_key_err'] = $e->getMessage(); }
            try {
                $out['catalog_count'] = (int) $pdo->query('SELECT COUNT(*) FROM wiki_publication_catalog')->fetchColumn();
                if (!empty($out['wiki_key']) && is_string($out['wiki_key'])) {
                    $s = $pdo->prepare('SELECT wiki_key, chosen_url, has_link FROM wiki_publication_catalog WHERE wiki_key = :k LIMIT 1');
                    $s->execute(['k' => $out['wiki_key']]);
                    $out['catalog_row'] = $s->fetch(PDO::FETCH_ASSOC) ?: null;
                    $l = $pdo->prepare("SELECT wiki_key FROM wiki_publication_catalog WHERE wiki_key LIKE :p LIMIT 5");
                    $l->execute(['p' => '%' . str_replace(' ', '-', mb_strtolower((string) $out['title'])) . '%']);
                    $out['catalog_like'] = $l->fetchAll(PDO::FETCH_COLUMN) ?: [];
                }
            } catch (Throwable $e) { $out['catalog_err'] = $e->getMessage(); }
            try {
                $out['identity'] = function_exists('avesmapsResolvePublicationIdentityFromUrl') ? avesmapsResolvePublicationIdentityFromUrl($pdo, $url) : 'FN_MISSING';
            } catch (Throwable $e) { $out['identity_err'] = $e->getMessage(); }
            return ['ok' => true, 'debug' => $out];
        })(),
        default => throw new InvalidArgumentException('Die Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht gespeichert werden.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht verarbeitet werden.');
}

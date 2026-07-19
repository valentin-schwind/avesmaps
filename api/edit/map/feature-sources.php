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
// Step 6: a source carrying an adventure's wiki key connects its place to that adventure on add and
// disconnects it again on remove. Loaded here so the guarded calls in the app library find it; the
// library stays usable without it (the calls are function_exists-gated).
require_once __DIR__ . '/../../_internal/app/adventures.php';

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
    // citymap joined in with the Kartensammlung (Spec §3.2): maps hang on the SAME shared source
    // catalogue as every other element, so "Ulisses F-Shop" exists once rather than once per map.
    $allowedTypes = ['settlement', 'region', 'path', 'territory', 'citymap'];

    if (!in_array($entityType, $allowedTypes, true)) {
        avesmapsErrorResponse(400, 'invalid_request', 'entity_type muss settlement, region, path, territory oder citymap sein.');
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
        // Instruction 5a: the editor picked an existing catalog row from the typeahead. Separate
        // from 'add' because that action requires a url -- and the rows most worth reusing (wiki
        // publications) may not have one.
        'add_existing' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $sourceId = (int) ($payload['source_id'] ?? 0);
            if ($sourceId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'source_id ist erforderlich.');
            }
            $pages = trim((string) ($payload['pages'] ?? ''));
            $referenceKind = trim((string) ($payload['reference_kind'] ?? ''));
            return avesmapsLinkExistingFeatureSource($pdo, $entityType, $entityPublicId, $sourceId, $userId, $pages, $referenceKind);
        })(),
        'remove' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $sourceId = (int) ($payload['source_id'] ?? 0);
            if ($sourceId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'source_id ist erforderlich.');
            }
            return avesmapsRemoveFeatureSource($pdo, $entityType, $entityPublicId, $sourceId, $userId);
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

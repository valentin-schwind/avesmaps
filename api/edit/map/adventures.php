<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

// Phase 3 (P1) editor writes for the Abenteuer feature (tables adventure + adventure_place). Mirrors the
// feature-sources.php dispatcher. avesmapsUuidV4() (new adventure public_ids) lives in the map-features
// library and is not pulled in by the adventure libraries below, so load it here; the resolver is loaded
// for the resolve_place action. The write logic lives in the app-layer library (dispatcher stays thin).
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/adventures.php';
require_once __DIR__ . '/../../_internal/app/adventure-resolve.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Abenteuer nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $result = match ($action) {
        'list' => avesmapsListAdventuresForEdit($pdo),
        'detail' => (static function () use ($pdo, $payload): array {
            $publicId = trim((string) ($payload['public_id'] ?? ''));
            if ($publicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'public_id ist erforderlich.');
            }
            $detail = avesmapsAdventureDetailForEdit($pdo, $publicId);
            if ($detail === null) {
                avesmapsErrorResponse(404, 'not_found', 'Das Abenteuer wurde nicht gefunden.');
            }
            return $detail;
        })(),
        'upsert_adventure' => avesmapsUpsertAdventure($pdo, (array) ($payload['adventure'] ?? [])),
        'add_place' => (static function () use ($pdo, $payload): array {
            $adventurePublicId = trim((string) ($payload['adventure_public_id'] ?? ''));
            if ($adventurePublicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'adventure_public_id ist erforderlich.');
            }
            return avesmapsAddAdventurePlace($pdo, $adventurePublicId, (array) ($payload['place'] ?? []));
        })(),
        'set_place' => (static function () use ($pdo, $payload): array {
            $placeId = (int) ($payload['place_id'] ?? 0);
            if ($placeId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'place_id ist erforderlich.');
            }
            return avesmapsSetAdventurePlace($pdo, $placeId, (array) ($payload['place'] ?? []));
        })(),
        'suppress_place' => (static function () use ($pdo, $payload): array {
            $placeId = (int) ($payload['place_id'] ?? 0);
            if ($placeId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'place_id ist erforderlich.');
            }
            return avesmapsSuppressAdventurePlace($pdo, $placeId);
        })(),
        'resolve_place' => (static function () use ($pdo, $payload): array {
            $placeId = (int) ($payload['place_id'] ?? 0);
            if ($placeId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'place_id ist erforderlich.');
            }
            return avesmapsResolveAdventurePlace($pdo, $placeId);
        })(),
        // TEMP diagnostic (capability-gated, read-only) -- remove after the region-resolve investigation.
        '_debug_region' => (static function () use ($pdo, $payload): array {
            $name = trim((string) ($payload['name'] ?? 'Raschtulswall'));
            $stmt = $pdo->prepare(
                "SELECT public_id, feature_type, feature_subtype, is_active, properties_json
                   FROM map_features WHERE name LIKE :n AND is_active = 1"
            );
            $stmt->execute(['n' => '%' . $name . '%']);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $cand = avesmapsAdventureLoadCandidates($pdo);
            return [
                'rows' => $rows,
                'region_candidate_count' => count($cand['region']),
                'has_wiki_raschtulswall' => array_key_exists('wiki:raschtulswall', $cand['region']),
                'sample_region_keys' => array_slice(array_keys($cand['region']), 0, 10),
            ];
        })(),
        default => avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.'),
    };

    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Das Abenteuer konnte nicht gespeichert werden.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Das Abenteuer konnte nicht verarbeitet werden.');
}

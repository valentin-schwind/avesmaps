<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

const AVESMAPS_LOCATION_SUBTYPES = ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude'];
const AVESMAPS_FEATURE_LOCK_TTL_SECONDS = 120;

class AvesmapsConflictException extends RuntimeException {
}

// Map-feature edit handlers live in a sibling library (M5 split).
require_once __DIR__ . '/../../_internal/map/features.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Kartendaten nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST' && $requestMethod !== 'PATCH' && $requestMethod !== 'DELETE') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST, PATCH oder DELETE sind fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'move_point'), 40);
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapFeatureLocksTable($pdo);

    $result = match ($action) {
        'move_point' => avesmapsMovePointFeature($pdo, $payload, $user),
        'update_point' => avesmapsUpdatePointFeatureDetails($pdo, $payload, $user),
        'create_point' => avesmapsCreatePointFeature($pdo, $payload, $user),
        'create_crossing' => avesmapsCreateCrossingFeature($pdo, $payload, $user),
        'create_powerline' => avesmapsCreatePowerlineFeature($pdo, $payload, $user),
        'update_powerline_details' => avesmapsUpdatePowerlineFeatureDetails($pdo, $payload, $user),
        'update_powerline_line' => avesmapsUpdatePowerlineLine($pdo, $payload, $user),
        'reorder_powerline_line' => avesmapsReorderPowerlineLine($pdo, $payload, $user),
        'create_path' => avesmapsCreatePathFeature($pdo, $payload, $user),
        'update_path_details' => avesmapsUpdatePathFeatureDetails($pdo, $payload, $user),
        'update_path_geometry' => avesmapsUpdatePathFeatureGeometry($pdo, $payload, $user),
        'create_label' => avesmapsCreateLabelFeature($pdo, $payload, $user),
        'update_label' => avesmapsUpdateLabelFeature($pdo, $payload, $user),
        'move_label' => avesmapsMoveLabelFeature($pdo, $payload, $user),
        'create_region' => avesmapsCreateRegionFeature($pdo, $payload, $user),
        'update_region' => avesmapsUpdateRegionFeature($pdo, $payload, $user),
        'update_region_geometry' => avesmapsUpdateRegionFeatureGeometry($pdo, $payload, $user),
        'delete_feature' => avesmapsDeleteMapFeature($pdo, $payload, $user),
        'undo_audit_change' => avesmapsUndoAuditChange($pdo, $payload, $user),
        'acquire_lock' => avesmapsAcquireMapFeatureLock($pdo, $payload, $user),
        'release_lock' => avesmapsReleaseMapFeatureLock($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Edit-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, [
        'ok' => true,
        'feature' => $result,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (AvesmapsConflictException $exception) {
    avesmapsErrorResponse(409, 'conflict', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Das Kartenobjekt konnte nicht gespeichert werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Das Kartenobjekt konnte nicht verarbeitet werden.');
}

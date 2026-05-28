<?php

declare(strict_types=1);

function avesmapsPoliticalPayloadHasAssignmentChain(array $payload): bool {
    foreach (['wiki_public_ids', 'territory_public_ids'] as $key) {
        if (!is_array($payload[$key] ?? null)) {
            continue;
        }

        foreach ($payload[$key] as $value) {
            if (trim((string) $value) !== '') {
                return true;
            }
        }
    }

    return false;
}

function avesmapsPoliticalSaveGeometryAssignmentSafely(PDO $pdo, array $payload, array $user): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );

    $hasExistingTerritory = (int) ($geometry['territory_id'] ?? 0) > 0;
    $hasPayloadChain = avesmapsPoliticalPayloadHasAssignmentChain($payload);
    $wouldCreateFromGeometry = !empty($payload['create_territory_if_missing']);

    if ($hasExistingTerritory && !$hasPayloadChain && $wouldCreateFromGeometry) {
        return avesmapsPoliticalSaveExistingGeometryAssignment($pdo, [
            ...$payload,
            'display_only' => true,
            'create_territory_if_missing' => false,
        ], $user, $geometry);
    }

    return avesmapsPoliticalSaveGeometryAssignment($pdo, $payload, $user);
}

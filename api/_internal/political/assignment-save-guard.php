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

function avesmapsPoliticalStripImplicitDragDefaultDisplays(array $payload): array {
    $assignment = is_array($payload['assignment'] ?? null) ? $payload['assignment'] : [];
    $displays = is_array($assignment['displays'] ?? null) ? array_values($assignment['displays']) : [];
    if ($displays === []) {
        return $payload;
    }

    $explicitDisplays = [];
    foreach ($displays as $display) {
        if (!is_array($display)) {
            continue;
        }
        if (!empty($display['implicitDragDefault']) || !empty($display['implicit_drag_default'])) {
            continue;
        }
        $explicitDisplays[] = $display;
    }

    if (count($explicitDisplays) === count($displays)) {
        return $payload;
    }

    $assignment['displays'] = $explicitDisplays;
    $payload['assignment'] = $assignment;
    $payload['implicit_drag_defaults_stripped'] = true;
    return $payload;
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

    return avesmapsPoliticalSaveGeometryAssignment($pdo, avesmapsPoliticalStripImplicitDragDefaultDisplays($payload), $user);
}

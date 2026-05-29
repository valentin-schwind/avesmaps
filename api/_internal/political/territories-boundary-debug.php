<?php

declare(strict_types=1);

function avesmapsPoliticalReadBoundaryContractDebug(PDO $pdo, array $query): array {
    $input = avesmapsPoliticalBoundaryDebugInput($query);
    $messages = [];

    $target = null;
    try {
        $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $query, false);
    } catch (Throwable $exception) {
        $messages[] = avesmapsPoliticalBoundaryDebugMessage('error', 'target_resolution_failed', $exception->getMessage());
    }

    $clickedGeometry = avesmapsPoliticalBoundaryDebugGeometryByPublicId($pdo, $input['geometry_public_id'], $messages);
    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $targetTerritory = is_array($target['territory'] ?? null) ? $target['territory'] : null;
    $resolutionMode = $targetTerritory ? 'direct' : 'none';

    if (!$targetTerritory && $clickedGeometry && (int) ($clickedGeometry['territory_id'] ?? 0) > 0) {
        $targetTerritory = avesmapsPoliticalBoundaryDebugResolveFromGeometryContext(
            $territories,
            (int) $clickedGeometry['territory_id'],
            (string) ($target['target_key'] ?? $input['target_key'])
        );
        if ($targetTerritory) {
            $resolutionMode = 'geometry_context';
            $messages[] = avesmapsPoliticalBoundaryDebugMessage('warning', 'fallback_target_resolution', 'Ziel wurde aus geklickter Geometrie und Parent-Kette abgeleitet.');
        }
    }

    $targetId = (int) ($targetTerritory['id'] ?? 0);
    $childTerritories = $targetId > 0 ? avesmapsPoliticalBoundaryDebugChildren($territories, $targetId) : [];
    $descendantIds = $targetId > 0 ? avesmapsPoliticalCollectDerivedGeometryDescendantIds($targetId, $territories) : [];
    $sourceTerritoryIds = $descendantIds !== [] ? $descendantIds : ($targetId > 0 ? [$targetId] : []);
    $sourceGeometries = $sourceTerritoryIds !== [] ? avesmapsPoliticalFetchDerivedSourceGeometries($pdo, $sourceTerritoryIds) : [];
    $activeDerived = $targetId > 0 ? avesmapsPoliticalFetchActiveDerivedGeometryForTerritory($pdo, $targetId) : null;

    if ($targetId < 1) {
        $messages[] = avesmapsPoliticalBoundaryDebugMessage('error', 'missing_save_target', 'Kein eindeutiges gespeichertes Ziel-Territory.');
    }
    if ($targetId > 0 && $sourceGeometries === []) {
        $messages[] = avesmapsPoliticalBoundaryDebugMessage('warning', 'missing_sources', 'Keine aktiven Quellgeometrien fuer dieses Ziel.');
    }
    if ($resolutionMode !== 'direct') {
        $messages[] = avesmapsPoliticalBoundaryDebugMessage('warning', 'save_not_strict', 'Save sollte erst nach direkter territory_public_id-Aufloesung passieren.');
    }

    $previewSafe = $sourceGeometries !== [];
    $saveSafe = $targetId > 0 && $sourceGeometries !== [] && $resolutionMode === 'direct';

    return [
        'ok' => true,
        'input' => $input,
        'contract' => [
            'source_geometry' => 'political_territory_geometry',
            'derived_boundary' => 'political_territory_derived_geometry',
            'preview_may_use_fallback' => true,
            'save_requires_direct_territory_public_id' => true,
        ],
        'resolution' => [
            'mode' => $resolutionMode,
            'direct_target_key' => (string) ($target['target_key'] ?? ''),
            'direct_target_name' => (string) ($target['target_name'] ?? ''),
            'resolved_territory' => avesmapsPoliticalBoundaryDebugTerritory($targetTerritory),
        ],
        'clicked_geometry' => avesmapsPoliticalBoundaryDebugGeometry($clickedGeometry),
        'clicked_geometry_chain' => $clickedGeometry ? avesmapsPoliticalBoundaryDebugChain($territories, (int) ($clickedGeometry['territory_id'] ?? 0)) : [],
        'children' => $childTerritories,
        'descendant_territory_count' => count($descendantIds),
        'source_territory_ids' => $sourceTerritoryIds,
        'source_count' => count($sourceGeometries),
        'source_geometries' => array_map('avesmapsPoliticalBoundaryDebugSource', $sourceGeometries),
        'active_derived_geometry' => avesmapsPoliticalBoundaryDebugDerived($activeDerived),
        'preview_safe' => $previewSafe,
        'save_safe' => $saveSafe,
        'messages' => $messages,
    ];
}

function avesmapsPoliticalBoundaryDebugInput(array $query): array {
    return [
        'target_key' => avesmapsNormalizeSingleLine((string) ($query['target_key'] ?? ''), 255),
        'territory_public_id' => avesmapsNormalizeSingleLine((string) ($query['territory_public_id'] ?? $query['public_id'] ?? ''), 80),
        'wiki_key' => avesmapsNormalizeSingleLine((string) ($query['wiki_key'] ?? ''), 255),
        'geometry_public_id' => avesmapsNormalizeSingleLine((string) ($query['geometry_public_id'] ?? ''), 80),
    ];
}

function avesmapsPoliticalBoundaryDebugGeometryByPublicId(PDO $pdo, string $publicId, array &$messages): ?array {
    if ($publicId === '') return null;
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $publicId) !== 1) {
        $messages[] = avesmapsPoliticalBoundaryDebugMessage('error', 'invalid_geometry_public_id', 'geometry_public_id ist keine UUID.');
        return null;
    }
    try {
        return avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($publicId));
    } catch (Throwable $exception) {
        $messages[] = avesmapsPoliticalBoundaryDebugMessage('error', 'geometry_not_found', $exception->getMessage());
        return null;
    }
}

function avesmapsPoliticalBoundaryDebugResolveFromGeometryContext(array $territories, int $geometryTerritoryId, string $targetKey): ?array {
    if (function_exists('avesmapsPoliticalResolveDerivedSourceContextTerritory')) {
        return avesmapsPoliticalResolveDerivedSourceContextTerritory($territories, $geometryTerritoryId, avesmapsPoliticalBoundaryDebugKey($targetKey));
    }
    return $territories[$geometryTerritoryId] ?? null;
}

function avesmapsPoliticalBoundaryDebugKey(string $value): string {
    $value = trim($value);
    if (stripos($value, 'wiki:') === 0) $value = substr($value, 5);
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1) return strtolower($value);
    return avesmapsPoliticalSlug($value);
}

function avesmapsPoliticalBoundaryDebugChildren(array $territories, int $parentId): array {
    $children = [];
    foreach ($territories as $territory) {
        if ((int) ($territory['parent_id'] ?? 0) === $parentId) $children[] = avesmapsPoliticalBoundaryDebugTerritory($territory);
    }
    return $children;
}

function avesmapsPoliticalBoundaryDebugChain(array $territories, int $territoryId): array {
    $chain = [];
    $seen = [];
    while ($territoryId > 0 && isset($territories[$territoryId]) && !isset($seen[$territoryId])) {
        $seen[$territoryId] = true;
        array_unshift($chain, avesmapsPoliticalBoundaryDebugTerritory($territories[$territoryId]));
        $territoryId = (int) ($territories[$territoryId]['parent_id'] ?? 0);
    }
    return $chain;
}

function avesmapsPoliticalBoundaryDebugTerritory(?array $territory): ?array {
    if (!$territory) return null;
    return [
        'id' => (int) ($territory['id'] ?? 0),
        'public_id' => (string) ($territory['public_id'] ?? ''),
        'name' => (string) ($territory['name'] ?? ''),
        'slug' => (string) ($territory['slug'] ?? ''),
        'parent_id' => (int) ($territory['parent_id'] ?? 0),
        'wiki_id' => (int) ($territory['wiki_id'] ?? 0),
        'valid_from_bf' => avesmapsPoliticalNullableInt($territory['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNullableInt($territory['valid_to_bf'] ?? null),
        'min_zoom' => avesmapsPoliticalNullableInt($territory['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($territory['max_zoom'] ?? null),
    ];
}

function avesmapsPoliticalBoundaryDebugGeometry(?array $geometry): ?array {
    if (!$geometry) return null;
    $geojson = avesmapsPoliticalDecodeJson($geometry['geometry_geojson'] ?? null);
    return [
        'public_id' => (string) ($geometry['public_id'] ?? ''),
        'territory_id' => (int) ($geometry['territory_id'] ?? 0),
        'geometry_type' => (string) ($geojson['type'] ?? ''),
        'source' => (string) ($geometry['source'] ?? ''),
        'valid_from_bf' => avesmapsPoliticalNullableInt($geometry['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNullableInt($geometry['valid_to_bf'] ?? null),
        'is_active' => (int) ($geometry['is_active'] ?? 0) === 1,
    ];
}

function avesmapsPoliticalBoundaryDebugSource(array $source): array {
    return [
        'geometry_public_id' => (string) ($source['geometry_public_id'] ?? ''),
        'territory_public_id' => (string) ($source['territory_public_id'] ?? ''),
        'territory_name' => (string) ($source['territory_name'] ?? ''),
        'geometry_type' => (string) (($source['geometry']['type'] ?? '')),
        'source' => (string) ($source['source'] ?? ''),
    ];
}

function avesmapsPoliticalBoundaryDebugDerived(?array $derived): ?array {
    if (!$derived) return null;
    return [
        'public_id' => (string) ($derived['public_id'] ?? ''),
        'territory_id' => (int) ($derived['territory_id'] ?? 0),
        'show_inner_boundaries' => (int) ($derived['show_inner_boundaries'] ?? 1) === 1,
        'min_zoom' => avesmapsPoliticalNullableInt($derived['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($derived['max_zoom'] ?? null),
        'updated_at' => (string) ($derived['updated_at'] ?? ''),
    ];
}

function avesmapsPoliticalBoundaryDebugMessage(string $level, string $code, string $message): array {
    return ['level' => $level, 'code' => $code, 'message' => $message];
}

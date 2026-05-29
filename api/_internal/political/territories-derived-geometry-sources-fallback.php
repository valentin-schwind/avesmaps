<?php

declare(strict_types=1);

function avesmapsPoliticalReadDerivedGeometrySourcesWithGeometryFallback(PDO $pdo, array $query): array {
    $response = avesmapsPoliticalReadDerivedGeometrySources($pdo, $query);
    if ((int) ($response['source_count'] ?? 0) > 0) {
        return $response;
    }

    $geometryPublicId = avesmapsNormalizeSingleLine((string) ($query['geometry_public_id'] ?? $query['public_id'] ?? ''), 80);
    if ($geometryPublicId === '' || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $geometryPublicId) !== 1) {
        return $response;
    }

    try {
        $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($geometryPublicId));
    } catch (InvalidArgumentException) {
        return $response;
    }

    $contextResponse = avesmapsPoliticalReadDerivedGeometrySourcesFromGeometryContext($pdo, $query, $response, $geometry);
    if ((int) ($contextResponse['source_count'] ?? 0) > 0) {
        return $contextResponse;
    }

    return avesmapsPoliticalReadDerivedGeometrySourcesFromSingleGeometryFallback($response, $geometry);
}

function avesmapsPoliticalReadDerivedGeometrySourcesFromGeometryContext(PDO $pdo, array $query, array $response, array $geometry): array {
    $geometryTerritoryId = (int) ($geometry['territory_id'] ?? 0);
    if ($geometryTerritoryId < 1) {
        return $response;
    }

    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    if (!isset($territories[$geometryTerritoryId])) {
        return $response;
    }

    $targetKey = avesmapsPoliticalNormalizeDerivedSourceTargetKey((string) ($response['target_key'] ?? $query['target_key'] ?? ''));
    $targetTerritory = avesmapsPoliticalResolveDerivedSourceContextTerritory($territories, $geometryTerritoryId, $targetKey);
    if (!is_array($targetTerritory)) {
        return $response;
    }

    $targetTerritoryId = (int) ($targetTerritory['id'] ?? 0);
    if ($targetTerritoryId < 1) {
        return $response;
    }

    $sourceTerritoryIds = avesmapsPoliticalCollectDerivedGeometryDescendantIds($targetTerritoryId, $territories);
    if ($sourceTerritoryIds === []) {
        $sourceTerritoryIds = [$targetTerritoryId];
    }

    $sourceGeometries = avesmapsPoliticalFetchDerivedSourceGeometries($pdo, $sourceTerritoryIds);
    if ($sourceGeometries === []) {
        return $response;
    }

    $response['territory_public_id'] = (string) ($targetTerritory['public_id'] ?? '');
    $response['target_key'] = (string) ($targetTerritory['public_id'] ?? $response['target_key'] ?? '');
    $response['target_name'] = (string) ($targetTerritory['name'] ?? $response['target_name'] ?? '');
    $response['source_geometries'] = $sourceGeometries;
    $response['source_count'] = count($sourceGeometries);
    $response['source_mode'] = count($sourceTerritoryIds) > 1 ? 'geometry_context_descendants' : 'geometry_context_target_territory';
    $response['source_territory_ids'] = $sourceTerritoryIds;
    $response['descendant_territory_count'] = count(avesmapsPoliticalCollectDerivedGeometryDescendantIds($targetTerritoryId, $territories));
    $response['geometry_context_public_id'] = (string) ($geometry['public_id'] ?? '');

    return $response;
}

function avesmapsPoliticalResolveDerivedSourceContextTerritory(array $territories, int $geometryTerritoryId, string $targetKey): ?array {
    $chain = [];
    $currentId = $geometryTerritoryId;
    while ($currentId > 0 && isset($territories[$currentId])) {
        $territory = $territories[$currentId];
        $chain[] = $territory;
        $currentId = (int) ($territory['parent_id'] ?? 0);
    }

    if ($chain === []) {
        return null;
    }

    foreach ($chain as $territory) {
        if (avesmapsPoliticalDerivedSourceTerritoryMatchesTarget($territory, $targetKey)) {
            return $territory;
        }
    }

    $directParentId = (int) ($chain[0]['parent_id'] ?? 0);
    if ($directParentId > 0 && isset($territories[$directParentId])) {
        return $territories[$directParentId];
    }

    return $chain[0];
}

function avesmapsPoliticalDerivedSourceTerritoryMatchesTarget(array $territory, string $targetKey): bool {
    if ($targetKey === '') {
        return false;
    }

    $candidates = [
        (string) ($territory['public_id'] ?? ''),
        (string) ($territory['slug'] ?? ''),
        (string) ($territory['name'] ?? ''),
        avesmapsPoliticalSlug((string) ($territory['name'] ?? '')),
    ];

    foreach ($candidates as $candidate) {
        $candidateKey = avesmapsPoliticalNormalizeDerivedSourceTargetKey($candidate);
        if ($candidateKey === '') {
            continue;
        }
        if ($candidateKey === $targetKey) {
            return true;
        }
        if (levenshtein($candidateKey, $targetKey) <= 3) {
            return true;
        }
    }

    return false;
}

function avesmapsPoliticalNormalizeDerivedSourceTargetKey(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    if (str_starts_with(strtolower($value), 'wiki:')) {
        $value = substr($value, 5);
    }

    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1) {
        return strtolower($value);
    }

    return avesmapsPoliticalSlug($value);
}

function avesmapsPoliticalReadDerivedGeometrySourcesFromSingleGeometryFallback(array $response, array $geometry): array {
    $geometryGeoJson = avesmapsPoliticalDecodeJson($geometry['geometry_geojson'] ?? null);
    if (!is_array($geometryGeoJson)) {
        return $response;
    }

    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $response['source_geometries'] = [[
        'geometry_public_id' => (string) ($geometry['public_id'] ?? ''),
        'territory_public_id' => '',
        'territory_name' => (string) ($response['target_name'] ?? ''),
        'territory_short_name' => '',
        'geometry' => $geometryGeoJson,
        'source' => (string) ($geometry['source'] ?? 'geometry_fallback'),
        'updated_at' => (string) ($geometry['updated_at'] ?? ''),
        'color' => (string) ($style['fill'] ?? $style['stroke'] ?? '#888888'),
        'fill' => (string) ($style['fill'] ?? $style['stroke'] ?? '#888888'),
        'stroke' => (string) ($style['stroke'] ?? $style['fill'] ?? '#888888'),
    ]];
    $response['source_count'] = 1;
    $response['source_mode'] = 'geometry_fallback';
    $response['source_territory_ids'] = [];
    $response['descendant_territory_count'] = 0;
    $response['geometry_fallback_public_id'] = (string) ($geometry['public_id'] ?? '');

    return $response;
}

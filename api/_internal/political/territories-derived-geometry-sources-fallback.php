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

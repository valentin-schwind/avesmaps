<?php

declare(strict_types=1);

function avesmapsPoliticalDebugExceptionPayload(Throwable $exception): array {
    return [
        'type' => $exception::class,
        'message' => $exception->getMessage(),
        'file' => basename((string) $exception->getFile()),
        'line' => $exception->getLine(),
    ];
}

function avesmapsPoliticalReadDebug(PDO $pdo, array $query): array {
    $yearBf = avesmapsPoliticalReadOptionalInt($query['year_bf'] ?? null) ?? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;
    $zoomFrom = avesmapsPoliticalReadOptionalZoom($query['zoom_from'] ?? null) ?? 0;
    $zoomTo = avesmapsPoliticalReadOptionalZoom($query['zoom_to'] ?? null) ?? 6;
    if ($zoomFrom > $zoomTo) {
        [$zoomFrom, $zoomTo] = [$zoomTo, $zoomFrom];
    }

    $target = avesmapsPoliticalResolveDebugTerritory($pdo, $query);
    $matches = avesmapsPoliticalFindDebugTerritories($pdo, $query);
    if ($target === null && $matches !== []) {
        $target = avesmapsPoliticalFetchTerritoryById($pdo, (int) $matches[0]['id']);
    }

    $summary = avesmapsPoliticalReadDebugSummary($pdo);
    if ($target === null) {
        return [
            'ok' => true,
            'mode' => 'search',
            'summary' => $summary,
            'matches' => array_map(static fn(array $row): array => avesmapsPoliticalTerritoryRowToPublic($row), $matches),
        ];
    }

    $wiki = !empty($target['wiki_id']) ? avesmapsPoliticalFetchWikiById($pdo, (int) $target['wiki_id']) : null;
    $geometries = avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $target['id']);
    $territoriesResponse = avesmapsPoliticalListTerritories($pdo, ['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);
    $territories = $territoriesResponse['territories'];
    $chain = avesmapsPoliticalBuildDebugParentChain($territories, (int) $target['id']);
    $children = avesmapsPoliticalBuildDebugChildrenList($territories, (int) $target['id']);
    $zoomVisibility = [];
    for ($zoom = $zoomFrom; $zoom <= $zoomTo; $zoom++) {
        $layer = avesmapsPoliticalReadLayer($pdo, [
            'year_bf' => $yearBf,
            'zoom' => $zoom,
        ]);
        $zoomVisibility[] = avesmapsPoliticalBuildDebugZoomSnapshot($layer, (string) $target['public_id'], $zoom);
    }

    return [
        'ok' => true,
        'mode' => 'territory',
        'summary' => $summary,
        'target' => avesmapsPoliticalTerritoryRowToPublic($target),
        'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalBuildDebugGeometryPayload($row), $geometries),
        'parent_chain' => $chain,
        'children' => $children,
        'matches' => array_map(static fn(array $row): array => avesmapsPoliticalTerritoryRowToPublic($row), $matches),
        'zoom_visibility' => $zoomVisibility,
    ];
}

function avesmapsPoliticalDebugGeometryOperation(array $payload): array {
    $operation = avesmapsNormalizeSingleLine((string) ($payload['operation'] ?? ''), 40);
    if (!in_array($operation, ['union', 'difference', 'difference-keep-target', 'intersection'], true)) {
        throw new InvalidArgumentException('Die Geometrieoperation ist unbekannt.');
    }

    $sourceGeometry = avesmapsPoliticalReadGeoJsonGeometry($payload['source_geometry_geojson'] ?? null);
    $targetGeometry = avesmapsPoliticalReadGeoJsonGeometry($payload['target_geometry_geojson'] ?? null);
    $resultGeometry = avesmapsPoliticalReadGeoJsonGeometry($payload['result_geometry_geojson'] ?? null);
    $sourceDiagnostics = avesmapsPoliticalBuildGeometryDiagnostics($sourceGeometry);
    $targetDiagnostics = avesmapsPoliticalBuildGeometryDiagnostics($targetGeometry);
    $resultDiagnostics = avesmapsPoliticalBuildGeometryDiagnostics($resultGeometry);
    $issues = avesmapsPoliticalCompareGeometryOperationDiagnostics(
        $operation,
        $sourceDiagnostics,
        $targetDiagnostics,
        $resultDiagnostics
    );

    return [
        'ok' => true,
        'operation' => $operation,
        'source' => $sourceDiagnostics,
        'target' => $targetDiagnostics,
        'result' => $resultDiagnostics,
        'issues' => $issues,
        'valid' => $issues === [],
    ];
}

function avesmapsPoliticalResolveDebugTerritory(PDO $pdo, array $query): ?array {
    $publicId = trim((string) ($query['public_id'] ?? $query['territory_public_id'] ?? ''));
    if ($publicId !== '') {
        return avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($publicId));
    }

    $id = avesmapsPoliticalReadOptionalInt($query['id'] ?? null);
    if ($id !== null && $id > 0) {
        return avesmapsPoliticalFetchTerritoryById($pdo, $id);
    }

    return null;
}

function avesmapsPoliticalFindDebugTerritories(PDO $pdo, array $query): array {
    $search = avesmapsNormalizeSingleLine((string) ($query['name'] ?? $query['q'] ?? ''), 255);
    if ($search === '') {
        return [];
    }

    $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search) . '%';
    $statement = $pdo->prepare(
        'SELECT
            territory.*,
            parent.public_id AS parent_public_id,
            parent.name AS parent_name,
            capital_place.public_id AS capital_place_public_id,
            seat_place.public_id AS seat_place_public_id,
            wiki.name AS wiki_name,
            wiki.type AS wiki_type,
            wiki.affiliation_raw AS wiki_affiliation_raw,
            wiki.affiliation_root AS wiki_affiliation_root,
            wiki.affiliation_path_json AS wiki_affiliation_path_json,
            wiki.founded_text AS wiki_founded_text,
            wiki.dissolved_text AS wiki_dissolved_text,
            wiki.capital_name AS wiki_capital_name,
            wiki.seat_name AS wiki_seat_name
        FROM political_territory territory
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        WHERE territory.continent = :continent
            AND (
                territory.name LIKE :like_name
                OR territory.short_name LIKE :like_short_name
                OR territory.slug LIKE :like_slug
                OR territory.public_id = :exact
                OR wiki.name LIKE :like_wiki_name
                OR wiki.affiliation_raw LIKE :like_affiliation_raw
                OR wiki.affiliation_root LIKE :like_affiliation_root
            )
        ORDER BY territory.name ASC
        LIMIT 50'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'like_name' => $like,
        'like_short_name' => $like,
        'like_slug' => $like,
        'like_wiki_name' => $like,
        'like_affiliation_raw' => $like,
        'like_affiliation_root' => $like,
        'exact' => $search,
    ]);

    return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function avesmapsPoliticalReadDebugSummary(PDO $pdo): array {
    $summaryStatement = $pdo->query(
        'SELECT
            COUNT(*) AS territory_count,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_territory_count,
            SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) AS root_count
        FROM political_territory
        WHERE continent = ' . $pdo->quote(AVESMAPS_POLITICAL_DEFAULT_CONTINENT)
    );
    $summary = $summaryStatement !== false ? ($summaryStatement->fetch(PDO::FETCH_ASSOC) ?: []) : [];

    $geometryStatement = $pdo->query(
        'SELECT
            COUNT(*) AS geometry_count,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_geometry_count
        FROM political_territory_geometry'
    );
    $geometrySummary = $geometryStatement !== false ? ($geometryStatement->fetch(PDO::FETCH_ASSOC) ?: []) : [];

    return [
        'territory_count' => (int) ($summary['territory_count'] ?? 0),
        'active_territory_count' => (int) ($summary['active_territory_count'] ?? 0),
        'root_count' => (int) ($summary['root_count'] ?? 0),
        'geometry_count' => (int) ($geometrySummary['geometry_count'] ?? 0),
        'active_geometry_count' => (int) ($geometrySummary['active_geometry_count'] ?? 0),
    ];
}

function avesmapsPoliticalBuildDebugParentChain(array $territories, int $territoryId): array {
    $territoriesById = [];
    foreach ($territories as $territory) {
        $territoriesById[(int) $territory['id']] = $territory;
    }

    $chain = [];
    $currentId = $territoryId;
    $safety = 0;
    while ($currentId > 0 && isset($territoriesById[$currentId]) && $safety < 20) {
        $current = $territoriesById[$currentId];
        $chain[] = [
            'id' => (int) $current['id'],
            'public_id' => (string) $current['public_id'],
            'name' => (string) $current['name'],
            'type' => (string) ($current['type'] ?? ''),
            'min_zoom' => avesmapsPoliticalNullableInt($current['min_zoom'] ?? null),
            'max_zoom' => avesmapsPoliticalNullableInt($current['max_zoom'] ?? null),
            'parent_id' => isset($current['parent_id']) ? (int) $current['parent_id'] : null,
            'parent_public_id' => (string) ($current['parent_public_id'] ?? ''),
            'parent_name' => (string) ($current['parent_name'] ?? ''),
        ];
        $currentId = (int) ($current['parent_id'] ?? 0);
        $safety++;
    }

    return $chain;
}

function avesmapsPoliticalBuildDebugChildrenList(array $territories, int $territoryId): array {
    $children = array_values(array_filter(
        $territories,
        static fn(array $territory): bool => (int) ($territory['parent_id'] ?? 0) === $territoryId
    ));
    usort(
        $children,
        static fn(array $left, array $right): int => strcmp((string) $left['name'], (string) $right['name'])
    );

    return array_map(
        static fn(array $territory): array => [
            'id' => (int) $territory['id'],
            'public_id' => (string) $territory['public_id'],
            'name' => (string) $territory['name'],
            'type' => (string) ($territory['type'] ?? ''),
            'min_zoom' => avesmapsPoliticalNullableInt($territory['min_zoom'] ?? null),
            'max_zoom' => avesmapsPoliticalNullableInt($territory['max_zoom'] ?? null),
        ],
        $children
    );
}

function avesmapsPoliticalBuildDebugZoomSnapshot(array $layer, string $territoryPublicId, int $zoom): array {
    $matchingFeatures = [];
    foreach ((array) ($layer['features'] ?? []) as $feature) {
        $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
        $isDirectMatch = (string) ($properties['territory_public_id'] ?? '') === $territoryPublicId;
        $isAggregateSourceMatch = (string) ($properties['aggregate_source_territory_public_id'] ?? '') === $territoryPublicId;
        if (!$isDirectMatch && !$isAggregateSourceMatch) {
            continue;
        }

        $matchingFeatures[] = [
            'feature_id' => (string) ($feature['id'] ?? ''),
            'territory_public_id' => (string) ($properties['territory_public_id'] ?? ''),
            'name' => (string) ($properties['name'] ?? ''),
            'display_name' => (string) ($properties['display_name'] ?? ''),
            'is_aggregate' => !empty($properties['is_aggregate']),
            'aggregate_source_territory_public_id' => (string) ($properties['aggregate_source_territory_public_id'] ?? ''),
            'aggregate_source_territory_name' => (string) ($properties['aggregate_source_territory_name'] ?? ''),
            'min_zoom' => avesmapsPoliticalNullableInt($properties['min_zoom'] ?? null),
            'max_zoom' => avesmapsPoliticalNullableInt($properties['max_zoom'] ?? null),
        ];
    }

    return [
        'zoom' => $zoom,
        'visible' => $matchingFeatures !== [],
        'matching_feature_count' => count($matchingFeatures),
        'matching_features' => $matchingFeatures,
    ];
}

function avesmapsPoliticalBuildDebugGeometryPayload(array $row): array {
    $geometry = avesmapsPoliticalGeometryRowToPublic($row);
    $shape = $geometry['geometry'] ?? null;

    return $geometry + [
        'part_count' => avesmapsPoliticalCountGeometryParts($shape),
        'ring_count' => avesmapsPoliticalCountGeometryRings($shape),
        'bbox' => [
            'min_x' => isset($row['min_x']) ? (float) $row['min_x'] : null,
            'min_y' => isset($row['min_y']) ? (float) $row['min_y'] : null,
            'max_x' => isset($row['max_x']) ? (float) $row['max_x'] : null,
            'max_y' => isset($row['max_y']) ? (float) $row['max_y'] : null,
        ],
    ];
}

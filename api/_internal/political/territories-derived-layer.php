<?php

declare(strict_types=1);

function avesmapsPoliticalReadLayerWithDerivedGeometry(PDO $pdo, array $query): array {
    $response = avesmapsPoliticalReadLayer($pdo, $query);
    $yearBf = avesmapsPoliticalReadOptionalInt($query['year_bf'] ?? null) ?? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;
    $zoom = avesmapsPoliticalReadOptionalZoom($query['zoom'] ?? null) ?? 0;
    $bbox = avesmapsPoliticalReadOptionalBoundingBox((string) ($query['bbox'] ?? ''));
    $derivedFeatures = avesmapsPoliticalReadDerivedLayerFeatures($pdo, $yearBf, $zoom, $bbox);
    if ($derivedFeatures === []) {
        return $response;
    }

    $derivedTerritoryIds = [];
    $hiddenInnerBoundaryTerritoryIds = [];
    foreach ($derivedFeatures as $feature) {
        $territoryPublicId = trim((string) ($feature['properties']['territory_public_id'] ?? ''));
        if ($territoryPublicId !== '') {
            $derivedTerritoryIds[$territoryPublicId] = true;
        }
        if (($feature['properties']['show_inner_boundaries'] ?? true) === false) {
            $hiddenInnerBoundaryTerritoryIds += avesmapsPoliticalReadDerivedInnerBoundaryTerritoryIds(
                $pdo,
                (int) ($feature['properties']['derived_territory_id'] ?? 0),
                $territoryPublicId
            );
        }
    }

    $baseFeatures = [];
    foreach ((array) ($response['features'] ?? []) as $feature) {
        $territoryPublicId = trim((string) ($feature['properties']['territory_public_id'] ?? ''));
        if ($territoryPublicId !== '' && isset($derivedTerritoryIds[$territoryPublicId])) {
            continue;
        }
        if ($territoryPublicId !== '' && isset($hiddenInnerBoundaryTerritoryIds[$territoryPublicId])) {
            $feature['properties']['visual_hidden_by_derived_boundary'] = true;
            $feature['properties']['hidden_by_derived_territory_public_id'] = $hiddenInnerBoundaryTerritoryIds[$territoryPublicId];
        }
        $baseFeatures[] = $feature;
    }

    $response['features'] = array_values(array_merge($baseFeatures, $derivedFeatures));

    return $response;
}

function avesmapsPoliticalReadDerivedLayerFeatures(PDO $pdo, int $yearBf, int $zoom, ?array $bbox): array {
    $normalizedTerritoryValidToSql = avesmapsPoliticalNormalizedValidToSql('territory.valid_to_bf', 'wiki.dissolved_type', 'wiki.dissolved_text');
    $conditions = [
        'territory.is_active = 1',
        'derived.is_active = 1',
        'territory.continent = :continent',
        '(territory.valid_from_bf IS NULL OR territory.valid_from_bf <= :year_bf_start)',
        '(' . $normalizedTerritoryValidToSql . ' IS NULL OR ' . $normalizedTerritoryValidToSql . ' >= :year_bf_end)',
        '(derived.min_zoom IS NULL OR derived.min_zoom <= :zoom)',
        '(derived.max_zoom IS NULL OR derived.max_zoom >= :zoom)',
    ];
    $params = [
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'year_bf_start' => $yearBf,
        'year_bf_end' => $yearBf,
        'zoom' => $zoom,
    ];

    if ($bbox !== null) {
        $conditions[] = 'derived.max_x >= :bbox_min_x';
        $conditions[] = 'derived.min_x <= :bbox_max_x';
        $conditions[] = 'derived.max_y >= :bbox_min_y';
        $conditions[] = 'derived.min_y <= :bbox_max_y';
        $params += [
            'bbox_min_x' => $bbox['min_x'],
            'bbox_min_y' => $bbox['min_y'],
            'bbox_max_x' => $bbox['max_x'],
            'bbox_max_y' => $bbox['max_y'],
        ];
    }

    $statement = $pdo->prepare(
        'SELECT
            territory.id AS territory_id,
            territory.public_id AS territory_public_id,
            territory.parent_id,
            territory.slug,
            territory.name,
            territory.short_name,
            territory.type,
            territory.status,
            territory.color,
            territory.opacity,
            territory.coat_of_arms_url,
            territory.wiki_url,
            territory.capital_place_id,
            territory.seat_place_id,
            capital_place.public_id AS capital_place_public_id,
            seat_place.public_id AS seat_place_public_id,
            territory.valid_from_bf,
            territory.valid_to_bf,
            territory.valid_label,
            territory.min_zoom AS territory_min_zoom,
            territory.max_zoom AS territory_max_zoom,
            territory.sort_order,
            parent.public_id AS parent_public_id,
            parent.name AS parent_name,
            wiki.id AS wiki_id,
            wiki.name AS wiki_name,
            wiki.affiliation_raw,
            wiki.affiliation_root,
            wiki.affiliation_path_json,
            wiki.founded_text,
            wiki.dissolved_text,
            wiki.dissolved_type,
            wiki.capital_name,
            wiki.seat_name,
            derived.public_id AS geometry_public_id,
            derived.id AS geometry_id,
            derived.geometry_geojson,
            NULL AS geometry_valid_from_bf,
            NULL AS geometry_valid_to_bf,
            derived.min_zoom AS geometry_min_zoom,
            derived.max_zoom AS geometry_max_zoom,
            NULL AS style_json,
            derived.updated_at,
            derived.public_id AS derived_geometry_public_id,
            derived.label_lng,
            derived.label_lat,
            derived.show_inner_boundaries
        FROM political_territory_derived_geometry derived
        INNER JOIN political_territory territory ON territory.id = derived.territory_id
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        WHERE ' . implode(' AND ', $conditions) . '
        ORDER BY territory.sort_order ASC, territory.name ASC, derived.id ASC'
    );
    $statement->execute($params);

    $features = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $showInnerBoundaries = (int) ($row['show_inner_boundaries'] ?? 1) === 1;
        $feature = avesmapsPoliticalLayerRowToFeature($row, $yearBf, $zoom);
        $feature['id'] = 'derived:' . (string) $row['geometry_public_id'];
        $feature['properties']['public_id'] = (string) $row['geometry_public_id'];
        $feature['properties']['geometry_public_id'] = (string) $row['geometry_public_id'];
        $feature['properties']['derived_geometry_public_id'] = (string) $row['derived_geometry_public_id'];
        $feature['properties']['derived_territory_id'] = (int) $row['territory_id'];
        $feature['properties']['is_derived_geometry'] = true;
        $feature['properties']['is_aggregate'] = true;
        $feature['properties']['show_inner_boundaries'] = $showInnerBoundaries;
        $feature['properties']['show_region_label'] = true;
        if ($showInnerBoundaries) {
            $feature['properties']['opacity'] = 0;
            $feature['properties']['fillOpacity'] = 0;
            $feature['properties']['fill_opacity'] = 0;
        }
        $feature['properties']['label_lng'] = is_numeric($row['label_lng'] ?? null)
            ? (float) $row['label_lng']
            : ($feature['properties']['label_lng'] ?? null);
        $feature['properties']['label_lat'] = is_numeric($row['label_lat'] ?? null)
            ? (float) $row['label_lat']
            : ($feature['properties']['label_lat'] ?? null);
        $features[] = $feature;
    }

    return $features;
}

function avesmapsPoliticalReadDerivedInnerBoundaryTerritoryIds(PDO $pdo, int $territoryId, string $derivedTerritoryPublicId = ''): array {
    if ($territoryId < 1) {
        return [];
    }

    $hidden = avesmapsPoliticalReadDerivedHierarchyInnerBoundaryTerritoryIds($pdo, $territoryId, $derivedTerritoryPublicId);
    $wikiHidden = avesmapsPoliticalReadDerivedWikiInnerBoundaryTerritoryIds($pdo, $territoryId, $derivedTerritoryPublicId);

    return $hidden + $wikiHidden;
}

function avesmapsPoliticalReadDerivedHierarchyInnerBoundaryTerritoryIds(PDO $pdo, int $territoryId, string $derivedTerritoryPublicId = ''): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, parent_id
        FROM political_territory
        WHERE is_active = 1
            AND continent = :continent'
    );
    $statement->execute(['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);

    $childrenByParent = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $parentId = (int) ($row['parent_id'] ?? 0);
        if ($parentId > 0) {
            $childrenByParent[$parentId][] = $row;
        }
    }

    $hidden = [];
    $queue = $childrenByParent[$territoryId] ?? [];
    while ($queue !== []) {
        $current = array_shift($queue);
        $currentId = (int) ($current['id'] ?? 0);
        $publicId = trim((string) ($current['public_id'] ?? ''));
        if ($currentId < 1 || $publicId === '') {
            continue;
        }
        $hidden[$publicId] = $derivedTerritoryPublicId;
        foreach ($childrenByParent[$currentId] ?? [] as $child) {
            $queue[] = $child;
        }
    }

    return $hidden;
}

function avesmapsPoliticalReadDerivedWikiInnerBoundaryTerritoryIds(PDO $pdo, int $territoryId, string $derivedTerritoryPublicId = ''): array {
    $territory = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
    $wikiId = (int) ($territory['wiki_id'] ?? 0);
    if ($wikiId < 1) {
        return [];
    }

    $wiki = avesmapsPoliticalFetchWikiById($pdo, $wikiId);
    $ids = avesmapsPoliticalCollectDerivedGeometryWikiDescendantIds($pdo, $wiki);
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'SELECT public_id
        FROM political_territory
        WHERE id IN (' . $placeholders . ')
            AND is_active = 1'
    );
    $statement->execute($ids);

    $hidden = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($publicId !== '') {
            $hidden[$publicId] = $derivedTerritoryPublicId;
        }
    }

    return $hidden;
}

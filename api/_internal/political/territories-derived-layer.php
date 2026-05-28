<?php

declare(strict_types=1);

function avesmapsPoliticalReadLayerWithDerivedGeometry(PDO $pdo, array $query): array {
    $response = avesmapsPoliticalReadLayer($pdo, $query);
    $yearBf = avesmapsPoliticalReadOptionalInt($query['year_bf'] ?? null) ?? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;
    $zoom = avesmapsPoliticalReadOptionalZoom($query['zoom'] ?? null) ?? 0;
    $bbox = avesmapsPoliticalReadOptionalBoundingBox((string) ($query['bbox'] ?? ''));
    $derivedFeatures = avesmapsPoliticalReadDerivedLayerFeaturesSafely($pdo, $yearBf, $zoom, $bbox, $response);
    if ($derivedFeatures === []) {
        return $response;
    }

    $derivedTerritoryIds = [];
    $hiddenByTerritoryPublicId = [];
    foreach ($derivedFeatures as $feature) {
        $territoryPublicId = trim((string) ($feature['properties']['territory_public_id'] ?? ''));
        if ($territoryPublicId !== '') {
            $derivedTerritoryIds[$territoryPublicId] = true;
        }
        if (($feature['properties']['show_inner_boundaries'] ?? true) === false) {
            $hiddenByTerritoryPublicId += avesmapsPoliticalFindInnerBoundaryFeaturesInLayer(
                (array) ($response['features'] ?? []),
                $feature
            );
        }
    }

    $baseFeatures = [];
    foreach ((array) ($response['features'] ?? []) as $feature) {
        $territoryPublicId = trim((string) ($feature['properties']['territory_public_id'] ?? ''));
        if ($territoryPublicId !== '' && isset($derivedTerritoryIds[$territoryPublicId])) {
            continue;
        }
        if ($territoryPublicId !== '' && isset($hiddenByTerritoryPublicId[$territoryPublicId])) {
            $feature['properties']['visual_hidden_by_derived_boundary'] = true;
            $feature['properties']['hidden_by_derived_territory_public_id'] = $hiddenByTerritoryPublicId[$territoryPublicId];
        }
        $baseFeatures[] = $feature;
    }

    $response['features'] = array_values(array_merge($baseFeatures, $derivedFeatures));

    return $response;
}

function avesmapsPoliticalReadDerivedLayerFeaturesSafely(PDO $pdo, int $yearBf, int $zoom, ?array $bbox, array &$response): array {
    try {
        return avesmapsPoliticalReadDerivedLayerFeatures($pdo, $yearBf, $zoom, $bbox);
    } catch (Throwable $exception) {
        $response['derived_geometry_warning'] = 'Abgeleitete Außengrenzen konnten nicht geladen werden; normale Herrschaftsgebiete wurden ohne Außengrenzen geladen.';
        $response['derived_geometry_error'] = $exception->getMessage();
        return [];
    }
}

function avesmapsPoliticalReadDerivedLayerFeatures(PDO $pdo, int $yearBf, int $zoom, ?array $bbox): array {
    $supportsInnerBoundaries = avesmapsPoliticalDerivedLayerSupportsInnerBoundaries($pdo);
    $showInnerBoundariesSql = $supportsInnerBoundaries ? 'derived.show_inner_boundaries AS show_inner_boundaries' : '1 AS show_inner_boundaries';
    $conditions = [
        'territory.is_active = 1',
        'derived.is_active = 1',
        'territory.continent = :continent',
        '(territory.valid_from_bf IS NULL OR territory.valid_from_bf <= :year_bf_start)',
        '(territory.valid_to_bf IS NULL OR territory.valid_to_bf = 0 OR territory.valid_to_bf >= :year_bf_end)',
        '(derived.min_zoom IS NULL OR derived.min_zoom <= :zoom)',
        '(derived.max_zoom IS NULL OR derived.max_zoom >= :zoom)',
    ];
    $params = [
        ':continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        ':year_bf_start' => $yearBf,
        ':year_bf_end' => $yearBf,
        ':zoom' => $zoom,
    ];

    if ($bbox !== null) {
        $conditions[] = 'derived.max_x >= :bbox_min_x';
        $conditions[] = 'derived.min_x <= :bbox_max_x';
        $conditions[] = 'derived.max_y >= :bbox_min_y';
        $conditions[] = 'derived.min_y <= :bbox_max_y';
        $params += [
            ':bbox_min_x' => $bbox['min_x'],
            ':bbox_min_y' => $bbox['min_y'],
            ':bbox_max_x' => $bbox['max_x'],
            ':bbox_max_y' => $bbox['max_y'],
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
            ' . $showInnerBoundariesSql . '
        FROM political_territory_derived_geometry derived
        INNER JOIN political_territory territory ON territory.id = derived.territory_id
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        WHERE ' . implode(' AND ', $conditions) . '
        ORDER BY territory.sort_order ASC, territory.name ASC, derived.id ASC'
    );
    foreach ($params as $name => $value) {
        $statement->bindValue($name, $value);
    }
    $statement->execute();

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

function avesmapsPoliticalDerivedLayerSupportsInnerBoundaries(PDO $pdo): bool {
    static $supportsInnerBoundaries = null;
    if ($supportsInnerBoundaries !== null) {
        return $supportsInnerBoundaries;
    }

    try {
        $statement = $pdo->query("SHOW COLUMNS FROM political_territory_derived_geometry LIKE 'show_inner_boundaries'");
        $supportsInnerBoundaries = is_array($statement->fetch(PDO::FETCH_ASSOC));
    } catch (Throwable) {
        $supportsInnerBoundaries = false;
    }

    return $supportsInnerBoundaries;
}

function avesmapsPoliticalFindInnerBoundaryFeaturesInLayer(array $baseFeatures, array $derivedFeature): array {
    $derivedProperties = (array) ($derivedFeature['properties'] ?? []);
    $derivedTerritoryPublicId = trim((string) ($derivedProperties['territory_public_id'] ?? ''));
    $derivedName = avesmapsPoliticalLayerNormalizeComparisonText((string) ($derivedProperties['name'] ?? $derivedProperties['display_name'] ?? $derivedProperties['wiki_name'] ?? ''));
    $derivedWikiName = avesmapsPoliticalLayerNormalizeComparisonText((string) ($derivedProperties['wiki_name'] ?? ''));
    $hidden = [];

    foreach ($baseFeatures as $feature) {
        $properties = (array) ($feature['properties'] ?? []);
        $territoryPublicId = trim((string) ($properties['territory_public_id'] ?? ''));
        if ($territoryPublicId === '' || $territoryPublicId === $derivedTerritoryPublicId) {
            continue;
        }

        $parentPublicId = trim((string) ($properties['parent_public_id'] ?? ''));
        if ($parentPublicId !== '' && $parentPublicId === $derivedTerritoryPublicId) {
            $hidden[$territoryPublicId] = $derivedTerritoryPublicId;
            continue;
        }

        $affiliationValues = avesmapsPoliticalLayerReadAffiliationValues($properties);
        foreach ($affiliationValues as $value) {
            $normalized = avesmapsPoliticalLayerNormalizeComparisonText($value);
            if ($normalized !== '' && ($normalized === $derivedName || $normalized === $derivedWikiName)) {
                $hidden[$territoryPublicId] = $derivedTerritoryPublicId;
                break;
            }
        }
    }

    return $hidden;
}

function avesmapsPoliticalLayerReadAffiliationValues(array $properties): array {
    $values = [];
    foreach (['affiliation', 'affiliation_root', 'wiki_affiliation_raw', 'wiki_affiliation_root'] as $key) {
        if (!empty($properties[$key])) {
            $values[] = (string) $properties[$key];
        }
    }

    foreach (['affiliation_path', 'wiki_affiliation_path'] as $key) {
        $rawPath = $properties[$key] ?? null;
        if (is_array($rawPath)) {
            foreach ($rawPath as $value) {
                if (is_scalar($value)) {
                    $values[] = (string) $value;
                }
            }
        }
    }

    return array_values(array_unique(array_filter(array_map('trim', $values))));
}

function avesmapsPoliticalLayerNormalizeComparisonText(string $value): string {
    return avesmapsPoliticalSlug(trim($value));
}

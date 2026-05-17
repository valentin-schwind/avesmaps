<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/political-territory-lib.php';

$debugErrors = filter_var($_GET['debug_errors'] ?? false, FILTER_VALIDATE_BOOL);

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Herrschaftsgebiete nicht laden.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);

    if ($requestMethod === 'GET') {
        $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'layer'), 60);
        $response = match ($action) {
            'layer' => avesmapsPoliticalReadLayer($pdo, $_GET),
            'list' => avesmapsPoliticalListTerritories($pdo, $_GET),
            'get' => avesmapsPoliticalGetTerritory($pdo, $_GET),
            'wiki' => avesmapsPoliticalGetWikiReference($pdo, $_GET),
            'wiki_list' => avesmapsPoliticalListWikiReferences($pdo, $_GET),
            'hierarchy' => avesmapsPoliticalReadHierarchy($pdo),
            'geometries' => avesmapsPoliticalReadGeometries($pdo, $_GET),
            'geometry_assignment' => avesmapsPoliticalGetGeometryAssignment($pdo, $_GET),
            'debug' => avesmapsPoliticalReadDebug($pdo, $_GET),
            'audit' => avesmapsPoliticalReadAudit($pdo, $_GET),
            default => throw new InvalidArgumentException('Die Herrschaftsgebiet-Aktion ist unbekannt.'),
        };

        avesmapsJsonResponse(200, $response);
    }

    if (!in_array($requestMethod, ['POST', 'PATCH', 'DELETE'], true)) {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET, POST, PATCH und DELETE sind fuer Herrschaftsgebiete erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 80);
    $response = match ($action) {
        'create_territory' => avesmapsPoliticalCreateTerritory($pdo, $payload, $user),
        'update_territory' => avesmapsPoliticalUpdateTerritory($pdo, $payload, $user),
        'delete_territory' => avesmapsPoliticalDeleteTerritory($pdo, $payload),
        'save_hierarchy' => avesmapsPoliticalSaveHierarchy($pdo, $payload),
        'create_geometry' => avesmapsPoliticalCreateGeometry($pdo, $payload, $user),
        'update_geometry' => avesmapsPoliticalUpdateGeometry($pdo, $payload, $user),
        'split_geometry' => avesmapsPoliticalSplitGeometry($pdo, $payload, $user),
        'assign_geometry' => avesmapsPoliticalAssignGeometryToTerritory($pdo, $payload),
        'save_geometry_assignment' => avesmapsPoliticalSaveGeometryAssignment($pdo, $payload, $user),
        'unassign_geometry' => avesmapsPoliticalUnassignGeometry($pdo, $payload),
        'delete_geometry' => avesmapsPoliticalDeleteGeometry($pdo, $payload),
        'delete_geometry_part' => avesmapsPoliticalDeleteGeometryPart($pdo, $payload, $user),
        'geometry_operation' => avesmapsPoliticalApplyGeometryOperationResult($pdo, $payload, $user),
        'geometry_operation_debug' => avesmapsPoliticalDebugGeometryOperation($payload),
        'ensure_wiki_territory_chain' => avesmapsPoliticalEnsureWikiTerritoryChain($pdo, $payload, $user),
        'restore_legacy_region_geometries' => avesmapsPoliticalRestoreLegacyRegionGeometries($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Herrschaftsgebiet-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    $response = [
        'ok' => false,
        'error' => $exception->getMessage(),
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(400, $response);
} catch (PDOException $exception) {
    $response = [
        'ok' => false,
        'error' => 'Die Herrschaftsgebiete konnten nicht aus der Datenbank verarbeitet werden.',
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(500, $response);
} catch (RuntimeException $exception) {
    $response = [
        'ok' => false,
        'error' => $exception->getMessage(),
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(503, $response);
} catch (Throwable $exception) {
    $response = [
        'ok' => false,
        'error' => 'Die Herrschaftsgebiete konnten nicht verarbeitet werden.',
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(500, $response);
}

function avesmapsPoliticalGetGeometryAssignment(PDO $pdo, array $query): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($query['geometry_public_id'] ?? $query['public_id'] ?? '')
    );

    $territoryId = (int) ($geometry['territory_id'] ?? 0);
    $geometryStyle = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $geometryDisplayName = trim((string) ($geometryStyle['displayName'] ?? $geometryStyle['name'] ?? ''));

    if ($territoryId < 1) {
        $validTo = avesmapsPoliticalNullableInt($geometry['valid_to_bf'] ?? null);
        $existsUntilToday = $validTo === null || $validTo >= 9999;

        return [
            'ok' => true,
            'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
            'assignment' => [
                'assignedTerritory' => null,
                'activeDisplayNode' => null,
                'assignedPath' => [],
                'editedPath' => [],
                'display' => [
                    'name' => $geometryDisplayName,
                    'displayName' => $geometryDisplayName,
                    'coatOfArmsUrl' => (string) ($geometryStyle['coatOfArmsUrl'] ?? $geometryStyle['coat_of_arms_url'] ?? ''),
                    'zoomMin' => avesmapsPoliticalNullableInt($geometry['min_zoom'] ?? null),
                    'zoomMax' => avesmapsPoliticalNullableInt($geometry['max_zoom'] ?? null),
                    'color' => (string) ($geometryStyle['fill'] ?? $geometryStyle['stroke'] ?? '#888888'),
                    'opacity' => (float) ($geometryStyle['fillOpacity'] ?? 0.33),
                ],
                'validity' => [
                    'startYear' => avesmapsPoliticalNullableInt($geometry['valid_from_bf'] ?? null),
                    'endYear' => $existsUntilToday ? null : $validTo,
                    'existsUntilToday' => $existsUntilToday,
                ],
                'displays' => [],
            ],
        ];
    }

    $chain = [];
    $visited = [];
    $current = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);

    while ($current && !isset($visited[(int) $current['id']])) {
        $visited[(int) $current['id']] = true;
        array_unshift($chain, $current);

        $parentId = (int) ($current['parent_id'] ?? 0);
        if ($parentId < 1) {
            break;
        }

        $current = avesmapsPoliticalFetchTerritoryById($pdo, $parentId);
    }

    $assignedPath = [];
    $displays = [];

    foreach ($chain as $index => $territory) {
        $wikiKey = '';

        if (!empty($territory['wiki_id'])) {
            try {
                $wiki = avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']);
                $wikiKey = (string) ($wiki['wiki_key'] ?? '');
            } catch (Throwable) {
                $wikiKey = '';
            }
        }

        $label = trim((string) ($territory['name'] ?? ''));
        $nodeKey = $wikiKey !== '' ? $wikiKey : avesmapsPoliticalSlug($label);

        $pathNames = array_map(
            static fn(array $item): string => (string) ($item['name'] ?? ''),
            array_slice($chain, 0, $index + 1)
        );

        $pathKeys = array_map(
            static function (array $item): string {
                return avesmapsPoliticalSlug((string) ($item['name'] ?? ''));
            },
            array_slice($chain, 0, $index + 1)
        );

        $assignedPath[] = [
            'id' => $nodeKey,
            'key' => $nodeKey,
            'label' => $label,
            'kind' => (string) ($territory['type'] ?? 'Herrschaftsgebiet'),
            'isSynthetic' => empty($territory['wiki_id']),
            'wikiKey' => $wikiKey,
            'rowId' => isset($territory['wiki_id']) ? (int) $territory['wiki_id'] : null,
            'territoryPublicId' => (string) ($territory['public_id'] ?? ''),
            'territoryId' => (int) ($territory['id'] ?? 0),
            'slug' => (string) ($territory['slug'] ?? ''),
            'path' => $pathNames,
            'pathKeys' => $pathKeys,
        ];

        $validTo = avesmapsPoliticalNullableInt($territory['valid_to_bf'] ?? null);
        $existsUntilToday = $validTo === null || $validTo >= 9999;
        
        $storedDisplay = avesmapsPoliticalFindAssignmentDisplayForTerritory(
            $geometryStyle,
            (string) ($territory['public_id'] ?? ''),
            (string) ($territory['slug'] ?? '')
        );

        $displayName = $storedDisplay !== null
            ? avesmapsPoliticalResolveAssignmentDisplayName($storedDisplay, $label)
            : $label;

        $storedCoatOfArmsUrl = trim((string) ($storedDisplay['coatOfArmsUrl'] ?? $storedDisplay['coat_of_arms_url'] ?? ''));
        $storedColor = trim((string) ($storedDisplay['color'] ?? ''));
        $storedOpacity = $storedDisplay['opacity'] ?? null;

        $displays[] = [
            'nodeId' => $nodeKey,
            'nodeKey' => $nodeKey,
            'wikiKey' => $wikiKey,
            'rowId' => isset($territory['wiki_id']) ? (int) $territory['wiki_id'] : null,
            'territoryPublicId' => (string) ($territory['public_id'] ?? ''),
            'territoryId' => (int) ($territory['id'] ?? 0),
            'slug' => (string) ($territory['slug'] ?? ''),
            'name' => $label,
            'displayName' => $displayName,
            'coatOfArmsUrl' => $storedCoatOfArmsUrl ?: (string) ($territory['coat_of_arms_url'] ?? ''),
            'zoomMin' => avesmapsPoliticalNullableInt($storedDisplay['zoomMin'] ?? $territory['min_zoom'] ?? null),
            'zoomMax' => avesmapsPoliticalNullableInt($storedDisplay['zoomMax'] ?? $territory['max_zoom'] ?? null),
            'color' => $storedColor ?: (string) ($territory['color'] ?? '#888888'),
            'opacity' => (float) ($storedOpacity ?? $territory['opacity'] ?? 0.33),
            'startYear' => avesmapsPoliticalNullableInt($territory['valid_from_bf'] ?? null),
            'endYear' => $existsUntilToday ? null : $validTo,
            'existsUntilToday' => $existsUntilToday,
            'depth' => $index,
            'path' => $pathNames,
            'pathKeys' => $pathKeys,
            'isSynthetic' => empty($territory['wiki_id']),
            'kind' => (string) ($territory['type'] ?? 'Herrschaftsgebiet'),
        ];
    }

    $assignedTerritory = $assignedPath[count($assignedPath) - 1] ?? null;
    $activeDisplay = $displays[count($displays) - 1] ?? null;
 
    return [
        'ok' => true,
        'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
        'assignment' => [
            'assignedTerritory' => $assignedTerritory,
            'activeDisplayNode' => $assignedTerritory,
            'assignedPath' => $assignedPath,
            'editedPath' => $assignedPath,
            'display' => $activeDisplay === null ? null : [
                'name' => $activeDisplay['displayName'],
                'displayName' => $activeDisplay['displayName'],
                'coatOfArmsUrl' => $activeDisplay['coatOfArmsUrl'],
                'zoomMin' => $activeDisplay['zoomMin'],
                'zoomMax' => $activeDisplay['zoomMax'],
                'color' => $activeDisplay['color'],
                'opacity' => $activeDisplay['opacity'],
            ],
            'validity' => $activeDisplay === null ? null : [
                'startYear' => $activeDisplay['startYear'],
                'endYear' => $activeDisplay['endYear'],
                'existsUntilToday' => $activeDisplay['existsUntilToday'],
            ],
            'displays' => $displays,
        ],
    ];
}

function avesmapsPoliticalDebugExceptionPayload(Throwable $exception): array {
    return [
        'type' => $exception::class,
        'message' => $exception->getMessage(),
        'file' => basename((string) $exception->getFile()),
        'line' => $exception->getLine(),
    ];
}

function avesmapsPoliticalReadLayer(PDO $pdo, array $query): array {
    $yearBf = avesmapsPoliticalReadOptionalInt($query['year_bf'] ?? null) ?? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;
    $zoom = avesmapsPoliticalReadOptionalZoom($query['zoom'] ?? null) ?? 0;
    $isEditMode = avesmapsPoliticalReadBoolean($query['edit_mode'] ?? false);
    $bbox = avesmapsPoliticalReadOptionalBoundingBox((string) ($query['bbox'] ?? ''));

    if ($isEditMode) {
        return avesmapsPoliticalReadEditorLayer($pdo, $yearBf, $zoom, $bbox);
    }

    $normalizedTerritoryValidToSql = avesmapsPoliticalNormalizedValidToSql('territory.valid_to_bf', 'wiki.dissolved_type', 'wiki.dissolved_text');
    $normalizedGeometryValidToSql = avesmapsPoliticalNormalizedValidToSql('geometry.valid_to_bf', 'wiki.dissolved_type', 'wiki.dissolved_text');

    $conditions = [
        'territory.is_active = 1',
        'geometry.is_active = 1',
        'territory.continent = :continent',
        '(COALESCE(geometry.valid_from_bf, territory.valid_from_bf) IS NULL OR COALESCE(geometry.valid_from_bf, territory.valid_from_bf) <= :year_bf_start)',
        '(COALESCE(' . $normalizedGeometryValidToSql . ', ' . $normalizedTerritoryValidToSql . ') IS NULL OR COALESCE(' . $normalizedGeometryValidToSql . ', ' . $normalizedTerritoryValidToSql . ') >= :year_bf_end)',
    ];
    $params = [
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'year_bf_start' => $yearBf,
        'year_bf_end' => $yearBf,
    ];

    if ($bbox !== null) {
        $conditions[] = 'geometry.max_x >= :bbox_min_x';
        $conditions[] = 'geometry.min_x <= :bbox_max_x';
        $conditions[] = 'geometry.max_y >= :bbox_min_y';
        $conditions[] = 'geometry.min_y <= :bbox_max_y';
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
            geometry.public_id AS geometry_public_id,
            geometry.id AS geometry_id,
            geometry.geometry_geojson,
            geometry.valid_from_bf AS geometry_valid_from_bf,
            geometry.valid_to_bf AS geometry_valid_to_bf,
            geometry.min_zoom AS geometry_min_zoom,
            geometry.max_zoom AS geometry_max_zoom,
            geometry.style_json,
            geometry.updated_at
        FROM political_territory territory
        INNER JOIN political_territory_geometry geometry ON geometry.territory_id = territory.id
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        WHERE ' . implode(' AND ', $conditions) . '
        ORDER BY territory.sort_order ASC, territory.name ASC, geometry.id ASC'
    );
    $statement->execute($params);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    $territories = avesmapsPoliticalFetchLayerTerritories($pdo, $yearBf);
    if (!$isEditMode) {
        $rows = avesmapsPoliticalAppendLegacyFallbackLayerRows($pdo, $rows, $territories, $zoom);
    }
    $parentIds = avesmapsPoliticalBuildEffectiveLayerParentIds($territories);
    $features = avesmapsPoliticalBuildResolvedLayerFeatures($rows, $territories, $parentIds, $yearBf, $zoom);

    return [
        'ok' => true,
        'type' => 'FeatureCollection',
        'year_bf' => $yearBf,
        'zoom' => $zoom,
        'features' => $features,
    ];
}

function avesmapsPoliticalReadEditorLayer(PDO $pdo, int $yearBf, int $zoom, ?array $bbox): array {
    $conditions = [
        'geometry.is_active = 1',
        '(territory.id IS NULL OR territory.is_active = 1)',
    ];
    $params = [];

    if ($bbox !== null) {
        $conditions[] = 'geometry.max_x >= :bbox_min_x';
        $conditions[] = 'geometry.min_x <= :bbox_max_x';
        $conditions[] = 'geometry.max_y >= :bbox_min_y';
        $conditions[] = 'geometry.min_y <= :bbox_max_y';
        $params += [
            'bbox_min_x' => $bbox['min_x'],
            'bbox_min_y' => $bbox['min_y'],
            'bbox_max_x' => $bbox['max_x'],
            'bbox_max_y' => $bbox['max_y'],
        ];
    }

    $statement = $pdo->prepare(
        'SELECT
            geometry.id AS geometry_id,
            geometry.public_id AS geometry_public_id,
            geometry.territory_id,
            geometry.geometry_geojson,
            geometry.valid_from_bf AS geometry_valid_from_bf,
            geometry.valid_to_bf AS geometry_valid_to_bf,
            geometry.min_zoom AS geometry_min_zoom,
            geometry.max_zoom AS geometry_max_zoom,
            geometry.style_json,
            geometry.updated_at,
            geometry.source,
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
            wiki.seat_name
        FROM political_territory_geometry geometry
        LEFT JOIN political_territory territory ON territory.id = geometry.territory_id
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        WHERE ' . implode(' AND ', $conditions) . '
        ORDER BY COALESCE(territory.sort_order, 0) ASC, COALESCE(territory.name, geometry.public_id) ASC, geometry.id ASC'
    );
    $statement->execute($params);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    $territories = avesmapsPoliticalFetchLayerTerritories($pdo, $yearBf);
    $parentIds = avesmapsPoliticalBuildEffectiveLayerParentIds($territories);

    return [
        'ok' => true,
        'type' => 'FeatureCollection',
        'year_bf' => $yearBf,
        'zoom' => $zoom,
        'features' => avesmapsPoliticalBuildRawEditorLayerFeatures($rows, $yearBf, $zoom, $territories, $parentIds),
    ];
}

function avesmapsPoliticalBuildRawEditorLayerFeatures(array $rows, int $yearBf, int $zoom, array $territories = [], array $parentIds = []): array {
    $features = [];
    $labelGroups = [];

    foreach ($rows as $row) {
        $sourceTerritoryId = (int) ($row['territory_id'] ?? 0);
        $displayTerritoryId = null;
        $featureRow = $row;

        if ($sourceTerritoryId > 0 && isset($territories[$sourceTerritoryId])) {
            $displayTerritoryId = avesmapsPoliticalResolveLayerDisplayTerritoryId(
                $sourceTerritoryId,
                $territories,
                $parentIds,
                $zoom
            ) ?? $sourceTerritoryId;

            if (
                $displayTerritoryId !== null
                && isset($territories[$displayTerritoryId])
                && $displayTerritoryId !== $sourceTerritoryId
            ) {
                $featureRow = avesmapsPoliticalBuildAggregateLayerRow(
                    $territories[$displayTerritoryId],
                    $row,
                    $territories[$sourceTerritoryId]
                );
            }
        }

        $feature = avesmapsPoliticalLayerRowToFeature($featureRow, $yearBf, $zoom);

        $labelKey = (string) ($featureRow['territory_public_id'] ?? $row['geometry_public_id'] ?? count($features));

        if ($displayTerritoryId !== null && isset($territories[$displayTerritoryId])) {
            $displayTerritory = $territories[$displayTerritoryId];

            $customLabelName = trim((string) (
                $feature['properties']['custom_display_name']
                ?? $feature['properties']['display_name']
                ?? $feature['properties']['name']
                ?? ''
            ));

            $fallbackLabelName = trim((string) ($displayTerritory['short_name'] ?? ''))
                ?: trim((string) ($displayTerritory['name'] ?? ''));

            $labelName = $customLabelName !== ''
                ? $customLabelName
                : $fallbackLabelName;

            $feature['properties']['fill'] = (string) ($displayTerritory['color'] ?? $feature['properties']['fill'] ?? '#888888');
            $feature['properties']['stroke'] = (string) ($displayTerritory['color'] ?? $feature['properties']['stroke'] ?? '#888888');
            $feature['properties']['fillOpacity'] = (float) ($displayTerritory['opacity'] ?? $feature['properties']['fillOpacity'] ?? 0.33);

            $feature['properties']['label_name'] = $labelName;
            $feature['properties']['label_display_name'] = $labelName;
            $feature['properties']['label_territory_public_id'] = (string) ($displayTerritory['territory_public_id'] ?? '');
            $feature['properties']['label_coat_of_arms_url'] = (string) ($feature['properties']['coat_of_arms_url'] ?? $displayTerritory['coat_of_arms_url'] ?? '');

            $labelKey = (string) ($displayTerritory['territory_public_id'] ?? $displayTerritoryId);
        }

        $featureIndex = count($features);
        $features[] = $feature;

        $labelGroups[$labelKey]['feature_indexes'][] = $featureIndex;
        $labelGroups[$labelKey]['geometry'] = isset($labelGroups[$labelKey]['geometry'])
            ? avesmapsPoliticalMergeLayerGeometries($labelGroups[$labelKey]['geometry'], $feature['geometry'] ?? null)
            : ($feature['geometry'] ?? null);
    }

    foreach ($labelGroups as $group) {
        $featureIndexes = (array) ($group['feature_indexes'] ?? []);
        if ($featureIndexes === []) {
            continue;
        }

        $labelCenter = avesmapsPoliticalComputeGeometryLabelCenter($group['geometry'] ?? null);

        foreach ($featureIndexes as $indexOffset => $featureIndex) {
            if (!isset($features[$featureIndex])) {
                continue;
            }

            $features[$featureIndex]['properties']['show_region_label'] = $indexOffset === 0;

            if ($labelCenter !== null) {
                $features[$featureIndex]['properties']['label_lng'] = $labelCenter['lng'];
                $features[$featureIndex]['properties']['label_lat'] = $labelCenter['lat'];
            }
        }
    }

    return $features;
}

function avesmapsPoliticalLayerRowMatchesOwnZoom(array $row, int $zoom): bool {
    $minZoom = avesmapsPoliticalNullableInt($row['geometry_min_zoom'] ?? $row['territory_min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalNullableInt($row['geometry_max_zoom'] ?? $row['territory_max_zoom'] ?? null);

    return ($minZoom === null || $minZoom <= $zoom)
        && ($maxZoom === null || $maxZoom >= $zoom);
}

function avesmapsPoliticalFetchLayerTerritories(PDO $pdo, int $yearBf): array {
    $normalizedTerritoryValidToSql = avesmapsPoliticalNormalizedValidToSql('territory.valid_to_bf', 'wiki.dissolved_type', 'wiki.dissolved_text');
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
            wiki.seat_name
        FROM political_territory territory
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        WHERE territory.is_active = 1
            AND territory.continent = :continent
            AND (territory.valid_from_bf IS NULL OR territory.valid_from_bf <= :year_bf_start)
            AND (' . $normalizedTerritoryValidToSql . ' IS NULL OR ' . $normalizedTerritoryValidToSql . ' >= :year_bf_end)
        ORDER BY territory.sort_order ASC, territory.name ASC'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'year_bf_start' => $yearBf,
        'year_bf_end' => $yearBf,
    ]);

    $territories = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territories[(int) $row['territory_id']] = $row;
    }

    return $territories;
}

function avesmapsPoliticalAppendLegacyFallbackLayerRows(PDO $pdo, array $rows, array $territories, int $zoom): array {
    $territoryIdsWithGeometry = [];
    foreach ($rows as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        if ($territoryId > 0) {
            $territoryIdsWithGeometry[$territoryId] = true;
        }
    }

    foreach ($territories as $territoryId => $territory) {
        $territoryId = (int) $territoryId;
        if ($territoryId < 1 || isset($territoryIdsWithGeometry[$territoryId])) {
            continue;
        }

        $candidateRecord = [
            'name' => (string) ($territory['wiki_name'] ?? $territory['name'] ?? ''),
            'geographic' => '',
            'political' => (string) ($territory['affiliation_raw'] ?? ''),
            'affiliation_root' => (string) ($territory['affiliation_root'] ?? ''),
            'affiliation_path_json' => avesmapsPoliticalDecodeJson($territory['affiliation_path_json'] ?? null),
        ];
        $legacyFeatures = avesmapsPoliticalFindLegacyRegionFeaturesForWikiRecord($pdo, $candidateRecord);
        foreach ($legacyFeatures as $index => $legacyFeature) {
            $rows[] = avesmapsPoliticalBuildLegacyFallbackLayerRow($territory, $legacyFeature, $index);
        }
    }

    return $rows;
}

function avesmapsPoliticalBuildLegacyFallbackLayerRow(array $territory, array $legacyFeature, int $index): array {
    $style = avesmapsPoliticalBuildSeedGeometryStyle($legacyFeature, (string) ($territory['color'] ?? '#888888'));

    return [
        ...$territory,
        'territory_id' => (int) ($territory['territory_id'] ?? 0),
        'territory_public_id' => (string) ($territory['territory_public_id'] ?? ''),
        'geometry_public_id' => sprintf(
            'legacy-fallback:%s:%d:%s',
            (string) ($territory['territory_public_id'] ?? ''),
            $index,
            (string) ($legacyFeature['public_id'] ?? avesmapsPoliticalSlug((string) ($legacyFeature['name'] ?? '')))
        ),
        'geometry_id' => 0,
        'geometry_geojson' => $legacyFeature['geometry_json'] ?? null,
        'geometry_valid_from_bf' => null,
        'geometry_valid_to_bf' => null,
        'geometry_min_zoom' => null,
        'geometry_max_zoom' => null,
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'updated_at' => '',
    ];
}

function avesmapsPoliticalBuildEffectiveLayerParentIds(array $territories): array {
    $parentIds = [];
    foreach ($territories as $territoryId => $territory) {
        $storedParentId = (int) ($territory['parent_id'] ?? 0);
        if ($storedParentId > 0 && isset($territories[$storedParentId]) && $storedParentId !== (int) $territoryId) {
            $parentIds[(int) $territoryId] = $storedParentId;
        }
    }

    return $parentIds;
}

function avesmapsPoliticalLayerTerritoryAliases(array $territory): array {
    $aliases = avesmapsPoliticalExpandTerritoryAliases([
        (string) ($territory['name'] ?? ''),
        (string) ($territory['short_name'] ?? ''),
        (string) ($territory['wiki_name'] ?? ''),
    ]);
    $name = mb_strtolower(implode(' ', $aliases));
    if (str_contains($name, 'heiliges neues kaiserreich vom greifenthron')) {
        $aliases[] = 'Mittelreich';
    }

    return array_values(array_filter(array_map('trim', $aliases)));
}

function avesmapsPoliticalInferLayerParentName(array $territory): string {
    $path = avesmapsPoliticalDecodeJson($territory['affiliation_path_json'] ?? null);
    if (is_array($path) && $path !== []) {
        $parentName = (string) end($path);
        if (avesmapsPoliticalSlug($parentName) === avesmapsPoliticalSlug((string) ($territory['name'] ?? ''))) {
            $parentName = count($path) > 1 ? (string) $path[count($path) - 2] : '';
        }
        if (trim($parentName) !== '') {
            return trim($parentName);
        }
    }

    $affiliation = trim((string) ($territory['affiliation_raw'] ?? ''));
    if ($affiliation === '' || in_array(mb_strtolower($affiliation), ['unabhaengig', 'unabhängig', 'umstritten', 'ungeklaert', 'ungeklärt'], true)) {
        return '';
    }

    $parts = preg_split('/\s*[:;]\s*/u', $affiliation) ?: [];
    return trim((string) end($parts));
}

function avesmapsPoliticalBuildResolvedLayerFeatures(array $geometryRows, array $territories, array $parentIds, int $yearBf, int $zoom): array {
    $featuresByTerritory = [];
    foreach ($geometryRows as $geometryRow) {
        $sourceTerritoryId = (int) $geometryRow['territory_id'];
        if (!isset($territories[$sourceTerritoryId])) {
            continue;
        }

        $displayTerritoryId = avesmapsPoliticalResolveLayerDisplayTerritoryId($sourceTerritoryId, $territories, $parentIds, $zoom);
        if ($displayTerritoryId === null || !isset($territories[$displayTerritoryId])) {
            continue;
        }

        $displayRow = $displayTerritoryId === $sourceTerritoryId
            ? $geometryRow
            : avesmapsPoliticalBuildAggregateLayerRow($territories[$displayTerritoryId], $geometryRow, $territories[$sourceTerritoryId]);
        $feature = avesmapsPoliticalLayerRowToFeature($displayRow, $yearBf, $zoom);
        $featureKey = (string) $displayRow['territory_public_id'];
        if (!isset($featuresByTerritory[$featureKey])) {
            $featuresByTerritory[$featureKey] = $feature;
            continue;
        }

        $featuresByTerritory[$featureKey]['geometry'] = avesmapsPoliticalMergeLayerGeometries(
            $featuresByTerritory[$featureKey]['geometry'],
            $feature['geometry']
        );
    }

    foreach ($featuresByTerritory as &$feature) {
        $labelCenter = avesmapsPoliticalComputeGeometryLabelCenter($feature['geometry'] ?? null);
        if ($labelCenter !== null) {
            $feature['properties']['label_lng'] = $labelCenter['lng'];
            $feature['properties']['label_lat'] = $labelCenter['lat'];
        }
    }
    unset($feature);

    return array_values($featuresByTerritory);
}

function avesmapsPoliticalResolveLayerDisplayTerritoryId(int $sourceTerritoryId, array $territories, array $parentIds, int $zoom): ?int {
    $chain = [];
    $territoryId = $sourceTerritoryId;
    $visited = [];

    while ($territoryId > 0 && isset($territories[$territoryId]) && !isset($visited[$territoryId])) {
        $visited[$territoryId] = true;
        array_unshift($chain, $territoryId);
        $territoryId = (int) ($parentIds[$territoryId] ?? 0);
    }

    if ($chain === []) {
        return null;
    }

    $bestTerritoryId = null;
    $bestRangeWidth = null;
    $bestDepth = null;

    foreach ($chain as $depth => $candidateTerritoryId) {
        $territory = $territories[$candidateTerritoryId] ?? null;
        if (!$territory || !avesmapsPoliticalLayerTerritoryMatchesZoom($territory, $zoom)) {
            continue;
        }

        $minZoom = avesmapsPoliticalNullableInt($territory['territory_min_zoom'] ?? null);
        $maxZoom = avesmapsPoliticalNullableInt($territory['territory_max_zoom'] ?? null);

        $rangeWidth = ($maxZoom ?? 99) - ($minZoom ?? 0);

        if (
            $bestTerritoryId === null
            || $rangeWidth < $bestRangeWidth
            || ($rangeWidth === $bestRangeWidth && $depth > $bestDepth)
        ) {
            $bestTerritoryId = $candidateTerritoryId;
            $bestRangeWidth = $rangeWidth;
            $bestDepth = $depth;
        }
    }

    return $bestTerritoryId;
}

function avesmapsPoliticalLayerTerritoryMatchesZoom(array $territory, int $zoom): bool {
    $minZoom = avesmapsPoliticalNullableInt($territory['territory_min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalNullableInt($territory['territory_max_zoom'] ?? null);

    return ($minZoom === null || $minZoom <= $zoom)
        && ($maxZoom === null || $maxZoom >= $zoom);
}

function avesmapsPoliticalBuildAggregateLayerRow(array $displayTerritory, array $geometryRow, array $sourceTerritory): array {
    return array_merge($displayTerritory, [
        'geometry_public_id' => (string) $geometryRow['geometry_public_id'],
        'geometry_id' => (int) $geometryRow['geometry_id'],
        'geometry_geojson' => $geometryRow['geometry_geojson'],
        'geometry_valid_from_bf' => $geometryRow['geometry_valid_from_bf'],
        'geometry_valid_to_bf' => $geometryRow['geometry_valid_to_bf'],
        'geometry_min_zoom' => null,
        'geometry_max_zoom' => null,
        'style_json' => null,
        'geometry_style_json' => $geometryRow['style_json'] ?? null,
        'updated_at' => (string) ($geometryRow['updated_at'] ?? ''),
        'aggregate_source_territory_id' => (int) $sourceTerritory['territory_id'],
        'aggregate_source_territory_public_id' => (string) $sourceTerritory['territory_public_id'],
        'aggregate_source_territory_name' => (string) $sourceTerritory['name'],
    ]);
}

function avesmapsPoliticalReadAssignmentDisplaysFromStyle(array $style): array {
    $rawDisplays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? [];
    if (!is_array($rawDisplays)) {
        return [];
    }

    $displays = [];
    foreach ($rawDisplays as $rawDisplay) {
        if (!is_array($rawDisplay)) {
            continue;
        }

        $territoryPublicId = trim((string) (
            $rawDisplay['territoryPublicId']
            ?? $rawDisplay['territory_public_id']
            ?? ''
        ));

        $nodeKey = trim((string) (
            $rawDisplay['nodeKey']
            ?? $rawDisplay['node_key']
            ?? ''
        ));

        $originalName = trim((string) (
            $rawDisplay['originalName']
            ?? $rawDisplay['original_name']
            ?? $rawDisplay['name']
            ?? ''
        ));

        $displayName = trim((string) (
            $rawDisplay['displayName']
            ?? $rawDisplay['display_name']
            ?? ''
        ));

        if ($territoryPublicId === '' && $nodeKey === '' && $originalName === '' && $displayName === '') {
            continue;
        }

        $opacity = $rawDisplay['opacity'] ?? null;
        $displays[] = [
            'territoryPublicId' => $territoryPublicId,
            'territory_public_id' => $territoryPublicId,
            'nodeKey' => $nodeKey,
            'node_key' => $nodeKey,
            'originalName' => $originalName,
            'original_name' => $originalName,
            'displayName' => $displayName,
            'display_name' => $displayName,
            'coatOfArmsUrl' => trim((string) (
                $rawDisplay['coatOfArmsUrl']
                ?? $rawDisplay['coat_of_arms_url']
                ?? ''
            )),
            'color' => trim((string) ($rawDisplay['color'] ?? '')),
            'opacity' => is_numeric($opacity) ? (float) $opacity : null,
            'zoomMin' => avesmapsPoliticalNullableInt($rawDisplay['zoomMin'] ?? $rawDisplay['zoom_min'] ?? null),
            'zoomMax' => avesmapsPoliticalNullableInt($rawDisplay['zoomMax'] ?? $rawDisplay['zoom_max'] ?? null),
        ];
    }

    return $displays;
}

function avesmapsPoliticalFindAssignmentDisplayForTerritory(array $style, string $territoryPublicId, string $nodeKey = ''): ?array {
    $territoryPublicId = trim($territoryPublicId);
    $nodeKey = trim($nodeKey);

    foreach (avesmapsPoliticalReadAssignmentDisplaysFromStyle($style) as $display) {
        $displayTerritoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        $displayNodeKey = trim((string) ($display['nodeKey'] ?? $display['node_key'] ?? ''));

        if ($territoryPublicId !== '' && $displayTerritoryPublicId === $territoryPublicId) {
            return $display;
        }

        if ($nodeKey !== '' && $displayNodeKey === $nodeKey) {
            return $display;
        }
    }

    return null;
}

function avesmapsPoliticalResolveAssignmentDisplayName(?array $display, string $fallbackName): string {
    if ($display === null) {
        return trim($fallbackName);
    }

    $displayName = trim((string) ($display['displayName'] ?? $display['display_name'] ?? ''));
    if ($displayName !== '') {
        return $displayName;
    }

    $originalName = trim((string) ($display['originalName'] ?? $display['original_name'] ?? ''));
    if ($originalName !== '') {
        return $originalName;
    }

    return trim($fallbackName);
}

function avesmapsPoliticalBuildStoredAssignmentDisplay(array $territory, array $display, int $depth): array {
    $originalName = trim((string) ($territory['wiki_name'] ?? ''))
        ?: trim((string) ($territory['name'] ?? ''));

    $displayName = trim((string) ($display['displayName'] ?? $display['name'] ?? ''));

    if ($displayName === $originalName) {
        $displayName = '';
    }

    return [
        'territoryPublicId' => (string) ($territory['public_id'] ?? ''),
        'territoryId' => (int) ($territory['id'] ?? 0),
        'nodeKey' => trim((string) (
            $display['nodeKey']
            ?? $display['nodeId']
            ?? $territory['wiki_key']
            ?? $territory['slug']
            ?? ''
        )),
        'originalName' => $originalName,
        'displayName' => $displayName,
        'coatOfArmsUrl' => trim((string) ($display['coatOfArmsUrl'] ?? $territory['coat_of_arms_url'] ?? '')),
        'zoomMin' => avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? $territory['min_zoom'] ?? null),
        'zoomMax' => avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? $territory['max_zoom'] ?? null),
        'color' => avesmapsPoliticalReadHexColor($display['color'] ?? $territory['color'] ?? '#888888'),
        'opacity' => avesmapsPoliticalReadOpacity($display['opacity'] ?? $territory['opacity'] ?? 0.33),
        'startYear' => avesmapsPoliticalReadOptionalInt($display['startYear'] ?? $territory['valid_from_bf'] ?? null),
        'endYear' => !empty($display['existsUntilToday'])
            ? null
            : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territory['valid_to_bf'] ?? null),
        'existsUntilToday' => !empty($display['existsUntilToday']),
        'depth' => $depth,
    ];
}

function avesmapsPoliticalLayerRowToFeature(array $row, int $yearBf, int $zoom): array {
    $style = avesmapsPoliticalDecodeJson($row['style_json'] ?? null);
    $geometryStyle = avesmapsPoliticalDecodeJson($row['geometry_style_json'] ?? null);
    $territoryPublicId = trim((string) ($row['territory_public_id'] ?? ''));
    $nodeKey = trim((string) ($row['slug'] ?? ''));

    $territoryName = trim((string) ($row['name'] ?? ''));
    $isAggregate = isset($row['aggregate_source_territory_id']);

    $assignmentDisplay = avesmapsPoliticalFindAssignmentDisplayForTerritory($style, $territoryPublicId, $nodeKey)
        ?? avesmapsPoliticalFindAssignmentDisplayForTerritory($geometryStyle, $territoryPublicId, $nodeKey);

    $customName = $assignmentDisplay !== null
        ? avesmapsPoliticalResolveAssignmentDisplayName($assignmentDisplay, $territoryName)
        : ($isAggregate ? '' : trim((string) ($style['displayName'] ?? $style['name'] ?? '')));

    $visibleName = $customName !== ''
        ? $customName
        : ($territoryName !== '' ? $territoryName : 'Freie Geometrie');

    $displayCoatOfArmsUrl = trim((string) ($assignmentDisplay['coatOfArmsUrl'] ?? $assignmentDisplay['coat_of_arms_url'] ?? ''));
    $visibleCoatOfArmsUrl = (string) (
        $displayCoatOfArmsUrl
        ?: (
            $geometryStyle['coatOfArmsUrl']
            ?? $geometryStyle['coat_of_arms_url']
            ?? $style['coatOfArmsUrl']
            ?? $style['coat_of_arms_url']
            ?? $row['coat_of_arms_url']
            ?? ''
        )
    );

    $displayColor = trim((string) ($assignmentDisplay['color'] ?? ''));
    $displayOpacity = $assignmentDisplay['opacity'] ?? null;

    $resolvedType = trim((string) ($row['type'] ?? '')) ?: 'Herrschaftsgebiet';

    $properties = [
        'type' => 'region',
        'source' => 'political_territory',
        'public_id' => (string) $row['geometry_public_id'],
        'geometry_public_id' => (string) $row['geometry_public_id'],
        'territory_public_id' => $territoryPublicId,
        'territory_id' => (int) $row['territory_id'],
        'name' => $visibleName,
        'display_name' => $visibleName,
        'short_name' => trim((string) ($row['short_name'] ?? '')),
        'label_name' => $visibleName,
        'label_display_name' => $visibleName,
        'label_coat_of_arms_url' => $visibleCoatOfArmsUrl,
        'feature_type' => 'political_territory',
        'feature_subtype' => $resolvedType,
        'territory_type' => trim((string) ($row['type'] ?? '')),
        'status' => (string) ($row['status'] ?? ''),
        'fill' => (string) ($displayColor ?: ($style['fill'] ?? $geometryStyle['fill'] ?? $row['color'] ?? '#888888')),
        'stroke' => (string) ($displayColor ?: ($style['stroke'] ?? $geometryStyle['stroke'] ?? $row['color'] ?? '#888888')),
        'fillOpacity' => (float) ($displayOpacity ?? $style['fillOpacity'] ?? $geometryStyle['fillOpacity'] ?? $row['opacity'] ?? 0.33),
        'coat_of_arms_url' => $visibleCoatOfArmsUrl,
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'wiki_id' => isset($row['wiki_id']) ? (int) $row['wiki_id'] : null,
        'wiki_name' => (string) ($row['wiki_name'] ?? ''),
        'capital_name' => (string) ($row['capital_name'] ?? ''),
        'seat_name' => (string) ($row['seat_name'] ?? ''),
        'capital_place_id' => (int) ($row['capital_place_id'] ?? 0) ?: null,
        'seat_place_id' => (int) ($row['seat_place_id'] ?? 0) ?: null,
        'capital_place_public_id' => (string) ($row['capital_place_public_id'] ?? ''),
        'seat_place_public_id' => (string) ($row['seat_place_public_id'] ?? ''),
        'affiliation' => (string) ($row['affiliation_raw'] ?? ''),
        'affiliation_root' => (string) ($row['affiliation_root'] ?? ''),
        'affiliation_path' => avesmapsPoliticalDecodeJson($row['affiliation_path_json'] ?? null),
        'parent_public_id' => (string) ($row['parent_public_id'] ?? ''),
        'parent_name' => (string) ($row['parent_name'] ?? ''),
        'valid_from_bf' => avesmapsPoliticalNullableInt($row['geometry_valid_from_bf'] ?? $row['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNullableInt($row['geometry_valid_to_bf'] ?? $row['valid_to_bf'] ?? null),
        'valid_label' => (string) ($row['valid_label'] ?? ''),
        'founded_text' => (string) ($row['founded_text'] ?? ''),
        'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
        'min_zoom' => avesmapsPoliticalNullableInt($row['geometry_min_zoom'] ?? $row['territory_min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['geometry_max_zoom'] ?? $row['territory_max_zoom'] ?? null),
        'timeline_year_bf' => $yearBf,
        'render_zoom' => $zoom,
        'updated_at' => (string) ($row['updated_at'] ?? ''),
        'is_aggregate' => $isAggregate,
        'aggregate_source_territory_public_id' => (string) ($row['aggregate_source_territory_public_id'] ?? ''),
        'aggregate_source_territory_name' => (string) ($row['aggregate_source_territory_name'] ?? ''),
    ];

    $featureId = $isAggregate
        ? sprintf('%s:%s', (string) $row['territory_public_id'], (string) $row['geometry_public_id'])
        : (string) $row['geometry_public_id'];

    return [
        'type' => 'Feature',
        'id' => $featureId,
        'geometry' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
        'properties' => $properties,
    ];
}

function avesmapsPoliticalMergeLayerGeometries(?array $leftGeometry, ?array $rightGeometry): ?array {
    $polygons = [];
    foreach ([$leftGeometry, $rightGeometry] as $geometry) {
        if (!is_array($geometry)) {
            continue;
        }

        if (($geometry['type'] ?? '') === 'Polygon' && is_array($geometry['coordinates'] ?? null)) {
            $polygons[] = $geometry['coordinates'];
            continue;
        }

        if (($geometry['type'] ?? '') === 'MultiPolygon' && is_array($geometry['coordinates'] ?? null)) {
            foreach ($geometry['coordinates'] as $polygon) {
                if (is_array($polygon)) {
                    $polygons[] = $polygon;
                }
            }
        }
    }

    if ($polygons === []) {
        return null;
    }

    return count($polygons) === 1
        ? ['type' => 'Polygon', 'coordinates' => $polygons[0]]
        : ['type' => 'MultiPolygon', 'coordinates' => $polygons];
}

function avesmapsPoliticalComputeGeometryLabelCenter(?array $geometry): ?array {
    if (!is_array($geometry)) {
        return null;
    }

    $points = [];
    if (($geometry['type'] ?? '') === 'Polygon') {
        $points = avesmapsPoliticalCollectGeometryPoints($geometry['coordinates'] ?? null);
    } elseif (($geometry['type'] ?? '') === 'MultiPolygon') {
        foreach ((array) ($geometry['coordinates'] ?? []) as $polygon) {
            $points = array_merge($points, avesmapsPoliticalCollectGeometryPoints($polygon));
        }
    }

    if ($points === []) {
        return null;
    }

    $minLng = null;
    $maxLng = null;
    $minLat = null;
    $maxLat = null;
    foreach ($points as $point) {
        $lng = (float) ($point[0] ?? 0);
        $lat = (float) ($point[1] ?? 0);
        $minLng = $minLng === null ? $lng : min($minLng, $lng);
        $maxLng = $maxLng === null ? $lng : max($maxLng, $lng);
        $minLat = $minLat === null ? $lat : min($minLat, $lat);
        $maxLat = $maxLat === null ? $lat : max($maxLat, $lat);
    }

    if ($minLng === null || $maxLng === null || $minLat === null || $maxLat === null) {
        return null;
    }

    return [
        'lng' => ($minLng + $maxLng) / 2,
        'lat' => ($minLat + $maxLat) / 2,
    ];
}

function avesmapsPoliticalCollectGeometryPoints(mixed $polygon): array {
    $points = [];
    foreach ((array) $polygon as $ring) {
        if (!is_array($ring)) {
            continue;
        }

        foreach ($ring as $point) {
            if (!is_array($point) || count($point) < 2) {
                continue;
            }

            $points[] = [(float) $point[0], (float) $point[1]];
        }
    }

    return $points;
}

function avesmapsPoliticalListTerritories(PDO $pdo, array $query): array {
    $continent = avesmapsNormalizeSingleLine((string) ($query['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT), 120);
    $includeDiagnostics = filter_var($query['debug'] ?? false, FILTER_VALIDATE_BOOL);
    $conditions = [];
    $params = [];
    if ($continent !== '') {
        $conditions[] = 'territory.continent = :continent';
        $params['continent'] = $continent;
    }

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
        ' . ($conditions === [] ? '' : 'WHERE ' . implode(' AND ', $conditions)) . '
        ORDER BY territory.sort_order ASC, territory.name ASC'
    );
    $statement->execute($params);
    $territories = array_map(
        static fn(array $row): array => avesmapsPoliticalTerritoryRowToPublic($row),
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
    $diagnostics = [
        'territory_count' => count($territories),
    ];
    $warnings = [];

    try {
        $territories = avesmapsPoliticalApplyEffectiveParents($territories);
    } catch (Throwable $exception) {
        $warnings[] = 'effective_parent_resolution_failed';
        if ($includeDiagnostics) {
            $diagnostics['effective_parent_error'] = $exception->getMessage();
        }
    }

    $hierarchy = [];
    try {
        $hierarchy = avesmapsPoliticalBuildHierarchy($territories);
    } catch (Throwable $exception) {
        $warnings[] = 'hierarchy_build_failed';
        if ($includeDiagnostics) {
            $diagnostics['hierarchy_error'] = $exception->getMessage();
        }
    }

    $response = [
        'ok' => true,
        'territories' => $territories,
        'hierarchy' => $hierarchy,
    ];

    if ($warnings !== []) {
        $response['warnings'] = $warnings;
    }

    if ($includeDiagnostics) {
        $response['diagnostics'] = $diagnostics;
    }

    return $response;
}

function avesmapsPoliticalGetTerritory(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByRequest($pdo, $query);
    $wiki = $territory['wiki_id'] ? avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']) : null;
    $geometries = avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $territory['id']);
    $territoryPublic = avesmapsPoliticalResolveSingleEffectiveTerritory($pdo, avesmapsPoliticalTerritoryRowToPublic($territory));
    $assignmentChain = avesmapsPoliticalBuildAssignmentChain($pdo, $territory);

    return [
        'ok' => true,
        'territory' => $territoryPublic,
        'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
        'assignment_chain' => $assignmentChain,
    ];
}

function avesmapsPoliticalGetWikiReference(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByRequest($pdo, $query);
    if (empty($territory['wiki_id'])) {
        return [
            'ok' => true,
            'wiki' => null,
        ];
    }

    return [
        'ok' => true,
        'wiki' => avesmapsPoliticalWikiRowToPublic(avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id'])),
    ];
}

function avesmapsPoliticalListWikiReferences(PDO $pdo, array $query): array {
    $continent = avesmapsNormalizeSingleLine((string) ($query['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT), 120);
    $conditions = [];
    $params = [];
    if ($continent !== '') {
        $conditions[] = 'continent = :continent';
        $params['continent'] = $continent;
    }

    $statement = $pdo->prepare(
        'SELECT
            id,
            wiki_key,
            name,
            type,
            continent,
            affiliation_raw,
            affiliation_root,
            affiliation_path_json,
            status,
            capital_name,
            seat_name,
            ruler,
            founded_text,
            dissolved_text,
            wiki_url,
            coat_of_arms_url
        FROM political_territory_wiki
        ' . ($conditions === [] ? '' : 'WHERE ' . implode(' AND ', $conditions)) . '
        ORDER BY affiliation_root ASC, name ASC'
    );
    $statement->execute($params);

    return [
        'ok' => true,
        'wiki' => array_map(
            static fn(array $row): array => avesmapsPoliticalWikiReferenceRowToPublic($row),
            $statement->fetchAll(PDO::FETCH_ASSOC)
        ),
    ];
}

function avesmapsPoliticalReadHierarchy(PDO $pdo): array {
    $response = avesmapsPoliticalListTerritories($pdo, ['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);

    return [
        'ok' => true,
        'hierarchy' => $response['hierarchy'],
        'territories' => $response['territories'],
    ];
}

function avesmapsPoliticalReadGeometries(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByRequest($pdo, $query);
    $geometries = avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $territory['id']);
    $territoryPublic = avesmapsPoliticalResolveSingleEffectiveTerritory($pdo, avesmapsPoliticalTerritoryRowToPublic($territory));

    return [
        'ok' => true,
        'territory' => $territoryPublic,
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
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

function avesmapsPoliticalReadAudit(PDO $pdo, array $query): array {
    $yearBf = avesmapsPoliticalReadOptionalInt($query['year_bf'] ?? null) ?? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;
    $zoomFrom = avesmapsPoliticalReadOptionalZoom($query['zoom_from'] ?? null) ?? 0;
    $zoomTo = avesmapsPoliticalReadOptionalZoom($query['zoom_to'] ?? null) ?? 6;
    if ($zoomFrom > $zoomTo) {
        [$zoomFrom, $zoomTo] = [$zoomTo, $zoomFrom];
    }

    $territoriesResponse = avesmapsPoliticalListTerritories($pdo, ['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);
    $territories = $territoriesResponse['territories'];
    $territoriesById = [];
    foreach ($territories as $territory) {
        $territoriesById[(int) $territory['id']] = $territory;
    }

    $geometryCounts = avesmapsPoliticalFetchAuditGeometryCounts($pdo);
    $layerByZoom = [];
    for ($zoom = $zoomFrom; $zoom <= $zoomTo; $zoom++) {
        $layerByZoom[$zoom] = avesmapsPoliticalReadLayer($pdo, [
            'year_bf' => $yearBf,
            'zoom' => $zoom,
        ]);
    }

    $entries = [];
    foreach ($territories as $territory) {
        $territoryId = (int) $territory['id'];
        $geometryCount = (int) ($geometryCounts[$territoryId]['geometry_count'] ?? 0);
        $hasInferredParent = empty($territory['parent_id']) && !empty($territory['parent_public_id']);
        $visibleZooms = [];
        foreach ($layerByZoom as $zoom => $layer) {
            foreach ((array) ($layer['features'] ?? []) as $feature) {
                $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
                if (
                    (string) ($properties['territory_public_id'] ?? '') === (string) $territory['public_id']
                    || (string) ($properties['aggregate_source_territory_public_id'] ?? '') === (string) $territory['public_id']
                ) {
                    $visibleZooms[] = (int) $zoom;
                    break;
                }
            }
        }

        if ($geometryCount < 1 && $visibleZooms === [] && !$hasInferredParent) {
            continue;
        }

        $entries[] = [
            'territory' => $territory,
            'geometry_count' => $geometryCount,
            'geometry_sources' => $geometryCounts[$territoryId]['sources'] ?? [],
            'visible_zooms' => $visibleZooms,
            'stored_parent_missing' => empty($territory['parent_id']),
            'effective_parent_public_id' => (string) ($territory['parent_public_id'] ?? ''),
            'effective_parent_name' => (string) ($territory['parent_name'] ?? ''),
            'timeline_issue' => avesmapsPoliticalDetectTimelineIssue($territory),
        ];
    }

    usort(
        $entries,
        static function (array $left, array $right): int {
            $leftGeometry = (int) ($left['geometry_count'] ?? 0);
            $rightGeometry = (int) ($right['geometry_count'] ?? 0);
            if ($leftGeometry !== $rightGeometry) {
                return $rightGeometry <=> $leftGeometry;
            }

            return strcmp(
                (string) ($left['territory']['name'] ?? ''),
                (string) ($right['territory']['name'] ?? '')
            );
        }
    );

    $missingTerritoryEntries = avesmapsPoliticalBuildMissingTerritoryEntryAudit($pdo, $territories);

    return [
        'ok' => true,
        'summary' => avesmapsPoliticalReadDebugSummary($pdo),
        'year_bf' => $yearBf,
        'zoom_from' => $zoomFrom,
        'zoom_to' => $zoomTo,
        'entries' => $entries,
        'missing_territory_entry_count' => count($missingTerritoryEntries),
        'missing_territory_entries' => $missingTerritoryEntries,
    ];
}

function avesmapsPoliticalCreateTerritory(PDO $pdo, array $payload, array $user): array {
    $requestedName = avesmapsPoliticalReadRequiredName($payload['name'] ?? '', 'Der Name des Herrschaftsgebiets');
    $shortName = avesmapsNormalizeSingleLine((string) ($payload['short_name'] ?? ''), 160);
    $type = avesmapsPoliticalNormalizeParentheticalSpacing(avesmapsNormalizeSingleLine((string) ($payload['type'] ?? 'Herrschaftsgebiet'), 160));
    $parentId = avesmapsPoliticalReadOptionalTerritoryId($pdo, $payload['parent_public_id'] ?? null);
    $wikiId = avesmapsPoliticalReadOptionalWikiId($pdo, $payload['wiki_id'] ?? null);
    $color = avesmapsPoliticalReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsPoliticalReadOpacity($payload['opacity'] ?? 0.33);
    $validFrom = avesmapsPoliticalReadOptionalInt($payload['valid_from_bf'] ?? null);
    $validTo = avesmapsPoliticalReadOpenEndedValidTo($payload);
    $minZoom = avesmapsPoliticalReadOptionalZoom($payload['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($payload['max_zoom'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);
    $wikiUrl = avesmapsPoliticalReadOptionalUrl($payload['wiki_url'] ?? '', 'Der Wiki-Aventurica-Link');
    $coatOfArmsUrl = avesmapsPoliticalReadOptionalUrl($payload['coat_of_arms_url'] ?? '', 'Der Wappen-Link');
    if ($coatOfArmsUrl !== '' && !avesmapsPoliticalIsLikelyCoatOfArmsUrl($coatOfArmsUrl)) {
        $coatOfArmsUrl = '';
    }
    $geometry = isset($payload['geometry_geojson']) ? avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson']) : null;

    $pdo->beginTransaction();
    try {
        $publicId = avesmapsPoliticalUuidV4();
        $name = avesmapsPoliticalUniqueName($pdo, $requestedName);
        $slug = avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug((string) ($payload['slug'] ?? $name)));
        $sortOrder = avesmapsPoliticalNextSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO political_territory (
                public_id, wiki_id, slug, name, short_name, type, parent_id, continent, status, color,
                opacity, coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, valid_label,
                min_zoom, max_zoom, is_active, editor_notes, sort_order
            ) VALUES (
                :public_id, :wiki_id, :slug, :name, :short_name, :type, :parent_id, :continent, :status, :color,
                :opacity, :coat_of_arms_url, :wiki_url, :valid_from_bf, :valid_to_bf, :valid_label,
                :min_zoom, :max_zoom, :is_active, :editor_notes, :sort_order
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'wiki_id' => $wikiId,
            'slug' => $slug,
            'name' => $name,
            'short_name' => avesmapsPoliticalNullableString($shortName),
            'type' => avesmapsPoliticalNullableString($type),
            'parent_id' => $parentId,
            'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'status' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 255)),
            'color' => $color,
            'opacity' => $opacity,
            'coat_of_arms_url' => avesmapsPoliticalNullableString($coatOfArmsUrl),
            'wiki_url' => avesmapsPoliticalNullableString($wikiUrl),
            'valid_from_bf' => $validFrom,
            'valid_to_bf' => $validTo,
            'valid_label' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['valid_label'] ?? ''), 500)),
            'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom,
            'is_active' => avesmapsPoliticalReadBoolean($payload['is_active'] ?? true) ? 1 : 0,
            'editor_notes' => avesmapsPoliticalNullableString(avesmapsNormalizeMultiline((string) ($payload['editor_notes'] ?? ''), 3000)),
            'sort_order' => $sortOrder,
        ]);
        $territoryId = (int) $pdo->lastInsertId();
        if ($geometry !== null) {
            avesmapsPoliticalInsertGeometry($pdo, $territoryId, $geometry, $payload, $user);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return avesmapsPoliticalResponseForTerritory($pdo, $publicId);
}

function avesmapsPoliticalUpdateTerritory(PDO $pdo, array $payload, array $user): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? $payload['public_id'] ?? ''));
    $name = avesmapsPoliticalReadRequiredName($payload['name'] ?? $territory['name'], 'Der Name des Herrschaftsgebiets');
    $parentId = avesmapsPoliticalReadOptionalTerritoryId($pdo, $payload['parent_public_id'] ?? null);
    $wikiId = avesmapsPoliticalReadOptionalWikiId($pdo, $payload['wiki_id'] ?? $territory['wiki_id'] ?? null);
    if ($parentId === (int) $territory['id']) {
        throw new InvalidArgumentException('Ein Herrschaftsgebiet kann nicht sein eigener Parent sein.');
    }
    $minZoom = avesmapsPoliticalReadOptionalZoom($payload['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($payload['max_zoom'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);
    $coatOfArmsUrl = avesmapsPoliticalReadOptionalUrl($payload['coat_of_arms_url'] ?? $territory['coat_of_arms_url'] ?? '', 'Der Wappen-Link');
    if ($coatOfArmsUrl !== '' && !avesmapsPoliticalIsLikelyCoatOfArmsUrl($coatOfArmsUrl)) {
        $coatOfArmsUrl = '';
    }
    $color = avesmapsPoliticalReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsPoliticalReadOpacity($payload['opacity'] ?? 0.33);

    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET name = :name,
            wiki_id = :wiki_id,
            short_name = :short_name,
            type = :type,
            parent_id = :parent_id,
            status = :status,
            color = :color,
            opacity = :opacity,
            coat_of_arms_url = :coat_of_arms_url,
            wiki_url = :wiki_url,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            valid_label = :valid_label,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            is_active = :is_active,
            editor_notes = :editor_notes
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $territory['id'],
        'name' => $name,
        'wiki_id' => $wikiId,
        'short_name' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['short_name'] ?? ''), 160)),
        'type' => avesmapsPoliticalNullableString(avesmapsPoliticalNormalizeParentheticalSpacing(avesmapsNormalizeSingleLine((string) ($payload['type'] ?? ''), 160))),
        'parent_id' => $parentId,
        'status' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 255)),
        'color' => $color,
        'opacity' => $opacity,
        'coat_of_arms_url' => avesmapsPoliticalNullableString($coatOfArmsUrl),
        'wiki_url' => avesmapsPoliticalNullableString(avesmapsPoliticalReadOptionalUrl($payload['wiki_url'] ?? '', 'Der Wiki-Aventurica-Link')),
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($payload['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadOpenEndedValidTo($payload),
        'valid_label' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['valid_label'] ?? ''), 500)),
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'is_active' => avesmapsPoliticalReadBoolean($payload['is_active'] ?? true) ? 1 : 0,
        'editor_notes' => avesmapsPoliticalNullableString(avesmapsNormalizeMultiline((string) ($payload['editor_notes'] ?? ''), 3000)),
    ]);
    avesmapsPoliticalSyncTerritoryGeometryStyle($pdo, (int) $territory['id'], $color, $opacity);
    avesmapsPoliticalClearTerritoryGeometryZoomOverrides($pdo, (int) $territory['id']);

    return avesmapsPoliticalResponseForTerritory($pdo, (string) $territory['public_id']);
}

function avesmapsPoliticalEnsureWikiTerritoryChain(PDO $pdo, array $payload, array $user): array {
    $wikiPublicIds = $payload['wiki_public_ids'] ?? null;
    if (!is_array($wikiPublicIds) || $wikiPublicIds === []) {
        throw new InvalidArgumentException('Die Wiki-Hierarchie fehlt.');
    }

    $chain = [];
    $parentId = null;
    $chainLength = count($wikiPublicIds);
    $wikiNodes = is_array($payload['wiki_nodes'] ?? null) ? array_values($payload['wiki_nodes']) : [];
    $pdo->beginTransaction();
    try {
        foreach ($wikiPublicIds as $index => $wikiPublicId) {
            $wikiKey = avesmapsPoliticalReadWikiTreeKey($wikiPublicId);
            $node = is_array($wikiNodes[$index] ?? null) ? $wikiNodes[$index] : [];
            $wiki = null;
            try {
                $wiki = avesmapsPoliticalFetchWikiByKey($pdo, $wikiKey);
            } catch (InvalidArgumentException) {
                $wiki = null;
            }

            if ($wiki !== null) {
                $slug = avesmapsPoliticalSlug((string) ($wiki['name'] ?? $wikiKey));
                $territory = avesmapsPoliticalFindTerritoryByWikiOrSlug($pdo, (int) $wiki['id'], $slug);
                if (!$territory) {
                    $created = avesmapsPoliticalCreateTerritoryFromWiki($pdo, [
                        ...$wiki,
                        'slug' => $slug,
                    ], $user);
                    $territory = avesmapsPoliticalFetchTerritoryById($pdo, (int) $created['id']);
                } else {
                    avesmapsPoliticalLinkTerritoryToWiki($pdo, (int) $territory['id'], (int) $wiki['id']);
                }
            } else {
                $territory = avesmapsPoliticalEnsureSyntheticTreeTerritory($pdo, $node, $wikiKey);
            }

            if ($parentId !== null && $parentId !== (int) $territory['id']) {
                $statement = $pdo->prepare('UPDATE political_territory SET parent_id = :parent_id WHERE id = :id');
                $statement->execute([
                    'id' => (int) $territory['id'],
                    'parent_id' => $parentId,
                ]);
                $territory['parent_id'] = $parentId;
            }

            $zoomRange = avesmapsPoliticalDefaultAssignmentZoomRange($chainLength, $index);
            avesmapsPoliticalUpdateTerritoryZoomRange($pdo, (int) $territory['id'], $zoomRange['min'], $zoomRange['max']);

            $chain[] = [
                'territory' => avesmapsPoliticalTerritoryRowToPublic(avesmapsPoliticalFetchTerritoryById($pdo, (int) $territory['id'])),
                'wiki' => $wiki !== null ? avesmapsPoliticalWikiRowToPublic($wiki) : $node,
                'wiki_public_id' => (string) $wikiPublicId,
            ];
            $parentId = (int) $territory['id'];
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'chain' => $chain,
        'selected' => $chain[count($chain) - 1] ?? null,
    ];
}

function avesmapsPoliticalDefaultAssignmentZoomRange(int $chainLength, int $index): array {
    if ($chainLength <= 1) {
        return ['min' => 0, 'max' => 6];
    }

    if ($chainLength === 2) {
        return $index === 0
            ? ['min' => 0, 'max' => 2]
            : ['min' => 3, 'max' => 6];
    }

    if ($chainLength === 3) {
        return match ($index) {
            0 => ['min' => 0, 'max' => 2],
            1 => ['min' => 3, 'max' => 4],
            default => ['min' => 5, 'max' => 6],
        };
    }

    if ($index === 0) {
        return ['min' => 0, 'max' => 2];
    }

    if ($index === 1) {
        return ['min' => 3, 'max' => 4];
    }

    if ($index >= $chainLength - 1) {
        return ['min' => 6, 'max' => 6];
    }

    return ['min' => 5, 'max' => 5];
}

function avesmapsPoliticalUpdateTerritoryZoomRange(PDO $pdo, int $territoryId, int $minZoom, int $maxZoom): void {
    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET min_zoom = :min_zoom,
            max_zoom = :max_zoom
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $territoryId,
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
    ]);
    avesmapsPoliticalClearTerritoryGeometryZoomOverrides($pdo, $territoryId);
}

function avesmapsPoliticalClearTerritoryGeometryZoomOverrides(PDO $pdo, int $territoryId): void {
    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET min_zoom = NULL,
            max_zoom = NULL
        WHERE territory_id = :territory_id'
    );
    $statement->execute(['territory_id' => $territoryId]);
}

function avesmapsPoliticalReadWikiTreeKey(mixed $value): string {
    $text = avesmapsNormalizeSingleLine((string) $value, 255);
    if ($text === '') {
        throw new InvalidArgumentException('Der Wiki-Knoten ist ungueltig.');
    }

    return $text;
}

function avesmapsPoliticalFetchWikiByKey(PDO $pdo, string $wikiKey): array {
    $slug = str_starts_with($wikiKey, 'wiki:') || str_starts_with($wikiKey, 'name:')
        ? substr($wikiKey, 5)
        : $wikiKey;
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_wiki
        WHERE wiki_key = :wiki_key
            OR wiki_key = :wiki_slug
            OR wiki_key = :name_key
        ORDER BY wiki_key = :wiki_key_order DESC, id ASC
        LIMIT 1'
    );
    $statement->execute([
        'wiki_key' => $wikiKey,
        'wiki_key_order' => $wikiKey,
        'wiki_slug' => $slug,
        'name_key' => 'name:' . $slug,
    ]);
    $wiki = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$wiki) {
        throw new InvalidArgumentException('Der Wiki-Knoten wurde in den synchronisierten Referenzdaten nicht gefunden.');
    }

    return $wiki;
}

function avesmapsPoliticalEnsureSyntheticTreeTerritory(PDO $pdo, array $node, string $wikiKey): array {
    $name = avesmapsPoliticalReadRequiredName($node['name'] ?? $wikiKey, 'Der Name des Herrschaftsgebiets');
    $slug = avesmapsPoliticalSlug($name);
    $territory = avesmapsPoliticalFindTerritoryBySlug($pdo, $slug);
    if ($territory) {
        return $territory;
    }

    $publicId = avesmapsPoliticalUuidV4();
    $sortOrder = avesmapsPoliticalNextSortOrder($pdo);
    $statement = $pdo->prepare(
        'INSERT INTO political_territory (
            public_id, wiki_id, slug, name, short_name, type, continent, status, color,
            opacity, coat_of_arms_url, wiki_url, valid_label, min_zoom, max_zoom,
            is_active, editor_notes, sort_order
        ) VALUES (
            :public_id, NULL, :slug, :name, NULL, :type, :continent, :status, :color,
            :opacity, :coat_of_arms_url, :wiki_url, :valid_label, NULL, NULL,
            1, :editor_notes, :sort_order
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'slug' => avesmapsPoliticalUniqueSlug($pdo, $slug),
        'name' => $name,
        'type' => avesmapsPoliticalNullableString(avesmapsPoliticalNormalizeParentheticalSpacing(avesmapsNormalizeSingleLine((string) ($node['type'] ?? 'Herrschaftsgebiet'), 160))),
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'status' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($node['status'] ?? ''), 255)),
        'color' => avesmapsPoliticalColorFromText($name),
        'opacity' => 0.33,
        'coat_of_arms_url' => avesmapsPoliticalNullableString(avesmapsPoliticalReadOptionalUrl($node['coat_of_arms_url'] ?? '', 'Der Wappen-Link')),
        'wiki_url' => avesmapsPoliticalNullableString(avesmapsPoliticalReadOptionalUrl($node['wiki_url'] ?? '', 'Der Wiki-Aventurica-Link')),
        'valid_label' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($node['valid_label'] ?? ''), 500)),
        'editor_notes' => avesmapsPoliticalNullableString('Aus Wiki-Hierarchie ohne eigenen Referenzdatensatz erzeugt: ' . $wikiKey),
        'sort_order' => $sortOrder,
    ]);

    return avesmapsPoliticalFetchTerritoryById($pdo, (int) $pdo->lastInsertId());
}

function avesmapsPoliticalFindTerritoryBySlug(PDO $pdo, string $slug): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory
        WHERE slug = :slug
        ORDER BY id ASC
        LIMIT 1'
    );
    $statement->execute(['slug' => $slug]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);

    return $territory ?: null;
}

function avesmapsPoliticalSyncTerritoryGeometryStyle(PDO $pdo, int $territoryId, string $color, float $opacity): void {
    $selectStatement = $pdo->prepare(
        'SELECT id, style_json
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $selectStatement->execute(['territory_id' => $territoryId]);

    $updateStatement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET style_json = :style_json
        WHERE id = :id'
    );
    foreach ($selectStatement->fetchAll(PDO::FETCH_ASSOC) as $geometry) {
        $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;
        $updateStatement->execute([
            'id' => (int) $geometry['id'],
            'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        ]);
    }
}

function avesmapsPoliticalDeleteTerritory(PDO $pdo, array $payload): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? $payload['public_id'] ?? ''));
    $statement = $pdo->prepare('UPDATE political_territory SET is_active = 0 WHERE id = :id');
    $statement->execute(['id' => (int) $territory['id']]);

    return [
        'ok' => true,
        'deleted' => true,
        'territory_public_id' => (string) $territory['public_id'],
    ];
}

function avesmapsPoliticalSaveHierarchy(PDO $pdo, array $payload): array {
    $items = $payload['items'] ?? null;
    if (!is_array($items)) {
        throw new InvalidArgumentException('Die Hierarchie-Daten fehlen.');
    }

    $updated = 0;
    $pdo->beginTransaction();
    try {
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $territoryId = avesmapsPoliticalReadOptionalTerritoryId($pdo, $item['public_id'] ?? null);
            if ($territoryId === null) {
                continue;
            }
            $parentId = avesmapsPoliticalReadOptionalTerritoryId($pdo, $item['parent_public_id'] ?? null);
            if ($parentId === $territoryId) {
                continue;
            }
            $statement = $pdo->prepare('UPDATE political_territory SET parent_id = :parent_id WHERE id = :id');
            $statement->execute([
                'id' => $territoryId,
                'parent_id' => $parentId,
            ]);
            $updated += $statement->rowCount();
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'updated' => $updated,
    ];
}

function avesmapsPoliticalCreateGeometry(PDO $pdo, array $payload, array $user): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? ''));
    $geometry = avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson'] ?? null);
    $geometryPublicId = avesmapsPoliticalInsertGeometry($pdo, (int) $territory['id'], $geometry, $payload, $user);

    return avesmapsPoliticalResponseForGeometry($pdo, $geometryPublicId);
}

function avesmapsPoliticalUpdateGeometry(PDO $pdo, array $payload, array $user): array {
    $geometryRow = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );

    $geometry = avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson'] ?? null);

    $territoryPublicId = trim((string) ($payload['territory_public_id'] ?? ''));
    $territoryId = (int) ($geometryRow['territory_id'] ?? 0) ?: null;

    if ($territoryPublicId !== '') {
        $territory = avesmapsPoliticalFetchTerritoryByPublicId(
            $pdo,
            avesmapsPoliticalReadPublicId($territoryPublicId)
        );
        $territoryId = (int) $territory['id'];
    }

    $currentStyle = avesmapsPoliticalDecodeJson($geometryRow['style_json'] ?? null);
    $incomingStyle = is_array($payload['style_json'] ?? null) ? $payload['style_json'] : [];
    $style = array_merge($currentStyle, $incomingStyle);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = :territory_id,
            geometry_geojson = :geometry_geojson,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            source = :source,
            style_json = :style_json,
            updated_by = :updated_by
        WHERE id = :id'
    );

    $statement->execute([
        'id' => (int) $geometryRow['id'],
        'territory_id' => $territoryId,
        'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($payload['valid_from_bf'] ?? $geometryRow['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadOptionalInt($payload['valid_to_bf'] ?? $geometryRow['valid_to_bf'] ?? null),
        'min_zoom' => avesmapsPoliticalReadOptionalZoom($payload['min_zoom'] ?? $geometryRow['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalReadOptionalZoom($payload['max_zoom'] ?? $geometryRow['max_zoom'] ?? null),
        'source' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['source'] ?? 'editor'), 255)),
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return avesmapsPoliticalGeometryMutationResponse($pdo, (string) $geometryRow['public_id']);
}

function avesmapsPoliticalGeometryMutationResponse(PDO $pdo, string $geometryPublicId): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, $geometryPublicId);
    $territoryId = (int) ($geometry['territory_id'] ?? 0);

    if ($territoryId < 1) {
        return [
            'ok' => true,
            'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
            'geometry_public_id' => (string) $geometry['public_id'],
            'territory_public_id' => '',
            'feature' => null,
        ];
    }

    return avesmapsPoliticalResponseForGeometry($pdo, $geometryPublicId);
}


function avesmapsPoliticalSplitGeometry(PDO $pdo, array $payload, array $user): array {
    $geometryRow = avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? ''));
    $splitGeometry = avesmapsPoliticalReadGeoJsonGeometry($payload['split_geometry_geojson'] ?? null);
    $insertPayload = [
        ...$payload,
        'source' => $payload['source'] ?? 'editor-split',
        'geometry_valid_from_bf' => $payload['split_valid_from_bf'] ?? $geometryRow['valid_from_bf'] ?? null,
        'valid_to_bf' => $payload['split_valid_to_bf'] ?? $geometryRow['valid_to_bf'] ?? null,
        'min_zoom' => $payload['split_min_zoom'] ?? $geometryRow['min_zoom'] ?? null,
        'max_zoom' => $payload['split_max_zoom'] ?? $geometryRow['max_zoom'] ?? null,
        'style_json' => is_array($payload['style_json'] ?? null)
            ? $payload['style_json']
            : avesmapsPoliticalDecodeJson($geometryRow['style_json'] ?? null),
    ];

    $pdo->beginTransaction();
    try {
        $result = avesmapsPoliticalUpdateGeometry($pdo, $payload, $user);
        $splitGeometryPublicId = avesmapsPoliticalInsertGeometry($pdo, (int) $geometryRow['territory_id'], $splitGeometry, $insertPayload, $user);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $result['split_geometry'] = avesmapsPoliticalGeometryRowToPublic(avesmapsPoliticalFetchGeometryByPublicId($pdo, $splitGeometryPublicId));

    return $result;
}

function avesmapsPoliticalSaveGeometryDisplayOnly(PDO $pdo, array $payload, array $user): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );

    $display = is_array($payload['display'] ?? null) ? $payload['display'] : [];
    $validity = is_array($payload['validity'] ?? null) ? $payload['validity'] : [];

    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);

    if (array_key_exists('color', $display)) {
        $color = avesmapsPoliticalReadHexColor($display['color'] ?? '#888888');
        $style['fill'] = $color;
        $style['stroke'] = $color;
    }

    if (array_key_exists('opacity', $display)) {
        $style['fillOpacity'] = avesmapsPoliticalReadOpacity($display['opacity'] ?? 0.33);
    }

    if (array_key_exists('name', $display) || array_key_exists('displayName', $display)) {
        $displayName = trim((string) ($display['displayName'] ?? $display['name'] ?? ''));

        if ($displayName !== '') {
            $style['displayName'] = $displayName;
            $style['name'] = $displayName;
        } else {
            unset($style['displayName'], $style['name']);
        }
    }

    if (array_key_exists('coatOfArmsUrl', $display)) {
        $coatOfArmsUrl = avesmapsPoliticalReadOptionalUrl(
            $display['coatOfArmsUrl'] ?? '',
            'Der Wappen-Link'
        );
        if ($coatOfArmsUrl !== '') {
            $style['coatOfArmsUrl'] = $coatOfArmsUrl;
        }
    }

    $minZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? $geometry['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? $geometry['max_zoom'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            style_json = :style_json,
            source = :source,
            updated_by = :updated_by
        WHERE id = :id'
    );

    $statement->execute([
        'id' => (int) $geometry['id'],
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($validity['startYear'] ?? $geometry['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadEditorValidTo($validity, $geometry['valid_to_bf'] ?? null),
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'source' => 'editor-display',
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    $updatedGeometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, (string) $geometry['public_id']);

    return [
        'ok' => true,
        'display_only_saved' => true,
        'geometry' => avesmapsPoliticalGeometryRowToPublic($updatedGeometry),
        'geometry_public_id' => (string) $updatedGeometry['public_id'],
    ];
}

function avesmapsPoliticalSaveExistingGeometryAssignment(PDO $pdo, array $payload, array $user, array $geometry): array {
    $territoryId = (int) ($geometry['territory_id'] ?? 0);
    if ($territoryId < 1) {
        return avesmapsPoliticalSaveGeometryDisplayOnly($pdo, $payload, $user);
    }

    $selectedTerritory = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
    $chainRows = [];
    $visited = [];
    $current = $selectedTerritory;

    while ($current && !isset($visited[(int) $current['id']])) {
        $visited[(int) $current['id']] = true;
        array_unshift($chainRows, $current);

        $parentId = (int) ($current['parent_id'] ?? 0);
        if ($parentId < 1) {
            break;
        }

        $current = avesmapsPoliticalFetchTerritoryById($pdo, $parentId);
    }

    $assignment = is_array($payload['assignment'] ?? null) ? $payload['assignment'] : [];
    $displays = is_array($assignment['displays'] ?? null) ? array_values($assignment['displays']) : [];
    $assignmentDisplays = [];

    foreach ($chainRows as $index => $territory) {
        $display = is_array($displays[$index] ?? null) ? $displays[$index] : [];

        $assignmentDisplays[] = avesmapsPoliticalBuildStoredAssignmentDisplay($territory, $display, $index);

        $color = avesmapsPoliticalReadHexColor($display['color'] ?? $territory['color'] ?? '#888888');
        $opacity = avesmapsPoliticalReadOpacity($display['opacity'] ?? $territory['opacity'] ?? 0.33);
        $coatOfArmsUrl = avesmapsPoliticalReadOptionalUrl(
            $display['coatOfArmsUrl'] ?? $territory['coat_of_arms_url'] ?? '',
            'Der Wappen-Link'
        );

        if ($coatOfArmsUrl !== '' && !avesmapsPoliticalIsLikelyCoatOfArmsUrl($coatOfArmsUrl)) {
            $coatOfArmsUrl = '';
        }

        $minZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? $territory['min_zoom'] ?? null);
        $maxZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? $territory['max_zoom'] ?? null);
        avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

        $statement = $pdo->prepare(
            'UPDATE political_territory
            SET color = :color,
                opacity = :opacity,
                coat_of_arms_url = :coat_of_arms_url,
                min_zoom = :min_zoom,
                max_zoom = :max_zoom,
                valid_from_bf = :valid_from_bf,
                valid_to_bf = :valid_to_bf
            WHERE id = :id'
        );

        $statement->execute([
            'id' => (int) $territory['id'],
            'color' => $color,
            'opacity' => $opacity,
            'coat_of_arms_url' => avesmapsPoliticalNullableString($coatOfArmsUrl),
            'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom,
            'valid_from_bf' => avesmapsPoliticalReadOptionalInt($display['startYear'] ?? $territory['valid_from_bf'] ?? null),
            'valid_to_bf' => !empty($display['existsUntilToday'])
                ? 9999
                : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territory['valid_to_bf'] ?? null),
        ]);
    }

    $selectedDisplay = is_array($displays[count($chainRows) - 1] ?? null) ? $displays[count($chainRows) - 1] : [];

    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $style['fill'] = (string) ($selectedDisplay['color'] ?? $selectedTerritory['color'] ?? '#888888');
    $style['stroke'] = (string) ($selectedDisplay['color'] ?? $selectedTerritory['color'] ?? '#888888');
    $style['fillOpacity'] = avesmapsPoliticalReadOpacity($selectedDisplay['opacity'] ?? $selectedTerritory['opacity'] ?? 0.33);
    $style['assignmentDisplays'] = $assignmentDisplays;

    unset($style['displayName'], $style['name']);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = :territory_id,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            style_json = :style_json,
            source = :source,
            updated_by = :updated_by
        WHERE id = :id'
    );

    $statement->execute([
        'id' => (int) $geometry['id'],
        'territory_id' => (int) $selectedTerritory['id'],
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($selectedDisplay['startYear'] ?? $geometry['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadEditorValidTo($selectedDisplay, $geometry['valid_to_bf'] ?? null),
        'min_zoom' => null,
        'max_zoom' => null,
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'source' => 'editor-assignment',
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    $response = avesmapsPoliticalResponseForGeometry($pdo, (string) $geometry['public_id']);
    $response['assignment_saved'] = true;
    $response['existing_assignment_saved'] = true;

    return $response;
}

function avesmapsPoliticalSaveGeometryAssignment(PDO $pdo, array $payload, array $user): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );

    if (!empty($payload['display_only'])) {
        if ((int) ($geometry['territory_id'] ?? 0) > 0) {
            return avesmapsPoliticalSaveExistingGeometryAssignment($pdo, $payload, $user, $geometry);
        }

        return avesmapsPoliticalSaveGeometryDisplayOnly($pdo, $payload, $user);
    }

    $assignment = is_array($payload['assignment'] ?? null) ? $payload['assignment'] : [];
    $displays = is_array($assignment['displays'] ?? null) ? array_values($assignment['displays']) : [];

    $chainResponse = avesmapsPoliticalEnsureWikiTerritoryChain($pdo, $payload, $user);
    $chain = is_array($chainResponse['chain'] ?? null) ? array_values($chainResponse['chain']) : [];

    if ($chain === []) {
        throw new InvalidArgumentException('Die Herrschaftsgebiet-Zuweisung konnte nicht erzeugt werden.');
    }
    
    $assignmentDisplays = [];

    foreach ($chain as $index => $chainEntry) {
        $territoryPublicId = (string) ($chainEntry['territory']['public_id'] ?? '');
        if ($territoryPublicId === '') {
            continue;
        }

        $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $territoryPublicId);
        $display = is_array($displays[$index] ?? null) ? $displays[$index] : [];
        
        $assignmentDisplays[] = avesmapsPoliticalBuildStoredAssignmentDisplay($territory, $display, $index);
 
        $color = avesmapsPoliticalReadHexColor($display['color'] ?? $territory['color'] ?? '#888888');
        $opacity = avesmapsPoliticalReadOpacity($display['opacity'] ?? $territory['opacity'] ?? 0.33);
        $coatOfArmsUrl = avesmapsPoliticalReadOptionalUrl(
            $display['coatOfArmsUrl'] ?? $territory['coat_of_arms_url'] ?? '',
            'Der Wappen-Link'
        );
        if ($coatOfArmsUrl !== '' && !avesmapsPoliticalIsLikelyCoatOfArmsUrl($coatOfArmsUrl)) {
            $coatOfArmsUrl = '';
        }

        $minZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? $territory['min_zoom'] ?? null);
        $maxZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? $territory['max_zoom'] ?? null);
        avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

        $statement = $pdo->prepare(
            'UPDATE political_territory
            SET color = :color,
                opacity = :opacity,
                coat_of_arms_url = :coat_of_arms_url,
                min_zoom = :min_zoom,
                max_zoom = :max_zoom,
                valid_from_bf = :valid_from_bf,
                valid_to_bf = :valid_to_bf
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $territory['id'], 
            'color' => $color,
            'opacity' => $opacity,
            'coat_of_arms_url' => avesmapsPoliticalNullableString($coatOfArmsUrl),
            'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom,
            'valid_from_bf' => avesmapsPoliticalReadOptionalInt($display['startYear'] ?? $territory['valid_from_bf'] ?? null),
            'valid_to_bf' => !empty($display['existsUntilToday'])
                ? 9999
                : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territory['valid_to_bf'] ?? null),
        ]);
    }

    $selectedEntry = $chain[count($chain) - 1] ?? null;
    $selectedTerritoryPublicId = (string) ($selectedEntry['territory']['public_id'] ?? '');
    if ($selectedTerritoryPublicId === '') {
        throw new InvalidArgumentException('Das Ziel-Herrschaftsgebiet fehlt.');
    }

    $selectedTerritory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $selectedTerritoryPublicId);
    $selectedDisplay = is_array($displays[count($chain) - 1] ?? null) ? $displays[count($chain) - 1] : [];

    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $style['fill'] = (string) ($selectedDisplay['color'] ?? $selectedTerritory['color'] ?? '#888888');
    $style['stroke'] = (string) ($selectedDisplay['color'] ?? $selectedTerritory['color'] ?? '#888888');
    $style['fillOpacity'] = avesmapsPoliticalReadOpacity($selectedDisplay['opacity'] ?? $selectedTerritory['opacity'] ?? 0.33);

    $style['assignmentDisplays'] = $assignmentDisplays;

    // Ein zugewiesenes Gebiet hat jetzt keine einzelne globale Geometrie-Beschriftung mehr.
    // Der Anzeigename wird pro Zoomstufe aus assignmentDisplays gelesen.
    unset($style['displayName'], $style['name']);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = :territory_id,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            style_json = :style_json,
            source = :source,
            updated_by = :updated_by
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'territory_id' => (int) $selectedTerritory['id'],
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($selectedDisplay['startYear'] ?? $geometry['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadEditorValidTo($selectedDisplay, $geometry['valid_to_bf'] ?? null),
        'min_zoom' => null,
        'max_zoom' => null, 
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'source' => 'editor-assignment',
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    $response = avesmapsPoliticalResponseForGeometry($pdo, (string) $geometry['public_id']);
    $response['assignment_saved'] = true;
    $response['chain'] = $chain;

    return $response;
}

function avesmapsPoliticalAssignGeometryToTerritory(PDO $pdo, array $payload): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? ''));
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? ''));
    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $style['fill'] = (string) ($territory['color'] ?? '#888888');
    $style['stroke'] = (string) ($territory['color'] ?? '#888888');
    $style['fillOpacity'] = (float) ($territory['opacity'] ?? 0.33);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = :territory_id,
            min_zoom = NULL,
            max_zoom = NULL,
            style_json = :style_json
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'territory_id' => (int) $territory['id'],
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
    ]);

    return avesmapsPoliticalResponseForGeometry($pdo, (string) $geometry['public_id']);
}

function avesmapsPoliticalUnassignGeometry(PDO $pdo, array $payload): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = NULL,
            source = :source
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'source' => 'editor-display',
    ]);

    $updatedGeometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, (string) $geometry['public_id']);

    return [
        'ok' => true,
        'geometry' => avesmapsPoliticalGeometryRowToPublic($updatedGeometry),
        'geometry_public_id' => (string) $updatedGeometry['public_id'],
        'territory_public_id' => '',
    ];
}

function avesmapsPoliticalDeleteGeometry(PDO $pdo, array $payload): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );

    $territoryId = (int) ($geometry['territory_id'] ?? 0);
    $territory = null;
    $territoryDeleted = false;
    $remainingGeometryCount = 0;

    if ($territoryId > 0) {
        $territory = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
    }

    $pdo->beginTransaction();
    try {
        avesmapsPoliticalSoftDeleteGeometryById($pdo, (int) $geometry['id']);

        if ($territoryId > 0) {
            $remainingGeometryCount = avesmapsPoliticalCountActiveGeometriesForTerritory($pdo, $territoryId);

            if ($remainingGeometryCount === 0 && empty($territory['wiki_id'])) {
                $statement = $pdo->prepare('UPDATE political_territory SET is_active = 0 WHERE id = :id');
                $statement->execute(['id' => $territoryId]);
                $territoryDeleted = true;
            }
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'deleted' => true,
        'geometry_public_id' => (string) $geometry['public_id'],
        'territory_public_id' => $territory !== null ? (string) $territory['public_id'] : '',
        'territory_deleted' => $territoryDeleted,
        'remaining_geometry_count' => $remainingGeometryCount,
    ];
}

function avesmapsPoliticalDeleteGeometryPart(PDO $pdo, array $payload, array $user): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? ''));
    $geometryGeoJson = avesmapsPoliticalReadGeoJsonGeometry(avesmapsPoliticalDecodeJson($geometry['geometry_geojson'] ?? null));
    $polygons = avesmapsPoliticalGeometryToPolygonList($geometryGeoJson);
    $selectedPolygon = avesmapsPoliticalReadSelectedPolygonForDelete($payload['selected_polygon_geojson'] ?? null);
    $requestedPolygonIndex = avesmapsPoliticalReadOptionalPolygonIndex($payload['polygon_index'] ?? null);
    $resolvedPolygon = avesmapsPoliticalResolveDeletedPolygonIndex($polygons, $requestedPolygonIndex, $selectedPolygon);
    $polygonIndex = $resolvedPolygon['index'];

    array_splice($polygons, $polygonIndex, 1);
    if ($polygons === []) {
        return avesmapsPoliticalDeleteGeometry($pdo, [
            'geometry_public_id' => (string) $geometry['public_id'],
        ]);
    }

    $updatedGeometry = avesmapsPoliticalBuildGeoJsonFromPolygons($polygons);
    $bounds = avesmapsPoliticalCalculateGeometryBounds($updatedGeometry);
    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET geometry_geojson = :geometry_geojson,
            min_x = :min_x,
            min_y = :min_y,
            max_x = :max_x,
            max_y = :max_y,
            source = :source,
            updated_by = :updated_by
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($updatedGeometry),
        'min_x' => $bounds['min_x'],
        'min_y' => $bounds['min_y'],
        'max_x' => $bounds['max_x'],
        'max_y' => $bounds['max_y'],
        'source' => 'editor-part-delete',
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    $response = avesmapsPoliticalGeometryMutationResponse($pdo, (string) $geometry['public_id']);
    $response['deleted_polygon_index'] = $polygonIndex;
    $response['delete_match_source'] = $resolvedPolygon['source'];
    $response['requested_polygon_index'] = $requestedPolygonIndex;
    $response['remaining_polygon_count'] = count($polygons);

    return $response;
}

function avesmapsPoliticalReadOptionalPolygonIndex(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $index = filter_var($value, FILTER_VALIDATE_INT);
    if ($index === false || $index < 0) {
        return null;
    }

    return (int) $index;
}

function avesmapsPoliticalReadSelectedPolygonForDelete(mixed $value): ?array {
    if ($value === null || $value === '') {
        return null;
    }

    $geometry = avesmapsPoliticalReadGeoJsonGeometry($value);
    $polygons = avesmapsPoliticalGeometryToPolygonList($geometry);

    return $polygons[0] ?? null;
}

function avesmapsPoliticalResolveDeletedPolygonIndex(array $storedPolygons, ?int $requestedPolygonIndex, ?array $selectedPolygon): array {
    if ($selectedPolygon !== null) {
        $selectedSignature = avesmapsPoliticalBuildPolygonCoordinateSignature($selectedPolygon);
        foreach ($storedPolygons as $index => $storedPolygon) {
            if (avesmapsPoliticalBuildPolygonCoordinateSignature($storedPolygon) === $selectedSignature) {
                return [
                    'index' => (int) $index,
                    'source' => 'geometry-signature',
                ];
            }
        }

        $matchedIndex = avesmapsPoliticalFindClosestPolygonIndex($storedPolygons, $selectedPolygon);
        if ($matchedIndex !== null) {
            return [
                'index' => $matchedIndex,
                'source' => 'geometry-shape',
            ];
        }
    }

    if ($requestedPolygonIndex !== null && array_key_exists($requestedPolygonIndex, $storedPolygons)) {
        return [
            'index' => $requestedPolygonIndex,
            'source' => 'index',
        ];
    }

    throw new InvalidArgumentException('Das ausgewaehlte Polygon wurde in der gespeicherten Geometrie nicht gefunden.');
}

function avesmapsPoliticalBuildPolygonCoordinateSignature(array $polygon): string {
    $coordinates = [];
    foreach ($polygon as $ring) {
        if (!is_array($ring)) {
            continue;
        }
        foreach ($ring as $coordinate) {
            if (!is_array($coordinate) || count($coordinate) < 2) {
                continue;
            }
            $coordinates[] = round((float) $coordinate[0], 5) . ',' . round((float) $coordinate[1], 5);
        }
    }

    sort($coordinates, SORT_STRING);

    return implode('|', $coordinates);
}

function avesmapsPoliticalFindClosestPolygonIndex(array $storedPolygons, array $selectedPolygon): ?int {
    $selectedMetrics = avesmapsPoliticalBuildPolygonMatchMetrics($selectedPolygon);
    $bestIndex = null;
    $bestScore = null;

    foreach ($storedPolygons as $index => $storedPolygon) {
        $storedMetrics = avesmapsPoliticalBuildPolygonMatchMetrics($storedPolygon);
        $score = abs($storedMetrics['area'] - $selectedMetrics['area'])
            + abs($storedMetrics['min_x'] - $selectedMetrics['min_x'])
            + abs($storedMetrics['min_y'] - $selectedMetrics['min_y'])
            + abs($storedMetrics['max_x'] - $selectedMetrics['max_x'])
            + abs($storedMetrics['max_y'] - $selectedMetrics['max_y']);
        if ($bestScore === null || $score < $bestScore) {
            $bestScore = $score;
            $bestIndex = (int) $index;
        }
    }

    return $bestScore !== null && $bestScore <= 0.01 ? $bestIndex : null;
}

function avesmapsPoliticalBuildPolygonMatchMetrics(array $polygon): array {
    $area = 0.0;
    $minX = null;
    $minY = null;
    $maxX = null;
    $maxY = null;

    foreach ($polygon as $ringIndex => $ring) {
        if (!is_array($ring)) {
            continue;
        }
        $ringArea = abs(avesmapsPoliticalSignedRingArea($ring));
        $area += $ringIndex === 0 ? $ringArea : -$ringArea;
        foreach ($ring as $coordinate) {
            if (!is_array($coordinate) || count($coordinate) < 2) {
                continue;
            }
            $x = (float) $coordinate[0];
            $y = (float) $coordinate[1];
            $minX = $minX === null ? $x : min($minX, $x);
            $minY = $minY === null ? $y : min($minY, $y);
            $maxX = $maxX === null ? $x : max($maxX, $x);
            $maxY = $maxY === null ? $y : max($maxY, $y);
        }
    }

    return [
        'area' => max(0.0, $area),
        'min_x' => $minX ?? 0.0,
        'min_y' => $minY ?? 0.0,
        'max_x' => $maxX ?? 0.0,
        'max_y' => $maxY ?? 0.0,
    ];
}

function avesmapsPoliticalBuildGeoJsonFromPolygons(array $polygons): array {
    if ($polygons === []) {
        throw new InvalidArgumentException('Die Geometrie enthaelt kein Polygon mehr.');
    }

    return count($polygons) === 1
        ? ['type' => 'Polygon', 'coordinates' => array_values($polygons)[0]]
        : ['type' => 'MultiPolygon', 'coordinates' => array_values($polygons)];
}

function avesmapsPoliticalCountActiveGeometriesForTerritory(PDO $pdo, int $territoryId): int {
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $statement->execute(['territory_id' => $territoryId]);

    return (int) $statement->fetchColumn();
}

function avesmapsPoliticalApplyGeometryOperationResult(PDO $pdo, array $payload, array $user): array {
    $operation = avesmapsNormalizeSingleLine((string) ($payload['operation'] ?? ''), 40);
    if (!in_array($operation, ['union', 'difference', 'intersection'], true)) {
        throw new InvalidArgumentException('Die Geometrieoperation ist unbekannt.');
    }

    if ($operation === 'intersection' && avesmapsPoliticalReadBoolean($payload['create_territory'] ?? false)) {
        $payload['name'] = avesmapsNormalizeSingleLine((string) ($payload['name'] ?? 'Neues Herrschaftsgebiet'), 255);
        return avesmapsPoliticalCreateTerritory($pdo, $payload, $user);
    }

    $deleteGeometryPublicId = avesmapsNormalizeSingleLine((string) ($payload['delete_geometry_public_id'] ?? ''), 36);
    if ($deleteGeometryPublicId === '') {
        return avesmapsPoliticalUpdateGeometry($pdo, $payload, $user);
    }

    $sourceGeometryPublicId = avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '');
    $targetGeometryPublicId = avesmapsPoliticalReadPublicId($deleteGeometryPublicId);
    if ($sourceGeometryPublicId === $targetGeometryPublicId) {
        throw new InvalidArgumentException('Quelle und Ziel der Geometrieoperation muessen verschieden sein.');
    }

    $pdo->beginTransaction();
    try {
        $result = avesmapsPoliticalUpdateGeometry($pdo, $payload, $user);
        $targetGeometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, $targetGeometryPublicId);
        avesmapsPoliticalSoftDeleteGeometryById($pdo, (int) $targetGeometry['id']);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $result['deleted_geometry_public_id'] = $targetGeometryPublicId;

    return $result;
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

function avesmapsPoliticalBuildGeometryDiagnostics(array $geometry): array {
    $polygons = avesmapsPoliticalGeometryToPolygonList($geometry);
    $area = 0.0;
    $ringCount = 0;
    $invalidRingCount = 0;
    $coordinateCount = 0;
    foreach ($polygons as $polygon) {
        foreach ($polygon as $ringIndex => $ring) {
            $ringCount++;
            $coordinateCount += count($ring);
            $ringArea = abs(avesmapsPoliticalSignedRingArea($ring));
            if (count($ring) < 4 || $ringArea <= 0.000001 || !avesmapsPoliticalRingIsClosed($ring)) {
                $invalidRingCount++;
            }
            $area += $ringIndex === 0 ? $ringArea : -$ringArea;
        }
    }

    return [
        'type' => (string) ($geometry['type'] ?? ''),
        'polygon_count' => count($polygons),
        'ring_count' => $ringCount,
        'coordinate_count' => $coordinateCount,
        'invalid_ring_count' => $invalidRingCount,
        'area' => round(max(0.0, $area), 6),
        'bbox' => avesmapsPoliticalCalculateGeometryBounds($geometry),
    ];
}

function avesmapsPoliticalGeometryToPolygonList(array $geometry): array {
    if (($geometry['type'] ?? '') === 'Polygon') {
        return [$geometry['coordinates'] ?? []];
    }

    if (($geometry['type'] ?? '') === 'MultiPolygon') {
        return is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
    }

    return [];
}

function avesmapsPoliticalSignedRingArea(array $ring): float {
    $area = 0.0;
    $count = count($ring);
    for ($index = 0; $index < $count - 1; $index++) {
        $current = $ring[$index];
        $next = $ring[$index + 1];
        $area += (float) ($current[0] ?? 0) * (float) ($next[1] ?? 0)
            - (float) ($next[0] ?? 0) * (float) ($current[1] ?? 0);
    }

    return $area / 2;
}

function avesmapsPoliticalRingIsClosed(array $ring): bool {
    if (count($ring) < 2) {
        return false;
    }

    $first = $ring[0];
    $last = $ring[count($ring) - 1];

    return abs((float) ($first[0] ?? 0) - (float) ($last[0] ?? 0)) <= 0.000001
        && abs((float) ($first[1] ?? 0) - (float) ($last[1] ?? 0)) <= 0.000001;
}

function avesmapsPoliticalCompareGeometryOperationDiagnostics(
    string $operation,
    array $sourceDiagnostics,
    array $targetDiagnostics,
    array $resultDiagnostics
): array {
    $issues = [];
    if ((int) $resultDiagnostics['polygon_count'] < 1 || (float) $resultDiagnostics['area'] <= 0.0) {
        $issues[] = 'empty_result';
    }
    if ((int) $resultDiagnostics['invalid_ring_count'] > 0) {
        $issues[] = 'invalid_result_rings';
    }

    $epsilon = max(0.01, ((float) $sourceDiagnostics['area'] + (float) $targetDiagnostics['area']) * 0.000001);
    if (($operation === 'difference' || $operation === 'difference-keep-target')
        && (float) $resultDiagnostics['area'] - (float) $sourceDiagnostics['area'] > $epsilon
    ) {
        $issues[] = 'difference_area_larger_than_source';
    }
    if ($operation === 'intersection'
        && (float) $resultDiagnostics['area'] - min((float) $sourceDiagnostics['area'], (float) $targetDiagnostics['area']) > $epsilon
    ) {
        $issues[] = 'intersection_area_larger_than_input';
    }
    if ($operation === 'union'
        && (float) $resultDiagnostics['area'] + $epsilon < max((float) $sourceDiagnostics['area'], (float) $targetDiagnostics['area'])
    ) {
        $issues[] = 'union_area_smaller_than_input';
    }

    return $issues;
}

function avesmapsPoliticalSoftDeleteGeometryById(PDO $pdo, int $geometryId): void {
    $statement = $pdo->prepare('UPDATE political_territory_geometry SET is_active = 0 WHERE id = :id');
    $statement->execute(['id' => $geometryId]);
}

function avesmapsPoliticalRestoreLegacyRegionGeometries(PDO $pdo, array $payload, array $user): array {
    $dryRun = avesmapsPoliticalReadBoolean($payload['dry_run'] ?? false);
    $features = avesmapsPoliticalFetchLegacyRegionFeaturesByExactName($pdo);
    $createdTerritories = 0;
    $restoredGeometries = 0;
    $skippedExistingEditorial = 0;
    $skippedInvalid = 0;

    $pdo->beginTransaction();
    try {
        foreach ($features as $feature) {
            $name = avesmapsPoliticalReadLegacyFeatureName($feature);
            $geometry = avesmapsPoliticalDecodeJson($feature['geometry_json'] ?? null);
            if ($name === '' || !in_array((string) ($geometry['type'] ?? ''), ['Polygon', 'MultiPolygon'], true)) {
                $skippedInvalid++;
                continue;
            }

            $territory = avesmapsPoliticalFindTerritoryByExactNameOrSlug($pdo, $name);
            if ($territory === null) {
                if ($dryRun) {
                    $createdTerritories++;
                    $restoredGeometries++;
                    continue;
                }

                $territory = avesmapsPoliticalCreateLegacyRegionTerritory($pdo, $feature, $name, $user);
                $createdTerritories++;
            }

            if (avesmapsPoliticalTerritoryHasEditorialGeometry($pdo, (int) $territory['id'])) {
                $skippedExistingEditorial++;
                continue;
            }

            if (avesmapsPoliticalTerritoryHasEquivalentActiveGeometry($pdo, (int) $territory['id'], $geometry)) {
                continue;
            }

            if (!$dryRun) {
                avesmapsPoliticalInsertGeometry($pdo, (int) $territory['id'], $geometry, [
                    'source' => 'legacy_region_restore',
                    'min_zoom' => $territory['min_zoom'] ?? null,
                    'max_zoom' => $territory['max_zoom'] ?? null,
                    'style_json' => avesmapsPoliticalBuildSeedGeometryStyle($feature, (string) ($territory['color'] ?? '#888888')),
                ], $user);
            }
            $restoredGeometries++;
        }

        $dryRun ? $pdo->rollBack() : $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'legacy_region_count' => count($features),
        'created_territories' => $createdTerritories,
        'restored_geometries' => $restoredGeometries,
        'skipped_existing_editorial' => $skippedExistingEditorial,
        'skipped_invalid' => $skippedInvalid,
    ];
}

function avesmapsPoliticalFetchLegacyRegionFeaturesByExactName(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, geometry_json, properties_json, style_json, min_x, min_y, max_x, max_y
        FROM map_features
        WHERE feature_type = 'region'
            AND is_active = 1
            AND geometry_type IN ('Polygon', 'MultiPolygon')
        ORDER BY sort_order ASC, id ASC"
    );

    return $statement !== false ? ($statement->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
}

function avesmapsPoliticalReadLegacyFeatureName(array $feature): string {
    $properties = avesmapsPoliticalDecodeJson($feature['properties_json'] ?? null);
    return avesmapsNormalizeSingleLine((string) ($feature['name'] ?? $properties['name'] ?? $properties['data-item-label'] ?? ''), 255);
}

function avesmapsPoliticalFindTerritoryByExactNameOrSlug(PDO $pdo, string $name): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory
        WHERE name = :name OR slug = :slug
        ORDER BY name = :name_order DESC, id ASC
        LIMIT 1'
    );
    $statement->execute([
        'name' => $name,
        'name_order' => $name,
        'slug' => avesmapsPoliticalSlug($name),
    ]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);

    return $territory ?: null;
}

function avesmapsPoliticalCreateLegacyRegionTerritory(PDO $pdo, array $feature, string $name, array $user): array {
    $properties = avesmapsPoliticalDecodeJson($feature['properties_json'] ?? null);
    $style = avesmapsPoliticalBuildSeedGeometryStyle($feature, '#888888');
    $publicId = avesmapsPoliticalUuidV4();
    $statement = $pdo->prepare(
        'INSERT INTO political_territory (
            public_id, wiki_id, slug, name, short_name, type, parent_id, continent, status, color,
            opacity, coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, valid_label,
            min_zoom, max_zoom, is_active, editor_notes, sort_order
        ) VALUES (
            :public_id, NULL, :slug, :name, NULL, :type, NULL, :continent, NULL, :color,
            :opacity, NULL, NULL, NULL, NULL, NULL,
            :min_zoom, :max_zoom, 1, :editor_notes, :sort_order
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'slug' => avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name)),
        'name' => avesmapsPoliticalUniqueName($pdo, $name),
        'type' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($properties['feature_subtype'] ?? $properties['layer'] ?? 'Herrschaftsgebiet'), 160)),
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'color' => (string) ($style['fill'] ?? '#888888'),
        'opacity' => (float) ($style['fillOpacity'] ?? 0.33),
        'min_zoom' => 0,
        'max_zoom' => 6,
        'editor_notes' => 'Aus urspruenglichem Regionen-Layer wiederhergestellt.',
        'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
    ]);

    return avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
}

function avesmapsPoliticalTerritoryHasEditorialGeometry(PDO $pdo, int $territoryId): bool {
    $statement = $pdo->prepare(
        "SELECT COUNT(*)
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1
            AND COALESCE(source, '') NOT IN ('legacy_region_seed', 'legacy_region_restore')"
    );
    $statement->execute(['territory_id' => $territoryId]);

    return (int) $statement->fetchColumn() > 0;
}

function avesmapsPoliticalTerritoryHasEquivalentActiveGeometry(PDO $pdo, int $territoryId, array $geometry): bool {
    $statement = $pdo->prepare(
        'SELECT geometry_geojson
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $statement->execute(['territory_id' => $territoryId]);
    $encodedGeometry = avesmapsPoliticalEncodeJsonOrNull($geometry);
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if (avesmapsPoliticalEncodeJsonOrNull(avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null)) === $encodedGeometry) {
            return true;
        }
    }

    return false;
}

function avesmapsPoliticalInsertGeometry(PDO $pdo, int $territoryId, array $geometry, array $payload, array $user): string {
    $bounds = avesmapsPoliticalCalculateGeometryBounds($geometry);
    $publicId = avesmapsPoliticalUuidV4();
    $minZoom = avesmapsPoliticalReadOptionalZoom($payload['geometry_min_zoom'] ?? $payload['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($payload['geometry_max_zoom'] ?? $payload['max_zoom'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);
    $statement = $pdo->prepare(
        'INSERT INTO political_territory_geometry (
            public_id, territory_id, geometry_geojson, valid_from_bf, valid_to_bf,
            min_zoom, max_zoom, min_x, min_y, max_x, max_y, source, style_json,
            created_by, updated_by
        ) VALUES (
            :public_id, :territory_id, :geometry_geojson, :valid_from_bf, :valid_to_bf,
            :min_zoom, :max_zoom, :min_x, :min_y, :max_x, :max_y, :source, :style_json,
            :created_by, :updated_by
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'territory_id' => $territoryId,
        'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($payload['geometry_valid_from_bf'] ?? $payload['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadOpenEndedValidTo($payload),
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'min_x' => $bounds['min_x'],
        'min_y' => $bounds['min_y'],
        'max_x' => $bounds['max_x'],
        'max_y' => $bounds['max_y'],
        'source' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['source'] ?? 'editor'), 255)),
        'style_json' => avesmapsPoliticalEncodeJsonOrNull(is_array($payload['style_json'] ?? null) ? $payload['style_json'] : null),
        'created_by' => (int) ($user['id'] ?? 0) ?: null,
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return $publicId;
}

function avesmapsPoliticalResponseForTerritory(PDO $pdo, string $publicId): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
    $geometries = avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $territory['id']);
    $wiki = !empty($territory['wiki_id']) ? avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']) : null;
    $assignmentChain = avesmapsPoliticalBuildAssignmentChain($pdo, $territory);

    return [
        'ok' => true,
        'territory' => avesmapsPoliticalTerritoryRowToPublic($territory),
        'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
        'feature' => $geometries === [] ? null : avesmapsPoliticalBuildFeatureFromStoredRows($territory, $geometries[0]),
        'assignment_chain' => $assignmentChain,
    ];
}

function avesmapsPoliticalResponseForGeometry(PDO $pdo, string $geometryPublicId): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, $geometryPublicId);
    $territory = avesmapsPoliticalFetchTerritoryById($pdo, (int) $geometry['territory_id']);

    return [
        'ok' => true,
        'territory' => avesmapsPoliticalTerritoryRowToPublic($territory),
        'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
        'feature' => avesmapsPoliticalBuildFeatureFromStoredRows($territory, $geometry),
    ];
}

function avesmapsPoliticalBuildFeatureFromStoredRows(array $territory, array $geometry): array {
    $row = [
        ...$territory,
        'territory_id' => (int) $territory['id'],
        'territory_public_id' => (string) $territory['public_id'],
        'geometry_public_id' => (string) $geometry['public_id'],
        'geometry_geojson' => $geometry['geometry_geojson'],
        'geometry_valid_from_bf' => $geometry['valid_from_bf'] ?? null,
        'geometry_valid_to_bf' => $geometry['valid_to_bf'] ?? null,
        'geometry_min_zoom' => $geometry['min_zoom'] ?? null,
        'geometry_max_zoom' => $geometry['max_zoom'] ?? null,
        'territory_min_zoom' => $territory['min_zoom'] ?? null,
        'territory_max_zoom' => $territory['max_zoom'] ?? null,
        'style_json' => $geometry['style_json'] ?? null,
        'affiliation_raw' => (string) ($territory['wiki_affiliation_raw'] ?? ''),
        'affiliation_root' => (string) ($territory['wiki_affiliation_root'] ?? ''),
        'affiliation_path_json' => $territory['wiki_affiliation_path_json'] ?? null,
        'founded_text' => (string) ($territory['wiki_founded_text'] ?? ''),
        'dissolved_text' => (string) ($territory['wiki_dissolved_text'] ?? ''),
        'capital_name' => (string) ($territory['wiki_capital_name'] ?? ''),
        'seat_name' => (string) ($territory['wiki_seat_name'] ?? ''),
        'updated_at' => $geometry['updated_at'] ?? '',
    ];

    return avesmapsPoliticalLayerRowToFeature($row, AVESMAPS_POLITICAL_DEFAULT_YEAR_BF, 0);
}

function avesmapsPoliticalTerritoryRowToPublic(array $row): array {
    return [
        'id' => (int) $row['id'],
        'public_id' => (string) $row['public_id'],
        'wiki_id' => isset($row['wiki_id']) ? (int) $row['wiki_id'] : null,
        'slug' => (string) $row['slug'],
        'name' => (string) $row['name'],
        'short_name' => (string) ($row['short_name'] ?? ''),
        'type' => (string) ($row['type'] ?? ''),
        'parent_id' => isset($row['parent_id']) ? (int) $row['parent_id'] : null,
        'parent_public_id' => (string) ($row['parent_public_id'] ?? ''),
        'parent_name' => (string) ($row['parent_name'] ?? ''),
        'continent' => (string) ($row['continent'] ?? ''),
        'status' => (string) ($row['status'] ?? ''),
        'color' => (string) ($row['color'] ?? '#888888'),
        'opacity' => (float) ($row['opacity'] ?? 0.33),
        'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'capital_place_public_id' => (string) ($row['capital_place_public_id'] ?? ''),
        'seat_place_public_id' => (string) ($row['seat_place_public_id'] ?? ''),
        'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNormalizeRowValidTo($row['valid_to_bf'] ?? null, $row),
        'valid_label' => (string) ($row['valid_label'] ?? ''),
        'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
        'is_active' => (int) ($row['is_active'] ?? 1) === 1,
        'editor_notes' => (string) ($row['editor_notes'] ?? ''),
        'sort_order' => (int) ($row['sort_order'] ?? 0),
        'wiki_name' => (string) ($row['wiki_name'] ?? ''),
        'wiki_type' => (string) ($row['wiki_type'] ?? ''),
        'wiki_affiliation_raw' => (string) ($row['wiki_affiliation_raw'] ?? ''),
        'wiki_affiliation_root' => (string) ($row['wiki_affiliation_root'] ?? ''),
        'wiki_affiliation_path' => avesmapsPoliticalDecodeJson($row['wiki_affiliation_path_json'] ?? null),
        'wiki_founded_text' => (string) ($row['wiki_founded_text'] ?? ''),
        'wiki_dissolved_text' => (string) ($row['wiki_dissolved_text'] ?? ''),
        'wiki_capital_name' => (string) ($row['wiki_capital_name'] ?? ''),
        'wiki_seat_name' => (string) ($row['wiki_seat_name'] ?? ''),
    ];
}

function avesmapsPoliticalGeometryRowToPublic(array $row): array {
    return [
        'id' => (int) $row['id'],
        'public_id' => (string) $row['public_id'],
        'territory_id' => (int) $row['territory_id'],
        'geometry' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
        'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNullableInt($row['valid_to_bf'] ?? null),
        'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
        'source' => (string) ($row['source'] ?? ''),
        'style' => avesmapsPoliticalDecodeJson($row['style_json'] ?? null),
        'is_active' => (int) ($row['is_active'] ?? 1) === 1,
    ];
}

function avesmapsPoliticalWikiRowToPublic(array $row): array {
    $public = $row;
    foreach (['affiliation_path_json', 'affiliation_json', 'founded_json', 'dissolved_json', 'raw_json'] as $key) {
        $public[$key] = avesmapsPoliticalDecodeJson($row[$key] ?? null);
    }

    return $public;
}

function avesmapsPoliticalWikiReferenceRowToPublic(array $row): array {
    return [
        'id' => (int) ($row['id'] ?? 0),
        'wiki_key' => (string) ($row['wiki_key'] ?? ''),
        'name' => (string) ($row['name'] ?? ''),
        'type' => (string) ($row['type'] ?? ''),
        'continent' => (string) ($row['continent'] ?? ''),
        'affiliation_raw' => (string) ($row['affiliation_raw'] ?? ''),
        'affiliation_root' => (string) ($row['affiliation_root'] ?? ''),
        'affiliation_path' => avesmapsPoliticalDecodeJson($row['affiliation_path_json'] ?? null),
        'status' => (string) ($row['status'] ?? ''),
        'capital_name' => (string) ($row['capital_name'] ?? ''),
        'seat_name' => (string) ($row['seat_name'] ?? ''),
        'ruler' => (string) ($row['ruler'] ?? ''),
        'founded_text' => (string) ($row['founded_text'] ?? ''),
        'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
    ];
}

function avesmapsPoliticalBuildHierarchy(array $territories): array {
    $nodesById = [];
    $territoriesById = [];
    foreach ($territories as $territory) {
        $territoryId = (int) ($territory['id'] ?? 0);
        if ($territoryId < 1) {
            continue;
        }

        $territoriesById[$territoryId] = $territory;
        $nodesById[$territoryId] = [
            'public_id' => $territory['public_id'],
            'name' => $territory['name'],
            'short_name' => $territory['short_name'] ?? '',
            'type' => $territory['type'],
            'valid_label' => $territory['valid_label'] ?? '',
            'parent_public_id' => $territory['parent_public_id'] ?? '',
            'parent_name' => $territory['parent_name'] ?? '',
            'wiki_name' => $territory['wiki_name'] ?? '',
            'wiki_affiliation_raw' => $territory['wiki_affiliation_raw'] ?? '',
            'wiki_affiliation_root' => $territory['wiki_affiliation_root'] ?? '',
            'aliases' => avesmapsPoliticalPublicTerritoryAliases($territory),
            'children' => [],
        ];
    }

    $aliasToIds = avesmapsPoliticalBuildAliasIndex(
        $territoriesById,
        static fn(array $territory): array => avesmapsPoliticalPublicTerritoryAliases($territory)
    );

    $resolvedParentIds = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $resolvedParentIds[$territoryId] = avesmapsPoliticalResolveHierarchyParentId(
            $territoryId,
            $territory,
            $territoriesById,
            $aliasToIds
        );
    }

    $childrenByParentId = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $parentId = (int) ($resolvedParentIds[$territoryId] ?? 0);
        if ($parentId > 0 && isset($nodesById[$parentId])) {
            $childrenByParentId[$parentId] ??= [];
            $childrenByParentId[$parentId][] = $territoryId;
        }
    }

    $displayRootNames = [];
    $rootGroups = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $rootName = avesmapsPoliticalResolveHierarchyDisplayRootName(
            $territoryId,
            $territoriesById,
            $childrenByParentId,
            $displayRootNames
        );
        $rootKey = avesmapsPoliticalSlug($rootName);
        if ($rootKey === '') {
            $rootKey = 'territory:' . $territoryId;
            $rootName = (string) ($territory['name'] ?? '');
        }

        if (!isset($rootGroups[$rootKey])) {
            $rootGroups[$rootKey] = [
                'key' => $rootKey,
                'name' => $rootName,
                'territory_ids' => [],
            ];
        }

        $rootGroups[$rootKey]['territory_ids'][] = $territoryId;
    }

    uasort(
        $rootGroups,
        static fn(array $left, array $right): int => strnatcasecmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? ''))
    );

    $hierarchy = [];
    foreach ($rootGroups as $group) {
        $groupTerritoryIds = [];
        foreach ((array) ($group['territory_ids'] ?? []) as $territoryId) {
            $groupTerritoryIds[(int) $territoryId] = true;
        }

        $buildNode = function (int $territoryId, array $trail = []) use (&$buildNode, $nodesById, $childrenByParentId, $groupTerritoryIds): array {
            if (!isset($nodesById[$territoryId])) {
                return [];
            }

            $node = $nodesById[$territoryId];
            if (isset($trail[$territoryId])) {
                return $node;
            }

            $trail[$territoryId] = true;
            $childIds = array_values(
                array_filter(
                    (array) ($childrenByParentId[$territoryId] ?? []),
                    static fn(mixed $childId): bool => is_int($childId) && isset($groupTerritoryIds[$childId])
                )
            );
            usort(
                $childIds,
                static fn(int $leftId, int $rightId): int => strnatcasecmp(
                    (string) ($nodesById[$leftId]['name'] ?? ''),
                    (string) ($nodesById[$rightId]['name'] ?? '')
                )
            );

            foreach ($childIds as $childId) {
                $childNode = $buildNode($childId, $trail);
                if ($childNode !== []) {
                    $node['children'][] = $childNode;
                }
            }

            return $node;
        };

        $topLevelIds = [];
        foreach (array_keys($groupTerritoryIds) as $territoryId) {
            $parentId = (int) ($resolvedParentIds[$territoryId] ?? 0);
            if ($parentId > 0 && isset($groupTerritoryIds[$parentId])) {
                continue;
            }

            $topLevelIds[] = $territoryId;
        }

        usort(
            $topLevelIds,
            static fn(int $leftId, int $rightId): int => strnatcasecmp(
                (string) ($nodesById[$leftId]['name'] ?? ''),
                (string) ($nodesById[$rightId]['name'] ?? '')
            )
        );

        $children = [];
        foreach ($topLevelIds as $territoryId) {
            $node = $buildNode($territoryId);
            if ($node !== []) {
                $children[] = $node;
            }
        }

        $hierarchy[] = [
            'public_id' => '',
            'name' => (string) ($group['name'] ?? ''),
            'short_name' => '',
            'type' => '',
            'valid_label' => '',
            'parent_public_id' => '',
            'parent_name' => '',
            'wiki_name' => (string) ($group['name'] ?? ''),
            'wiki_affiliation_raw' => (string) ($group['name'] ?? ''),
            'wiki_affiliation_root' => (string) ($group['name'] ?? ''),
            'aliases' => [(string) ($group['name'] ?? '')],
            'children' => $children,
            'is_group' => true,
        ];
    }

    return $hierarchy;
}

function avesmapsPoliticalResolveHierarchyParentId(
    int $territoryId,
    array $territory,
    array $territoriesById,
    array $aliasToIds
): int {
    $parentId = (int) ($territory['parent_id'] ?? 0);
    if ($parentId < 1 || !isset($territoriesById[$parentId])) {
        $parentId = avesmapsPoliticalInferPublicTerritoryParentId($territory, $aliasToIds, $territoriesById);
    }

    if ($parentId < 1 || !isset($territoriesById[$parentId]) || $parentId === $territoryId) {
        return 0;
    }

    $visited = [$territoryId => true];
    $currentId = $parentId;
    $safety = 0;
    while ($currentId > 0 && $safety < 128) {
        if (isset($visited[$currentId])) {
            return 0;
        }

        $visited[$currentId] = true;
        $current = $territoriesById[$currentId] ?? null;
        if (!is_array($current)) {
            return $parentId;
        }

        $nextParentId = (int) ($current['parent_id'] ?? 0);
        if ($nextParentId < 1 || !isset($territoriesById[$nextParentId])) {
            $nextParentId = avesmapsPoliticalInferPublicTerritoryParentId($current, $aliasToIds, $territoriesById);
        }

        if ($nextParentId === $currentId) {
            return 0;
        }

        $currentId = $nextParentId;
        $safety++;
    }

    return $safety >= 128 ? 0 : $parentId;
}

function avesmapsPoliticalPublicTerritoryAliases(array $territory): array {
    $aliases = avesmapsPoliticalExpandTerritoryAliases([
        (string) ($territory['name'] ?? ''),
        (string) ($territory['short_name'] ?? ''),
        (string) ($territory['wiki_name'] ?? ''),
    ]);

    return array_values(array_unique(array_filter(array_map('trim', $aliases))));
}

function avesmapsPoliticalResolveHierarchyRootName(array $territory): string {
    $rootName = trim((string) ($territory['wiki_affiliation_root'] ?? ''));
    if ($rootName !== '') {
        return $rootName;
    }

    $path = $territory['wiki_affiliation_path'] ?? [];
    if (is_array($path) && $path !== []) {
        $first = trim((string) reset($path));
        if ($first !== '') {
            return $first;
        }
    }

    $affiliation = trim((string) ($territory['wiki_affiliation_raw'] ?? ''));
    if ($affiliation !== '') {
        $parts = preg_split('/\s*[:;]\s*/u', $affiliation) ?: [];
        $first = trim((string) reset($parts));
        if ($first !== '') {
            return $first;
        }
    }

    return trim((string) ($territory['name'] ?? ''));
}

function avesmapsPoliticalResolveHierarchyDisplayRootName(
    int $territoryId,
    array $territoriesById,
    array $childrenByParentId,
    array &$cache,
    array $trail = []
): string {
    if (isset($cache[$territoryId])) {
        return $cache[$territoryId];
    }

    $territory = $territoriesById[$territoryId] ?? null;
    if (!is_array($territory) || isset($trail[$territoryId])) {
        return '';
    }

    $trail[$territoryId] = true;
    $rootName = avesmapsPoliticalResolveHierarchyRootName($territory);
    if (!avesmapsPoliticalIsGenericHierarchyRootName($rootName)) {
        $cache[$territoryId] = $rootName;
        return $rootName;
    }

    $rootCounts = [];
    foreach ((array) ($childrenByParentId[$territoryId] ?? []) as $childId) {
        if (!is_int($childId)) {
            continue;
        }

        $childRootName = avesmapsPoliticalResolveHierarchyDisplayRootName(
            $childId,
            $territoriesById,
            $childrenByParentId,
            $cache,
            $trail
        );
        if ($childRootName === '' || avesmapsPoliticalIsGenericHierarchyRootName($childRootName)) {
            continue;
        }

        $rootCounts[$childRootName] = (int) ($rootCounts[$childRootName] ?? 0) + 1;
    }

    if ($rootCounts === []) {
        $cache[$territoryId] = $rootName;
        return $rootName;
    }

    uksort($rootCounts, 'strnatcasecmp');
    arsort($rootCounts);
    $displayRootName = (string) array_key_first($rootCounts);
    $cache[$territoryId] = $displayRootName;
    return $displayRootName;
}

function avesmapsPoliticalIsGenericHierarchyRootName(string $rootName): bool {
    return in_array(
        avesmapsPoliticalSlug($rootName),
        ['unabhangig', 'umstritten', 'ungeklart'],
        true
    );
}

function avesmapsPoliticalInferPublicTerritoryParentId(array $territory, array $aliasToIds, array $territoriesById): int {
    $parentName = '';
    $path = $territory['wiki_affiliation_path'] ?? [];
    if (is_array($path) && $path !== []) {
        $parentName = (string) end($path);
        if (avesmapsPoliticalSlug($parentName) === avesmapsPoliticalSlug((string) ($territory['name'] ?? ''))) {
            $parentName = count($path) > 1 ? (string) $path[count($path) - 2] : '';
        }
    }

    if (trim($parentName) === '') {
        $affiliation = trim((string) ($territory['wiki_affiliation_raw'] ?? ''));
        if (!in_array(mb_strtolower($affiliation), ['', 'unabhaengig', 'unabhängig', 'umstritten', 'ungeklaert', 'ungeklärt'], true)) {
            $parts = preg_split('/\s*[:;]\s*/u', $affiliation) ?: [];
            $parentName = (string) end($parts);
        }
    }

    $parentId = avesmapsPoliticalResolveParentAliasId(
        $aliasToIds,
        $parentName,
        $territoriesById,
        $territory,
        (int) ($territory['id'] ?? 0)
    );
    return $parentId === (int) ($territory['id'] ?? 0) ? 0 : $parentId;
}

function avesmapsPoliticalFetchTerritoryByRequest(PDO $pdo, array $query): array {
    $publicId = avesmapsPoliticalReadPublicId($query['public_id'] ?? $query['territory_public_id'] ?? '');

    return avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
}

function avesmapsPoliticalFetchTerritoryByPublicId(PDO $pdo, string $publicId): array {
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
        WHERE territory.public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $publicId]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$territory) {
        throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
    }

    return $territory;
}

function avesmapsPoliticalFetchTerritoryById(PDO $pdo, int $territoryId): array {
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
        WHERE territory.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $territoryId]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$territory) {
        throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
    }

    return $territory;
}

function avesmapsPoliticalFetchTerritoryPublicIdById(PDO $pdo, int $territoryId): string {
    return (string) avesmapsPoliticalFetchTerritoryById($pdo, $territoryId)['public_id'];
}

function avesmapsPoliticalFetchWikiById(PDO $pdo, int $wikiId): array {
    $statement = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $wikiId]);
    $wiki = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$wiki) {
        throw new InvalidArgumentException('Die Wiki-Referenzdaten wurden nicht gefunden.');
    }

    return $wiki;
}

function avesmapsPoliticalFetchGeometryRowsForTerritory(PDO $pdo, int $territoryId): array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1
        ORDER BY id ASC'
    );
    $statement->execute(['territory_id' => $territoryId]);

    return $statement->fetchAll(PDO::FETCH_ASSOC);
}

function avesmapsPoliticalFetchGeometryByPublicId(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_geometry
        WHERE public_id = :public_id
            AND is_active = 1
        LIMIT 1'
    );
    $statement->execute(['public_id' => $publicId]);
    $geometry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$geometry) {
        throw new InvalidArgumentException('Die Geometrie wurde nicht gefunden.');
    }

    return $geometry;
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

function avesmapsPoliticalBuildAssignmentChain(PDO $pdo, array $territory): array {
    $chain = [];
    $current = $territory;
    $visitedIds = [];
    $safety = 0;

    while (is_array($current) && $safety < 64) {
        $currentId = (int) ($current['id'] ?? 0);
        if ($currentId < 1 || isset($visitedIds[$currentId])) {
            break;
        }

        $visitedIds[$currentId] = true;
        $wiki = !empty($current['wiki_id']) ? avesmapsPoliticalFetchWikiById($pdo, (int) $current['wiki_id']) : null;
        $chain[] = [
            'territory' => avesmapsPoliticalTerritoryRowToPublic($current),
            'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
            'wiki_public_id' => $wiki === null ? '' : (string) ($wiki['wiki_key'] ?? ''),
        ];

        $parentId = (int) ($current['parent_id'] ?? 0);
        if ($parentId < 1) {
            break;
        }

        $current = avesmapsPoliticalFetchTerritoryById($pdo, $parentId);
        $safety++;
    }

    return array_reverse($chain);
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

function avesmapsPoliticalCountGeometryParts(?array $geometry): int {
    if (!is_array($geometry)) {
        return 0;
    }

    if (($geometry['type'] ?? '') === 'Polygon') {
        return 1;
    }

    if (($geometry['type'] ?? '') === 'MultiPolygon' && is_array($geometry['coordinates'] ?? null)) {
        return count($geometry['coordinates']);
    }

    return 0;
}

function avesmapsPoliticalCountGeometryRings(?array $geometry): int {
    if (!is_array($geometry)) {
        return 0;
    }

    if (($geometry['type'] ?? '') === 'Polygon' && is_array($geometry['coordinates'] ?? null)) {
        return count($geometry['coordinates']);
    }

    if (($geometry['type'] ?? '') === 'MultiPolygon' && is_array($geometry['coordinates'] ?? null)) {
        $count = 0;
        foreach ($geometry['coordinates'] as $polygon) {
            if (is_array($polygon)) {
                $count += count($polygon);
            }
        }
        return $count;
    }

    return 0;
}

function avesmapsPoliticalApplyEffectiveParents(array $territories): array {
    return $territories;
}

function avesmapsPoliticalBuildAliasIndex(array $territories, callable $aliasReader): array {
    $aliasToIds = [];
    foreach ($territories as $territoryId => $territory) {
        $resolvedId = (int) ($territory['id'] ?? $territoryId);
        foreach ((array) $aliasReader($territory) as $alias) {
            $slug = avesmapsPoliticalSlug((string) $alias);
            if ($slug === '') {
                continue;
            }

            $aliasToIds[$slug] ??= [];
            if (!in_array($resolvedId, $aliasToIds[$slug], true)) {
                $aliasToIds[$slug][] = $resolvedId;
            }
        }
    }

    return $aliasToIds;
}

function avesmapsPoliticalResolveSingleEffectiveTerritory(PDO $pdo, array $territory): array {
    if (!empty($territory['parent_public_id'])) {
        return $territory;
    }

    $allTerritories = avesmapsPoliticalListTerritories($pdo, ['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);
    foreach ((array) ($allTerritories['territories'] ?? []) as $candidate) {
        if ((int) ($candidate['id'] ?? 0) === (int) ($territory['id'] ?? 0)) {
            return $candidate;
        }
    }

    return $territory;
}

function avesmapsPoliticalFetchAuditGeometryCounts(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT
            territory_id,
            COUNT(*) AS geometry_count,
            GROUP_CONCAT(DISTINCT COALESCE(source, \'\') ORDER BY COALESCE(source, \'\') SEPARATOR \',\') AS sources
        FROM political_territory_geometry
        WHERE is_active = 1
        GROUP BY territory_id'
    );
    if ($statement === false) {
        return [];
    }

    $counts = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        $counts[$territoryId] = [
            'geometry_count' => (int) ($row['geometry_count'] ?? 0),
            'sources' => array_values(array_filter(array_map('trim', explode(',', (string) ($row['sources'] ?? ''))))),
        ];
    }

    return $counts;
}

function avesmapsPoliticalBuildMissingTerritoryEntryAudit(PDO $pdo, array $territories): array {
    $aliasToIds = avesmapsPoliticalBuildAliasIndex(
        $territories,
        static function (array $territory): array {
            return avesmapsPoliticalExpandTerritoryAliases([
                (string) ($territory['name'] ?? ''),
                (string) ($territory['short_name'] ?? ''),
                (string) ($territory['wiki_name'] ?? ''),
            ]);
        }
    );

    $statement = $pdo->prepare(
        'SELECT
            public_id,
            name,
            feature_subtype,
            geometry_type
        FROM map_features
        WHERE feature_type = :feature_type
            AND is_active = 1
            AND geometry_type IN (:polygon_type, :multipolygon_type)
        ORDER BY sort_order ASC, name ASC, id ASC'
    );
    $statement->execute([
        'feature_type' => 'region',
        'polygon_type' => 'Polygon',
        'multipolygon_type' => 'MultiPolygon',
    ]);

    $missingEntries = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        if ($name === '') {
            continue;
        }

        $matched = false;
        foreach (avesmapsPoliticalExpandTerritoryAliases([$name]) as $alias) {
            $slug = avesmapsPoliticalSlug($alias);
            if ($slug !== '' && !empty($aliasToIds[$slug])) {
                $matched = true;
                break;
            }
        }

        if ($matched) {
            continue;
        }

        $missingEntries[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => $name,
            'feature_subtype' => (string) ($row['feature_subtype'] ?? ''),
            'geometry_type' => (string) ($row['geometry_type'] ?? ''),
        ];
    }

    return $missingEntries;
}

function avesmapsPoliticalDetectTimelineIssue(array $territory): string {
    $validTo = avesmapsPoliticalNullableInt($territory['valid_to_bf'] ?? null);
    $dissolvedText = mb_strtolower((string) ($territory['wiki_dissolved_text'] ?? ''));
    if ($validTo === 0 && str_contains($dissolvedText, 'besteht')) {
        return 'valid_to_zero_but_ongoing';
    }

    return '';
}

function avesmapsPoliticalReadGeoJsonGeometry(mixed $value): array {
    if (!is_array($value)) {
        throw new InvalidArgumentException('Die Geometrie fehlt.');
    }

    $type = (string) ($value['type'] ?? '');
    $coordinates = $value['coordinates'] ?? null;
    if ($type === 'Polygon') {
        return [
            'type' => 'Polygon',
            'coordinates' => avesmapsPoliticalReadPolygonRings($coordinates),
        ];
    }

    if ($type === 'MultiPolygon') {
        if (!is_array($coordinates) || $coordinates === []) {
            throw new InvalidArgumentException('Das MultiPolygon braucht mindestens eine Flaeche.');
        }

        return [
            'type' => 'MultiPolygon',
            'coordinates' => array_map(static fn(mixed $polygon): array => avesmapsPoliticalReadPolygonRings($polygon), $coordinates),
        ];
    }

    throw new InvalidArgumentException('Die Geometrie muss ein Polygon oder MultiPolygon sein.');
}

function avesmapsPoliticalReadPolygonRings(mixed $rings): array {
    if (!is_array($rings) || count($rings) < 1) {
        throw new InvalidArgumentException('Ein Polygon braucht mindestens einen Ring.');
    }

    $normalizedRings = [];
    foreach ($rings as $ringIndex => $ring) {
        if (!is_array($ring) || count($ring) < 4) {
            throw new InvalidArgumentException('Ein Polygonring braucht mindestens drei Punkte.');
        }

        $normalizedRing = [];
        foreach ($ring as $coordinate) {
            if (!is_array($coordinate) || count($coordinate) < 2) {
                throw new InvalidArgumentException('Die Polygonkoordinaten sind ungueltig.');
            }
            $normalizedRing[] = [
                avesmapsParseMapCoordinate($coordinate[0] ?? null, 'lng'),
                avesmapsParseMapCoordinate($coordinate[1] ?? null, 'lat'),
            ];
        }

        $first = $normalizedRing[0];
        $last = $normalizedRing[count($normalizedRing) - 1];
        if (abs($first[0] - $last[0]) > 0.0001 || abs($first[1] - $last[1]) > 0.0001) {
            $normalizedRing[] = $first;
        }
        if ($ringIndex === 0 && count($normalizedRing) < 4) {
            throw new InvalidArgumentException('Ein Polygon braucht mindestens drei Punkte.');
        }
        $normalizedRings[] = $normalizedRing;
    }

    return $normalizedRings;
}

function avesmapsPoliticalCalculateGeometryBounds(array $geometry): array {
    $coordinatePairs = [];
    avesmapsPoliticalCollectCoordinatePairs($geometry['coordinates'] ?? null, $coordinatePairs);
    if ($coordinatePairs === []) {
        throw new InvalidArgumentException('Die Geometrie enthaelt keine Koordinaten.');
    }

    $xValues = array_map(static fn(array $coordinate): float => $coordinate[0], $coordinatePairs);
    $yValues = array_map(static fn(array $coordinate): float => $coordinate[1], $coordinatePairs);

    return [
        'min_x' => min($xValues),
        'min_y' => min($yValues),
        'max_x' => max($xValues),
        'max_y' => max($yValues),
    ];
}

function avesmapsPoliticalCollectCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void {
    if (!is_array($coordinates)) {
        return;
    }
    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];
        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsPoliticalCollectCoordinatePairs($coordinate, $coordinatePairs);
    }
}

function avesmapsPoliticalReadOptionalTerritoryId(PDO $pdo, mixed $publicId): ?int {
    $value = avesmapsNormalizeSingleLine((string) ($publicId ?? ''), 36);
    if ($value === '') {
        return null;
    }

    return (int) avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($value))['id'];
}

function avesmapsPoliticalReadOptionalWikiId(PDO $pdo, mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $wikiId = filter_var($value, FILTER_VALIDATE_INT);
    if ($wikiId === false || $wikiId < 1) {
        throw new InvalidArgumentException('Die Wiki-Referenz ist ungueltig.');
    }

    $statement = $pdo->prepare(
        'SELECT id
        FROM political_territory_wiki
        WHERE id = :id
            AND continent = :continent
        LIMIT 1'
    );
    $statement->execute([
        'id' => (int) $wikiId,
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);
    if ($statement->fetchColumn() === false) {
        throw new InvalidArgumentException('Die Wiki-Referenz wurde nicht gefunden.');
    }

    return (int) $wikiId;
}

function avesmapsPoliticalReadPublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die Herrschaftsgebiet-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsPoliticalReadRequiredName(mixed $value, string $fieldLabel): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 255);
    if ($name === '') {
        throw new InvalidArgumentException("{$fieldLabel} fehlt.");
    }

    return $name;
}

function avesmapsPoliticalUniqueName(PDO $pdo, string $baseName, ?int $excludeId = null): string {
    $normalizedBaseName = avesmapsNormalizeSingleLine($baseName, 240);
    $namePrefix = $normalizedBaseName !== '' ? $normalizedBaseName : 'Neues Herrschaftsgebiet';
    $candidate = $namePrefix;
    $suffix = 2;
    while (avesmapsPoliticalNameExists($pdo, $candidate, $excludeId) && $suffix < 10000) {
        $candidate = avesmapsNormalizeSingleLine("{$namePrefix} ({$suffix})", 255);
        $suffix++;
    }

    if ($suffix >= 10000) {
        throw new InvalidArgumentException('Es konnte kein eindeutiger Name erzeugt werden.');
    }

    return $candidate;
}

function avesmapsPoliticalNameExists(PDO $pdo, string $name, ?int $excludeId): bool {
    $sql = 'SELECT COUNT(*) FROM political_territory WHERE name = :name';
    $params = ['name' => $name];
    if ($excludeId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (int) $statement->fetchColumn() > 0;
}

function avesmapsPoliticalReadHexColor(mixed $value): string {
    $color = avesmapsNormalizeSingleLine((string) ($value ?: '#888888'), 9);
    if (preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color) !== 1) {
        throw new InvalidArgumentException('Der Farbwert ist ungueltig.');
    }

    return $color;
}

function avesmapsPoliticalReadOpacity(mixed $value): float {
    $opacity = filter_var($value, FILTER_VALIDATE_FLOAT);
    if ($opacity === false || $opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('Die Transparenz ist ungueltig.');
    }

    return (float) $opacity;
}

function avesmapsPoliticalReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsPoliticalReadOptionalInt(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false) {
        throw new InvalidArgumentException('Ein Zahlenwert ist ungueltig.');
    }

    return (int) $parsedValue;
}

function avesmapsPoliticalReadEditorValidTo(array $state, mixed $fallback = null): ?int {
    if (!empty($state['existsUntilToday'])) {
        return 9999;
    }

    if (array_key_exists('endYear', $state)) {
        if ($state['endYear'] === null || $state['endYear'] === '') {
            return null;
        }

        return avesmapsPoliticalReadOptionalInt($state['endYear']);
    }

    return avesmapsPoliticalReadOptionalInt($fallback);
}

function avesmapsPoliticalReadOptionalZoom(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    if ($zoom === false || $zoom < 0 || $zoom > 6) {
        throw new InvalidArgumentException('Die Zoomstufe ist ungueltig.');
    }

    return (int) $zoom;
}

function avesmapsPoliticalAssertZoomRange(?int $minZoom, ?int $maxZoom): void {
    if ($minZoom !== null && $maxZoom !== null && $minZoom > $maxZoom) {
        throw new InvalidArgumentException('Die minimale Zoomstufe darf nicht groesser als die maximale sein.');
    }
}

function avesmapsPoliticalReadOpenEndedValidTo(array $payload, mixed $fallback = null): ?int {
    if (avesmapsPoliticalReadBoolean($payload['valid_to_open'] ?? false)) {
        return null;
    }

    return avesmapsPoliticalReadOptionalInt($payload['valid_to_bf'] ?? $fallback);
}

function avesmapsPoliticalNormalizedValidToSql(string $valueExpression, string $dissolvedTypeExpression, string $dissolvedTextExpression): string {
    return 'CASE
        WHEN ' . $valueExpression . ' = 0
            AND (
                LOWER(COALESCE(' . $dissolvedTypeExpression . ', \'\')) IN (\'ongoing\', \'unknown\')
                OR LOWER(COALESCE(' . $dissolvedTextExpression . ', \'\')) LIKE \'%besteht%\'
                OR (
                    COALESCE(' . $dissolvedTypeExpression . ', \'\') = \'\'
                    AND COALESCE(' . $dissolvedTextExpression . ', \'\') = \'\'
                )
            )
        THEN NULL
        ELSE ' . $valueExpression . '
    END';
}

function avesmapsPoliticalReadOptionalUrl(mixed $value, string $fieldLabel): string {
    return avesmapsNormalizeOptionalUrl((string) ($value ?? ''), 500, $fieldLabel);
}

function avesmapsPoliticalNullableInt(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    return is_numeric($value) ? (int) $value : null;
}

function avesmapsPoliticalNormalizeRowValidTo(mixed $value, array $row): ?int {
    $normalizedValue = avesmapsPoliticalNullableInt($value);
    if ($normalizedValue !== 0) {
        return $normalizedValue;
    }

    $dissolvedType = mb_strtolower(trim((string) ($row['dissolved_type'] ?? $row['wiki_dissolved_type'] ?? '')));
    $dissolvedText = mb_strtolower(trim((string) ($row['dissolved_text'] ?? $row['wiki_dissolved_text'] ?? '')));
    if (
        in_array($dissolvedType, ['ongoing', 'unknown'], true)
        || str_contains($dissolvedText, 'besteht')
        || ($dissolvedType === '' && $dissolvedText === '')
    ) {
        return null;
    }

    return 0;
}

function avesmapsPoliticalExpandTerritoryAliases(array $values): array {
    $aliases = [];
    foreach ($values as $value) {
        $text = trim((string) $value);
        if ($text === '') {
            continue;
        }

        $aliases[] = $text;
        $withoutParenthetical = trim((string) preg_replace('/\s*\([^)]*\)/u', '', $text));
        if ($withoutParenthetical !== '') {
            $aliases[] = $withoutParenthetical;
        }

        foreach (preg_split('/\s*,\s*/u', $withoutParenthetical) ?: [] as $part) {
            $part = trim((string) $part);
            if ($part !== '') {
                $aliases[] = $part;
            }
        }
    }

    return array_values(array_unique($aliases));
}

function avesmapsPoliticalResolveParentAliasId(array $aliasToIds, string $parentName, array $territoriesById, array $childTerritory, int $selfId = 0): int {
    $candidateIds = [];
    foreach (avesmapsPoliticalExpandTerritoryAliases([$parentName]) as $candidate) {
        $slug = avesmapsPoliticalSlug($candidate);
        foreach ((array) ($aliasToIds[$slug] ?? []) as $candidateId) {
            $candidateId = (int) $candidateId;
            if ($candidateId > 0 && $candidateId !== $selfId && !in_array($candidateId, $candidateIds, true)) {
                $candidateIds[] = $candidateId;
            }
        }
    }

    if ($candidateIds === []) {
        return 0;
    }

    if (count($candidateIds) === 1) {
        return $candidateIds[0];
    }

    $bestId = 0;
    $bestScore = PHP_INT_MIN;
    foreach ($candidateIds as $candidateId) {
        $candidate = $territoriesById[$candidateId] ?? null;
        if (!is_array($candidate)) {
            continue;
        }

        $score = avesmapsPoliticalScoreParentCandidate($candidate, $childTerritory);
        if ($score > $bestScore) {
            $bestScore = $score;
            $bestId = $candidateId;
        }
    }

    return $bestId;
}

function avesmapsPoliticalScoreParentCandidate(array $candidate, array $childTerritory): int {
    $score = 0;
    $childPath = (array) ($childTerritory['wiki_affiliation_path'] ?? $childTerritory['affiliation_path_json'] ?? []);
    $childAffiliationRaw = (string) ($childTerritory['wiki_affiliation_raw'] ?? $childTerritory['affiliation_raw'] ?? '');
    $candidateRoot = (string) ($candidate['wiki_affiliation_root'] ?? $candidate['affiliation_root'] ?? '');
    $candidateRaw = (string) ($candidate['wiki_affiliation_raw'] ?? $candidate['affiliation_raw'] ?? '');
    $candidateValidTo = avesmapsPoliticalNormalizeRowValidTo($candidate['valid_to_bf'] ?? null, $candidate);

    if (count($childPath) > 1) {
        $prefix = (string) $childPath[count($childPath) - 2];
        if ($prefix !== '') {
            if (avesmapsPoliticalSlug($candidateRoot) === avesmapsPoliticalSlug($prefix)) {
                $score += 100;
            }
            if (str_contains(avesmapsPoliticalSlug($candidateRaw), avesmapsPoliticalSlug($prefix))) {
                $score += 40;
            }
        }
    }

    $root = (string) ($childTerritory['wiki_affiliation_root'] ?? '');
    if ($root !== '' && avesmapsPoliticalSlug($candidateRoot) === avesmapsPoliticalSlug($root)) {
        $score += 30;
    }

    if ($childAffiliationRaw !== '' && str_contains(avesmapsPoliticalSlug($childAffiliationRaw), avesmapsPoliticalSlug((string) ($candidate['name'] ?? '')))) {
        $score += 10;
    }

    if ($candidateValidTo === null) {
        $score += 20;
    }

    $sortOrder = max(0, (int) ($candidate['sort_order'] ?? 0));
    $score += max(0, 10 - intdiv($sortOrder, 100));

    return $score;
}

function avesmapsPoliticalReadOptionalBoundingBox(string $rawBoundingBox): ?array {
    $normalizedBoundingBox = trim($rawBoundingBox);
    if ($normalizedBoundingBox === '') {
        return null;
    }

    $parts = array_map('trim', explode(',', $normalizedBoundingBox));
    if (count($parts) !== 4) {
        throw new InvalidArgumentException('Der Parameter bbox muss min_x,min_y,max_x,max_y enthalten.');
    }

    $coordinates = array_map(
        static function (string $value): float {
            $parsedValue = filter_var(str_replace(',', '.', $value), FILTER_VALIDATE_FLOAT);
            if ($parsedValue === false) {
                throw new InvalidArgumentException('Der Parameter bbox enthaelt ungueltige Koordinaten.');
            }

            return (float) $parsedValue;
        },
        $parts
    );

    [$minX, $minY, $maxX, $maxY] = $coordinates;
    if ($minX > $maxX || $minY > $maxY) {
        throw new InvalidArgumentException('Der Parameter bbox enthaelt vertauschte Grenzen.');
    }

    return [
        'min_x' => $minX,
        'min_y' => $minY,
        'max_x' => $maxX,
        'max_y' => $maxY,
    ];
}

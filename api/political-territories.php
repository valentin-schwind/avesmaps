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
        'assign_geometry' => avesmapsPoliticalAssignGeometryToTerritory($pdo, $payload),
        'delete_geometry' => avesmapsPoliticalDeleteGeometry($pdo, $payload),
        'geometry_operation' => avesmapsPoliticalApplyGeometryOperationResult($pdo, $payload, $user),
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
} catch (PDOException) {
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
    $bbox = avesmapsPoliticalReadOptionalBoundingBox((string) ($query['bbox'] ?? ''));
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
    $territoryId = $sourceTerritoryId;
    $visited = [];
    while ($territoryId > 0 && isset($territories[$territoryId]) && !isset($visited[$territoryId])) {
        $visited[$territoryId] = true;
        if (avesmapsPoliticalLayerTerritoryMatchesZoom($territories[$territoryId], $zoom)) {
            return $territoryId;
        }

        $territoryId = (int) ($parentIds[$territoryId] ?? 0);
    }

    return null;
}

function avesmapsPoliticalLayerTerritoryMatchesZoom(array $territory, int $zoom): bool {
    $minZoom = avesmapsPoliticalNullableInt($territory['territory_min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalNullableInt($territory['territory_max_zoom'] ?? null);
    $isEditorTerritory = empty($territory['wiki_id'])
        && trim((string) ($territory['type'] ?? '')) === 'Herrschaftsgebiet';

    if ($isEditorTerritory && $minZoom === 0 && $maxZoom === 0) {
        return true;
    }

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
        'updated_at' => (string) ($geometryRow['updated_at'] ?? ''),
        'aggregate_source_territory_id' => (int) $sourceTerritory['territory_id'],
        'aggregate_source_territory_public_id' => (string) $sourceTerritory['territory_public_id'],
        'aggregate_source_territory_name' => (string) $sourceTerritory['name'],
    ]);
}

function avesmapsPoliticalLayerRowToFeature(array $row, int $yearBf, int $zoom): array {
    $style = avesmapsPoliticalDecodeJson($row['style_json'] ?? null);
    $properties = [
        'type' => 'region',
        'source' => 'political_territory',
        'public_id' => (string) $row['geometry_public_id'],
        'geometry_public_id' => (string) $row['geometry_public_id'],
        'territory_public_id' => (string) $row['territory_public_id'],
        'territory_id' => (int) $row['territory_id'],
        'name' => (string) ($row['short_name'] ?: $row['name']),
        'display_name' => (string) $row['name'],
        'short_name' => (string) ($row['short_name'] ?? ''),
        'feature_type' => 'political_territory',
        'feature_subtype' => (string) ($row['type'] ?? 'Herrschaftsgebiet'),
        'territory_type' => (string) ($row['type'] ?? ''),
        'status' => (string) ($row['status'] ?? ''),
        'fill' => (string) ($style['fill'] ?? $row['color'] ?? '#888888'),
        'stroke' => (string) ($style['stroke'] ?? $row['color'] ?? '#888888'),
        'fillOpacity' => (float) ($style['fillOpacity'] ?? $row['opacity'] ?? 0.33),
        'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
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
        'valid_to_bf' => avesmapsPoliticalNormalizeRowValidTo(
            $row['geometry_valid_to_bf'] ?? $row['valid_to_bf'] ?? null,
            $row
        ),
        'valid_label' => (string) ($row['valid_label'] ?? ''),
        'founded_text' => (string) ($row['founded_text'] ?? ''),
        'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
        'min_zoom' => avesmapsPoliticalNullableInt($row['geometry_min_zoom'] ?? $row['territory_min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['geometry_max_zoom'] ?? $row['territory_max_zoom'] ?? null),
        'timeline_year_bf' => $yearBf,
        'render_zoom' => $zoom,
        'updated_at' => (string) ($row['updated_at'] ?? ''),
        'is_aggregate' => isset($row['aggregate_source_territory_id']),
        'aggregate_source_territory_public_id' => (string) ($row['aggregate_source_territory_public_id'] ?? ''),
        'aggregate_source_territory_name' => (string) ($row['aggregate_source_territory_name'] ?? ''),
    ];

    $featureId = isset($row['aggregate_source_territory_id'])
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

    return [
        'ok' => true,
        'territory' => $territoryPublic,
        'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
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

    return [
        'ok' => true,
        'summary' => avesmapsPoliticalReadDebugSummary($pdo),
        'year_bf' => $yearBf,
        'zoom_from' => $zoomFrom,
        'zoom_to' => $zoomTo,
        'entries' => $entries,
    ];
}

function avesmapsPoliticalCreateTerritory(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsPoliticalReadRequiredName($payload['name'] ?? '', 'Der Name des Herrschaftsgebiets');
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

    return avesmapsPoliticalResponseForTerritory($pdo, (string) $territory['public_id']);
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
    $geometryRow = avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? ''));
    $geometry = avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson'] ?? null);
    $bounds = avesmapsPoliticalCalculateGeometryBounds($geometry);
    $minZoom = avesmapsPoliticalReadOptionalZoom($payload['min_zoom'] ?? $geometryRow['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($payload['max_zoom'] ?? $geometryRow['max_zoom'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET geometry_geojson = :geometry_geojson,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            min_x = :min_x,
            min_y = :min_y,
            max_x = :max_x,
            max_y = :max_y,
            source = :source,
            style_json = :style_json,
            updated_by = :updated_by
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometryRow['id'],
        'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($payload['valid_from_bf'] ?? $geometryRow['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalReadOpenEndedValidTo($payload, $geometryRow['valid_to_bf'] ?? null),
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'min_x' => $bounds['min_x'],
        'min_y' => $bounds['min_y'],
        'max_x' => $bounds['max_x'],
        'max_y' => $bounds['max_y'],
        'source' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['source'] ?? 'editor'), 255)),
        'style_json' => avesmapsPoliticalEncodeJsonOrNull(is_array($payload['style_json'] ?? null) ? $payload['style_json'] : avesmapsPoliticalDecodeJson($geometryRow['style_json'] ?? null)),
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return avesmapsPoliticalResponseForGeometry($pdo, (string) $geometryRow['public_id']);
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

function avesmapsPoliticalDeleteGeometry(PDO $pdo, array $payload): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? ''));
    $statement = $pdo->prepare('UPDATE political_territory_geometry SET is_active = 0 WHERE id = :id');
    $statement->execute(['id' => (int) $geometry['id']]);

    return [
        'ok' => true,
        'deleted' => true,
        'geometry_public_id' => (string) $geometry['public_id'],
        'territory_public_id' => avesmapsPoliticalFetchTerritoryPublicIdById($pdo, (int) $geometry['territory_id']),
    ];
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

    return avesmapsPoliticalUpdateGeometry($pdo, $payload, $user);
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

    return [
        'ok' => true,
        'territory' => avesmapsPoliticalTerritoryRowToPublic($territory),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
        'feature' => $geometries === [] ? null : avesmapsPoliticalBuildFeatureFromStoredRows($territory, $geometries[0]),
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

    $resolvedParentIds = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $parentId = (int) ($territory['parent_id'] ?? 0);
        $resolvedParentIds[$territoryId] = isset($territoriesById[$parentId]) && $parentId !== $territoryId
            ? $parentId
            : 0;
    }

    $childrenByParentId = [];
    $rootIds = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $parentId = (int) ($resolvedParentIds[$territoryId] ?? 0);
        if ($parentId > 0 && isset($nodesById[$parentId])) {
            $childrenByParentId[$parentId] ??= [];
            $childrenByParentId[$parentId][] = $territoryId;
            continue;
        }

        $rootIds[] = $territoryId;
    }

    $buildNode = function (int $territoryId, array $trail = []) use (&$buildNode, $nodesById, $childrenByParentId): array {
        if (!isset($nodesById[$territoryId])) {
            return [];
        }

        $node = $nodesById[$territoryId];
        if (isset($trail[$territoryId])) {
            return $node;
        }

        $trail[$territoryId] = true;
        foreach ((array) ($childrenByParentId[$territoryId] ?? []) as $childId) {
            if (!is_int($childId)) {
                continue;
            }

            $childNode = $buildNode($childId, $trail);
            if ($childNode === []) {
                continue;
            }

            $node['children'][] = $childNode;
        }

        return $node;
    };

    $hierarchy = [];
    $addedRootIds = [];
    foreach ($rootIds as $rootId) {
        $hierarchy[] = $buildNode($rootId);
        $addedRootIds[$rootId] = true;
    }

    foreach (array_keys($nodesById) as $territoryId) {
        if (isset($addedRootIds[$territoryId])) {
            continue;
        }

        $hierarchy[] = $buildNode((int) $territoryId);
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
    $name = mb_strtolower(implode(' ', $aliases));
    if (str_contains($name, 'heiliges neues kaiserreich vom greifenthron')) {
        $aliases[] = 'Mittelreich';
    }

    return array_values(array_unique(array_filter(array_map('trim', $aliases))));
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

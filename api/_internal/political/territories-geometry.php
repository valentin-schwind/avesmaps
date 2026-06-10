<?php

declare(strict_types=1);

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

function avesmapsPoliticalClearTerritoryGeometryZoomOverrides(PDO $pdo, int $territoryId): void {
    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET min_zoom = NULL,
            max_zoom = NULL
        WHERE territory_id = :territory_id'
    );
    $statement->execute(['territory_id' => $territoryId]);
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

function avesmapsPoliticalCreateGeometry(PDO $pdo, array $payload, array $user): array {
    $territoryPublicId = trim((string) ($payload['territory_public_id'] ?? ''));
    $territoryId = null;

    if ($territoryPublicId !== '') {
        $territory = avesmapsPoliticalFetchTerritoryByPublicId(
            $pdo,
            avesmapsPoliticalReadPublicId($territoryPublicId)
        );
        $territoryId = (int) $territory['id'];
    }

    $geometry = avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson'] ?? null);
    $geometryPublicId = avesmapsPoliticalInsertGeometry($pdo, $territoryId, $geometry, $payload, $user);

    return avesmapsPoliticalResponseForGeometry($pdo, $geometryPublicId);
}

function avesmapsPoliticalUpdateGeometry(PDO $pdo, array $payload, array $user): array {
    $geometryRow = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );
    $beforeGeometrySnapshot = avesmapsPoliticalBuildGeometryAuditSnapshot($geometryRow);
    $skipAudit = avesmapsPoliticalReadBoolean($payload['_skip_audit'] ?? false);

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

    $response = avesmapsPoliticalGeometryMutationResponse($pdo, (string) $geometryRow['public_id']);
    if (!$skipAudit) {
        $geometryAfterRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, (string) $geometryRow['public_id']);
        avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            'update_geometry',
            (int) ($user['id'] ?? 0),
            [
                'geometries' => [
                    (string) $geometryRow['public_id'] => $beforeGeometrySnapshot,
                ],
                'territories' => [],
            ],
            [
                'geometries' => [
                    (string) $geometryRow['public_id'] => avesmapsPoliticalBuildGeometryAuditSnapshot($geometryAfterRow),
                ],
                'territories' => [],
            ]
        );
    }

    return $response;
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
    $sourceGeometryPublicId = (string) $geometryRow['public_id'];
    $sourceBeforeSnapshot = avesmapsPoliticalBuildGeometryAuditSnapshot($geometryRow);
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
        $result = avesmapsPoliticalUpdateGeometry($pdo, [
            ...$payload,
            '_skip_audit' => true,
        ], $user);
        $splitGeometryPublicId = avesmapsPoliticalInsertGeometry(
            $pdo,
            $geometryRow['territory_id'] !== null ? (int) $geometryRow['territory_id'] : null,
            $splitGeometry,
            $insertPayload,
            $user
        );
        $sourceAfterRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $sourceGeometryPublicId, true);
        $splitAfterRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $splitGeometryPublicId, true);
        avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            'split_geometry',
            (int) ($user['id'] ?? 0),
            [
                'geometries' => [
                    $sourceGeometryPublicId => $sourceBeforeSnapshot,
                    $splitGeometryPublicId => null,
                ],
                'territories' => [],
            ],
            [
                'geometries' => [
                    $sourceGeometryPublicId => avesmapsPoliticalBuildGeometryAuditSnapshot($sourceAfterRow),
                    $splitGeometryPublicId => avesmapsPoliticalBuildGeometryAuditSnapshot($splitAfterRow),
                ],
                'territories' => [],
            ]
        );
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

function avesmapsPoliticalCreateTerritoryForGeometry(PDO $pdo, array $payload, array $user, array $geometry): array {
    $previousTerritoryId = (int) ($geometry['territory_id'] ?? 0);

    $display = is_array($payload['display'] ?? null) ? $payload['display'] : [];
    $validity = is_array($payload['validity'] ?? null) ? $payload['validity'] : [];

    $name = avesmapsPoliticalReadRequiredName(
        $payload['territory_name']
            ?? $display['displayName']
            ?? $display['name']
            ?? '',
        'Der Name des Herrschaftsgebiets'
    );

    $slug = avesmapsPoliticalSlug($name);
    if ($slug === '') {
        throw new InvalidArgumentException('Der Name des Herrschaftsgebiets ist ungueltig.');
    }

    if (avesmapsPoliticalFindTerritoryBySlug($pdo, $slug) !== null) {
        throw new InvalidArgumentException('Ein Herrschaftsgebiet mit diesem Namen existiert bereits.');
    }

    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $color = avesmapsPoliticalReadHexColor(
        $display['color']
            ?? $style['fill']
            ?? $style['stroke']
            ?? '#888888'
    );
    $opacity = avesmapsPoliticalReadOpacity(
        $display['opacity']
            ?? $style['fillOpacity']
            ?? 0.33
    );

    $publicId = avesmapsPoliticalUuidV4();

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'INSERT INTO political_territory (
                public_id, wiki_id, slug, name, short_name, type, parent_id, continent, status, color,
                opacity, coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, valid_label,
                min_zoom, max_zoom, is_active, editor_notes, sort_order
            ) VALUES (
                :public_id, NULL, :slug, :name, NULL, :type, NULL, :continent, NULL, :color,
                :opacity, NULL, NULL, :valid_from_bf, :valid_to_bf, NULL,
                NULL, NULL, 1, :editor_notes, :sort_order
            )'
        );

        $statement->execute([
            'public_id' => $publicId,
            'slug' => $slug,
            'name' => $name,
            'type' => avesmapsPoliticalNullableString(
                avesmapsNormalizeSingleLine((string) ($payload['territory_type'] ?? 'Herrschaftsgebiet'), 160)
            ),
            'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'color' => $color,
            'opacity' => $opacity,
            'valid_from_bf' => avesmapsPoliticalReadOptionalInt($validity['startYear'] ?? $geometry['valid_from_bf'] ?? null),
            'valid_to_bf' => avesmapsPoliticalReadEditorValidTo($validity, $geometry['valid_to_bf'] ?? null),
            'editor_notes' => avesmapsPoliticalNullableString('Aus Geometrie im Editor erzeugt.'),
            'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
        ]);

        $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);

        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;

        unset($style['displayName'], $style['name']);

        $updateGeometry = $pdo->prepare(
            'UPDATE political_territory_geometry
            SET territory_id = :territory_id,
                min_zoom = NULL,
                max_zoom = NULL,
                style_json = :style_json,
                source = :source,
                updated_by = :updated_by
            WHERE id = :id'
        );

        $updateGeometry->execute([
            'id' => (int) $geometry['id'],
            'territory_id' => (int) $territory['id'],
            'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
            'source' => 'editor-created-territory',
            'updated_by' => (int) ($user['id'] ?? 0) ?: null,
        ]);

        if ($previousTerritoryId > 0 && $previousTerritoryId !== (int) $territory['id']) {
            avesmapsPoliticalDeactivateTerritoryIfOrphaned($pdo, $previousTerritoryId);
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $response = avesmapsPoliticalResponseForGeometry($pdo, (string) $geometry['public_id']);
    $response['territory_created'] = true;
    $response['assignment_saved'] = true;

    return $response;
}

function avesmapsPoliticalDeleteGeometry(PDO $pdo, array $payload, array $user = []): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );
    $geometryPublicId = (string) $geometry['public_id'];
    $beforeGeometrySnapshot = avesmapsPoliticalBuildGeometryAuditSnapshot($geometry);

    $territoryId = (int) ($geometry['territory_id'] ?? 0);
    $territory = null;
    $beforeTerritorySnapshot = null;
    $territoryDeleted = false;
    $remainingGeometryCount = 0;

    if ($territoryId > 0) {
        try {
            $territory = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
            $beforeTerritorySnapshot = avesmapsPoliticalBuildTerritoryAuditSnapshot($territory);
        } catch (InvalidArgumentException) {
            $territoryId = 0;
            $territory = null;
            $beforeTerritorySnapshot = null;
        }
    }

    $pdo->beginTransaction();
    try {
        avesmapsPoliticalSoftDeleteGeometryById($pdo, (int) $geometry['id']);

        // Abgeleitete Aussengrenze des Gebiets UND seiner Vorfahren deaktivieren: die
        // Quelle hat sich geaendert -> jedes daraus aggregierte Aggregat ist veraltet und
        // wuerde sonst als "Grenze, die nicht verschwinden will" weiterleben.
        if ($territoryId > 0) {
            avesmapsPoliticalDeactivateDerivedGeometryForTerritoryChain($pdo, $territoryId, (int) ($user['id'] ?? 0) ?: null);
        }

        if ($territoryId > 0 && $territory !== null) {
            $remainingGeometryCount = avesmapsPoliticalCountActiveGeometriesForTerritory($pdo, $territoryId);

            if ($remainingGeometryCount === 0 && empty($territory['wiki_id'])) {
                $statement = $pdo->prepare('UPDATE political_territory SET is_active = 0 WHERE id = :id');
                $statement->execute(['id' => $territoryId]);
                $territoryDeleted = true;
            }
        }

        $geometryAfterRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $geometryPublicId, true);
        $afterTerritorySnapshot = null;
        if ($territoryId > 0 && $territory !== null) {
            $territoryAfterRow = avesmapsPoliticalFetchTerritoryByIdForAudit($pdo, $territoryId, true);
            $afterTerritorySnapshot = $territoryAfterRow === null
                ? null
                : avesmapsPoliticalBuildTerritoryAuditSnapshot($territoryAfterRow);
        }
        avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            'delete_geometry',
            (int) ($user['id'] ?? 0),
            [
                'geometries' => [
                    $geometryPublicId => $beforeGeometrySnapshot,
                ],
                'territories' => $beforeTerritorySnapshot === null || $territory === null
                    ? []
                    : [(string) $territory['public_id'] => $beforeTerritorySnapshot],
            ],
            [
                'geometries' => [
                    $geometryPublicId => avesmapsPoliticalBuildGeometryAuditSnapshot($geometryAfterRow),
                ],
                'territories' => $afterTerritorySnapshot === null || $territory === null
                    ? []
                    : [(string) $territory['public_id'] => $afterTerritorySnapshot],
            ]
        );

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
        ], $user);
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

    $afterGeometryRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, (string) $geometry['public_id']);
    avesmapsPoliticalWriteGeometryAuditLog(
        $pdo,
        'delete_geometry_part',
        (int) ($user['id'] ?? 0),
        [
            'geometries' => [
                (string) $geometry['public_id'] => avesmapsPoliticalBuildGeometryAuditSnapshot($geometry),
            ],
            'territories' => [],
        ],
        [
            'geometries' => [
                (string) $geometry['public_id'] => avesmapsPoliticalBuildGeometryAuditSnapshot($afterGeometryRow),
            ],
            'territories' => [],
        ]
    );

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
        $result = avesmapsPoliticalCreateTerritory($pdo, $payload, $user);
        $territoryPublicId = (string) ($result['territory']['public_id'] ?? '');
        $geometryPublicId = (string) (($result['geometries'][0]['public_id'] ?? '') ?: ($result['geometry']['public_id'] ?? ''));
        if ($territoryPublicId !== '' && $geometryPublicId !== '') {
            $createdTerritory = avesmapsPoliticalFetchTerritoryByPublicIdForAudit($pdo, $territoryPublicId);
            $createdGeometry = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $geometryPublicId);
            avesmapsPoliticalWriteGeometryAuditLog(
                $pdo,
                'geometry_operation_intersection',
                (int) ($user['id'] ?? 0),
                [
                    'geometries' => [
                        $geometryPublicId => null,
                    ],
                    'territories' => [
                        $territoryPublicId => null,
                    ],
                ],
                [
                    'geometries' => [
                        $geometryPublicId => avesmapsPoliticalBuildGeometryAuditSnapshot($createdGeometry),
                    ],
                    'territories' => [
                        $territoryPublicId => avesmapsPoliticalBuildTerritoryAuditSnapshot($createdTerritory),
                    ],
                ]
            );
        }

        return $result;
    }

    $sourceGeometryPublicId = avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '');
    $deleteGeometryPublicId = avesmapsNormalizeSingleLine((string) ($payload['delete_geometry_public_id'] ?? ''), 36);
    $targetGeometryPublicId = $deleteGeometryPublicId === ''
        ? ''
        : avesmapsPoliticalReadPublicId($deleteGeometryPublicId);
    if ($targetGeometryPublicId !== '' && $sourceGeometryPublicId === $targetGeometryPublicId) {
        throw new InvalidArgumentException('Quelle und Ziel der Geometrieoperation muessen verschieden sein.');
    }

    $targetGeometryUpdate = null;
    if (array_key_exists('target_geometry_geojson', $payload) && $payload['target_geometry_geojson'] !== null && $payload['target_geometry_geojson'] !== '') {
        $targetGeometryUpdate = avesmapsPoliticalReadGeoJsonGeometry($payload['target_geometry_geojson']);
    }

    $pdo->beginTransaction();
    try {
        $sourceBeforeRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $sourceGeometryPublicId, true);
        if ($sourceBeforeRow === null || (int) ($sourceBeforeRow['is_active'] ?? 0) !== 1) {
            throw new InvalidArgumentException('Die Quellgeometrie wurde nicht gefunden.');
        }

        $targetBeforeRow = null;
        if ($targetGeometryPublicId !== '') {
            $targetBeforeRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $targetGeometryPublicId, true);
            if ($targetBeforeRow === null || (int) ($targetBeforeRow['is_active'] ?? 0) !== 1) {
                throw new InvalidArgumentException('Die Zielgeometrie wurde nicht gefunden.');
            }
        }

        $result = avesmapsPoliticalUpdateGeometry($pdo, [
            ...$payload,
            '_skip_audit' => true,
        ], $user);

        $sourceAfterRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $sourceGeometryPublicId, true);
        if ($sourceAfterRow === null) {
            throw new RuntimeException('Die aktualisierte Quellgeometrie konnte nicht gelesen werden.');
        }

        $targetAfterRow = null;
        if ($targetBeforeRow !== null) {
            if ($targetGeometryUpdate !== null) {
                avesmapsPoliticalUpdateGeometryRowGeometry($pdo, $targetBeforeRow, $targetGeometryUpdate, (string) ($payload['source'] ?? 'editor'), (int) ($user['id'] ?? 0));
            } else {
                avesmapsPoliticalSoftDeleteGeometryById($pdo, (int) $targetBeforeRow['id']);
                $result['deleted_geometry_public_id'] = $targetGeometryPublicId;
            }
            $targetAfterRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $targetGeometryPublicId, true);
        }

        $beforeGeometries = [
            $sourceGeometryPublicId => avesmapsPoliticalBuildGeometryAuditSnapshot($sourceBeforeRow),
        ];
        $afterGeometries = [
            $sourceGeometryPublicId => avesmapsPoliticalBuildGeometryAuditSnapshot($sourceAfterRow),
        ];
        if ($targetBeforeRow !== null) {
            $beforeGeometries[$targetGeometryPublicId] = avesmapsPoliticalBuildGeometryAuditSnapshot($targetBeforeRow);
            $afterGeometries[$targetGeometryPublicId] = avesmapsPoliticalBuildGeometryAuditSnapshot($targetAfterRow);
        }

        avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            'geometry_operation_' . $operation,
            (int) ($user['id'] ?? 0),
            [
                'geometries' => $beforeGeometries,
                'territories' => [],
            ],
            [
                'geometries' => $afterGeometries,
                'territories' => [],
            ]
        );

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return $result;
}

function avesmapsPoliticalPickActiveGeometrySnapshot(array $geometries): ?array {
    foreach ($geometries as $snapshot) {
        if (is_array($snapshot) && (int) ($snapshot['is_active'] ?? 0) === 1) {
            return $snapshot;
        }
    }

    return null;
}

function avesmapsPoliticalPickFirstGeometrySnapshot(array $geometries): ?array {
    foreach ($geometries as $snapshot) {
        if (is_array($snapshot)) {
            return $snapshot;
        }
    }

    return null;
}

function avesmapsPoliticalUpdateGeometryRowGeometry(PDO $pdo, array $geometryRow, array $geometry, string $source, int $updatedBy): void {
    $bounds = avesmapsPoliticalCalculateGeometryBounds($geometry);
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
        'id' => (int) ($geometryRow['id'] ?? 0),
        'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
        'min_x' => $bounds['min_x'],
        'min_y' => $bounds['min_y'],
        'max_x' => $bounds['max_x'],
        'max_y' => $bounds['max_y'],
        'source' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine($source, 255)),
        'updated_by' => $updatedBy > 0 ? $updatedBy : null,
    ]);
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

// Endgueltiger Hard-Delete EINER verwaisten Geometrie (= keinem AKTIVEN Territorium zugewiesen).
// Schutz: eine einer aktiven Gebietszuweisung haengende Geometrie ist tabu (Verwechslungsschutz).
function avesmapsPoliticalHardDeleteUnassignedGeometry(PDO $pdo, array $payload, array $user = []): array {
    $publicId = avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '');
    $geometry = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $publicId);
    if ($geometry === null) {
        return ['ok' => false, 'error' => 'Die Geometrie wurde nicht gefunden.'];
    }
    $territoryId = (int) ($geometry['territory_id'] ?? 0);
    if ($territoryId > 0) {
        $stmt = $pdo->prepare('SELECT name FROM political_territory WHERE id = :id AND is_active = 1');
        $stmt->execute(['id' => $territoryId]);
        $activeTerritory = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($activeTerritory) {
            return ['ok' => false, 'error' => 'Geometrie ist dem aktiven Gebiet "' . (string) $activeTerritory['name'] . '" zugewiesen - nicht endgueltig loeschbar.'];
        }
    }
    $statement = $pdo->prepare('DELETE FROM political_territory_geometry WHERE id = :id');
    $statement->execute(['id' => (int) $geometry['id']]);
    return ['ok' => true, 'deleted' => $statement->rowCount(), 'geometry_public_id' => $publicId];
}

// Bulk: ALLE verwaisten Geometrien (kein aktives Territorium) endgueltig loeschen.
// Gated: schreibt nur bei confirm:"apply", sonst lesender Dry-Run (zaehlt nur Kandidaten).
function avesmapsPoliticalPurgeUnassignedGeometries(PDO $pdo, array $payload, array $user = []): array {
    $apply = (string) ($payload['confirm'] ?? '') === 'apply';
    $orphanWhere =
        'FROM political_territory_geometry g
         LEFT JOIN political_territory t ON t.id = g.territory_id AND t.is_active = 1
         WHERE t.id IS NULL';
    $candidates = (int) ($pdo->query('SELECT COUNT(*) AS c ' . $orphanWhere)->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);
    if (!$apply) {
        return ['ok' => true, 'dry_run' => true, 'candidates' => $candidates, 'deleted' => 0];
    }
    $del = $pdo->prepare('DELETE g ' . $orphanWhere);
    $del->execute();
    return ['ok' => true, 'dry_run' => false, 'candidates' => $candidates, 'deleted' => $del->rowCount()];
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

function avesmapsPoliticalInsertGeometry(PDO $pdo, ?int $territoryId, array $geometry, array $payload, array $user): string {
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
        'territory_id' => $territoryId !== null && $territoryId > 0 ? $territoryId : null,
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

function avesmapsPoliticalBuildFreeGeometryFeatureFromStoredRow(array $geometry): array {
    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $name = trim((string) ($style['displayName'] ?? $style['name'] ?? '')) ?: 'Freie Geometrie';
    $color = (string) ($style['fill'] ?? $style['stroke'] ?? '#888888');
    $opacity = (float) ($style['fillOpacity'] ?? 0.33);

    $row = [
        'geometry_public_id' => (string) $geometry['public_id'],
        'geometry_id' => (int) $geometry['id'],
        'territory_id' => 0,
        'territory_public_id' => '',
        'geometry_geojson' => $geometry['geometry_geojson'],
        'geometry_valid_from_bf' => $geometry['valid_from_bf'] ?? null,
        'geometry_valid_to_bf' => $geometry['valid_to_bf'] ?? null,
        'geometry_min_zoom' => $geometry['min_zoom'] ?? null,
        'geometry_max_zoom' => $geometry['max_zoom'] ?? null,
        'style_json' => $geometry['style_json'] ?? null,
        'geometry_style_json' => $geometry['style_json'] ?? null,
        'updated_at' => $geometry['updated_at'] ?? '',
        'name' => '',
        'short_name' => '',
        'type' => 'Freie Geometrie',
        'status' => '',
        'color' => $color,
        'opacity' => $opacity,
        'coat_of_arms_url' => (string) ($style['coatOfArmsUrl'] ?? $style['coat_of_arms_url'] ?? ''),
        'wiki_url' => '',
        'wiki_id' => null,
        'wiki_name' => '',
        'capital_name' => '',
        'seat_name' => '',
        'capital_place_id' => null,
        'seat_place_id' => null,
        'capital_place_public_id' => '',
        'seat_place_public_id' => '',
        'affiliation_raw' => '',
        'affiliation_root' => '',
        'affiliation_path_json' => null,
        'parent_public_id' => '',
        'parent_name' => '',
        'valid_label' => '',
        'founded_text' => '',
        'dissolved_text' => '',
    ];

    $feature = avesmapsPoliticalLayerRowToFeature($row, AVESMAPS_POLITICAL_DEFAULT_YEAR_BF, 0);
    $feature['properties']['name'] = $name;
    $feature['properties']['display_name'] = $name;
    $feature['properties']['label_name'] = $name;
    $feature['properties']['label_display_name'] = $name;

    return $feature;
}

function avesmapsPoliticalResponseForGeometry(PDO $pdo, string $geometryPublicId): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId($pdo, $geometryPublicId);
    $territoryId = avesmapsPoliticalNullableInt($geometry['territory_id'] ?? null);

    if ($territoryId === null || $territoryId < 1) {
        return [
            'ok' => true,
            'territory' => null,
            'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
            'geometry_public_id' => (string) $geometry['public_id'],
            'territory_public_id' => '',
            'feature' => avesmapsPoliticalBuildFreeGeometryFeatureFromStoredRow($geometry),
        ];
    }

    try {
        $territory = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
    } catch (InvalidArgumentException) {
        return [
            'ok' => true,
            'territory' => null,
            'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
            'geometry_public_id' => (string) $geometry['public_id'],
            'territory_public_id' => '',
            'feature' => avesmapsPoliticalBuildFreeGeometryFeatureFromStoredRow($geometry),
        ];
    }

    return [
        'ok' => true,
        'territory' => avesmapsPoliticalTerritoryRowToPublic($territory),
        'geometry' => avesmapsPoliticalGeometryRowToPublic($geometry),
        'geometry_public_id' => (string) $geometry['public_id'],
        'territory_public_id' => (string) ($territory['public_id'] ?? ''),
        'feature' => avesmapsPoliticalBuildFeatureFromStoredRows($territory, $geometry),
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

function avesmapsPoliticalFetchGeometryRowByPublicIdRaw(PDO $pdo, string $publicId, bool $forUpdate = false): ?array {
    $sql = 'SELECT *
        FROM political_territory_geometry
        WHERE public_id = :public_id
        LIMIT 1';
    if ($forUpdate) {
        $sql .= ' FOR UPDATE';
    }

    $statement = $pdo->prepare($sql);
    $statement->execute(['public_id' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
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

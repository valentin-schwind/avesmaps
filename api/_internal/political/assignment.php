<?php

declare(strict_types=1);

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

    try {
        $current = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
    } catch (InvalidArgumentException) {
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
            'orphaned_assignment' => true,
        ];
    }

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
        $display = avesmapsPoliticalResolveDisplayStateForTerritory($displays, $territory, $index);

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
                valid_to_bf = :valid_to_bf,
                is_active = 1
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
                ? null
                : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territory['valid_to_bf'] ?? null),
        ]);
    }

    $selectedDisplay = avesmapsPoliticalResolveDisplayStateForTerritory(
        $displays,
        $selectedTerritory,
        max(0, count($chainRows) - 1)
    );

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
    $wikiPublicIds = [];
    if (is_array($payload['wiki_public_ids'] ?? null)) {
        foreach ($payload['wiki_public_ids'] as $wikiPublicId) {
            $normalizedWikiPublicId = trim((string) $wikiPublicId);
            if ($normalizedWikiPublicId !== '') {
                $wikiPublicIds[] = $normalizedWikiPublicId;
            }
        }
    }

    $territoryPublicIds = [];
    if (is_array($payload['territory_public_ids'] ?? null)) {
        foreach ($payload['territory_public_ids'] as $territoryPublicId) {
            $normalizedTerritoryPublicId = trim((string) $territoryPublicId);
            if ($normalizedTerritoryPublicId !== '') {
                $territoryPublicIds[] = $normalizedTerritoryPublicId;
            }
        }
    }

    $chain = [];
    if ($wikiPublicIds !== []) {
        $chainResponse = avesmapsPoliticalEnsureWikiTerritoryChain($pdo, [
            ...$payload,
            'wiki_public_ids' => $wikiPublicIds,
        ], $user);
        $chain = is_array($chainResponse['chain'] ?? null) ? array_values($chainResponse['chain']) : [];
    } elseif ($territoryPublicIds !== []) {
        $chain = avesmapsPoliticalBuildAssignmentChainFromTerritoryPublicIds($pdo, $territoryPublicIds);
    }

    if ($chain === [] && !empty($payload['create_territory_if_missing'])) {
        return avesmapsPoliticalCreateTerritoryForGeometry($pdo, $payload, $user, $geometry);
    }

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
        $display = avesmapsPoliticalResolveDisplayStateForTerritory($displays, $territory, $index);
        
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
                valid_to_bf = :valid_to_bf,
                is_active = 1
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
                ? null
                : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territory['valid_to_bf'] ?? null),
        ]);
    }

    $selectedEntry = $chain[count($chain) - 1] ?? null;
    $selectedTerritoryPublicId = (string) ($selectedEntry['territory']['public_id'] ?? '');
    if ($selectedTerritoryPublicId === '') {
        throw new InvalidArgumentException('Das Ziel-Herrschaftsgebiet fehlt.');
    }

    $selectedTerritory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $selectedTerritoryPublicId);
    $selectedDisplay = avesmapsPoliticalResolveDisplayStateForTerritory(
        $displays,
        $selectedTerritory,
        max(0, count($chain) - 1)
    );

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

function avesmapsPoliticalBuildAssignmentChainFromTerritoryPublicIds(PDO $pdo, array $territoryPublicIds): array {
    $chain = [];
    $seenTerritoryPublicIds = [];

    foreach ($territoryPublicIds as $territoryPublicId) {
        try {
            $normalizedTerritoryPublicId = avesmapsPoliticalReadPublicId($territoryPublicId);
        } catch (InvalidArgumentException) {
            continue;
        }

        if ($normalizedTerritoryPublicId === '' || isset($seenTerritoryPublicIds[$normalizedTerritoryPublicId])) {
            continue;
        }
        $seenTerritoryPublicIds[$normalizedTerritoryPublicId] = true;

        $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $normalizedTerritoryPublicId);
        $wikiPublicId = '';
        $wikiPayload = [
            'key' => $normalizedTerritoryPublicId,
            'name' => (string) ($territory['name'] ?? ''),
            'type' => (string) ($territory['type'] ?? 'Herrschaftsgebiet'),
            'status' => (string) ($territory['status'] ?? ''),
            'coat_of_arms_url' => (string) ($territory['coat_of_arms_url'] ?? ''),
            'wiki_url' => (string) ($territory['wiki_url'] ?? ''),
        ];

        if (!empty($territory['wiki_id'])) {
            try {
                $wiki = avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']);
                $wikiPublicId = (string) ($wiki['wiki_key'] ?? '');
                $wikiPayload = avesmapsPoliticalWikiRowToPublic($wiki);
            } catch (Throwable) {
                $wikiPublicId = '';
            }
        }

        $chain[] = [
            'territory' => avesmapsPoliticalTerritoryRowToPublic($territory),
            'wiki' => $wikiPayload,
            'wiki_public_id' => $wikiPublicId,
        ];
    }

    return $chain;
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
    $territoryId = (int) ($geometry['territory_id'] ?? 0);
    $territory = $territoryId > 0 ? avesmapsPoliticalFetchTerritoryById($pdo, $territoryId) : null;
    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    [$minZoom, $maxZoom] = avesmapsPoliticalResolveUnassignedGeometryZoomRange($geometry, $territory, $style);

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = NULL,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            source = :source
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
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

function avesmapsPoliticalResolveUnassignedGeometryZoomRange(array $geometry, ?array $territory, array $style): array {
    $fallbackMinZoom = avesmapsPoliticalNullableInt($geometry['min_zoom'] ?? null);
    $fallbackMaxZoom = avesmapsPoliticalNullableInt($geometry['max_zoom'] ?? null);
    $territoryMinZoom = avesmapsPoliticalNullableInt($territory['min_zoom'] ?? null);
    $territoryMaxZoom = avesmapsPoliticalNullableInt($territory['max_zoom'] ?? null);
    $displays = avesmapsPoliticalReadAssignmentDisplaysFromStyle($style);
    $selectedDisplay = null;

    if ($displays !== []) {
        $selectedDisplay = $displays[count($displays) - 1];
    }

    $minZoom = avesmapsPoliticalReadOptionalZoom(
        $selectedDisplay['zoomMin']
        ?? $selectedDisplay['zoom_min']
        ?? $fallbackMinZoom
        ?? $territoryMinZoom
    );
    $maxZoom = avesmapsPoliticalReadOptionalZoom(
        $selectedDisplay['zoomMax']
        ?? $selectedDisplay['zoom_max']
        ?? $fallbackMaxZoom
        ?? $territoryMaxZoom
    );
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

    return [$minZoom, $maxZoom];
}

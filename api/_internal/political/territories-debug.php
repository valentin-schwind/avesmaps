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

    return array_merge(
        [
            'territory_count' => (int) ($summary['territory_count'] ?? 0),
            'active_territory_count' => (int) ($summary['active_territory_count'] ?? 0),
            'root_count' => (int) ($summary['root_count'] ?? 0),
            'geometry_count' => (int) ($geometrySummary['geometry_count'] ?? 0),
            'active_geometry_count' => (int) ($geometrySummary['active_geometry_count'] ?? 0),
        ],
        avesmapsPoliticalReadDerivedGeometryDiagnostics($pdo),
        avesmapsPoliticalReadDisplaySnapshotDiagnostics($pdo)
    );
}

// Phase-1-Diagnose: abgeleitete Außengrenzen zaehlen und Mehrdeutigkeiten
// (mehr als eine aktive Derived-Geometrie pro Territorium) aufdecken. Read-only.
function avesmapsPoliticalReadDerivedGeometryDiagnostics(PDO $pdo): array {
    $countStatement = $pdo->query(
        'SELECT
            COUNT(*) AS derived_geometry_count,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_derived_geometry_count
        FROM political_territory_derived_geometry'
    );
    $counts = $countStatement !== false ? ($countStatement->fetch(PDO::FETCH_ASSOC) ?: []) : [];

    $multiStatement = $pdo->query(
        'SELECT
            derived.territory_id,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            COUNT(*) AS active_count
        FROM political_territory_derived_geometry derived
        LEFT JOIN political_territory territory ON territory.id = derived.territory_id
        WHERE derived.is_active = 1
        GROUP BY derived.territory_id, territory.public_id, territory.name
        HAVING COUNT(*) > 1
        ORDER BY active_count DESC, territory.name ASC'
    );
    $territoriesWithMultiple = [];
    foreach (($multiStatement !== false ? $multiStatement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
        $territoriesWithMultiple[] = [
            'territory_id' => (int) ($row['territory_id'] ?? 0),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            'territory_name' => (string) ($row['territory_name'] ?? ''),
            'active_count' => (int) ($row['active_count'] ?? 0),
        ];
    }

    // Verwaiste Außengrenzen: eine AKTIVE Derived-Geometrie, deren Ziel-Territorium fehlt
    // (geloescht) ODER inaktiv (is_active=0) ist. Solche Huellen rendern nicht (der Layer joint
    // is_active=1), bleiben aber als Leichen in der DB liegen -- read-only Diagnose.
    $orphanStatement = $pdo->query(
        'SELECT
            derived.id AS derived_id,
            derived.public_id AS derived_public_id,
            derived.territory_id,
            derived.updated_at,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            CASE WHEN territory.id IS NULL THEN \'missing\' ELSE \'inactive\' END AS orphan_reason
        FROM political_territory_derived_geometry derived
        LEFT JOIN political_territory territory ON territory.id = derived.territory_id
        WHERE derived.is_active = 1
            AND (territory.id IS NULL OR territory.is_active = 0)
        ORDER BY territory.name ASC, derived.id ASC'
    );
    $orphanedActiveDerived = [];
    foreach (($orphanStatement !== false ? $orphanStatement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
        $orphanedActiveDerived[] = [
            'derived_id' => (int) ($row['derived_id'] ?? 0),
            'derived_public_id' => (string) ($row['derived_public_id'] ?? ''),
            'territory_id' => (int) ($row['territory_id'] ?? 0),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            'territory_name' => (string) ($row['territory_name'] ?? ''),
            'orphan_reason' => (string) ($row['orphan_reason'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    return [
        'derived_geometry_count' => (int) ($counts['derived_geometry_count'] ?? 0),
        'active_derived_geometry_count' => (int) ($counts['active_derived_geometry_count'] ?? 0),
        'territories_with_multiple_active_derived' => $territoriesWithMultiple,
        'orphaned_active_derived_count' => count($orphanedActiveDerived),
        'orphaned_active_derived' => $orphanedActiveDerived,
    ];
}

// Phase-1-Diagnose: Legacy-Snapshots in style_json.assignmentDisplays zaehlen und
// Abweichungen gegenueber der globalen Territoriumswahrheit (political_territory)
// listen. Veraendert keine Daten.
function avesmapsPoliticalReadDisplaySnapshotDiagnostics(PDO $pdo, int $conflictLimit = 100): array {
    $globals = [];
    $territoryStatement = $pdo->query(
        'SELECT public_id, name, color, opacity, min_zoom, max_zoom, valid_from_bf, valid_to_bf
        FROM political_territory
        WHERE continent = ' . $pdo->quote(AVESMAPS_POLITICAL_DEFAULT_CONTINENT)
    );
    foreach (($territoryStatement !== false ? $territoryStatement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
        $globals[(string) ($row['public_id'] ?? '')] = $row;
    }

    $statement = $pdo->query(
        "SELECT
            geometry.public_id AS geometry_public_id,
            geometry.is_active,
            geometry.style_json
        FROM political_territory_geometry geometry
        WHERE geometry.style_json IS NOT NULL
            AND (
                JSON_CONTAINS_PATH(geometry.style_json, 'one', '$.assignmentDisplays')
                OR JSON_CONTAINS_PATH(geometry.style_json, 'one', '$.assignment_displays')
            )"
    );

    $geometriesWithDisplays = 0;
    $localOverrideDisplayCount = 0;
    $conflictCount = 0;
    $conflicts = [];

    foreach (($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
        $geometriesWithDisplays++;
        $style = avesmapsPoliticalDecodeJson($row['style_json'] ?? null);
        if ($style === []) {
            continue;
        }

        foreach (avesmapsPoliticalReadAssignmentDisplaysFromStyle($style) as $display) {
            $isOverride = !empty($display['localOverride']) || !empty($display['local_override']);
            if ($isOverride) {
                $localOverrideDisplayCount++;
            }

            $displayTerritoryPublicId = (string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? '');
            $global = $globals[$displayTerritoryPublicId] ?? null;
            if ($global === null) {
                continue;
            }

            $fields = avesmapsPoliticalCompareDisplaySnapshotToGlobal($display, $global);
            if ($fields === []) {
                continue;
            }

            $conflictCount++;
            if (count($conflicts) < $conflictLimit) {
                $conflicts[] = [
                    'geometry_public_id' => (string) ($row['geometry_public_id'] ?? ''),
                    'geometry_is_active' => (int) ($row['is_active'] ?? 0) === 1,
                    'territory_public_id' => $displayTerritoryPublicId,
                    'territory_name' => (string) ($global['name'] ?? ''),
                    'local_override' => $isOverride,
                    'fields' => $fields,
                ];
            }
        }
    }

    return [
        'geometries_with_assignment_displays' => $geometriesWithDisplays,
        'local_override_display_count' => $localOverrideDisplayCount,
        'display_snapshot_conflict_count' => $conflictCount,
        'display_snapshot_conflict_limit' => $conflictLimit,
        'display_snapshot_conflicts' => $conflicts,
    ];
}

// Vergleicht einen Snapshot-Display gegen die globalen Territoriumswerte.
// Liefert pro abweichendem Feld {snapshot, global}. Nur gesetzte Snapshot-Werte
// werden geprueft, damit fehlende Felder keine Scheinkonflikte erzeugen.
function avesmapsPoliticalCompareDisplaySnapshotToGlobal(array $display, array $global): array {
    $fields = [];

    $snapshotColor = trim((string) ($display['color'] ?? ''));
    if ($snapshotColor !== '') {
        $globalColor = avesmapsPoliticalReadHexColor($global['color'] ?? '');
        if (strtolower($snapshotColor) !== strtolower($globalColor)) {
            $fields['color'] = ['snapshot' => $snapshotColor, 'global' => $globalColor];
        }
    }

    if (($display['opacity'] ?? null) !== null && isset($global['opacity'])) {
        $snapshotOpacity = round((float) $display['opacity'], 3);
        $globalOpacity = round((float) $global['opacity'], 3);
        if (abs($snapshotOpacity - $globalOpacity) > 0.0005) {
            $fields['opacity'] = ['snapshot' => $snapshotOpacity, 'global' => $globalOpacity];
        }
    }

    $snapshotZoomMin = $display['zoomMin'] ?? null;
    if ($snapshotZoomMin !== null) {
        $globalZoomMin = avesmapsPoliticalNullableInt($global['min_zoom'] ?? null);
        if ($snapshotZoomMin !== $globalZoomMin) {
            $fields['zoom_min'] = ['snapshot' => $snapshotZoomMin, 'global' => $globalZoomMin];
        }
    }

    $snapshotZoomMax = $display['zoomMax'] ?? null;
    if ($snapshotZoomMax !== null) {
        $globalZoomMax = avesmapsPoliticalNullableInt($global['max_zoom'] ?? null);
        if ($snapshotZoomMax !== $globalZoomMax) {
            $fields['zoom_max'] = ['snapshot' => $snapshotZoomMax, 'global' => $globalZoomMax];
        }
    }

    $snapshotStartYear = $display['startYear'] ?? null;
    if ($snapshotStartYear !== null) {
        $globalStartYear = avesmapsPoliticalNullableInt($global['valid_from_bf'] ?? null);
        if ($snapshotStartYear !== $globalStartYear) {
            $fields['start_year'] = ['snapshot' => $snapshotStartYear, 'global' => $globalStartYear];
        }
    }

    $snapshotEndYear = !empty($display['existsUntilToday']) ? null : ($display['endYear'] ?? null);
    if ($snapshotEndYear !== null) {
        $globalEndYear = avesmapsPoliticalNullableInt($global['valid_to_bf'] ?? null);
        if ($snapshotEndYear !== $globalEndYear) {
            $fields['end_year'] = ['snapshot' => $snapshotEndYear, 'global' => $globalEndYear];
        }
    }

    return $fields;
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

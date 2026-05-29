<?php

declare(strict_types=1);

function avesmapsPoliticalReadDerivedGeometryPlan(PDO $pdo, array $query): array {
    $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $query, false);
    $territory = $target['territory'] ?? null;
    $selectedYear = avesmapsPoliticalNullableInt($query['selected_year_bf'] ?? $query['year_bf'] ?? null);
    $applyToSubregions = avesmapsPoliticalReadBoolean($query['apply_to_subregions'] ?? false);

    if (!is_array($territory)) {
        return [
            'ok' => true,
            'target_key' => $target['target_key'],
            'target_name' => $target['target_name'],
            'territory_public_id' => '',
            'selected_year_bf' => $selectedYear,
            'apply_to_subregions' => $applyToSubregions,
            'plan_nodes' => [],
            'recompute_targets' => [],
            'ancestors_to_refresh' => [],
            'warnings' => [[
                'code' => 'target_territory_missing',
                'message' => 'Fuer das ausgewaehlte Ziel wurde kein gespeichertes Herrschaftsgebiet gefunden.',
            ]],
            'blocking_warnings' => [],
        ];
    }

    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $childrenByParent = avesmapsPoliticalBuildDerivedGeometryChildrenIndex($territories);
    $subtreeIds = avesmapsPoliticalCollectDerivedGeometrySubtreeIds((int) $territory['id'], $childrenByParent);
    $ancestorIds = avesmapsPoliticalCollectDerivedGeometryAncestorIds((int) $territory['id'], $territories);
    $plannedIds = array_values(array_unique(array_merge($subtreeIds, $ancestorIds)));

    $directGeometryIndex = avesmapsPoliticalFetchDerivedGeometryPlanSourceIndex($pdo, $subtreeIds, $selectedYear);
    $activeDerivedIndex = avesmapsPoliticalFetchActiveDerivedGeometryIndex($pdo, $plannedIds);
    $nodeStates = [];
    $warnings = [];
    $blockingWarnings = [];

    foreach ($subtreeIds as $territoryId) {
        $visitWarning = avesmapsPoliticalDetectDerivedGeometryPlanCycle($territoryId, $territories);
        if ($visitWarning !== null) {
            $blockingWarnings[] = $visitWarning;
        }
    }

    foreach (array_reverse($subtreeIds) as $territoryId) {
        $row = $territories[$territoryId] ?? null;
        if (!is_array($row)) {
            continue;
        }

        $childIds = $childrenByParent[$territoryId] ?? [];
        $sourceGeometries = $directGeometryIndex[$territoryId] ?? [];
        $childSourceIds = [];
        foreach ($childIds as $childId) {
            $childState = $nodeStates[(int) $childId] ?? null;
            if (($childState['can_generate_boundary'] ?? false) === true) {
                $childSourceIds[] = (int) $childId;
            }
        }

        $canGenerate = count($sourceGeometries) > 0 || count($childSourceIds) > 0;
        if (!$canGenerate) {
            $warnings[] = [
                'code' => 'no_boundary_sources',
                'territory_public_id' => (string) ($row['public_id'] ?? ''),
                'territory_name' => (string) ($row['name'] ?? ''),
                'message' => 'Dieses Herrschaftsgebiet hat im betrachteten Stand keine gueltigen Quellen fuer eine Außengrenze.',
            ];
        }

        $nodeStates[$territoryId] = [
            'territory_id' => (int) $territoryId,
            'territory_public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'short_name' => (string) ($row['short_name'] ?? ''),
            'parent_id' => (int) ($row['parent_id'] ?? 0),
            'child_count' => count($childIds),
            'children' => avesmapsPoliticalDescribePlanTerritories($childIds, $territories),
            'direct_geometry_count' => count($sourceGeometries),
            'direct_geometries' => $sourceGeometries,
            'child_boundary_source_count' => count($childSourceIds),
            'child_boundary_sources' => avesmapsPoliticalDescribePlanTerritories($childSourceIds, $territories),
            'can_generate_boundary' => $canGenerate,
            'has_active_derived_boundary' => isset($activeDerivedIndex[$territoryId]),
            'active_derived_boundary' => $activeDerivedIndex[$territoryId] ?? null,
            'source_revision_hint' => avesmapsPoliticalBuildDerivedGeometryPlanSourceRevision($sourceGeometries, $childSourceIds, $activeDerivedIndex),
        ];
    }

    $recomputeIds = $applyToSubregions
        ? array_values(array_filter($subtreeIds, static fn(int $id): bool => ($nodeStates[$id]['can_generate_boundary'] ?? false) === true))
        : [
            (int) $territory['id'],
        ];
    $recomputeIds = array_values(array_unique(array_merge($recomputeIds, $ancestorIds)));

    return [
        'ok' => true,
        'target_key' => $target['target_key'],
        'target_name' => $target['target_name'],
        'territory_public_id' => (string) ($territory['public_id'] ?? ''),
        'selected_year_bf' => $selectedYear,
        'apply_to_subregions' => $applyToSubregions,
        'plan_nodes' => array_values($nodeStates),
        'recompute_targets' => avesmapsPoliticalDescribePlanTerritories($recomputeIds, $territories),
        'ancestors_to_refresh' => avesmapsPoliticalDescribePlanTerritories($ancestorIds, $territories),
        'warnings' => $warnings,
        'blocking_warnings' => $blockingWarnings,
    ];
}

function avesmapsPoliticalBuildDerivedGeometryChildrenIndex(array $territories): array {
    $childrenByParent = [];
    foreach ($territories as $territoryId => $territory) {
        $parentId = (int) ($territory['parent_id'] ?? 0);
        if ($parentId > 0) {
            $childrenByParent[$parentId] ??= [];
            $childrenByParent[$parentId][] = (int) $territoryId;
        }
    }

    return $childrenByParent;
}

function avesmapsPoliticalCollectDerivedGeometrySubtreeIds(int $territoryId, array $childrenByParent): array {
    $result = [];
    $queue = [$territoryId];
    $visited = [];
    while ($queue !== []) {
        $currentId = (int) array_shift($queue);
        if ($currentId < 1 || isset($visited[$currentId])) {
            continue;
        }

        $visited[$currentId] = true;
        $result[] = $currentId;
        foreach ($childrenByParent[$currentId] ?? [] as $childId) {
            $queue[] = (int) $childId;
        }
    }

    return $result;
}

function avesmapsPoliticalCollectDerivedGeometryAncestorIds(int $territoryId, array $territories): array {
    $ancestors = [];
    $visited = [$territoryId => true];
    $current = $territories[$territoryId] ?? null;
    while (is_array($current)) {
        $parentId = (int) ($current['parent_id'] ?? 0);
        if ($parentId < 1 || isset($visited[$parentId])) {
            break;
        }

        $visited[$parentId] = true;
        $ancestors[] = $parentId;
        $current = $territories[$parentId] ?? null;
    }

    return $ancestors;
}

function avesmapsPoliticalDetectDerivedGeometryPlanCycle(int $territoryId, array $territories): ?array {
    $visited = [];
    $currentId = $territoryId;
    while ($currentId > 0) {
        if (isset($visited[$currentId])) {
            return [
                'code' => 'hierarchy_cycle',
                'territory_id' => $territoryId,
                'message' => 'Die Herrschaftsgebiet-Hierarchie enthaelt einen Zyklus. Außengrenzen koennen dafuer nicht geplant werden.',
            ];
        }

        $visited[$currentId] = true;
        $current = $territories[$currentId] ?? null;
        if (!is_array($current)) {
            return null;
        }

        $currentId = (int) ($current['parent_id'] ?? 0);
    }

    return null;
}

function avesmapsPoliticalFetchDerivedGeometryPlanSourceIndex(PDO $pdo, array $territoryIds, ?int $selectedYear): array {
    $territoryIds = array_values(array_unique(array_filter(array_map('intval', $territoryIds), static fn(int $id): bool => $id > 0)));
    if ($territoryIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($territoryIds), '?'));
    $params = $territoryIds;
    $timelineSql = '';
    if ($selectedYear !== null) {
        $timelineSql = ' AND (geometry.valid_from_bf IS NULL OR geometry.valid_from_bf <= ?) AND (geometry.valid_to_bf IS NULL OR geometry.valid_to_bf >= ?)';
        $params[] = $selectedYear;
        $params[] = $selectedYear;
    }

    $statement = $pdo->prepare(
        'SELECT
            geometry.id,
            geometry.public_id,
            geometry.territory_id,
            geometry.valid_from_bf,
            geometry.valid_to_bf,
            geometry.updated_at
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1
            AND geometry.territory_id IN (' . $placeholders . ')' . $timelineSql . '
        ORDER BY geometry.territory_id ASC, geometry.id ASC'
    );
    $statement->execute($params);

    $index = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        if ($territoryId < 1) {
            continue;
        }

        $index[$territoryId] ??= [];
        $index[$territoryId][] = [
            'geometry_id' => (int) $row['id'],
            'geometry_public_id' => (string) $row['public_id'],
            'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
            'valid_to_bf' => avesmapsPoliticalNullableInt($row['valid_to_bf'] ?? null),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    return $index;
}

function avesmapsPoliticalFetchActiveDerivedGeometryIndex(PDO $pdo, array $territoryIds): array {
    $territoryIds = array_values(array_unique(array_filter(array_map('intval', $territoryIds), static fn(int $id): bool => $id > 0)));
    if ($territoryIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($territoryIds), '?'));
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_derived_geometry
        WHERE is_active = 1
            AND territory_id IN (' . $placeholders . ')
        ORDER BY territory_id ASC, updated_at DESC, id DESC'
    );
    $statement->execute($territoryIds);

    $index = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        if ($territoryId < 1 || isset($index[$territoryId])) {
            continue;
        }

        $index[$territoryId] = avesmapsPoliticalDerivedGeometryRowToPublic($row);
    }

    return $index;
}

function avesmapsPoliticalDescribePlanTerritories(array $territoryIds, array $territories): array {
    $items = [];
    foreach ($territoryIds as $territoryId) {
        $territoryId = (int) $territoryId;
        $territory = $territories[$territoryId] ?? null;
        if (!is_array($territory)) {
            continue;
        }

        $items[] = [
            'territory_id' => $territoryId,
            'territory_public_id' => (string) ($territory['public_id'] ?? ''),
            'name' => (string) ($territory['name'] ?? ''),
            'short_name' => (string) ($territory['short_name'] ?? ''),
        ];
    }

    return $items;
}

function avesmapsPoliticalBuildDerivedGeometryPlanSourceRevision(array $sourceGeometries, array $childSourceIds, array $activeDerivedIndex): string {
    $parts = [];
    foreach ($sourceGeometries as $sourceGeometry) {
        $parts[] = 'geometry:' . ($sourceGeometry['geometry_public_id'] ?? '') . ':' . ($sourceGeometry['updated_at'] ?? '');
    }

    foreach ($childSourceIds as $childSourceId) {
        $derived = $activeDerivedIndex[(int) $childSourceId] ?? null;
        $parts[] = 'child:' . (int) $childSourceId . ':' . (is_array($derived) ? (string) ($derived['source_revision'] ?? '') . ':' . (string) ($derived['generated_at'] ?? '') : 'planned');
    }

    sort($parts, SORT_STRING);
    return sha1(implode('|', $parts));
}

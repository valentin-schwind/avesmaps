<?php

declare(strict_types=1);

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
        $existsUntilToday = array_key_exists('existsUntilToday', $rawDisplay)
            ? filter_var($rawDisplay['existsUntilToday'], FILTER_VALIDATE_BOOL)
            : (
                array_key_exists('exists_until_today', $rawDisplay)
                    ? filter_var($rawDisplay['exists_until_today'], FILTER_VALIDATE_BOOL)
                    : false
            );

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
            'startYear' => avesmapsPoliticalNullableInt($rawDisplay['startYear'] ?? $rawDisplay['start_year'] ?? null),
            'endYear' => $existsUntilToday ? null : avesmapsPoliticalNullableInt($rawDisplay['endYear'] ?? $rawDisplay['end_year'] ?? null),
            'existsUntilToday' => $existsUntilToday,
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
    if ($displayName !== '' && !avesmapsPoliticalIsGenericHierarchyRootName($displayName)) {
        return $displayName;
    }

    $originalName = trim((string) ($display['originalName'] ?? $display['original_name'] ?? ''));
    if ($originalName !== '' && !avesmapsPoliticalIsGenericHierarchyRootName($originalName)) {
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

    $territoryValidTo = avesmapsPoliticalReadOptionalInt($territory['valid_to_bf'] ?? null);
    $displayHasExplicitTodayFlag = array_key_exists('existsUntilToday', $display) || array_key_exists('exists_until_today', $display);
    $existsUntilToday = $displayHasExplicitTodayFlag
        ? filter_var($display['existsUntilToday'] ?? $display['exists_until_today'] ?? false, FILTER_VALIDATE_BOOL)
        : ($territoryValidTo === null || $territoryValidTo >= 9999);

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
        'endYear' => $existsUntilToday
            ? null
            : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territoryValidTo),
        'existsUntilToday' => $existsUntilToday,
        'depth' => $depth,
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
            'short_name' => $shortName === '' ? null : $shortName,
            'type' => $type,
            'parent_id' => $parentId,
            'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'status' => avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 160) ?: null,
            'color' => $color,
            'opacity' => $opacity,
            'coat_of_arms_url' => avesmapsPoliticalNullableString($coatOfArmsUrl),
            'wiki_url' => avesmapsPoliticalNullableString($wikiUrl),
            'valid_from_bf' => $validFrom,
            'valid_to_bf' => $validTo,
            'valid_label' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['valid_label'] ?? ''), 80)),
            'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom,
            'is_active' => !array_key_exists('is_active', $payload) || filter_var($payload['is_active'], FILTER_VALIDATE_BOOL),
            'editor_notes' => avesmapsPoliticalNullableString(avesmapsNormalizeMultiline((string) ($payload['editor_notes'] ?? ''), 2000)),
            'sort_order' => $sortOrder,
        ]);

        $territory = avesmapsPoliticalFetchTerritoryById($pdo, (int) $pdo->lastInsertId());
        if ($geometry !== null) {
            avesmapsPoliticalInsertGeometry($pdo, (int) $territory['id'], $geometry, $payload, $user);
        }

        $pdo->commit();
        return avesmapsPoliticalResponseForTerritory($pdo, (string) $territory['public_id']);
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }
}

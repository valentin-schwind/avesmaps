<?php

declare(strict_types=1);

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
        // Renderer-Fallback (Geometrie-Zeiträume veralten nicht still): Ein lebendes Territorium darf NICHT von einem
        // überholten Geometrie-valid_to versteckt werden -- die häufige Falle, wenn ein Gebiet von "aufgelöst" auf
        // "besteht" korrigiert wird, die zugewiesene Geometrie den alten Auflösungsstempel aber behält.
        //  (A) Das Territorium lebt im Anzeigejahr -> eine ECHTE Auflösung versteckt weiterhin korrekt.
        '(' . $normalizedTerritoryValidToSql . ' IS NULL OR ' . $normalizedTerritoryValidToSql . ' >= :year_bf_end)',
        //  (B) Diese Geometrie ist die AKTUELLE Form: noch gültig ODER von keiner jüngeren aktiven Geometrie desselben
        //      Territoriums (valid_from <= Jahr, aber später als diese) verdrängt -> Form-Versionierung bleibt erhalten,
        //      ein veraltetes valid_to blendet die einzige/letzte Form aber nicht mehr aus.
        '(' . $normalizedGeometryValidToSql . ' IS NULL OR ' . $normalizedGeometryValidToSql . ' >= :year_bf_end_geom'
            . ' OR NOT EXISTS (SELECT 1 FROM political_territory_geometry g2'
            . ' WHERE g2.territory_id = geometry.territory_id AND g2.is_active = 1 AND g2.id <> geometry.id'
            . ' AND COALESCE(g2.valid_from_bf, 0) <= :year_bf_end_super'
            . ' AND COALESCE(g2.valid_from_bf, 0) > COALESCE(geometry.valid_from_bf, 0)))',
    ];
    $params = [
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'year_bf_start' => $yearBf,
        'year_bf_end' => $yearBf,
        'year_bf_end_geom' => $yearBf,
        'year_bf_end_super' => $yearBf,
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
            (SELECT staging_coat.coat_of_arms_url FROM political_territory_wiki_test staging_coat WHERE staging_coat.wiki_key = territory.wiki_key LIMIT 1) AS staging_coat_url,
            (SELECT staging_coat.coat_of_arms_license_status FROM political_territory_wiki_test staging_coat WHERE staging_coat.wiki_key = territory.wiki_key LIMIT 1) AS staging_coat_license,
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
    $contestedTerritoryIds = avesmapsPoliticalFetchContestedTerritoryIds($pdo);
    $features = avesmapsPoliticalBuildResolvedLayerFeatures($rows, $territories, $parentIds, $yearBf, $zoom, $contestedTerritoryIds);
    $features = avesmapsPoliticalAttachContestedParties($pdo, $features);

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
            (SELECT staging_coat.coat_of_arms_url FROM political_territory_wiki_test staging_coat WHERE staging_coat.wiki_key = territory.wiki_key LIMIT 1) AS staging_coat_url,
            (SELECT staging_coat.coat_of_arms_license_status FROM political_territory_wiki_test staging_coat WHERE staging_coat.wiki_key = territory.wiki_key LIMIT 1) AS staging_coat_license,
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
        'features' => avesmapsPoliticalAttachContestedParties(
            $pdo,
            avesmapsPoliticalBuildRawEditorLayerFeatures($rows, $yearBf, $zoom, $territories, $parentIds)
        ),
    ];
}

function avesmapsPoliticalBuildRawEditorLayerFeatures(array $rows, int $yearBf, int $zoom, array $territories = [], array $parentIds = []): array {
    $features = [];
    $labelGroups = [];
    $seenFeatureIds = [];

    foreach ($rows as $row) {
        $sourceTerritoryId = (int) ($row['territory_id'] ?? 0);
        if ($sourceTerritoryId < 1 && !avesmapsPoliticalLayerRowMatchesOwnZoom($row, $zoom)) {
            continue;
        }
        $displayTerritoryId = null;
        $featureRow = $row;

        if ($sourceTerritoryId > 0 && isset($territories[$sourceTerritoryId])) {
            $resolvedDisplayTerritoryId = avesmapsPoliticalResolveLayerDisplayTerritoryId(
                $sourceTerritoryId,
                $territories,
                $parentIds,
                $zoom
            );

            if ($resolvedDisplayTerritoryId === null) {
                if (!avesmapsPoliticalLayerRowMatchesOwnZoom($row, $zoom)) {
                    continue;
                }
                $displayTerritoryId = $sourceTerritoryId;
            } else {
                $displayTerritoryId = $resolvedDisplayTerritoryId;
            }

            if (
                $displayTerritoryId !== null
                && $displayTerritoryId !== $sourceTerritoryId
                && isset($territories[$displayTerritoryId])
                && avesmapsPoliticalIsGenericLayerParentTerritory($territories[$displayTerritoryId])
            ) {
                if (avesmapsPoliticalLayerRowMatchesOwnZoom($row, $zoom)) {
                    $displayTerritoryId = $sourceTerritoryId;
                } else {
                    continue;
                }
            }

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
        $featureId = (string) ($feature['id'] ?? '');
        if ($featureId !== '' && isset($seenFeatureIds[$featureId])) {
            continue;
        }
        if ($featureId !== '') {
            $seenFeatureIds[$featureId] = true;
        }

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

            $editorColor = avesmapsPoliticalResolveLayerDisplayColor(
                $displayTerritory['color'] ?? '',
                [
                    'fill' => $feature['properties']['fill'] ?? null,
                    'stroke' => $feature['properties']['stroke'] ?? null,
                ],
                [],
                $featureRow
            );

            $feature['properties']['fill'] = $editorColor;
            $feature['properties']['stroke'] = $editorColor;

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

// Umstrittene Gebiete: an jedes Feature, dessen (Quell-)Territorium aktive Claims hat, die Parteien-Liste
// haengen -> [{color, opacity}, ...] (Besitzer zuerst = Territoriumsfarbe/-deckkraft, dann Anspruchsteller
// nach sort_order). Das Canvas-Overlay (map-features-contested-hatch-overlay.js) zeichnet daraus die
// diagonale Schraffur, geclippt aufs (Quell-)Polygon -- auch bei Tiefzoom (Aggregat), erkannt ueber
// aggregate_source_territory_public_id. Eine zusaetzliche, billige Query (die Claim-Tabelle ist klein).
// Set der umstrittenen (>=1 aktiver Claim) territory_id. Mirror des Joins in AttachContestedParties
// (Besitzer + Anspruchsteller aktiv), damit nur Gebiete ausgenommen werden, die auch wirklich Parteien
// liefern. Klein (Claim-Tabelle ist winzig) -> billig, einmal pro Layer-Read.
function avesmapsPoliticalFetchContestedTerritoryIds(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            'SELECT DISTINCT claim.territory_id
            FROM political_territory_claim claim
            INNER JOIN political_territory owner ON owner.id = claim.territory_id AND owner.is_active = 1
            INNER JOIN political_territory claimant ON claimant.id = claim.claimant_territory_id AND claimant.is_active = 1
            WHERE claim.is_active = 1'
        );
    } catch (Throwable) {
        return []; // Tabelle fehlt noch o. Ae. -> Aggregation laeuft unveraendert.
    }
    $ids = [];
    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $territoryId) {
        $ids[(int) $territoryId] = true;
    }
    return $ids;
}

function avesmapsPoliticalAttachContestedParties(PDO $pdo, array $features): array {
    $normalizeStripeColor = static function (mixed $value): string {
        $color = trim((string) $value);
        return preg_match('/^#[0-9a-fA-F]{6}/', $color) === 1 ? substr($color, 0, 7) : '#888888';
    };

    $statement = $pdo->query(
        'SELECT owner.public_id AS disputed_public_id,
                owner.name AS owner_name, owner.color AS owner_color, owner.opacity AS owner_opacity,
                claimant.name AS claimant_name, claimant.color AS claimant_color, claimant.opacity AS claimant_opacity
        FROM political_territory_claim claim
        INNER JOIN political_territory owner ON owner.id = claim.territory_id AND owner.is_active = 1
        INNER JOIN political_territory claimant ON claimant.id = claim.claimant_territory_id AND claimant.is_active = 1
        WHERE claim.is_active = 1
        ORDER BY owner.public_id, claim.sort_order ASC, claim.id ASC'
    );
    $rows = $statement ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
    if ($rows === []) {
        return $features;
    }

    $partiesByPublicId = [];
    foreach ($rows as $row) {
        $disputedPublicId = (string) $row['disputed_public_id'];
        if (!isset($partiesByPublicId[$disputedPublicId])) {
            // Besitzer-Streifen zuerst (Territoriumsfarbe/-deckkraft des umstrittenen Gebiets).
            $partiesByPublicId[$disputedPublicId] = [[
                'name' => (string) $row['owner_name'],
                'color' => $normalizeStripeColor($row['owner_color']),
                'opacity' => (float) $row['owner_opacity'],
                'owner' => true,
            ]];
        }
        $partiesByPublicId[$disputedPublicId][] = [
            'name' => (string) $row['claimant_name'],
            'color' => $normalizeStripeColor($row['claimant_color']),
            'opacity' => (float) $row['claimant_opacity'],
            'owner' => false,
        ];
    }

    foreach ($features as &$feature) {
        $properties = $feature['properties'] ?? [];
        // NUR auf der EIGENEN Ebene schraffieren. Ein Aggregat-Feature (is_aggregate, Tiefzoom) traegt die
        // Geometrie des ANGEZEIGTEN Vorfahren (= ganzes Reich); wuerde man es via aggregate_source markieren,
        // schraffiert das Overlay den GANZEN Reichs-Umriss -> EINE umstrittene Baronie laesst die ganze
        // Markgrafschaft gestreift erscheinen (v.a. bei Tiefzoom/Mobile). Daher Aggregate ueberspringen ->
        // die Schraffur erscheint erst, wenn das Gebiet auf seiner eigenen Ebene gerendert wird.
        if (!empty($properties['is_aggregate'])) {
            continue;
        }
        $disputedPublicId = trim((string) ($properties['territory_public_id'] ?? ''));
        if ($disputedPublicId !== '' && isset($partiesByPublicId[$disputedPublicId])) {
            $feature['properties']['contestedParties'] = $partiesByPublicId[$disputedPublicId];
        }
    }
    unset($feature);

    return $features;
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
            (SELECT staging_coat.coat_of_arms_url FROM political_territory_wiki_test staging_coat WHERE staging_coat.wiki_key = territory.wiki_key LIMIT 1) AS staging_coat_url,
            (SELECT staging_coat.coat_of_arms_license_status FROM political_territory_wiki_test staging_coat WHERE staging_coat.wiki_key = territory.wiki_key LIMIT 1) AS staging_coat_license,
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
        if (
            $storedParentId > 0
            && isset($territories[$storedParentId])
            && $storedParentId !== (int) $territoryId
            && !avesmapsPoliticalIsGenericLayerParentTerritory($territories[$storedParentId])
        ) {
            $parentIds[(int) $territoryId] = $storedParentId;
        }
    }

    return $parentIds;
}

function avesmapsPoliticalIsGenericLayerParentTerritory(array $territory): bool {
    $candidates = [
        (string) ($territory['name'] ?? ''),
        (string) ($territory['short_name'] ?? ''),
        (string) ($territory['wiki_name'] ?? ''),
        (string) ($territory['slug'] ?? ''),
    ];

    foreach ($candidates as $candidate) {
        if (avesmapsPoliticalIsGenericHierarchyRootName($candidate)) {
            return true;
        }
    }

    return false;
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
    if ($affiliation === '' || avesmapsPoliticalIsGenericHierarchyRootName($affiliation)) {
        return '';
    }

    $parts = preg_split('/\s*[:;]\s*/u', $affiliation) ?: [];
    return trim((string) end($parts));
}

function avesmapsPoliticalBuildResolvedLayerFeatures(array $geometryRows, array $territories, array $parentIds, int $yearBf, int $zoom, array $contestedTerritoryIds = []): array {
    // Ab dieser Zoomstufe werden umstrittene Gebiete NICHT mehr in den Vorfahren aggregiert, sondern
    // bleiben als eigene (kleine) Geometrie -> die Schraffur erscheint als Fleck im Reich statt als
    // Ganz-Reich-Streifen (vgl. AttachContestedParties, das Aggregate ueberspringt). Unterhalb (Welt-/
    // Kontinent-Zoom) bleibt alles aggregiert: die Baronien waeren dort ohnehin subpixel.
    $contestedOwnLevelMinZoom = 3;
    $featuresByTerritory = [];
    foreach ($geometryRows as $geometryRow) {
        $sourceTerritoryId = (int) $geometryRow['territory_id'];
        if (!isset($territories[$sourceTerritoryId])) {
            continue;
        }

        $displayTerritoryId = avesmapsPoliticalResolveLayerDisplayTerritoryId($sourceTerritoryId, $territories, $parentIds, $zoom);
        // Umstrittenes Gebiet auf eigener Ebene halten (nicht aggregieren), sobald es sinnvoll sichtbar ist.
        if ($zoom >= $contestedOwnLevelMinZoom && isset($contestedTerritoryIds[$sourceTerritoryId])) {
            $displayTerritoryId = $sourceTerritoryId;
        }
        if ($displayTerritoryId !== null && $displayTerritoryId !== $sourceTerritoryId) {
            $displayTerritory = $territories[$displayTerritoryId] ?? null;
            if (is_array($displayTerritory) && avesmapsPoliticalIsGenericLayerParentTerritory($displayTerritory)) {
                if (avesmapsPoliticalLayerRowMatchesOwnZoom($geometryRow, $zoom)) {
                    $displayTerritoryId = $sourceTerritoryId;
                } else {
                    continue;
                }
            }
        }

        if ($displayTerritoryId === null || !isset($territories[$displayTerritoryId])) {
            continue;
        }

        $displayRow = $displayTerritoryId === $sourceTerritoryId
            ? $geometryRow
            : avesmapsPoliticalBuildAggregateLayerRow($territories[$displayTerritoryId], $geometryRow, $territories[$sourceTerritoryId]);
        $feature = avesmapsPoliticalLayerRowToFeature($displayRow, $yearBf, $zoom);
        // Transparenz wie im Editmode (vgl. avesmapsPoliticalReadEditorLayer ~Zeile 305): die
        // Fuellung uebernimmt die Deckkraft des ANGEZEIGTEN (Aggregat-)Territoriums statt der
        // u. U. abweichenden fillOpacity der Quellgeometrie-Style. So sind die Aggregat-Flaechen
        // im Frontend gleich deckend wie im Editor und passen zur Deckkraft der Derived-Huelle.
        $displayTerritoryOpacity = $territories[$displayTerritoryId]['opacity'] ?? null;
        if ($displayTerritoryOpacity !== null && $displayTerritoryOpacity !== '') {
            $feature['properties']['fillOpacity'] = (float) $displayTerritoryOpacity;
        }
        // Farbe wie im Editmode (vgl. avesmapsPoliticalReadEditorLayer ~Zeile 302): die Fuellung
        // uebernimmt die Farbe des ANGEZEIGTEN Territoriums (territory.color) statt der u. U.
        // abweichenden Style-/Seed-Farbe der Quellgeometrie. So sind auch die Blatt-Baronien im
        // Frontend farbgleich zum Editor. Fallbacks identisch (Style/Row), falls keine Territoriums-Farbe.
        $displayTerritoryColor = avesmapsPoliticalResolveLayerDisplayColor(
            $territories[$displayTerritoryId]['color'] ?? '',
            ['fill' => $feature['properties']['fill'] ?? null, 'stroke' => $feature['properties']['stroke'] ?? null],
            [],
            $displayRow
        );
        $feature['properties']['fill'] = $displayTerritoryColor;
        $feature['properties']['stroke'] = $displayTerritoryColor;
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

        if (avesmapsPoliticalIsGenericLayerParentTerritory($territory)) {
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

    if ($bestTerritoryId !== null) {
        return $bestTerritoryId;
    }

    for ($index = count($chain) - 1; $index >= 0; $index--) {
        $candidateTerritoryId = (int) ($chain[$index] ?? 0);
        $territory = $territories[$candidateTerritoryId] ?? null;
        if ($territory && avesmapsPoliticalLayerTerritoryMatchesZoom($territory, $zoom)) {
            return $candidateTerritoryId;
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

    $visibleName = $territoryName !== ''
        ? $territoryName
        : ($customName !== '' ? $customName : 'Freie Geometrie');

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

    // Fallback wie territory-detail.php: viele Territorien haben das gecrawlte Wappen nur in der
    // Staging-Tabelle (political_territory_wiki_test), nicht in political_territory.coat_of_arms_url.
    // Lizenz-gegatet nachziehen, damit das Label dasselbe Wappen zeigt wie die (Detail-)Infobox.
    if (trim($visibleCoatOfArmsUrl) === '') {
        $stagingCoatUrl = trim((string) ($row['staging_coat_url'] ?? ''));
        $stagingCoatLicense = trim((string) ($row['staging_coat_license'] ?? ''));
        if ($stagingCoatUrl !== '' && in_array($stagingCoatLicense, ['public_domain', 'attribution_required'], true)) {
            $visibleCoatOfArmsUrl = $stagingCoatUrl;
        }
    }

    $displayColor = avesmapsPoliticalResolveLayerDisplayColor(
        $assignmentDisplay['color'] ?? '',
        $style,
        $geometryStyle,
        $row
    );
    $displayOpacity = $assignmentDisplay['opacity'] ?? null;

    $resolvedType = trim((string) ($row['type'] ?? '')) ?: 'Herrschaftsgebiet';

    $properties = [
        'type' => 'region',
        'source' => 'political_territory',
        'public_id' => (string) $row['geometry_public_id'],
        'geometry_id' => (int) ($row['geometry_id'] ?? 0),
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
        'fill' => $displayColor,
        'stroke' => $displayColor,
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

function avesmapsPoliticalResolveLayerDisplayColor(mixed $assignmentColor, array $style, array $geometryStyle, array $row): string {
    $candidateColors = [
        $assignmentColor,
        $style['fill'] ?? null,
        $geometryStyle['fill'] ?? null,
        $style['stroke'] ?? null,
        $geometryStyle['stroke'] ?? null,
        $row['color'] ?? null,
    ];

    foreach ($candidateColors as $candidateColor) {
        $color = avesmapsPoliticalNormalizeLayerHexColor($candidateColor);
        if ($color !== '' && strcasecmp($color, '#888888') !== 0) {
            return $color;
        }
    }

    return avesmapsPoliticalDeterministicLayerColor($row);
}

function avesmapsPoliticalNormalizeLayerHexColor(mixed $value): string {
    $color = trim((string) ($value ?? ''));
    return preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1 ? $color : '';
}

function avesmapsPoliticalDeterministicLayerColor(array $row): string {
    $seed = trim((string) (
        $row['territory_public_id']
        ?? $row['geometry_public_id']
        ?? $row['slug']
        ?? $row['name']
        ?? 'Herrschaftsgebiet'
    ));

    $hash = 2166136261;
    $length = strlen($seed);
    for ($index = 0; $index < $length; $index++) {
        $hash ^= ord($seed[$index]);
        $hash = ($hash * 16777619) & 0xffffffff;
    }

    $hue = $hash % 360;
    $saturation = 52 + ($hash % 18);
    $value = 50 + (($hash >> 8) % 20);

    return avesmapsPoliticalHsvLayerColorToHex($hue, $saturation, $value);
}

function avesmapsPoliticalHsvLayerColorToHex(int $hue, int $saturationPercent, int $valuePercent): string {
    $saturation = max(0, min(100, $saturationPercent)) / 100;
    $value = max(0, min(100, $valuePercent)) / 100;
    $chroma = $value * $saturation;
    $huePrime = (max(0, min(360, $hue)) % 360) / 60;
    $secondary = $chroma * (1 - abs(fmod($huePrime, 2) - 1));
    $match = $value - $chroma;

    if ($huePrime < 1) {
        $channels = [$chroma, $secondary, 0];
    } elseif ($huePrime < 2) {
        $channels = [$secondary, $chroma, 0];
    } elseif ($huePrime < 3) {
        $channels = [0, $chroma, $secondary];
    } elseif ($huePrime < 4) {
        $channels = [0, $secondary, $chroma];
    } elseif ($huePrime < 5) {
        $channels = [$secondary, 0, $chroma];
    } else {
        $channels = [$chroma, 0, $secondary];
    }

    return sprintf(
        '#%02x%02x%02x',
        (int) round(($channels[0] + $match) * 255),
        (int) round(($channels[1] + $match) * 255),
        (int) round(($channels[2] + $match) * 255)
    );
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

function avesmapsPoliticalApplyEffectiveParents(array $territories): array {
    return $territories;
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

<?php

declare(strict_types=1);

// Die reinen "assignmentDisplays aus style_json lesen"-Helfer
// (avesmapsPoliticalReadAssignmentDisplaysFromStyle,
//  avesmapsPoliticalFindAssignmentDisplayForTerritory,
//  avesmapsPoliticalResolveAssignmentDisplayName)
// liegen jetzt in territories-read.php, da der Layer-/Lesepfad sie braucht
// und nicht vom Schreib-Modul abhaengen darf.

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
        'otherSource' => is_array($display['otherSource'] ?? null) ? $display['otherSource'] : null,
        'coatOfArmsUrl' => trim((string) ($display['coatOfArmsUrl'] ?? $territory['coat_of_arms_url'] ?? '')),
        'zoomMin' => avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? $territory['min_zoom'] ?? null),
        'zoomMax' => avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? $territory['max_zoom'] ?? null),
        'color' => avesmapsPoliticalReadHexColor($display['color'] ?? $territory['color'] ?? '#888888'),
        'opacity' => avesmapsPoliticalReadOpacity($display['opacity'] ?? $territory['opacity'] ?? 0.5),
        'startYear' => avesmapsPoliticalReadOptionalInt($display['startYear'] ?? $territory['valid_from_bf'] ?? null),
        'endYear' => $existsUntilToday
            ? null
            : avesmapsPoliticalReadOptionalInt($display['endYear'] ?? $territoryValidTo),
        'existsUntilToday' => $existsUntilToday,
        'depth' => $depth,
    ];
}

// Manual capital-link assignment for the "Hauptstaedte" review surface: set (or clear) political_territory.
// capital_place_id to a chosen location. Used to bulk-fix the territories whose wiki capital_name never resolved
// via the exact-match matcher at insert time (umlauts, prose, ambiguous names, location created later). Passing
// an empty place_public_id clears the link again. The layer cache is invalidated by the endpoint after the write.
function avesmapsPoliticalAssignCapital(PDO $pdo, array $payload, array $user): array {
    $territoryPublicId = avesmapsNormalizeSingleLine((string) ($payload['territory_public_id'] ?? ''), 64);
    if ($territoryPublicId === '') {
        throw new InvalidArgumentException('Das Herrschaftsgebiet (territory_public_id) ist erforderlich.');
    }
    $placePublicId = avesmapsNormalizeSingleLine((string) ($payload['place_public_id'] ?? ''), 64);

    $territoryStatement = $pdo->prepare('SELECT id FROM political_territory WHERE public_id = :public_id LIMIT 1');
    $territoryStatement->execute(['public_id' => $territoryPublicId]);
    $territoryId = $territoryStatement->fetchColumn();
    if ($territoryId === false) {
        throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
    }

    $capitalPlaceId = null;
    $capitalPlacePublicId = '';
    $capitalPlaceName = '';
    if ($placePublicId !== '') {
        $placeStatement = $pdo->prepare(
            "SELECT id, public_id, name FROM map_features
            WHERE public_id = :public_id AND feature_type = 'location' AND is_active = 1
            LIMIT 1"
        );
        $placeStatement->execute(['public_id' => $placePublicId]);
        $placeRow = $placeStatement->fetch(PDO::FETCH_ASSOC);
        if ($placeRow === false) {
            throw new InvalidArgumentException('Der gewaehlte Ort wurde nicht gefunden.');
        }
        $capitalPlaceId = (int) $placeRow['id'];
        $capitalPlacePublicId = (string) $placeRow['public_id'];
        $capitalPlaceName = (string) $placeRow['name'];
    }

    $updateStatement = $pdo->prepare('UPDATE political_territory SET capital_place_id = :capital_place_id WHERE id = :id');
    $updateStatement->execute([
        'capital_place_id' => $capitalPlaceId,
        'id' => (int) $territoryId,
    ]);

    // Assigning a capital resolves the missing-capital conflict case -> drop any persisted deferred/archived
    // override so a stale status can't resurface if the link is cleared again later.
    $pdo->prepare('DELETE FROM political_capital_case_status WHERE territory_public_id = :public_id')
        ->execute(['public_id' => $territoryPublicId]);

    return [
        'ok' => true,
        'territory_public_id' => $territoryPublicId,
        'capital_place_id' => $capitalPlaceId,
        'capital_place_public_id' => $capitalPlacePublicId,
        'capital_place_name' => $capitalPlaceName,
    ];
}

// Persist the user's review decision for a missing-capital conflict case. defer/archive upsert the override;
// reopen ('open') removes it so the case falls back to its live-computed open state. The "resolve" path is the
// capital assignment in avesmapsPoliticalAssignCapital, which clears the row entirely.
function avesmapsPoliticalUpdateCapitalCaseStatus(PDO $pdo, array $payload, array $user, string $status): array {
    $territoryPublicId = avesmapsNormalizeSingleLine((string) ($payload['territory_public_id'] ?? ''), 64);
    if ($territoryPublicId === '') {
        throw new InvalidArgumentException('Das Herrschaftsgebiet (territory_public_id) ist erforderlich.');
    }

    if ($status === 'open') {
        $pdo->prepare('DELETE FROM political_capital_case_status WHERE territory_public_id = :public_id')
            ->execute(['public_id' => $territoryPublicId]);
        return ['ok' => true, 'territory_public_id' => $territoryPublicId, 'status' => 'open', 'source' => 'political'];
    }

    $resolution = $payload['resolution'] ?? null;
    $resolutionJson = is_array($resolution)
        ? json_encode($resolution, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        : null;
    $reviewedBy = ((int) ($user['id'] ?? 0)) ?: null;

    $statement = $pdo->prepare(
        'INSERT INTO political_capital_case_status (territory_public_id, status, resolution_json, reviewed_by)
        VALUES (:public_id, :status, :resolution_json, :reviewed_by)
        ON DUPLICATE KEY UPDATE status = VALUES(status), resolution_json = VALUES(resolution_json), reviewed_by = VALUES(reviewed_by)'
    );
    $statement->execute([
        'public_id' => $territoryPublicId,
        'status' => $status,
        'resolution_json' => $resolutionJson,
        'reviewed_by' => $reviewedBy,
    ]);

    return ['ok' => true, 'territory_public_id' => $territoryPublicId, 'status' => $status, 'source' => 'political'];
}

function avesmapsPoliticalCreateTerritory(PDO $pdo, array $payload, array $user): array {
    $requestedName = avesmapsPoliticalReadRequiredName($payload['name'] ?? '', 'Der Name des Herrschaftsgebiets');
    $shortName = avesmapsNormalizeSingleLine((string) ($payload['short_name'] ?? ''), 160);
    $type = avesmapsPoliticalNormalizeParentheticalSpacing(avesmapsNormalizeSingleLine((string) ($payload['type'] ?? 'Herrschaftsgebiet'), 160));
    $parentId = avesmapsPoliticalReadOptionalTerritoryId($pdo, $payload['parent_public_id'] ?? null);
    $wikiId = avesmapsPoliticalReadOptionalWikiId($pdo, $payload['wiki_id'] ?? null);
    $wikiKey = avesmapsPoliticalFetchWikiKeyById($pdo, $wikiId);
    $color = avesmapsPoliticalReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsPoliticalReadOpacity($payload['opacity'] ?? 0.5);
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
                public_id, wiki_id, wiki_key, slug, name, short_name, type, parent_id, continent, status, color,
                opacity, coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, valid_label,
                min_zoom, max_zoom, is_active, editor_notes, sort_order
            ) VALUES (
                :public_id, :wiki_id, :wiki_key, :slug, :name, :short_name, :type, :parent_id, :continent, :status, :color,
                :opacity, :coat_of_arms_url, :wiki_url, :valid_from_bf, :valid_to_bf, :valid_label,
                :min_zoom, :max_zoom, :is_active, :editor_notes, :sort_order
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'wiki_id' => $wikiId,
            'wiki_key' => $wikiKey,
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
            // Neu angelegte Gebiete sind immer aktiv (siehe update: Deaktivieren nur via delete_territory).
            'is_active' => 1,
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
    // Rename muss den slug mitziehen: bleibt der slug am alten Namen haengen, driften name und slug
    // auseinander -- der name-abgeleitete Lookup im Wiki-/Baum-Save (avesmapsPoliticalFindTerritoryByWikiOrSlug)
    // matcht den Record dann nicht mehr und legt eine DUBLETTE an (Vorfall "Waldmenschen" -> zwei Karteikarten).
    // Daher bei Namensaenderung den slug neu und eindeutig ableiten (sich selbst ausgenommen).
    $slug = (string) $territory['slug'];
    if ($name !== (string) $territory['name']) {
        $slug = avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name), (int) $territory['id']);
    }
    $parentId = avesmapsPoliticalReadOptionalTerritoryId($pdo, $payload['parent_public_id'] ?? null);
    $wikiId = avesmapsPoliticalReadOptionalWikiId($pdo, $payload['wiki_id'] ?? $territory['wiki_id'] ?? null);
    $wikiKey = avesmapsPoliticalFetchWikiKeyById($pdo, $wikiId);
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
    $opacity = avesmapsPoliticalReadOpacity($payload['opacity'] ?? 0.5);

    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET name = :name,
            slug = :slug,
            wiki_id = :wiki_id,
            wiki_key = :wiki_key,
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
        'slug' => $slug,
        'wiki_id' => $wikiId,
        'wiki_key' => $wikiKey,
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
        // Speichern reaktiviert IMMER. Deaktivieren laeuft ausschliesslich ueber delete_territory bzw.
        // den Audit-Undo -- ein Payload-Flag darf ein Gebiet nicht (still) von der Karte nehmen.
        // Vorfall "Herzogtum Transysilien": eine per CSS versteckte Aktiv-Checkbox schickte bei jedem
        // Editor-Save is_active=0 mit; das Gebiet blieb dauerhaft unsichtbar, ohne UI-Weg zurueck.
        'is_active' => 1,
        'editor_notes' => avesmapsPoliticalNullableString(avesmapsNormalizeMultiline((string) ($payload['editor_notes'] ?? ''), 3000)),
    ]);
    avesmapsPoliticalSyncTerritoryGeometryStyle($pdo, (int) $territory['id'], $color, $opacity);
    avesmapsPoliticalClearTerritoryGeometryZoomOverrides($pdo, (int) $territory['id']);

    return avesmapsPoliticalResponseForTerritory($pdo, (string) $territory['public_id']);
}

function avesmapsPoliticalSaveWikiNodeSettings(PDO $pdo, array $payload, array $user): array {
    $wikiKey = trim(avesmapsNormalizeSingleLine((string) ($payload['wiki_key'] ?? $payload['wiki_public_id'] ?? ''), 200));
    if ($wikiKey === '') {
        throw new InvalidArgumentException('Der Wiki-Schluessel fehlt.');
    }
    $wiki = avesmapsPoliticalFetchWikiByKey($pdo, $wikiKey);
    $slug = avesmapsPoliticalSlug((string) ($wiki['name'] ?? $wikiKey));

    $display = is_array($payload['display'] ?? null) ? $payload['display'] : [];
    $color = avesmapsPoliticalReadHexColor($display['color'] ?? '#888888');
    $opacity = avesmapsPoliticalReadOpacity($display['opacity'] ?? 0.5);
    $minZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);
    $coatOfArmsUrl = avesmapsPoliticalReadOptionalUrl($display['coatOfArmsUrl'] ?? '', 'Der Wappen-Link');
    if ($coatOfArmsUrl !== '' && !avesmapsPoliticalIsLikelyCoatOfArmsUrl($coatOfArmsUrl)) {
        $coatOfArmsUrl = '';
    }

    $validity = is_array($payload['validity'] ?? null) ? $payload['validity'] : [];
    $validFrom = avesmapsPoliticalReadOptionalInt($validity['startYear'] ?? null);
    $existsUntilToday = array_key_exists('existsUntilToday', $validity)
        ? filter_var($validity['existsUntilToday'], FILTER_VALIDATE_BOOL)
        : !array_key_exists('endYear', $validity);
    $validTo = $existsUntilToday ? null : avesmapsPoliticalReadOptionalInt($validity['endYear'] ?? null);

    $pdo->beginTransaction();
    try {
        $territory = avesmapsPoliticalFindTerritoryByWikiOrSlug($pdo, (int) $wiki['id'], $slug);
        if (!$territory) {
            $created = avesmapsPoliticalCreateTerritoryFromWiki($pdo, [...$wiki, 'slug' => $slug], $user);
            $territory = avesmapsPoliticalFetchTerritoryById($pdo, (int) $created['id']);
        } else {
            avesmapsPoliticalLinkTerritoryToWiki($pdo, (int) $territory['id'], (int) $wiki['id'], avesmapsPoliticalNullableString($wiki['wiki_key'] ?? null));
        }

        // is_active=1: Speichern reaktiviert IMMER (siehe avesmapsPoliticalUpdateTerritory) --
        // der Editor speichert Knoten-Eigenschaften ueber DIESEN Pfad, nicht ueber update_territory.
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
            'valid_from_bf' => $validFrom,
            'valid_to_bf' => $validTo,
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

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
                    avesmapsPoliticalLinkTerritoryToWiki($pdo, (int) $territory['id'], (int) $wiki['id'], avesmapsPoliticalNullableString($wiki['wiki_key'] ?? null));
                }
            } else {
                $territory = avesmapsPoliticalEnsureSyntheticTreeTerritory($pdo, $node, $wikiKey);
            }

            if ($parentId !== null && $parentId !== (int) $territory['id']) {
                $parentTerritory = avesmapsPoliticalFetchTerritoryById($pdo, (int) $parentId);
                $isGenericParent = avesmapsPoliticalIsGenericHierarchyRootName((string) ($parentTerritory['name'] ?? ''))
                    || avesmapsPoliticalIsGenericHierarchyRootName((string) ($parentTerritory['slug'] ?? ''));

                if ($isGenericParent) {
                    $parentId = null;
                }
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
            public_id, wiki_id, wiki_key, slug, name, short_name, type, continent, status, color,
            opacity, coat_of_arms_url, wiki_url, valid_label, min_zoom, max_zoom,
            is_active, editor_notes, sort_order
        ) VALUES (
            :public_id, NULL, :wiki_key, :slug, :name, NULL, :type, :continent, :status, :color,
            :opacity, :coat_of_arms_url, :wiki_url, :valid_label, NULL, NULL,
            1, :editor_notes, :sort_order
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'wiki_key' => avesmapsPoliticalNullableString($wikiKey),
        'slug' => avesmapsPoliticalUniqueSlug($pdo, $slug),
        'name' => $name,
        'type' => avesmapsPoliticalNullableString(avesmapsPoliticalNormalizeParentheticalSpacing(avesmapsNormalizeSingleLine((string) ($node['type'] ?? 'Herrschaftsgebiet'), 160))),
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'status' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($node['status'] ?? ''), 255)),
        'color' => avesmapsPoliticalColorFromText($name),
        'opacity' => 0.5,
        'coat_of_arms_url' => avesmapsPoliticalNullableString(avesmapsPoliticalReadOptionalUrl($node['coat_of_arms_url'] ?? '', 'Der Wappen-Link')),
        'wiki_url' => avesmapsPoliticalNullableString(avesmapsPoliticalReadOptionalUrl($node['wiki_url'] ?? '', 'Der Wiki-Aventurica-Link')),
        'valid_label' => avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($node['valid_label'] ?? ''), 500)),
        'editor_notes' => avesmapsPoliticalNullableString('Aus Wiki-Hierarchie ohne eigenen Referenzdatensatz erzeugt: ' . $wikiKey),
        'sort_order' => $sortOrder,
    ]);

    return avesmapsPoliticalFetchTerritoryById($pdo, (int) $pdo->lastInsertId());
}

function avesmapsPoliticalDeleteTerritory(PDO $pdo, array $payload): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? $payload['public_id'] ?? '')
    );

    $pdo->beginTransaction();
    try {
        $geometryStatement = $pdo->prepare(
            'UPDATE political_territory_geometry
            SET is_active = 0
            WHERE territory_id = :territory_id'
        );
        $geometryStatement->execute([
            'territory_id' => (int) $territory['id'],
        ]);

        $territoryStatement = $pdo->prepare(
            'UPDATE political_territory
            SET is_active = 0
            WHERE id = :id'
        );
        $territoryStatement->execute([
            'id' => (int) $territory['id'],
        ]);

        // Abgeleitete Aussengrenze des Gebiets UND seiner Vorfahren mit deaktivieren,
        // sonst bleibt eine veraltete Kontur stehen.
        avesmapsPoliticalDeactivateDerivedGeometryForTerritoryChain($pdo, (int) $territory['id']);

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
        'opacity' => (float) ($style['fillOpacity'] ?? 0.5),
        'min_zoom' => 0,
        'max_zoom' => 6,
        'editor_notes' => 'Aus urspruenglichem Regionen-Layer wiederhergestellt.',
        'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
    ]);

    return avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
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

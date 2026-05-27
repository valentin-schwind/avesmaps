<?php

declare(strict_types=1);

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

function avesmapsPoliticalReadChangeLog(PDO $pdo, bool $canUndoChanges): array {
    $statement = $pdo->query(
        'SELECT
            audit.id,
            audit.action,
            audit.created_at,
            audit.before_json,
            audit.after_json,
            audit.undone_at,
            audit.undo_audit_id,
            users.username,
            undone_users.username AS undone_username
        FROM political_territory_geometry_audit_log audit
        LEFT JOIN users ON users.id = audit.actor_user_id
        LEFT JOIN users undone_users ON undone_users.id = audit.undone_by
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT 100'
    );
    $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);

    return [
        'ok' => true,
        'changes' => array_map(
            static fn(array $row): array => avesmapsPoliticalNormalizeChangeLogEntry($row, $canUndoChanges),
            $rows
        ),
    ];
}

function avesmapsPoliticalNormalizeChangeLogEntry(array $row, bool $canUndoChanges): array {
    $beforePayload = avesmapsPoliticalDecodeAuditPayload($row['before_json'] ?? null);
    $afterPayload = avesmapsPoliticalDecodeAuditPayload($row['after_json'] ?? null);
    $focus = avesmapsPoliticalBuildAuditFocusTarget($beforePayload, $afterPayload);
    $primaryPublicId = avesmapsPoliticalResolveAuditPrimaryPublicId($beforePayload, $afterPayload);
    $isUndone = (string) ($row['undone_at'] ?? '') !== '';
    $action = (string) ($row['action'] ?? '');

    return [
        'id' => (int) ($row['id'] ?? 0),
        'action' => $action,
        'created_at' => (string) ($row['created_at'] ?? ''),
        'username' => (string) ($row['username'] ?? ''),
        'undone' => $isUndone,
        'undone_at' => (string) ($row['undone_at'] ?? ''),
        'undone_username' => (string) ($row['undone_username'] ?? ''),
        'undo_audit_id' => (int) ($row['undo_audit_id'] ?? 0),
        'can_undo' => $canUndoChanges && !$isUndone && avesmapsPoliticalCanUndoGeometryAuditAction($action),
        'public_id' => $primaryPublicId,
        'feature_type' => 'political_territory',
        'feature_subtype' => 'region',
        'name' => $primaryPublicId,
        'focus' => $focus,
    ];
}

function avesmapsPoliticalCanUndoGeometryAuditAction(string $action): bool {
    if (str_starts_with($action, 'undo_')) {
        return false;
    }

    return in_array($action, [
        'update_geometry',
        'split_geometry',
        'delete_geometry',
        'delete_geometry_part',
        'geometry_operation_union',
        'geometry_operation_difference',
        'geometry_operation_intersection',
    ], true);
}

function avesmapsPoliticalBuildAuditFocusTarget(array $beforePayload, array $afterPayload): ?array {
    $afterGeometries = is_array($afterPayload['geometries'] ?? null) ? $afterPayload['geometries'] : [];
    $beforeGeometries = is_array($beforePayload['geometries'] ?? null) ? $beforePayload['geometries'] : [];

    $snapshot = avesmapsPoliticalPickActiveGeometrySnapshot($afterGeometries)
        ?? avesmapsPoliticalPickActiveGeometrySnapshot($beforeGeometries)
        ?? avesmapsPoliticalPickFirstGeometrySnapshot($afterGeometries)
        ?? avesmapsPoliticalPickFirstGeometrySnapshot($beforeGeometries);

    if (!is_array($snapshot)) {
        return null;
    }

    $minX = (float) ($snapshot['min_x'] ?? 0);
    $minY = (float) ($snapshot['min_y'] ?? 0);
    $maxX = (float) ($snapshot['max_x'] ?? 0);
    $maxY = (float) ($snapshot['max_y'] ?? 0);
    $lat = ($minY + $maxY) / 2;
    $lng = ($minX + $maxX) / 2;
    if (abs($maxX - $minX) < 0.0001 && abs($maxY - $minY) < 0.0001) {
        return [
            'type' => 'point',
            'lat' => round($lat, 6),
            'lng' => round($lng, 6),
        ];
    }

    return [
        'type' => 'bounds',
        'lat' => round($lat, 6),
        'lng' => round($lng, 6),
        'bounds' => [
            [round($minY, 6), round($minX, 6)],
            [round($maxY, 6), round($maxX, 6)],
        ],
    ];
}

function avesmapsPoliticalResolveAuditPrimaryPublicId(array $beforePayload, array $afterPayload): string {
    $afterGeometries = is_array($afterPayload['geometries'] ?? null) ? $afterPayload['geometries'] : [];
    foreach (array_keys($afterGeometries) as $publicId) {
        if ((string) $publicId !== '') {
            return (string) $publicId;
        }
    }

    $beforeGeometries = is_array($beforePayload['geometries'] ?? null) ? $beforePayload['geometries'] : [];
    foreach (array_keys($beforeGeometries) as $publicId) {
        if ((string) $publicId !== '') {
            return (string) $publicId;
        }
    }

    return '';
}

function avesmapsPoliticalUndoAuditChange(PDO $pdo, array $payload, array $user): array {
    $auditId = avesmapsPoliticalReadAuditLogId($payload['audit_id'] ?? null);
    $pdo->beginTransaction();
    try {
        $auditEntry = avesmapsPoliticalFetchAuditEntryForUndo($pdo, $auditId);
        $action = (string) ($auditEntry['action'] ?? '');
        if (!avesmapsPoliticalCanUndoGeometryAuditAction($action)) {
            throw new InvalidArgumentException('Diese Aenderung kann nicht rueckgaengig gemacht werden.');
        }
        if (!empty($auditEntry['undone_at'])) {
            throw new InvalidArgumentException('Diese Aenderung wurde bereits rueckgaengig gemacht.');
        }

        $beforePayload = avesmapsPoliticalDecodeAuditPayload($auditEntry['before_json'] ?? null);
        $afterPayload = avesmapsPoliticalDecodeAuditPayload($auditEntry['after_json'] ?? null);
        avesmapsPoliticalRestoreAuditGeometries($pdo, $beforePayload, $afterPayload, (int) ($user['id'] ?? 0));
        avesmapsPoliticalRestoreAuditTerritories($pdo, $beforePayload, $afterPayload, (int) ($user['id'] ?? 0));

        $undoAuditId = avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            avesmapsPoliticalBuildUndoAuditAction($action),
            (int) ($user['id'] ?? 0),
            $afterPayload,
            $beforePayload
        );
        avesmapsPoliticalMarkAuditEntryUndone($pdo, $auditId, (int) ($user['id'] ?? 0), $undoAuditId);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'audit_id' => $auditId,
    ];
}

function avesmapsPoliticalReadAuditLogId(mixed $value): int {
    $auditId = filter_var($value, FILTER_VALIDATE_INT);
    if ($auditId === false || $auditId <= 0) {
        throw new InvalidArgumentException('Die Audit-ID ist ungueltig.');
    }

    return (int) $auditId;
}

function avesmapsPoliticalFetchAuditEntryForUndo(PDO $pdo, int $auditId): array {
    $statement = $pdo->prepare(
        'SELECT id, action, before_json, after_json, undone_at
        FROM political_territory_geometry_audit_log
        WHERE id = :id
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute(['id' => $auditId]);
    $entry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$entry) {
        throw new InvalidArgumentException('Die Aenderung wurde nicht gefunden.');
    }

    return $entry;
}

function avesmapsPoliticalRestoreAuditGeometries(PDO $pdo, array $beforePayload, array $afterPayload, int $userId): void {
    $beforeGeometries = is_array($beforePayload['geometries'] ?? null) ? $beforePayload['geometries'] : [];
    $afterGeometries = is_array($afterPayload['geometries'] ?? null) ? $afterPayload['geometries'] : [];
    $geometryPublicIds = array_values(array_unique(array_merge(array_keys($beforeGeometries), array_keys($afterGeometries))));
    foreach ($geometryPublicIds as $publicId) {
        $geometryPublicId = (string) $publicId;
        if ($geometryPublicId === '') {
            continue;
        }

        $beforeSnapshot = is_array($beforeGeometries[$geometryPublicId] ?? null) ? $beforeGeometries[$geometryPublicId] : null;
        $afterSnapshot = is_array($afterGeometries[$geometryPublicId] ?? null) ? $afterGeometries[$geometryPublicId] : null;
        $currentRow = avesmapsPoliticalFetchGeometryRowByPublicIdRaw($pdo, $geometryPublicId, true);
        $currentSnapshot = $currentRow === null ? null : avesmapsPoliticalBuildGeometryAuditSnapshot($currentRow);
        if (!avesmapsPoliticalAuditSnapshotsEqual($currentSnapshot, $afterSnapshot)) {
            throw new RuntimeException('Diese Aenderung kann nicht unabhaengig rueckgaengig gemacht werden, weil die Geometrie inzwischen geaendert wurde.');
        }

        if ($beforeSnapshot === null) {
            if ($currentRow !== null && (int) ($currentRow['is_active'] ?? 0) === 1) {
                $statement = $pdo->prepare(
                    'UPDATE political_territory_geometry
                    SET is_active = 0,
                        updated_by = :updated_by
                    WHERE id = :id'
                );
                $statement->execute([
                    'id' => (int) $currentRow['id'],
                    'updated_by' => $userId > 0 ? $userId : null,
                ]);
            }
            continue;
        }

        avesmapsPoliticalApplyGeometryAuditSnapshot($pdo, $geometryPublicId, $beforeSnapshot, $userId);
    }
}

function avesmapsPoliticalRestoreAuditTerritories(PDO $pdo, array $beforePayload, array $afterPayload, int $userId): void {
    $beforeTerritories = is_array($beforePayload['territories'] ?? null) ? $beforePayload['territories'] : [];
    $afterTerritories = is_array($afterPayload['territories'] ?? null) ? $afterPayload['territories'] : [];
    $territoryPublicIds = array_values(array_unique(array_merge(array_keys($beforeTerritories), array_keys($afterTerritories))));
    foreach ($territoryPublicIds as $publicId) {
        $territoryPublicId = (string) $publicId;
        if ($territoryPublicId === '') {
            continue;
        }

        $beforeSnapshot = is_array($beforeTerritories[$territoryPublicId] ?? null) ? $beforeTerritories[$territoryPublicId] : null;
        $afterSnapshot = is_array($afterTerritories[$territoryPublicId] ?? null) ? $afterTerritories[$territoryPublicId] : null;
        $currentRow = avesmapsPoliticalFetchTerritoryByPublicIdForAudit($pdo, $territoryPublicId, true);
        $currentSnapshot = $currentRow === null ? null : avesmapsPoliticalBuildTerritoryAuditSnapshot($currentRow);
        if (!avesmapsPoliticalAuditSnapshotsEqual($currentSnapshot, $afterSnapshot)) {
            throw new RuntimeException('Diese Aenderung kann nicht unabhaengig rueckgaengig gemacht werden, weil das Herrschaftsgebiet inzwischen geaendert wurde.');
        }

        if ($beforeSnapshot === null) {
            if ($currentRow !== null && (int) ($currentRow['is_active'] ?? 0) === 1) {
                $statement = $pdo->prepare('UPDATE political_territory SET is_active = 0 WHERE id = :id');
                $statement->execute(['id' => (int) $currentRow['id']]);
            }
            continue;
        }

        $statement = $pdo->prepare('UPDATE political_territory SET is_active = :is_active WHERE id = :id');
        $statement->execute([
            'id' => (int) ($currentRow['id'] ?? 0),
            'is_active' => (int) ($beforeSnapshot['is_active'] ?? 0) === 1 ? 1 : 0,
        ]);
    }
}

function avesmapsPoliticalApplyGeometryAuditSnapshot(PDO $pdo, string $geometryPublicId, array $snapshot, int $userId): void {
    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = :territory_id,
            geometry_geojson = :geometry_geojson,
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
            is_active = :is_active,
            updated_by = :updated_by
        WHERE public_id = :public_id'
    );
    $statement->execute([
        'public_id' => $geometryPublicId,
        'territory_id' => isset($snapshot['territory_id']) ? (int) $snapshot['territory_id'] : null,
        'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($snapshot['geometry_geojson'] ?? null),
        'valid_from_bf' => isset($snapshot['valid_from_bf']) ? avesmapsPoliticalNullableInt($snapshot['valid_from_bf']) : null,
        'valid_to_bf' => isset($snapshot['valid_to_bf']) ? avesmapsPoliticalNullableInt($snapshot['valid_to_bf']) : null,
        'min_zoom' => isset($snapshot['min_zoom']) ? avesmapsPoliticalNullableInt($snapshot['min_zoom']) : null,
        'max_zoom' => isset($snapshot['max_zoom']) ? avesmapsPoliticalNullableInt($snapshot['max_zoom']) : null,
        'min_x' => (float) ($snapshot['min_x'] ?? 0),
        'min_y' => (float) ($snapshot['min_y'] ?? 0),
        'max_x' => (float) ($snapshot['max_x'] ?? 0),
        'max_y' => (float) ($snapshot['max_y'] ?? 0),
        'source' => avesmapsPoliticalNullableString((string) ($snapshot['source'] ?? '')),
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($snapshot['style_json'] ?? null),
        'is_active' => (int) ($snapshot['is_active'] ?? 0) === 1 ? 1 : 0,
        'updated_by' => $userId > 0 ? $userId : null,
    ]);
}

function avesmapsPoliticalBuildUndoAuditAction(string $action): string {
    return mb_substr('undo_' . $action, 0, 80);
}

function avesmapsPoliticalMarkAuditEntryUndone(PDO $pdo, int $auditId, int $userId, int $undoAuditId): void {
    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry_audit_log
        SET undone_at = CURRENT_TIMESTAMP(3),
            undone_by = :undone_by,
            undo_audit_id = :undo_audit_id
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $auditId,
        'undone_by' => $userId > 0 ? $userId : null,
        'undo_audit_id' => $undoAuditId,
    ]);
}

function avesmapsPoliticalWriteGeometryAuditLog(PDO $pdo, string $action, int $actorUserId, array $beforePayload, array $afterPayload): int {
    $statement = $pdo->prepare(
        'INSERT INTO political_territory_geometry_audit_log (action, actor_user_id, before_json, after_json)
        VALUES (:action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'action' => avesmapsNormalizeSingleLine($action, 80),
        'actor_user_id' => $actorUserId > 0 ? $actorUserId : null,
        'before_json' => avesmapsPoliticalEncodeJsonOrNull($beforePayload) ?? '{}',
        'after_json' => avesmapsPoliticalEncodeJsonOrNull($afterPayload) ?? '{}',
    ]);

    $auditId = (int) $pdo->lastInsertId();
    avesmapsPoliticalPruneGeometryAuditLog($pdo, 250);

    return $auditId;
}

function avesmapsPoliticalDecodeAuditPayload(mixed $value): array {
    $decoded = avesmapsPoliticalDecodeJson($value);
    $geometries = is_array($decoded['geometries'] ?? null) ? $decoded['geometries'] : [];
    $territories = is_array($decoded['territories'] ?? null) ? $decoded['territories'] : [];

    return [
        'geometries' => $geometries,
        'territories' => $territories,
    ];
}

function avesmapsPoliticalPruneGeometryAuditLog(PDO $pdo, int $keepRows = 250): void {
    $keepRows = max(100, min(1000, $keepRows));

    $statement = $pdo->prepare(
        'DELETE FROM political_territory_geometry_audit_log
        WHERE id NOT IN (
            SELECT id FROM (
                SELECT id
                FROM political_territory_geometry_audit_log
                ORDER BY created_at DESC, id DESC
                LIMIT :keep_rows
            ) recent_entries
        )'
    );

    $statement->bindValue('keep_rows', $keepRows, PDO::PARAM_INT);
    $statement->execute();
}

function avesmapsPoliticalAuditSnapshotsEqual(?array $left, ?array $right): bool {
    if ($left === null || $right === null) {
        return $left === $right;
    }

    $leftJson = json_encode(avesmapsPoliticalNormalizeAuditValue($left), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $rightJson = json_encode(avesmapsPoliticalNormalizeAuditValue($right), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    return $leftJson === $rightJson;
}

function avesmapsPoliticalNormalizeAuditValue(mixed $value): mixed {
    if (!is_array($value)) {
        return $value;
    }

    if (avesmapsPoliticalArrayIsList($value)) {
        return array_map(static fn(mixed $entry): mixed => avesmapsPoliticalNormalizeAuditValue($entry), $value);
    }

    $normalized = [];
    $keys = array_keys($value);
    sort($keys, SORT_STRING);
    foreach ($keys as $key) {
        $normalized[(string) $key] = avesmapsPoliticalNormalizeAuditValue($value[$key]);
    }

    return $normalized;
}

function avesmapsPoliticalBuildGeometryAuditSnapshot(?array $row): ?array {
    if (!is_array($row)) {
        return null;
    }

    return [
        'public_id' => (string) ($row['public_id'] ?? ''),
        'territory_id' => isset($row['territory_id']) ? avesmapsPoliticalNullableInt($row['territory_id']) : null,
        'geometry_geojson' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
        'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNullableInt($row['valid_to_bf'] ?? null),
        'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
        'min_x' => round((float) ($row['min_x'] ?? 0), 6),
        'min_y' => round((float) ($row['min_y'] ?? 0), 6),
        'max_x' => round((float) ($row['max_x'] ?? 0), 6),
        'max_y' => round((float) ($row['max_y'] ?? 0), 6),
        'source' => (string) ($row['source'] ?? ''),
        'style_json' => avesmapsPoliticalDecodeJson($row['style_json'] ?? null),
        'is_active' => (int) ($row['is_active'] ?? 0) === 1 ? 1 : 0,
    ];
}

function avesmapsPoliticalBuildTerritoryAuditSnapshot(?array $row): ?array {
    if (!is_array($row)) {
        return null;
    }

    return [
        'public_id' => (string) ($row['public_id'] ?? ''),
        'is_active' => (int) ($row['is_active'] ?? 0) === 1 ? 1 : 0,
    ];
}

function avesmapsPoliticalFetchTerritoryByPublicIdForAudit(PDO $pdo, string $publicId, bool $forUpdate = false): ?array {
    $sql = 'SELECT *
        FROM political_territory
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

function avesmapsPoliticalFetchTerritoryByIdForAudit(PDO $pdo, int $territoryId, bool $forUpdate = false): ?array {
    $sql = 'SELECT *
        FROM political_territory
        WHERE id = :id
        LIMIT 1';
    if ($forUpdate) {
        $sql .= ' FOR UPDATE';
    }

    $statement = $pdo->prepare($sql);
    $statement->execute(['id' => $territoryId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
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

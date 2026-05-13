<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

const AVESMAPS_LOCATION_SUBTYPES = ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude'];
const AVESMAPS_FEATURE_LOCK_TTL_SECONDS = 120;

class AvesmapsConflictException extends RuntimeException {
}

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Kartendaten nicht bearbeiten.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST' && $requestMethod !== 'PATCH' && $requestMethod !== 'DELETE') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST, PATCH oder DELETE sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'move_point'), 40);
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapFeatureLocksTable($pdo);

    $result = match ($action) {
        'move_point' => avesmapsMovePointFeature($pdo, $payload, $user),
        'update_point' => avesmapsUpdatePointFeatureDetails($pdo, $payload, $user),
        'create_point' => avesmapsCreatePointFeature($pdo, $payload, $user),
        'create_crossing' => avesmapsCreateCrossingFeature($pdo, $payload, $user),
        'create_powerline' => avesmapsCreatePowerlineFeature($pdo, $payload, $user),
        'update_powerline_details' => avesmapsUpdatePowerlineFeatureDetails($pdo, $payload, $user),
        'create_path' => avesmapsCreatePathFeature($pdo, $payload, $user),
        'update_path_details' => avesmapsUpdatePathFeatureDetails($pdo, $payload, $user),
        'update_path_geometry' => avesmapsUpdatePathFeatureGeometry($pdo, $payload, $user),
        'create_label' => avesmapsCreateLabelFeature($pdo, $payload, $user),
        'update_label' => avesmapsUpdateLabelFeature($pdo, $payload, $user),
        'move_label' => avesmapsMoveLabelFeature($pdo, $payload, $user),
        'create_region' => avesmapsCreateRegionFeature($pdo, $payload, $user),
        'update_region' => avesmapsUpdateRegionFeature($pdo, $payload, $user),
        'update_region_geometry' => avesmapsUpdateRegionFeatureGeometry($pdo, $payload, $user),
        'delete_feature' => avesmapsDeleteMapFeature($pdo, $payload, $user),
        'undo_audit_change' => avesmapsUndoAuditChange($pdo, $payload, $user),
        'acquire_lock' => avesmapsAcquireMapFeatureLock($pdo, $payload, $user),
        'release_lock' => avesmapsReleaseMapFeatureLock($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Edit-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, [
        'ok' => true,
        'feature' => $result,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (AvesmapsConflictException $exception) {
    avesmapsJsonResponse(409, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Das Kartenobjekt konnte nicht gespeichert werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Das Kartenobjekt konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsReadMapFeaturePublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die Feature-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsReadLocationName(mixed $value): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException('Der Ortsname fehlt.');
    }

    return $name;
}

function avesmapsNormalizeDuplicateLocationName(string $value): string {
    $normalizedValue = mb_strtolower($value);
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $normalizedValue) ?? '';
}

function avesmapsAssertUniqueLocationName(PDO $pdo, string $name, ?string $excludePublicId = null): void {
    $normalizedName = avesmapsNormalizeDuplicateLocationName($name);
    if ($normalizedName === '') {
        return;
    }

    $statement = $pdo->prepare(
        'SELECT public_id, name
        FROM map_features
        WHERE feature_type = :feature_type
          AND is_active = 1'
        . ($excludePublicId !== null && $excludePublicId !== '' ? ' AND public_id <> :public_id' : '')
    );
    $parameters = [
        'feature_type' => 'location',
    ];
    if ($excludePublicId !== null && $excludePublicId !== '') {
        $parameters['public_id'] = $excludePublicId;
    }
    $statement->execute($parameters);

    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $existingName = (string) ($row['name'] ?? '');
        if ($existingName === '') {
            continue;
        }

        if (avesmapsNormalizeDuplicateLocationName($existingName) === $normalizedName) {
            throw new InvalidArgumentException('Ein Ort mit diesem Namen existiert bereits.');
        }
    }
}

function avesmapsReadFeatureName(mixed $value, string $fieldLabel): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException("{$fieldLabel} fehlt.");
    }

    return $name;
}

function avesmapsReadLocationSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'dorf'), 60);
    if (!in_array($subtype, AVESMAPS_LOCATION_SUBTYPES, true)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    return $subtype;
}

function avesmapsLocationSubtypeLabel(string $subtype): string {
    return match ($subtype) {
        'metropole' => 'Metropole',
        'grossstadt' => 'Grosse Stadt',
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleine Stadt',
        'gebaeude' => 'Besondere Bauwerke/Staetten',
        default => 'Dorf',
    };
}

function avesmapsReadLocationDescription(mixed $value): string {
    return avesmapsNormalizeMultiline((string) $value, 1200);
}

function avesmapsReadPathSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'Weg'), 60);
    $allowedSubtypes = ['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg'];
    if (!in_array($subtype, $allowedSubtypes, true)) {
        throw new InvalidArgumentException('Der Wegtyp ist ungueltig.');
    }

    return $subtype;
}

function avesmapsDefaultTransportDomainForPathSubtype(string $subtype): string {
    return match ($subtype) {
        'Flussweg' => 'river',
        'Seeweg' => 'sea',
        default => 'land',
    };
}

function avesmapsAllowedTransportOptionsForDomain(string $domain): array {
    return match ($domain) {
        'land' => ['caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider'],
        'river' => ['riverSailer', 'riverBarge'],
        'sea' => ['cargoShip', 'fastShip', 'galley'],
        'none' => [],
        default => [],
    };
}

function avesmapsAllowedTransportOptionsForPathSubtype(string $subtype): array {
    $options = avesmapsAllowedTransportOptionsForDomain(avesmapsDefaultTransportDomainForPathSubtype($subtype));
    if ($subtype === 'Wuestenpfad') {
        return array_values(array_filter($options, static fn(string $option): bool => $option !== 'horseCarriage'));
    }

    return $options;
}

function avesmapsReadTransportDomain(mixed $value, string $subtype): string {
    $domain = avesmapsNormalizeSingleLine((string) ($value ?: avesmapsDefaultTransportDomainForPathSubtype($subtype)), 20);
    return in_array($domain, ['land', 'river', 'sea', 'none'], true) ? $domain : avesmapsDefaultTransportDomainForPathSubtype($subtype);
}

function avesmapsReadAllowedTransports(mixed $value, string $domain, ?string $subtype = null): array {
    $compatibleOptions = avesmapsAllowedTransportOptionsForDomain($domain);
    if ($subtype === 'Wuestenpfad') {
        $compatibleOptions = array_values(array_filter($compatibleOptions, static fn(string $option): bool => $option !== 'horseCarriage'));
    }
    if (!is_array($value)) {
        return $compatibleOptions;
    }

    $allowedOptions = [];
    foreach ($value as $option) {
        $normalizedOption = avesmapsNormalizeSingleLine((string) $option, 40);
        if (!in_array($normalizedOption, $compatibleOptions, true)) {
            continue;
        }
        $allowedOptions[] = $normalizedOption;
    }

    $allowedOptions = array_values(array_unique($allowedOptions));
    return $allowedOptions;
}

function avesmapsReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsReadOptionalRevision(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $revision = filter_var($value, FILTER_VALIDATE_INT);
    if ($revision === false || $revision < 0) {
        throw new InvalidArgumentException('Die Feature-Revision ist ungueltig.');
    }

    return (int) $revision;
}

function avesmapsReadAuditLogId(mixed $value): int {
    $auditId = filter_var($value, FILTER_VALIDATE_INT);
    if ($auditId === false || $auditId <= 0) {
        throw new InvalidArgumentException('Die Änderungs-ID ist ungueltig.');
    }

    return (int) $auditId;
}

function avesmapsEnsureMapAuditUndoColumns(PDO $pdo): void {
    $columns = avesmapsFetchTableColumnNames($pdo, 'map_audit_log');
    $missingDefinitions = [];
    if (!isset($columns['undone_at'])) {
        $missingDefinitions[] = 'ADD COLUMN undone_at DATETIME(3) NULL';
    }
    if (!isset($columns['undone_by'])) {
        $missingDefinitions[] = 'ADD COLUMN undone_by BIGINT UNSIGNED NULL';
    }
    if (!isset($columns['undo_audit_id'])) {
        $missingDefinitions[] = 'ADD COLUMN undo_audit_id BIGINT UNSIGNED NULL';
    }

    if ($missingDefinitions !== []) {
        $pdo->exec('ALTER TABLE map_audit_log ' . implode(', ', $missingDefinitions));
    }
}

function avesmapsFetchTableColumnNames(PDO $pdo, string $tableName): array {
    if (preg_match('/^[a-z0-9_]+$/i', $tableName) !== 1) {
        throw new InvalidArgumentException('Der Tabellenname ist ungueltig.');
    }

    $statement = $pdo->query("SHOW COLUMNS FROM {$tableName}");
    $columns = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
        $columnName = (string) ($row['Field'] ?? '');
        if ($columnName !== '') {
            $columns[$columnName] = true;
        }
    }

    return $columns;
}

function avesmapsBuildAuditAfterSnapshot(array $snapshot, array $payload): array {
    $reviewReportId = filter_var($payload['review_report_id'] ?? null, FILTER_VALIDATE_INT);
    $reviewReportSource = avesmapsNormalizeSingleLine((string) ($payload['review_report_source'] ?? ''), 40);
    if ($reviewReportId !== false && $reviewReportId > 0 && in_array($reviewReportSource, ['location_reports', 'map_reports'], true)) {
        $snapshot['audit_context'] = [
            'review_report' => [
                'id' => (int) $reviewReportId,
                'source' => $reviewReportSource,
            ],
        ];
    }

    return $snapshot;
}

function avesmapsCanUndoAuditAction(string $action): bool {
    return avesmapsIsCreateAuditAction($action)
        || $action === 'delete_feature'
        || avesmapsUndoColumnsForAuditAction($action) !== [];
}

function avesmapsIsCreateAuditAction(string $action): bool {
    return in_array($action, [
        'create_point',
        'wiki_sync_create_point',
        'create_crossing',
        'create_powerline',
        'create_path',
        'create_label',
        'create_region',
    ], true);
}

function avesmapsCreateUndoColumnsForAuditAction(string $action): array {
    if (!avesmapsIsCreateAuditAction($action)) {
        return [];
    }

    return ['feature_type', 'feature_subtype', 'geometry_json', 'properties_json'];
}

function avesmapsUndoColumnsForAuditAction(string $action): array {
    return match ($action) {
        'move_point',
        'move_label',
        'update_path_geometry',
        'update_region_geometry' => ['geometry_json'],
        'update_point',
        'wiki_sync_update_point',
        'update_powerline_details',
        'update_path_details',
        'update_label' => ['name', 'feature_subtype', 'properties_json'],
        'update_region' => ['name', 'properties_json', 'style_json'],
        default => [],
    };
}

function avesmapsUndoAuditChange(PDO $pdo, array $payload, array $user): array {
    $auditId = avesmapsReadAuditLogId($payload['audit_id'] ?? null);
    avesmapsEnsureMapAuditUndoColumns($pdo);

    $pdo->beginTransaction();
    try {
        $auditEntry = avesmapsFetchAuditEntryForUndo($pdo, $auditId);
        $action = (string) $auditEntry['action'];
        if (!avesmapsCanUndoAuditAction($action) || str_starts_with($action, 'undo_')) {
            throw new InvalidArgumentException('Diese Änderung kann nicht rückgängig gemacht werden.');
        }
        if (!empty($auditEntry['undone_at'])) {
            throw new InvalidArgumentException('Diese Änderung wurde bereits rückgängig gemacht.');
        }

        $featureId = (int) ($auditEntry['feature_id'] ?? 0);
        if ($featureId <= 0) {
            throw new InvalidArgumentException('Diese Änderung ist keinem Kartenobjekt zugeordnet.');
        }

        $featureBeforeUndo = avesmapsFetchFeatureByIdForUpdate($pdo, $featureId);
        avesmapsAssertFeatureCanBeEdited($pdo, [], $featureBeforeUndo, $user);
        $beforeSnapshot = avesmapsDecodeJsonColumnForEdit($auditEntry['before_json'] ?? null);
        $afterSnapshot = avesmapsDecodeJsonColumnForEdit($auditEntry['after_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);
        $updates = avesmapsBuildUndoFeatureUpdates($action, $featureBeforeUndo, $beforeSnapshot, $afterSnapshot, $revision, (int) $user['id']);
        avesmapsAssertUndoNameIsAvailable($pdo, $featureBeforeUndo, $updates);
        avesmapsApplyFeatureUpdates($pdo, $featureId, $updates);

        $featureAfterUndo = avesmapsFetchFeatureByIdForUpdate($pdo, $featureId);
        avesmapsRestoreExternalReviewStateAfterUndo($pdo, $action, $beforeSnapshot, $afterSnapshot);
        $undoAuditId = avesmapsWriteMapAuditLog(
            $pdo,
            $featureId,
            avesmapsBuildUndoAuditAction($action),
            (int) $user['id'],
            avesmapsEncodeAuditJson($featureBeforeUndo),
            avesmapsEncodeAuditJson(avesmapsBuildUndoAuditSnapshot($featureAfterUndo, $auditId))
        );
        avesmapsMarkAuditEntryUndone($pdo, $auditId, (int) $user['id'], $undoAuditId);

        $pdo->commit();
        return avesmapsBuildFeatureResponseFromStoredFeature($featureAfterUndo);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsFetchAuditEntryForUndo(PDO $pdo, int $auditId): array {
    $statement = $pdo->prepare(
        'SELECT id, feature_id, action, before_json, after_json, undone_at
        FROM map_audit_log
        WHERE id = :id
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute(['id' => $auditId]);
    $auditEntry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$auditEntry) {
        throw new InvalidArgumentException('Die Änderung wurde nicht gefunden.');
    }

    return $auditEntry;
}

function avesmapsFetchFeatureByIdForUpdate(PDO $pdo, int $featureId): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, min_x, min_y, max_x, max_y, is_active, revision
        FROM map_features
        WHERE id = :id
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute(['id' => $featureId]);
    $feature = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }

    return $feature;
}

function avesmapsBuildUndoFeatureUpdates(string $action, array $feature, array $beforeSnapshot, array $afterSnapshot, int $revision, int $userId): array {
    if (avesmapsIsCreateAuditAction($action)) {
        if ((int) ($feature['is_active'] ?? 1) !== 1) {
            throw new AvesmapsConflictException('Das erstellte Objekt ist bereits nicht mehr aktiv.');
        }

        avesmapsAssertUndoPatchStillCurrent($action, $feature, $afterSnapshot, avesmapsCreateUndoColumnsForAuditAction($action));

        return [
            'is_active' => 0,
            'revision' => $revision,
            'updated_by' => $userId,
        ];
    }

    $columns = $action === 'delete_feature'
        ? ['feature_type', 'feature_subtype', 'name', 'geometry_type', 'geometry_json', 'properties_json', 'style_json', 'min_x', 'min_y', 'max_x', 'max_y', 'is_active']
        : avesmapsUndoColumnsForAuditAction($action);
    if ($columns === []) {
        throw new InvalidArgumentException('Diese Änderung kann nicht rückgängig gemacht werden.');
    }

    $conflictColumns = $action === 'delete_feature' ? ['is_active'] : array_values(array_unique([...$columns, 'is_active']));
    avesmapsAssertUndoPatchStillCurrent($action, $feature, $afterSnapshot, $conflictColumns);
    $updates = avesmapsBuildFeatureRestoreValues($beforeSnapshot, $columns);
    if ($action === 'delete_feature') {
        $updates['is_active'] = 1;
    }
    if (array_key_exists('geometry_json', $updates)) {
        $bounds = avesmapsCalculateGeometryBounds(avesmapsReadGeometryFromColumnValue($updates['geometry_json']));
        $updates['min_x'] = $bounds['min_x'];
        $updates['min_y'] = $bounds['min_y'];
        $updates['max_x'] = $bounds['max_x'];
        $updates['max_y'] = $bounds['max_y'];
    }
    $updates['revision'] = $revision;
    $updates['updated_by'] = $userId;

    return $updates;
}

function avesmapsAssertUndoPatchStillCurrent(string $action, array $feature, array $afterSnapshot, array $columns): void {
    foreach ($columns as $column) {
        if (array_key_exists($column, $afterSnapshot)) {
            $afterValue = $afterSnapshot[$column] ?? null;
        } else {
            $inferredAfterValue = avesmapsInferUndoAfterColumnValue($action, $column);
            if (!$inferredAfterValue['found']) {
                throw new AvesmapsConflictException('Diese Aenderung enthaelt nicht genug Audit-Daten fuer ein unabhaengiges Rueckgaengigmachen.');
            }

            $afterValue = $inferredAfterValue['value'];
        }

        $currentValue = avesmapsNormalizeFeatureColumnValue($column, $feature[$column] ?? null);
        $normalizedAfterValue = avesmapsNormalizeFeatureColumnValue($column, $afterValue);
        if ($currentValue !== $normalizedAfterValue) {
            throw new AvesmapsConflictException('Diese Änderung kann nicht unabhängig rückgängig gemacht werden, weil das Objekt inzwischen erneut geändert wurde.');
        }
    }
}

function avesmapsInferUndoAfterColumnValue(string $action, string $column): array {
    if ($column === 'is_active' && $action !== 'delete_feature') {
        return [
            'found' => true,
            'value' => 1,
        ];
    }

    $constantAfterValues = match ($action) {
        'create_point',
        'wiki_sync_create_point',
        'update_point',
        'wiki_sync_update_point' => [
            'feature_type' => 'location',
        ],
        'create_crossing' => [
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
        ],
        'create_powerline',
        'update_powerline_details' => [
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
        ],
        'create_path',
        'update_path_details' => [
            'feature_type' => 'path',
        ],
        'create_label' => [
            'feature_type' => 'label',
        ],
        'create_region' => [
            'feature_type' => 'region',
            'feature_subtype' => 'region',
        ],
        default => [],
    };

    if (!array_key_exists($column, $constantAfterValues)) {
        return [
            'found' => false,
            'value' => null,
        ];
    }

    return [
        'found' => true,
        'value' => $constantAfterValues[$column],
    ];
}

function avesmapsBuildFeatureRestoreValues(array $snapshot, array $columns): array {
    $updates = [];
    foreach ($columns as $column) {
        if (array_key_exists($column, $snapshot)) {
            $updates[$column] = avesmapsPrepareFeatureColumnValue($column, $snapshot[$column]);
        }
    }

    return $updates;
}

function avesmapsPrepareFeatureColumnValue(string $column, mixed $value): mixed {
    if (in_array($column, ['geometry_json', 'properties_json', 'style_json'], true)) {
        if ($value === null || $value === '') {
            return null;
        }

        return avesmapsEncodeJson(avesmapsDecodeFeatureJsonValue($value));
    }
    if ($column === 'is_active') {
        return (int) $value === 1 ? 1 : 0;
    }
    if (in_array($column, ['min_x', 'min_y', 'max_x', 'max_y'], true)) {
        return round((float) $value, 4);
    }

    return $value;
}

function avesmapsNormalizeFeatureColumnValue(string $column, mixed $value): string {
    if (in_array($column, ['geometry_json', 'properties_json', 'style_json'], true)) {
        return avesmapsEncodeJson(avesmapsDecodeFeatureJsonValue($value));
    }
    if ($column === 'is_active') {
        return (string) ((int) $value === 1 ? 1 : 0);
    }
    if (in_array($column, ['min_x', 'min_y', 'max_x', 'max_y'], true)) {
        return number_format((float) $value, 4, '.', '');
    }
    if ($value === null) {
        return '';
    }

    return (string) $value;
}

function avesmapsDecodeFeatureJsonValue(mixed $value): mixed {
    if ($value === null || $value === '') {
        return null;
    }
    if (is_array($value)) {
        return $value;
    }

    $decoded = json_decode((string) $value, true);
    return is_array($decoded) ? $decoded : null;
}

function avesmapsReadGeometryFromColumnValue(mixed $value): array {
    $geometry = avesmapsDecodeFeatureJsonValue($value);
    if (!is_array($geometry) || !isset($geometry['type'])) {
        throw new RuntimeException('Die Geometrie der Änderung ist ungueltig.');
    }

    return $geometry;
}

function avesmapsCalculateGeometryBounds(array $geometry): array {
    $coordinatePairs = [];
    avesmapsCollectGeometryCoordinatePairs($geometry['coordinates'] ?? null, $coordinatePairs);
    if ($coordinatePairs === []) {
        throw new RuntimeException('Die Geometrie enthaelt keine Koordinaten.');
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

function avesmapsCollectGeometryCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void {
    if (!is_array($coordinates)) {
        return;
    }
    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];
        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsCollectGeometryCoordinatePairs($coordinate, $coordinatePairs);
    }
}

function avesmapsAssertUndoNameIsAvailable(PDO $pdo, array $feature, array $updates): void {
    $featureType = (string) ($updates['feature_type'] ?? $feature['feature_type'] ?? '');
    $isActive = (int) ($updates['is_active'] ?? $feature['is_active'] ?? 1) === 1;
    $name = (string) ($updates['name'] ?? $feature['name'] ?? '');
    if ($isActive && $featureType === 'location' && $name !== '') {
        avesmapsAssertUniqueLocationName($pdo, $name, (string) $feature['public_id']);
    }
}

function avesmapsApplyFeatureUpdates(PDO $pdo, int $featureId, array $updates): void {
    $allowedColumns = [
        'feature_type' => true,
        'feature_subtype' => true,
        'name' => true,
        'geometry_type' => true,
        'geometry_json' => true,
        'properties_json' => true,
        'style_json' => true,
        'min_x' => true,
        'min_y' => true,
        'max_x' => true,
        'max_y' => true,
        'is_active' => true,
        'revision' => true,
        'updated_by' => true,
    ];
    $assignments = [];
    $parameters = ['id' => $featureId];
    foreach ($updates as $column => $value) {
        if (!isset($allowedColumns[$column])) {
            continue;
        }

        $assignments[] = "{$column} = :{$column}";
        $parameters[$column] = $value;
    }
    if ($assignments === []) {
        throw new RuntimeException('Es gibt keine Undo-Änderungen zum Speichern.');
    }

    $statement = $pdo->prepare('UPDATE map_features SET ' . implode(', ', $assignments) . ' WHERE id = :id');
    $statement->execute($parameters);
}

function avesmapsBuildUndoAuditAction(string $action): string {
    return mb_substr('undo_' . $action, 0, 40);
}

function avesmapsBuildUndoAuditSnapshot(array $feature, int $auditId): array {
    $snapshot = $feature;
    $snapshot['undo_audit_id'] = $auditId;
    return $snapshot;
}

function avesmapsMarkAuditEntryUndone(PDO $pdo, int $auditId, int $userId, int $undoAuditId): void {
    $statement = $pdo->prepare(
        'UPDATE map_audit_log
        SET undone_at = CURRENT_TIMESTAMP(3),
            undone_by = :undone_by,
            undo_audit_id = :undo_audit_id
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $auditId,
        'undone_by' => $userId,
        'undo_audit_id' => $undoAuditId,
    ]);
}

function avesmapsRestoreExternalReviewStateAfterUndo(PDO $pdo, string $action, array $beforeSnapshot, array $afterSnapshot): void {
    $wikiSyncCaseId = avesmapsReadAuditContextId($afterSnapshot, 'wiki_sync_case_id') ?? avesmapsReadAuditContextId($beforeSnapshot, 'wiki_sync_case_id');
    if ($wikiSyncCaseId !== null && str_starts_with($action, 'wiki_sync_') && avesmapsTableExistsForAudit($pdo, 'wiki_sync_cases')) {
        $statement = $pdo->prepare(
            "UPDATE wiki_sync_cases
            SET status = 'open',
                reviewed_at = NULL,
                reviewed_by = NULL,
                resolution_json = NULL
            WHERE id = :id"
        );
        $statement->execute(['id' => $wikiSyncCaseId]);
    }

    $reviewReport = avesmapsReadAuditReviewReportContext($afterSnapshot) ?? avesmapsReadAuditReviewReportContext($beforeSnapshot);
    if ($reviewReport !== null && avesmapsIsCreateAuditAction($action) && avesmapsTableExistsForAudit($pdo, $reviewReport['source'])) {
        $reviewedBySql = $reviewReport['source'] === 'map_reports' ? ', reviewed_by = NULL' : '';
        $statement = $pdo->prepare(
            "UPDATE {$reviewReport['source']}
            SET status = 'neu',
                reviewed_at = NULL,
                review_note = NULL
                {$reviewedBySql}
            WHERE id = :id"
        );
        $statement->execute(['id' => $reviewReport['id']]);
    }
}

function avesmapsReadAuditContextId(array $snapshot, string $key): ?int {
    $context = is_array($snapshot['audit_context'] ?? null) ? $snapshot['audit_context'] : [];
    $value = $snapshot[$key] ?? $context[$key] ?? null;
    $id = filter_var($value, FILTER_VALIDATE_INT);
    return $id !== false && $id > 0 ? (int) $id : null;
}

function avesmapsReadAuditReviewReportContext(array $snapshot): ?array {
    $context = is_array($snapshot['audit_context'] ?? null) ? $snapshot['audit_context'] : [];
    $reviewReport = is_array($context['review_report'] ?? null) ? $context['review_report'] : [];
    $id = filter_var($snapshot['review_report_id'] ?? $reviewReport['id'] ?? null, FILTER_VALIDATE_INT);
    $source = avesmapsNormalizeSingleLine((string) ($snapshot['review_report_source'] ?? $reviewReport['source'] ?? ''), 40);
    if ($id === false || $id <= 0 || !in_array($source, ['location_reports', 'map_reports'], true)) {
        return null;
    }

    return [
        'id' => (int) $id,
        'source' => $source,
    ];
}

function avesmapsTableExistsForAudit(PDO $pdo, string $tableName): bool {
    if (preg_match('/^[a-z0-9_]+$/i', $tableName) !== 1) {
        return false;
    }

    $statement = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($tableName));
    return $statement !== false && $statement->fetch() !== false;
}

function avesmapsBuildFeatureResponseFromStoredFeature(array $feature): array {
    $publicId = (string) $feature['public_id'];
    $revision = (int) $feature['revision'];
    if ((int) ($feature['is_active'] ?? 1) !== 1) {
        return [
            'public_id' => $publicId,
            'deleted' => true,
            'revision' => $revision,
        ];
    }

    $geometry = avesmapsReadGeometryFromColumnValue($feature['geometry_json'] ?? null);
    $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
    $featureType = (string) ($feature['feature_type'] ?? $properties['feature_type'] ?? '');
    $featureSubtype = (string) ($feature['feature_subtype'] ?? $properties['feature_subtype'] ?? '');
    $name = (string) ($feature['name'] ?? $properties['name'] ?? '');

    if ($featureType === 'label') {
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        return avesmapsBuildLabelFeatureResponse($publicId, $name, $featureSubtype, $lat, $lng, $properties, $revision);
    }
    if ($featureType === 'powerline') {
        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    }
    if ($featureType === 'region' || ($geometry['type'] ?? '') === 'Polygon') {
        $style = avesmapsDecodeJsonColumnForEdit($feature['style_json'] ?? null);
        return avesmapsBuildRegionFeatureResponse($publicId, $name, $geometry, $properties + $style, $revision);
    }
    if (($geometry['type'] ?? '') === 'LineString') {
        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $featureSubtype, $geometry, $properties, $revision);
    }
    if (($geometry['type'] ?? '') === 'Point') {
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        return avesmapsBuildPointFeatureResponse($publicId, $name, $featureSubtype, $lat, $lng, $properties, $revision);
    }

    throw new RuntimeException('Das wiederhergestellte Kartenobjekt kann nicht dargestellt werden.');
}

function avesmapsReadLabelSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'region'), 40);
    $allowedSubtypes = ['region', 'fluss', 'meer', 'gebirge', 'berggipfel', 'wald', 'kontinent', 'wueste', 'suempfe_moore', 'see', 'insel', 'sonstiges'];
    if (!in_array($subtype, $allowedSubtypes, true)) {
        throw new InvalidArgumentException('Die Label-Kategorie ist ungueltig.');
    }

    return $subtype;
}

function avesmapsReadLabelText(mixed $value): string {
    return avesmapsReadFeatureName($value, 'Der Labeltext');
}

function avesmapsReadLabelSize(mixed $value): int {
    $size = filter_var($value, FILTER_VALIDATE_INT);
    if ($size === false || $size < 10 || $size > 56) {
        throw new InvalidArgumentException('Die Label-Groesse ist ungueltig.');
    }

    return (int) $size;
}

function avesmapsReadLabelRotation(mixed $value): int {
    $rotation = filter_var($value, FILTER_VALIDATE_INT);
    if ($rotation === false || $rotation < -180 || $rotation > 180) {
        throw new InvalidArgumentException('Die Label-Rotation ist ungueltig.');
    }

    return (int) $rotation;
}

function avesmapsReadLabelZoom(mixed $value): int {
    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    if ($zoom === false || $zoom < 0 || $zoom > 5) {
        throw new InvalidArgumentException('Die Label-Zoomstufe ist ungueltig.');
    }

    return (int) $zoom;
}

function avesmapsReadLabelPriority(mixed $value): int {
    $priority = filter_var($value, FILTER_VALIDATE_INT);
    if ($priority === false || $priority < 1 || $priority > 5) {
        throw new InvalidArgumentException('Die Label-Prioritaet ist ungueltig.');
    }

    return (int) $priority;
}

function avesmapsReadHexColor(mixed $value): string {
    $color = avesmapsNormalizeSingleLine((string) ($value ?: '#888888'), 9);
    if (!preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color)) {
        throw new InvalidArgumentException('Der Farbwert ist ungueltig.');
    }

    return $color;
}

function avesmapsReadOpacity(mixed $value): float {
    $opacity = filter_var($value, FILTER_VALIDATE_FLOAT);
    if ($opacity === false || $opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('Die Transparenz ist ungueltig.');
    }

    return (float) $opacity;
}

function avesmapsReadPolygonCoordinates(mixed $value): array {
    if (!is_array($value) || count($value) < 1 || !is_array($value[0] ?? null) || count($value[0]) < 4) {
        throw new InvalidArgumentException('Eine Region braucht mindestens drei Punkte.');
    }

    $ring = [];
    foreach ($value[0] as $coordinate) {
        if (!is_array($coordinate) || count($coordinate) !== 2) {
            throw new InvalidArgumentException('Die Regionskoordinaten sind ungueltig.');
        }
        $ring[] = [
            avesmapsParseMapCoordinate($coordinate[0], 'lng'),
            avesmapsParseMapCoordinate($coordinate[1], 'lat'),
        ];
    }

    return [$ring];
}

function avesmapsReadOptionalWikiUrl(mixed $value): string {
    return avesmapsNormalizeOptionalUrl((string) $value, 500, 'Der Wiki-Aventurica-Link');
}

function avesmapsFetchEditableFeature(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, revision
        FROM map_features
        WHERE public_id = :public_id
            AND is_active = 1
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute([
        'public_id' => $publicId,
    ]);

    $feature = $statement->fetch();
    if (!$feature) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }

    return $feature;
}

function avesmapsFetchEditablePointFeature(PDO $pdo, string $publicId): array {
    $feature = avesmapsFetchEditableFeature($pdo, $publicId);
    if ((string) $feature['geometry_type'] !== 'Point') {
        throw new InvalidArgumentException('Aktuell kann diese Aktion nur Punkte bearbeiten.');
    }

    return $feature;
}

function avesmapsFetchEditableLineStringFeature(PDO $pdo, string $publicId): array {
    $feature = avesmapsFetchEditableFeature($pdo, $publicId);
    if ((string) $feature['geometry_type'] !== 'LineString') {
        throw new InvalidArgumentException('Diese Aktion kann nur Wege bearbeiten.');
    }

    return $feature;
}

function avesmapsEnsureMapFeatureLocksTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_feature_locks (
            public_id CHAR(36) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            username VARCHAR(120) NOT NULL,
            locked_until DATETIME(3) NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (public_id),
            KEY idx_map_feature_locks_locked_until (locked_until)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsAssertFeatureCanBeEdited(PDO $pdo, array $payload, array $feature, array $user): void {
    $expectedRevision = avesmapsReadOptionalRevision($payload['expected_revision'] ?? null);
    if ($expectedRevision !== null && $expectedRevision !== (int) $feature['revision']) {
        throw new AvesmapsConflictException('Dieses Kartenobjekt wurde inzwischen geaendert. Bitte neu laden.');
    }

    $statement = $pdo->prepare(
        'SELECT user_id, username
        FROM map_feature_locks
        WHERE public_id = :public_id
            AND locked_until > NOW(3)
        LIMIT 1'
    );
    $statement->execute(['public_id' => (string) $feature['public_id']]);
    $lock = $statement->fetch();
    if ($lock && (int) $lock['user_id'] !== (int) $user['id']) {
        throw new AvesmapsConflictException('Dieses Kartenobjekt wird gerade von ' . (string) $lock['username'] . ' bearbeitet.');
    }
}

function avesmapsAcquireMapFeatureLock(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    avesmapsEnsureMapFeatureLocksTable($pdo);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $statement = $pdo->prepare(
            'INSERT INTO map_feature_locks (public_id, user_id, username, locked_until)
            VALUES (:public_id, :user_id, :username, DATE_ADD(NOW(3), INTERVAL ' . AVESMAPS_FEATURE_LOCK_TTL_SECONDS . ' SECOND))
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                username = VALUES(username),
                locked_until = VALUES(locked_until)'
        );
        $statement->execute([
            'public_id' => $publicId,
            'user_id' => (int) $user['id'],
            'username' => (string) ($user['username'] ?? 'Editor'),
        ]);
        $pdo->commit();

        return [
            'public_id' => $publicId,
            'locked' => true,
            'locked_by' => (string) ($user['username'] ?? 'Editor'),
            'locked_until_seconds' => AVESMAPS_FEATURE_LOCK_TTL_SECONDS,
            'revision' => (int) $feature['revision'],
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsReleaseMapFeatureLock(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    avesmapsEnsureMapFeatureLocksTable($pdo);
    $statement = $pdo->prepare('DELETE FROM map_feature_locks WHERE public_id = :public_id AND user_id = :user_id');
    $statement->execute([
        'public_id' => $publicId,
        'user_id' => (int) $user['id'],
    ]);

    return [
        'public_id' => $publicId,
        'locked' => false,
    ];
}

function avesmapsMovePointFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_lng,
                min_y = :min_lat,
                max_x = :max_lng,
                max_y = :max_lat,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_lng' => $lng,
            'min_lat' => $lat,
            'max_lng' => $lng,
            'max_lat' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'move_point', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, (string) ($feature['name'] ?? ''), (string) $feature['feature_subtype'], $lat, $lng, avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null), $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePointFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsReadLocationSubtype($payload['feature_subtype'] ?? $payload['location_type'] ?? 'dorf');
    $description = avesmapsReadLocationDescription($payload['description'] ?? '');
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $currentName = (string) ($feature['name'] ?? '');
        if (avesmapsNormalizeDuplicateLocationName($currentName) !== avesmapsNormalizeDuplicateLocationName($name)) {
            avesmapsAssertUniqueLocationName($pdo, $name, $publicId);
        }
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $name;
        $properties['feature_type'] = 'location';
        $properties['feature_subtype'] = $subtype;
        $properties['settlement_class'] = $subtype;
        $properties['settlement_class_label'] = avesmapsLocationSubtypeLabel($subtype);
        $properties['is_nodix'] = avesmapsReadBoolean($payload['is_nodix'] ?? false);
        $properties['is_ruined'] = avesmapsReadBoolean($payload['is_ruined'] ?? false);
        if ($description === '') {
            unset($properties['description']);
        } else {
            $properties['description'] = $description;
        }
        if ($wikiUrl === '') {
            unset($properties['wiki_url']);
        } else {
            $properties['wiki_url'] = $wikiUrl;
        }

        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'location',
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_point', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'name' => $name,
            'feature_subtype' => $subtype,
            'is_nodix' => $properties['is_nodix'],
            'is_ruined' => $properties['is_ruined'],
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePointFeature(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsReadLocationSubtype($payload['feature_subtype'] ?? $payload['location_type'] ?? 'dorf');
    $description = avesmapsReadLocationDescription($payload['description'] ?? '');
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'settlement_class' => $subtype,
        'settlement_class_label' => avesmapsLocationSubtypeLabel($subtype),
        'is_nodix' => avesmapsReadBoolean($payload['is_nodix'] ?? false),
        'is_ruined' => avesmapsReadBoolean($payload['is_ruined'] ?? false),
    ];
    if ($description !== '') {
        $properties['description'] = $description;
    }
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    $pdo->beginTransaction();
    try {
        avesmapsAssertUniqueLocationName($pdo, $name);
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'feature_subtype' => $subtype,
            'name' => $name,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_point', (int) $user['id'], '{}', avesmapsEncodeAuditJson(avesmapsBuildAuditAfterSnapshot([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'name' => $name,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ], $payload)));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateCrossingFeature(PDO $pdo, array $payload, array $user): array {
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $name = 'Kreuzung';
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'junction',
        'feature_subtype' => 'crossing',
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
            'name' => $name,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_crossing', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, 'crossing', $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePowerlineFeature(PDO $pdo, array $payload, array $user): array {
    $fromPublicId = avesmapsReadMapFeaturePublicId($payload['from_public_id'] ?? '');
    $toPublicId = avesmapsReadMapFeaturePublicId($payload['to_public_id'] ?? '');
    if ($fromPublicId === $toPublicId) {
        throw new InvalidArgumentException('Start und Ziel muessen verschieden sein.');
    }

    $pdo->beginTransaction();
    try {
        $fromFeature = avesmapsFetchEditablePointFeature($pdo, $fromPublicId);
        $toFeature = avesmapsFetchEditablePointFeature($pdo, $toPublicId);
        $fromProperties = avesmapsDecodeJsonColumnForEdit($fromFeature['properties_json'] ?? null);
        $toProperties = avesmapsDecodeJsonColumnForEdit($toFeature['properties_json'] ?? null);
        $fromIsEligibleEndpoint = !empty($fromProperties['is_nodix']) || (string) ($fromFeature['feature_subtype'] ?? '') === 'crossing';
        $toIsEligibleEndpoint = !empty($toProperties['is_nodix']) || (string) ($toFeature['feature_subtype'] ?? '') === 'crossing';
        if (!$fromIsEligibleEndpoint || !$toIsEligibleEndpoint) {
            throw new InvalidArgumentException('Kraftlinien koennen nur Nodix-Orte verbinden.');
        }

        $fromGeometry = avesmapsDecodeJsonColumnForEdit($fromFeature['geometry_json'] ?? null);
        $toGeometry = avesmapsDecodeJsonColumnForEdit($toFeature['geometry_json'] ?? null);
        [$fromLng, $fromLat] = avesmapsReadPointCoordinatesFromGeometry($fromGeometry);
        [$toLng, $toLat] = avesmapsReadPointCoordinatesFromGeometry($toGeometry);
        $publicId = avesmapsUuidV4();
        $name = trim((string) ($fromFeature['name'] ?? 'Nodix') . ' - ' . (string) ($toFeature['name'] ?? 'Nodix'));
        $geometry = [
            'type' => 'LineString',
            'coordinates' => [[$fromLng, $fromLat], [$toLng, $toLat]],
        ];
        $properties = [
            'name' => $name,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'show_label' => false,
            'from_public_id' => $fromPublicId,
            'to_public_id' => $toPublicId,
        ];
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'name' => $name,
            'geometry_type' => 'LineString',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => min($fromLng, $toLng),
            'min_y' => min($fromLat, $toLat),
            'max_x' => max($fromLng, $toLng),
            'max_y' => max($fromLat, $toLat),
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_powerline', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'name' => $name,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePowerlineFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Name der Kraftlinie');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $name;
        $properties['feature_type'] = 'powerline';
        $properties['feature_subtype'] = 'powerline';
        $properties['show_label'] = $showLabel;
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_powerline_details', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'name' => $name,
            'show_label' => $showLabel,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePathFeature(PDO $pdo, array $payload, array $user): array {
    $subtype = avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg');
    $name = avesmapsReadFeatureName($payload['name'] ?? $subtype, 'Der Wegname');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    $transportDomain = avesmapsDefaultTransportDomainForPathSubtype($subtype);
    $allowedTransports = avesmapsReadAllowedTransports($payload['allowed_transports'] ?? null, $transportDomain, $subtype);
    $coordinates = avesmapsReadLineStringCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates);

    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'LineString',
        'coordinates' => $coordinates,
    ];
    $properties = [
        'name' => $name,
        'display_name' => $name,
        'feature_type' => 'path',
        'feature_subtype' => $subtype,
        'show_label' => $showLabel,
        'transport_domain' => $transportDomain,
        'allowed_transports' => $allowedTransports,
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'feature_subtype' => $subtype,
            'name' => $name,
            'geometry_type' => 'LineString',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_path', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'name' => $name,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePathFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Wegname');
    $subtype = avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    $transportDomain = avesmapsDefaultTransportDomainForPathSubtype($subtype);
    $allowedTransports = avesmapsReadAllowedTransports($payload['allowed_transports'] ?? null, $transportDomain, $subtype);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $name;
        $properties['display_name'] = $name;
        $properties['feature_type'] = 'path';
        $properties['feature_subtype'] = $subtype;
        $properties['show_label'] = $showLabel;
        $properties['transport_domain'] = $transportDomain;
        $properties['allowed_transports'] = $allowedTransports;
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'path',
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_details', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'name' => $name,
            'feature_subtype' => $subtype,
            'show_label' => $showLabel,
            'transport_domain' => $transportDomain,
            'allowed_transports' => $allowedTransports,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePathFeatureGeometry(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $coordinates = avesmapsReadLineStringCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $name = avesmapsNormalizeSingleLine((string) ($feature['name'] ?? $properties['name'] ?? 'Weg'), 160) ?: 'Weg';
        $subtype = avesmapsReadPathSubtype($feature['feature_subtype'] ?? $properties['feature_subtype'] ?? 'Weg');
        $geometry = [
            'type' => 'LineString',
            'coordinates' => $coordinates,
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_x,
                min_y = :min_y,
                max_x = :max_x,
                max_y = :max_y,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_geometry', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateLabelFeature(PDO $pdo, array $payload, array $user): array {
    $text = avesmapsReadLabelText($payload['text'] ?? '');
    $subtype = avesmapsReadLabelSubtype($payload['feature_subtype'] ?? 'region');
    $size = avesmapsReadLabelSize($payload['size'] ?? 18);
    $rotation = avesmapsReadLabelRotation($payload['rotation'] ?? 0);
    $minZoom = avesmapsReadLabelZoom($payload['min_zoom'] ?? 0);
    $maxZoom = avesmapsReadLabelZoom($payload['max_zoom'] ?? 5);
    if ($maxZoom < $minZoom) {
        throw new InvalidArgumentException('Die Label-Zoomspanne ist ungueltig.');
    }
    $priority = avesmapsReadLabelPriority($payload['priority'] ?? 3);
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $text,
        'text' => $text,
        'feature_type' => 'label',
        'feature_subtype' => $subtype,
        'size' => $size,
        'rotation' => $rotation,
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'priority' => $priority,
        'is_nodix' => avesmapsReadBoolean($payload['is_nodix'] ?? false),
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'feature_subtype' => $subtype,
            'name' => $text,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);
        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_label', (int) $user['id'], '{}', avesmapsEncodeAuditJson(avesmapsBuildAuditAfterSnapshot([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'name' => $text,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ], $payload)));
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, $text, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateLabelFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $text = avesmapsReadLabelText($payload['text'] ?? '');
    $subtype = avesmapsReadLabelSubtype($payload['feature_subtype'] ?? 'region');
    $size = avesmapsReadLabelSize($payload['size'] ?? 18);
    $rotation = avesmapsReadLabelRotation($payload['rotation'] ?? 0);
    $minZoom = avesmapsReadLabelZoom($payload['min_zoom'] ?? 0);
    $maxZoom = avesmapsReadLabelZoom($payload['max_zoom'] ?? 5);
    if ($maxZoom < $minZoom) {
        throw new InvalidArgumentException('Die Label-Zoomspanne ist ungueltig.');
    }
    $priority = avesmapsReadLabelPriority($payload['priority'] ?? 3);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        if ((string) $feature['feature_type'] !== 'label') {
            throw new InvalidArgumentException('Dieses Kartenobjekt ist kein Label.');
        }
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $text;
        $properties['text'] = $text;
        $properties['feature_type'] = 'label';
        $properties['feature_subtype'] = $subtype;
        $properties['size'] = $size;
        $properties['rotation'] = $rotation;
        $properties['min_zoom'] = $minZoom;
        $properties['max_zoom'] = $maxZoom;
        $properties['priority'] = $priority;
        $properties['is_nodix'] = avesmapsReadBoolean($payload['is_nodix'] ?? false);
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [0, 0];
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $text,
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_label', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'name' => $text,
            'feature_subtype' => $subtype,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, $text, $subtype, (float) $coordinates[1], (float) $coordinates[0], $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsMoveLabelFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        if ((string) $feature['feature_type'] !== 'label') {
            throw new InvalidArgumentException('Dieses Kartenobjekt ist kein Label.');
        }
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_x,
                min_y = :min_y,
                max_x = :max_x,
                max_y = :max_y,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'move_label', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, (string) $feature['name'], (string) $feature['feature_subtype'], $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateRegionFeature(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsReadFeatureName($payload['name'] ?? 'Neue Region', 'Der Regionsname');
    $color = avesmapsReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsReadOpacity($payload['opacity'] ?? 0.33);
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');
    $coordinates = avesmapsReadPolygonCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates[0]);
    $publicId = avesmapsUuidV4();
    $geometry = ['type' => 'Polygon', 'coordinates' => $coordinates];
    $properties = [
        'type' => 'region',
        'name' => $name,
        'fill' => $color,
        'stroke' => $color,
        'fillOpacity' => $opacity,
        'feature_type' => 'region',
        'feature_subtype' => 'region',
    ];
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'region',
            'feature_subtype' => 'region',
            'name' => $name,
            'geometry_type' => 'Polygon',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);
        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_region', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'region',
            'feature_subtype' => 'region',
            'name' => $name,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateRegionFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Regionsname');
    $color = avesmapsReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsReadOpacity($payload['opacity'] ?? 0.33);
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['type'] = 'region';
        $properties['name'] = $name;
        $properties['fill'] = $color;
        $properties['stroke'] = $color;
        $properties['fillOpacity'] = $opacity;
        if ($wikiUrl === '') {
            unset($properties['wiki_url']);
        } else {
            $properties['wiki_url'] = $wikiUrl;
        }
        $style = avesmapsDecodeJsonColumnForEdit($feature['style_json'] ?? null);
        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :properties_json, style_json = :style_json, revision = :revision, updated_by = :updated_by WHERE id = :id');
        $statement->execute(['id' => (int) $feature['id'], 'name' => $name, 'properties_json' => avesmapsEncodeJson($properties), 'style_json' => avesmapsEncodeJson($style), 'revision' => $revision, 'updated_by' => (int) $user['id']]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_region', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'name' => $name,
            'properties_json' => $properties,
            'style_json' => $style,
            'revision' => $revision,
        ]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, $name, avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null), $properties + $style, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateRegionFeatureGeometry(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $coordinates = avesmapsReadPolygonCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates[0]);
    $geometry = ['type' => 'Polygon', 'coordinates' => $coordinates];
    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare('UPDATE map_features SET geometry_json = :geometry_json, min_x = :min_x, min_y = :min_y, max_x = :max_x, max_y = :max_y, revision = :revision, updated_by = :updated_by WHERE id = :id');
        $statement->execute(['id' => (int) $feature['id'], 'geometry_json' => avesmapsEncodeJson($geometry), 'min_x' => $bounds['min_x'], 'min_y' => $bounds['min_y'], 'max_x' => $bounds['max_x'], 'max_y' => $bounds['max_y'], 'revision' => $revision, 'updated_by' => (int) $user['id']]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_region_geometry', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, (string) $feature['name'], $geometry, avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null), $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsDeleteMapFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET is_active = 0,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'delete_feature', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'is_active' => 0,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return [
            'public_id' => $publicId,
            'deleted' => true,
            'revision' => $revision,
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsReadPointCoordinatesFromGeometry(array $geometry): array {
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates) || count($coordinates) < 2 || !is_numeric($coordinates[0]) || !is_numeric($coordinates[1])) {
        throw new RuntimeException('Die Point-Geometrie ist ungueltig.');
    }

    return [(float) $coordinates[0], (float) $coordinates[1]];
}

function avesmapsReadLineStringCoordinates(mixed $value): array {
    if (!is_array($value) || count($value) < 2) {
        throw new InvalidArgumentException('Ein Weg braucht mindestens Start- und Endpunkt.');
    }

    $coordinates = [];
    foreach ($value as $index => $coordinatePair) {
        if (!is_array($coordinatePair) || count($coordinatePair) < 2) {
            throw new InvalidArgumentException('Die Wegkoordinaten sind ungueltig.');
        }

        $lat = avesmapsParseMapCoordinate($coordinatePair[0] ?? null, "coordinates[{$index}][0]");
        $lng = avesmapsParseMapCoordinate($coordinatePair[1] ?? null, "coordinates[{$index}][1]");
        $coordinates[] = [$lng, $lat];
    }

    $firstCoordinate = $coordinates[0];
    $lastCoordinate = $coordinates[count($coordinates) - 1];
    if (abs($firstCoordinate[0] - $lastCoordinate[0]) < 0.0001 && abs($firstCoordinate[1] - $lastCoordinate[1]) < 0.0001) {
        throw new InvalidArgumentException('Start und Ziel des Weges duerfen nicht identisch sein.');
    }

    return $coordinates;
}

function avesmapsCalculateLineStringBounds(array $coordinates): array {
    $xValues = array_map(static fn(array $coordinate): float => (float) $coordinate[0], $coordinates);
    $yValues = array_map(static fn(array $coordinate): float => (float) $coordinate[1], $coordinates);

    return [
        'min_x' => min($xValues),
        'min_y' => min($yValues),
        'max_x' => max($xValues),
        'max_y' => max($yValues),
    ];
}

function avesmapsNextMapSortOrder(PDO $pdo): int {
    $statement = $pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM map_features');
    $sortOrder = $statement !== false ? $statement->fetchColumn() : false;

    return $sortOrder === false ? 1 : (int) $sortOrder;
}

function avesmapsNextMapRevision(PDO $pdo): int {
    $pdo->exec(
        'INSERT INTO map_revision (id, revision)
        VALUES (1, 2)
        ON DUPLICATE KEY UPDATE revision = revision + 1'
    );

    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('Die Kartenrevision konnte nicht gelesen werden.');
    }

    return (int) $revision;
}

function avesmapsWriteMapAuditLog(PDO $pdo, int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): int {
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
        VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);

    return (int) $pdo->lastInsertId();
}

function avesmapsBuildPointFeatureResponse(string $publicId, string $name, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    return [
        'public_id' => $publicId,
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'location_type' => $subtype,
        'location_type_label' => avesmapsLocationSubtypeLabel($subtype),
        'description' => (string) ($properties['description'] ?? ''),
        'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
        'is_nodix' => !empty($properties['is_nodix']),
        'is_ruined' => !empty($properties['is_ruined']),
        'lat' => $lat,
        'lng' => $lng,
        'revision' => $revision,
    ];
}

function avesmapsBuildPowerlineFeatureResponse(string $publicId, string $name, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['name'] = $name;
    $properties['feature_type'] = 'powerline';
    $properties['feature_subtype'] = 'powerline';
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties,
    ];
}

function avesmapsBuildLineStringFeatureResponse(string $publicId, string $name, string $subtype, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['feature_type'] = 'path';
    $properties['feature_subtype'] = $subtype;
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties + [
            'name' => $name,
        ],
    ];
}

function avesmapsBuildLabelFeatureResponse(string $publicId, string $text, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['name'] = $text;
    $properties['text'] = $text;
    $properties['feature_type'] = 'label';
    $properties['feature_subtype'] = $subtype;
    $properties['is_nodix'] = !empty($properties['is_nodix']);
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ],
        'properties' => $properties,
    ];
}

function avesmapsBuildRegionFeatureResponse(string $publicId, string $name, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['type'] = 'region';
    $properties['name'] = $name;
    $properties['feature_type'] = 'region';
    $properties['feature_subtype'] = 'region';
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties,
    ];
}

function avesmapsDecodeJsonColumnForEdit(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    $decoded = json_decode((string) $value, true);
    return is_array($decoded) ? $decoded : [];
}

function avesmapsEncodeAuditJson(array $value): string {
    return avesmapsEncodeJson($value);
}

function avesmapsEncodeJson(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}

function avesmapsRollbackAndRethrow(PDO $pdo, Throwable $exception): never {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    throw $exception;
}

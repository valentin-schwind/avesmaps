<?php

declare(strict_types=1);

// Map-feature edit handlers (move/update/create point/crossing/powerline/path/
// label/region, delete, undo audit, lock acquire/release + all their helpers),
// split out of api/edit/map/features.php (M5 god-file split). Required by that
// endpoint before its dispatch; the endpoint keeps the consts, the
// AvesmapsConflictException class and the try/catch dispatch. Bootstrap/auth deps
// and the const/class are resolved at call time.

require_once __DIR__ . '/../wiki/path-naming.php';

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

// Bug #46: a rejected name must not be a dead end. Location names stay unique because the ROUTE
// GRAPH IS KEYED BY NAME on both ends -- api/_internal/routing/client-graph.php builds
// $graph[$name] and js/routing/route-graph-routing.js mirrors it -- so two active locations
// sharing a name collapse into ONE graph node and a route would walk in at one place and out at
// the other. Rather than forbid the second place outright, point the editor at the convention
// Wiki Aventurica itself uses: a parenthetical qualifier. "(Region)" is a visible PLACEHOLDER,
// not a proposed region -- resolving the real one would mean querying the political layer, a
// known performance hotspot. Kept ASCII like every other message in this file; the identical
// wording lives in js/routing/routing.js duplicateLocationNameMessage().
function avesmapsDuplicateLocationNameMessage(string $existingName): string {
    return sprintf(
        'Ein Ort namens "%s" existiert bereits. Ortsnamen bleiben eindeutig - gib dem zweiten Ort'
        . ' einen Zusatz in Klammern, so wie im Wiki (z. B. "%s (Region)").',
        $existingName,
        $existingName
    );
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
            throw new InvalidArgumentException(avesmapsDuplicateLocationNameMessage($existingName));
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
        "grossstadt" => "Gro\u{00DF}stadt",
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleinstadt',
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
    $allowedSubtypes = ['region', 'fluss', 'meer', 'gebirge', 'berggipfel', 'wald', 'steppe', 'huegelland', 'tundra', 'kueste', 'ebene', 'graslandschaft', 'auenlandschaft', 'kontinent', 'wueste', 'suempfe_moore', 'see', 'insel', 'sonstiges'];
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
    if ($rotation === false || $rotation < -360 || $rotation > 360) {
        throw new InvalidArgumentException('Die Label-Rotation ist ungueltig.');
    }

    return (int) $rotation;
}

function avesmapsReadLabelZoom(mixed $value): int {
    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    // Karte erlaubt jetzt Zoom 7 -> Label-Sichtbarkeit darf bis 7 reichen (vorher 5).
    if ($zoom === false || $zoom < 0 || $zoom > 7) {
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

// Bereinigt den optionalen Wiki-Landschafts-Datensatz, der per Picker an ein Label geheftet
// wird (Felder werden ins Label kopiert -> self-contained; wiki_key erlaubt spaeteres Re-Sync).
// Gibt null zurueck, wenn keine gueltige Zuordnung vorliegt (= Zuordnung entfernen).
function avesmapsReadLabelWikiRegion(mixed $value): ?array {
    if (!is_array($value)) {
        return null;
    }
    $wikiKey = avesmapsNormalizeSingleLine((string) ($value['wiki_key'] ?? ''), 255);
    if ($wikiKey === '') {
        return null;
    }

    $line = static fn(mixed $v, int $len): string => avesmapsNormalizeSingleLine((string) ($v ?? ''), $len);
    $text = static fn(mixed $v, int $len): string => mb_substr(trim((string) ($v ?? '')), 0, $len, 'UTF-8');
    $url = static function (mixed $v): string {
        $raw = trim((string) ($v ?? ''));
        if ($raw === '') {
            return '';
        }
        try {
            return avesmapsNormalizeOptionalUrl($raw, 500, 'Der Wiki-Link');
        } catch (Throwable) {
            return '';
        }
    };

    $neighbors = [];
    $rawNeighbors = $value['neighbors'] ?? $value['neighbors_json'] ?? null;
    if (is_array($rawNeighbors)) {
        foreach ($rawNeighbors as $direction => $names) {
            $dir = $line($direction, 4);
            $list = [];
            foreach ((is_array($names) ? $names : [$names]) as $n) {
                $n = $text($n, 120);
                if ($n !== '') {
                    $list[] = $n;
                }
            }
            if ($dir !== '' && $list !== []) {
                $neighbors[$dir] = array_slice($list, 0, 12);
            }
        }
    }

    $synonyms = [];
    if (is_array($value['synonyms'] ?? $value['synonyms_json'] ?? null)) {
        foreach (($value['synonyms'] ?? $value['synonyms_json']) as $s) {
            $s = $text($s, 160);
            if ($s !== '') {
                $synonyms[] = $s;
            }
        }
        $synonyms = array_slice(array_values(array_unique($synonyms)), 0, 40);
    }

    return [
        'wiki_key' => $wikiKey,
        'name' => $line($value['name'] ?? '', 255),
        'art' => $line($value['art'] ?? '', 120),
        'continent' => $line($value['continent'] ?? '', 120),
        'region_parent' => $line($value['region_parent'] ?? '', 255),
        'affiliation_staat' => $line($value['affiliation_staat'] ?? '', 255),
        'einwohner' => $line($value['einwohner'] ?? '', 255),
        'sprache' => $line($value['sprache'] ?? '', 255),
        'vegetation' => $text($value['vegetation'] ?? '', 500),
        'verkehrswege' => $text($value['verkehrswege'] ?? '', 500),
        'description' => $text($value['description'] ?? '', 2000),
        'image_url' => $url($value['image_url'] ?? ''),
        'image_license' => $line($value['image_license'] ?? '', 120),
        'image_author' => $line($value['image_author'] ?? '', 255),
        'image_attribution' => $text($value['image_attribution'] ?? '', 500),
        'image_license_status' => $line($value['image_license_status'] ?? '', 40),
        'image_license_url' => $url($value['image_license_url'] ?? ''),
        'wiki_url' => $url($value['wiki_url'] ?? ''),
        'neighbors' => $neighbors,
        'synonyms' => $synonyms,
        'synced_at' => $line($value['synced_at'] ?? '', 40),
    ];
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

// Optional non-wiki source: a { url, label } object stored in properties.other_source. Returns
// null when no usable URL was supplied (empty url -> the field is treated as unset). The url must
// be an absolute http(s) link (same rule as the wiki link); label is a free-form single line.
function avesmapsReadOptionalOtherSource(mixed $value): ?array {
    if (!is_array($value)) {
        return null;
    }
    $url = avesmapsNormalizeOptionalUrl((string) ($value['url'] ?? ''), 500, 'Der Quellen-Link');
    if ($url === '') {
        return null;
    }
    return [
        'url' => $url,
        'label' => avesmapsNormalizeSingleLine((string) ($value['label'] ?? ''), 255),
    ];
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
        $otherSource = avesmapsReadOptionalOtherSource($payload['other_source'] ?? null);
        if ($otherSource === null) {
            unset($properties['other_source']);
        } else {
            $properties['other_source'] = $otherSource;
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

// Direction-independent edge key -- mirrors avesmapsPowerlineEdgeKey in
// js/map-features/powerline-topology.js so the client's reorder preview and this server-side recompute
// classify segments into the same undirected edges (a segment A->B and the ordered pair B->A collapse).
function avesmapsPowerlineUndirectedEdgeKey(string $a, string $b): string {
    return $a < $b ? $a . ' ' . $b : $b . ' ' . $a;
}

// One powerline segment INSERT (+ bounds, sort order, create audit) with NO transaction and NO revision
// bump -- the caller owns those. avesmapsCreatePowerlineFeature and avesmapsReorderPowerlineLine share
// this single insert path so a segment is built identically whichever route creates it. Returns the new
// feature id.
function avesmapsInsertPowerlineFeatureRow(
    PDO $pdo,
    string $publicId,
    string $name,
    array $geometry,
    array $properties,
    int $revision,
    int $userId
): int {
    $coordinates = $geometry['coordinates'] ?? [];
    $xValues = array_map(static fn(array $coordinate): float => (float) $coordinate[0], $coordinates);
    $yValues = array_map(static fn(array $coordinate): float => (float) $coordinate[1], $coordinates);
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
        'min_x' => $xValues === [] ? 0 : min($xValues),
        'min_y' => $yValues === [] ? 0 : min($yValues),
        'max_x' => $xValues === [] ? 0 : max($xValues),
        'max_y' => $yValues === [] ? 0 : max($yValues),
        'sort_order' => $sortOrder,
        'revision' => $revision,
        'created_by' => $userId,
        'updated_by' => $userId,
    ]);

    $featureId = (int) $pdo->lastInsertId();
    avesmapsWriteMapAuditLog($pdo, $featureId, 'create_powerline', $userId, '{}', avesmapsEncodeAuditJson([
        'public_id' => $publicId,
        'feature_type' => 'powerline',
        'feature_subtype' => 'powerline',
        'name' => $name,
        'geometry_json' => $geometry,
        'properties_json' => $properties,
        'revision' => $revision,
    ]));

    return $featureId;
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
        // A caller (the Kraftlinien editor's "add node") may pass an explicit name so the new segment
        // joins an existing line; otherwise fall back to the auto "A - B" name. When it joins a line,
        // inherit that line's scalar fields so the new segment is consistent at once -- the infobox
        // reads them per-segment. Sources live on the line's anchor segment and are untouched here.
        $providedName = trim((string) ($payload['name'] ?? ''));
        $name = $providedName !== ''
            ? avesmapsReadFeatureName($providedName, 'Der Name der Kraftlinie')
            : trim((string) ($fromFeature['name'] ?? 'Nodix') . ' - ' . (string) ($toFeature['name'] ?? 'Nodix'));
        $inheritedShowLabel = false;
        $inheritedDescription = '';
        $inheritedWikiUrl = '';
        if ($providedName !== '') {
            $peek = $pdo->prepare(
                "SELECT properties_json FROM map_features
                 WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name LIMIT 1"
            );
            $peek->execute(['name' => $name]);
            $peekRow = $peek->fetch(PDO::FETCH_ASSOC);
            if (is_array($peekRow)) {
                $peekProps = avesmapsDecodeJsonColumnForEdit($peekRow['properties_json'] ?? null);
                $inheritedShowLabel = (bool) ($peekProps['show_label'] ?? false);
                $inheritedDescription = (string) ($peekProps['description'] ?? '');
                $inheritedWikiUrl = (string) ($peekProps['wiki_url'] ?? '');
            }
        }
        $geometry = [
            'type' => 'LineString',
            'coordinates' => [[$fromLng, $fromLat], [$toLng, $toLat]],
        ];
        $properties = [
            'name' => $name,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'show_label' => $inheritedShowLabel,
            'description' => $inheritedDescription,
            'wiki_url' => $inheritedWikiUrl,
            'from_public_id' => $fromPublicId,
            'to_public_id' => $toPublicId,
        ];
        $revision = avesmapsNextMapRevision($pdo);
        avesmapsInsertPowerlineFeatureRow($pdo, $publicId, $name, $geometry, $properties, $revision, (int) $user['id']);
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
    $description = trim((string) ($payload['description'] ?? ''));
    // Explicit or empty -- never guessed. avesmapsEnrichMapFeatureWikiUrl skips powerlines for
    // exactly this reason (see api/app/map-features.php).
    $wikiUrl = trim((string) ($payload['wiki_url'] ?? ''));

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $name;
        $properties['feature_type'] = 'powerline';
        $properties['feature_subtype'] = 'powerline';
        $properties['show_label'] = $showLabel;
        $properties['description'] = $description;
        $properties['wiki_url'] = $wikiUrl;
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
            'description' => $description,
            'wiki_url' => $wikiUrl,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// Line-level write: a Kraftlinie is many segments sharing one name, so the editor writes the line's
// scalar fields (name, show_label, description, wiki_url) onto ALL of them at once. Renaming to an
// existing name makes both groups share a name -- they merge, and every segment of the resulting line
// gets the same fields (the OR in the SELECT covers the merge target too). Sources are NOT touched
// here: they live on the line's anchor segment (see the editor + powerlineInfoboxMarkup).
function avesmapsUpdatePowerlineLine(PDO $pdo, array $payload, array $user): array {
    $currentName = trim((string) ($payload['current_name'] ?? ''));
    if ($currentName === '') {
        throw new InvalidArgumentException('Der aktuelle Name der Kraftlinie fehlt.');
    }
    $newName = avesmapsReadFeatureName($payload['new_name'] ?? '', 'Der Name der Kraftlinie');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    $description = trim((string) ($payload['description'] ?? ''));
    $wikiUrl = trim((string) ($payload['wiki_url'] ?? ''));

    $pdo->beginTransaction();
    try {
        // Every active segment of the current name OR the target name (so a merge unifies both).
        $select = $pdo->prepare(
            "SELECT id, public_id, properties_json, revision
             FROM map_features
             WHERE feature_type = 'powerline' AND is_active = 1 AND (name = :current OR name = :new)
             FOR UPDATE"
        );
        $select->execute(['current' => $currentName, 'new' => $newName]);
        $rows = $select->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            throw new InvalidArgumentException('Zu diesem Namen gibt es keine Kraftlinien-Segmente mehr. Bitte neu laden.');
        }

        $revision = avesmapsNextMapRevision($pdo);
        $update = $pdo->prepare(
            'UPDATE map_features
             SET name = :name, properties_json = :properties_json, revision = :revision, updated_by = :updated_by
             WHERE id = :id'
        );
        foreach ($rows as $row) {
            $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
            $properties['name'] = $newName;
            $properties['feature_type'] = 'powerline';
            $properties['feature_subtype'] = 'powerline';
            $properties['show_label'] = $showLabel;
            $properties['description'] = $description;
            $properties['wiki_url'] = $wikiUrl;
            $update->execute([
                'id' => (int) $row['id'],
                'name' => $newName,
                'properties_json' => avesmapsEncodeJson($properties),
                'revision' => $revision,
                'updated_by' => (int) $user['id'],
            ]);
            avesmapsWriteMapAuditLog(
                $pdo,
                (int) $row['id'],
                'update_powerline_line',
                (int) $user['id'],
                avesmapsEncodeAuditJson($row),
                avesmapsEncodeAuditJson([
                    'public_id' => (string) $row['public_id'],
                    'name' => $newName,
                    'show_label' => $showLabel,
                    'description' => $description,
                    'wiki_url' => $wikiUrl,
                    'properties_json' => $properties,
                    'revision' => $revision,
                ])
            );
        }
        $pdo->commit();

        return [
            'name' => $newName,
            'previous_name' => $currentName,
            'segment_count' => count($rows),
            'merged' => $newName !== $currentName,
            'revision' => $revision,
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// Reorder a STRAND: given the new node order, recompute the edge set, diff it against the line's current
// segments and apply the difference ATOMICALLY -- new consecutive edges become straight powerline
// segments (inheriting the line's scalar fields), edges no longer on the path are soft-deleted. One
// transaction, so a partial rewire can never leave the line mangled. Guards: the node SET must stay the
// same (adding/removing nodes is a separate action), and the line must ALREADY be a simple path --
// linearising a branched line or a ring would silently drop structure, so we refuse it. Sources ride the
// anchor (smallest public_id of the name group); after the rewire they move onto the new anchor if it
// changed (a deleted anchor, or a freshly created segment whose uuid sorts smaller). See design §8/§10.
function avesmapsReorderPowerlineLine(PDO $pdo, array $payload, array $user): array {
    $currentName = trim((string) ($payload['current_name'] ?? ''));
    if ($currentName === '') {
        throw new InvalidArgumentException('Der Name der Kraftlinie fehlt.');
    }
    $orderedRaw = $payload['ordered_public_ids'] ?? null;
    if (!is_array($orderedRaw) || count($orderedRaw) < 2) {
        throw new InvalidArgumentException('Zum Umsortieren werden mindestens zwei Nodices in Reihenfolge gebraucht.');
    }
    $ordered = [];
    foreach ($orderedRaw as $value) {
        $ordered[] = avesmapsReadMapFeaturePublicId($value);
    }
    if (count(array_unique($ordered)) !== count($ordered)) {
        throw new InvalidArgumentException('Ein Nodix darf in der Reihenfolge nur einmal vorkommen.');
    }

    $pdo->beginTransaction();
    try {
        $select = $pdo->prepare(
            "SELECT id, public_id, properties_json
             FROM map_features
             WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name
             FOR UPDATE"
        );
        $select->execute(['name' => $currentName]);
        $rows = $select->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            throw new InvalidArgumentException('Zu diesem Namen gibt es keine Kraftlinien-Segmente mehr. Bitte neu laden.');
        }

        // Current edges + node degrees from the segment endpoints, plus the line's scalar fields to
        // inherit onto any newly created segment (all segments of a line carry the same ones).
        $degree = [];
        $currentEdges = [];
        $inheritShowLabel = false;
        $inheritDescription = '';
        $inheritWikiUrl = '';
        $haveInherit = false;
        foreach ($rows as $row) {
            $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
            $from = (string) ($properties['from_public_id'] ?? '');
            $to = (string) ($properties['to_public_id'] ?? '');
            if ($from === '' || $to === '') {
                throw new InvalidArgumentException('Ein Segment ohne Endpunkte laesst sich nicht umsortieren. Bitte neu laden.');
            }
            $degree[$from] = ($degree[$from] ?? 0) + 1;
            $degree[$to] = ($degree[$to] ?? 0) + 1;
            $currentEdges[] = [
                'id' => (int) $row['id'],
                'public_id' => (string) $row['public_id'],
                'from' => $from,
                'to' => $to,
                'key' => avesmapsPowerlineUndirectedEdgeKey($from, $to),
            ];
            if (!$haveInherit) {
                $inheritShowLabel = (bool) ($properties['show_label'] ?? false);
                $inheritDescription = (string) ($properties['description'] ?? '');
                $inheritWikiUrl = (string) ($properties['wiki_url'] ?? '');
                $haveInherit = true;
            }
        }
        $currentNodes = array_keys($degree);

        // The node set may not change here (add/remove is a separate action).
        if (
            count($ordered) !== count($currentNodes)
            || array_diff($ordered, $currentNodes) !== []
            || array_diff($currentNodes, $ordered) !== []
        ) {
            throw new InvalidArgumentException('Beim Umsortieren muss die Nodix-Menge gleich bleiben (zum Hinzufuegen/Entfernen die eigenen Aktionen nutzen).');
        }
        // Refuse anything that is not already a simple path (strand): exactly two degree-1 ends, every
        // other node degree 2, and n-1 edges. That uniquely characterises a single path -- a ring has no
        // ends, a branch more than two, and either would be silently linearised otherwise.
        $ends = 0;
        foreach ($degree as $nodeDegree) {
            if ($nodeDegree === 1) {
                $ends++;
                continue;
            }
            if ($nodeDegree !== 2) {
                throw new InvalidArgumentException('Umsortieren gibt es nur fuer Straenge (jeder Nodix mit hoechstens zwei Nachbarn).');
            }
        }
        if ($ends !== 2 || count($currentEdges) !== count($currentNodes) - 1) {
            throw new InvalidArgumentException('Umsortieren gibt es nur fuer Straenge mit genau zwei Enden.');
        }

        // Diff: wanted consecutive edges vs. the current segments (keep one segment per wanted edge).
        $wanted = [];
        for ($i = 0; $i < count($ordered) - 1; $i++) {
            $wanted[avesmapsPowerlineUndirectedEdgeKey($ordered[$i], $ordered[$i + 1])] = [
                'from' => $ordered[$i],
                'to' => $ordered[$i + 1],
            ];
        }
        $satisfied = [];
        $toDelete = [];
        foreach ($currentEdges as $edge) {
            if (isset($wanted[$edge['key']]) && !isset($satisfied[$edge['key']])) {
                $satisfied[$edge['key']] = true;
            } else {
                $toDelete[] = $edge;
            }
        }
        $toCreate = [];
        foreach ($wanted as $key => $edge) {
            if (!isset($satisfied[$key])) {
                $toCreate[] = $edge;
            }
        }

        // Anchor before the rewire (smallest public_id, SORT_STRING so it matches the client's .sort()
        // and MySQL MIN over these uuid strings).
        $publicIds = array_map(static fn(array $row): string => (string) $row['public_id'], $rows);
        sort($publicIds, SORT_STRING);
        $oldAnchor = $publicIds[0];

        $revision = avesmapsNextMapRevision($pdo);

        // Soft-delete the dropped edges.
        $delete = $pdo->prepare(
            'UPDATE map_features SET is_active = 0, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        foreach ($toDelete as $edge) {
            $delete->execute([
                'id' => $edge['id'],
                'revision' => $revision,
                'updated_by' => (int) $user['id'],
            ]);
            avesmapsWriteMapAuditLog(
                $pdo,
                $edge['id'],
                'delete_feature',
                (int) $user['id'],
                avesmapsEncodeAuditJson(['public_id' => $edge['public_id']]),
                avesmapsEncodeAuditJson([
                    'public_id' => $edge['public_id'],
                    'is_active' => 0,
                    'revision' => $revision,
                    'reason' => 'reorder_powerline_line',
                ])
            );
        }

        // Create the new edges as straight segments between the two nodes (each node fetched once).
        $pointCache = [];
        foreach ($toCreate as $edge) {
            foreach (['from', 'to'] as $sideKey) {
                $nodeId = $edge[$sideKey];
                if (!isset($pointCache[$nodeId])) {
                    $pointCache[$nodeId] = avesmapsFetchEditablePointFeature($pdo, $nodeId);
                }
            }
            [$fromLng, $fromLat] = avesmapsReadPointCoordinatesFromGeometry(
                avesmapsDecodeJsonColumnForEdit($pointCache[$edge['from']]['geometry_json'] ?? null)
            );
            [$toLng, $toLat] = avesmapsReadPointCoordinatesFromGeometry(
                avesmapsDecodeJsonColumnForEdit($pointCache[$edge['to']]['geometry_json'] ?? null)
            );
            $publicId = avesmapsUuidV4();
            $geometry = [
                'type' => 'LineString',
                'coordinates' => [[$fromLng, $fromLat], [$toLng, $toLat]],
            ];
            $properties = [
                'name' => $currentName,
                'feature_type' => 'powerline',
                'feature_subtype' => 'powerline',
                'show_label' => $inheritShowLabel,
                'description' => $inheritDescription,
                'wiki_url' => $inheritWikiUrl,
                'from_public_id' => $edge['from'],
                'to_public_id' => $edge['to'],
            ];
            avesmapsInsertPowerlineFeatureRow($pdo, $publicId, $currentName, $geometry, $properties, $revision, (int) $user['id']);
        }

        // Anchor preservation: if the anchor moved (its segment was deleted, or a new segment sorts
        // smaller), move the line's feature_sources onto the new anchor so the infobox keeps showing them.
        $anchorStatement = $pdo->prepare(
            "SELECT MIN(public_id) FROM map_features WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name"
        );
        $anchorStatement->execute(['name' => $currentName]);
        $newAnchor = $anchorStatement->fetchColumn();
        if (is_string($newAnchor) && $newAnchor !== '' && $newAnchor !== $oldAnchor) {
            $move = $pdo->prepare(
                "UPDATE feature_sources SET entity_public_id = :new WHERE entity_type = 'powerline' AND entity_public_id = :old"
            );
            $move->execute(['new' => $newAnchor, 'old' => $oldAnchor]);
        }

        $pdo->commit();

        return [
            'name' => $currentName,
            'created' => count($toCreate),
            'removed' => count($toDelete),
            'anchor' => is_string($newAnchor) && $newAnchor !== '' ? $newAnchor : $oldAnchor,
            'revision' => $revision,
        ];
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
        // R1: an assigned wiki way (properties.wiki_path) always names the way -- the typed or
        // auto-generated form name must not override it. show_label stays form-controlled (R3).
        $name = avesmapsWikiPathEffectiveEditName($name, $properties);
        $properties['name'] = $name;
        $properties['display_name'] = $name;
        $properties['feature_type'] = 'path';
        $properties['feature_subtype'] = $subtype;
        $properties['show_label'] = $showLabel;
        $properties['transport_domain'] = $transportDomain;
        $properties['allowed_transports'] = $allowedTransports;
        $otherSource = avesmapsReadOptionalOtherSource($payload['other_source'] ?? null);
        if ($otherSource === null) {
            unset($properties['other_source']);
        } else {
            $properties['other_source'] = $otherSource;
        }
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

    if (array_key_exists('wiki_region', $payload)) {
        $wikiRegion = avesmapsReadLabelWikiRegion($payload['wiki_region']);
        if ($wikiRegion !== null) {
            $properties['wiki_region'] = $wikiRegion;
        }
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
        if (array_key_exists('wiki_region', $payload)) {
            $wikiRegion = avesmapsReadLabelWikiRegion($payload['wiki_region']);
            if ($wikiRegion !== null) {
                $properties['wiki_region'] = $wikiRegion;
            } else {
                unset($properties['wiki_region']);
            }
        }
        $otherSource = avesmapsReadOptionalOtherSource($payload['other_source'] ?? null);
        if ($otherSource === null) {
            unset($properties['other_source']);
        } else {
            $properties['other_source'] = $otherSource;
        }
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
        $otherSource = avesmapsReadOptionalOtherSource($payload['other_source'] ?? null);
        if ($otherSource === null) {
            unset($properties['other_source']);
        } else {
            $properties['other_source'] = $otherSource;
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

        // Powerline anchor preservation: a line's sources ride its anchor segment (smallest public_id of
        // the name group; see powerlineInfoboxMarkup + the editor's mountFeatureSourceEditor). If the
        // segment just deleted was that anchor, move its feature_sources onto the new anchor (smallest
        // remaining active segment of the same name) so the infobox keeps showing them. A non-anchor
        // segment carries no sources, so the update simply moves nothing; with no segment left, the line
        // is gone and there is nowhere to move them. See design section 10.
        if ((string) ($feature['feature_type'] ?? '') === 'powerline') {
            $newAnchorStatement = $pdo->prepare(
                "SELECT MIN(public_id) FROM map_features
                 WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name AND id <> :id"
            );
            $newAnchorStatement->execute(['name' => (string) ($feature['name'] ?? ''), 'id' => (int) $feature['id']]);
            $newAnchor = $newAnchorStatement->fetchColumn();
            if (is_string($newAnchor) && $newAnchor !== '') {
                $moveSources = $pdo->prepare(
                    "UPDATE feature_sources SET entity_public_id = :new
                     WHERE entity_type = 'powerline' AND entity_public_id = :old"
                );
                $moveSources->execute(['new' => $newAnchor, 'old' => $publicId]);
            }
        }

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
        'other_source' => $properties['other_source'] ?? null,
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

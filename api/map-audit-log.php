<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf den Änderungsverlauf nicht lesen.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET-Anfragen sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapAuditUndoColumns($pdo);
    avesmapsJsonResponse(200, avesmapsListMapAuditLog($pdo, avesmapsUserCan($user, 'edit')));
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Der Änderungsverlauf konnte nicht geladen werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Der Änderungsverlauf konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsListMapAuditLog(PDO $pdo, bool $canUndoChanges): array {
    $statement = $pdo->query(
        'SELECT
            audit.id,
            audit.feature_id,
            audit.action,
            audit.created_at,
            audit.after_json,
            audit.before_json,
            audit.undone_at,
            audit.undo_audit_id,
            features.public_id,
            features.feature_type,
            features.feature_subtype,
            features.name,
            features.geometry_json AS current_geometry_json,
            features.min_x AS current_min_x,
            features.min_y AS current_min_y,
            features.max_x AS current_max_x,
            features.max_y AS current_max_y,
            features.is_active AS current_is_active,
            users.username,
            undone_users.username AS undone_username
        FROM map_audit_log audit
        LEFT JOIN map_features features ON features.id = audit.feature_id
        LEFT JOIN users ON users.id = audit.actor_user_id
        LEFT JOIN users undone_users ON undone_users.id = audit.undone_by
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT 50'
    );
    $rows = $statement !== false ? $statement->fetchAll() : [];

    return [
        'ok' => true,
        'changes' => array_map(
            static fn(array $row): array => avesmapsNormalizeAuditRow($row, $canUndoChanges),
            $rows
        ),
    ];
}

function avesmapsNormalizeAuditRow(array $row, bool $canUndoChanges): array {
    $after = avesmapsDecodeAuditJson($row['after_json'] ?? null);
    $before = avesmapsDecodeAuditJson($row['before_json'] ?? null);
    $isUndone = (string) ($row['undone_at'] ?? '') !== '';
    $action = (string) $row['action'];

    return [
        'id' => (int) $row['id'],
        'action' => $action,
        'created_at' => (string) $row['created_at'],
        'username' => (string) ($row['username'] ?? ''),
        'undone' => $isUndone,
        'undone_at' => (string) ($row['undone_at'] ?? ''),
        'undone_username' => (string) ($row['undone_username'] ?? ''),
        'undo_audit_id' => (int) ($row['undo_audit_id'] ?? 0),
        'can_undo' => $canUndoChanges && !$isUndone && avesmapsCanUndoAuditAction($action),
        'public_id' => (string) ($row['public_id'] ?? ($after['public_id'] ?? $before['public_id'] ?? '')),
        'feature_type' => (string) ($row['feature_type'] ?? ($after['feature_type'] ?? $before['feature_type'] ?? '')),
        'feature_subtype' => (string) ($row['feature_subtype'] ?? ($after['feature_subtype'] ?? $before['feature_subtype'] ?? '')),
        'name' => (string) ($row['name'] ?? ($after['name'] ?? $before['name'] ?? '')),
        'focus' => avesmapsBuildAuditFocusTarget($row, $before, $after),
    ];
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

function avesmapsCanUndoAuditAction(string $action): bool {
    if (str_starts_with($action, 'undo_')) {
        return false;
    }

    return in_array($action, [
        'move_point',
        'update_point',
        'wiki_sync_update_point',
        'create_point',
        'wiki_sync_create_point',
        'create_crossing',
        'create_powerline',
        'update_powerline_details',
        'create_path',
        'update_path_details',
        'update_path_geometry',
        'create_label',
        'update_label',
        'move_label',
        'create_region',
        'update_region',
        'update_region_geometry',
        'delete_feature',
    ], true);
}

function avesmapsBuildAuditFocusTarget(array $row, array $before, array $after): ?array {
    $current = [
        'geometry_json' => $row['current_geometry_json'] ?? null,
        'min_x' => $row['current_min_x'] ?? null,
        'min_y' => $row['current_min_y'] ?? null,
        'max_x' => $row['current_max_x'] ?? null,
        'max_y' => $row['current_max_y'] ?? null,
        'is_active' => $row['current_is_active'] ?? null,
    ];
    $snapshots = avesmapsFocusSnapshotOrder((string) $row['action'], $before, $after, $current);
    foreach ($snapshots as $snapshot) {
        $geometry = avesmapsReadAuditGeometry($snapshot['geometry_json'] ?? null);
        if ($geometry === null) {
            continue;
        }

        return avesmapsBuildGeometryFocusTarget($geometry);
    }

    return null;
}

function avesmapsFocusSnapshotOrder(string $action, array $before, array $after, array $current): array {
    if ($action === 'delete_feature' || str_starts_with($action, 'undo_create_') || avesmapsSnapshotIsInactive($after)) {
        return [$before, $after, $current];
    }

    return [$after, $before, $current];
}

function avesmapsSnapshotIsInactive(array $snapshot): bool {
    return array_key_exists('is_active', $snapshot) && (int) $snapshot['is_active'] !== 1;
}

function avesmapsReadAuditGeometry(mixed $value): ?array {
    if ($value === null || $value === '') {
        return null;
    }
    if (is_array($value)) {
        return isset($value['type']) ? $value : null;
    }

    try {
        $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }

    return is_array($decoded) && isset($decoded['type']) ? $decoded : null;
}

function avesmapsBuildGeometryFocusTarget(array $geometry): ?array {
    $coordinatePairs = [];
    avesmapsCollectAuditCoordinatePairs($geometry['coordinates'] ?? null, $coordinatePairs);
    if ($coordinatePairs === []) {
        return null;
    }

    $xValues = array_map(static fn(array $coordinate): float => $coordinate[0], $coordinatePairs);
    $yValues = array_map(static fn(array $coordinate): float => $coordinate[1], $coordinatePairs);
    $minX = min($xValues);
    $maxX = max($xValues);
    $minY = min($yValues);
    $maxY = max($yValues);
    $lat = ($minY + $maxY) / 2;
    $lng = ($minX + $maxX) / 2;

    if (count($coordinatePairs) === 1 || (abs($minX - $maxX) < 0.0001 && abs($minY - $maxY) < 0.0001)) {
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

function avesmapsCollectAuditCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void {
    if (!is_array($coordinates)) {
        return;
    }
    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];
        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsCollectAuditCoordinatePairs($coordinate, $coordinatePairs);
    }
}

function avesmapsDecodeAuditJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    try {
        $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decoded) ? $decoded : [];
}

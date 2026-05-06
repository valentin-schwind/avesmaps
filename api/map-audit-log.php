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

    avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsJsonResponse(200, avesmapsListMapAuditLog($pdo));
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

function avesmapsListMapAuditLog(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT
            audit.id,
            audit.action,
            audit.created_at,
            audit.after_json,
            audit.before_json,
            features.public_id,
            features.feature_type,
            features.feature_subtype,
            features.name,
            users.username
        FROM map_audit_log audit
        LEFT JOIN map_features features ON features.id = audit.feature_id
        LEFT JOIN users ON users.id = audit.actor_user_id
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT 50'
    );
    $rows = $statement !== false ? $statement->fetchAll() : [];

    return [
        'ok' => true,
        'changes' => array_map('avesmapsNormalizeAuditRow', $rows),
    ];
}

function avesmapsNormalizeAuditRow(array $row): array {
    $after = avesmapsDecodeAuditJson($row['after_json'] ?? null);
    $before = avesmapsDecodeAuditJson($row['before_json'] ?? null);

    return [
        'id' => (int) $row['id'],
        'action' => (string) $row['action'],
        'created_at' => (string) $row['created_at'],
        'username' => (string) ($row['username'] ?? ''),
        'public_id' => (string) ($row['public_id'] ?? ($after['public_id'] ?? $before['public_id'] ?? '')),
        'feature_type' => (string) ($row['feature_type'] ?? ($after['feature_type'] ?? $before['feature_type'] ?? '')),
        'feature_subtype' => (string) ($row['feature_subtype'] ?? ($after['feature_subtype'] ?? $before['feature_subtype'] ?? '')),
        'name' => (string) ($row['name'] ?? ($after['name'] ?? $before['name'] ?? '')),
    ];
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

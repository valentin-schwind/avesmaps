<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

const AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS = 90;

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf den Editor-Status nicht abrufen.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if (!in_array($requestMethod, ['GET', 'POST'], true)) {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET oder POST sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureEditorPresenceTable($pdo);

    if ($requestMethod === 'POST') {
        avesmapsWriteEditorPresenceHeartbeat($pdo, $user);
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'users' => avesmapsListOnlineEditors($pdo),
        'online_seconds' => AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS,
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Der Editor-Status konnte nicht gespeichert werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Der Editor-Status konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsEnsureEditorPresenceTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS editor_presence (
            user_id BIGINT UNSIGNED NOT NULL,
            username VARCHAR(120) NOT NULL,
            role VARCHAR(20) NOT NULL,
            last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            request_origin VARCHAR(255) NULL,
            user_agent VARCHAR(500) NULL,
            PRIMARY KEY (user_id),
            KEY idx_editor_presence_last_seen (last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsWriteEditorPresenceHeartbeat(PDO $pdo, array $user): void {
    $statement = $pdo->prepare(
        'INSERT INTO editor_presence (user_id, username, role, last_seen, request_origin, user_agent)
        VALUES (:user_id, :username, :role, NOW(3), :request_origin, :user_agent)
        ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            role = VALUES(role),
            last_seen = VALUES(last_seen),
            request_origin = VALUES(request_origin),
            user_agent = VALUES(user_agent)'
    );
    $statement->execute([
        'user_id' => (int) $user['id'],
        'username' => (string) ($user['username'] ?? 'Editor'),
        'role' => (string) ($user['role'] ?? ''),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
    ]);
}

function avesmapsListOnlineEditors(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT
            users.id AS user_id,
            users.username,
            users.role,
            editor_presence.last_seen,
            TIMESTAMPDIFF(SECOND, editor_presence.last_seen, NOW(3)) AS seconds_since_seen,
            CASE
                WHEN editor_presence.last_seen >= DATE_SUB(NOW(3), INTERVAL ' . AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS . ' SECOND) THEN 1
                ELSE 0
            END AS is_online
        FROM users
        LEFT JOIN editor_presence ON editor_presence.user_id = users.id
        WHERE users.is_active = 1
          AND users.role IN (\'admin\', \'editor\', \'reviewer\')
        ORDER BY is_online DESC, users.username ASC'
    );
    $statement->execute();

    return array_map(
        static fn(array $row): array => [
            'id' => (int) $row['user_id'],
            'username' => (string) $row['username'],
            'role' => (string) $row['role'],
            'last_seen' => $row['last_seen'] !== null ? (string) $row['last_seen'] : null,
            'seconds_since_seen' => $row['seconds_since_seen'] !== null ? (int) $row['seconds_since_seen'] : null,
            'is_online' => (int) $row['is_online'] === 1,
        ],
        $statement->fetchAll()
    );
}

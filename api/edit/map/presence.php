<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/analytics/visitor-analytics.php';
require __DIR__ . '/../../_internal/map/editor-activity.php';

const AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS = 90;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Editor-Status nicht abrufen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if (!in_array($requestMethod, ['GET', 'POST'], true)) {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET oder POST sind fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // Which editor the caller has open. The client already POSTed a body here ({path: ...}) that
    // the server threw away; it now carries the activity instead. Both values are normalised
    // BEFORE they reach SQL: the area against a fixed whitelist, the label to one trimmed line.
    //
    // A missing or malformed body must never cost the heartbeat: avesmapsReadJsonRequest() throws
    // on an empty body, and an old cached client (or a beacon send) may well post nothing at all.
    // Reporting no activity is a valid state -- failing the presence write over it is not.
    $activityPayload = [];
    if ($requestMethod === 'POST') {
        try {
            $activityPayload = avesmapsReadJsonRequest();
        } catch (InvalidArgumentException) {
            $activityPayload = [];
        }
    }
    $activityArea = avesmapsNormalizeEditorActivityArea($activityPayload['area'] ?? null);
    $activityLabel = $activityArea === null ? null : avesmapsNormalizeEditorActivityLabel($activityPayload['label'] ?? null);

    // The presence table is created lazily on first miss, NOT on every poll. Every connected editor
    // hits this endpoint every 30s; a CREATE TABLE IF NOT EXISTS on each call is a metadata probe on
    // the hot path that multiplies with editor count. Try the normal path first; only when the table
    // is genuinely absent -- or predates the activity columns, which is the normal state in the first
    // seconds after this feature deploys -- do we repair it once and retry. Steady state runs no DDL.
    try {
        if ($requestMethod === 'POST') {
            avesmapsWriteEditorPresenceHeartbeat($pdo, $user, $activityArea, $activityLabel);
        }
        $onlineEditors = avesmapsListOnlineEditors($pdo);
        $territoryClaim = avesmapsReadEditorAreaClaim($pdo, 'territories');
    } catch (PDOException $exception) {
        if (!avesmapsIsMissingTableError($exception) && !avesmapsIsMissingColumnError($exception)) {
            throw $exception;
        }
        avesmapsEnsureEditorPresenceTable($pdo);
        avesmapsEnsureEditorActivityColumns($pdo);
        if ($requestMethod === 'POST') {
            avesmapsWriteEditorPresenceHeartbeat($pdo, $user, $activityArea, $activityLabel);
        }
        $onlineEditors = avesmapsListOnlineEditors($pdo);
        $territoryClaim = avesmapsReadEditorAreaClaim($pdo, 'territories');
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'users' => $onlineEditors,
        'online_seconds' => AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS,
        'claim_seconds' => AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS,
        // Only the ages travel, never activity_since itself: that column is MySQL server time, and
        // a client formatting it as "since 14:20" would be off by the timezone difference.
        'territory_claim' => $territoryClaim === null ? null : [
            'user_id' => (int) $territoryClaim['user_id'],
            'username' => (string) $territoryClaim['username'],
            'seconds_since_activity' => (int) $territoryClaim['seconds_since_activity'],
            'seconds_since_seen' => (int) $territoryClaim['seconds_since_seen'],
            'is_mine' => (int) $territoryClaim['user_id'] === (int) $user['id'],
        ],
        'visitors' => avesmapsReadVisitorPresence($pdo),
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Der Editor-Status konnte nicht gespeichert werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Der Editor-Status konnte nicht verarbeitet werden.');
}

// The Status panel shows visitor presence right above the editor list, so the
// numbers ride along with this poll rather than opening a second one of their own.
//
// Its own try/catch is deliberate: visitor_live is optional (analytics can be
// switched off, and the table appears only once someone has pinged), and a failure
// here must not take the editor list down with it -- a shared catch once blanked
// both halves of the geo reader for exactly that reason. Null keeps the panel line
// hidden, which is honest; "0 visitors" would not be.
function avesmapsReadVisitorPresence(PDO $pdo): ?array {
    if (!avesmapsVisitorAnalyticsEnabled()) {
        return null;
    }

    try {
        return avesmapsVisitorReadLive($pdo);
    } catch (Throwable $exception) {
        return null;
    }
}

// True when the exception means "the table does not exist yet" -- across MySQL (SQLSTATE 42S02 / "doesn't
// exist" / "base table or view not found") and SQLite ("no such table", used by the test harness). Any
// other error is a real failure and must propagate.
function avesmapsIsMissingTableError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S02') {
        return true;
    }
    $message = strtolower($exception->getMessage());
    return str_contains($message, "doesn't exist")
        || str_contains($message, 'base table or view not found')
        || str_contains($message, 'no such table');
}

// True when the exception means "the column does not exist yet" -- MySQL SQLSTATE 42S22 / "unknown
// column". Separate from the missing-table check because the repair is a different one (ALTER TABLE,
// not CREATE TABLE) and because a live table that predates a retrofit is the normal state right
// after a deploy, not an error worth a 500.
function avesmapsIsMissingColumnError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S22') {
        return true;
    }

    return str_contains(strtolower($exception->getMessage()), 'unknown column');
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
            activity_area VARCHAR(40) NULL,
            activity_label VARCHAR(190) NULL,
            activity_since DATETIME(3) NULL,
            PRIMARY KEY (user_id),
            KEY idx_editor_presence_last_seen (last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsWriteEditorPresenceHeartbeat(PDO $pdo, array $user, ?string $area, ?string $label): void {
    // Two clauses below are load-bearing and easy to break by tidying:
    //
    // 1. activity_since is only reset when the AREA CHANGES. If every heartbeat carried it along,
    //    the owner would always be the most recent arrival -- the exact inverse of the rule the
    //    claim is built on ("whoever got there first"). The label may change freely; the timestamp
    //    may not.
    // 2. <=> instead of =, so NULL compares equal to NULL. With = the comparison is NULL (falsy)
    //    for anyone who currently has no editor open, and activity_since would be rewritten on
    //    every single heartbeat.
    // 3. activity_area is assigned AFTER activity_since: MySQL evaluates ON DUPLICATE KEY UPDATE
    //    assignments left to right, and the comparison needs the OLD value.
    $statement = $pdo->prepare(
        'INSERT INTO editor_presence (user_id, username, role, last_seen, request_origin, user_agent, activity_area, activity_label, activity_since)
        VALUES (:user_id, :username, :role, NOW(3), :request_origin, :user_agent, :activity_area, :activity_label, NOW(3))
        ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            role = VALUES(role),
            last_seen = VALUES(last_seen),
            request_origin = VALUES(request_origin),
            user_agent = VALUES(user_agent),
            activity_label = VALUES(activity_label),
            activity_since = IF(activity_area <=> VALUES(activity_area), activity_since, VALUES(activity_since)),
            activity_area = VALUES(activity_area)'
    );
    $statement->execute([
        'user_id' => (int) $user['id'],
        'username' => (string) ($user['username'] ?? 'Editor'),
        'role' => (string) ($user['role'] ?? ''),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
        'activity_area' => $area,
        'activity_label' => $label,
    ]);
}

function avesmapsListOnlineEditors(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT
            users.id AS user_id,
            users.username,
            users.role,
            editor_presence.last_seen,
            editor_presence.activity_area,
            editor_presence.activity_label,
            TIMESTAMPDIFF(SECOND, editor_presence.activity_since, NOW(3)) AS seconds_since_activity,
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
            'activity_area' => $row['activity_area'] !== null ? (string) $row['activity_area'] : null,
            'activity_label' => $row['activity_label'] !== null ? (string) $row['activity_label'] : null,
            'seconds_since_activity' => $row['seconds_since_activity'] !== null ? (int) $row['seconds_since_activity'] : null,
        ],
        $statement->fetchAll()
    );
}

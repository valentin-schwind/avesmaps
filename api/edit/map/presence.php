<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/analytics/visitor-analytics.php';
require_once __DIR__ . '/../../_internal/map/editor-activity.php';

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

    // "Bearbeiten erzwingen" -- admin only. Rides on this endpoint rather than getting its own,
    // because it writes to the same row this one owns and needs the same auth. Capability is
    // checked here, not in the library: the library computes, the endpoint decides who may.
    $wantsForce = ($activityPayload['force_claim'] ?? false) === true;
    $mayForce = avesmapsUserCan($user, 'admin');

    // The presence table is created lazily on first miss, NOT on every poll. Every connected editor
    // hits this endpoint every 30s; a CREATE TABLE IF NOT EXISTS on each call is a metadata probe on
    // the hot path that multiplies with editor count. Try the normal path first; only when the table
    // is genuinely absent -- or predates the activity columns, which is the normal state in the first
    // seconds after this feature deploys -- do we repair it once and retry. Steady state runs no DDL.
    $isHeartbeat = $requestMethod === 'POST';
    $activitySchema = 'ok';
    try {
        $presence = avesmapsCollectEditorPresence($pdo, $user, $isHeartbeat, $activityArea, $activityLabel, true, $wantsForce && $mayForce);
    } catch (PDOException $exception) {
        if (!avesmapsIsMissingTableError($exception) && !avesmapsIsMissingColumnError($exception)) {
            throw $exception;
        }
        try {
            avesmapsEnsureEditorPresenceTable($pdo);
            avesmapsEnsureEditorActivityColumns($pdo);
            $presence = avesmapsCollectEditorPresence($pdo, $user, $isHeartbeat, $activityArea, $activityLabel, true, $wantsForce && $mayForce);
        } catch (PDOException) {
            // Last resort: serve presence WITHOUT the activity columns -- exactly what this endpoint
            // did before the activity feature existed. The panel loses the "working on ..." line and
            // the territory claim; it does NOT lose the online list, which is a feature editors were
            // relying on long before this one. A schema retrofit that cannot run is a reason to offer
            // less, never a reason to fail. (Written after the first version of the retrofit did fail
            // and turned every heartbeat into a 500 -- see avesmapsEnsureEditorActivityColumns.)
            $presence = avesmapsCollectEditorPresence($pdo, $user, $isHeartbeat, null, null, false);
            $activitySchema = 'degraded';
        }
    }
    $onlineEditors = $presence['users'];
    $territoryClaim = $presence['territory_claim'];

    avesmapsJsonResponse(200, [
        'ok' => true,
        'users' => $onlineEditors,
        'online_seconds' => AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS,
        'claim_seconds' => AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS,
        // 'degraded' means the activity columns are missing AND could not be created, so this
        // response carries no activity and no claim. It is reported rather than hidden: a silent
        // fallback is indistinguishable from "nobody is doing anything", and that ambiguity already
        // cost an evening of guessing once. The panel says so out loud.
        'activity_schema' => $activitySchema,
        // Lets the panel offer "Bearbeiten erzwingen" only to those who may actually use it.
        'can_force_claim' => $mayForce,
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

// avesmapsIsMissingTableError / avesmapsIsMissingColumnError moved to
// api/_internal/map/editor-activity.php (required above): the territory write gate needs the same
// two predicates to stay open while the schema is still being retrofitted, and one definition in a
// shared library beats two that can drift apart.

/**
 * One heartbeat + one read, either with the activity columns or entirely without them.
 *
 * $withActivity=false is the degraded mode used when the schema cannot be retrofitted: the SQL then
 * touches only the columns this table has always had, so the online list keeps working on any
 * database old enough to run the previous version of this endpoint.
 *
 * @return array{users: array, territory_claim: ?array}
 */
function avesmapsCollectEditorPresence(PDO $pdo, array $user, bool $isHeartbeat, ?string $area, ?string $label, bool $withActivity, bool $forceClaim = false): array {
    if ($isHeartbeat) {
        avesmapsWriteEditorPresenceHeartbeat($pdo, $user, $area, $label, $withActivity);
    }

    // The override is stamped AFTER the heartbeat, which has just rewritten this row.
    if ($forceClaim && $withActivity) {
        avesmapsForceEditorAreaClaim($pdo, $user, $area ?? "territories");
    }

    return [
        'users' => avesmapsListOnlineEditors($pdo, $withActivity),
        'territory_claim' => $withActivity ? avesmapsReadEditorAreaClaim($pdo, AVESMAPS_TERRITORY_CLAIM_AREAS) : null,
    ];
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
            claim_forced_at DATETIME(3) NULL,
            PRIMARY KEY (user_id),
            KEY idx_editor_presence_last_seen (last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsWriteEditorPresenceHeartbeat(PDO $pdo, array $user, ?string $area, ?string $label, bool $withActivity = true): void {
    if (!$withActivity) {
        // Degraded mode: the pre-activity statement, verbatim. Touches no column that a database
        // older than this feature might not have.
        $legacy = $pdo->prepare(
            'INSERT INTO editor_presence (user_id, username, role, last_seen, request_origin, user_agent)
            VALUES (:user_id, :username, :role, NOW(3), :request_origin, :user_agent)
            ON DUPLICATE KEY UPDATE
                username = VALUES(username),
                role = VALUES(role),
                last_seen = VALUES(last_seen),
                request_origin = VALUES(request_origin),
                user_agent = VALUES(user_agent)'
        );
        $legacy->execute([
            'user_id' => (int) $user['id'],
            'username' => (string) ($user['username'] ?? 'Editor'),
            'role' => (string) ($user['role'] ?? ''),
            'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
            'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
        ]);

        return;
    }

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

function avesmapsListOnlineEditors(PDO $pdo, bool $withActivity = true): array {
    // Degraded mode leaves the three activity expressions out entirely, so the query runs against a
    // table that predates them (see avesmapsCollectEditorPresence).
    $activityColumns = $withActivity
        ? 'editor_presence.activity_area,
            editor_presence.activity_label,
            TIMESTAMPDIFF(SECOND, editor_presence.activity_since, NOW(3)) AS seconds_since_activity,'
        : 'NULL AS activity_area,
            NULL AS activity_label,
            NULL AS seconds_since_activity,';

    $statement = $pdo->prepare(
        'SELECT
            users.id AS user_id,
            users.username,
            users.role,
            editor_presence.last_seen,
            ' . $activityColumns . '
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

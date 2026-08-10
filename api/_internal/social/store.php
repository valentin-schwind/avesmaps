<?php

declare(strict_types=1);

// Storage for the social hub (Entwurf §6): ONE post, N targets -- because the status belongs to the
// CHANNEL, not to the post. A post goes to three networks and each can fail on its own; a shared
// "gesendet" swallows the case where Mastodon refused, and nobody notices until someone asks why
// nothing is there.
//
// Self-healing DDL, like the rest of this codebase (AGENTS.md §5).
// 💣 NEVER inside a transaction: CREATE TABLE commits implicitly in MySQL and tears the surrounding
// transaction apart. avesmapsSocialEnsureTables is called BEFORE any transaction begins, never inside.
//
// 🔴 THE ROTATING TOKEN LIVES HERE, NOT IN config.local.php (owner decision 2026-08-10). An access
// token the server refreshes by itself cannot live in a hand-edited PHP file: rewriting PHP source on
// a schedule means parsing and re-emitting it, and the first failed write leaves a broken config that
// takes the whole site down. So config.local.php keeps what never changes (app id, app secret, the
// endpoints' own app_token, the kill switch) and this table keeps what rotates. Only the owner has
// database access.

require_once __DIR__ . '/channels.php';

function avesmapsSocialEnsureTables(PDO $pdo): void
{
    // 💣 `body`, not `text`: TEXT is a reserved word in MySQL and every single query would need
    // backticks around it -- one forgotten pair is a syntax error at runtime, on a write path.
    //
    // 💣 source_ref is NULLABLE under its UNIQUE key on purpose. MySQL permits many NULLs in a unique
    // index but only ONE ''. With NOT NULL DEFAULT '' the SECOND editor post ever would be rejected as
    // a duplicate -- the duplicate guard (Entwurf §8) would break exactly the posts it is not meant to
    // touch, and it would look like a database fault rather than a schema decision.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS social_post (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            body TEXT NOT NULL,
            hashtags VARCHAR(500) NOT NULL DEFAULT '',
            media_url VARCHAR(500) NOT NULL DEFAULT '',
            media_kind VARCHAR(16) NOT NULL DEFAULT '',
            media_license VARCHAR(32) NOT NULL DEFAULT '',
            media_source VARCHAR(300) NOT NULL DEFAULT '',
            origin VARCHAR(16) NOT NULL DEFAULT 'editor',
            state VARCHAR(16) NOT NULL DEFAULT 'released',
            author_user_id INT UNSIGNED NULL DEFAULT NULL,
            author_name VARCHAR(80) NOT NULL DEFAULT '',
            source_ref VARCHAR(190) NULL DEFAULT NULL,
            scheduled_for DATETIME NULL DEFAULT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uniq_source_ref (source_ref),
            KEY idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // `sent_payload` is filled by the PROBE adapter only: it is what the channel WOULD have sent
    // (Entwurf §10), and it is what keeps the probe useful after Stufe 1 too. A real adapter leaves it
    // NULL -- storing every published caption a second time would be bloat, the caption derives from
    // `body` and the channel's own limits.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS social_post_target (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            post_id INT UNSIGNED NOT NULL,
            channel_key VARCHAR(32) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            remote_id VARCHAR(190) NOT NULL DEFAULT '',
            error VARCHAR(500) NOT NULL DEFAULT '',
            sent_payload MEDIUMTEXT NULL DEFAULT NULL,
            attempted_at DATETIME(3) NULL DEFAULT NULL,
            UNIQUE KEY uniq_post_channel (post_id, channel_key),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // TEXT, not VARCHAR(255): an Instagram long-lived token is already ~200 characters and Meta has
    // lengthened them before. A token truncated by the column is a token that fails at send time with
    // an error that says nothing about the real cause.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS social_token (
            channel_key VARCHAR(32) NOT NULL PRIMARY KEY,
            access_token TEXT NOT NULL,
            expires_at DATETIME NULL DEFAULT NULL,
            refreshed_at DATETIME(3) NULL DEFAULT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

/** The three states a post can be in. Anything else is a typo and must throw, not be stored. */
const AVESMAPS_SOCIAL_POST_STATES = ['proposal', 'released', 'discarded'];

/**
 * Create a post and its targets in ONE transaction. A post whose targets are missing is worse than no
 * post at all: the list would show it as published with no channel to prove it either way.
 *
 * @param array<string, mixed> $post
 * @param list<string>         $channelKeys
 */
function avesmapsSocialCreatePost(PDO $pdo, array $post, array $channelKeys): int
{
    // The state guard runs BEFORE anything touches the database -- a caller's typo must die at the
    // call site, not after the DDL has run and certainly not as a stored value. store-test.php pins
    // this ordering (an invalid state must raise InvalidArgumentException, never PDOException).
    $state = (string) ($post['state'] ?? 'released');
    if (!in_array($state, AVESMAPS_SOCIAL_POST_STATES, true)) {
        throw new InvalidArgumentException('Unknown post state: ' . $state);
    }

    // DDL next, and OUTSIDE the transaction -- see the note at the top of this file.
    avesmapsSocialEnsureTables($pdo);

    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare(
            'INSERT INTO social_post
                (body, hashtags, media_url, media_kind, media_license, media_source,
                 origin, state, author_user_id, author_name, source_ref, scheduled_for)
             VALUES (:body, :hashtags, :media_url, :media_kind, :media_license, :media_source,
                     :origin, :state, :author_user_id, :author_name, :source_ref, :scheduled_for)'
        );
        $authorId = (int) ($post['author_user_id'] ?? 0);
        $insert->execute([
            'body' => (string) ($post['body'] ?? ''),
            'hashtags' => (string) ($post['hashtags'] ?? ''),
            'media_url' => (string) ($post['media_url'] ?? ''),
            'media_kind' => (string) ($post['media_kind'] ?? ''),
            'media_license' => (string) ($post['media_license'] ?? ''),
            'media_source' => (string) ($post['media_source'] ?? ''),
            'origin' => (string) ($post['origin'] ?? 'editor'),
            'state' => $state,
            // The routine has no user; 0 would claim user number zero exists.
            'author_user_id' => $authorId > 0 ? $authorId : null,
            'author_name' => (string) ($post['author_name'] ?? ''),
            // '' would collide on the unique key for the second post ever. NULL is the absence.
            'source_ref' => ($post['source_ref'] ?? '') === '' ? null : (string) $post['source_ref'],
            'scheduled_for' => $post['scheduled_for'] ?? null,
        ]);
        $postId = (int) $pdo->lastInsertId();

        $target = $pdo->prepare(
            'INSERT INTO social_post_target (post_id, channel_key, status) VALUES (:pid, :key, :status)'
        );
        $status = ($post['scheduled_for'] ?? null) === null ? 'pending' : 'scheduled';
        foreach ($channelKeys as $key) {
            // An unknown key never becomes a target: it has no adapter and no limits, so it could
            // never be dispatched and would sit in the list as a permanent "wartet".
            if (avesmapsSocialChannel((string) $key) === null) {
                continue;
            }
            $target->execute(['pid' => $postId, 'key' => (string) $key, 'status' => $status]);
        }

        $pdo->commit();

        return $postId;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

/** @return array<string, mixed>|null The post with a 'targets' list, or null when there is none. */
function avesmapsSocialLoadPost(PDO $pdo, int $id): ?array
{
    avesmapsSocialEnsureTables($pdo);
    $statement = $pdo->prepare('SELECT * FROM social_post WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $id]);
    $post = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($post)) {
        return null;
    }

    $targets = $pdo->prepare('SELECT * FROM social_post_target WHERE post_id = :id ORDER BY id');
    $targets->execute(['id' => $id]);
    $post['targets'] = $targets->fetchAll(PDO::FETCH_ASSOC) ?: [];

    return $post;
}

/**
 * Newest first (Entwurf §2.2). Discarded proposals stay OUT of the list -- they were never public,
 * and re-showing them would make "Verwerfen" look broken.
 *
 * @return list<array<string, mixed>>
 */
function avesmapsSocialListPosts(PDO $pdo, int $limit = 50): array
{
    avesmapsSocialEnsureTables($pdo);
    $limit = max(1, min(200, $limit));

    $posts = $pdo->query(
        "SELECT * FROM social_post
          WHERE state <> 'discarded'
          ORDER BY created_at DESC, id DESC
          LIMIT " . $limit
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($posts === []) {
        return [];
    }

    // ONE query for all targets, not one per post: this list is the subtab's landing view, and an N+1
    // over 50 posts is exactly the hotspot AGENTS.md §10 already names elsewhere.
    $ids = array_map(static fn(array $row): int => (int) $row['id'], $posts);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'SELECT * FROM social_post_target WHERE post_id IN (' . $placeholders . ') ORDER BY id'
    );
    $statement->execute($ids);

    $byPost = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $target) {
        $byPost[(int) $target['post_id']][] = $target;
    }
    foreach ($posts as &$post) {
        $post['targets'] = $byPost[(int) $post['id']] ?? [];
    }
    unset($post);

    return $posts;
}

function avesmapsSocialSetPostState(PDO $pdo, int $id, string $state): void
{
    if (!in_array($state, AVESMAPS_SOCIAL_POST_STATES, true)) {
        throw new InvalidArgumentException('Unknown post state: ' . $state);
    }
    avesmapsSocialEnsureTables($pdo);
    $pdo->prepare('UPDATE social_post SET state = :state WHERE id = :id')
        ->execute(['state' => $state, 'id' => $id]);
}

/**
 * Write the outcome of ONE channel. Never touches the others -- that separation is the entire point
 * of the two-table model (Entwurf §2.2).
 *
 * @param array{status?: string, remote_id?: string, error?: string, sent_payload?: string|null} $fields
 */
function avesmapsSocialUpdateTarget(PDO $pdo, int $postId, string $channelKey, array $fields): void
{
    avesmapsSocialEnsureTables($pdo);
    $pdo->prepare(
        'UPDATE social_post_target
            SET status = :status,
                remote_id = :remote_id,
                error = :error,
                sent_payload = :sent_payload,
                attempted_at = CURRENT_TIMESTAMP(3)
          WHERE post_id = :pid AND channel_key = :key'
    )->execute([
        'status' => (string) ($fields['status'] ?? 'pending'),
        'remote_id' => mb_substr((string) ($fields['remote_id'] ?? ''), 0, 190),
        // Truncated, not rejected: an adapter's error text is not ours to bound, and a failed UPDATE
        // would lose the very diagnosis the editor needs to decide whether to retry.
        'error' => mb_substr((string) ($fields['error'] ?? ''), 0, 500),
        'sent_payload' => $fields['sent_payload'] ?? null,
        'pid' => $postId,
        'key' => $channelKey,
    ]);
}

/**
 * @return list<string> Channel keys that have a stored token. Feeds the availability check.
 *
 * ⚠️ Runs NO DDL. It is read on the subtab's landing view, and a CREATE TABLE IF NOT EXISTS in front
 * of a read path is precisely the information_schema load behind the pool incident of 2026-07-17.
 * A missing table means nobody ever stored a token -- that is an answer, not an error.
 */
function avesmapsSocialTokenKeys(PDO $pdo): array
{
    try {
        $rows = $pdo->query('SELECT channel_key FROM social_token')->fetchAll(PDO::FETCH_COLUMN) ?: [];
    } catch (PDOException) {
        return [];
    }

    return array_map('strval', $rows);
}

/** @return array{access_token: string, expires_at: ?string, refreshed_at: ?string}|null */
function avesmapsSocialTokenGet(PDO $pdo, string $channelKey): ?array
{
    avesmapsSocialEnsureTables($pdo);
    $statement = $pdo->prepare(
        'SELECT access_token, expires_at, refreshed_at FROM social_token WHERE channel_key = :key LIMIT 1'
    );
    $statement->execute(['key' => $channelKey]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }

    return [
        'access_token' => (string) $row['access_token'],
        'expires_at' => $row['expires_at'] === null ? null : (string) $row['expires_at'],
        'refreshed_at' => $row['refreshed_at'] === null ? null : (string) $row['refreshed_at'],
    ];
}

function avesmapsSocialTokenSet(PDO $pdo, string $channelKey, string $token, ?string $expiresAt): void
{
    avesmapsSocialEnsureTables($pdo);
    $pdo->prepare(
        'INSERT INTO social_token (channel_key, access_token, expires_at, refreshed_at)
         VALUES (:key, :token, :expires, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE access_token = VALUES(access_token),
                                 expires_at = VALUES(expires_at),
                                 refreshed_at = CURRENT_TIMESTAMP(3)'
    )->execute(['key' => $channelKey, 'token' => $token, 'expires' => $expiresAt]);
}

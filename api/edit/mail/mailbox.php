<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/mail/imap.php';
require __DIR__ . '/../../_internal/mail/mailer.php';

const AVESMAPS_MAIL_INBOX_LIMIT = 40;

try {
    $user = avesmapsRequireUserWithCapability('edit');
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMailReplyTable($pdo);

    $action = (string) ($_GET['action'] ?? 'inbox');

    if ($action === 'sent') {
        avesmapsJsonResponse(200, ['ok' => true, 'sent' => avesmapsMailListSent($pdo)]);
    }

    if ($action === 'reply') { // handled in Task 4; leave a stub that 405s until then
        avesmapsErrorResponse(405, 'not_implemented', 'Reply is added in a later task.');
    }

    $imapCfg = avesmapsResolveImapConfig($config);
    $imap = avesmapsImapConnect($imapCfg);
    try {
        if ($action === 'ping') {
            avesmapsJsonResponse(200, ['ok' => true, 'count' => imap_num_msg($imap)]);
        }
        if ($action === 'message') {
            $uid = (int) ($_GET['uid'] ?? 0);
            if ($uid <= 0) { avesmapsErrorResponse(400, 'invalid_request', 'uid is required.'); }
            $meta = avesmapsImapMessageMeta($imap, $uid);
            if ($meta === null) { avesmapsErrorResponse(404, 'not_found', 'Message not found.'); }
            $text = avesmapsImapFetchText($imap, $uid);
            avesmapsImapMarkSeen($imap, $uid);
            $reply = avesmapsMailFindReply($pdo, $meta['messageId']);
            avesmapsJsonResponse(200, ['ok' => true, 'message' => [
                'uid' => $uid,
                'fromEmail' => $meta['fromEmail'],
                'subject' => $meta['subject'],
                'text' => $text,
                'answered' => $reply !== null,
                'replyId' => $reply['id'] ?? null,
            ]]);
        }
        // default: inbox list
        $rows = avesmapsImapListRecent($imap, AVESMAPS_MAIL_INBOX_LIMIT);
        $answered = avesmapsMailAnsweredMap($pdo, array_column($rows, 'messageId'));
        foreach ($rows as &$row) {
            $row['answered'] = isset($answered[$row['messageId']]);
            $row['replyId'] = $answered[$row['messageId']] ?? null;
        }
        unset($row);
        avesmapsJsonResponse(200, ['ok' => true, 'messages' => $rows]);
    } finally {
        imap_close($imap);
    }
} catch (RuntimeException $e) {
    // imap_unavailable / imap_not_configured / imap_connect_failed
    avesmapsErrorResponse(502, 'imap_error', 'Mailbox is not reachable: ' . $e->getMessage());
} catch (Throwable $e) {
    avesmapsErrorResponse(500, 'server_error', 'The mailbox request could not be processed.');
}

function avesmapsEnsureMailReplyTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS mail_reply (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            message_id VARCHAR(255) NULL,
            to_email VARCHAR(255) NOT NULL,
            subject VARCHAR(255) NULL,
            body TEXT NOT NULL,
            editor_user VARCHAR(80) NULL,
            delivery_status VARCHAR(40) NULL,
            sent_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            KEY idx_mail_reply_message (message_id),
            KEY idx_mail_reply_sent (sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsMailAnsweredMap(PDO $pdo, array $messageIds): array {
    $ids = array_values(array_unique(array_filter($messageIds, static fn($v) => (string) $v !== '')));
    if ($ids === []) { return []; }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT message_id, MAX(id) AS rid FROM mail_reply WHERE message_id IN ($placeholders) GROUP BY message_id");
    $stmt->execute($ids);
    $map = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) { $map[(string) $r['message_id']] = (int) $r['rid']; }
    return $map;
}

function avesmapsMailFindReply(PDO $pdo, string $messageId): ?array {
    if (trim($messageId) === '') { return null; }
    $stmt = $pdo->prepare('SELECT id, to_email, subject, body, sent_at FROM mail_reply WHERE message_id = :m ORDER BY id DESC LIMIT 1');
    $stmt->execute(['m' => $messageId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
}

function avesmapsMailListSent(PDO $pdo, int $limit = 50): array {
    $stmt = $pdo->query('SELECT id, message_id, to_email, subject, body, editor_user, delivery_status, sent_at FROM mail_reply ORDER BY id DESC LIMIT ' . (int) $limit);
    return $stmt === false ? [] : $stmt->fetchAll(PDO::FETCH_ASSOC);
}

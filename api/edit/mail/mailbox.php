<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/mail/imap.php';
require __DIR__ . '/../../_internal/mail/mailer.php';

const AVESMAPS_MAIL_INBOX_LIMIT = 40;
const AVESMAPS_MAIL_IMAGE_MAX = 12;

try {
    $user = avesmapsRequireUserWithCapability('edit');
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMailReplyTable($pdo);

    $action = (string) ($_GET['action'] ?? 'inbox');

    if ($action === 'sent') {
        avesmapsJsonResponse(200, ['ok' => true, 'sent' => avesmapsMailListSent($pdo)]);
    }

    $imapCfg = avesmapsResolveImapConfig($config);
    $imap = avesmapsImapConnect($imapCfg);
    try {
        if ($action === 'reply') {
            if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
                avesmapsErrorResponse(405, 'method_not_allowed', 'Reply requires POST.');
            }
            $payload = avesmapsReadJsonRequest();
            $uid = (int) ($payload['uid'] ?? 0);
            $bodyText = trim((string) ($payload['message'] ?? ''));
            if ($uid <= 0 || $bodyText === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'uid and a non-empty message are required.');
            }
            $meta = avesmapsImapMessageMeta($imap, $uid);
            $replyRecipient = $meta === null
                ? ''
                : (((string) ($meta['replyToEmail'] ?? '')) !== '' ? (string) $meta['replyToEmail'] : (string) $meta['fromEmail']);
            if ($meta === null || $replyRecipient === '') {
                avesmapsErrorResponse(422, 'no_recipient', 'The referenced message has no usable reply address.');
            }

            $sender = trim((string) ($config['contact']['sender'] ?? $imapCfg['username']));
            $subject = avesmapsMailReplySubject($meta['subject']);
            $threadRef = avesmapsMailFormatMessageId($meta['messageId']);
            $env = [
                'from' => $sender, 'fromName' => 'Avesmaps', 'to' => $replyRecipient,
                'replyTo' => $sender, 'subject' => $subject, 'body' => $bodyText,
                'headers' => array_filter([
                    'In-Reply-To' => $threadRef !== '' ? $threadRef : null,
                    'References' => $threadRef !== '' ? $threadRef : null,
                ]),
            ];
            $deliveryStatus = avesmapsSendMailViaSmtp((array) ($config['contact']['smtp'] ?? []), $env);

            $insert = $pdo->prepare(
                'INSERT INTO mail_reply (message_id, to_email, subject, body, editor_user, delivery_status)
                 VALUES (:m, :to, :subj, :body, :editor, :status)'
            );
            $insert->execute([
                'm' => $meta['messageId'] !== '' ? $meta['messageId'] : null, 'to' => $replyRecipient, 'subj' => $subject,
                'body' => $bodyText, 'editor' => (string) ($user['username'] ?? ''),
                'status' => mb_substr($deliveryStatus, 0, 40),
            ]);
            $replyId = (int) $pdo->lastInsertId();

            // Best-effort: drop a copy into the Sent folder so a real mail client sees it too.
            @imap_append($imap, $imapCfg['ref'] . $imapCfg['sent_mailbox'], avesmapsMailBuildMessage($env), "\\Seen");

            $ok = str_starts_with($deliveryStatus, 'smtp_sent') || $deliveryStatus === 'mail_sent';
            avesmapsJsonResponse($ok ? 200 : 502, [
                'ok' => $ok,
                'replyId' => $replyId,
                'deliveryStatus' => $deliveryStatus,
            ]);
        }
        if ($action === 'image') {
            $uid = (int) ($_GET['uid'] ?? 0);
            $section = (string) ($_GET['part'] ?? '');
            if ($uid <= 0 || preg_match('/^[0-9]+(\.[0-9]+)*$/', $section) !== 1) {
                avesmapsErrorResponse(400, 'invalid_request', 'A valid uid and part are required.');
            }
            $image = avesmapsImapFetchImage($imap, $uid, $section);
            if ($image === null) {
                avesmapsErrorResponse(404, 'not_found', 'Image part not found.');
            }
            // Binary response (not the JSON envelope): mimetype is server-determined and
            // whitelisted to raster types; nosniff prevents the browser re-typing it.
            $safeName = (string) preg_replace('/[^A-Za-z0-9._-]+/', '_', $image['filename']);
            header('Content-Type: ' . $image['mimetype']);
            header('X-Content-Type-Options: nosniff');
            header('Content-Disposition: inline' . ($safeName !== '' ? '; filename="' . $safeName . '"' : ''));
            header('Content-Length: ' . strlen($image['bytes']));
            header('Cache-Control: private, max-age=300');
            echo $image['bytes'];
            exit;
        }
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
                'replyTo' => ((string) ($meta['replyToEmail'] ?? '')) !== '' ? (string) $meta['replyToEmail'] : (string) $meta['fromEmail'],
                'subject' => $meta['subject'],
                'text' => $text,
                'images' => array_map(
                    static fn($img) => ['part' => $img['part'], 'mimetype' => $img['mimetype'], 'filename' => $img['filename']],
                    array_slice(avesmapsImapCollectImages($imap, $uid), 0, AVESMAPS_MAIL_IMAGE_MAX)
                ),
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
    // Surface only the controlled IMAP tokens thrown by the IMAP lib; anything
    // else reaching here (e.g. PDOException, which extends RuntimeException) must
    // not leak its message (DSN host / internal config strings).
    $imapCodes = ['imap_unavailable', 'imap_not_configured', 'imap_connect_failed'];
    if (in_array($e->getMessage(), $imapCodes, true)) {
        avesmapsErrorResponse(502, 'imap_error', 'Mailbox is not reachable: ' . $e->getMessage());
    }
    avesmapsErrorResponse(500, 'server_error', 'The mailbox request could not be processed.');
} catch (Throwable $e) {
    avesmapsErrorResponse(500, 'server_error', 'The mailbox request could not be processed.');
}

function avesmapsMailReplySubject(string $subject): string {
    $subject = trim(str_replace(["\r", "\n"], '', $subject));
    if ($subject === '') { return 'Re: (kein Betreff)'; }
    return preg_match('/^\s*re:/i', $subject) === 1 ? $subject : 'Re: ' . $subject;
}

// Normalize a Message-ID to RFC 5322 angle-bracket form for outgoing
// In-Reply-To / References headers (imap_fetch_overview often yields it bare).
function avesmapsMailFormatMessageId(string $messageId): string {
    $messageId = trim($messageId);
    if ($messageId === '') { return ''; }
    return '<' . trim($messageId, '<>') . '>';
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
    $stmt = $pdo->prepare("SELECT message_id, MAX(id) AS rid FROM mail_reply WHERE message_id IN ($placeholders) AND (delivery_status LIKE 'smtp_sent%' OR delivery_status = 'mail_sent') GROUP BY message_id");
    $stmt->execute($ids);
    $map = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) { $map[(string) $r['message_id']] = (int) $r['rid']; }
    return $map;
}

function avesmapsMailFindReply(PDO $pdo, string $messageId): ?array {
    if (trim($messageId) === '') { return null; }
    $stmt = $pdo->prepare("SELECT id, to_email, subject, body, sent_at FROM mail_reply WHERE message_id = :m AND (delivery_status LIKE 'smtp_sent%' OR delivery_status = 'mail_sent') ORDER BY id DESC LIMIT 1");
    $stmt->execute(['m' => $messageId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
}

function avesmapsMailListSent(PDO $pdo, int $limit = 50): array {
    $stmt = $pdo->query('SELECT id, message_id, to_email, subject, body, editor_user, delivery_status, sent_at FROM mail_reply ORDER BY id DESC LIMIT ' . (int) $limit);
    return $stmt === false ? [] : $stmt->fetchAll(PDO::FETCH_ASSOC);
}

<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';

const AVESMAPS_CONTACT_MESSAGE_MIN = 5;
const AVESMAPS_CONTACT_MESSAGE_MAX = 4000;
const AVESMAPS_CONTACT_SPAM_WORDS = ['casino', 'crypto', 'viagra', 'loan', 'betting', 'porn', 'seo', 'bitcoin', 'forex'];
const AVESMAPS_CONTACT_RATE_LIMIT_PER_HOUR = 5;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not send messages.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only POST requests are allowed for contact messages.');
    }

    $payload = avesmapsReadJsonRequest();
    $contact = avesmapsValidateContactMessage($payload);
    if ($contact['is_spam'] === true) {
        // Silently accept so bots get no signal about what was filtered.
        avesmapsJsonResponse(200, ['ok' => true, 'message' => 'Nachricht wurde gesendet.']);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureContactMessagesTable($pdo);

    $ipHash = avesmapsContactPrivacyIpHash($config);
    if (avesmapsContactRateLimitExceeded($pdo, $ipHash)) {
        avesmapsJsonResponse(200, ['ok' => true, 'message' => 'Nachricht wurde gesendet.']);
    }

    $insertStatement = $pdo->prepare(
        'INSERT INTO contact_message (
            sender_name,
            sender_email,
            message,
            status,
            page_url,
            request_origin,
            ip_hash,
            user_agent
        ) VALUES (
            :sender_name,
            :sender_email,
            :message,
            :status,
            :page_url,
            :request_origin,
            :ip_hash,
            :user_agent
        )'
    );
    $insertStatement->execute([
        'sender_name' => $contact['name'],
        'sender_email' => $contact['email'],
        'message' => $contact['message'],
        'status' => 'neu',
        'page_url' => $contact['page_url'],
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'ip_hash' => $ipHash,
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
    ]);

    // Best-effort push notification; the message is already persisted above.
    avesmapsNotifyContactRecipient($config, $contact);

    avesmapsJsonResponse(201, [
        'ok' => true,
        'message' => 'Danke! Deine Nachricht ist angekommen.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Nachricht konnte nicht gespeichert werden.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Nachricht konnte nicht verarbeitet werden.');
}

function avesmapsValidateContactMessage(array $payload): array {
    $honeypotValue = avesmapsNormalizeSingleLine((string) ($payload['website'] ?? ''), 100);
    if ($honeypotValue !== '') {
        return ['is_spam' => true];
    }

    $elapsedMilliseconds = filter_var($payload['elapsed_ms'] ?? null, FILTER_VALIDATE_INT);
    if ($elapsedMilliseconds !== false && $elapsedMilliseconds > 0 && $elapsedMilliseconds < 1500) {
        return ['is_spam' => true];
    }

    $message = avesmapsNormalizeMultiline((string) ($payload['message'] ?? ''), AVESMAPS_CONTACT_MESSAGE_MAX);
    if (mb_strlen($message) < AVESMAPS_CONTACT_MESSAGE_MIN) {
        throw new InvalidArgumentException('Bitte gib eine Nachricht ein.');
    }

    $email = avesmapsNormalizeSingleLine((string) ($payload['email'] ?? ''), 200);
    if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new InvalidArgumentException('Bitte gib eine gueltige E-Mail-Adresse an oder lass das Feld leer.');
    }

    $name = avesmapsNormalizeSingleLine((string) ($payload['name'] ?? ''), 80);

    if (avesmapsContactContainsSpam($message . ' ' . $name) || avesmapsContactIsLinkOnly($message)) {
        return ['is_spam' => true];
    }

    return [
        'is_spam' => false,
        'name' => $name,
        'email' => $email,
        'message' => $message,
        'page_url' => avesmapsNormalizeSingleLine((string) ($payload['page_url'] ?? ''), 500),
    ];
}

function avesmapsContactContainsSpam(string $value): bool {
    $normalizedValue = mb_strtolower($value);
    foreach (AVESMAPS_CONTACT_SPAM_WORDS as $spamWord) {
        if (preg_match('/\b' . preg_quote($spamWord, '/') . '\b/u', $normalizedValue) === 1) {
            return true;
        }
    }

    return false;
}

function avesmapsContactIsLinkOnly(string $value): bool {
    $normalizedValue = trim($value);
    if ($normalizedValue === '') {
        return false;
    }

    $withoutLinks = trim((string) preg_replace('/https?:\/\/\S+/iu', '', $normalizedValue));
    return $withoutLinks === '';
}

function avesmapsContactPrivacyIpHash(array $config): string {
    $secret = avesmapsGetConfiguredImportApiToken($config);
    if ($secret === '') {
        $secret = (string) ($config['database']['name'] ?? 'avesmaps');
    }

    return hash_hmac('sha256', avesmapsClientIpAddress(), $secret);
}

function avesmapsContactRateLimitExceeded(PDO $pdo, string $ipHash): bool {
    $statement = $pdo->prepare(
        "SELECT COUNT(*)
        FROM contact_message
        WHERE ip_hash = :ip_hash
            AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)"
    );
    $statement->execute(['ip_hash' => $ipHash]);

    return (int) $statement->fetchColumn() >= AVESMAPS_CONTACT_RATE_LIMIT_PER_HOUR;
}

function avesmapsEnsureContactMessagesTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS contact_message (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            sender_name VARCHAR(80) NULL,
            sender_email VARCHAR(200) NULL,
            message TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'neu',
            page_url VARCHAR(500) NULL,
            request_origin VARCHAR(255) NULL,
            ip_hash CHAR(64) NULL,
            user_agent VARCHAR(500) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            reviewed_at DATETIME(3) NULL,
            PRIMARY KEY (id),
            KEY idx_contact_message_status_created (status, created_at),
            KEY idx_contact_message_ip_created (ip_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsNotifyContactRecipient(array $config, array $contact): void {
    $recipient = trim((string) ($config['contact']['recipient'] ?? ''));
    if ($recipient === '' || filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
        // No recipient configured -> the message stays stored only.
        return;
    }

    $sender = trim((string) ($config['contact']['sender'] ?? ''));
    if ($sender === '' || filter_var($sender, FILTER_VALIDATE_EMAIL) === false) {
        $sender = $recipient;
    }

    $senderEmail = (string) ($contact['email'] ?? '');
    $senderName = (string) ($contact['name'] ?? '');

    $bodyLines = [];
    if ($senderName !== '') {
        $bodyLines[] = 'Name: ' . $senderName;
    }
    $bodyLines[] = 'E-Mail: ' . ($senderEmail !== '' ? $senderEmail : '(keine angegeben)');
    $bodyLines[] = 'Seite: ' . (string) ($contact['page_url'] ?? '');
    $bodyLines[] = '';
    $bodyLines[] = (string) ($contact['message'] ?? '');
    $body = wordwrap(implode("\r\n", $bodyLines), 990, "\r\n", true);

    $headerLines = [
        'From: Avesmaps Kontakt <' . $sender . '>',
        'Content-Type: text/plain; charset=UTF-8',
        'MIME-Version: 1.0',
    ];
    if ($senderEmail !== '' && filter_var($senderEmail, FILTER_VALIDATE_EMAIL) !== false) {
        $headerLines[] = 'Reply-To: ' . $senderEmail;
    }

    $subject = '=?UTF-8?B?' . base64_encode('Avesmaps: neue Kontaktnachricht') . '?=';

    try {
        @mail($recipient, $subject, $body, implode("\r\n", $headerLines));
    } catch (Throwable $error) {
        // Delivery is best-effort; the persisted row is the source of truth.
    }
}

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
    // The delivery outcome is written back onto the row for diagnostics.
    $messageId = (int) $pdo->lastInsertId();
    $deliveryStatus = avesmapsNotifyContactRecipient($config, $contact);
    avesmapsUpdateContactDeliveryStatus($pdo, $messageId, $deliveryStatus);

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
            delivery_status VARCHAR(40) NULL,
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
    avesmapsEnsureContactColumn($pdo, 'delivery_status', 'VARCHAR(40) NULL AFTER status');
}

function avesmapsEnsureContactColumn(PDO $pdo, string $columnName, string $columnDefinition): void {
    $quotedColumnName = $pdo->quote($columnName);
    $statement = $pdo->query("SHOW COLUMNS FROM contact_message LIKE {$quotedColumnName}");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec("ALTER TABLE contact_message ADD COLUMN {$columnName} {$columnDefinition}");
}

// Returns a short machine status (e.g. 'smtp_sent', 'smtp_auth_failed',
// 'mail_failed', 'no_recipient') that is stored on the row for diagnostics.
function avesmapsNotifyContactRecipient(array $config, array $contact): string {
    $recipient = trim((string) ($config['contact']['recipient'] ?? ''));
    if ($recipient === '' || filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
        return 'no_recipient';
    }

    $sender = trim((string) ($config['contact']['sender'] ?? ''));
    if ($sender === '' || filter_var($sender, FILTER_VALIDATE_EMAIL) === false) {
        $sender = $recipient;
    }

    $senderEmail = (string) ($contact['email'] ?? '');
    $replyTo = ($senderEmail !== '' && filter_var($senderEmail, FILTER_VALIDATE_EMAIL) !== false) ? $senderEmail : '';

    $bodyLines = [];
    if (((string) ($contact['name'] ?? '')) !== '') {
        $bodyLines[] = 'Name: ' . (string) $contact['name'];
    }
    $bodyLines[] = 'E-Mail: ' . ($senderEmail !== '' ? $senderEmail : '(keine angegeben)');
    $bodyLines[] = 'Seite: ' . (string) ($contact['page_url'] ?? '');
    $bodyLines[] = '';
    $bodyLines[] = (string) ($contact['message'] ?? '');
    $body = implode("\r\n", $bodyLines);

    $subject = 'Avesmaps: neue Kontaktnachricht';
    $fromName = 'Avesmaps Kontakt';

    // Preferred path: authenticated SMTP (STRATO blocks local mail()).
    $smtp = $config['contact']['smtp'] ?? null;
    if (is_array($smtp) && trim((string) ($smtp['password'] ?? '')) !== '') {
        try {
            return avesmapsContactSendViaSmtp($smtp, $sender, $fromName, $recipient, $replyTo, $subject, $body);
        } catch (Throwable $error) {
            return 'smtp_exception';
        }
    }

    // Fallback: local mail() with an explicit envelope sender (-f).
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headerLines = [
        'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $sender . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
    ];
    if ($replyTo !== '') {
        $headerLines[] = 'Reply-To: ' . $replyTo;
    }
    try {
        $sent = @mail($recipient, $encodedSubject, wordwrap($body, 990, "\r\n", true), implode("\r\n", $headerLines), '-f' . $sender);
        return $sent ? 'mail_sent' : 'mail_failed';
    } catch (Throwable $error) {
        return 'mail_exception';
    }
}

// Minimal SMTP-over-TLS client (no library available in this build-free project).
// Port 465 = implicit TLS; port 587 = STARTTLS. Returns a short status string.
function avesmapsContactSendViaSmtp(array $smtp, string $from, string $fromName, string $to, string $replyTo, string $subject, string $body): string {
    $host = trim((string) ($smtp['host'] ?? 'smtp.strato.de'));
    $port = (int) ($smtp['port'] ?? 465);
    $username = trim((string) ($smtp['username'] ?? $from));
    $password = (string) ($smtp['password'] ?? '');
    if ($host === '' || $port <= 0 || $username === '' || $password === '') {
        return 'smtp_misconfigured';
    }

    $timeoutSeconds = 15;
    $useImplicitTls = ($port === 465);
    $transport = $useImplicitTls ? 'ssl://' : 'tcp://';
    $context = stream_context_create([
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true],
    ]);

    $errorNumber = 0;
    $errorString = '';
    $socket = @stream_socket_client(
        $transport . $host . ':' . $port,
        $errorNumber,
        $errorString,
        $timeoutSeconds,
        STREAM_CLIENT_CONNECT,
        $context
    );
    if ($socket === false) {
        return 'smtp_connect_failed';
    }
    stream_set_timeout($socket, $timeoutSeconds);

    $heloName = avesmapsContactSmtpHeloName($from);

    try {
        if (!avesmapsContactSmtpExpect($socket, '220')) {
            return 'smtp_no_greeting';
        }
        if (!avesmapsContactSmtpCommand($socket, 'EHLO ' . $heloName, '250')) {
            return 'smtp_ehlo_failed';
        }
        if (!$useImplicitTls) {
            if (!avesmapsContactSmtpCommand($socket, 'STARTTLS', '220')) {
                return 'smtp_starttls_failed';
            }
            if (!@stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                return 'smtp_tls_failed';
            }
            if (!avesmapsContactSmtpCommand($socket, 'EHLO ' . $heloName, '250')) {
                return 'smtp_ehlo2_failed';
            }
        }
        if (!avesmapsContactSmtpCommand($socket, 'AUTH LOGIN', '334')) {
            return 'smtp_auth_unsupported';
        }
        if (!avesmapsContactSmtpCommand($socket, base64_encode($username), '334')) {
            return 'smtp_auth_user_failed';
        }
        if (!avesmapsContactSmtpCommand($socket, base64_encode($password), '235')) {
            return 'smtp_auth_failed';
        }
        if (!avesmapsContactSmtpCommand($socket, 'MAIL FROM:<' . $from . '>', '250')) {
            return 'smtp_from_rejected';
        }
        if (!avesmapsContactSmtpCommand($socket, 'RCPT TO:<' . $to . '>', '250')) {
            return 'smtp_rcpt_rejected';
        }
        if (!avesmapsContactSmtpCommand($socket, 'DATA', '354')) {
            return 'smtp_data_rejected';
        }
        $message = avesmapsContactSmtpBuildMessage($from, $fromName, $to, $replyTo, $subject, $body);
        if (!avesmapsContactSmtpCommand($socket, $message . "\r\n.", '250')) {
            return 'smtp_body_rejected';
        }
        avesmapsContactSmtpCommand($socket, 'QUIT', '221');
        return 'smtp_sent';
    } finally {
        @fclose($socket);
    }
}

function avesmapsContactSmtpHeloName(string $from): string {
    $domain = (string) substr((string) strrchr($from, '@'), 1);
    return $domain !== '' ? $domain : 'localhost';
}

function avesmapsContactSmtpCommand($socket, string $command, string $expectedCode): bool {
    fwrite($socket, $command . "\r\n");
    return avesmapsContactSmtpExpect($socket, $expectedCode);
}

function avesmapsContactSmtpExpect($socket, string $expectedCode): bool {
    $response = '';
    while (($line = fgets($socket, 600)) !== false) {
        $response .= $line;
        // Continuation lines have '-' as the 4th char; the final line has ' '.
        if (strlen($line) < 4 || $line[3] !== '-') {
            break;
        }
    }
    return strncmp($response, $expectedCode, 3) === 0;
}

function avesmapsContactSmtpBuildMessage(string $from, string $fromName, string $to, string $replyTo, string $subject, string $body): string {
    $headers = [];
    $headers[] = 'Date: ' . gmdate('r');
    $headers[] = 'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $from . '>';
    $headers[] = 'To: <' . $to . '>';
    if ($replyTo !== '') {
        $headers[] = 'Reply-To: <' . $replyTo . '>';
    }
    $headers[] = 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    $headers[] = 'Content-Transfer-Encoding: base64';

    // base64 body keeps UTF-8 safe over SMTP and avoids dot-stuffing edge cases.
    $encodedBody = rtrim(chunk_split(base64_encode($body), 76, "\r\n"), "\r\n");

    return implode("\r\n", $headers) . "\r\n\r\n" . $encodedBody;
}

function avesmapsUpdateContactDeliveryStatus(PDO $pdo, int $messageId, string $deliveryStatus): void {
    if ($messageId <= 0) {
        return;
    }
    try {
        $statement = $pdo->prepare('UPDATE contact_message SET delivery_status = :status WHERE id = :id');
        $statement->execute(['status' => mb_substr($deliveryStatus, 0, 40), 'id' => $messageId]);
    } catch (Throwable $error) {
        // Diagnostic only; ignore failures.
    }
}

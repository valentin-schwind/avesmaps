<?php

declare(strict_types=1);

// Shared authenticated-SMTP mailer, extracted from contact.php so the contact
// form and the editor mail-reply endpoint use one transport. Build-free project:
// a minimal SMTP-over-TLS client (no library). Port 465 = implicit TLS; 587 = STARTTLS.

function avesmapsMailBuildMessage(array $env): string {
    $from = (string) ($env['from'] ?? '');
    $fromName = (string) ($env['fromName'] ?? 'Avesmaps');
    $to = (string) ($env['to'] ?? '');
    $replyTo = (string) ($env['replyTo'] ?? '');
    $subject = trim(str_replace(["\r", "\n"], '', (string) ($env['subject'] ?? '')));
    $body = (string) ($env['body'] ?? '');

    $headers = [];
    $headers[] = 'Date: ' . gmdate('r');
    $headers[] = 'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $from . '>';
    $headers[] = 'To: <' . $to . '>';
    if ($replyTo !== '') {
        $headers[] = 'Reply-To: <' . $replyTo . '>';
    }
    $headers[] = 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=';
    foreach ((array) ($env['headers'] ?? []) as $name => $value) {
        $name = trim(str_replace(["\r", "\n", ':'], '', (string) $name));
        $value = trim(str_replace(["\r", "\n"], '', (string) $value));
        if ($name !== '' && $value !== '') {
            $headers[] = $name . ': ' . $value;
        }
    }
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    $headers[] = 'Content-Transfer-Encoding: base64';

    $encodedBody = rtrim(chunk_split(base64_encode($body), 76, "\r\n"), "\r\n");
    return implode("\r\n", $headers) . "\r\n\r\n" . $encodedBody;
}

// Minimal SMTP-over-TLS client (no library available in this build-free project).
// Port 465 = implicit TLS; port 587 = STARTTLS. Returns a short status string.
function avesmapsSendMailViaSmtp(array $smtp, array $env): string {
    $host = trim((string) ($smtp['host'] ?? 'smtp.strato.de'));
    $port = (int) ($smtp['port'] ?? 465);
    $from = (string) ($env['from'] ?? '');
    $username = trim((string) ($smtp['username'] ?? $from));
    $password = (string) ($smtp['password'] ?? '');
    $to = (string) ($env['to'] ?? '');
    if ($host === '' || $port <= 0 || $username === '' || $password === '' || $to === '') {
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

    $heloName = avesmapsMailSmtpHeloName($from);

    try {
        if (!avesmapsMailSmtpExpect($socket, '220')) {
            return 'smtp_no_greeting';
        }
        if (!avesmapsMailSmtpCommand($socket, 'EHLO ' . $heloName, '250')) {
            return 'smtp_ehlo_failed';
        }
        if (!$useImplicitTls) {
            if (!avesmapsMailSmtpCommand($socket, 'STARTTLS', '220')) {
                return 'smtp_starttls_failed';
            }
            if (!@stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                return 'smtp_tls_failed';
            }
            if (!avesmapsMailSmtpCommand($socket, 'EHLO ' . $heloName, '250')) {
                return 'smtp_ehlo2_failed';
            }
        }
        if (!avesmapsMailSmtpCommand($socket, 'AUTH LOGIN', '334')) {
            return 'smtp_auth_unsupported';
        }
        if (!avesmapsMailSmtpCommand($socket, base64_encode($username), '334')) {
            return 'smtp_auth_user_failed';
        }
        if (!avesmapsMailSmtpCommand($socket, base64_encode($password), '235')) {
            return 'smtp_auth_failed';
        }
        if (!avesmapsMailSmtpCommand($socket, 'MAIL FROM:<' . $from . '>', '250')) {
            return 'smtp_from_rejected';
        }
        if (!avesmapsMailSmtpCommand($socket, 'RCPT TO:<' . $to . '>', '250')) {
            return 'smtp_rcpt_rejected';
        }
        if (!avesmapsMailSmtpCommand($socket, 'DATA', '354')) {
            return 'smtp_data_rejected';
        }
        $message = avesmapsMailBuildMessage($env);
        if (!avesmapsMailSmtpCommand($socket, $message . "\r\n.", '250')) {
            return 'smtp_body_rejected';
        }
        avesmapsMailSmtpCommand($socket, 'QUIT', '221');
        return 'smtp_sent';
    } finally {
        @fclose($socket);
    }
}

function avesmapsMailSmtpHeloName(string $from): string {
    $domain = (string) substr((string) strrchr($from, '@'), 1);
    return $domain !== '' ? $domain : 'localhost';
}

function avesmapsMailSmtpCommand($socket, string $command, string $expectedCode): bool {
    fwrite($socket, $command . "\r\n");
    return avesmapsMailSmtpExpect($socket, $expectedCode);
}

function avesmapsMailSmtpExpect($socket, string $expectedCode): bool {
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

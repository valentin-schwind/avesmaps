<?php

declare(strict_types=1);

const AVESMAPS_DISCORD_API_BASE = 'https://discord.com/api/v10';

function avesmapsDiscordPostMessage(string $botToken, string $channelId, array $message): array {
    if ($botToken === '' || $channelId === '') {
        return ['ok' => false, 'status' => 0, 'error' => 'missing token or channel', 'message_id' => ''];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'error' => 'curl unavailable', 'message_id' => ''];
    }

    $url = AVESMAPS_DISCORD_API_BASE . '/channels/' . rawurlencode($channelId) . '/messages';
    $payload = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return ['ok' => false, 'status' => 0, 'error' => 'payload encode failed', 'message_id' => ''];
    }

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bot ' . $botToken,
            'Content-Type: application/json',
            'User-Agent: AvesmapsBot (https://avesmaps.de, 1.0)',
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    $ok = $status >= 200 && $status < 300;
    $messageId = '';
    if ($ok && is_string($body)) {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $messageId = (string) ($decoded['id'] ?? '');
        }
    }

    return [
        'ok' => $ok,
        'status' => $status,
        'error' => $ok ? '' : ($curlError !== '' ? $curlError : (string) $body),
        'message_id' => $messageId,
    ];
}

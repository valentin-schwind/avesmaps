<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';
require __DIR__ . '/../_internal/discord/post-message.php';

header('Content-Type: application/json');

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method not allowed']);
    exit;
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'configuration unavailable']);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$provided = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? ($_GET['token'] ?? ''));
if (!avesmapsDiscordCheckAppToken((string) ($discord['app_token'] ?? ''), $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

$raw = file_get_contents('php://input');
$body = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($body)) {
    $body = [];
}

$message = [];
if (isset($body['content']) && is_string($body['content']) && $body['content'] !== '') {
    $message['content'] = mb_substr($body['content'], 0, 2000);
}
if (isset($body['embeds']) && is_array($body['embeds'])) {
    $message['embeds'] = array_slice($body['embeds'], 0, 10);
}
if ($message === []) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'empty report']);
    exit;
}

$targets = [
    'report' => (string) ($discord['report_channel_id'] ?? ''),
    'feature' => (string) ($discord['feature_channel_id'] ?? ''),
];
$target = (string) ($body['target'] ?? 'report');
if (!array_key_exists($target, $targets)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'unknown target']);
    exit;
}
$channelId = $targets[$target];
if ($channelId === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'target channel not configured']);
    exit;
}

$post = avesmapsDiscordPostMessage(
    (string) ($discord['bot_token'] ?? ''),
    $channelId,
    $message
);

http_response_code($post['ok'] ? 200 : 502);
echo json_encode(['ok' => $post['ok'], 'status' => $post['status']], JSON_UNESCAPED_UNICODE);

<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/signature.php';
require __DIR__ . '/../_internal/discord/faq.php';
require __DIR__ . '/../_internal/discord/store.php';
require __DIR__ . '/../_internal/discord/responses.php';
require __DIR__ . '/../_internal/discord/router.php';
require __DIR__ . '/../_internal/discord/post-message.php';
require __DIR__ . '/../_internal/discord/endpoint.php';

header('Content-Type: application/json');

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['error' => 'configuration unavailable']);
    exit;
}

$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$rawBody = file_get_contents('php://input');
if ($rawBody === false) {
    $rawBody = '';
}
$signature = (string) ($_SERVER['HTTP_X_SIGNATURE_ED25519'] ?? '');
$timestamp = (string) ($_SERVER['HTTP_X_SIGNATURE_TIMESTAMP'] ?? '');

$faq = avesmapsDiscordLoadFaq(__DIR__ . '/faq.de.json');
$botToken = (string) ($discord['bot_token'] ?? '');

// Lazily connect + heal the table only when a case operation actually needs it.
$pdo = null;
$pdoProvider = static function () use (&$pdo, $config): PDO {
    if ($pdo === null) {
        $pdo = avesmapsCreatePdo(is_array($config['database'] ?? null) ? $config['database'] : []);
        avesmapsDiscordEnsureCasesTable($pdo);
    }

    return $pdo;
};

$deps = [
    'post' => static fn(string $channelId, array $message): array => avesmapsDiscordPostMessage($botToken, $channelId, $message),
    'insert' => static function (array $case) use ($pdoProvider): int {
        $case['created_at'] = date('Y-m-d H:i:s');
        return avesmapsDiscordInsertCase($pdoProvider(), $case);
    },
    'close' => static function (int $id, string $by) use ($pdoProvider): bool {
        return avesmapsDiscordCloseCase($pdoProvider(), $id, $by, date('Y-m-d H:i:s'));
    },
];

$result = avesmapsDiscordProcessRequest($rawBody, $signature, $timestamp, $discord, $faq, $deps);

http_response_code($result['status']);
echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';
require __DIR__ . '/../_internal/discord/store.php';

header('Content-Type: application/json');

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

try {
    $pdo = avesmapsCreatePdo(is_array($config['database'] ?? null) ? $config['database'] : []);
    avesmapsDiscordEnsureCasesTable($pdo);
    $cases = avesmapsDiscordOpenCases($pdo);
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'store unavailable']);
    exit;
}

echo json_encode(['ok' => true, 'count' => count($cases), 'cases' => $cases], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

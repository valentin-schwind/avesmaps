<?php

declare(strict_types=1);

function avesmapsDiscordCommandDefinitions(): array {
    return [
        ['name' => 'hilfe', 'description' => 'Interaktive Hilfe & häufige Fragen zu Avesmaps', 'type' => 1],
        ['name' => 'bug', 'description' => 'Einen Fehler auf avesmaps.de melden', 'type' => 1],
        ['name' => 'idee', 'description' => 'Eine Verbesserung für avesmaps.de vorschlagen', 'type' => 1],
        ['name' => 'frage', 'description' => 'Eine Frage zu Avesmaps stellen', 'type' => 1],
        [
            'name' => 'erledigt',
            'description' => 'Einen Fall als erledigt markieren',
            'type' => 1,
            'options' => [
                ['name' => 'nummer', 'description' => 'Die Fall-Nummer', 'type' => 4, 'required' => true],
            ],
        ],
    ];
}

if (defined('AVESMAPS_DISCORD_REGISTER_TEST')) {
    return;
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../_internal/bootstrap.php';

$discord = [];
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];
} catch (Throwable) {
    // No config on this box -> rely on env vars.
}

$applicationId = (string) (getenv('DISCORD_APPLICATION_ID') ?: ($discord['application_id'] ?? ''));
$botToken = (string) (getenv('DISCORD_BOT_TOKEN') ?: ($discord['bot_token'] ?? ''));
$guildId = (string) (getenv('DISCORD_GUILD_ID') ?: ($discord['guild_id'] ?? ''));

if ($applicationId === '' || $botToken === '') {
    fwrite(STDERR, "Missing DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN (env or config.local.php).\n");
    exit(1);
}
if (!function_exists('curl_init')) {
    fwrite(STDERR, "curl required (run with -d extension=curl).\n");
    exit(1);
}

$base = 'https://discord.com/api/v10/applications/' . rawurlencode($applicationId);
$url = $guildId !== '' ? $base . '/guilds/' . rawurlencode($guildId) . '/commands' : $base . '/commands';
$payload = json_encode(avesmapsDiscordCommandDefinitions(), JSON_UNESCAPED_UNICODE);

$handle = curl_init($url);
curl_setopt_array($handle, [
    CURLOPT_CUSTOMREQUEST => 'PUT',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HTTPHEADER => ['Authorization: Bot ' . $botToken, 'Content-Type: application/json'],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($handle);
$status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
$curlError = curl_error($handle);
curl_close($handle);

$scope = $guildId !== '' ? "guild {$guildId} (instant)" : 'global (up to 1h)';
fwrite(STDOUT, "Registered to {$scope}: HTTP {$status}\n" . ($curlError !== '' ? "curl error: {$curlError}\n" : '') . (string) $body . "\n");
exit($status >= 200 && $status < 300 ? 0 : 1);

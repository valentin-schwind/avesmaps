<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/signature.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';
require __DIR__ . '/../../api/_internal/discord/faq.php';
require __DIR__ . '/../../api/_internal/discord/router.php';
require __DIR__ . '/../../api/_internal/discord/endpoint.php';

$faq = [];
$deps = [
    'post' => static fn(string $c, array $m): array => ['ok' => true, 'message_id' => 'm1'],
    'insert' => static fn(array $case): int => 42,
    'close' => static fn(int $id, string $by): bool => $id === 42,
];

t_eq(avesmapsDiscordProcessRequest('{"type":1}', 'deadbeef', '1', ['public_key' => 'aa'], $faq, $deps)['status'], 401, 'bad signature -> 401');

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded\n");
    t_done();
}

$keypair = sodium_crypto_sign_keypair();
$publicKeyHex = bin2hex(sodium_crypto_sign_publickey($keypair));
$secretKey = sodium_crypto_sign_secretkey($keypair);
$config = ['public_key' => $publicKeyHex, 'bug_channel_id' => '111'];
$sign = static function (string $body) use ($secretKey): array {
    $ts = '1700000000';
    return [$ts, bin2hex(sodium_crypto_sign_detached($ts . $body, $secretKey))];
};

[$ts, $sig] = $sign('{"type":1}');
$ping = avesmapsDiscordProcessRequest('{"type":1}', $sig, $ts, $config, $faq, $deps);
t_eq($ping['status'], 200, 'PING -> 200');
t_eq($ping['body']['type'], AVESMAPS_DISCORD_PONG, 'PING -> PONG');

$captured = [];
$deps2 = [
    'post' => static function (string $c, array $m) use (&$captured): array { $captured['channel'] = $c; $captured['msg'] = $m; return ['ok' => true, 'message_id' => 'm1']; },
    'insert' => static function (array $case) use (&$captured): int { $captured['case'] = $case; return 42; },
    'close' => static fn(int $id, string $by): bool => true,
];
$submitBody = json_encode(['type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID, 'components' => [
    ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Absturz']]],
    ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Hängt']]],
]], 'user' => ['username' => 'u', 'id' => '1']], JSON_UNESCAPED_UNICODE);
[$ts2, $sig2] = $sign($submitBody);
$submit = avesmapsDiscordProcessRequest($submitBody, $sig2, $ts2, $config, $faq, $deps2);
t_eq($submit['status'], 200, 'submit -> 200');
t_eq($captured['case']['kind'], 'bug', 'insert got bug case');
t_eq($captured['channel'], '111', 'posted to bug channel');
t_ok(str_contains($submit['body']['data']['content'], 'Fall #42'), 'confirm names the case');

$closeBody = json_encode(['type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 42]]], 'user' => ['username' => 'chef']], JSON_UNESCAPED_UNICODE);
[$ts3, $sig3] = $sign($closeBody);
$close = avesmapsDiscordProcessRequest($closeBody, $sig3, $ts3, $config, $faq, $deps);
t_ok(str_contains($close['body']['data']['content'], 'erledigt'), 'close -> confirmation');

// Failure paths: insert throws, post throws, malformed JSON.
$submitBody2 = json_encode(['type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID, 'components' => [
    ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Absturz']]],
    ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Hängt']]],
]], 'user' => ['username' => 'u', 'id' => '1']], JSON_UNESCAPED_UNICODE);

$depsInsertThrows = [
    'post' => static fn(string $c, array $m): array => ['ok' => true, 'message_id' => 'm1'],
    'insert' => static function (array $case): int { throw new RuntimeException('db down'); },
    'close' => static fn(int $id, string $by): bool => true,
];
[$tsI, $sigI] = $sign($submitBody2);
$insertThrows = avesmapsDiscordProcessRequest($submitBody2, $sigI, $tsI, $config, $faq, $depsInsertThrows);
t_eq($insertThrows['status'], 200, 'insert throws -> 200');
t_ok(isset($insertThrows['body']['data']['content']), 'insert throws -> content present');
t_ok(!str_contains((string) ($insertThrows['body']['data']['content'] ?? ''), 'Fall #'), 'insert throws -> soft error, not a confirmation');

$depsPostThrows = [
    'post' => static function (string $c, array $m): array { throw new RuntimeException('discord unreachable'); },
    'insert' => static fn(array $case): int => 99,
    'close' => static fn(int $id, string $by): bool => true,
];
[$tsP, $sigP] = $sign($submitBody2);
$postThrows = avesmapsDiscordProcessRequest($submitBody2, $sigP, $tsP, $config, $faq, $depsPostThrows);
t_eq($postThrows['status'], 200, 'post throws -> 200');
t_ok(str_contains($postThrows['body']['data']['content'], 'Fall #99'), 'post throws -> confirmation still returned');

$malformedBody = '{not valid json';
[$tsM, $sigM] = $sign($malformedBody);
$malformed = avesmapsDiscordProcessRequest($malformedBody, $sigM, $tsM, $config, $faq, $deps);
t_eq($malformed['status'], 400, 'malformed json -> 400');

t_done();

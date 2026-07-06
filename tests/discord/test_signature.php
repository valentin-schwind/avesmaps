<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/signature.php';

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded\n");
    exit(0);
}

$keypair = sodium_crypto_sign_keypair();
$publicKeyHex = bin2hex(sodium_crypto_sign_publickey($keypair));
$secretKey = sodium_crypto_sign_secretkey($keypair);
$timestamp = '1700000000';
$body = '{"type":1}';
$signatureHex = bin2hex(sodium_crypto_sign_detached($timestamp . $body, $secretKey));

t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, $timestamp, $body) === true, 'valid verifies');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, $signatureHex, $timestamp, $body . 'x') === false, 'tampered body fails');
t_ok(avesmapsDiscordVerifySignature($publicKeyHex, 'zz', $timestamp, $body) === false, 'bad hex fails');
t_ok(avesmapsDiscordVerifySignature('', $signatureHex, $timestamp, $body) === false, 'empty key fails');

t_done();

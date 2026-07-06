<?php

declare(strict_types=1);

function avesmapsDiscordVerifySignature(string $publicKeyHex, string $signatureHex, string $timestamp, string $rawBody): bool {
    if ($publicKeyHex === '' || $signatureHex === '' || $timestamp === '') {
        return false;
    }
    if (!function_exists('sodium_crypto_sign_verify_detached')) {
        return false;
    }

    $signature = @hex2bin($signatureHex);
    $publicKey = @hex2bin($publicKeyHex);
    if ($signature === false || $publicKey === false) {
        return false;
    }
    if (strlen($publicKey) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
        return false;
    }

    try {
        return sodium_crypto_sign_verify_detached($signature, $timestamp . $rawBody, $publicKey);
    } catch (SodiumException) {
        return false;
    }
}

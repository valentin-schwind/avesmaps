<?php

declare(strict_types=1);

// The rehearsal channel (Entwurf §10). It runs the ENTIRE chain -- licence gate, JPEG conversion,
// crop, storage, reachability probe, per-channel composition, status write -- and then, instead of
// calling a network, records what it WOULD have sent.
//
// That is what makes Stufe 1 finishable: everything is verifiable BEFORE a single access token
// exists. It stays useful afterwards as a dry run for a post nobody should see yet.
//
// 💣 It always succeeds, and that is deliberate. A probe that could fail on its own would be testing
// itself rather than the chain. Everything that may legitimately refuse -- missing picture, caption
// too long, picture not reachable, kill switch off -- has already refused in
// avesmapsSocialCheckTarget and its callers, before any adapter is reached.

/**
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 * @param array<string, mixed> $context Credentials and settings -- every adapter takes the same five
 *   arguments; the rehearsal needs none of them, because it addresses no network.
 * @return array{ok: bool, remote_id: string, payload: string}
 */
function avesmapsSocialAdapterProbe(
    array $post,
    array $channel,
    string $caption,
    string $mediaUrl,
    array $context = []
): array {
    $payload = [
        'channel' => (string) ($channel['label'] ?? 'Probe'),
        // The FINAL caption, hashtags already folded in and truncated to this channel's allowance.
        // Recording the raw input would prove nothing about what a network would receive.
        'caption' => $caption,
        'caption_chars' => mb_strlen($caption),
        // The ABSOLUTE url -- Meta loads the picture from it, so that is the string that matters.
        // Recording the stored path would hide exactly the mistake this rehearsal is meant to catch.
        'media_url' => $mediaUrl,
        'media_license' => (string) ($post['media_license'] ?? ''),
        'clickable_links' => (bool) ($channel['clickable_links'] ?? true),
    ];

    return [
        'ok' => true,
        // Marked as synthetic. A bare number would be indistinguishable from a real post id in the
        // list, and someone would eventually go looking for it on Instagram.
        'remote_id' => 'probe-' . bin2hex(random_bytes(6)),
        'payload' => (string) json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ];
}

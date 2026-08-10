<?php

declare(strict_types=1);

// The read path for the "Social Media" subtab (Entwurf §2.2): the channel register, the shared
// hashtag vocabulary, and the posts with their PER-CHANNEL status.
//
// 🔴 It carries no credential. avesmapsSocialChannelList is built for exactly that, and
// channels-test.php pins the eight keys it may return so a field added there cannot reach the
// browser unnoticed.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/compose.php';
require_once __DIR__ . '/../../_internal/social/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Liste nicht lesen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('social');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $tokenKeys = avesmapsSocialTokenKeys($pdo);

    $posts = [];
    foreach (avesmapsSocialListPosts($pdo, 50) as $row) {
        $targets = [];
        foreach ($row['targets'] as $target) {
            $channel = avesmapsSocialChannel((string) $target['channel_key']);
            $targets[] = [
                'channel' => (string) $target['channel_key'],
                // A channel that has since been removed from the register still has rows here. Falling
                // back to its key keeps the post readable instead of rendering an empty chip.
                'label' => $channel === null ? (string) $target['channel_key'] : (string) $channel['label'],
                'status' => (string) $target['status'],
                'error' => (string) $target['error'],
                'remote_id' => (string) $target['remote_id'],
                // Only the probe fills this. It is what makes the rehearsal inspectable (Entwurf §10).
                'sent_payload' => $target['sent_payload'] === null ? null : (string) $target['sent_payload'],
            ];
        }

        $posts[] = [
            'id' => (int) $row['id'],
            'text' => (string) $row['body'],
            'hashtags' => (string) $row['hashtags'],
            'media_url' => (string) $row['media_url'],
            'media_license' => (string) $row['media_license'],
            'origin' => (string) $row['origin'],
            'state' => (string) $row['state'],
            // The author is INTERNAL (Entwurf §2.3): posts go out as Avesmaps, never under a personal
            // name. Who pressed the button is visible to editors only -- which is exactly here, behind
            // the 'social' capability, and nowhere else.
            'author' => (string) $row['author_name'],
            'created_at' => (string) $row['created_at'],
            'scheduled_for' => $row['scheduled_for'] === null ? null : (string) $row['scheduled_for'],
            'targets' => $targets,
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'channels' => avesmapsSocialChannelList($social, $tokenKeys),
        'vocabulary' => AVESMAPS_SOCIAL_HASHTAG_VOCABULARY,
        // The kill switch travels so the hub can SAY that sending is off, instead of letting an editor
        // write a post and discover it at the end (Entwurf §8).
        'enabled' => ($social['enabled'] ?? true) !== false,
        'posts' => $posts,
    ]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}

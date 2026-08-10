<?php

declare(strict_types=1);

// The routine's way in (Entwurf §9). It does NOT publish -- it files a PROPOSAL that waits in the
// editor's list for "Freigeben und veröffentlichen · Bearbeiten · Verwerfen".
//
// Why approval, when the Discord routine posts unattended: as long as only Discord was fed, the
// audience was the project's own community and a mistake was repairable with a second message. Once
// editors and the automation share a public channel, an unreviewed post is a public mistake under the
// project's name -- and an Instagram post cannot be edited afterwards, only deleted. The approval
// costs one click.
//
// 🔴 ITS OWN KEY: $config['social']['app_token'], never Discord's and never the changelog's. The same
// decision as on 2026-08-08: convenience is no reason to fuse two powers into one. Whoever wants to
// rotate or revoke one of them must be able to do it alone.
//
// ⚠️ Read from the HEADER only, never from ?token= -- an address line stands in the server log, a
// header does not.
//
// ⚠️ A missing key means the door is SHUT, not open. Between this deploy and the entry in
// config.local.php nothing can come in here, which is the correct direction to fail.

require __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/social/channels.php';
require_once __DIR__ . '/../_internal/social/compose.php';
require_once __DIR__ . '/../_internal/social/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $expected = (string) ($social['app_token'] ?? '');
    $sent = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? '');
    // hash_equals rather than ===: a timing-safe comparison costs nothing here, and the alternative
    // leaks the token one character at a time. The two emptiness checks come FIRST, because
    // hash_equals('', '') is true -- an unconfigured server would otherwise let everyone in.
    if ($expected === '' || $sent === '' || !hash_equals($expected, $sent)) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Kein gültiger Schlüssel.');
    }

    $request = avesmapsReadJsonRequest();
    $text = trim((string) ($request['text'] ?? ''));
    if ($text === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Der Vorschlag braucht einen Text.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $tokenKeys = avesmapsSocialTokenKeys($pdo);

    $selected = [];
    foreach (is_array($request['channels'] ?? null) ? $request['channels'] : [] as $key) {
        $key = (string) $key;
        if (avesmapsSocialChannelIsConfigured($key, $social, $tokenKeys) && !in_array($key, $selected, true)) {
            $selected[] = $key;
        }
    }
    if ($selected === []) {
        // Always available, and a proposal without a target could never be released at all -- it would
        // sit in the list as a button that does nothing.
        $selected = ['probe'];
    }

    // The duplicate guard (Entwurf §8): source_ref carries the commit the proposal was built from,
    // exactly as the changelog does. The UNIQUE key turns a repeated run into a 409 instead of a
    // second identical proposal -- and a discarded proposal keeps its ref, so "Verwerfen" is final
    // rather than an invitation to file the same thing again tomorrow.
    $sourceRef = trim((string) ($request['source_ref'] ?? ''));
    try {
        $postId = avesmapsSocialCreatePost($pdo, [
            'body' => $text,
            'hashtags' => implode(' ', avesmapsSocialNormalizeHashtags($request['hashtags'] ?? [])),
            'origin' => 'routine',
            'state' => 'proposal',
            'author_name' => 'Automatisch',
            'source_ref' => $sourceRef,
        ], $selected);
    } catch (PDOException $exception) {
        // 23000 is the SQLSTATE class for an integrity violation -- here, the unique source_ref.
        if ((string) $exception->getCode() === '23000') {
            avesmapsErrorResponse(409, 'duplicate', 'Zu diesem Stand gibt es schon einen Vorschlag.');
        }
        throw $exception;
    }

    avesmapsJsonResponse(200, [
        'ok' => true, 'post_id' => $postId, 'state' => 'proposal', 'channels' => $selected,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}

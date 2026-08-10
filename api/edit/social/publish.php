<?php

declare(strict_types=1);

// The write path: create and send, or release / discard a routine proposal (Entwurf §7, §9).
//
// 💣 A post is created AND dispatched in one request. Splitting it would leave posts that exist but
// were never sent, indistinguishable in the list from ones that failed on every channel.
//
// 🔴 The author is recorded but never published. Posts go out as Avesmaps; who pressed the button
// stays internal (Entwurf §2.3). That is also why the footer of the hub says so out loud -- it is the
// most common question.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/compose.php';
require_once __DIR__ . '/../../_internal/social/media.php';
require_once __DIR__ . '/../../_internal/social/store.php';
require_once __DIR__ . '/../../_internal/social/publish.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf nicht veröffentlichen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    // 💣 The capability check stands BEFORE avesmapsReadJsonRequest. Reading the body first would make
    // an empty body answer 400 for everyone -- and a 400 for an anonymous caller reads like a passed
    // gate when you probe it. (One endpoint in this codebase had exactly that ordering.)
    $user = avesmapsRequireUserWithCapability('social');
    $request = avesmapsReadJsonRequest();
    $action = trim((string) ($request['action'] ?? 'create'));
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // ---- release / discard a proposal -----------------------------------------------------------
    if ($action === 'approve' || $action === 'discard') {
        $id = (int) ($request['id'] ?? 0);
        if ($id <= 0) {
            avesmapsErrorResponse(400, 'invalid_request', 'id fehlt.');
        }
        if (avesmapsSocialLoadPost($pdo, $id) === null) {
            avesmapsErrorResponse(404, 'not_found', 'Der Beitrag wurde nicht gefunden.');
        }

        if ($action === 'discard') {
            // Discarded, not deleted: the proposal is gone from the list but the routine's source_ref
            // stays taken, so the next run does not file the same suggestion again.
            avesmapsSocialSetPostState($pdo, $id, 'discarded');
            avesmapsJsonResponse(200, ['ok' => true, 'id' => $id, 'state' => 'discarded']);
        }

        avesmapsSocialSetPostState($pdo, $id, 'released');
        $dispatch = avesmapsSocialDispatch($pdo, $id, $config);
        avesmapsJsonResponse(200, [
            'ok' => true, 'id' => $id, 'state' => 'released', 'results' => $dispatch['results'],
        ]);
    }

    if ($action !== 'create') {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion.');
    }

    // ---- create and send --------------------------------------------------------------------------
    $text = trim((string) ($request['text'] ?? ''));
    if ($text === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Der Beitrag braucht einen Text.');
    }

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $tokenKeys = avesmapsSocialTokenKeys($pdo);

    // A channel nobody configured must not become a target. Refusing here rather than recording a
    // failed target keeps "noch nicht eingerichtet" a state of the UI, not a post-mortem in the list.
    $selected = [];
    foreach (is_array($request['channels'] ?? null) ? $request['channels'] : [] as $key) {
        $key = (string) $key;
        if (avesmapsSocialChannelIsConfigured($key, $social, $tokenKeys) && !in_array($key, $selected, true)) {
            $selected[] = $key;
        }
    }
    if ($selected === []) {
        avesmapsErrorResponse(400, 'invalid_request',
            'Kein nutzbarer Kanal ausgewählt. Der Probe-Kanal steht immer bereit.');
    }

    $mediaUrl = trim((string) ($request['media_url'] ?? ''));
    // 🔴 Only our own upload directory. A client-supplied URL would let this endpoint publish an
    // arbitrary remote picture under the project's name -- the licence gate in media.php would be
    // bypassed entirely, since nothing would have been uploaded.
    if ($mediaUrl !== ''
        && (!str_starts_with($mediaUrl, AVESMAPS_SOCIAL_UPLOAD_DIR . '/') || str_contains($mediaUrl, '..'))) {
        avesmapsErrorResponse(400, 'invalid_request', 'Das Bild muss über den Upload kommen.');
    }

    $postId = avesmapsSocialCreatePost($pdo, [
        'body' => $text,
        'hashtags' => implode(' ', avesmapsSocialNormalizeHashtags($request['hashtags'] ?? [])),
        'media_url' => $mediaUrl,
        'media_kind' => $mediaUrl === '' ? '' : 'image',
        'media_license' => (string) ($request['media_license'] ?? ''),
        'media_source' => (string) ($request['media_source'] ?? ''),
        'origin' => 'editor',
        'state' => 'released',
        'author_user_id' => (int) ($user['id'] ?? 0),
        'author_name' => (string) ($user['username'] ?? ''),
    ], $selected);

    $dispatch = avesmapsSocialDispatch($pdo, $postId, $config);
    // The response carries the per-channel outcome, not one boolean: the hub reports "Instagram ✓,
    // Mastodon Fehler" straight from it, which is the same truth the list will show on reload.
    avesmapsJsonResponse(200, ['ok' => true, 'post_id' => $postId, 'results' => $dispatch['results']]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}

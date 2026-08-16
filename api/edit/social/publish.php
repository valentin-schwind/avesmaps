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

    if ($action !== 'create' && $action !== 'update') {
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

    // Die Entwurfs-Box (Owner-Entscheid 10.08.2026). Ein Beitrag muss nicht sofort hinaus: er kann
    // liegen bleiben, bearbeitet und später freigegeben werden. Bis dahin ist er ein `proposal` --
    // derselbe Zustand, in dem auch die Routine einliefert, und dieselben drei Knöpfe in der Liste.
    //
    // 🔴 EIN Zustand für beide Herkünfte, nicht zwei. Ein eigener `draft` neben `proposal` waere
    // dieselbe Sache unter zwei Namen: die Liste müsste beide filtern, die Freigabe beide kennen, und
    // beim naechsten Zustand liefen sie auseinander. Woher er kommt, steht in `origin`.
    $isDraft = ($request['draft'] ?? false) === true;

    // Die KI-Erklärung (Entwurf `2026-08-16-ki-kennzeichnung-design.md`). Sie gilt dem BEITRAG, nicht
    // einem Kanal: welches Netz daraus etwas macht, entscheidet der jeweilige Adapter -- Facebook nur
    // an einem Bild, Instagram immer, Mastodon und „Neuigkeiten" gar nicht.
    //
    // ⚠️ Streng auf `=== true` geprüft, wie `draft` daneben: ein fehlendes Feld oder ein "false" aus
    // einem alten Client heißt „nicht erklärt", nie „erklärt".
    $aiDeclared = ($request['ai_declared'] ?? false) === true;

    // ---- einen wartenden Entwurf ÄNDERN ------------------------------------------------------------
    //
    // 🔴 Ändern, nicht ersetzen. Bis 11.08.2026 verwarf der Client den alten Entwurf und legte einen
    // neuen an -- richtig für einen bereits VERÖFFENTLICHTEN Beitrag (dort soll sichtbar bleiben, dass
    // jemand eingegriffen hat), falsch für einen Entwurf: der bekam bei jedem Speichern ein neues
    // Datum und eine neue id, und wer zweimal speicherte, sah zwei Beiträge entstehen.
    if ($action === 'update') {
        $id = (int) ($request['id'] ?? 0);
        if ($id <= 0) {
            avesmapsErrorResponse(400, 'invalid_request', 'id fehlt.');
        }
        $ok = avesmapsSocialUpdateProposal($pdo, $id, [
            'title' => (string) ($request['title'] ?? ''),
            'body' => $text,
            'hashtags' => implode(' ', avesmapsSocialNormalizeHashtags($request['hashtags'] ?? [])),
            'media_url' => $mediaUrl,
            'media_kind' => $mediaUrl === '' ? '' : 'image',
            'media_license' => (string) ($request['media_license'] ?? ''),
            'media_source' => (string) ($request['media_source'] ?? ''),
            'media_alt' => (string) ($request['media_alt'] ?? ''),
            'ai_declared' => $aiDeclared,
        ], $selected);
        if (!$ok) {
            // Kein 404: die id gibt es meist sehr wohl -- sie ist nur kein Entwurf mehr. Der Satz sagt
            // das, weil „nicht gefunden" jemanden auf die Suche nach einem Datenverlust schickt.
            avesmapsErrorResponse(409, 'not_a_draft',
                'Dieser Beitrag ist kein wartender Entwurf mehr — vermutlich wurde er inzwischen '
                . 'veröffentlicht oder verworfen. Bitte die Liste neu laden.');
        }

        avesmapsJsonResponse(200, ['ok' => true, 'post_id' => $id, 'state' => 'proposal',
            'results' => []]);
    }

    $postId = avesmapsSocialCreatePost($pdo, [
        // Die Titelzeile ist WAHLFREI und geht nur an den Kanal „Neuigkeiten" -- die Netze kennen
        // keine Überschrift. Sie zählt deshalb auch nicht zum Zeichenlimit der Netze.
        'title' => (string) ($request['title'] ?? ''),
        'body' => $text,
        'hashtags' => implode(' ', avesmapsSocialNormalizeHashtags($request['hashtags'] ?? [])),
        'media_url' => $mediaUrl,
        'media_kind' => $mediaUrl === '' ? '' : 'image',
        'media_license' => (string) ($request['media_license'] ?? ''),
        'media_source' => (string) ($request['media_source'] ?? ''),
        // Die Bildbeschreibung geht an die Netze, die sie kennen (Mastodon heute, Instagram spaeter).
        // Leer ist erlaubt: dann wird KEINE gesendet, statt eine erfundene -- ein Screenreader, dem
        // man den Beitragstext als Bildbeschreibung vorliest, hoert denselben Satz zweimal.
        'media_alt' => (string) ($request['media_alt'] ?? ''),
        'ai_declared' => $aiDeclared,
        'origin' => 'editor',
        'state' => $isDraft ? 'proposal' : 'released',
        'author_user_id' => (int) ($user['id'] ?? 0),
        'author_name' => (string) ($user['username'] ?? ''),
    ], $selected);

    // 🔴 Ein Entwurf wird NICHT versendet. Der Rücksprung steht vor dem Versand und nicht als Zweig
    // darin: so kann kein späterer Zweig versehentlich daran vorbeilaufen, und die Zeile darunter
    // bedeutet ohne Ausnahme „das geht jetzt raus".
    if ($isDraft) {
        avesmapsJsonResponse(200, ['ok' => true, 'post_id' => $postId, 'state' => 'proposal',
            'results' => []]);
    }

    $dispatch = avesmapsSocialDispatch($pdo, $postId, $config);
    // The response carries the per-channel outcome, not one boolean: the hub reports "Instagram ✓,
    // Mastodon Fehler" straight from it, which is the same truth the list will show on reload.
    avesmapsJsonResponse(200, ['ok' => true, 'post_id' => $postId, 'results' => $dispatch['results']]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}

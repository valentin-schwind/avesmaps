<?php

declare(strict_types=1);

// The Facebook adapter (Entwurf §3, Stufe 2): one finished post -> one post on the project's PAGE.
//
// 🔴 A PAGE TOKEN, NOT A USER TOKEN, AND NEVER /me. The token stored under channel_key 'facebook'
// belongs to the page and is obtained by asking GET /me/accounts WITH A LONG-LIVED USER TOKEN -- only
// then does the page token itself never expire. Every request below addresses the page by its id from
// the configuration. Writing /me/feed instead would be one character shorter and, the day the stored
// token turns out to be a user token, would publish the project's post on the owner's PRIVATE profile
// -- publicly, under their own name. There is no fallback to /me anywhere in this file, on purpose.
//
// 💣 THE TOKEN GOES IN THE POST BODY, NEVER IN THE URL. Graph accepts ?access_token=… and that is how
// most examples show it; a query string lands in server logs, in error texts and in anything that ever
// prints the URL. A leaked page token can post as Avesmaps until it is manually revoked.
//
// 💣 NO ID BACK MEANS NOT SENT. Meta answers a successful write with an id. Anything else -- an error
// object, an empty body, an HTTP 200 without id -- is a failure here, because "gesendet" in the panel
// is a promise that something is publicly visible (Entwurf §2.2).

require_once __DIR__ . '/../channels.php';

// 💣 PINNED, and one version BEHIND the newest. Meta retires a Graph version roughly two years after
// release; an unversioned URL resolves to whatever Meta currently defaults to, so the day they move it
// the adapter changes behaviour with no deploy of ours. v25.0 (released 18.02.2026) is available until
// 29.07.2028 -- measured against Metas changelog on 10.08.2026, not guessed. Overridable per config
// (`social.facebook.graph_version`) so a version bump is a config edit, not a deploy.
const AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION = 'v25.0';
// Bounded on purpose: this runs inside the editor's publish request on shared hosting, where a hanging
// call costs a PHP worker (AGENTS.md §10, the pool incident of 2026-07-17).
const AVESMAPS_SOCIAL_FACEBOOK_TIMEOUT = 20;

/**
 * Which Graph endpoint, and which fields -- WITHOUT the token.
 *
 * Pure, and separated from the HTTP call for exactly that reason: this is where a picture post
 * silently becomes a text post, and it is the only half that can be tested without a page.
 *
 * 💣 A picture is /photos with `url`, not /feed with `link`. /feed's link would render as a link
 * preview of avesmaps.de -- Facebook fetching our page and picking whatever OG image it likes --
 * instead of the picture the editor chose and the pipeline cropped.
 *
 * @return array{url: string, fields: array<string, string>, endpoint: string}
 */
function avesmapsSocialFacebookRequest(
    string $pageId,
    string $caption,
    string $mediaUrl,
    string $graphVersion = AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION
): array {
    $base = 'https://graph.facebook.com/' . $graphVersion . '/' . rawurlencode($pageId);

    if (trim($mediaUrl) !== '') {
        return [
            'endpoint' => 'photos',
            'url' => $base . '/photos',
            'fields' => [
                // Meta LOADS the picture from this url; it is never attached to the request (Entwurf §5).
                'url' => $mediaUrl,
                // On /photos the text is `caption`. Sending `message` there is accepted and DROPPED --
                // the picture appears without a word of the editor's text, and nothing reports an error.
                'caption' => $caption,
                'published' => 'true',
            ],
        ];
    }

    return [
        'endpoint' => 'feed',
        'url' => $base . '/feed',
        // On /feed it is `message`. Same text, different field name -- the asymmetry above is Meta's.
        'fields' => ['message' => $caption],
    ];
}

/**
 * Turn Graph's answer into our outcome. Pure, so every failure shape can be pinned by a test.
 *
 * Fails CLOSED in every ambiguous case: an unknown state becomes 'fehler', never 'gesendet'
 * (Entwurf §2.2 -- green means "it is out there").
 *
 * @return array{ok: bool, remote_id?: string, error?: string}
 */
function avesmapsSocialFacebookReadResponse(int $status, string $body): array
{
    $data = json_decode($body, true);

    // Meta reports errors as {"error": {...}} and normally with a 4xx. The error object is checked
    // FIRST and regardless of the status code: a 200 carrying an error object is still a failure.
    if (is_array($data) && is_array($data['error'] ?? null)) {
        $error = $data['error'];
        $code = (int) ($error['code'] ?? 0);
        $message = trim((string) ($error['message'] ?? ''));

        // Meta's own text travels through -- it is the diagnosis, and hiding it behind "Fehler beim
        // Senden" is what turns a five-minute fix into an hour of guessing. This is an upstream API
        // message, not one of our exception traces (AGENTS.md §10).
        $text = 'Facebook hat abgelehnt' . ($code > 0 ? ' (Code ' . $code . ')' : '') . ': '
            . ($message === '' ? 'ohne Begründung.' : $message);

        // The two codes that actually happen here get a hint, because their message names neither the
        // token row nor the page task, and both are one-line fixes once you know which one it is.
        $text .= match ($code) {
            190 => ' — der Token gilt nicht mehr. Neuen Seiten-Token holen und die Zeile'
                . ' channel_key = "facebook" in social_token ersetzen.',
            200, 10 => ' — es fehlt ein Recht: die Seiten-Aufgabe CREATE_CONTENT bzw. die Berechtigung'
                . ' pages_manage_posts. Der Token muss ein SEITEN-Token sein, kein Nutzer-Token.',
            default => '',
        };

        return ['ok' => false, 'error' => $text];
    }

    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => 'Facebook antwortete mit HTTP ' . $status
            . ' und ohne verwertbare Fehlermeldung.'];
    }

    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'Facebook antwortete mit HTTP ' . $status
            . ', aber nicht mit JSON. Es gilt als nicht gesendet.'];
    }

    // 💣 post_id BEFORE id. /photos answers with BOTH: `id` is the photo, `post_id` (the
    // "<seite>_<beitrag>" form) is the post on the page. Storing the photo id means the remote id in
    // our list does not address the thing that is publicly visible -- it neither opens nor deletes it.
    $remoteId = trim((string) ($data['post_id'] ?? $data['id'] ?? ''));
    if ($remoteId === '') {
        return ['ok' => false, 'error' => 'Facebook meldete keinen Beitrag zurück (HTTP ' . $status
            . ' ohne id). Es gilt als nicht gesendet.'];
    }

    return ['ok' => true, 'remote_id' => $remoteId];
}

/**
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 * @param array{settings?: array<string, mixed>, access_token?: string} $context
 * @return array{ok: bool, remote_id?: string, error?: string}
 */
function avesmapsSocialAdapterFacebook(
    array $post,
    array $channel,
    string $caption,
    string $mediaUrl,
    array $context = []
): array {
    $settings = is_array($context['settings'] ?? null) ? $context['settings'] : [];
    $pageId = trim((string) ($settings['page_id'] ?? ''));
    $token = trim((string) ($context['access_token'] ?? ''));

    // Both refusals name the exact place the value belongs. "Nicht eingerichtet" would be true and
    // useless: the two halves live in two different places by design (Entwurf §3), and which one is
    // missing is the whole question.
    if ($pageId === '') {
        return ['ok' => false, 'error' => 'Für Facebook fehlt die Seiten-Kennung — '
            . 'social.facebook.page_id in api/config.local.php.'];
    }
    if ($token === '') {
        return ['ok' => false, 'error' => 'Für Facebook fehlt der Zugangs-Token — '
            . 'die Zeile channel_key = "facebook" in der Tabelle social_token.'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'Auf dem Server fehlt cURL; es kann nichts gesendet werden.'];
    }

    $version = trim((string) ($settings['graph_version'] ?? '')) !== ''
        ? trim((string) $settings['graph_version'])
        : AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION;
    $request = avesmapsSocialFacebookRequest($pageId, $caption, $mediaUrl, $version);

    $handle = curl_init($request['url']);
    if ($handle === false) {
        return ['ok' => false, 'error' => 'Die Verbindung zu Facebook ließ sich nicht aufbauen.'];
    }

    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        // The token joins the fields HERE, at the last possible moment, and never the url (see above).
        CURLOPT_POSTFIELDS => http_build_query($request['fields'] + ['access_token' => $token]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_FACEBOOK_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        // ⚠️ Redirects are NOT followed. On a POST, curl would re-send the body -- token included -- to
        // wherever it was pointed. Graph does not redirect writes; if it ever does, we want to see the
        // 3xx as a failure rather than to have posted twice, or elsewhere.
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['User-Agent: Avesmaps (https://avesmaps.de)'],
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    if ($body === false) {
        // A timeout is the ambiguous case: the post MAY have gone through. It is still reported as a
        // failure -- but the text says so, because the editor's next move is to look at the page before
        // pressing "Erneut", not to blind-retry into a duplicate.
        return ['ok' => false, 'error' => 'Facebook hat nicht geantwortet (' . $curlError . '). '
            . 'Bitte auf der Seite nachsehen, BEVOR erneut gesendet wird — der Beitrag kann trotzdem '
            . 'draußen sein.'];
    }

    return avesmapsSocialFacebookReadResponse($status, (string) $body);
}

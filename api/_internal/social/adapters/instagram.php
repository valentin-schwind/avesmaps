<?php

declare(strict_types=1);

// The Instagram adapter (Entwurf §12.4, Stufe 2): one finished post -> one picture post on @avesmaps.
//
// 🔴 IT RUNS OVER THE FACEBOOK PAGE, and that is a measured decision, not a leftover. @avesmaps hangs
// on the page as `instagram_business_account`, so the very page token that publishes to Facebook also
// publishes here: same host, same app, same token, and it NEVER EXPIRES. The Instagram-Login way
// originally written down in Entwurf §12.1 would have brought a 60-day token, a renewal around day 35,
// a runner to do it and a watch on that runner -- four moving parts, all of them able to fail
// silently, in exchange for nothing. §12.1 stays in the design as the documented way back should Meta
// ever unlink the account.
//
// 💣 TWO STEPS, AND THE FIRST ONE ALONE IS NOTHING. POST /media hands back a `creation_id` -- a
// container, not a post. Only POST /media_publish makes it public. A run that dies in between has
// published NOTHING and must say so; the container expires by itself after 24 hours, so there is
// nothing to clean up either. Reporting the container as success is the single worst thing this file
// could do: the panel would read "gesendet" with an empty Instagram profile behind it (Entwurf §2.2).
//
// 💣 THE TOKEN GOES IN THE POST BODY, NEVER IN THE URL -- the same rule, and the same token, as
// facebook.php. It is also why the wait between the two steps is a RETRY on the publish rather than a
// GET on the container's status: a status GET would have to carry the token in a query string, into
// every server log, to learn something error 9007 already tells us.
//
// 💣 NO ID BACK MEANS NOT SENT. Checked separately for BOTH steps.

require_once __DIR__ . '/../channels.php';
// For the pinned Graph version and the timeouts. Deliberately shared rather than copied: it is the
// same host, the same app and the same Graph, so there must be exactly one place to bump.
require_once __DIR__ . '/facebook.php';

// 💣 THE WAIT IS CAPPED. Instagram needs a moment to process the picture, and asking too early gets
// error 9007. Three attempts with a short pause is enough for a JPEG in the low hundreds of kilobytes
// and stays under five seconds of waiting -- this runs inside the editor's publish request on shared
// hosting, where every held second is a held PHP worker (AGENTS.md §10, the pool incident of
// 2026-07-17). Waiting "until it works" is how one publish takes down the site.
const AVESMAPS_SOCIAL_INSTAGRAM_PUBLISH_ATTEMPTS = 3;
const AVESMAPS_SOCIAL_INSTAGRAM_RETRY_PAUSE_US = 1_500_000;

/**
 * Step 1 -- the container. WITHOUT the token.
 *
 * 💣 `image_url`, not `url`. Facebook's /photos calls the very same thing `url`; one project, one
 * picture, two spellings. And `caption`, not `message`. Both asymmetries are Meta's, and both are the
 * kind that produce a post missing exactly the part nobody checks.
 *
 * @return array{url: string, fields: array<string, string>}
 */
function avesmapsSocialInstagramContainerRequest(
    string $igUserId,
    string $caption,
    string $mediaUrl,
    string $graphVersion = AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION
): array {
    return [
        'url' => 'https://graph.facebook.com/' . $graphVersion . '/' . rawurlencode($igUserId) . '/media',
        'fields' => [
            // Meta LOADS the picture from this url; it is never attached to the request. Hence the
            // reachability probe that runs before any of this (Entwurf §5).
            'image_url' => $mediaUrl,
            'caption' => $caption,
        ],
    ];
}

/**
 * Step 2 -- publish the container. WITHOUT the token.
 *
 * @return array{url: string, fields: array<string, string>}
 */
function avesmapsSocialInstagramPublishRequest(
    string $igUserId,
    string $creationId,
    string $graphVersion = AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION
): array {
    return [
        'url' => 'https://graph.facebook.com/' . $graphVersion . '/' . rawurlencode($igUserId) . '/media_publish',
        'fields' => ['creation_id' => $creationId],
    ];
}

/**
 * Metas Fehler aus einer Antwort, oder null wenn keiner drinsteht. Rein.
 *
 * Der Fehlerobjekt-Test steht VOR dem Statuscode und gewinnt gegen ihn: eine 200 mit Fehlerobjekt ist
 * ein Fehlschlag, auch wenn daneben eine id steht.
 *
 * @return array{code: int, message: string}|null
 */
function avesmapsSocialInstagramError(string $body): ?array
{
    $data = json_decode($body, true);
    if (!is_array($data) || !is_array($data['error'] ?? null)) {
        return null;
    }

    return [
        'code' => (int) ($data['error']['code'] ?? 0),
        'message' => trim((string) ($data['error']['message'] ?? '')),
    ];
}

/**
 * Metas Fehlertext plus, bei den drei Codes die hier wirklich vorkommen, der Zusatz den ihr Wortlaut
 * schuldig bleibt. Rein.
 *
 * @param array{code: int, message: string} $error
 */
function avesmapsSocialInstagramErrorText(array $error, string $step): string
{
    $code = $error['code'];
    $text = 'Instagram hat ' . $step . ' abgelehnt' . ($code > 0 ? ' (Code ' . $code . ')' : '') . ': '
        . ($error['message'] === '' ? 'ohne Begründung.' : $error['message']);

    return $text . match ($code) {
        190 => ' — der Token gilt nicht mehr. Im Hub „Zugang einrichten" erneut ausführen; er ersetzt'
            . ' die Zeile channel_key = "instagram" in social_token.',
        200, 10, 803 => ' — es fehlt ein Recht: instagram_basic bzw. instagram_content_publish. Der'
            . ' Token muss ein SEITEN-Token der verknüpften Facebook-Seite sein, kein Nutzer-Token.',
        9007 => ' — Instagram hatte das Bild noch nicht fertig verarbeitet. Es wurde NICHTS'
            . ' veröffentlicht; der Beitrag lässt sich unverändert erneut senden.',
        default => '',
    };
}

/**
 * Step 1's answer -> the container id, or a refusal. Pure, so every failure shape is pinned by a test.
 *
 * @return array{ok: bool, creation_id?: string, error?: string}
 */
function avesmapsSocialInstagramReadContainer(int $status, string $body): array
{
    $error = avesmapsSocialInstagramError($body);
    if ($error !== null) {
        return ['ok' => false, 'error' => avesmapsSocialInstagramErrorText($error, 'das Bild')];
    }

    $data = json_decode($body, true);
    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'Instagram antwortete auf das Bild mit HTTP ' . $status
            . ', aber nicht mit JSON. Es wurde nichts veröffentlicht.'];
    }

    $creationId = trim((string) ($data['id'] ?? ''));
    if ($creationId === '' || $status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => 'Instagram hat das Bild nicht angenommen (HTTP ' . $status
            . ' ohne Kennung). Es wurde nichts veröffentlicht.'];
    }

    return ['ok' => true, 'creation_id' => $creationId];
}

/**
 * Step 2's answer -> the post id, or a refusal.
 *
 * 💣 `retryable` is set for EXACTLY ONE code: 9007, "Media ID is not available". It is safe to retry
 * only because it proves the opposite of a lost success -- Instagram is still processing the picture,
 * so nothing was published. Marking any other failure retryable risks a second, public post, and a
 * duplicate on Instagram can only be deleted, never merged.
 *
 * @return array{ok: bool, remote_id?: string, error?: string, retryable: bool}
 */
function avesmapsSocialInstagramReadPublish(int $status, string $body): array
{
    $error = avesmapsSocialInstagramError($body);
    if ($error !== null) {
        return [
            'ok' => false,
            'error' => avesmapsSocialInstagramErrorText($error, 'die Veröffentlichung'),
            'retryable' => $error['code'] === 9007,
        ];
    }

    $data = json_decode($body, true);
    if (!is_array($data)) {
        return ['ok' => false, 'retryable' => false,
            'error' => 'Instagram antwortete mit HTTP ' . $status . ', aber nicht mit JSON. Es gilt als'
                . ' nicht veröffentlicht — bitte im Profil nachsehen, bevor erneut gesendet wird.'];
    }

    $remoteId = trim((string) ($data['id'] ?? ''));
    if ($remoteId === '' || $status < 200 || $status >= 300) {
        return ['ok' => false, 'retryable' => false,
            'error' => 'Instagram meldete keinen Beitrag zurück (HTTP ' . $status . ' ohne Kennung).'
                . ' Es gilt als nicht veröffentlicht.'];
    }

    return ['ok' => true, 'remote_id' => $remoteId, 'retryable' => false];
}

/**
 * Try again? Pure, so the cap itself is a tested property rather than a loop condition nobody reads.
 *
 * @param array<string, mixed> $outcome The reading of the last publish attempt.
 * @param int                  $attempt 1-based number of the attempt that just happened.
 */
function avesmapsSocialInstagramShouldRetryPublish(array $outcome, int $attempt): bool
{
    if (($outcome['ok'] ?? false) === true || ($outcome['retryable'] ?? false) !== true) {
        return false;
    }

    return $attempt < AVESMAPS_SOCIAL_INSTAGRAM_PUBLISH_ATTEMPTS;
}

/**
 * One POST to Graph with the token in the BODY.
 *
 * @param array<string, string> $fields
 * @return array{status: int, body: string|null, error: string}
 */
function avesmapsSocialInstagramPost(string $url, array $fields, string $token): array
{
    $handle = curl_init($url);
    if ($handle === false) {
        return ['status' => 0, 'body' => null, 'error' => 'Verbindung nicht aufgebaut'];
    }

    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        // The token joins the fields HERE, at the last possible moment, and never the url.
        CURLOPT_POSTFIELDS => http_build_query($fields + ['access_token' => $token]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_FACEBOOK_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        // ⚠️ Not followed: on a POST curl would re-send the body -- token included -- wherever it was
        // pointed. Graph does not redirect writes.
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['User-Agent: Avesmaps (https://avesmaps.de)'],
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);

    return ['status' => $status, 'body' => $body === false ? null : (string) $body, 'error' => $error];
}

/**
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 * @param array{settings?: array<string, mixed>, access_token?: string} $context
 * @return array{ok: bool, remote_id?: string, error?: string}
 */
function avesmapsSocialAdapterInstagram(
    array $post,
    array $channel,
    string $caption,
    string $mediaUrl,
    array $context = []
): array {
    $settings = is_array($context['settings'] ?? null) ? $context['settings'] : [];
    $igUserId = trim((string) ($settings['user_id'] ?? ''));
    $token = trim((string) ($context['access_token'] ?? ''));

    // Each refusal names the ONE place its value is missing. "Nicht eingerichtet" would be true and
    // useless -- the halves live in two places by design (Entwurf §3), and which one is empty is the
    // whole question.
    if ($igUserId === '') {
        return ['ok' => false, 'error' => 'Für Instagram fehlt die Konto-Kennung — '
            . 'social.instagram.user_id in api/config.local.php.'];
    }
    if ($token === '') {
        return ['ok' => false, 'error' => 'Für Instagram fehlt der Zugangs-Token — '
            . 'die Zeile channel_key = "instagram" in der Tabelle social_token. Im Hub lässt er sich '
            . 'über „Zugang einrichten" holen.'];
    }
    // 💣 The second bolt. requires_media in the registry already stops this in
    // avesmapsSocialCheckTarget, but that is one data edit away from false and this failure is public.
    if (trim($mediaUrl) === '') {
        return ['ok' => false, 'error' => 'Instagram braucht ein Bild. Ohne Anhang wird dort nichts '
            . 'veröffentlicht.'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'Auf dem Server fehlt cURL; es kann nichts gesendet werden.'];
    }

    $version = trim((string) ($settings['graph_version'] ?? '')) !== ''
        ? trim((string) $settings['graph_version'])
        : AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION;

    // ---- Schritt 1: der Behälter ----------------------------------------------------------------
    $request = avesmapsSocialInstagramContainerRequest($igUserId, $caption, $mediaUrl, $version);
    $answer = avesmapsSocialInstagramPost($request['url'], $request['fields'], $token);
    if ($answer['body'] === null) {
        // Unlike step 2, this one is NOT ambiguous: without a container id nothing can have been
        // published, whatever happened to the connection. The text may therefore say so plainly.
        return ['ok' => false, 'error' => 'Instagram hat beim Hochladen des Bildes nicht geantwortet ('
            . $answer['error'] . '). Es wurde nichts veröffentlicht.'];
    }
    $container = avesmapsSocialInstagramReadContainer($answer['status'], $answer['body']);
    if (($container['ok'] ?? false) !== true) {
        return ['ok' => false, 'error' => (string) ($container['error'] ?? 'Unbekannter Fehler.')];
    }

    // ---- Schritt 2: veröffentlichen ---------------------------------------------------------------
    $publishRequest = avesmapsSocialInstagramPublishRequest($igUserId, (string) $container['creation_id'], $version);
    $outcome = ['ok' => false, 'retryable' => false, 'error' => 'Unbekannter Fehler.'];

    for ($attempt = 1; $attempt <= AVESMAPS_SOCIAL_INSTAGRAM_PUBLISH_ATTEMPTS; $attempt++) {
        $answer = avesmapsSocialInstagramPost($publishRequest['url'], $publishRequest['fields'], $token);
        if ($answer['body'] === null) {
            // ⚠️ HERE it IS ambiguous -- the publish may have gone through. Counted as a failure, but
            // the text says so, because the next move is to look at the profile, not to press
            // "Erneut" into a duplicate.
            return ['ok' => false, 'error' => 'Instagram hat beim Veröffentlichen nicht geantwortet ('
                . $answer['error'] . '). Bitte im Profil nachsehen, BEVOR erneut gesendet wird — der '
                . 'Beitrag kann trotzdem draußen sein.'];
        }

        $outcome = avesmapsSocialInstagramReadPublish($answer['status'], $answer['body']);
        if (!avesmapsSocialInstagramShouldRetryPublish($outcome, $attempt)) {
            break;
        }
        usleep(AVESMAPS_SOCIAL_INSTAGRAM_RETRY_PAUSE_US);
    }

    if (($outcome['ok'] ?? false) === true) {
        return ['ok' => true, 'remote_id' => (string) ($outcome['remote_id'] ?? '')];
    }

    return ['ok' => false, 'error' => (string) ($outcome['error'] ?? 'Unbekannter Fehler.')];
}

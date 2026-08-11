<?php

declare(strict_types=1);

// The Mastodon adapter (Entwurf §12.5, Stufe 2): one finished post -> one toot on @Avesmaps.
//
// 💣 THE TOKEN GOES IN THE HEADER, NEVER IN THE URL. Mastodon accepts ?access_token=… just like Graph
// does, and just like there a query string lands in server logs, in error texts and in anything that
// ever prints the URL. Everything below sends `Authorization: Bearer …` and nothing else.
//
// 💣 MASTODON REPORTS ERRORS AS A STRING, NOT AS AN OBJECT. Meta answers {"error":{"message":…,"code":…}};
// Mastodon answers {"error":"Validation failed: …"}. Copying facebook.php's reader here would let the
// is_array($data['error']) test miss every single failure -- and the response would then fall through to
// "no id, so not sent", losing Mastodon's own diagnosis on the way. The two shapes are checked apart.
//
// 💣 MASTODON NEEDS THE BYTES, FACEBOOK GETS A URL. Meta LOADS the picture from its public address; here
// the file is uploaded. So the adapter fetches our own picture back over HTTP and posts it on -- one code
// path whether the file sits in uploads/social or anywhere else, and the dispatch has already proven that
// the address answers (Entwurf §5).
//
// 💣 NO ID BACK MEANS NOT SENT -- the same promise as everywhere: "gesendet" in the panel means something
// is publicly visible (Entwurf §2.2).
//
// ⭐ THE ONE CHANNEL THAT CAN PROVE A RETRY SAFE. Mastodon honours an `Idempotency-Key`: a second request
// carrying a key it has already seen returns the ORIGINAL status instead of creating a second one. That
// turns the timeout case -- where the post MAY be out there -- from "look before you retry" (facebook.php)
// into "just retry". The key is derived from the post id, so it is the same on every attempt.

require_once __DIR__ . '/../channels.php';

// Bounded on purpose: this runs inside the editor's publish request on shared hosting, where a hanging
// call costs a PHP worker (AGENTS.md §10, the pool incident of 2026-07-17).
const AVESMAPS_SOCIAL_MASTODON_TIMEOUT = 20;
// The upload carries the picture itself, so it gets more room than the two JSON calls.
const AVESMAPS_SOCIAL_MASTODON_MEDIA_TIMEOUT = 30;
// Posts are German. Without this Mastodon guesses from the account default, and readers who filter their
// timeline by language see the post fall into the wrong bucket.
const AVESMAPS_SOCIAL_MASTODON_LANGUAGE = 'de';
// Mastodon's own ceiling for an attachment description.
const AVESMAPS_SOCIAL_MASTODON_DESCRIPTION_MAX = 1500;
// How long we wait for an attachment that came back as "202 -- still processing". Small JPEGs from our
// pipeline answer 200 immediately; this is the bounded safety net, not the normal path.
const AVESMAPS_SOCIAL_MASTODON_MEDIA_POLL_TRIES = 3;
const AVESMAPS_SOCIAL_MASTODON_MEDIA_POLL_SLEEP = 1;
// rollenspiel.social allows 16 MB; our own pipeline caps at 12. This is the guard against fetching
// something unexpected into memory, not a second policy.
const AVESMAPS_SOCIAL_MASTODON_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The instance root, from whatever stands in the configuration.
 *
 * 💣 THE INSTANCE, NOT THE PROFILE. The obvious thing to paste into social.mastodon.base_url is the
 * address in the browser's bar -- and that is https://rollenspiel.social/@Avesmaps. Keeping the path
 * would build …/@Avesmaps/api/v1/statuses, which answers 404, and the refusal would blame the token.
 * Everything after the host is therefore dropped.
 *
 * 💣 http is upgraded to https. A bearer token over a clear connection is a leaked token, and every
 * Mastodon instance serves https anyway -- so this can only ever repair a typo, never break a setup.
 *
 * @return string Without a trailing slash, or '' when nothing usable was configured.
 */
function avesmapsSocialMastodonBaseUrl(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') {
        return '';
    }
    // A bare "rollenspiel.social" is what people type; parse_url would read it as a PATH, not a host.
    if (!preg_match('~^[a-z][a-z0-9+.-]*://~i', $raw)) {
        $raw = 'https://' . $raw;
    }

    $parts = parse_url($raw);
    if (!is_array($parts) || trim((string) ($parts['host'] ?? '')) === '') {
        return '';
    }
    $host = strtolower((string) $parts['host']);
    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';

    return 'https://' . $host . $port;
}

/** Join the normalised base with an API path. Never produces a double slash. */
function avesmapsSocialMastodonUrl(string $base, string $path): string
{
    return rtrim($base, '/') . '/' . ltrim($path, '/');
}

/**
 * The retry guard (see the header). Derived from the post id ALONE, so every attempt at the same post
 * carries the same key and Mastodon can recognise the repeat.
 *
 * ⚠️ Deliberately NOT mixed with a hash of the text. A key that changed when the caption changed would
 * be a new key exactly when an editor fixes and re-sends a post that timed out -- which is the one case
 * this guard exists for. A failed attempt creates no status and caches no key, so an edited retry after
 * a genuine failure posts the new text regardless.
 */
function avesmapsSocialMastodonIdempotencyKey(int $postId): string
{
    return 'avesmaps-social-' . $postId;
}

/**
 * The picture description that Mastodon reads out to screen readers.
 *
 * 💣 IT BELONGS TO THE UPLOAD, NOT TO THE STATUS. /api/v1/statuses has no description field; sending it
 * there is accepted and dropped, and the picture would arrive marked as undescribed with nobody the
 * wiser. It travels with the attachment in avesmapsSocialMastodonUploadMedia.
 *
 * ⚠️ Empty stays empty. Falling back to the post's own text would read the same sentence to a screen
 * reader twice -- worse than the honest "no description" marker Mastodon shows.
 *
 * @param array<string, mixed> $post
 */
function avesmapsSocialMastodonDescription(array $post): string
{
    $description = trim((string) ($post['media_alt'] ?? ''));

    return mb_substr($description, 0, AVESMAPS_SOCIAL_MASTODON_DESCRIPTION_MAX);
}

/**
 * The status body -- WITHOUT the token, and as an array ready for json_encode.
 *
 * 💣 JSON, not a form encoding. Mastodon wants `media_ids` as a LIST, and http_build_query writes an
 * array as media_ids[0]=… , which Rack parses into a HASH keyed "0" and Mastodon then rejects. JSON has
 * no such ambiguity, which is why this half returns a structure rather than a query string.
 *
 * @return array{status: string, language: string, media_ids?: list<string>}
 */
function avesmapsSocialMastodonStatusFields(string $caption, string $mediaId): array
{
    $fields = [
        'status' => $caption,
        'language' => AVESMAPS_SOCIAL_MASTODON_LANGUAGE,
    ];
    if (trim($mediaId) !== '') {
        $fields['media_ids'] = [trim($mediaId)];
    }

    return $fields;
}

/**
 * Mastodon's failure text, whichever of its two shapes came back. Pure, so every shape can be pinned.
 *
 * The instance's own words travel through -- they ARE the diagnosis, and hiding them behind "Fehler beim
 * Senden" is what turns a five-minute fix into an hour of guessing (AGENTS.md §10 concerns OUR exception
 * traces, not an upstream API message).
 *
 * @param mixed $data The decoded body, or null when it was not JSON.
 */
function avesmapsSocialMastodonErrorText(int $status, mixed $data, string $what): string
{
    $message = '';
    if (is_array($data)) {
        // {"error":"…"} is the usual shape; error_description carries the longer form on OAuth failures.
        $message = trim((string) ($data['error_description'] ?? $data['error'] ?? ''));
    }

    $text = 'Mastodon hat ' . $what . ' abgelehnt (HTTP ' . $status . ')'
        . ($message === '' ? '.' : ': ' . $message);

    // The codes that actually happen here. Their wording names neither the config key nor the scope, and
    // each is a one-line fix once you know which of them it is.
    return $text . match (true) {
        $status === 401 => ' — der Zugangsschlüssel gilt nicht. social.mastodon.access_token in'
            . ' api/config.local.php ersetzen (bzw. die Zeile channel_key = "mastodon" in social_token).',
        $status === 403 => ' — dem Zugangsschlüssel fehlt ein Recht. Die Anwendung braucht'
            . ' write:statuses und write:media.',
        $status === 404 => ' — die Adresse der Instanz stimmt nicht. social.mastodon.base_url muss die'
            . ' INSTANZ sein (https://rollenspiel.social), nicht die Profilseite.',
        $status === 422 => ' — der Beitrag wurde zurückgewiesen. Häufigste Gründe: zu lang (Mastodon'
            . ' zählt jede Verknüpfung als 23 Zeichen, auch eine kürzere) oder das Bild war noch nicht'
            . ' fertig verarbeitet.',
        $status === 429 => ' — zu viele Beiträge in kurzer Zeit. Später erneut senden.',
        default => '',
    };
}

/**
 * Read the answer of POST /api/v2/media.
 *
 * 💣 202 IS NOT AN ERROR AND NOT A SUCCESS EITHER. Mastodon answers 200 when the attachment is ready and
 * 202 when it is still being processed. Attaching a still-processing id to a status is refused with a
 * 422 whose text is about the status, not about the picture -- so the pending case is reported as such
 * and the caller waits for it.
 *
 * @return array{ok: bool, media_id?: string, pending?: bool, error?: string}
 */
function avesmapsSocialMastodonReadMedia(int $status, string $body): array
{
    $data = json_decode($body, true);

    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => avesmapsSocialMastodonErrorText($status, $data, 'das Bild')];
    }
    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'Mastodon antwortete auf den Bild-Upload mit HTTP ' . $status
            . ', aber nicht mit JSON. Es wurde nichts gesendet.'];
    }

    $mediaId = trim((string) ($data['id'] ?? ''));
    if ($mediaId === '') {
        return ['ok' => false, 'error' => 'Mastodon meldete zum Bild keine Kennung zurück (HTTP '
            . $status . '). Es wurde nichts gesendet.'];
    }

    return ['ok' => true, 'media_id' => $mediaId, 'pending' => $status === 202];
}

/**
 * Read the answer of POST /api/v1/statuses.
 *
 * Fails CLOSED in every ambiguous case: an unknown state becomes a failure, never "gesendet"
 * (Entwurf §2.2 -- green means "it is out there").
 *
 * @return array{ok: bool, remote_id?: string, error?: string}
 */
function avesmapsSocialMastodonReadStatus(int $status, string $body): array
{
    $data = json_decode($body, true);

    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => avesmapsSocialMastodonErrorText($status, $data, 'den Beitrag')];
    }
    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'Mastodon antwortete mit HTTP ' . $status . ', aber nicht mit'
            . ' JSON. Es gilt als nicht gesendet.'];
    }
    // A 2xx that still carries an error field is a failure. Checked explicitly because Mastodon's error
    // is a plain string, so it would otherwise slip past unnoticed into the "no id" branch below.
    if (trim((string) ($data['error'] ?? '')) !== '') {
        return ['ok' => false, 'error' => avesmapsSocialMastodonErrorText($status, $data, 'den Beitrag')];
    }

    // The status id, not the url: it is what addresses the toot for a later look or deletion. The url is
    // derivable from it, the other way round it is not.
    $remoteId = trim((string) ($data['id'] ?? ''));
    if ($remoteId === '') {
        return ['ok' => false, 'error' => 'Mastodon meldete keinen Beitrag zurück (HTTP ' . $status
            . ' ohne id). Es gilt als nicht gesendet.'];
    }

    // Mastodon nennt die Adresse gleich mit -- `url` ist die kanonische, oeffentlich erreichbare.
    // Sie wird NICHT aus id und Instanz zusammengebaut: bei einem geteilten Beitrag zeigt `url` auf
    // den Ursprungsserver, eine selbstgebaute Adresse auf den eigenen, und der antwortet dann 404.
    return ['ok' => true, 'remote_id' => $remoteId,
        'remote_url' => trim((string) ($data['url'] ?? ''))];
}

/**
 * Fetch our own picture back so it can be uploaded. See the header for why this is not a URL hand-off.
 *
 * @return array{ok: bool, bytes?: string, mime?: string, error?: string}
 */
function avesmapsSocialMastodonFetchPicture(string $absoluteUrl): array
{
    $handle = curl_init($absoluteUrl);
    if ($handle === false) {
        return ['ok' => false, 'error' => 'Das Bild ließ sich nicht abrufen.'];
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_MASTODON_MEDIA_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_HTTPHEADER => ['User-Agent: Avesmaps (https://avesmaps.de)'],
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $mime = trim((string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE));
    curl_close($handle);

    if ($body === false || $status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => 'Das Bild war unter ' . $absoluteUrl . ' nicht abrufbar (HTTP '
            . $status . '). Es wurde nichts gesendet.'];
    }
    if (strlen((string) $body) > AVESMAPS_SOCIAL_MASTODON_MEDIA_MAX_BYTES) {
        return ['ok' => false, 'error' => 'Das Bild ist zu groß für Mastodon.'];
    }

    // The pipeline always writes JPEG (media.php); the header is only trusted for the rare case of a
    // picture that came from somewhere else, and never for something that is not an image at all.
    $mime = strtok($mime, ';') ?: '';
    if (!str_starts_with($mime, 'image/')) {
        $mime = 'image/jpeg';
    }

    return ['ok' => true, 'bytes' => (string) $body, 'mime' => $mime];
}

/**
 * Upload one picture with its description. Multipart -- this is the ONE call that is not JSON, because
 * it carries a file.
 *
 * @return array{ok: bool, media_id?: string, pending?: bool, error?: string}
 */
function avesmapsSocialMastodonUploadMedia(
    string $base,
    string $token,
    string $bytes,
    string $mime,
    string $description
): array {
    // CURLFile wants a path, and the bytes are in memory. The file is removed in every exit path.
    $temporary = tempnam(sys_get_temp_dir(), 'avesmaps-social-');
    if ($temporary === false || file_put_contents($temporary, $bytes) === false) {
        if ($temporary !== false) {
            @unlink($temporary);
        }

        return ['ok' => false, 'error' => 'Das Bild ließ sich auf dem Server nicht zwischenlegen.'];
    }

    try {
        $extension = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
        $fields = [
            // The field is called `file`. Anything else is accepted as an empty upload and refused with
            // a message about a missing file, which reads like a broken picture rather than a wrong key.
            'file' => new CURLFile($temporary, $mime, 'avesmaps.' . $extension),
        ];
        // Only sent when there is one: an empty description would be stored as an empty description,
        // which is not the same as none.
        if ($description !== '') {
            $fields['description'] = $description;
        }

        $handle = curl_init(avesmapsSocialMastodonUrl($base, '/api/v2/media'));
        if ($handle === false) {
            return ['ok' => false, 'error' => 'Die Verbindung zu Mastodon ließ sich nicht aufbauen.'];
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $fields,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_MASTODON_MEDIA_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            // ⚠️ Redirects are NOT followed. On a POST, curl would re-send the body -- token included --
            // to wherever it was pointed.
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'User-Agent: Avesmaps (https://avesmaps.de)',
            ],
        ]);
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($handle);
        curl_close($handle);

        if ($body === false) {
            return ['ok' => false, 'error' => 'Mastodon hat den Bild-Upload nicht beantwortet ('
                . $curlError . '). Es wurde nichts gesendet.'];
        }

        return avesmapsSocialMastodonReadMedia($status, (string) $body);
    } finally {
        @unlink($temporary);
    }
}

/**
 * Wait for an attachment that came back as 202. GET /api/v1/media/:id answers 206 while it is still
 * processing and 200 once it is ready.
 *
 * @return array{ok: bool, error?: string}
 */
function avesmapsSocialMastodonAwaitMedia(string $base, string $token, string $mediaId): array
{
    for ($try = 0; $try < AVESMAPS_SOCIAL_MASTODON_MEDIA_POLL_TRIES; $try++) {
        sleep(AVESMAPS_SOCIAL_MASTODON_MEDIA_POLL_SLEEP);

        $handle = curl_init(avesmapsSocialMastodonUrl($base, '/api/v1/media/' . rawurlencode($mediaId)));
        if ($handle === false) {
            continue;
        }
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_MASTODON_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'User-Agent: Avesmaps (https://avesmaps.de)',
            ],
        ]);
        curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);

        if ($status === 200) {
            return ['ok' => true];
        }
    }

    // Fails closed. Posting anyway would earn a 422 whose text talks about the status, not the picture.
    return ['ok' => false, 'error' => 'Mastodon hat das Bild nicht rechtzeitig verarbeitet. Es wurde'
        . ' nichts gesendet — bitte den Beitrag erneut senden.'];
}

/**
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 * @param array{settings?: array<string, mixed>, access_token?: string} $context
 * @return array{ok: bool, remote_id?: string, error?: string}
 */
function avesmapsSocialAdapterMastodon(
    array $post,
    array $channel,
    string $caption,
    string $mediaUrl,
    array $context = []
): array {
    $settings = is_array($context['settings'] ?? null) ? $context['settings'] : [];
    $base = avesmapsSocialMastodonBaseUrl((string) ($settings['base_url'] ?? ''));
    $token = trim((string) ($context['access_token'] ?? ''));

    // Both refusals name the exact place the value belongs. "Nicht eingerichtet" would be true and
    // useless: which of the two halves is missing is the whole question (Entwurf §3).
    if ($base === '') {
        return ['ok' => false, 'error' => 'Für Mastodon fehlt die Adresse der Instanz — '
            . 'social.mastodon.base_url in api/config.local.php.'];
    }
    if ($token === '') {
        return ['ok' => false, 'error' => 'Für Mastodon fehlt der Zugangsschlüssel — '
            . 'social.mastodon.access_token in api/config.local.php (oder die Zeile '
            . 'channel_key = "mastodon" in der Tabelle social_token).'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'Auf dem Server fehlt cURL; es kann nichts gesendet werden.'];
    }

    $mediaId = '';
    if (trim($mediaUrl) !== '') {
        $picture = avesmapsSocialMastodonFetchPicture($mediaUrl);
        if (($picture['ok'] ?? false) !== true) {
            return ['ok' => false, 'error' => (string) ($picture['error'] ?? 'Bildfehler.')];
        }

        $upload = avesmapsSocialMastodonUploadMedia(
            $base,
            $token,
            (string) $picture['bytes'],
            (string) $picture['mime'],
            avesmapsSocialMastodonDescription($post)
        );
        if (($upload['ok'] ?? false) !== true) {
            return ['ok' => false, 'error' => (string) ($upload['error'] ?? 'Bild-Upload fehlgeschlagen.')];
        }
        $mediaId = (string) $upload['media_id'];

        if (($upload['pending'] ?? false) === true) {
            $ready = avesmapsSocialMastodonAwaitMedia($base, $token, $mediaId);
            if (($ready['ok'] ?? false) !== true) {
                return ['ok' => false, 'error' => (string) ($ready['error'] ?? 'Bild nicht bereit.')];
            }
        }
    }

    $handle = curl_init(avesmapsSocialMastodonUrl($base, '/api/v1/statuses'));
    if ($handle === false) {
        return ['ok' => false, 'error' => 'Die Verbindung zu Mastodon ließ sich nicht aufbauen.'];
    }
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => (string) json_encode(
            avesmapsSocialMastodonStatusFields($caption, $mediaId),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_MASTODON_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => [
            // The token joins HERE, in the header, and never the url (see the file header).
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
            // ⭐ The retry guard. A repeat of this key returns the original status instead of a second one.
            'Idempotency-Key: ' . avesmapsSocialMastodonIdempotencyKey((int) ($post['id'] ?? 0)),
            'User-Agent: Avesmaps (https://avesmaps.de)',
        ],
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    if ($body === false) {
        // Unlike Facebook, the advice here is simply to retry: the Idempotency-Key above makes a repeat
        // return the original post rather than create a duplicate, so a timeout costs nothing but a click.
        return ['ok' => false, 'error' => 'Mastodon hat nicht geantwortet (' . $curlError . '). '
            . 'Erneut senden ist gefahrlos — der Idempotency-Key verhindert einen Doppelbeitrag.'];
    }

    return avesmapsSocialMastodonReadStatus($status, (string) $body);
}

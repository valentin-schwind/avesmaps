<?php

declare(strict_types=1);

// Dispatch: walk a post's targets, compose per channel, ask the adapter, write the status.
//
// 💣 THE STATUS BELONGS TO THE CHANNEL (Entwurf §2.2). One failing network must never mark the others
// failed, and must never be swallowed by a shared "gesendet". Every branch below writes exactly one
// target row and then moves on.
//
// 💣 LIVE FIRST, THEN POST (Entwurf §5). The picture URL is probed ONCE per dispatch, before any
// adapter runs. Posting before the URL serves 200 makes the network cache the failure, and the post
// then carries an empty picture for good -- re-uploading does not repair it.

require_once __DIR__ . '/channels.php';
require_once __DIR__ . '/compose.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/adapters/probe.php';
require_once __DIR__ . '/adapters/changelog.php';
require_once __DIR__ . '/adapters/facebook.php';

/**
 * May this post go to this channel? Returns the refusal as GERMAN text -- it lands in the editor's
 * list as the reason nothing went out -- or null when nothing speaks against it.
 *
 * Pure: no database, no HTTP. It is the one part of dispatch that can be unit-tested, and the part
 * where a mistake becomes a public post.
 *
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 */
function avesmapsSocialCheckTarget(array $post, array $channel, string $caption): ?string
{
    $label = (string) ($channel['label'] ?? 'Der Kanal');

    if (trim($caption) === '') {
        return 'Der Beitrag hat keinen Text — ein leerer Beitrag wird nicht gesendet.';
    }

    if (($channel['requires_media'] ?? false) === true && trim((string) ($post['media_url'] ?? '')) === '') {
        return $label . ' braucht ein Bild. Ohne Anhang wird dort nichts veröffentlicht.';
    }

    $maxChars = $channel['max_chars'] ?? null;
    if ($maxChars !== null && mb_strlen($caption) > (int) $maxChars) {
        // Both numbers are part of the message on purpose: "zu lang" leaves the editor guessing by how
        // much, and the hashtags are usually the surprise.
        return $label . ': ' . mb_strlen($caption) . ' Zeichen, erlaubt sind '
            . (int) $maxChars . ' (Hashtags zählen mit).';
    }

    return null;
}

/**
 * The adapter for a channel, or null when there is none yet.
 *
 * 🔴 A missing adapter is NULL, never a no-op that reports success. A silent no-op would mark
 * Instagram "gesendet" with nothing on Instagram -- the single worst failure mode this design exists
 * to avoid, and one nobody would catch by looking at the panel.
 */
function avesmapsSocialAdapterFor(string $key): ?callable
{
    return match ($key) {
        'probe' => 'avesmapsSocialAdapterProbe',
        // Der einzige Kanal, der auf avesmaps SELBST veröffentlicht (Fenster „Neuigkeiten").
        'changelog' => 'avesmapsSocialAdapterChangelog',
        'facebook' => 'avesmapsSocialAdapterFacebook',
        default => null,
    };
}

/**
 * What an adapter needs beyond the post: its config block and its access token.
 *
 * 🔴 THE DATABASE WINS OVER THE CONFIG. config.local.php carries what never changes (page id, app id,
 * app secret); social_token carries what rotates, and it is what the server itself rewrites when a
 * token is renewed (Entwurf §3). If both hold a token, the stored one is the current one -- preferring
 * the config would mean a renewal silently has no effect and the channel dies on the day the old token
 * expires, weeks after the renewal "worked".
 *
 * @param array<string, mixed>  $social    The 'social' block of config.local.php.
 * @param array<string, string> $tokenRows channel_key => access_token, read once per dispatch.
 * @return array{settings: array<string, mixed>, access_token: string}
 */
function avesmapsSocialAdapterContext(array $social, array $tokenRows, string $key): array
{
    $settings = is_array($social[$key] ?? null) ? $social[$key] : [];
    $stored = trim((string) ($tokenRows[$key] ?? ''));

    return [
        'settings' => $settings,
        'access_token' => $stored !== '' ? $stored : trim((string) ($settings['access_token'] ?? '')),
    ];
}

/**
 * Send one post to its pending targets, or -- with $onlyChannel -- retry exactly one.
 *
 * @param array<string, mixed> $config      The full API config; the 'social' block gates everything.
 * @param string|null          $onlyChannel Retry this channel alone, leaving the others untouched.
 * @return array{ok: bool, results: array<string, array<string, mixed>>}
 */
function avesmapsSocialDispatch(PDO $pdo, int $postId, array $config, ?string $onlyChannel = null): array
{
    $social = is_array($config['social'] ?? null) ? $config['social'] : [];

    $post = avesmapsSocialLoadPost($pdo, $postId);
    if ($post === null) {
        return ['ok' => false, 'results' => []];
    }

    // THE KILL SWITCH (Entwurf §8). Off means nothing leaves, and every target SAYS so rather than
    // sitting at 'wartet' with no explanation. The probe is not exempt: "stoppt jedes Senden".
    $enabled = ($social['enabled'] ?? true) !== false;

    // The picture is probed ONCE, not per channel -- three HEAD requests for one file would be three
    // chances to hang a PHP worker on shared hosting.
    $mediaUrl = trim((string) ($post['media_url'] ?? ''));
    $absoluteMediaUrl = $mediaUrl === '' ? '' : avesmapsSocialAbsoluteUrl($mediaUrl);
    $mediaReachable = $mediaUrl === '' ? true : avesmapsSocialMediaIsReachable($absoluteMediaUrl);

    $hashtags = avesmapsSocialNormalizeHashtags((string) ($post['hashtags'] ?? ''));
    // ONE read for every channel's token, before the loop -- not one per adapter. Same reason as the
    // single picture probe above: this is a request on shared hosting, not a batch job.
    $tokenRows = avesmapsSocialTokenMap($pdo);
    $results = [];

    foreach ($post['targets'] as $target) {
        $key = (string) $target['channel_key'];
        if ($onlyChannel !== null && $key !== $onlyChannel) {
            continue;
        }
        // Already sent stays sent. Re-running a whole post must never post twice to a channel that
        // succeeded -- on Instagram that is a duplicate which cannot be edited away, only deleted.
        // A deliberate single-channel retry may re-attempt; that is the editor's explicit choice.
        if ($onlyChannel === null && (string) $target['status'] === 'sent') {
            continue;
        }

        $channel = avesmapsSocialChannel($key);
        if ($channel === null) {
            $results[$key] = ['status' => 'failed', 'error' => 'Unbekannter Kanal.'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        if (!$enabled) {
            $results[$key] = ['status' => 'failed',
                'error' => 'Das Senden ist serverseitig abgeschaltet (social.enabled = false).'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        $composed = avesmapsSocialCompose((string) $post['body'], $hashtags, $channel);
        $refusal = avesmapsSocialCheckTarget($post, $channel, $composed['caption']);
        if ($refusal !== null) {
            $results[$key] = ['status' => 'failed', 'error' => $refusal];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        if (!$mediaReachable) {
            $results[$key] = ['status' => 'failed', 'error' =>
                'Das Bild war unter ' . $absoluteMediaUrl . ' nicht erreichbar. Es wurde nichts '
                . 'gesendet — sonst merkt sich das Netz den Fehlschlag und das Bild bleibt für immer leer.'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        $adapter = avesmapsSocialAdapterFor($key);
        if ($adapter === null) {
            $results[$key] = ['status' => 'failed',
                'error' => $channel['label'] . ' ist noch nicht eingerichtet.'];
            avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
            continue;
        }

        try {
            $outcome = $adapter(
                $post,
                $channel,
                $composed['caption'],
                $absoluteMediaUrl,
                // Die offene Verbindung liegt bei, statt dass ein Adapter sich eine eigene holt: der
                // Kanal „Neuigkeiten" schreibt in unsere EIGENE Datenbank (`changelog_entry`), nicht
                // an ein fremdes Netz. Additiv angehängt, damit avesmapsSocialAdapterContext seine
                // drei Argumente behält -- die Netz-Adapter brauchen kein PDO und sollen keins sehen.
                avesmapsSocialAdapterContext($social, $tokenRows, $key) + ['pdo' => $pdo]
            );
        } catch (Throwable) {
            // An adapter that throws must not take the other channels down with it, and its exception
            // text must not reach the client verbatim (AGENTS.md §10, information disclosure).
            $outcome = ['ok' => false, 'error' => 'Der Kanal hat unerwartet abgebrochen.'];
        }

        $results[$key] = ($outcome['ok'] ?? false) === true
            ? [
                'status' => 'sent',
                'remote_id' => (string) ($outcome['remote_id'] ?? ''),
                'error' => '',
                'sent_payload' => $outcome['payload'] ?? null,
            ]
            : ['status' => 'failed', 'error' => (string) ($outcome['error'] ?? 'Unbekannter Fehler.')];
        avesmapsSocialUpdateTarget($pdo, $postId, $key, $results[$key]);
    }

    // ok means "the run completed", NOT "everything was sent". The per-channel truth lives in results;
    // collapsing it into one boolean is exactly the swallowing §2.2 forbids.
    return ['ok' => true, 'results' => $results];
}

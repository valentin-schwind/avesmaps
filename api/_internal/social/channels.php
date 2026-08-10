<?php

declare(strict_types=1);

// The channel registry: everything about a network that is NOT a credential (Entwurf §3).
//
// Declarative on purpose. A new network is an entry here plus an adapter -- not a rebuild -- and the
// UI renders whatever stands here, INCLUDING the entries nobody can use yet: a channel without
// access is shown greyed out, never hidden. Whoever looks at the hub should learn what would be
// possible, not silently see a shorter list.
//
// 🔴 CREDENTIALS ARE NOT HERE. They live in api/config.local.php under 'social' (account ids, app
// secrets, the endpoints' own app_token) and -- for the rotating access token -- in the `social_token`
// table, because a token the server refreshes by itself cannot live in a hand-edited PHP file
// (owner decision 2026-08-10). Everything in this file is safe to render into the browser.
//
// 💣 max_hashtags === null means ALL, not "many". Instagram takes every tag; writing 30 here would be
// a limit nobody imposed, and the composer would silently truncate the editor's tags.

/**
 * @var array<string, array{label: string, account: string, max_chars: int|null,
 *      max_hashtags: int|null, requires_media: bool, clickable_links: bool}>
 */
const AVESMAPS_SOCIAL_CHANNELS = [
    // The rehearsal channel (Entwurf §10). It runs the ENTIRE chain -- licence gate, JPEG conversion,
    // crop, storage, reachability probe, per-channel composition, status write -- and then, instead of
    // calling a network, records what it would have sent.
    //
    // Its character and hashtag limits are the STRICTEST of the real channels (Mastodon's 500,
    // Facebook's two), so a post that passes the probe passes everywhere. requires_media stays FALSE
    // on purpose, unlike Instagram: the probe must be able to rehearse a text-only post as well, and
    // the picture path is exercised simply by attaching one.
    'probe' => [
        'label' => 'Probe',
        'account' => 'nur intern — sendet nichts',
        'max_chars' => 500,
        'max_hashtags' => 2,
        'requires_media' => false,
        'clickable_links' => true,
    ],
    'instagram' => [
        'label' => 'Instagram',
        'account' => '@avesmaps',
        'max_chars' => 2200,
        'max_hashtags' => null,
        'requires_media' => true,
        'clickable_links' => false,
    ],
    'facebook' => [
        'label' => 'Facebook',
        'account' => 'Seite Avesmaps',
        'max_chars' => 63206,
        'max_hashtags' => 2,
        'requires_media' => false,
        'clickable_links' => true,
    ],
    'mastodon' => [
        'label' => 'Mastodon',
        'account' => 'noch kein Konto',
        'max_chars' => 500,
        'max_hashtags' => 4,
        'requires_media' => false,
        'clickable_links' => true,
    ],
];

/**
 * @return array<string, mixed>|null The channel, or null for an unknown key. Never a default row --
 *   a typo must fail loudly, not post with invented limits.
 */
function avesmapsSocialChannel(string $key): ?array
{
    return AVESMAPS_SOCIAL_CHANNELS[$key] ?? null;
}

/** @return list<string> */
function avesmapsSocialChannelKeys(): array
{
    return array_keys(AVESMAPS_SOCIAL_CHANNELS);
}

/**
 * Does this channel have a way to reach its network?
 *
 * @param array<string, mixed> $socialConfig The 'social' block of config.local.php.
 * @param list<string>         $tokenKeys    Channel keys that have a row in `social_token`.
 */
function avesmapsSocialChannelIsConfigured(string $key, array $socialConfig, array $tokenKeys): bool
{
    if (avesmapsSocialChannel($key) === null) {
        return false;
    }
    // The probe needs nothing -- that IS its purpose (Entwurf §10).
    if ($key === 'probe') {
        return true;
    }

    $entry = is_array($socialConfig[$key] ?? null) ? $socialConfig[$key] : [];
    // A stored token row counts as access on its own: the refreshed token lives in the database, and
    // config.local.php then only carries the account id.
    $hasToken = in_array($key, $tokenKeys, true)
        || trim((string) ($entry['access_token'] ?? '')) !== '';
    if (!$hasToken) {
        return false;
    }

    // Beyond the token, each network needs the thing it is ADDRESSED BY. A token without it reaches
    // nobody, and finding that out at publish time means a post that failed in public.
    return match ($key) {
        'instagram' => trim((string) ($entry['user_id'] ?? '')) !== '',
        'facebook' => trim((string) ($entry['page_id'] ?? '')) !== '',
        'mastodon' => trim((string) ($entry['base_url'] ?? '')) !== '',
        default => false,
    };
}

/**
 * The list the editor panel renders: every channel with its limits, and whether it can be used.
 *
 * 🔴 Carries NO credential -- this travels to the client. The eight keys below are pinned by
 * channels-test.php precisely so that a field added here cannot reach the browser unnoticed.
 *
 * @param array<string, mixed> $socialConfig
 * @param list<string>         $tokenKeys
 * @return list<array<string, mixed>>
 */
function avesmapsSocialChannelList(array $socialConfig, array $tokenKeys): array
{
    $list = [];
    foreach (AVESMAPS_SOCIAL_CHANNELS as $key => $channel) {
        $list[] = [
            'key' => $key,
            'label' => $channel['label'],
            'account' => $channel['account'],
            'max_chars' => $channel['max_chars'],
            'max_hashtags' => $channel['max_hashtags'],
            'requires_media' => $channel['requires_media'],
            'clickable_links' => $channel['clickable_links'],
            'configured' => avesmapsSocialChannelIsConfigured($key, $socialConfig, $tokenKeys),
        ];
    }

    return $list;
}

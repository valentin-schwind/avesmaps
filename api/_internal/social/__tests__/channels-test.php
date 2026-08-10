<?php

declare(strict_types=1);

/**
 * Unit test for the channel registry. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/social/__tests__/channels-test.php
 *
 * What is worth guarding here is not the data (that is a table anyone can read) but the two rules
 * that decide what the editor SEES:
 *   1. A channel without credentials comes out configured=false -- it must never vanish from the
 *      list, and it must never come out true, because that would offer a publish button that fails.
 *   2. 'probe' is configured WITHOUT any credentials. That is the whole point of Stufe 1: the chain
 *      is exercisable before a single access token exists (Entwurf §10).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';

// ---- the registry itself -----------------------------------------------------------------------

assert(avesmapsSocialChannel('probe') !== null, 'the probe channel exists');
assert(avesmapsSocialChannel('instagram') !== null, 'instagram is registered even without access');
assert(avesmapsSocialChannel('bluesky') === null, 'an unknown key yields null, never a default row');

$instagram = avesmapsSocialChannel('instagram');
assert($instagram['requires_media'] === true, 'instagram without a picture is not a post');
assert($instagram['clickable_links'] === false, 'instagram has no clickable links -- the adapter must know');
assert($instagram['max_chars'] === 2200, 'instagram: 2200 characters');
assert($instagram['max_hashtags'] === null, 'instagram takes ALL hashtags -- null, not a large number');

$facebook = avesmapsSocialChannel('facebook');
assert($facebook['max_hashtags'] === 2, 'facebook: two hashtags, more reads as spam');
assert($facebook['clickable_links'] === true, 'facebook takes a link');

$mastodon = avesmapsSocialChannel('mastodon');
assert($mastodon['max_chars'] === 500, 'mastodon: 500 characters');
assert($mastodon['max_hashtags'] === 4, 'mastodon: four');

// Every entry carries every key. A row missing one would read as null downstream, and null means
// "no limit" -- a typo in the table would silently REMOVE a limit rather than break loudly.
foreach (avesmapsSocialChannelKeys() as $key) {
    $channel = avesmapsSocialChannel($key);
    foreach (['label', 'account', 'max_chars', 'max_hashtags', 'requires_media', 'clickable_links'] as $field) {
        assert(array_key_exists($field, $channel), $key . ' carries the field ' . $field);
    }
    assert(is_bool($channel['requires_media']), $key . ': requires_media is a real bool');
    assert(is_bool($channel['clickable_links']), $key . ': clickable_links is a real bool');
}

// ---- availability -------------------------------------------------------------------------------

// The probe needs NOTHING. This is the assertion that makes Stufe 1 testable at all.
assert(avesmapsSocialChannelIsConfigured('probe', [], []) === true,
    'the probe channel is configured out of the box -- no config, no token');

assert(avesmapsSocialChannelIsConfigured('instagram', [], []) === false,
    'no credentials, no instagram');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1']], []) === false,
    'a user id without a token is not access');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['access_token' => 't']], []) === false,
    'and a token without a user id addresses nobody');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1', 'access_token' => 't']], []) === true,
    'user id plus token is access');
// 🔴 The rotating token lives in the DATABASE (owner decision 2026-08-10), so a token ROW alone is
// enough on that side -- config.local.php then only ever carries the account id.
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1']], ['instagram']) === true,
    'a stored token row counts as access, that is where the refreshed token lives');

assert(avesmapsSocialChannelIsConfigured('facebook', ['facebook' => ['page_id' => '1', 'access_token' => 't']], []) === true,
    'facebook: page and token');
assert(avesmapsSocialChannelIsConfigured('facebook', ['facebook' => ['access_token' => 't']], []) === false,
    'a facebook token without a page addresses nobody');
assert(avesmapsSocialChannelIsConfigured('mastodon', ['mastodon' => ['base_url' => 'https://x', 'access_token' => 't']], []) === true,
    'mastodon: instance and token');
assert(avesmapsSocialChannelIsConfigured('mastodon', ['mastodon' => ['access_token' => 't']], []) === false,
    'a mastodon token without an instance addresses nobody');

// Whitespace is not a credential. '   ' passes a naive !== '' check and would show a channel as
// ready that cannot reach anything.
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '  ', 'access_token' => '  ']], []) === false,
    'whitespace is not a credential');

assert(avesmapsSocialChannelIsConfigured('nope', [], []) === false,
    'an unknown channel is never configured');
assert(avesmapsSocialChannelIsConfigured('nope', [], ['nope']) === false,
    'not even with a stray token row -- an unregistered key has no adapter and no limits');

// ---- the list the UI renders ----------------------------------------------------------------------

$list = avesmapsSocialChannelList([], []);
assert(count($list) === count(avesmapsSocialChannelKeys()),
    'EVERY channel is listed, including the ones without access -- greyed out, not hidden (Entwurf §3)');

$byKey = [];
foreach ($list as $row) {
    $byKey[$row['key']] = $row;
}
assert($byKey['probe']['configured'] === true, 'probe usable');
assert($byKey['facebook']['configured'] === false, 'facebook listed but not usable');
assert($byKey['facebook']['account'] !== '',
    'even an unconfigured channel says which account it WOULD be -- that is why it stays visible');
assert($byKey['instagram']['requires_media'] === true,
    'the limits travel to the client too: the hub greys instagram out until a picture is attached');

// 🔴 No secret may travel. This list is rendered into the editor panel.
foreach ($list as $row) {
    assert(!isset($row['access_token']), 'no access token ever leaves the server in the channel list');
    assert(!isset($row['app_secret']), 'no app secret either');
    assert(array_keys($row) === ['key', 'label', 'account', 'max_chars', 'max_hashtags',
        'requires_media', 'clickable_links', 'configured'],
        'the row carries exactly these eight keys -- a field added here reaches the browser');
}

// Config for one channel must not configure another.
$onlyMastodon = avesmapsSocialChannelList(['mastodon' => ['base_url' => 'https://x', 'access_token' => 't']], []);
$byKey = [];
foreach ($onlyMastodon as $row) {
    $byKey[$row['key']] = $row;
}
assert($byKey['mastodon']['configured'] === true, 'mastodon is configured');
assert($byKey['instagram']['configured'] === false, 'instagram is not, and does not borrow it');

fwrite(STDOUT, "channels-test: OK\n");

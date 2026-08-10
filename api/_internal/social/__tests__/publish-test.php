<?php

declare(strict_types=1);

/**
 * Unit test for the dispatch GATE and the probe adapter. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/publish-test.php
 *
 * avesmapsSocialDispatch itself needs a database and is verified live. What IS testable here -- and
 * is where a mistake goes PUBLIC -- is the pure gate that stands in front of every adapter:
 * avesmapsSocialCheckTarget. It answers one question, "may this post go to this channel", and it must
 * answer it in GERMAN, because the answer lands in the editor's list as the reason nothing went out.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../compose.php';
require __DIR__ . '/../publish.php';

$instagram = avesmapsSocialChannel('instagram');
$mastodon = avesmapsSocialChannel('mastodon');
$probe = avesmapsSocialChannel('probe');

// ---- the gate --------------------------------------------------------------------------------------

assert(avesmapsSocialCheckTarget(['media_url' => '/uploads/social/x.jpg'], $instagram, 'Hallo') === null,
    'picture present, text short: nothing speaks against it');

// 💣 Instagram without a picture is not a post. Catching it here rather than at the API means the
// editor learns it in the list, in words, instead of from an API error nobody reads.
$noMedia = avesmapsSocialCheckTarget(['media_url' => ''], $instagram, 'Hallo');
assert(is_string($noMedia) && $noMedia !== '', 'instagram without a picture is refused');
assert(mb_stripos($noMedia, 'bild') !== false, 'and the refusal says WHY, in German, naming the picture');
assert(mb_stripos($noMedia, 'Instagram') !== false, 'and names the channel, so a three-channel post is unambiguous');

assert(avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, 'Hallo') === null,
    'mastodon takes a text-only post');
assert(avesmapsSocialCheckTarget(['media_url' => ''], $probe, 'Hallo') === null,
    'so does the probe -- it must be able to rehearse a text-only post');
assert(avesmapsSocialCheckTarget([], $mastodon, 'Hallo') === null,
    'a post row without a media_url key at all is the same as an empty one, not a crash');

$tooLong = avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, str_repeat('x', 501));
assert(is_string($tooLong), '501 characters against mastodon is refused');
assert(mb_strpos($tooLong, '500') !== false,
    'and it names the LIMIT -- "zu lang" without a number tells the editor nothing about how much to cut');
assert(mb_strpos($tooLong, '501') !== false, 'and the actual length, so the difference is visible');
assert(avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, str_repeat('x', 500)) === null,
    'exactly 500 passes -- the boundary is inclusive, same as in the composer');

assert(avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, '') !== null,
    'an empty caption is refused: an empty public post is never what anyone meant');
assert(avesmapsSocialCheckTarget(['media_url' => ''], $mastodon, "   \n  ") !== null,
    'and whitespace is empty too');

// The gate is about the CHANNEL, not about the text: the same caption that fails on mastodon passes
// on instagram, which is exactly why the check runs per target rather than once per post.
assert(avesmapsSocialCheckTarget(['media_url' => '/uploads/social/x.jpg'], $instagram, str_repeat('x', 501)) === null,
    'the same 501 characters are fine on instagram');

// ---- the probe adapter -------------------------------------------------------------------------------

$result = avesmapsSocialAdapterProbe(
    ['media_url' => '/uploads/social/x.jpg', 'media_license' => 'own_work'],
    $probe,
    "Hallo\n\n#DSA",
    'https://avesmaps.de/uploads/social/x.jpg'
);
assert($result['ok'] === true, 'the probe always succeeds -- it is a rehearsal, not a network');
assert(str_starts_with((string) $result['remote_id'], 'probe-'),
    'its remote id is MARKED as synthetic, so nobody goes looking for that post on Instagram');
assert(isset($result['payload']) && $result['payload'] !== '',
    'and it RECORDS what it would have sent -- that is the whole point (Entwurf §10)');

$payload = json_decode((string) $result['payload'], true);
assert(is_array($payload), 'the record is JSON, so the panel can render it');
assert(($payload['caption'] ?? '') === "Hallo\n\n#DSA",
    'the recorded caption is the FINAL one, hashtags already folded in -- recording the raw input '
    . 'would prove nothing about what a network would receive');
assert(($payload['media_url'] ?? '') === 'https://avesmaps.de/uploads/social/x.jpg',
    'and the ABSOLUTE url, because that is the string a real network is handed');
assert(($payload['caption_chars'] ?? 0) === mb_strlen("Hallo\n\n#DSA"),
    'the length travels too, measured on the final caption');
assert(($payload['media_license'] ?? '') === 'own_work', 'and the licence the editor claimed');

// Two rehearsals must not collide in the list.
$second = avesmapsSocialAdapterProbe([], $probe, 'x', '');
assert($second['remote_id'] !== $result['remote_id'], 'every rehearsal gets its own id');

// ---- the adapter registry ------------------------------------------------------------------------------

assert(is_callable(avesmapsSocialAdapterFor('probe')), 'the probe has an adapter');
// 🔴 A missing adapter is NULL, never a silent no-op that reports success. A no-op would mark
// Instagram "gesendet" with nothing on Instagram -- the single worst failure mode this design exists
// to avoid, and the one nobody would ever catch by looking at the panel.
assert(avesmapsSocialAdapterFor('instagram') === null,
    'instagram has NO adapter yet (Stufe 2) -- and says so by being null');
assert(avesmapsSocialAdapterFor('facebook') === null, 'nor facebook');
assert(avesmapsSocialAdapterFor('mastodon') === null, 'nor mastodon');
assert(avesmapsSocialAdapterFor('nope') === null, 'an unknown key has none either');

fwrite(STDOUT, "publish-test: OK\n");

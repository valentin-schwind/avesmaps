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
assert(is_callable(avesmapsSocialAdapterFor('facebook')), 'and facebook, live since 10.08.2026');
// 🔴 A missing adapter is NULL, never a silent no-op that reports success. A no-op would mark
// Instagram "gesendet" with nothing on Instagram -- the single worst failure mode this design exists
// to avoid, and the one nobody would ever catch by looking at the panel.
assert(avesmapsSocialAdapterFor('instagram') === null,
    'instagram has NO adapter yet (Stufe 2) -- and says so by being null');
assert(avesmapsSocialAdapterFor('mastodon') === null, 'nor mastodon');
assert(avesmapsSocialAdapterFor('nope') === null, 'an unknown key has none either');

// ---- the adapter context ---------------------------------------------------------------------------

// 🔴 The stored token beats the configured one. config.local.php holds what never changes, the table
// holds what rotates -- if the config won, a renewal would silently have no effect and the channel
// would die weeks later, on the day the old token expires.
$context = avesmapsSocialAdapterContext(
    ['facebook' => ['page_id' => '123', 'access_token' => 'aus-der-config']],
    ['facebook' => 'aus-der-datenbank'],
    'facebook'
);
assert($context['access_token'] === 'aus-der-datenbank', 'the database wins over the config');
assert(($context['settings']['page_id'] ?? '') === '123', 'and the settings travel along');

$fallback = avesmapsSocialAdapterContext(
    ['facebook' => ['access_token' => 'aus-der-config']],
    [],
    'facebook'
);
assert($fallback['access_token'] === 'aus-der-config',
    'without a stored row the configured token is used -- otherwise a channel could never be tried '
    . 'before the table exists');
assert(avesmapsSocialAdapterContext([], [], 'facebook')['access_token'] === '',
    'and nothing configured is the empty string, not null -- the adapter refuses on it by name');

// ---- facebook: which endpoint, which fields --------------------------------------------------------

$withPicture = avesmapsSocialFacebookRequest('9876', 'Hallo Aventurien', 'https://avesmaps.de/uploads/social/x.jpg');
assert($withPicture['endpoint'] === 'photos', 'a post WITH a picture goes to /photos');
assert(str_ends_with($withPicture['url'], '/9876/photos'), 'addressed by PAGE ID');
assert(($withPicture['fields']['url'] ?? '') === 'https://avesmaps.de/uploads/social/x.jpg',
    'meta LOADS the picture from the absolute url; it cannot be attached');
// 💣 On /photos the text field is `caption`. `message` is accepted there and silently DROPPED -- the
// picture would appear without a word of the editor's text and nothing would report an error.
assert(($withPicture['fields']['caption'] ?? '') === 'Hallo Aventurien', 'and the text is CAPTION');
assert(!isset($withPicture['fields']['message']), 'never `message` on /photos');

$textOnly = avesmapsSocialFacebookRequest('9876', 'Nur Text', '');
assert($textOnly['endpoint'] === 'feed', 'a post without a picture goes to /feed');
assert(str_ends_with($textOnly['url'], '/9876/feed'), 'also addressed by page id');
// ... and there it is `message`. The asymmetry is Meta's, and it is the whole reason this split is
// tested rather than eyeballed.
assert(($textOnly['fields']['message'] ?? '') === 'Nur Text', 'and the text is MESSAGE');
assert(!isset($textOnly['fields']['caption']) && !isset($textOnly['fields']['url']),
    'no caption and no picture url on /feed');

// 🔴 NEVER /me. With a user token /me/feed publishes on the owner's PRIVATE profile, publicly, under
// their own name -- the one failure this adapter must make structurally impossible.
assert(mb_strpos($withPicture['url'], '/me/') === false && mb_strpos($textOnly['url'], '/me/') === false,
    'no request ever addresses /me');

// 💣 The token is added at the moment of sending, never here -- a url carrying it lands in server logs
// and in every error text, and a leaked page token posts as Avesmaps until it is manually revoked.
assert(mb_strpos($withPicture['url'], 'access_token') === false, 'the url carries no token');
assert(!isset($withPicture['fields']['access_token']) && !isset($textOnly['fields']['access_token']),
    'and the pure request half does not even know one');

// 💣 The version is PINNED. An unversioned url follows whatever Meta currently defaults to, so their
// change becomes ours without a deploy.
assert(mb_strpos($withPicture['url'], '/' . AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION . '/') !== false,
    'the pinned graph version stands in the url');
assert(mb_strpos(avesmapsSocialFacebookRequest('1', 'x', '', 'v99.0')['url'], '/v99.0/') !== false,
    'and a configured version overrides it, so a bump is a config edit, not a deploy');

// ---- facebook: reading the answer ------------------------------------------------------------------

$ok = avesmapsSocialFacebookReadResponse(200, '{"id":"111"}');
assert(($ok['ok'] ?? false) === true && ($ok['remote_id'] ?? '') === '111', 'an id means sent');

// 💣 post_id BEFORE id: /photos answers with both, and `id` is the PHOTO. Storing it would leave the
// list holding an id that neither opens nor deletes the visible post.
$photo = avesmapsSocialFacebookReadResponse(200, '{"id":"777","post_id":"9876_54321"}');
assert(($photo['remote_id'] ?? '') === '9876_54321', 'the POST id wins over the photo id');

// Fails closed, three ways -- an unknown state is never "gesendet" (Entwurf §2.2).
$noId = avesmapsSocialFacebookReadResponse(200, '{}');
assert(($noId['ok'] ?? true) === false, 'HTTP 200 without an id is NOT sent');
assert(($noId['error'] ?? '') !== '', 'and says so');
assert((avesmapsSocialFacebookReadResponse(200, '<html>oops</html>')['ok'] ?? true) === false,
    'a 200 that is not JSON is not sent either');
assert((avesmapsSocialFacebookReadResponse(500, '')['ok'] ?? true) === false, 'nor is an HTTP 500');

// The error object is checked FIRST and regardless of the status: a 200 carrying one is a failure.
$errorOn200 = avesmapsSocialFacebookReadResponse(200, '{"error":{"message":"Kaputt","code":1}}');
assert(($errorOn200['ok'] ?? true) === false, 'an error object beats the status code');

$expired = avesmapsSocialFacebookReadResponse(400,
    '{"error":{"message":"Error validating access token","code":190}}');
assert(($expired['ok'] ?? true) === false, 'code 190 is a failure');
assert(mb_strpos((string) $expired['error'], 'Error validating access token') !== false,
    "meta's own text travels through -- hiding it turns a five-minute fix into an hour of guessing");
assert(mb_strpos((string) $expired['error'], 'social_token') !== false,
    'and code 190 names the ROW to replace, which meta’s message never does');

$forbidden = avesmapsSocialFacebookReadResponse(403,
    '{"error":{"message":"Permissions error","code":200}}');
assert(mb_strpos((string) $forbidden['error'], 'CREATE_CONTENT') !== false,
    'and code 200 names the page task, the actual cause behind "Permissions error"');

// ---- facebook: the two refusals that need no network ------------------------------------------------

$noPage = avesmapsSocialAdapterFacebook([], avesmapsSocialChannel('facebook'), 'Hallo', '',
    ['settings' => [], 'access_token' => 'x']);
assert(($noPage['ok'] ?? true) === false, 'without a page id nothing is sent');
assert(mb_strpos((string) $noPage['error'], 'page_id') !== false,
    'and the refusal names the config key -- "nicht eingerichtet" would be true and useless');

$noToken = avesmapsSocialAdapterFacebook([], avesmapsSocialChannel('facebook'), 'Hallo', '',
    ['settings' => ['page_id' => '9876'], 'access_token' => '']);
assert(($noToken['ok'] ?? true) === false, 'and without a token nothing is sent');
assert(mb_strpos((string) $noToken['error'], 'social_token') !== false,
    'naming the TABLE this time: the two halves live in two places, and which one is missing is the '
    . 'whole question');

fwrite(STDOUT, "publish-test: OK\n");

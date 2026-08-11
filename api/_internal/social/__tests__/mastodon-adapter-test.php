<?php

declare(strict_types=1);

/**
 * Unit test for the Mastodon adapter. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/mastodon-adapter-test.php
 *
 * The HTTP halves need an instance and are verified live. What IS testable here -- and is where a
 * mistake goes PUBLIC or silently swallows a failure -- are the pure halves: which address is built
 * from a hand-typed configuration value, which fields the status carries, and how each of Mastodon's
 * answer shapes is read.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../compose.php';
require __DIR__ . '/../publish.php';

$mastodon = avesmapsSocialChannel('mastodon');

// ---- the instance address --------------------------------------------------------------------------

assert(avesmapsSocialMastodonBaseUrl('https://rollenspiel.social') === 'https://rollenspiel.social',
    'the plain instance address survives unchanged');
assert(avesmapsSocialMastodonBaseUrl('https://rollenspiel.social/') === 'https://rollenspiel.social',
    'a trailing slash is dropped -- otherwise every url would carry a double slash');
assert(avesmapsSocialMastodonBaseUrl('rollenspiel.social') === 'https://rollenspiel.social',
    'a bare host is what people type, and it gets the scheme it needs');
assert(avesmapsSocialMastodonBaseUrl('  rollenspiel.social  ') === 'https://rollenspiel.social',
    'and surrounding whitespace from a copy-paste is trimmed');

// 💣 THE INSTANCE, NOT THE PROFILE. The address in the browser's bar is the profile page, and it is the
// obvious thing to paste. Keeping the path would build …/@Avesmaps/api/v1/statuses -> 404, and the
// refusal would then blame the token.
assert(avesmapsSocialMastodonBaseUrl('https://rollenspiel.social/@Avesmaps') === 'https://rollenspiel.social',
    'the profile path is stripped: base_url is the INSTANCE');
assert(avesmapsSocialMastodonBaseUrl('https://rollenspiel.social/@Avesmaps/117073953417022480')
    === 'https://rollenspiel.social', 'a deep link to a single toot is stripped too');

// 💣 http is upgraded. A bearer token over a clear connection is a leaked token.
assert(avesmapsSocialMastodonBaseUrl('http://rollenspiel.social') === 'https://rollenspiel.social',
    'http becomes https -- a token must never travel unencrypted');

assert(avesmapsSocialMastodonBaseUrl('') === '', 'nothing configured is the empty string');
assert(avesmapsSocialMastodonBaseUrl('   ') === '', 'and so is whitespace');
assert(avesmapsSocialMastodonBaseUrl('https://') === '',
    'a scheme without a host is nothing usable, not a half-built url');

// ---- joining a path ---------------------------------------------------------------------------------

assert(avesmapsSocialMastodonUrl('https://rollenspiel.social', '/api/v1/statuses')
    === 'https://rollenspiel.social/api/v1/statuses', 'base and path join with exactly one slash');
assert(avesmapsSocialMastodonUrl('https://rollenspiel.social/', 'api/v1/statuses')
    === 'https://rollenspiel.social/api/v1/statuses',
    'and neither a trailing nor a missing leading slash changes that');

// 💣 The token never travels in the address. Mastodon accepts ?access_token=… exactly like Graph does,
// and a query string lands in server logs and in every error text.
assert(mb_strpos(avesmapsSocialMastodonUrl('https://rollenspiel.social', '/api/v1/statuses'),
    'access_token') === false, 'no url this adapter builds carries a token');

// ---- the retry guard ---------------------------------------------------------------------------------

$key = avesmapsSocialMastodonIdempotencyKey(42);
assert($key !== '', 'a post has an idempotency key');
assert(avesmapsSocialMastodonIdempotencyKey(42) === $key,
    'and it is STABLE: the same post yields the same key on every attempt -- that is the whole point, '
    . 'because a retry must be recognised as a repeat rather than create a second toot');
assert(avesmapsSocialMastodonIdempotencyKey(43) !== $key,
    'while a different post gets a different one, or the second post ever would return the first');

// ---- the picture description ---------------------------------------------------------------------------

assert(avesmapsSocialMastodonDescription(['media_alt' => 'Karte des Bornlands'])
    === 'Karte des Bornlands', 'the description comes from media_alt');
assert(avesmapsSocialMastodonDescription(['media_alt' => '  Karte  ']) === 'Karte', 'trimmed');

// ⚠️ Empty stays empty. Falling back to the post's own text would read the same sentence to a screen
// reader twice -- worse than the honest "no description" marker Mastodon shows by itself.
assert(avesmapsSocialMastodonDescription(['media_alt' => '', 'body' => 'Der Beitragstext']) === '',
    'an empty description stays empty and is NOT filled from the post text');
assert(avesmapsSocialMastodonDescription([]) === '',
    'a post row without the key at all is the same as an empty one, not a crash');
assert(mb_strlen(avesmapsSocialMastodonDescription(['media_alt' => str_repeat('x', 2000)]))
    === AVESMAPS_SOCIAL_MASTODON_DESCRIPTION_MAX, 'and it is capped at Mastodons own ceiling');

// ---- the status body ------------------------------------------------------------------------------------

$textOnly = avesmapsSocialMastodonStatusFields('Hallo Aventurien', '');
assert(($textOnly['status'] ?? '') === 'Hallo Aventurien', 'the caption travels as `status`');
assert(($textOnly['language'] ?? '') === 'de',
    'and the language is stated, so language filters put the post in the right bucket');
assert(!isset($textOnly['media_ids']), 'a text-only post carries no media_ids at all');

$withPicture = avesmapsSocialMastodonStatusFields('Mit Bild', '7');
assert(($withPicture['media_ids'] ?? null) === ['7'], 'a picture travels as a LIST of ids');

// 💣 JSON, not a form encoding. http_build_query would write media_ids[0]=7, which Rack parses into a
// HASH keyed "0" -- and Mastodon rejects that. The encoded body must show a JSON ARRAY.
$encoded = (string) json_encode($withPicture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
assert(mb_strpos($encoded, '"media_ids":["7"]') !== false,
    'and it encodes as a JSON array, not as an object keyed "0"');

// 💣 The description belongs to the UPLOAD, not to the status. /api/v1/statuses has no such field;
// sending it there is accepted and dropped, and the picture arrives marked as undescribed.
assert(!isset($withPicture['description']),
    'the status body carries NO description -- it rides along with the attachment');
assert(!isset($withPicture['access_token']) && !isset($textOnly['access_token']),
    'and the pure half does not even know a token');

// ---- reading the media answer ---------------------------------------------------------------------------

$ready = avesmapsSocialMastodonReadMedia(200, '{"id":"110","type":"image"}');
assert(($ready['ok'] ?? false) === true && ($ready['media_id'] ?? '') === '110', '200 means uploaded');
assert(($ready['pending'] ?? true) === false, 'and ready to be attached');

// 💣 202 IS NEITHER. Mastodon is still processing; attaching the id now earns a 422 whose text is about
// the STATUS, not about the picture -- so the caller has to know to wait.
$pending = avesmapsSocialMastodonReadMedia(202, '{"id":"111"}');
assert(($pending['ok'] ?? false) === true && ($pending['media_id'] ?? '') === '111',
    '202 still yields the id');
assert(($pending['pending'] ?? false) === true, 'but it is marked PENDING, not ready');

assert((avesmapsSocialMastodonReadMedia(200, '{}')['ok'] ?? true) === false,
    'a 200 without an id is not an upload');
assert((avesmapsSocialMastodonReadMedia(200, '<html>nope</html>')['ok'] ?? true) === false,
    'nor is a 200 that is not JSON');
$mediaError = avesmapsSocialMastodonReadMedia(422, '{"error":"File type not allowed"}');
assert(($mediaError['ok'] ?? true) === false, 'and a 422 is a failure');
assert(mb_strpos((string) $mediaError['error'], 'File type not allowed') !== false,
    "the instance's own words travel through -- they ARE the diagnosis");

// ---- reading the status answer --------------------------------------------------------------------------

$sent = avesmapsSocialMastodonReadStatus(200, '{"id":"999","url":"https://rollenspiel.social/@Avesmaps/999"}');
assert(($sent['ok'] ?? false) === true, 'an id means sent');
assert(($sent['remote_id'] ?? '') === '999',
    'and the STATUS id is stored, not the url -- the url derives from the id, not the other way round');

// 💣 MASTODON REPORTS ERRORS AS A STRING. Facebook answers {"error":{...}}; copying that reader would let
// is_array($data['error']) miss every failure here, and the answer would fall through to "no id" --
// losing the diagnosis on the way. Both shapes are checked apart, and this is the assert that proves it.
$refused = avesmapsSocialMastodonReadStatus(422,
    '{"error":"Validation failed: Text character limit of 500 exceeded"}');
assert(($refused['ok'] ?? true) === false, 'a string error is recognised as a failure');
assert(mb_strpos((string) $refused['error'], 'Text character limit of 500 exceeded') !== false,
    "and Mastodon's own sentence travels through");
assert(mb_strpos((string) $refused['error'], '23 Zeichen') !== false,
    'a 422 also names the url-counting rule, which Mastodons message never mentions');

$onTwoHundred = avesmapsSocialMastodonReadStatus(200, '{"error":"Something went wrong"}');
assert(($onTwoHundred['ok'] ?? true) === false,
    'an error field beats the status code: a 200 carrying one is still a failure');
// ⚠️ „ok === false" allein beweist hier NICHTS: ohne die Fehlerpruefung faellt die Antwort in den
// „keine id"-Zweig und ist ZUFAELLIG ebenfalls false -- nur mit dem falschen Satz. Genau diese Mutation
// ueberlebte die Pruefung am 11.08.2026. Beweiskraeftig ist deshalb der TEXT: Mastodons eigene Worte.
assert(mb_strpos((string) $onTwoHundred['error'], 'Something went wrong') !== false,
    'and it carries Mastodons OWN words -- falling through to "keine id" would answer false with a '
    . 'sentence that hides the actual reason');

$unauthorised = avesmapsSocialMastodonReadStatus(401, '{"error":"The access token is invalid"}');
assert(($unauthorised['ok'] ?? true) === false, '401 is a failure');
assert(mb_strpos((string) $unauthorised['error'], 'access_token') !== false,
    'and it names the config key to replace, which the instance never does');

$forbidden = avesmapsSocialMastodonReadStatus(403, '{"error":"This action is outside the authorized scopes"}');
assert(mb_strpos((string) $forbidden['error'], 'write:statuses') !== false,
    '403 names the two scopes the application needs -- the actual cause behind "scopes"');

$notFound = avesmapsSocialMastodonReadStatus(404, '{"error":"Record not found"}');
assert(mb_strpos((string) $notFound['error'], 'base_url') !== false,
    '404 points at the instance address, because that is what is wrong when the API is not there');

// Fails CLOSED, three ways -- an unknown state is never "gesendet" (Entwurf §2.2).
$noId = avesmapsSocialMastodonReadStatus(200, '{}');
assert(($noId['ok'] ?? true) === false, 'HTTP 200 without an id is NOT sent');
assert(($noId['error'] ?? '') !== '', 'and says so');
assert((avesmapsSocialMastodonReadStatus(200, 'not json at all')['ok'] ?? true) === false,
    'a 200 that is not JSON is not sent either');
assert((avesmapsSocialMastodonReadStatus(500, '')['ok'] ?? true) === false, 'nor is an HTTP 500');

// ---- the two refusals that need no network ----------------------------------------------------------------

$noBase = avesmapsSocialAdapterMastodon([], $mastodon, 'Hallo', '',
    ['settings' => [], 'access_token' => 'x']);
assert(($noBase['ok'] ?? true) === false, 'without an instance address nothing is sent');
assert(mb_strpos((string) $noBase['error'], 'base_url') !== false,
    'and the refusal names the config key -- "nicht eingerichtet" would be true and useless');

$noToken = avesmapsSocialAdapterMastodon([], $mastodon,
    'Hallo', '', ['settings' => ['base_url' => 'https://rollenspiel.social'], 'access_token' => '']);
assert(($noToken['ok'] ?? true) === false, 'and without a token nothing is sent');
assert(mb_strpos((string) $noToken['error'], 'access_token') !== false,
    'naming the OTHER half this time: which of the two is missing is the whole question');

// ---- the register and the registry ---------------------------------------------------------------------------

assert(is_callable(avesmapsSocialAdapterFor('mastodon')),
    'mastodon HAS an adapter now -- live since 11.08.2026');
// 🔴 A missing adapter stays NULL, never a silent no-op that reports success.
assert(avesmapsSocialAdapterFor('nope') === null, 'an unknown key still has none');

// 💣 The character limit is INSTANCE-SPECIFIC and therefore MEASURED. 500 is what
// rollenspiel.social/api/v2/instance answered on 11.08.2026; other instances run 1 500 or 5 000.
assert(($mastodon['max_chars'] ?? null) === 500,
    'the register carries the measured limit of the configured instance');
assert(($mastodon['max_hashtags'] ?? null) === 4, 'and four hashtags');
assert(($mastodon['requires_media'] ?? true) === false, 'a text-only toot is a toot');
assert(($mastodon['shows_media'] ?? false) === true, 'but a picture arrives, so the hub may promise it');
assert(mb_strpos((string) ($mastodon['account'] ?? ''), 'rollenspiel.social') !== false,
    'and the account line names the real handle, not "noch kein Konto"');

fwrite(STDOUT, "mastodon-adapter-test: OK\n");

<?php

declare(strict_types=1);

/**
 * Unit test for the Instagram adapter's PURE halves. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/instagram-adapter-test.php
 *
 * Instagram is the only channel that publishes in TWO steps, and that is the whole reason this file
 * exists: between "the container was accepted" and "the post is public" there is a gap in which
 * everything can still fail, and a run that stops in that gap has published NOTHING. Every assert
 * below defends the same sentence -- "gesendet" in the editor's list means something is publicly
 * visible (Entwurf §2.2) -- against a different way of getting it wrong.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../adapters/facebook.php';
require __DIR__ . '/../adapters/instagram.php';

$igId = '17841434373040202';

// ---- step 1: the container request -----------------------------------------------------------------

$container = avesmapsSocialInstagramContainerRequest($igId, 'Hallo Aventurien', 'https://avesmaps.de/uploads/social/a.jpg');

assert(str_contains($container['url'], '/' . $igId . '/media'),
    'the container is created on the IG user node, addressed by its id');
assert(!str_contains($container['url'], '/media_publish'),
    'step 1 is /media, NOT /media_publish -- swapping the two publishes nothing and reports no error');
assert(str_starts_with($container['url'], 'https://graph.facebook.com/'),
    'the PAGE path speaks graph.facebook.com; graph.instagram.com belongs to the rejected Instagram-Login way (Entwurf §12.1)');

// 💣 image_url, NOT url. Facebook's /photos takes `url` -- the same picture, the same project, one
// field name apart. Sending `url` here is rejected outright, which is the lucky case; the unlucky one
// is a field Meta accepts and ignores.
assert(($container['fields']['image_url'] ?? null) === 'https://avesmaps.de/uploads/social/a.jpg',
    'the picture travels as image_url');
assert(!array_key_exists('url', $container['fields']),
    'and NOT as url -- that is Facebook /photos spelling, and this is not Facebook');
assert(($container['fields']['caption'] ?? null) === 'Hallo Aventurien',
    'the text travels as caption');
assert(!array_key_exists('message', $container['fields']),
    'and never as message -- that is the /feed spelling, silently dropped');

// 🔴 The token is added at the call site, in the body. If it ever appears in a request-building
// function it will end up in a URL, in a log, or in an error text.
foreach (['container' => $container['fields']] as $what => $fields) {
    assert(!array_key_exists('access_token', $fields), $what . ' carries no token: that is added last, into the body');
}
assert(!str_contains($container['url'], 'access_token'), 'and the url never carries one');

// ---- step 2: the publish request -------------------------------------------------------------------

$publish = avesmapsSocialInstagramPublishRequest($igId, '17999888777');

assert(str_contains($publish['url'], '/' . $igId . '/media_publish'),
    'step 2 publishes on the IG user node');
assert(($publish['fields']['creation_id'] ?? null) === '17999888777',
    'and carries the container id as creation_id');
assert(!array_key_exists('access_token', $publish['fields']), 'still no token in the built fields');

// The version is pinned and shared with Facebook -- same host, same app, same Graph. One place to bump.
assert(str_contains($container['url'], AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION),
    'the container url is version-pinned');
assert(str_contains(avesmapsSocialInstagramContainerRequest($igId, 'x', 'y', 'v99.0')['url'], 'v99.0'),
    'and the version is overridable, so a bump is a config edit rather than a deploy');

// ---- die KI-Kennzeichnung (Entwurf 2026-08-16-ki-kennzeichnung-design.md) --------------------------

$aiContainer = avesmapsSocialInstagramContainerRequest(
    $igId,
    'Mit KI',
    'https://avesmaps.de/uploads/social/a.jpg',
    AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION,
    true
);
// 💣 `is_ai_generated`, ein schlichtes Bool -- Facebook nimmt an derselben Stelle ein JSON-Objekt
// namens `provenance_info` mit zwei Pflichtfeldern. Dieselbe Sorte Asymmetrie wie image_url/url und
// caption/message: wer die eine Funktion von der anderen abschreibt, schickt ein Feld, das Meta
// still verwirft -- und der Beitrag erscheint trotzdem, nur eben unbeschriftet.
assert(($aiContainer['fields']['is_ai_generated'] ?? null) === 'true',
    'die Erklaerung heisst hier is_ai_generated');
assert(!isset($aiContainer['fields']['provenance_info']),
    'und NICHT provenance_info -- das ist Facebooks Schreibweise');

// 🔴 Ohne Haekchen gar nichts, kein 'false'. Dieselbe Regel wie bei Facebook.
assert(!isset($container['fields']['is_ai_generated']),
    'ohne Haekchen fehlt das Feld ganz, statt false zu behaupten');

// 💣 Sie gehoert an den BEHAELTER, nie an /media_publish -- dort ist sie unbekannt, und der Schritt,
// der den Beitrag wirklich oeffentlich macht, traegt ueberhaupt nur die creation_id.
assert(array_keys(avesmapsSocialInstagramPublishRequest($igId, '17999888777')['fields']) === ['creation_id'],
    'der Veroeffentlichen-Schritt traegt NUR die creation_id');

// ⚠️ Der Schalter ruehrt sonst nichts an.
assert(($aiContainer['fields']['image_url'] ?? '') === 'https://avesmaps.de/uploads/social/a.jpg'
    && ($aiContainer['fields']['caption'] ?? '') === 'Mit KI',
    'Bild und Text bleiben unveraendert');

// ---- reading step 1's answer -----------------------------------------------------------------------

$ok = avesmapsSocialInstagramReadContainer(200, '{"id":"17999888777"}');
assert(($ok['ok'] ?? false) === true, 'an id back means the container exists');
assert(($ok['creation_id'] ?? '') === '17999888777', 'and it is carried forward verbatim');

// 💣 THE CENTRAL ONE. A container is not a post. Every failure below must come back ok=false, because
// ok=true here would mark the channel "gesendet" while Instagram shows nothing.
$noId = avesmapsSocialInstagramReadContainer(200, '{"success":true}');
assert(($noId['ok'] ?? true) === false, 'HTTP 200 without an id is NOT a container');
assert(is_string($noId['error'] ?? null) && $noId['error'] !== '', 'and it says so');

assert((avesmapsSocialInstagramReadContainer(200, 'not json')['ok'] ?? true) === false,
    'a non-JSON body is a failure, not an empty success');
assert((avesmapsSocialInstagramReadContainer(200, '')['ok'] ?? true) === false,
    'an empty body likewise');
assert((avesmapsSocialInstagramReadContainer(400, '{"error":{"message":"Bad image","code":9004}}')['ok'] ?? true) === false,
    'an error object is a failure');

// An error object wins over a 2xx: Meta has answered 200 with an error body before.
$twoHundredError = avesmapsSocialInstagramReadContainer(200, '{"error":{"message":"nope","code":100},"id":"123"}');
assert(($twoHundredError['ok'] ?? true) === false,
    'an error object beats both the 200 AND an id sitting next to it');

// Meta's own words travel: they ARE the diagnosis (AGENTS.md §10 forbids leaking OUR traces, not theirs).
$spoken = avesmapsSocialInstagramReadContainer(400, '{"error":{"message":"The image is too large","code":9004}}');
assert(mb_strpos((string) $spoken['error'], 'The image is too large') !== false,
    "Meta's message is quoted, not replaced by 'Fehler beim Senden'");

// ---- reading step 2's answer -----------------------------------------------------------------------

$done = avesmapsSocialInstagramReadPublish(200, '{"id":"17888999000"}');
assert(($done['ok'] ?? false) === true && ($done['remote_id'] ?? '') === '17888999000',
    'the published post id comes back as the remote id');

assert((avesmapsSocialInstagramReadPublish(200, '{}')['ok'] ?? true) === false,
    'no id means not published -- the same rule as everywhere else');

// 💣 9007 IS THE ONE RETRYABLE ERROR, and it is retryable precisely because it PROVES nothing was
// published: Instagram has not finished processing the picture yet. Marking anything else retryable
// risks posting twice, and a duplicate on Instagram can only be deleted, never merged.
$notReady = avesmapsSocialInstagramReadPublish(400, '{"error":{"message":"Media ID is not available","code":9007}}');
assert(($notReady['ok'] ?? true) === false, '9007 is still a failure on its own');
assert(($notReady['retryable'] ?? false) === true, 'but it is the retryable kind');

$tokenDead = avesmapsSocialInstagramReadPublish(400, '{"error":{"message":"Session expired","code":190}}');
assert(($tokenDead['retryable'] ?? false) === false,
    '190 is NOT retryable -- retrying a dead token just costs three requests');
assert(mb_strpos((string) $tokenDead['error'], 'social_token') !== false,
    'and 190 names the row to replace, because its own wording never does');

$noRight = avesmapsSocialInstagramReadPublish(403, '{"error":{"message":"Permissions error","code":200}}');
assert(($noRight['retryable'] ?? false) === false, '200 is not retryable either');
assert(mb_strpos((string) $noRight['error'], 'instagram_content_publish') !== false,
    'and it names the missing right, which "Permissions error" does not');

assert((avesmapsSocialInstagramReadPublish(200, 'garbage')['retryable'] ?? false) === false,
    'an unparseable answer is never retried: we do not know whether it published');

// ---- the retry decision ----------------------------------------------------------------------------

assert(avesmapsSocialInstagramShouldRetryPublish($notReady, 1) === true, 'a 9007 on the first attempt is retried');
assert(avesmapsSocialInstagramShouldRetryPublish($notReady, AVESMAPS_SOCIAL_INSTAGRAM_PUBLISH_ATTEMPTS) === false,
    'but the last attempt is the last: the wait is CAPPED, because this runs inside a request on shared hosting');
assert(avesmapsSocialInstagramShouldRetryPublish($tokenDead, 1) === false, 'a non-retryable failure is never retried');
assert(avesmapsSocialInstagramShouldRetryPublish($done, 1) === false, 'and success is not retried at all');
assert(AVESMAPS_SOCIAL_INSTAGRAM_PUBLISH_ATTEMPTS >= 2, 'there IS a retry, otherwise 9007 has no answer');
assert(AVESMAPS_SOCIAL_INSTAGRAM_PUBLISH_ATTEMPTS <= 4,
    'and it is bounded -- every attempt holds a PHP worker (AGENTS.md §10, the pool incident)');

// ---- the refusals before any request goes out ------------------------------------------------------

$channel = avesmapsSocialChannel('instagram');

$noConfig = avesmapsSocialAdapterInstagram([], $channel, 'Text', 'https://avesmaps.de/a.jpg', ['settings' => [], 'access_token' => 't']);
assert(($noConfig['ok'] ?? true) === false, 'without the account id nothing is attempted');
assert(mb_strpos((string) $noConfig['error'], 'social.instagram.user_id') !== false,
    'and the refusal names the exact key -- which of the two halves is missing IS the question (Entwurf §12.3)');

$noToken = avesmapsSocialAdapterInstagram([], $channel, 'Text', 'https://avesmaps.de/a.jpg',
    ['settings' => ['user_id' => $igId], 'access_token' => '']);
assert(($noToken['ok'] ?? true) === false, 'without a token nothing is attempted');
assert(mb_strpos((string) $noToken['error'], 'social_token') !== false, 'and it names the table row');
assert(mb_strpos((string) $noToken['error'], 'user_id') === false,
    'and does NOT blame the key that is present -- a wrong pointer costs more than no pointer');

// 💣 The SECOND bolt on the picture. requires_media in the registry already stops this in
// avesmapsSocialCheckTarget -- but that is one data edit away from being false, and the failure it
// guards against is a public post. Two bolts, on purpose.
$noMedia = avesmapsSocialAdapterInstagram([], $channel, 'Text', '',
    ['settings' => ['user_id' => $igId], 'access_token' => 't']);
assert(($noMedia['ok'] ?? true) === false, 'no picture, no post -- the adapter refuses on its own');
// ⚠️ The wording is asserted PRECISELY, and that is not pedantry. Merely looking for "Bild" also
// matches Metas own rejection ("Instagram hat das Bild abgelehnt (Code …)"), so with the bolt removed
// the test stayed green -- and worse, it had then made a REAL request to Graph to get there. The
// refusal must be OUR sentence, recognisable by the fact that it carries no Graph error code.
assert(mb_strpos((string) $noMedia['error'], 'braucht ein Bild') !== false,
    'and it is the local refusal, in German, naming the requirement');
assert(mb_strpos((string) $noMedia['error'], 'Code') === false,
    'and it never reached Meta: a Graph code in this text means the request went out before the check');

echo "instagram-adapter-test: OK\n";

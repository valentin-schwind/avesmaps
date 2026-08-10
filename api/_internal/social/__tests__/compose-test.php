<?php

declare(strict_types=1);

/**
 * Unit test for the composer. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/compose-test.php
 *
 * ⚠️ mbstring is REQUIRED, not cosmetic: every count is mb_strlen. Without the extension this file
 * dies with "undefined function mb_strlen", which looks like a bug in the composer and is not.
 *
 * The rules worth guarding, all from Entwurf §4:
 *   1. Hashtags COUNT toward the character limit. Four tags are quickly 60 characters; against
 *      Mastodon's 500 that is more than a tenth, and getting it wrong means a post truncated on
 *      arrival -- in public, where it cannot be edited.
 *   2. Each channel gets the FIRST so-many tags -- Instagram all, Facebook 2, Mastodon 4.
 *   3. The counter shows the STRICTEST limit among the CHECKED channels. Unchecking Mastodon must
 *      hand the editor 2200 characters back, or they write to the wrong ceiling.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strlen')) {
    fwrite(STDERR, "FATAL: mbstring is missing -- every count here is mb_strlen. "
        . "Re-run with -d extension=php_mbstring.dll\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../compose.php';

// ---- hashtag normalisation -----------------------------------------------------------------------

assert(avesmapsSocialNormalizeHashtags(['DSA', '#Aventurien']) === ['#DSA', '#Aventurien'],
    'a leading # is optional on input and guaranteed on output');
assert(avesmapsSocialNormalizeHashtags('DSA, #Aventurien ,, Rollenspiel') === ['#DSA', '#Aventurien', '#Rollenspiel'],
    'a comma-separated string works too -- that is what a text field sends');
assert(avesmapsSocialNormalizeHashtags('') === [], 'an empty string is no tag');
assert(avesmapsSocialNormalizeHashtags(['#DSA', 'dsa', '#DSA']) === ['#DSA'],
    'duplicates fold case-insensitively: #dsa and #DSA are ONE bucket -- the whole reason the shared '
    . 'vocabulary exists is that three spellings make three unsearchable buckets');
assert(avesmapsSocialNormalizeHashtags(['#DSA', 'dsa'])[0] === '#DSA',
    'and the FIRST spelling wins, so the editor keeps their capitalisation');
assert(avesmapsSocialNormalizeHashtags(['  ', '#', '']) === [],
    'empty and bare-# entries drop out instead of becoming "#"');
assert(avesmapsSocialNormalizeHashtags(['#Das Schwarze Auge']) === ['#DasSchwarzeAuge'],
    'a space inside a tag would END it on every network -- removed, not left to break the tag');
assert(avesmapsSocialNormalizeHashtags(['#Über']) === ['#Über'],
    'umlauts stay: a hashtag is human-facing text, NOT a wiki key -- it must never be ascii-folded');
assert(avesmapsSocialNormalizeHashtags(['##DSA']) === ['#DSA'],
    'a doubled # collapses to one');

// ---- composition -------------------------------------------------------------------------------

$mastodon = avesmapsSocialChannel('mastodon');
$instagram = avesmapsSocialChannel('instagram');
$facebook = avesmapsSocialChannel('facebook');

$plain = avesmapsSocialCompose('Hallo Aventurien', [], $mastodon);
assert($plain['caption'] === 'Hallo Aventurien', 'no tags, no trailing whitespace');
assert($plain['text_chars'] === 16, 'text counted with mb_strlen');
assert($plain['hashtag_chars'] === 0, 'no tags, no tag characters');
assert($plain['total_chars'] === 16, 'total equals text when there are no tags');
assert($plain['over_limit'] === false, '16 of 500 is fine');

$tagged = avesmapsSocialCompose('Hallo', ['#DSA', '#Aventurien'], $mastodon);
assert($tagged['caption'] === "Hallo\n\n#DSA #Aventurien",
    'tags are appended to the TEXT -- no API has a hashtag field (Entwurf §4)');
assert($tagged['hashtags_used'] === ['#DSA', '#Aventurien'], 'mastodon takes 4, so both fit');
// 💣 The assertion this whole file exists for: the tags are PART OF THE LENGTH.
assert($tagged['total_chars'] === mb_strlen("Hallo\n\n#DSA #Aventurien"),
    'the total counts the ASSEMBLED caption, separator included');
assert($tagged['hashtag_chars'] === $tagged['total_chars'] - $tagged['text_chars'],
    'the split is exact -- the counter shows "168 + 61 = 229", and the two must add up');
assert($tagged['hashtag_chars'] === 18, '"\n\n#DSA #Aventurien" is 18 characters, and they all count');

$fb = avesmapsSocialCompose('Hallo', ['#A', '#B', '#C', '#D'], $facebook);
assert($fb['hashtags_used'] === ['#A', '#B'], 'facebook gets the FIRST two, not an arbitrary two');
assert($fb['caption'] === "Hallo\n\n#A #B", 'and only those two reach the caption');

$ig = avesmapsSocialCompose('Hallo', ['#A', '#B', '#C', '#D'], $instagram);
assert($ig['hashtags_used'] === ['#A', '#B', '#C', '#D'],
    'max_hashtags null means ALL -- truncating instagram tags would be a rule nobody imposed');

// Text-only and tags-only both behave.
$tagsOnly = avesmapsSocialCompose('', ['#DSA'], $mastodon);
assert($tagsOnly['caption'] === '#DSA', 'tags without text carry no leading blank lines');

// ---- the limit ------------------------------------------------------------------------------------

$long = avesmapsSocialCompose(str_repeat('x', 495), ['#DSA'], $mastodon);
assert($long['over_limit'] === true,
    '495 characters plus a tag exceeds 500 -- caught BEFORE sending, not by the API afterwards');
$fits = avesmapsSocialCompose(str_repeat('x', 495), [], $mastodon);
assert($fits['over_limit'] === false, '495 alone fits');
assert(avesmapsSocialCompose(str_repeat('x', 500), [], $mastodon)['over_limit'] === false,
    'exactly 500 is allowed -- the boundary is inclusive');
assert(avesmapsSocialCompose(str_repeat('x', 501), [], $mastodon)['over_limit'] === true,
    '501 is not');
// The limit belongs to the CHANNEL. Same text, roomier channel, no problem.
assert(avesmapsSocialCompose(str_repeat('x', 495), ['#DSA'], $instagram)['over_limit'] === false,
    'the limit belongs to the channel, not to the text');

// ---- the strictest limit ------------------------------------------------------------------------------

$strict = avesmapsSocialStrictestLimit(['instagram', 'mastodon']);
assert($strict['max_chars'] === 500 && $strict['key'] === 'mastodon',
    'with mastodon checked the ceiling is 500 and the counter must NAME it');
assert($strict['label'] === 'Mastodon', 'and name it in human words, not by key');
$loose = avesmapsSocialStrictestLimit(['instagram', 'facebook']);
assert($loose['max_chars'] === 2200 && $loose['key'] === 'instagram',
    'uncheck mastodon and the editor gets 2200 back');
assert(avesmapsSocialStrictestLimit([])['max_chars'] === null,
    'nothing checked, no ceiling -- NOT zero, which would forbid every post and read as a bug');
assert(avesmapsSocialStrictestLimit(['nope'])['max_chars'] === null,
    'an unknown key contributes no limit instead of crashing');
assert(avesmapsSocialStrictestLimit(['nope', 'mastodon'])['key'] === 'mastodon',
    'and it does not stop the known ones from being counted');
assert(avesmapsSocialStrictestLimit(['probe'])['max_chars'] === 500,
    'the probe carries the strictest real limit, so a rehearsal that passes passes everywhere');

// ---- the shared vocabulary ----------------------------------------------------------------------------

assert(AVESMAPS_SOCIAL_HASHTAG_VOCABULARY !== [], 'there is a shared vocabulary to click');
assert(avesmapsSocialNormalizeHashtags(AVESMAPS_SOCIAL_HASHTAG_VOCABULARY) === AVESMAPS_SOCIAL_HASHTAG_VOCABULARY,
    'and every entry in it is ALREADY canonical -- a vocabulary the normaliser rewrites would seed '
    . 'exactly the divergence it exists to prevent');

fwrite(STDOUT, "compose-test: OK\n");

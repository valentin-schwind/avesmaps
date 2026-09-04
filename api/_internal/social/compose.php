<?php

declare(strict_types=1);

// Text + hashtags + a channel -> the finished caption, plus the numbers the counter shows (Entwurf §4).
//
// Pure on purpose: no database, no HTTP, no config. That is the only reason it can be tested at all
// (there is no local MySQL), and it is the piece where a silent mistake is most expensive -- a
// mis-counted caption is a post truncated in public, where it cannot be edited afterwards.
//
// 💣 HASHTAGS COUNT TOWARD THE LIMIT. They live in their own input field because the networks take
// different numbers of them, but they are DELIVERED INSIDE THE TEXT: no API has a hashtag field.
// Four tags are quickly 60 characters -- against Mastodon's 500 that is more than a tenth.

require_once __DIR__ . '/channels.php';

// A shared vocabulary, offered for one click in the hub. Without it everyone types something
// slightly different and #dsa5 / #DSA5 / #dasschwarzeauge become three separate buckets nobody can
// search (Entwurf §4).
//
// ⚠️ Every entry here must ALREADY be canonical under avesmapsSocialNormalizeHashtags -- a vocabulary
// the normaliser rewrites would seed exactly the divergence it exists to prevent. compose-test.php
// asserts that.
// 🔴 Two owner rulings, 2026-08-13, both about REACH -- do not "restore" either as a tidy-up:
//   · '#PnPde' instead of '#PnP': the German-language pen-and-paper tag, not the worldwide one.
//   · NO '#DSA'. The three letters are shared with too much else to still find us; the unambiguous
//     name is '#DasSchwarzeAuge', which is why it stays in the list.
const AVESMAPS_SOCIAL_HASHTAG_VOCABULARY = [
    '#DasSchwarzeAuge',
    '#Aventurien',
    '#Rollenspiel',
    '#TDE',
    '#PnPde',
    '#Karte',
    '#Fanprojekt',
];

// A blank line between text and tags: it is what every network's own composer produces, and it keeps
// the tags from reading as part of the last sentence.
const AVESMAPS_SOCIAL_HASHTAG_SEPARATOR = "\n\n";

/**
 * Clean a list (or a comma/whitespace-separated string) into canonical tags.
 *
 * ⚠️ Deliberately NOT ascii-folded. avesmapsFoldToAscii belongs to wiki keys, where a join depends on
 * both sides deriving the same string; a hashtag is human-facing text and "#Ueber" is a different tag
 * from "#Über". Only what would BREAK a tag is removed: whitespace inside it (which ends the tag on
 * every network) and the leading '#' (re-added exactly once).
 *
 * @param list<string>|string $raw
 * @return list<string>
 */
function avesmapsSocialNormalizeHashtags(array|string $raw): array
{
    $items = is_string($raw) ? preg_split('/[,\s]+/u', $raw) : $raw;
    if (!is_array($items)) {
        $items = [];
    }

    $result = [];
    $seen = [];
    foreach ($items as $item) {
        $tag = ltrim(trim((string) $item), '#');
        // Whitespace inside a tag ends it: "#Das Schwarze Auge" posts as "#Das".
        $tag = (string) preg_replace('/\s+/u', '', $tag);
        if ($tag === '') {
            continue;
        }
        // Case-insensitive dedup: #dsa and #DSA are ONE bucket. The FIRST spelling wins, so the
        // editor's capitalisation survives.
        $fold = mb_strtolower($tag);
        if (isset($seen[$fold])) {
            continue;
        }
        $seen[$fold] = true;
        $result[] = '#' . $tag;
    }

    return $result;
}

/**
 * Adressen im Text, wie das Netz sie sieht: alles ab http(s):// bis zum naechsten Leerraum.
 * ⚠️ Bewusst nur MIT Schema -- Mastodon rechnet nackte Domains („avesmaps.de") nicht als Link.
 */
const AVESMAPS_SOCIAL_URL_PATTERN = '~https?://\S+~iu';

/**
 * Zeichenzahl eines Textes, wie ein Kanal sie zaehlt.
 *
 * `$urlChars` null: mb_strlen, so lang wie der Text ist. Sonst zaehlt jede Adresse genau `$urlChars`
 * Zeichen -- Mastodon reserviert 23 je Link (`characters_reserved_per_url`, api/v2/instance): ein
 * 62-Zeichen-Link kostet dort 23, und ein 12-Zeichen-Link EBENFALLS 23. Die zweite Richtung ist die
 * gefaehrliche: echt gezaehlt 491, drueben 502 -- und der Beitrag faellt erst im Relais, eine halbe
 * Stunde nach dem Klick, mit einer Meldung, die niemand mehr sieht.
 */
function avesmapsSocialZeichenzahl(string $text, ?int $urlChars): int
{
    if ($urlChars === null) {
        return mb_strlen($text);
    }
    $gewichtet = preg_replace(AVESMAPS_SOCIAL_URL_PATTERN, str_repeat('x', max(0, $urlChars)), $text);

    return mb_strlen($gewichtet ?? $text);
}

/**
 * Assemble the caption for ONE channel and report the numbers behind the counter.
 *
 * @param list<string>|string  $hashtags Raw or already normalised -- this normalises either way, so
 *                                       the function is safe to call with whatever the client sent.
 * @param array<string, mixed> $channel  A row from AVESMAPS_SOCIAL_CHANNELS.
 * @return array{caption: string, text_chars: int, hashtag_chars: int, total_chars: int,
 *               hashtags_used: list<string>, over_limit: bool}
 */
function avesmapsSocialCompose(string $text, array|string $hashtags, array $channel): array
{
    $text = rtrim($text);
    $tags = avesmapsSocialNormalizeHashtags($hashtags);

    // null means ALL. Substituting a large number would impose a limit nobody asked for.
    $maxTags = $channel['max_hashtags'] ?? null;
    if ($maxTags !== null && (int) $maxTags >= 0) {
        $tags = array_slice($tags, 0, (int) $maxTags);
    }

    $caption = $text;
    if ($tags !== []) {
        $caption = ($text === '' ? '' : $text . AVESMAPS_SOCIAL_HASHTAG_SEPARATOR) . implode(' ', $tags);
    }

    // 💣 Gezaehlt wird, wie das NETZ zaehlt (Register `url_chars`: Mastodon 23 je Adresse, sonst null).
    // Beide Haelften durch DENSELBEN Zaehler, sonst addieren sich Text und Hashtags nicht zur Summe.
    $urlChars = isset($channel['url_chars']) ? (int) $channel['url_chars'] : null;
    $textChars = avesmapsSocialZeichenzahl($text, $urlChars);
    $totalChars = avesmapsSocialZeichenzahl($caption, $urlChars);
    $maxChars = $channel['max_chars'] ?? null;

    return [
        'caption' => $caption,
        'text_chars' => $textChars,
        // DERIVED, not measured separately, so the two ALWAYS add up to the total. The counter shows
        // them as "168 + 61 = 229"; computing the parts independently is how that sum stops matching.
        'hashtag_chars' => $totalChars - $textChars,
        'total_chars' => $totalChars,
        'hashtags_used' => $tags,
        'over_limit' => $maxChars !== null && $totalChars > (int) $maxChars,
    ];
}

/**
 * The tightest character ceiling among the given channels -- what the counter displays.
 *
 * Nothing selected yields max_chars null (no ceiling), NOT zero: zero would forbid every post and
 * read like a bug in the counter rather than like "no channel checked".
 *
 * @param list<string> $channelKeys
 * @return array{key: string|null, label: string, max_chars: int|null, url_chars: int|null}
 */
function avesmapsSocialStrictestLimit(array $channelKeys): array
{
    $best = ['key' => null, 'label' => '', 'max_chars' => null, 'url_chars' => null];
    foreach ($channelKeys as $key) {
        $channel = avesmapsSocialChannel((string) $key);
        if ($channel === null || $channel['max_chars'] === null) {
            continue;
        }
        $limit = (int) $channel['max_chars'];
        $urlChars = isset($channel['url_chars']) ? (int) $channel['url_chars'] : null;
        // 💣 Bei GLEICHER Decke gewinnt der Kanal, der Adressen schwerer zaehlt (Probe und Mastodon stehen
        // beide auf 500) -- sonst entschiede die Reihenfolge im Register. Spiegel von strictestLimit im Hub.
        $gleichAberSchwerer = $limit === $best['max_chars'] && $best['url_chars'] === null && $urlChars !== null;
        if ($best['max_chars'] === null || $limit < $best['max_chars'] || $gleichAberSchwerer) {
            $best = [
                'key' => (string) $key,
                // The counter names the channel in human words ("Mastodon 500"), not by key -- a bare
                // number leaves the editor guessing which network is holding them back.
                'label' => (string) $channel['label'],
                'max_chars' => $limit,
                'url_chars' => $urlChars,
            ];
        }
    }

    return $best;
}

/**
 * The channel a caption would break, or null when every selected channel takes it.
 *
 * Composed PER CHANNEL rather than measured once against avesmapsSocialStrictestLimit(): max_hashtags
 * differs per network, so the same text is a different length on each, and the tightest max_chars is
 * not necessarily the one that overflows. Reports the WORST offender -- that is the one the text has
 * to be cut for; fixing it fixes the others.
 *
 * @param list<string>|string $hashtags
 * @param list<string>        $channelKeys
 * @return array{key: string, label: string, total_chars: int, max_chars: int, over_by: int}|null
 */
function avesmapsSocialWorstOverLimit(string $text, array|string $hashtags, array $channelKeys): ?array
{
    $worst = null;
    foreach ($channelKeys as $key) {
        $key = (string) $key;
        $channel = avesmapsSocialChannel($key);
        if ($channel === null || $channel['max_chars'] === null) {
            continue;
        }

        $composed = avesmapsSocialCompose($text, $hashtags, $channel);
        if (!$composed['over_limit']) {
            continue;
        }

        $maxChars = (int) $channel['max_chars'];
        $overBy = $composed['total_chars'] - $maxChars;
        if ($worst === null || $overBy > $worst['over_by']) {
            $worst = [
                'key' => $key,
                'label' => (string) $channel['label'],
                'total_chars' => $composed['total_chars'],
                'max_chars' => $maxChars,
                'over_by' => $overBy,
            ];
        }
    }

    return $worst;
}

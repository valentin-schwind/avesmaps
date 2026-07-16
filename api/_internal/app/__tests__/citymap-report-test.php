<?php

declare(strict_types=1);

/**
 * Unit test for the community map suggestion's payload whitelist (Spec §3.8). No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/citymap-report-test.php
 * Exit 0 = all asserts passed.
 *
 * Sibling of citymap-gate-test.php, which proves the gate holds for a row already IN the table. This one
 * proves the matching thing one step earlier: what a STRANGER may put in that row.
 *
 * The load-bearing rule is the licence one, and it is worth a test rather than a comment because it fails
 * silently and in the expensive direction. avesmapsNormalizeCitymapReportPayload runs on a public,
 * capability-NONE endpoint. If a licence key ever leaks through it, avesmapsUpsertCitymap would name the
 * column, the DEFAULT 'unknown_other' would stop protecting us, and a reporter asserting "cc0" on a
 * publisher's preview would get it hot-linked to every reader -- with nothing in the code reading as
 * wrong. The gate is meant to believe the column; this test is what keeps the sender out of the column.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymaps.php';

/** Assert that a callable throws InvalidArgumentException. */
function citymapReportRefuses(callable $fn): bool
{
    try {
        $fn();
    } catch (InvalidArgumentException) {
        return true;
    }
    return false;
}

$valid = [
    'title' => 'Gareth — Gesamtplan',
    'map_url' => 'https://example.org/gareth',
];

// ---- THE LICENCE RULE (Spec §3.8, owner decision 2026-07-16) -----------------------------------------
// A reporter claiming a free licence on someone else's cartography must not reach the column. Every
// licence-ish key is thrown away, however it is spelled and whatever it claims.
$claimed = avesmapsNormalizeCitymapReportPayload($valid + [
    'map_license' => 'cc0',
    'thumb_license' => 'public_domain',
    'map_license_note' => 'Der Verlag hat mir das erlaubt, ehrlich.',
    'thumb_license_note' => 'auch erlaubt',
    'thumb_url' => 'https://example.org/verlags-vorschau.jpg',
]);
foreach (['map_license', 'thumb_license', 'map_license_note', 'thumb_license_note'] as $forbidden) {
    assert(!array_key_exists($forbidden, $claimed['citymap']));
}
// The suggested preview itself is KEPT -- it is information, not a claim. It stays invisible to readers
// because the licence column nobody wrote defaults to unknown_other, which the gate then refuses.
assert($claimed['citymap']['thumb_url'] === 'https://example.org/verlags-vorschau.jpg');
assert(!avesmapsCitymapPublicThumbUrl([
    'thumb_url' => $claimed['citymap']['thumb_url'],
    'thumb_license' => AVESMAPS_CITYMAP_LICENSE_DEFAULT,
]));
// ...and the same row becomes visible the moment an EDITOR classifies it. That is the whole design: the
// reporter supplies the picture, an editor supplies the licence.
assert(avesmapsCitymapPublicThumbUrl([
    'thumb_url' => $claimed['citymap']['thumb_url'],
    'thumb_license' => 'permission_granted',
]) === 'https://example.org/verlags-vorschau.jpg');

// Uploads, the Autoget crawl, moderation and cross-map references are equally not the reporter's to set.
$sneaky = avesmapsNormalizeCitymapReportPayload($valid + [
    'map_local_url' => '/uploads/kartensammlungen/x/map-1.png',
    'thumb_local_url' => '/uploads/kartensammlungen/x/thumb-1.png',
    'thumb_auto_url' => 'https://example.org/auto.jpg',
    'status' => 'approved',
    'origin' => 'manual',
    'parent_public_id' => '11111111-2222-3333-4444-555555555555',
    'related' => ['66666666-7777-8888-9999-000000000000'],
    'created_by' => 1,
    'public_id' => '99999999-9999-9999-9999-999999999999',
]);
foreach ([
    'map_local_url', 'thumb_local_url', 'thumb_auto_url', 'status', 'origin', 'parent_public_id',
    'related', 'created_by', 'public_id',
] as $forbidden) {
    assert(!array_key_exists($forbidden, $sneaky['citymap']));
}
// The whitelist is closed, not merely long: exactly these keys, no others, ever. Adding a field here has
// to be a decision someone makes on purpose -- which is the point. (It already earned its keep once: the
// is_paid column of 2026-07-17 turned this line red until it was consciously admitted.)
assert(array_keys($sneaky['citymap']) === [
    'title', 'map_url', 'thumb_url', 'author', 'note', 'art',
    'is_color', 'is_multilevel', 'is_labeled', 'is_official', 'is_spoiler', 'is_paid',
    'valid_from_bf', 'valid_to_bf', 'width_px', 'height_px',
]);
// A citymap built from this payload can never name a licence column -> the NOT NULL DEFAULT stands.
assert(!array_intersect(array_keys($sneaky['citymap']), ['map_license', 'thumb_license']));

// ---- identity: title + map link are mandatory (§3.1) -------------------------------------------------
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload(['map_url' => 'https://example.org/a'])));
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload(['title' => '   ', 'map_url' => 'https://example.org/a'])));
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload(['title' => 'Ohne Link'])));
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload(['title' => 'Leerer Link', 'map_url' => ''])));
// Non-http(s) is refused on both link fields -- same rule the editor path uses (avesmapsCitymapNormalizeUrl).
foreach (['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org/a'] as $bad) {
    assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload(['title' => 'X', 'map_url' => $bad])));
    assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload($valid + ['thumb_url' => $bad])));
}
// Over-long text is REFUSED, not truncated: a silently shortened title is a wrong fact stored under a
// reader's name. (The free-text comment elsewhere in the report pipeline truncates -- on purpose.)
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload([
    'title' => str_repeat('a', AVESMAPS_CITYMAP_TITLE_MAX + 1), 'map_url' => 'https://example.org/a',
])));
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload($valid + ['author' => str_repeat('a', AVESMAPS_CITYMAP_AUTHOR_MAX + 1)])));
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload($valid + ['note' => str_repeat('a', AVESMAPS_CITYMAP_NOTE_MAX + 1)])));
// Exactly at the limit is fine (off-by-one guard).
assert(avesmapsNormalizeCitymapReportPayload([
    'title' => str_repeat('a', AVESMAPS_CITYMAP_TITLE_MAX), 'map_url' => 'https://example.org/a',
])['citymap']['title'] === str_repeat('a', AVESMAPS_CITYMAP_TITLE_MAX));

// Whitespace is collapsed, not preserved -- a title is one line.
assert(avesmapsNormalizeCitymapReportPayload(['title' => "  Gareth \n  Gesamtplan ", 'map_url' => 'https://example.org/a'])['citymap']['title'] === 'Gareth Gesamtplan');
// Unicode is counted in CHARACTERS, not bytes: an umlaut must not cost double against the limit.
assert(avesmapsNormalizeCitymapReportPayload([
    'title' => str_repeat('ö', AVESMAPS_CITYMAP_TITLE_MAX), 'map_url' => 'https://example.org/a',
])['citymap']['title'] === str_repeat('ö', AVESMAPS_CITYMAP_TITLE_MAX));

// ---- classification ----------------------------------------------------------------------------------
assert(avesmapsNormalizeCitymapReportPayload($valid + ['art' => 'politisch'])['citymap']['art'] === 'politisch');
// Unknown art -> "" (= unknown, §3.1), NOT a 400: the dialog offers a fixed select, so a stray value is a
// hand-built request, and "we do not know" is an answer we already have.
assert(avesmapsNormalizeCitymapReportPayload($valid + ['art' => 'erfunden'])['citymap']['art'] === '');
assert(avesmapsNormalizeCitymapReportPayload($valid)['citymap']['art'] === '');

// Three-valued properties survive as three-valued (§3.1) -- unknown must not collapse into "no".
$tri = avesmapsNormalizeCitymapReportPayload($valid + ['is_color' => true, 'is_spoiler' => '0']);
assert($tri['citymap']['is_color'] === 1);
assert($tri['citymap']['is_spoiler'] === 0);
assert($tri['citymap']['is_multilevel'] === null);
assert($tri['citymap']['is_labeled'] === null);

// is_paid (owner 2026-07-17): a plain observation, NOT a claim that unlocks anything -- unlike a licence it
// gates nothing, so the reporter may state it. All three values are meaningful and must survive distinctly:
// unknown must not collapse into "kostenlos" (we would be guessing about someone's wallet), and a known
// `false` is the one negative the reader row actually prints.
assert(avesmapsNormalizeCitymapReportPayload($valid + ['is_paid' => '1'])['citymap']['is_paid'] === 1);
assert(avesmapsNormalizeCitymapReportPayload($valid + ['is_paid' => '0'])['citymap']['is_paid'] === 0);
assert(avesmapsNormalizeCitymapReportPayload($valid)['citymap']['is_paid'] === null);
assert(avesmapsNormalizeCitymapReportPayload($valid + ['is_paid' => ''])['citymap']['is_paid'] === null);

$years = avesmapsNormalizeCitymapReportPayload($valid + ['valid_from_bf' => '1027', 'valid_to_bf' => '', 'width_px' => 2000]);
assert($years['citymap']['valid_from_bf'] === 1027);
assert($years['citymap']['valid_to_bf'] === null);
assert($years['citymap']['width_px'] === 2000);
assert($years['citymap']['height_px'] === null);

// ---- types -------------------------------------------------------------------------------------------
$types = avesmapsNormalizeCitymapReportPayload($valid + [
    'types' => ['stadtplan', 'stadtplan', 'erfunden', '', 'viertel', 42, null, ['nested']],
])['types'];
assert($types === ['stadtplan', 'viertel']); // deduped, whitelisted, junk of every type dropped
assert(avesmapsNormalizeCitymapReportPayload($valid)['types'] === []);
assert(avesmapsNormalizeCitymapReportPayload($valid + ['types' => 'stadtplan'])['types'] === []); // not an array -> nothing

// ---- place (§3.9) ------------------------------------------------------------------------------------
$place = avesmapsNormalizeCitymapReportPayload($valid + [
    'place' => [
        'raw_name' => 'Gareth',
        'target_kind' => 'settlement',
        'target_public_id' => 'abc-123',
        'target_wiki_key' => 'gareth',
    ],
])['place'];
assert($place === [
    'raw_name' => 'Gareth',
    'target_kind' => 'settlement',
    'target_public_id' => 'abc-123',
    'target_wiki_key' => 'gareth',
]);
// An unknown kind degrades to 'unresolved' -- the honest state the shared resolver then works on.
assert(avesmapsNormalizeCitymapReportPayload($valid + ['place' => ['raw_name' => 'X', 'target_kind' => 'erfunden']])['place']['target_kind'] === 'unresolved');
assert(avesmapsNormalizeCitymapReportPayload($valid + ['place' => ['raw_name' => 'X']])['place']['target_kind'] === 'unresolved');
// No name -> no place at all. A map without a place is a valid citymap (§3.1), not an error.
assert(avesmapsNormalizeCitymapReportPayload($valid)['place'] === []);
assert(avesmapsNormalizeCitymapReportPayload($valid + ['place' => []])['place'] === []);
assert(avesmapsNormalizeCitymapReportPayload($valid + ['place' => 'Gareth'])['place'] === []);
// An over-long id/key is refused rather than truncated: a shortened id resolves to the wrong element (or
// to nothing) and leaves no trace of why.
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload($valid + ['place' => ['raw_name' => 'X', 'target_public_id' => str_repeat('a', 65)]])));
assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload($valid + ['place' => ['raw_name' => 'X', 'target_wiki_key' => str_repeat('a', 191)]])));

// ---- garbage input -----------------------------------------------------------------------------------
// The endpoint hands us whatever JSON arrived. Non-arrays must produce a clean 400, never a TypeError.
foreach ([null, 'nonsense', 42, true] as $junk) {
    assert(citymapReportRefuses(static fn() => avesmapsNormalizeCitymapReportPayload($junk)));
}

// ---- the client contract -----------------------------------------------------------------------------
// The exact `citymap` object buildPayload() sends (js/map-features/map-features-citymaps-suggest.js). A
// mirror, kept honest by this test: a renamed field on either side silently drops the reader's input --
// the report still saves, the map is still created, and the value is simply gone. Nothing would look
// broken. Note the wire types this pins down, both of which are easy to get wrong in the safe-looking
// direction: the tri-states arrive as the STRINGS "", "1", "0" (a select's value never is a boolean), and
// an untouched number field arrives as "" rather than 0 -- Number("") is 0, and a map with no BF year
// would otherwise become one "valid from 0 BF".
$fromClient = avesmapsNormalizeCitymapReportPayload([
    'title' => 'Gareth — Gesamtplan',
    'map_url' => 'https://example.org/gareth',
    'thumb_url' => '',
    'author' => '',
    'note' => '',
    'art' => 'politisch',
    'valid_from_bf' => 1027,
    'valid_to_bf' => '',
    'width_px' => '',
    'height_px' => '',
    'types' => ['stadtplan'],
    'is_color' => '1',
    'is_multilevel' => '',
    'is_labeled' => '0',
    'is_official' => '',
    'is_spoiler' => '',
    'is_paid' => '1',
    'place' => [
        'raw_name' => 'Gareth',
        'target_kind' => 'settlement',
        'target_public_id' => 'abc-123',
        'target_wiki_key' => '',
    ],
]);
assert($fromClient['citymap']['title'] === 'Gareth — Gesamtplan');
assert($fromClient['citymap']['map_url'] === 'https://example.org/gareth');
assert($fromClient['citymap']['art'] === 'politisch');
assert($fromClient['citymap']['is_color'] === 1);
assert($fromClient['citymap']['is_labeled'] === 0);
assert($fromClient['citymap']['is_multilevel'] === null); // "" -> unknown, NOT false
assert($fromClient['citymap']['is_paid'] === 1);
assert($fromClient['citymap']['valid_from_bf'] === 1027);
assert($fromClient['citymap']['valid_to_bf'] === null);   // "" -> unknown, NOT 0
assert($fromClient['citymap']['width_px'] === null);
assert($fromClient['citymap']['thumb_url'] === '');
assert($fromClient['types'] === ['stadtplan']);
assert($fromClient['place']['raw_name'] === 'Gareth');
assert($fromClient['place']['target_kind'] === 'settlement');
assert($fromClient['place']['target_public_id'] === 'abc-123');
// No wiki key from the client for a settlement: the server derives it from the public_id
// (avesmapsAddCitymapPlace), which is what keeps the §3.9 slug divergence (ö->oe vs ö->o) out of this path.
assert($fromClient['place']['target_wiki_key'] === '');

// ---- origin (Spec §3.8: approval writes 'community') -------------------------------------------------
assert(avesmapsCitymapNormalizeOrigin('community') === 'community');
assert(avesmapsCitymapNormalizeOrigin('manual') === 'manual');
// 'wiki' is a REAL origin since the map wiki-sync shipped (2026-07-17), which retired §6's "no wiki sync
// for maps". This line used to assert the opposite, and its failure is what surfaced the change -- kept
// as a live assertion rather than deleted, because the next person to touch the vocabulary should trip
// over it too.
assert(avesmapsCitymapNormalizeOrigin('wiki') === 'wiki');
// Anything UNRECOGNISED still falls back to 'manual' -- origin is our bookkeeping, never reader input,
// and 'manual' is the conservative answer: it is exactly the value the wiki sync refuses to touch, so a
// typo can only ever make a map too protected, never too exposed.
assert(avesmapsCitymapNormalizeOrigin('erfunden') === 'manual');
assert(avesmapsCitymapNormalizeOrigin('') === 'manual');
assert(avesmapsCitymapNormalizeOrigin(null) === 'manual');
assert(avesmapsCitymapNormalizeOrigin(42) === 'manual');
assert(count(AVESMAPS_CITYMAP_ORIGINS) === count(array_unique(AVESMAPS_CITYMAP_ORIGINS)));

// That 'wiki' became real RAISES the stakes on the whitelist above, which is why this is asserted here
// rather than left implicit: the sync writes and DELETES only origin='wiki' rows. Could a reporter smuggle
// origin='wiki' in, their map would be owned -- and on the next sync deleted -- by a dump that never
// mentioned it. Two independent reasons it cannot happen, both worth pinning:
$wikiClaim = avesmapsNormalizeCitymapReportPayload($valid + ['origin' => 'wiki']);
assert(!array_key_exists('origin', $wikiClaim['citymap']));          // the payload never carries an origin
assert(avesmapsCitymapNormalizeOrigin('community') !== 'wiki');      // and the approval passes 'community'

echo "citymap-report ok\n";

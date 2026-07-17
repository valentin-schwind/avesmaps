<?php

declare(strict_types=1);

/**
 * Unit test for the community fundort report gate
 * (docs/superpowers/specs/2026-07-17-community-fundorte-design.md). No DB, no HTTP. Run from repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/citymap-link-report-test.php
 *
 * avesmapsNormalizeCitymapLinkReportPayload runs on the PUBLIC endpoint with capability NONE. Its output is
 * untrusted input that has passed a whitelist -- and anything it does not return can never reach a column.
 * Sibling of citymap-report-test.php, same reasoning throughout.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymaps.php';

$throws = static function (callable $fn): bool {
    try {
        $fn();
    } catch (InvalidArgumentException) {
        return true;
    }
    return false;
};

// ---- the happy path ---------------------------------------------------------------------------------
$out = avesmapsNormalizeCitymapLinkReportPayload([
    'citymap_public_id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'links' => [
        ['label' => 'Wiki-Aventurica', 'url' => 'https://de.wiki-aventurica.de/wiki/X', 'is_paid' => '0'],
        ['label' => 'Fanprojekt XY', 'url' => 'https://example.org/fan', 'is_paid' => ''],
    ],
    'note' => 'Die Karte liegt dort frei einsehbar.',
]);
assert($out['citymap_public_id'] === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
assert(count($out['links']) === 2);
assert($out['links'][0] === ['label' => 'Wiki-Aventurica', 'url' => 'https://de.wiki-aventurica.de/wiki/X', 'is_paid' => 0, 'sort_order' => 0]);
// '' is UNKNOWN and stays NULL -- the tri-state rule (§3.1). A reporter who cannot judge the price must not
// be made to claim one, and "free" is the claim that would cost a reader money to disprove.
assert($out['links'][1]['is_paid'] === null);
assert($out['note'] === 'Die Karte liegt dort frei einsehbar.');

// is_paid IS accepted from a reporter -- unlike a licence it unlocks nothing. It is a plain observation
// ("this costs money") that anyone looking at a shop page has. Same call as the citymap report.
assert(avesmapsNormalizeCitymapLinkReportPayload([
    'citymap_public_id' => 'x', 'links' => [['label' => 'F-Shop', 'url' => 'https://f-shop.de/x', 'is_paid' => '1']],
])['links'][0]['is_paid'] === 1);

// ---- the allowlist ----------------------------------------------------------------------------------
// THE point of this function. origin/status are OUR bookkeeping: a report that could name its own origin
// would write itself in as 'manual' and the editor would take it for his own work. status='approved' would
// publish it without anyone looking. Neither key is read, so neither can reach a column.
$hostile = avesmapsNormalizeCitymapLinkReportPayload([
    'citymap_public_id' => 'x',
    'links' => [[
        'label' => 'Böse', 'url' => 'https://example.org/x',
        'origin' => 'manual', 'status' => 'approved', 'id' => 7, 'citymap_id' => 1,
    ]],
]);
assert(!array_key_exists('origin', $hostile['links'][0]), 'origin darf NIE vom Melder kommen');
assert(!array_key_exists('status', $hostile['links'][0]), 'status ebenso wenig');
assert(!array_key_exists('id', $hostile['links'][0]) && !array_key_exists('citymap_id', $hostile['links'][0]));
assert(array_keys($hostile['links'][0]) === ['label', 'url', 'is_paid', 'sort_order'], 'genau diese vier Felder, sonst nichts');

// ---- what makes a report invalid --------------------------------------------------------------------
// Without a map the proposal has no target: the whole point is "another place to find THIS map".
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['links' => [['label' => 'X', 'url' => 'https://e.org/x']]])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => '  ', 'links' => [['label' => 'X', 'url' => 'https://e.org/x']]])));
// A report without a single usable link is not a report.
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => 'x', 'links' => []])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => 'x'])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => 'x', 'links' => [['label' => '', 'url' => '']]])),
    'nur leere Zeilen -> kein Vorschlag');

// The row rules are avesmapsNormalizeCitymapLinkRows' -- the SAME gate the editor's set_links passes
// through, so a community row can never be shaped differently from an editor's.
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => 'x', 'links' => [['label' => 'Titel ohne URL', 'url' => '']]])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => 'x', 'links' => [['label' => 'X', 'url' => 'javascript:alert(1)']]])));
// ...and a blank row among real ones is a trailing line in the dialog, not an error.
$mixed = avesmapsNormalizeCitymapLinkReportPayload([
    'citymap_public_id' => 'x',
    'links' => [['label' => '', 'url' => ''], ['label' => 'Echt', 'url' => 'https://example.org/a']],
]);
assert(count($mixed['links']) === 1 && $mixed['links'][0]['sort_order'] === 0);

// ---- the note ---------------------------------------------------------------------------------------
// Free text to a human. Refused when too long rather than truncated: a note cut mid-sentence changes what
// the reporter said, and this one is addressed to an editor deciding whether to trust them.
assert(avesmapsNormalizeCitymapLinkReportPayload(['citymap_public_id' => 'x', 'links' => [['label' => 'X', 'url' => 'https://e.org/x']]])['note'] === '');
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload([
    'citymap_public_id' => 'x', 'links' => [['label' => 'X', 'url' => 'https://e.org/x']],
    'note' => str_repeat('a', AVESMAPS_CITYMAP_NOTE_MAX + 1),
])));

// A public_id that matches nothing is NOT this function's problem -- it is a lookup, and the approval
// answers 404. Length is, though: it is a column.
assert($throws(static fn() => avesmapsNormalizeCitymapLinkReportPayload([
    'citymap_public_id' => str_repeat('a', 65), 'links' => [['label' => 'X', 'url' => 'https://e.org/x']],
])));

echo "citymap-link-report ok\n";

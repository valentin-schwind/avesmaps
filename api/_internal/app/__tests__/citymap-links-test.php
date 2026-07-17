<?php

declare(strict_types=1);

/**
 * Unit test for the citymap link list (docs/superpowers/specs/2026-07-17-karten-mehrfachlinks-design.md).
 * No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/citymap-links-test.php
 * Exit 0 = all asserts passed.
 *
 * Sibling of adventure-links-test.php, and deliberately so: citymap_link is adventure_link with one added
 * column (is_paid), so the two normalizers must agree on everything the spec did not set apart.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymaps.php';

$keys = static fn(array $links): array => array_map(static fn(array $l): string => $l['key'], $links);
$byKey = static function (array $links, string $key): ?array {
    foreach ($links as $link) {
        if ($link['key'] === $key) {
            return $link;
        }
    }
    return null;
};
$throws = static function (callable $fn): bool {
    try {
        $fn();
    } catch (InvalidArgumentException) {
        return true;
    }
    return false;
};

// ---- avesmapsCitymapLinks: map_url + the extra links -------------------------------------------------
// The bare map link still comes first and still calls itself "Karte" -- map_url stays the direct link to
// the map itself (spec §5), and citymap_link is additive.
$one = avesmapsCitymapLinks(['map_url' => 'https://example.org/karte.jpg'], []);
assert($keys($one) === ['map']);
assert($one[0]['label'] === 'Karte');
assert($one[0]['url_hash'] === hash('sha256', 'https://example.org/karte.jpg'));

// The map link INHERITS the map's is_paid. citymap.is_paid describes exactly this link and no other -- it
// was the only link when the column was added -- so carrying it onto the link is the honest translation of
// today's data, not an invention. It is also what makes step 5 (the column's removal) a pure data move:
// the filter below already asks the link, so nothing about its BEHAVIOUR changes when the column goes.
assert($one[0]['is_paid'] === null, 'no is_paid on the row -> unknown, never an invented false');
assert(avesmapsCitymapLinks(['map_url' => 'https://example.org/k', 'is_paid' => 1], [])[0]['is_paid'] === true);
assert(avesmapsCitymapLinks(['map_url' => 'https://example.org/k', 'is_paid' => 0], [])[0]['is_paid'] === false);

// An empty map_url is not a link: sha256('') would hash and then be probed forever.
assert(avesmapsCitymapLinks([], []) === []);
assert(avesmapsCitymapLinks(['map_url' => '   '], []) === []);
// ...but a map with no map_url and a link list is still a map with links.
assert($keys(avesmapsCitymapLinks([], [['id' => 3, 'label' => 'Wiki-Aventurica', 'url' => 'https://de.wiki-aventurica.de/wiki/X']]))
    === ['link:3']);

// Extra links keep the caller's order and land BEHIND the map link. Their key encodes the row id, the same
// shape adventure_link uses ('extra:<id>') -- 'link:<id>' here because these are not "extras" beside a
// priority list, they ARE the list.
$extras = [
    ['id' => 7, 'label' => "Al'Anfa und der tiefe Süden", 'url' => 'https://ulisses-ebooks.de/product/1', 'is_paid' => true],
    ['id' => 9, 'label' => 'Wiki-Aventurica', 'url' => 'https://de.wiki-aventurica.de/wiki/Y', 'is_paid' => false],
];
$links = avesmapsCitymapLinks(['map_url' => 'https://example.org/karte.jpg'], $extras);
assert($keys($links) === ['map', 'link:7', 'link:9']);
assert($byKey($links, 'link:7')['label'] === "Al'Anfa und der tiefe Süden");
assert($byKey($links, 'link:7')['is_paid'] === true);
assert($byKey($links, 'link:9')['is_paid'] === false);
foreach ($links as $link) {
    assert($link['url_hash'] === hash('sha256', $link['url']));
}

// An extra without a usable URL is dropped rather than emitted with an empty url.
assert($keys(avesmapsCitymapLinks([], [['id' => 1, 'label' => 'leer', 'url' => '  ']])) === []);

// The filter question itself ("has this map at least one link with is_paid === false?", spec §4.1) lives
// in map-features-citymaps.js and is tested in js/map-features/__tests__/citymaps-index.test.js: the server
// ships the whole catalog and the CLIENT filters it, so a PHP copy would have no caller.

// ---- avesmapsNormalizeCitymapLinkRows: the set_links input gate ---------------------------------------
assert(avesmapsNormalizeCitymapLinkRows([]) === []);

// Order in = order out, with sort_order stamped from the POSITION (not from whatever the client sent), so
// the editor's ▲▼ is a plain array move and no id ever has to be renumbered.
$rows = avesmapsNormalizeCitymapLinkRows([
    ['label' => "Al'Anfa und der tiefe Süden", 'url' => 'https://ulisses-ebooks.de/product/1', 'is_paid' => '1', 'sort_order' => 99],
    ['label' => 'Wiki-Aventurica', 'url' => 'https://de.wiki-aventurica.de/wiki/Y', 'is_paid' => '0'],
    ['label' => 'Fanprojekt', 'url' => 'https://example.org/fan', 'is_paid' => ''],
]);
assert(count($rows) === 3);
assert($rows[0] === ['label' => "Al'Anfa und der tiefe Süden", 'url' => 'https://ulisses-ebooks.de/product/1', 'is_paid' => 1, 'sort_order' => 0]);
assert($rows[1]['sort_order'] === 1 && $rows[1]['is_paid'] === 0);
// '' is UNKNOWN and must stay NULL -- the tri-state rule that the whole citymaps feature turns on (§3.1).
assert($rows[2]['is_paid'] === null, 'empty is_paid is unknown, not false');

// Whitespace is trimmed on both fields -- a padded URL hashes differently from the same URL unpadded, and
// the linkchecker would then probe it as a second link.
$padded = avesmapsNormalizeCitymapLinkRows([['label' => '  Wiki  ', 'url' => '  https://example.org/e  ']]);
assert($padded[0]['label'] === 'Wiki');
assert($padded[0]['url'] === 'https://example.org/e');
// is_paid absent entirely -> unknown.
assert($padded[0]['is_paid'] === null);

// A fully empty row is a trailing blank line in a row editor, not an error -> skipped, and it does not
// consume a sort_order slot.
$sparse = avesmapsNormalizeCitymapLinkRows([
    ['label' => '', 'url' => ''],
    ['label' => 'Echt', 'url' => 'https://example.org/a'],
    ['label' => '   ', 'url' => '  '],
]);
assert(count($sparse) === 1);
assert($sparse[0]['sort_order'] === 0);
// An is_paid alone does not make a row: nobody typed a link, they touched a tri-state and moved on.
assert(avesmapsNormalizeCitymapLinkRows([['label' => '', 'url' => '', 'is_paid' => '1']]) === []);

// A half-filled row IS an error rather than a silent drop: dropping loses what the editor typed, and
// storing it would render an anchor with no text (avesmapsCitymapLinks only skips on an empty url).
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => 'Titel ohne URL', 'url' => '']])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => '', 'url' => 'https://example.org/x']])));

// Only http/https may be stored (avesmapsCitymapNormalizeUrl): the probe refuses anything else anyway
// (§1.4), so a javascript:/ftp: row could never be checked -- and would still be a live href to a reader.
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => 'X', 'url' => 'javascript:alert(1)']])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => 'X', 'url' => 'ftp://example.org/x']])));
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => 'X', 'url' => 'example.org/x']])));

// Column limits enforced in PHP rather than left to MySQL: a silently truncated URL is a broken link and a
// truncated label is a mislabelled one.
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => str_repeat('a', 201), 'url' => 'https://example.org/x']])));
assert(count(avesmapsNormalizeCitymapLinkRows([['label' => str_repeat('a', 200), 'url' => 'https://example.org/x']])) === 1);
assert($throws(static fn() => avesmapsNormalizeCitymapLinkRows([['label' => 'X', 'url' => 'https://example.org/' . str_repeat('a', 500)]])));

echo "citymap-links ok\n";

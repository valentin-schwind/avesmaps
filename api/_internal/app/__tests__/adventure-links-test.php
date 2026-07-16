<?php

declare(strict_types=1);

/**
 * Unit test for the shared adventure link builder. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/adventure-links-test.php
 * Exit 0 = all asserts passed.
 *
 * avesmapsAdventureLinks() is the SINGLE definition of the click-priority rule (Spec §2.5): the client
 * builder advShopLinks() (map-features-place-extras.js) and the linkcheck provider must never diverge
 * again. Priority per the client CODE (Ulisses -> F-Shop -> Wiki -> DNB); note the stale comment at
 * place-extras.js:124 claims "DNB -> Wiki" and contradicts its own implementation -- the code wins.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../adventures.php';

$keys = static fn(array $links): array => array_map(static fn(array $l): string => $l['key'], $links);
$byKey = static function (array $links, string $key): ?array {
    foreach ($links as $link) {
        if ($link['key'] === $key) {
            return $link;
        }
    }
    return null;
};

// A fully populated row yields all four links in click-priority order: Ulisses -> F-Shop -> Wiki -> DNB.
$full = [
    'title' => 'Siegelbruch',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Siegelbruch',
    'link_ulisses' => 'https://ulisses-ebooks.de/product/12345',
    'link_fshop' => 'https://www.f-shop.de/siegelbruch',
    'isbn' => '978-3-95752-000-0',
];
$links = avesmapsAdventureLinks($full, []);
assert($keys($links) === ['ulisses', 'fshop', 'wiki', 'dnb']);

// Every link carries the sha256 of its own url -- that hash is the identity link_status/link_ref join on.
foreach ($links as $link) {
    assert($link['url_hash'] === hash('sha256', $link['url']));
    assert($link['label'] !== '');
}
assert($byKey($links, 'ulisses')['url'] === 'https://ulisses-ebooks.de/product/12345');
assert($byKey($links, 'wiki')['url'] === 'https://de.wiki-aventurica.de/wiki/Siegelbruch');

// DNB is a search fallback: it prefers the ISBN over the title.
assert($byKey($links, 'dnb')['url'] === 'https://portal.dnb.de/opac/simpleSearch?query=' . rawurlencode('978-3-95752-000-0'));

// No shop links -> only wiki + DNB survive; the wiki link still leads (it is a real page, DNB is a guess).
$sparse = ['title' => 'Nedime', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Nedime'];
assert($keys(avesmapsAdventureLinks($sparse, [])) === ['wiki', 'dnb']);
// Without an ISBN the DNB search falls back to the title.
assert($byKey(avesmapsAdventureLinks($sparse, []), 'dnb')['url']
    === 'https://portal.dnb.de/opac/simpleSearch?query=' . rawurlencode('Nedime'));

// No stored wiki_url -> derive it from the title (mirrors the client's encodeURIComponent fallback).
$derived = avesmapsAdventureLinks(['title' => 'Die Verschwörung von Gareth'], []);
assert($byKey($derived, 'wiki')['url']
    === 'https://de.wiki-aventurica.de/wiki/' . rawurlencode('Die Verschwörung von Gareth'));

// Nothing identifiable at all -> no links (never invent a URL out of an empty row).
assert(avesmapsAdventureLinks([], []) === []);
assert(avesmapsAdventureLinks(['title' => '   ', 'wiki_url' => ''], []) === []);

// Whitespace around stored URLs is trimmed -- otherwise " http://x" and "http://x" hash differently and
// the same link would be probed twice.
$padded = avesmapsAdventureLinks(['title' => 'X', 'link_fshop' => '  https://www.f-shop.de/x  '], []);
assert($byKey($padded, 'fshop')['url'] === 'https://www.f-shop.de/x');

// Extra links (Spec §2.4 adventure_link) keep the caller's order and land AFTER the priority links, so
// advBestLink()'s "links[0] = cover target" contract survives. Their key encodes the row id (§1.2 'extra:<id>').
$extras = [
    ['id' => 7, 'label' => 'Rezension von XY', 'url' => 'https://example.org/rezension'],
    ['id' => 9, 'label' => 'Errata', 'url' => 'https://example.org/errata'],
];
$withExtras = avesmapsAdventureLinks($full, $extras);
assert($keys($withExtras) === ['ulisses', 'fshop', 'wiki', 'dnb', 'extra:7', 'extra:9']);
assert($byKey($withExtras, 'extra:7')['label'] === 'Rezension von XY');
assert($byKey($withExtras, 'extra:7')['url_hash'] === hash('sha256', 'https://example.org/rezension'));

// An extra without a usable URL is dropped, not emitted with an empty url (it would hash the empty string).
assert($keys(avesmapsAdventureLinks(['title' => 'X'], [['id' => 1, 'label' => 'leer', 'url' => '  ']]))
    === ['wiki', 'dnb']);

echo "adventure-links ok\n";

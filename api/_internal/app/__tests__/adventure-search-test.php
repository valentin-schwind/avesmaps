<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../adventure-search.php';

$labels = AVESMAPS_ADVENTURE_SEARCH_TYPE_LABELS;

// Modelled on real rows (live 2026-08-02), not invented. Row 2 is the spoiler case: its start place
// never resolved, so the fetch hands over the empty place -- the play place is not even selected.
$rows = [
    [
        'public_id' => 'adv-1',
        'title' => 'Die Verschwoerung von Gareth',
        'product_type' => 'gruppenabenteuer',
        'edition' => 'DSA5',
        'genre' => 'Stadtabenteuer, Intrigenszenario',
        'series' => '',
        'contained_in' => '',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ],
    [
        'public_id' => 'adv-2',
        'title' => 'Die Phileasson-Saga',
        'product_type' => 'kampagnenband',
        'edition' => 'DSA4.1',
        'genre' => '',
        'series' => 'Die Phileasson-Saga (1999)',
        'contained_in' => '',
        'place_name' => '',
        'place_kind' => 'unresolved',
        'place_public_id' => null,
    ],
    [
        'public_id' => 'adv-3',
        'title' => 'Der unerwuenschte Gast',
        'product_type' => 'szenario',
        'edition' => 'DSA3',
        'genre' => 'Stadtabenteuer',
        'series' => '',
        'contained_in' => 'Abenteuer in Gareth',
        'place_name' => 'Koenigreich Garetien',
        'place_kind' => 'territory',
        'place_public_id' => 'terr-garetien',
    ],
];

$entries = avesmapsBuildAdventureSearchEntries($rows, $labels);
assert(count($entries) === 3);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// Kind and jump target. The place travels with its KIND -- only the client can turn that into a
// lookup key, because only it knows what is currently on the map.
assert($byId['adv-1']['kind'] === 'adventure');
assert($byId['adv-1']['place_public_id'] === 'loc-gareth');
assert($byId['adv-1']['place_kind'] === 'settlement');
assert($byId['adv-1']['place_name'] === 'Gareth');
assert($byId['adv-1']['not_on_map'] === true);
assert($byId['adv-1']['unresolved'] === false);

// A territory start place must NOT be mistaken for unresolved -- 134 of 976 resolved start places
// hang on a territory, 311 on a region.
assert($byId['adv-3']['place_kind'] === 'territory');
assert($byId['adv-3']['unresolved'] === false);

// No start place at all: findable, but carries no target.
assert($byId['adv-2']['place_public_id'] === '');
assert($byId['adv-2']['unresolved'] === true);

// The type line carries product type AND edition. The edition is not decoration: 29 titles are
// handed out twice or more ("Silvanas Befreiung" 3x), and two identical rows are indistinguishable.
assert($byId['adv-1']['type_label'] === 'Gruppenabenteuer · DSA5');
assert($byId['adv-2']['type_label'] === 'Kampagnenband · DSA4.1');

// Product types match by KEY and by LABEL. kampagnenband/metaband are live (27 + 5) but MISSING from
// the client table js/map-features/map-features-adventures.js, where they fall back to the raw key.
assert(avesmapsCalculateSearchScore($byId['adv-2'], avesmapsNormalizeSearchText('kampagnenband')) !== null);
assert(avesmapsCalculateSearchScore($byId['adv-2'], avesmapsNormalizeSearchText('Kampagnenband')) !== null);
assert(isset($labels['metaband']));

// metaband gets the SAME proof as kampagnenband above, not just the label-table isset() check: a real
// entry, built with the real row shape, must match on the raw key AND on the beautified label.
$metabandEntry = avesmapsBuildAdventureSearchEntries([[
    'public_id' => 'adv-4',
    'title' => 'Der Splitterfall-Kompendium',
    'product_type' => 'metaband',
    'edition' => 'DSA5',
]], $labels)[0];
assert(avesmapsCalculateSearchScore($metabandEntry, avesmapsNormalizeSearchText('metaband')) !== null);
assert(avesmapsCalculateSearchScore($metabandEntry, avesmapsNormalizeSearchText('Metaband')) !== null);

// THE MULTI-WORD CASE this feature exists for: the genre says "Stadtabenteuer", the start place says
// "Gareth", and no single search text contains both.
assert(avesmapsCalculateSearchScore($byId['adv-3'], avesmapsNormalizeSearchText('stadtabenteuer garetien')) !== null);

// Series and containing product are searchable.
assert(avesmapsCalculateSearchScore($byId['adv-2'], avesmapsNormalizeSearchText('phileasson')) !== null);
assert(avesmapsCalculateSearchScore($byId['adv-3'], avesmapsNormalizeSearchText('abenteuer in gareth')) !== null);

// The start place IS a search text -- that is how "stadtabenteuer gareth" finds an adventure whose
// title says neither word.
$haystack = implode(' | ', $byId['adv-1']['search_texts']);
assert(str_contains($haystack, 'Gareth'));
assert(str_contains($haystack, 'Die Verschwoerung von Gareth'));

// 💣 THE SPOILER RULE lives in the SQL, and SQL is not unit-testable without a database -- so it is
// pinned statically. Dropping `role = 'start'` from the join would silently turn every play location
// into a searchable, jumpable, printable fact, and nothing else in this file would notice.
$librarySource = file_get_contents(__DIR__ . '/../adventure-search.php');
assert(is_string($librarySource));
assert(str_contains($librarySource, "p2.role = 'start'"));

// The builder must not invent fields either: anything the fetch did not select stays out of the entry.
$leaky = avesmapsBuildAdventureSearchEntries([[
    'public_id' => 'adv-9',
    'title' => 'Leck',
    'product_type' => 'szenario',
    'edition' => 'DSA5',
    'place_name' => 'Gareth',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-gareth',
    'play_place_name' => 'Havena',
]], $labels)[0];
assert(!str_contains(mb_strtolower(implode(' | ', $leaky['search_texts'])), 'havena'));

// Edition sort key: DSA5 before DSA4.1 before DSA4 before DSA1, then non-DSA, then empty. Mirrors
// avesmapsAdventureEditionSortKey in js/map-features/map-features-adventures.js.
assert(avesmapsAdventureSearchEditionSortKey('DSA5') < avesmapsAdventureSearchEditionSortKey('DSA4.1'));
assert(avesmapsAdventureSearchEditionSortKey('DSA4.1') < avesmapsAdventureSearchEditionSortKey('DSA4'));
assert(avesmapsAdventureSearchEditionSortKey('DSA4 Basis') === avesmapsAdventureSearchEditionSortKey('DSA4'));
assert(avesmapsAdventureSearchEditionSortKey('DSA1-Ausbau') === -1.0);
assert(avesmapsAdventureSearchEditionSortKey('Aventuria 2.0') === 1000.0);
assert(avesmapsAdventureSearchEditionSortKey('') === 1001.0);

// An empty title is not an adventure.
assert(avesmapsBuildAdventureSearchEntries([['public_id' => 'x', 'title' => '   ']], $labels) === []);

echo "adventure-search: OK\n";

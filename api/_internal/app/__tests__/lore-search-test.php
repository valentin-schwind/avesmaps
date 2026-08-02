<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../lore-search.php';

$labels = AVESMAPS_LORE_SEARCH_KIND_LABELS;

// Wiki markup in gruppe/typ is real: live values are "[[Fisch]]", "[[Parfüm]]", "profan".
assert(avesmapsLoreSearchStripWikiMarkup('[[Fisch]]') === 'Fisch');
assert(avesmapsLoreSearchStripWikiMarkup('[[Seite|Anzeige]]') === 'Anzeige');
assert(avesmapsLoreSearchStripWikiMarkup('profan') === 'profan');
assert(avesmapsLoreSearchStripWikiMarkup('') === '');

// Modelled on real rows (live 2026-08-02), not invented.
$entryRows = [
    ['wiki_key' => 'alraune', 'kind' => 'flora', 'name' => 'Alraune', 'gruppe' => '', 'typ' => ''],
    ['wiki_key' => 'aal', 'kind' => 'fauna', 'name' => 'Aal', 'gruppe' => '[[Fisch]]', 'typ' => ''],
    ['wiki_key' => '1001-rausch-parfum', 'kind' => 'ware', 'name' => '1001 Rausch', 'gruppe' => 'profan', 'typ' => '[[Parfuem]]'],
    ['wiki_key' => 'kein-ort', 'kind' => 'ware', 'name' => 'Ortlose Ware', 'gruppe' => 'profan', 'typ' => ''],
];
$placesByEntry = [
    'alraune' => [
        ['title' => 'Aventurien', 'wiki_key' => 'aventurien'],
        ['title' => 'Khôm', 'wiki_key' => 'kh-m'],
        ['title' => 'Nebelmoor', 'wiki_key' => 'nebelmoor'],
        ['title' => 'Myranor', 'wiki_key' => 'myranor'],
    ],
    'aal' => [
        ['title' => 'Meer der Sieben Winde', 'wiki_key' => 'meer-der-sieben-winde'],
    ],
    '1001-rausch-parfum' => [
        ['title' => 'Belhanka', 'wiki_key' => 'belhanka'],
    ],
];

$entries = avesmapsBuildLoreSearchEntries($entryRows, $placesByEntry, $labels);
assert(count($entries) === 4);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// A lore entry has no public id of its own -- its wiki_key IS its identity (AGENTS.md §5).
assert($byId['alraune']['kind'] === 'lore');
assert($byId['alraune']['type_label'] === 'Flora');
assert($byId['aal']['type_label'] === 'Fauna');
assert($byId['1001-rausch-parfum']['type_label'] === 'Ware');

// The places travel UNRESOLVED, title and wiki key both: lore_place stores no target_kind and no
// target_public_id at all (design §1.6), so the client is the only side that can resolve them.
assert($byId['alraune']['place_count'] === 4);
assert($byId['alraune']['lore_places'][1]['title'] === 'Khôm');
assert($byId['alraune']['lore_places'][1]['wiki_key'] === 'kh-m');
assert($byId['kein-ort']['place_count'] === 0);
assert($byId['kein-ort']['lore_places'] === []);

// Place titles are search texts -- that is the whole point of the reverse direction: "wo gibt es das?"
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('nebelmoor')) !== null);
assert(avesmapsCalculateSearchScore($byId['aal'], avesmapsNormalizeSearchText('meer winde')) !== null);

// Name, kind label and kind key all match.
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('alraune')) !== null);
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('flora')) !== null);

// 💣 The wiki brackets must be GONE from the search texts. With them, "[[fisch]]" is a search text in
// its own right and a reader who typed "fisch" gets a row whose connection is invisible.
$haystack = implode(' | ', $byId['aal']['search_texts']);
assert(str_contains($haystack, 'Fisch'));
assert(!str_contains($haystack, '[['));
assert(avesmapsCalculateSearchScore($byId['aal'], avesmapsNormalizeSearchText('fisch')) !== null);
assert(avesmapsCalculateSearchScore($byId['1001-rausch-parfum'], avesmapsNormalizeSearchText('parfuem')) !== null);

// The raw wiki_key is NOT a search text: it is a join key, and "1001-rausch-parfum" is not a word
// anyone types. lebensraum and continent stay out too (78 of 500 / thin).
assert(!in_array('1001-rausch-parfum', $byId['1001-rausch-parfum']['search_texts'], true));
assert(!in_array('', $byId['alraune']['search_texts'], true));

// A row without a name or without a key is not an entry.
assert(avesmapsBuildLoreSearchEntries([['wiki_key' => 'x', 'kind' => 'flora', 'name' => '  ']], [], $labels) === []);
assert(avesmapsBuildLoreSearchEntries([['wiki_key' => '', 'kind' => 'flora', 'name' => 'X']], [], $labels) === []);

// 💣 The kind switch is PER KIND and its default differs: spezies is OFF unless switched on, the other
// three are ON unless switched off (avesmapsLoreKindDefaultEnabled).
assert(AVESMAPS_LORE_SEARCH_KINDS === ['flora', 'fauna', 'spezies', 'ware']);
assert(avesmapsLoreSearchKindDefaultEnabled('flora') === true);
assert(avesmapsLoreSearchKindDefaultEnabled('ware') === true);
assert(avesmapsLoreSearchKindDefaultEnabled('spezies') === false);
assert(avesmapsLoreSearchSettingKey('fauna') === 'lore_kind_fauna_enabled');

// Reading a stored value: '' means "never written" -> default, '0' means off, anything else on.
assert(avesmapsLoreSearchKindIsEnabled('spezies', '') === false);
assert(avesmapsLoreSearchKindIsEnabled('spezies', '1') === true);
assert(avesmapsLoreSearchKindIsEnabled('flora', '') === true);
assert(avesmapsLoreSearchKindIsEnabled('flora', '0') === false);

echo "lore-search: OK\n";

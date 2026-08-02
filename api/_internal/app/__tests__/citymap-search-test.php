<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../citymap-search.php';

$labels = AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS;

// Modelled on real rows (live 2026-08-02), not invented.
$rows = [
    [
        'public_id' => 'cm-1',
        'title' => 'Plan des alten Schlosses',
        'types' => 'grundriss',
        'publisher' => 'Ulisses Spiele',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ],
    [
        'public_id' => 'cm-2',
        'title' => 'Stadtplan von Gareth (Herz des Reiches)',
        'types' => 'stadtplan',
        'publisher' => 'Ulisses Spiele',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ],
    [
        'public_id' => 'cm-3',
        'title' => 'Karte von Bosparan',
        'types' => 'uebersicht',
        'publisher' => '',
        'place_name' => 'Bosparan',
        'place_kind' => 'unresolved',
        'place_public_id' => null,
    ],
];

$entries = avesmapsBuildCitymapSearchEntries($rows, $labels);
assert(count($entries) === 3);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// Kind and jump target. The place travels with its KIND -- only the client can turn that into a
// lookup key, because only it knows what is currently on the map.
assert($byId['cm-1']['kind'] === 'citymap');
assert($byId['cm-1']['place_public_id'] === 'loc-gareth');
assert($byId['cm-1']['place_kind'] === 'settlement');
assert($byId['cm-1']['not_on_map'] === true);

// THE CASE THIS EXISTS FOR: the title never says "Gareth", the assigned place does.
$score = avesmapsCalculateSearchScore($byId['cm-1'], avesmapsNormalizeSearchText('gareth'));
assert($score !== null);

// Types match by KEY and by LABEL -- the payload carries 'uebersicht', a human types 'Übersicht'.
assert(avesmapsCalculateSearchScore($byId['cm-3'], avesmapsNormalizeSearchText('uebersicht')) !== null);
assert(avesmapsCalculateSearchScore($byId['cm-3'], avesmapsNormalizeSearchText('Übersicht')) !== null);

// The multi-word case from the design doc.
assert(avesmapsCalculateSearchScore($byId['cm-2'], avesmapsNormalizeSearchText('stadtplan gareth')) !== null);

// A map whose place never resolved stays FINDABLE but carries no target.
assert($byId['cm-3']['place_public_id'] === '');
assert($byId['cm-3']['unresolved'] === true);
assert($byId['cm-1']['unresolved'] === false);

// A REGIONAL map must NOT be mistaken for unresolved -- 59 of 455 hang on a region, not a settlement.
$regional = avesmapsBuildCitymapSearchEntries([[
    'public_id' => 'cm-4',
    'title' => 'Politische Karte der Flusslande',
    'types' => 'region',
    'publisher' => '',
    'place_name' => 'Flusslande',
    'place_kind' => 'region',
    'place_public_id' => 'reg-flusslande',
]], $labels)[0];
assert($regional['place_kind'] === 'region');
assert($regional['unresolved'] === false);

// The type line carries type AND place -- "Plan des alten Schlosses" alone reads like a stray row.
assert($byId['cm-1']['type_label'] === 'Grundriss · Gareth');
assert($byId['cm-3']['type_label'] === 'Übersicht · Bosparan');

// The publisher is searchable; note/author are deliberately NOT among the search texts (freetext with
// wiki leftovers / filled on 64 of 455 -- both are noise against title, place and type).
$haystack = implode(' | ', $byId['cm-2']['search_texts']);
assert(str_contains($haystack, 'Ulisses'));
assert(str_contains($haystack, 'Stadtplan von Gareth (Herz des Reiches)'));

echo "citymap-search: OK\n";

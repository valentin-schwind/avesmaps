<?php

declare(strict_types=1);

// Proves the section cap: avesmapsCollectSearchSection is the feature's load-bearing invariant --
// every capped section (Kartensammlung, adventures, occurrences) runs through it -- and until this
// file existed, nothing proved it. It used to live inline in api/app/map-search.php, an ENDPOINT, so
// no test could reach it; moved to api/_internal/app/search-section.php for exactly that reason (same
// precedent as map-search-scoring.php: read that file's header).
//
// Entries are built with the REAL builders (avesmapsBuildGameLiteratureSearchEntries,
// avesmapsBuildLoreSearchEntries, avesmapsBuildCitymapSearchEntries) rather than hand-written arrays,
// so this test breaks if an entry shape drifts out from under the comparators.

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../search-section.php';
require_once __DIR__ . '/../citymap-search.php';
require_once __DIR__ . '/../game-literature-search.php';
require_once __DIR__ . '/../lore-search.php';

// ---- the cap itself: 8 matches capped to 5, and the total is counted BEFORE the cap -----------------
// The total feeds the "... und N weitere" overflow line (js/ui/spotlight-search.js,
// SPOTLIGHT_SEARCH_SECTIONS). Counting it AFTER the cap would always report the cap itself (5 of 5),
// which would render "... und 0 weitere" no matter how many more actually exist.
$matchingGameLiteratureRows = [];
for ($i = 1; $i <= 8; $i++) {
    $matchingGameLiteratureRows[] = [
        'public_id' => "adv-cap-$i",
        'title' => "Testabenteuer $i",
        'product_type' => 'szenario',
        'edition' => 'DSA5',
        'genre' => '',
        'series' => '',
        'contained_in' => '',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ];
}
// A ninth row that does NOT match the query -- it must be excluded from both the capped list AND the
// total. If the total counted it, feeding 8 matches would report 9.
$nonMatchingGameLiteratureRow = [
    'public_id' => 'adv-cap-miss',
    'title' => 'Voellig Anderes',
    'product_type' => 'szenario',
    'edition' => 'DSA5',
    'genre' => '',
    'series' => '',
    'contained_in' => '',
    'place_name' => 'Havena',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-havena',
];
$capEntries = avesmapsBuildGameLiteratureSearchEntries(
    array_merge($matchingGameLiteratureRows, [$nonMatchingGameLiteratureRow]),
    AVESMAPS_GAME_LITERATURE_SEARCH_TYPE_LABELS
);
[$capped, $capTotal] = avesmapsCollectSearchSection(
    $capEntries,
    avesmapsNormalizeSearchText('testabenteuer'),
    'avesmapsGameLiteratureSearchCompare',
    5
);
assert(count($capped) === 5);
assert($capTotal === 8);
foreach ($capped as $cappedEntry) {
    assert($cappedEntry['public_id'] !== 'adv-cap-miss');
}

// ---- a limit larger than the match count returns everything, and the total equals the count --------
$smallLoreRows = [
    ['wiki_key' => 'small-1', 'kind' => 'ware', 'name' => 'Testware Eins', 'gruppe' => '', 'typ' => ''],
    ['wiki_key' => 'small-2', 'kind' => 'ware', 'name' => 'Testware Zwei', 'gruppe' => '', 'typ' => ''],
    ['wiki_key' => 'small-3', 'kind' => 'ware', 'name' => 'Testware Drei', 'gruppe' => '', 'typ' => ''],
];
$smallEntries = avesmapsBuildLoreSearchEntries($smallLoreRows, [], AVESMAPS_LORE_SEARCH_KIND_LABELS);
[$smallResults, $smallTotal] = avesmapsCollectSearchSection(
    $smallEntries,
    avesmapsNormalizeSearchText('testware'),
    'avesmapsLoreSearchCompare',
    100
);
assert(count($smallResults) === 3);
assert($smallTotal === 3);

// ---- adventures: resolved ranks before unresolved, EVEN when the unresolved one scores better --------
// The place_name deliberately does NOT contain "gareth" on either row, so the only source of a match is
// the title -- proving the resolved entry's score really is the numerically WORSE one, not a coincidence
// of some other search text.
$gameLiteratureResolvedWorseRow = [
    'public_id' => 'adv-rank-resolved',
    'title' => 'Xgarethx', // contains "gareth" -> tier 3 (contained), the WORSE score
    'product_type' => 'szenario',
    'edition' => 'DSA5',
    'genre' => '',
    'series' => '',
    'contained_in' => '',
    'place_name' => 'Havena',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-havena',
];
$gameLiteratureUnresolvedBetterRow = [
    'public_id' => 'adv-rank-unresolved',
    'title' => 'Gareth', // exact match -> tier 0, the BETTER score
    'product_type' => 'szenario',
    'edition' => 'DSA5',
    'genre' => '',
    'series' => '',
    'contained_in' => '',
    'place_name' => '',
    'place_kind' => 'unresolved',
    'place_public_id' => null,
];
$gameLiteratureRankEntries = avesmapsBuildGameLiteratureSearchEntries(
    [$gameLiteratureUnresolvedBetterRow, $gameLiteratureResolvedWorseRow],
    AVESMAPS_GAME_LITERATURE_SEARCH_TYPE_LABELS
);
[$gameLiteratureRanked, $gameLiteratureRankTotal] = avesmapsCollectSearchSection(
    $gameLiteratureRankEntries,
    avesmapsNormalizeSearchText('gareth'),
    'avesmapsGameLiteratureSearchCompare',
    5
);
assert($gameLiteratureRankTotal === 2);
assert($gameLiteratureRanked[0]['public_id'] === 'adv-rank-resolved');
assert($gameLiteratureRanked[0]['unresolved'] === false);
assert($gameLiteratureRanked[1]['public_id'] === 'adv-rank-unresolved');
assert($gameLiteratureRanked[1]['unresolved'] === true);
// The premise: the WINNER (resolved) has the numerically WORSE (higher) score than the entry it beat.
assert($gameLiteratureRanked[0]['score'] > $gameLiteratureRanked[1]['score']);

// ---- adventures: at equal score AND equal resolvedness, the LOWER edition_sort_key (newer) wins ------
// Same title on both rows guarantees an identical score; both places resolved guarantees equal
// resolvedness -- so the edition is the ONLY thing that can decide the order. Rows are listed
// oldest-first here, the opposite of the expected output, so a passing test cannot be an accident of
// input order.
$gameLiteratureEditionOlderRow = [
    'public_id' => 'adv-edition-old',
    'title' => 'Zukunft im Sand',
    'product_type' => 'szenario',
    'edition' => 'DSA4',
    'genre' => '',
    'series' => '',
    'contained_in' => '',
    'place_name' => 'Gareth',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-gareth',
];
$gameLiteratureEditionNewerRow = [
    'public_id' => 'adv-edition-new',
    'title' => 'Zukunft im Sand',
    'product_type' => 'szenario',
    'edition' => 'DSA5',
    'genre' => '',
    'series' => '',
    'contained_in' => '',
    'place_name' => 'Gareth',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-gareth',
];
$gameLiteratureEditionEntries = avesmapsBuildGameLiteratureSearchEntries(
    [$gameLiteratureEditionOlderRow, $gameLiteratureEditionNewerRow],
    AVESMAPS_GAME_LITERATURE_SEARCH_TYPE_LABELS
);
[$gameLiteratureEditionRanked, $gameLiteratureEditionTotal] = avesmapsCollectSearchSection(
    $gameLiteratureEditionEntries,
    avesmapsNormalizeSearchText('zukunft'),
    'avesmapsGameLiteratureSearchCompare',
    5
);
assert($gameLiteratureEditionTotal === 2);
// Confirm the premise first: equal resolvedness, equal score -- only the edition is left to decide.
assert($gameLiteratureEditionRanked[0]['unresolved'] === $gameLiteratureEditionRanked[1]['unresolved']);
assert($gameLiteratureEditionRanked[0]['score'] === $gameLiteratureEditionRanked[1]['score']);
assert($gameLiteratureEditionRanked[0]['public_id'] === 'adv-edition-new');
assert($gameLiteratureEditionRanked[1]['public_id'] === 'adv-edition-old');

// ---- occurrences: place_count === 0 ranks LAST, even with a better score ------------------------------
$loreUnplacedBetterRow = ['wiki_key' => 'unplaced-better', 'kind' => 'flora', 'name' => 'Alraune', 'gruppe' => '', 'typ' => ''];
$lorePlacedWorseRow = ['wiki_key' => 'placed-worse', 'kind' => 'flora', 'name' => 'Xalraunex', 'gruppe' => '', 'typ' => ''];
$lorePlacesByEntry = [
    // 'unplaced-better' gets no places at all -> place_count 0.
    'placed-worse' => [['title' => 'Nebelmoor', 'wiki_key' => 'nebelmoor']],
];
$loreRankEntries = avesmapsBuildLoreSearchEntries(
    [$loreUnplacedBetterRow, $lorePlacedWorseRow],
    $lorePlacesByEntry,
    AVESMAPS_LORE_SEARCH_KIND_LABELS
);
[$loreRanked, $loreRankTotal] = avesmapsCollectSearchSection(
    $loreRankEntries,
    avesmapsNormalizeSearchText('alraune'),
    'avesmapsLoreSearchCompare',
    5
);
assert($loreRankTotal === 2);
assert($loreRanked[0]['public_id'] === 'placed-worse');
assert($loreRanked[0]['place_count'] === 1);
assert($loreRanked[1]['public_id'] === 'unplaced-better');
assert($loreRanked[1]['place_count'] === 0);
// The premise: the winner (placed) has the numerically WORSE (higher) score than the entry it beat.
assert($loreRanked[0]['score'] > $loreRanked[1]['score']);

// ---- maps: a resolved map ranks before an unresolved one, even with a worse score ---------------------
$citymapResolvedWorseRow = [
    'public_id' => 'cm-rank-resolved',
    'title' => 'Xburgx', // contains "burg" -> tier 3, the WORSE score
    'types' => '',
    'publisher' => '',
    'place_name' => 'Havena',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-havena',
];
$citymapUnresolvedBetterRow = [
    'public_id' => 'cm-rank-unresolved',
    'title' => 'Burg', // exact match -> tier 0, the BETTER score
    'types' => '',
    'publisher' => '',
    'place_name' => '',
    'place_kind' => 'unresolved',
    'place_public_id' => null,
];
$citymapRankEntries = avesmapsBuildCitymapSearchEntries(
    [$citymapUnresolvedBetterRow, $citymapResolvedWorseRow],
    AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS
);
[$citymapRanked, $citymapRankTotal] = avesmapsCollectSearchSection(
    $citymapRankEntries,
    avesmapsNormalizeSearchText('burg'),
    'avesmapsCitymapSearchCompare',
    5
);
assert($citymapRankTotal === 2);
assert($citymapRanked[0]['public_id'] === 'cm-rank-resolved');
assert($citymapRanked[0]['unresolved'] === false);
assert($citymapRanked[1]['public_id'] === 'cm-rank-unresolved');
assert($citymapRanked[1]['unresolved'] === true);
assert($citymapRanked[0]['score'] > $citymapRanked[1]['score']);

// ---- maps: at equal score and equal resolvedness, NATURAL-order name decides --------------------------
// "Karte 2" vs "Karte 10": a naive string compare would put "Karte 10" first (the character '1' sorts
// before '2'), but strnatcasecmp reads the digits as numbers -- this is what pins the Kartensammlung's
// SHIPPED ordering, which the extraction out of map-search.php must not change. Rows are listed
// 10-before-2, the opposite of the expected output.
$citymapNaturalRowTen = [
    'public_id' => 'cm-natural-10',
    'title' => 'Karte 10',
    'types' => '',
    'publisher' => '',
    'place_name' => 'Gareth',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-gareth',
];
$citymapNaturalRowTwo = [
    'public_id' => 'cm-natural-2',
    'title' => 'Karte 2',
    'types' => '',
    'publisher' => '',
    'place_name' => 'Gareth',
    'place_kind' => 'settlement',
    'place_public_id' => 'loc-gareth',
];
$citymapNaturalEntries = avesmapsBuildCitymapSearchEntries(
    [$citymapNaturalRowTen, $citymapNaturalRowTwo],
    AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS
);
[$citymapNaturalRanked, $citymapNaturalTotal] = avesmapsCollectSearchSection(
    $citymapNaturalEntries,
    avesmapsNormalizeSearchText('karte'),
    'avesmapsCitymapSearchCompare',
    5
);
assert($citymapNaturalTotal === 2);
// Confirm the premise: both resolved, and an identical score (both match "karte" as a title prefix).
assert($citymapNaturalRanked[0]['unresolved'] === $citymapNaturalRanked[1]['unresolved']);
assert($citymapNaturalRanked[0]['score'] === $citymapNaturalRanked[1]['score']);
assert($citymapNaturalRanked[0]['public_id'] === 'cm-natural-2');
assert($citymapNaturalRanked[1]['public_id'] === 'cm-natural-10');

echo "search-section: OK\n";

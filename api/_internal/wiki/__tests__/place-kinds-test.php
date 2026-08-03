<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE place-kind catalogue in api/_internal/wiki/place-kinds.php.
 * No DB, no HTTP, no browser.
 *
 * The catalogue feeds two very different consumers -- the wiki crawl (which derives
 * wiki_sync_pages.building_type from literal [[Kategorie:]] links) and the map write path
 * (which snaps the editor's freely typed properties.place_kind onto it). The tests below
 * exist mostly to protect the ONE property that is easy to break and expensive to notice:
 * the head of the list is load-bearing order, and nothing new may disturb it.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/place-kinds-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the catalogue folds case with mb_strtolower().\n");
    exit(2);
}

require __DIR__ . '/../place-kinds.php';

// ------------------------------------------------------- THE LOAD-BEARING HEAD ---
// 🔴 This is the assert that matters. avesmapsWikiDumpCategoryAssembleBuildingMap keeps the
// FIRST type that claims a title, so the 24 entries the dump already classifies against must
// keep both their content and their order. Everything added for the editor rides BEHIND them
// and therefore cannot reclassify a single existing article. Written out verbatim on purpose:
// a test that re-derives the expectation from the constant would pass no matter what happens.
$legacyHead = [
    'Festung', 'Festungsruine', 'Historische Festung', 'Tempel', 'Turm', 'Ruine', 'Palast', 'Kloster', 'Leuchtturm',
    'Steinkreis', 'Hexentanzplatz', 'Heiligtum', 'Schrein', 'Toteninsel', 'Borbarad-Kultstätte', 'Pforte des Grauens',
    'Kultstätte', 'Unheiligtum',
    'Höhle', 'Grotte', 'Sphärenruptur', 'Drachenhort', 'Feentor',
    'Bauwerk',
];
assert(count($legacyHead) === AVESMAPS_PLACE_KIND_LEGACY_PREFIX_LENGTH);
assert(avesmapsPlaceKindLegacyPrefix() === $legacyHead);
// The specific kind must still precede its umbrella -- the rule the head encodes.
$pos = static fn(string $k): int => (int) array_search($k, AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, true);
assert($pos('Steinkreis') < $pos('Kultstätte'));
assert($pos('Hexentanzplatz') < $pos('Kultstätte'));
assert($pos('Pforte des Grauens') < $pos('Unheiligtum'));
echo "legacy head intact\n";

// ------------------------------------------------------------------ CATALOGUE ---
$catalog = avesmapsPlaceKindCatalog();
// Every name appears once. A duplicate would show up twice in the editor's list.
assert(count($catalog) === count(array_unique($catalog)));
// The three reasons a name is absent from the editor list, one assert each.
assert(!in_array('Ruine', $catalog, true));    // is_ruined is its own flag
assert(!in_array('Bauwerk', $catalog, true));  // the umbrella says nothing
assert(!in_array('Straße', $catalog, true));   // a Weg, never in the catalogue at all
assert(!in_array('Mauer', $catalog, true));    // linear infrastructure, filtered
assert(!in_array('Kanalisation', $catalog, true));
assert(!in_array('Äquadukt', $catalog, true));
// ... but the two HIDDEN ones stay in the raw catalogue, because the crawl still needs them.
assert(in_array('Ruine', AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, true));
assert(in_array('Bauwerk', AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, true));
// Sample of what the editor gained: one per source category.
assert(in_array('Brücke', $catalog, true));      // Bauwerk nach Art
assert(in_array('Karawanserei', $catalog, true)); // Bauwerk nach Verwendung
assert(in_array('Oase', $catalog, true));         // Siedlung nach Art
assert(in_array('Festung', $catalog, true));      // and the legacy head is still offered
echo 'catalogue ok (' . count($catalog) . " selectable kinds)\n";

// ------------------------------------------------------------- NORMALISATION ---
assert(avesmapsNormalizePlaceKind('') === '');
assert(avesmapsNormalizePlaceKind('   ') === '');
assert(avesmapsNormalizePlaceKind('Brücke') === 'Brücke');
// Case folding is the whole point: three spellings, one stored value.
assert(avesmapsNormalizePlaceKind('brücke') === 'Brücke');
assert(avesmapsNormalizePlaceKind('BRÜCKE') === 'Brücke');
assert(avesmapsNormalizePlaceKind('  Brücke  ') === 'Brücke');
// A name the catalogue does not know is passed through, not rejected -- the wiki may know a
// kind this list does not, and the editor must not be blocked by that.
assert(avesmapsNormalizePlaceKind('Wachhäuschen') === 'Wachhäuschen');
// Hidden and excluded names never become a stored value, however they are typed.
assert(avesmapsNormalizePlaceKind('Ruine') === '');
assert(avesmapsNormalizePlaceKind('ruine') === '');
assert(avesmapsNormalizePlaceKind('Bauwerk') === '');
assert(avesmapsNormalizePlaceKind('Straße') === '');
assert(avesmapsNormalizePlaceKind('strasse') === '');  // the fold makes ss/ß the same answer
assert(avesmapsNormalizePlaceKind('Mauer') === '');
// Length is capped at the width of wiki_sync_pages.building_type, counted in CHARACTERS --
// a byte-wise cut would split an umlaut in half and store invalid UTF-8.
$long = str_repeat('ä', 200);
assert(mb_strlen(avesmapsNormalizePlaceKind($long), 'UTF-8') === AVESMAPS_PLACE_KIND_MAX_LENGTH);
assert(avesmapsNormalizePlaceKind($long) === str_repeat('ä', AVESMAPS_PLACE_KIND_MAX_LENGTH));
echo "normalisation ok\n";

// -------------------------------------------------------------------- FILTER ---
// The server-side filter states the rule the client mirrors in memory; both must agree, or
// the typed term and the offered list drift apart.
assert(avesmapsFilterPlaceKinds($catalog, '') === $catalog);
assert(avesmapsFilterPlaceKinds($catalog, '   ') === $catalog);
assert(in_array('Brücke', avesmapsFilterPlaceKinds($catalog, 'brü'), true));
assert(in_array('Brücke', avesmapsFilterPlaceKinds($catalog, 'BRÜ'), true));
assert(!in_array('Oase', avesmapsFilterPlaceKinds($catalog, 'brü'), true));
// Substring, not prefix: "haus" must find Wohnhaus, Gildenhaus, Zunfthaus, Lagerhaus.
$haus = avesmapsFilterPlaceKinds($catalog, 'haus');
assert(in_array('Wohnhaus', $haus, true));
assert(in_array('Gildenhaus', $haus, true));
assert(avesmapsFilterPlaceKinds($catalog, 'zzzz') === []);
echo "filter ok\n";

// -------------------------------------------------------------------- RANKING ---
// Frequency decides, alphabet breaks ties, and a kind nobody has used yet still appears -- the
// editor must be able to be the FIRST to file something as a Karawanserei.
$ranked = avesmapsRankPlaceKinds(['Oase', 'Festung', 'Brücke', 'Karawanserei'], ['Festung' => 421, 'Brücke' => 40, 'Oase' => 40]);
assert(array_column($ranked, 'kind') === ['Festung', 'Brücke', 'Oase', 'Karawanserei']);
assert($ranked[3]['count'] === 0);
// Same counts in, same order out -- twice. A ranking that reshuffles between two requests moves
// the entry under the cursor of someone who is mid-click.
$again = avesmapsRankPlaceKinds(['Oase', 'Festung', 'Brücke', 'Karawanserei'], ['Festung' => 421, 'Brücke' => 40, 'Oase' => 40]);
assert($again === $ranked);
// The real catalogue survives an empty count map (fresh installation, no wiki registry).
$cold = avesmapsRankPlaceKinds($catalog, []);
assert(count($cold) === count($catalog));
assert(array_sum(array_column($cold, 'count')) === 0);
echo "ranking ok\n";

echo "\nALL PLACE-KIND TESTS PASSED\n";

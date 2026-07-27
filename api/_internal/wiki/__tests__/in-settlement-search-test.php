<?php

declare(strict_types=1);

/**
 * Unit tests for the third map-search source: objects that lie INSIDE a settlement and
 * therefore have no map position of their own (Villa Gerbelstein, Plaza der Lüste, the
 * Webergasse). They are found by name and jump to their CITY.
 *
 * Pure functions only -- no DB, no HTTP. The fixtures are real values from the 2026-07-27
 * measurement run.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/in-settlement-search-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n");
    exit(2);
}

// Side-effect free on include (only const + function defs) -- that is exactly why the pure
// builders live here and not in the endpoint, which bootstraps and connects on include.
require __DIR__ . '/../../app/in-settlement-search.php';

// --------------------------------------------------------------- SETTLEMENT INDEX ---
$featureRows = [
    ['feature_type' => 'location', 'feature_subtype' => 'grossstadt', 'name' => 'Mengbilla', 'public_id' => 'pid-mengbilla', 'min_x' => 10.0, 'min_y' => 20.0, 'max_x' => 10.0, 'max_y' => 20.0],
    ['feature_type' => 'location', 'feature_subtype' => 'metropole',  'name' => 'Gareth',    'public_id' => 'pid-gareth',    'min_x' => 30.0, 'min_y' => 40.0, 'max_x' => 30.0, 'max_y' => 40.0],
    // A BUILDING must never become a container: otherwise one building's name could mark
    // another as being "inside" it.
    ['feature_type' => 'location', 'feature_subtype' => 'gebaeude',   'name' => 'Burg Fürstenhort', 'public_id' => 'pid-burg', 'min_x' => 1.0, 'min_y' => 1.0, 'max_x' => 1.0, 'max_y' => 1.0],
    ['feature_type' => 'region',   'feature_subtype' => '',           'name' => 'Koschberge',  'public_id' => 'pid-kosch',  'min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 5.0, 'max_y' => 5.0],
    // Two places of the SAME name -> the name must be dropped, not resolved by coin flip.
    ['feature_type' => 'location', 'feature_subtype' => 'dorf', 'name' => 'Zwilling', 'public_id' => 'pid-a', 'min_x' => 1.0, 'min_y' => 1.0, 'max_x' => 1.0, 'max_y' => 1.0],
    ['feature_type' => 'location', 'feature_subtype' => 'dorf', 'name' => 'Zwilling', 'public_id' => 'pid-b', 'min_x' => 9.0, 'min_y' => 9.0, 'max_x' => 9.0, 'max_y' => 9.0],
];
$index = avesmapsBuildSettlementLocationIndex($featureRows);

assert(isset($index['mengbilla']), 'a settlement must be indexed');
assert($index['mengbilla']['public_id'] === 'pid-mengbilla');
assert($index['mengbilla']['min_x'] === 10.0 && $index['mengbilla']['min_y'] === 20.0);
assert(!isset($index['burg fürstenhort']), 'a BUILDING is not a container and must not be indexed');
assert(!isset($index['koschberge']), 'a region is not a settlement');
assert(!isset($index['zwilling']), 'an AMBIGUOUS name must be dropped -- any jump would be a coin flip');
echo "settlement-index ok\n";

// --------------------------------------------------------------------- ENTRIES ---
$scopeIndex = [
    'settlements' => avesmapsPlaceScopeBuildNameSet(['Mengbilla', 'Gareth', 'Abagund', 'Zwilling']),
    'regions' => avesmapsPlaceScopeBuildNameSet(['Koschberge', 'Abagund']), // Abagund: city AND barony
];
$registryRows = [
    ['title' => 'Plaza der Lüste', 'raw' => '[[Mengbilla]]', 'type_label' => 'Platz', 'wiki_url' => 'https://wiki/Plaza'],
    ['title' => 'Stadionmarkt', 'raw' => '[[Gareth]]: [[Arenaviertel]]', 'type_label' => 'Platz', 'wiki_url' => ''],
    // Outside -> not a hit at all (it belongs on the map, and may already be on it).
    ['title' => 'Burg Fürstenhort', 'raw' => '[[Koschberge]]: [[Greings Klamm]]', 'type_label' => 'Festung', 'wiki_url' => ''],
    // Ambiguous -> deliberately dropped: jumping to the wrong city is worse than no hit.
    ['title' => 'Burg Draustein', 'raw' => '[[Albernia]]: [[Abagund]]', 'type_label' => 'Festung', 'wiki_url' => ''],
    // City is not on the map (or ambiguous there) -> nothing to jump to.
    ['title' => 'Irgendwas', 'raw' => '[[Zwilling]]', 'type_label' => 'Turm', 'wiki_url' => ''],
    // No location field at all.
    ['title' => 'Ohne Standort', 'raw' => '', 'type_label' => 'Turm', 'wiki_url' => ''],
];
$entries = avesmapsBuildInSettlementSearchEntries($registryRows, $index, $scopeIndex);

assert(count($entries) === 2, 'exactly the two unambiguous inside-objects with a mapped city, got ' . count($entries));

$plaza = $entries[0];
assert($plaza['kind'] === 'in_settlement');
assert($plaza['name'] === 'Plaza der Lüste', 'the hit is named after the OBJECT, not the city');
assert($plaza['type_label'] === 'Platz in Mengbilla', 'the label must name the city, got ' . $plaza['type_label']);
// 💣 The jump target is the CITY -- that is what makes the existing location focus work
// unchanged, and it is why the label has to say "not on the map".
assert($plaza['public_id'] === 'pid-mengbilla');
assert($plaza['settlement_public_id'] === 'pid-mengbilla');
assert($plaza['settlement_name'] === 'Mengbilla');
assert($plaza['min_x'] === 10.0 && $plaza['max_y'] === 20.0, 'bounds are the city\'s');
assert($plaza['wiki_url'] === 'https://wiki/Plaza');
// Searching must find the OBJECT only. If the city name were a search text, typing
// "Mengbilla" would return its 32 inside-objects on top of the city itself.
assert($plaza['search_texts'] === ['Plaza der Lüste'], 'only the object name is searchable');

$stadionmarkt = $entries[1];
assert($stadionmarkt['name'] === 'Stadionmarkt');
assert($stadionmarkt['type_label'] === 'Platz in Gareth', 'the COARSEST settlement in the chain wins');
assert($stadionmarkt['public_id'] === 'pid-gareth');
echo "entries ok\n";

// Empty inputs must not explode.
assert(avesmapsBuildInSettlementSearchEntries([], $index, $scopeIndex) === []);
assert(avesmapsBuildInSettlementSearchEntries($registryRows, [], $scopeIndex) === [], 'no cities -> no hits');
assert(avesmapsBuildSettlementLocationIndex([]) === []);
echo "empty-inputs ok\n";

// ------------------------------------------------------------------ SORT ORDER ---
// Inside-objects must rank BEHIND everything that is really on the map: they are a pointer
// to a city, not a map object. avesmapsSearchKindOrder lives in the endpoint (which cannot
// be included here), so the ordering is asserted against its source instead of executed.
$endpointSource = (string) file_get_contents(__DIR__ . '/../../../app/map-search.php');
assert(
    preg_match("/'in_settlement' => 5,/", $endpointSource) === 1,
    "in_settlement must sort after location(0)/label(1)/region(2)/path(3)/powerline(4)"
);
echo "sort-order ok\n";

echo "\nALL IN-SETTLEMENT SEARCH TESTS PASSED\n";

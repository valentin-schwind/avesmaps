<?php

declare(strict_types=1);

/**
 * Unit tests for the pure matcher in api/_internal/app/adventure-resolve.php.
 * No DB, no HTTP -- avesmapsAdventureMatchCandidates() is a pure function and adventure-resolve.php
 * (plus the political + adventures libs it includes) is side-effect-free on include (function/const
 * defs only), so this test can `require` it with no MySQL. Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/adventure-resolve-test.php
 * Exit 0 = all asserts passed.
 *
 * NB: candidate keys are built with the SAME slugger the resolver uses (avesmapsPoliticalSlug), so
 * key equality holds by construction. The unit under test is the PRECEDENCE + bare-slug + unresolved
 * matching LOGIC -- iconv's locale-dependent transliteration of umlauts is a live/DB concern and is
 * verified against the real catalog, not here.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../adventure-resolve.php';

// Candidate key-maps built with the resolver's own slugger (consistent by construction).
$settlementKey = avesmapsAdventureCanonicalKeyForName('Gareth');
$territoryKey  = avesmapsAdventureCanonicalKeyForName('Königreich Garetien');
$regionKey     = avesmapsAdventureCanonicalKeyForName('Hardener Seenplatte');
$pathBareSlug  = avesmapsPoliticalSlug('Bornstraße'); // path keys are UNPREFIXED (no 'wiki:')

$candidates = [
    'settlement' => [$settlementKey => 'S-GARETH'],
    'territory'  => [$territoryKey  => 'T-GARETIEN'],
    'region'     => [$regionKey     => 'R-HARDENER'],
    'path'       => [$pathBareSlug  => 'P-BORNSTRASSE'],
];

// 1) settlement
$m = avesmapsAdventureMatchCandidates('Gareth', $candidates);
assert($m['kind'] === 'settlement' && $m['public_id'] === 'S-GARETH');
echo "settlement ok\n";

// 2) territory (umlaut in the name)
$m = avesmapsAdventureMatchCandidates('Königreich Garetien', $candidates);
assert($m['kind'] === 'territory' && $m['public_id'] === 'T-GARETIEN');
echo "territory ok\n";

// 3) region
$m = avesmapsAdventureMatchCandidates('Hardener Seenplatte', $candidates);
assert($m['kind'] === 'region' && $m['public_id'] === 'R-HARDENER');
echo "region ok\n";

// 4) path -- resolved via the BARE slug, and the returned wiki_key is NOT 'wiki:'-prefixed
$m = avesmapsAdventureMatchCandidates('Bornstraße', $candidates);
assert($m['kind'] === 'path' && $m['public_id'] === 'P-BORNSTRASSE');
assert(strncmp($m['wiki_key'], 'wiki:', 5) !== 0 && $m['wiki_key'] === $pathBareSlug);
echo "path ok\n";

// 5) case-insensitive: lower-case variant resolves to the same settlement key
$m = avesmapsAdventureMatchCandidates('gareth', $candidates);
assert($m['kind'] === 'settlement' && $m['public_id'] === 'S-GARETH');
echo "case ok\n";

// 6) unresolved: unknown name -> unresolved, canonical key preserved for later editor resolution
$m = avesmapsAdventureMatchCandidates('Ein voellig unbekannter Ort', $candidates);
assert($m['kind'] === 'unresolved' && $m['public_id'] === '' && strncmp($m['wiki_key'], 'wiki:', 5) === 0);
echo "unresolved ok\n";

// 7) precedence: the same key present as BOTH settlement and territory -> settlement wins
$dupeKey = avesmapsAdventureCanonicalKeyForName('Doppelort');
$dupe = ['settlement' => [$dupeKey => 'S-X'], 'territory' => [$dupeKey => 'T-X'], 'region' => [], 'path' => []];
$m = avesmapsAdventureMatchCandidates('Doppelort', $dupe);
assert($m['kind'] === 'settlement' && $m['public_id'] === 'S-X');
echo "precedence ok\n";

// 8) canonical key shape: 'wiki:'-prefixed for a real name, '' for blank
assert(strncmp(avesmapsAdventureCanonicalKeyForName('Gareth'), 'wiki:', 5) === 0);
assert(avesmapsAdventureCanonicalKeyForName('   ') === '');
echo "canonical ok\n";

// 9) de-parenthesised LAST RESORT. The wiki disambiguates by page title ("Havena (Siedlung)"), while a
// source mentioning the place just writes "Havena" -- on live data that cost Havena all 8 of its city
// maps, plus Cumrat and Donnerbach.
assert(avesmapsAdventureDeparenKeyForTitle('Havena (Siedlung)') === avesmapsAdventureCanonicalKeyForName('Havena'));
assert(avesmapsAdventureDeparenKeyForTitle('Havena_(Siedlung)') === avesmapsAdventureCanonicalKeyForName('Havena')); // URL form
assert(avesmapsAdventureDeparenKeyForTitle('Gareth') === '');            // no parenthetical -> no key
assert(avesmapsAdventureDeparenKeyForTitle('(Nur Klammer)') === '');     // nothing left of it
assert(avesmapsAdventurePageTitleFromUrl('https://de.wiki-aventurica.de/wiki/Havena_(Siedlung)') === 'Havena (Siedlung)');

$havenaKey = avesmapsAdventureCanonicalKeyForName('Havena (Siedlung)');
$cand = [
    'settlement' => [$havenaKey => 'S-HAV'], 'territory' => [], 'region' => [], 'path' => [],
    'settlement_deparen' => [avesmapsAdventureCanonicalKeyForName('Havena') => [['public_id' => 'S-HAV', 'wiki_key' => $havenaKey]]],
];
$m = avesmapsAdventureMatchCandidates('Havena', $cand);
assert($m['kind'] === 'settlement');
assert($m['public_id'] === 'S-HAV');
assert($m['wiki_key'] === $havenaKey); // the REAL page key, not the searched-for 'wiki:havena'
// The exact title still matches directly, unchanged.
assert(avesmapsAdventureMatchCandidates('Havena (Siedlung)', $cand)['public_id'] === 'S-HAV');

// AMBIGUOUS -> stays unresolved. The wiki also uses parentheticals to separate same-named places
// ("Berg (Nordmarken)" vs "Berg (Kosch)"); there the bare name has no answer, and guessing one would be
// worse than the honest raw_name.
$ambiguous = [
    'settlement' => [], 'territory' => [], 'region' => [], 'path' => [],
    'settlement_deparen' => [avesmapsAdventureCanonicalKeyForName('Berg') => [
        ['public_id' => 'S-1', 'wiki_key' => 'wiki:berg-nordmarken'],
        ['public_id' => 'S-2', 'wiki_key' => 'wiki:berg-kosch'],
    ]],
];
assert(avesmapsAdventureMatchCandidates('Berg', $ambiguous)['kind'] === 'unresolved');

// A DIRECT hit always wins -- the fallback may only ever turn unresolved into resolved, never redirect
// a name that already matches. This is what makes it safe for adventures, which share this resolver.
$both = [
    'settlement' => [], 'territory' => [], 'region' => [avesmapsAdventureCanonicalKeyForName('Thorwal') => 'R-THO'], 'path' => [],
    'settlement_deparen' => [avesmapsAdventureCanonicalKeyForName('Thorwal') => [['public_id' => 'S-THO', 'wiki_key' => 'wiki:thorwal-siedlung']]],
];
$m = avesmapsAdventureMatchCandidates('Thorwal', $both);
assert($m['kind'] === 'region' && $m['public_id'] === 'R-THO'); // unchanged behaviour, no silent re-target
// Callers that never build the *_deparen maps behave exactly as before.
assert(avesmapsAdventureMatchCandidates('Havena', ['settlement' => [], 'territory' => [], 'region' => [], 'path' => []])['kind'] === 'unresolved');
echo "deparen-fallback ok\n";

echo "ALL OK\n";

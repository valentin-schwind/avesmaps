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

echo "ALL OK\n";

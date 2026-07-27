<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of V6 "assign wiki regions to landscape areas": the grouping over region
 * rows and the two-signal dry-run gate. Everything DB-bound (the UPDATE, the audit log, the revision
 * bump) is provable only in the owner's live run -- there is no local MySQL (api/config.local.php is
 * absent). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
 *
 * (-d extension=mbstring only because the Windows dev PHP ships it unloaded; the server has it.)
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../ecosystem.php';

// ---- the join key -------------------------------------------------------------------------------------
// The whole point of the feature: the key a landscape region derives from a wiki URL must be
// byte-identical to the key wiki_region_staging was built with (avesmapsPoliticalSlug of the canonical
// article name, api/_internal/wiki/regions.php:507), or the join finds nothing and every row reads
// "Fläche(n): —" while the data is actually there.
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/Bilku') === 'bilku');
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/Bilku-Archipel') === 'bilku-archipel');
assert(avesmapsEcosystemWikiRegionKey('') === null, 'no URL -> no key, never a name fallback');

// ---- grouping -----------------------------------------------------------------------------------------
// Pure function over rows, so it is testable without a database. The two Bilku rows are the V5 leftover
// this feature exists to repair: the import made one region per area, so "Bilku" and "Sorak" are separate
// landscape regions that the wiki knows as ONE. Sharing the key is how they are brought together --
// idx_ecosystem_region_wiki is an INDEX, not UNIQUE, deliberately.
$rows = [
    ['public_id' => 'r1', 'name' => 'Bilku',        'kind' => 'derographisch', 'region_type' => 'insel', 'wiki_region_key' => 'bilku-archipel', 'area_count' => 1],
    ['public_id' => 'r2', 'name' => 'Sorak',        'kind' => 'derographisch', 'region_type' => 'insel', 'wiki_region_key' => 'bilku-archipel', 'area_count' => 2],
    ['public_id' => 'r3', 'name' => 'Angbarer See', 'kind' => 'topographie',   'region_type' => 'see',   'wiki_region_key' => 'angbarer-see',   'area_count' => 1],
    ['public_id' => 'r4', 'name' => 'Namenlos',     'kind' => 'topographie',   'region_type' => 'see',   'wiki_region_key' => null,             'area_count' => 1],
];
$grouped = avesmapsEcosystemGroupRegionsByWikiKey($rows);

assert(count($grouped['regions_by_wiki_key']) === 2, 'two distinct keys, the null one is not a key');
assert(count($grouped['regions_by_wiki_key']['bilku-archipel']) === 2, 'one wiki region, two landscape regions');
assert($grouped['regions_by_wiki_key']['bilku-archipel'][0]['area_count'] === 1);
assert($grouped['area_count_by_wiki_key']['bilku-archipel'] === 3, 'areas are summed across regions');
assert($grouped['unassigned_count'] === 1, 'a region without a key is counted, not dropped');
assert(!array_key_exists('', $grouped['regions_by_wiki_key']), 'no empty-string bucket');

// A whitespace-only key is the same nothing as null. Without the trim it would open an ' ' bucket that
// joins against no wiki row while looking, in the payload, exactly like a real assignment.
$blank = avesmapsEcosystemGroupRegionsByWikiKey([
    ['public_id' => 'r5', 'name' => 'Leer', 'kind' => 'vegetation', 'region_type' => null, 'wiki_region_key' => '   ', 'area_count' => 4],
]);
assert($blank['regions_by_wiki_key'] === [], 'a blank key opens no bucket');
assert($blank['unassigned_count'] === 1);
assert($blank['area_count_by_wiki_key'] === [], 'and contributes no area count either');

// region_type stays nullable through the grouping: "ohne Art" is a legitimate state (a region can be
// drawn before anybody decides what it is), and casting it to '' would make the picker show a type.
assert($blank !== null && $grouped['regions_by_wiki_key']['angbarer-see'][0]['region_type'] === 'see');
$noType = avesmapsEcosystemGroupRegionsByWikiKey([
    ['public_id' => 'r6', 'name' => 'Ohne Art', 'kind' => 'vegetation', 'region_type' => null, 'wiki_region_key' => 'ohne-art', 'area_count' => 0],
]);
assert($noType['regions_by_wiki_key']['ohne-art'][0]['region_type'] === null, 'no Art stays null, never ""');

echo "OK: ecosystem wiki assign -- key parity, grouping, blank keys\n";

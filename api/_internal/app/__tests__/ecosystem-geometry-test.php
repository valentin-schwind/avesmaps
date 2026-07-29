<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of the Landschaften layer (plan V2): geometry validation + bbox, the bbox
 * query parser, the expected_revision reader and the type vocabulary. Everything DB-bound (DDL, the
 * INNER JOIN read, the optimistic guard, the transactions) is provable only in the owner's live run --
 * there is no local MySQL (api/config.local.php is absent). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/ecosystem-geometry-test.php
 *
 * (-d extension=mbstring only because the Windows dev PHP ships it unloaded; the server has it, and the
 * whole codebase would be dead without it.)
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../ecosystem.php';
// For the vocabulary check below: avesmapsReadLabelSubtype is the LIVE allowlist
// (api/_internal/map/features.php:767), not a copy of it that could drift.
require __DIR__ . '/../../map/features.php';

function ecosystemTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

// ---- geometry: the happy paths -----------------------------------------------------------------------

// A closed Polygon ring survives unchanged, and the bbox is its extent.
$square = avesmapsEcosystemNormalizeGeometry([
    'type' => 'Polygon',
    'coordinates' => [[[10.0, 20.0], [30.0, 20.0], [30.0, 40.0], [10.0, 40.0], [10.0, 20.0]]],
]);
assert($square['geometry']['type'] === 'Polygon');
assert(count($square['geometry']['coordinates'][0]) === 5, 'closed ring keeps its 5 positions');
assert($square['bounds'] === ['min_x' => 10.0, 'min_y' => 20.0, 'max_x' => 30.0, 'max_y' => 40.0]);
assert($square['part_count'] === 1);

// 💣 COORDINATE ORDER. GeoJSON [x, y], never swapped -- Leaflet's [lat, lng] = [y, x] swap belongs to the
// drawing client (AGENTS.md §5). If this ever flips, every stored area lands transposed on the map and
// the bbox index silently stops matching the viewport.
assert($square['geometry']['coordinates'][0][1] === [30.0, 20.0], 'position round-trips as [x, y]');
assert($square['bounds']['min_x'] === 10.0 && $square['bounds']['min_y'] === 20.0, 'index 0 is x, index 1 is y');

// An OPEN ring is closed for the caller rather than rejected -- a drawing client naturally produces one.
$open = avesmapsEcosystemNormalizeGeometry([
    'type' => 'Polygon',
    'coordinates' => [[[0.0, 0.0], [5.0, 0.0], [5.0, 5.0]]],
]);
assert(count($open['geometry']['coordinates'][0]) === 4, 'open ring gets its closing position');
assert($open['geometry']['coordinates'][0][3] === [0.0, 0.0], 'the closing position repeats the first');

// A hole is just a second ring; the bbox still comes from every position.
$withHole = avesmapsEcosystemNormalizeGeometry([
    'type' => 'Polygon',
    'coordinates' => [
        [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]],
        [[40.0, 40.0], [60.0, 40.0], [60.0, 60.0]],
    ],
]);
assert(count($withHole['geometry']['coordinates']) === 2, 'both rings survive');
assert($withHole['bounds'] === ['min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 100.0, 'max_y' => 100.0]);

// 🔴 THE bbox REQUIREMENT (plan V2.3, step 1): over ALL parts of a MultiPolygon, not just the first.
// A bbox taken from part one would leave the second part outside every viewport query -- an area that is
// stored, valid and permanently invisible.
$multi = avesmapsEcosystemNormalizeGeometry([
    'type' => 'MultiPolygon',
    'coordinates' => [
        [[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 0.0]]],
        [[[900.0, 900.0], [1000.0, 900.0], [1000.0, 1000.0], [900.0, 900.0]]],
    ],
]);
assert($multi['part_count'] === 2);
assert($multi['bounds'] === ['min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 1000.0, 'max_y' => 1000.0],
    'the bbox spans BOTH parts');

// The map is 0..1024 inclusive on both ends.
avesmapsEcosystemNormalizeGeometry([
    'type' => 'Polygon',
    'coordinates' => [[[0.0, 0.0], [1024.0, 0.0], [1024.0, 1024.0]]],
]);

// ---- geometry: what must be refused ------------------------------------------------------------------
// JSON_VALID would accept every single one of these, which is why the check is not "is it JSON".

ecosystemTestThrows(static fn() => avesmapsEcosystemNormalizeGeometry(null), 'null is not a geometry');
ecosystemTestThrows(static fn() => avesmapsEcosystemNormalizeGeometry('{"type":"Polygon"}'), 'a JSON string is not a decoded object');
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'LineString', 'coordinates' => [[0, 0], [1, 1]]]),
    'a LineString is not an area'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Banana', 'coordinates' => [[[0, 0], [1, 1], [2, 2]]]]),
    'an invented type'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => []]),
    'no coordinates at all'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1]]]]),
    'two positions are a line, not a ring'
);
ecosystemTestThrows(
    // Closed but degenerate: 3 positions of which the last repeats the first = 2 distinct corners.
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1], [0, 0]]]]),
    'a closed ring still needs three DISTINCT corners'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1], [1025, 5]]]]),
    'x beyond the 1024 map bound'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1], [5, -1]]]]),
    'a negative coordinate'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1], ['x', 5]]]]),
    'a non-numeric coordinate'
);
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1], [5]]]]),
    'a position with only one number'
);
ecosystemTestThrows(
    // A MultiPolygon whose parts are rings rather than polygons -- one nesting level short, and the
    // easiest mistake for a client to make.
    static fn() => avesmapsEcosystemNormalizeGeometry([
        'type' => 'MultiPolygon',
        'coordinates' => [[[0, 0], [1, 1], [2, 2]]],
    ]),
    'a MultiPolygon nested one level too shallow'
);

// The position cap keeps a runaway client from storing a 50 MB polygon.
$hugeRing = [];
for ($i = 0; $i <= AVESMAPS_ECOSYSTEM_MAX_POSITIONS + 10; $i++) {
    $hugeRing[] = [$i % 1000, ($i * 3) % 1000];
}
ecosystemTestThrows(
    static fn() => avesmapsEcosystemNormalizeGeometry(['type' => 'Polygon', 'coordinates' => [$hugeRing]]),
    'more positions than the cap allows'
);

// ---- bbox query parameter ----------------------------------------------------------------------------

assert(avesmapsEcosystemParseBoundingBox('') === null, 'no bbox = no filter');
assert(avesmapsEcosystemParseBoundingBox('   ') === null);
assert(avesmapsEcosystemParseBoundingBox('10,20,30,40')
    === ['min_x' => 10.0, 'min_y' => 20.0, 'max_x' => 30.0, 'max_y' => 40.0]);
// Same tolerance as map-features: a German decimal comma inside a component still parses.
assert(avesmapsEcosystemParseBoundingBox('10.5, 20.25, 30.75, 40.125')['max_y'] === 40.125);
ecosystemTestThrows(static fn() => avesmapsEcosystemParseBoundingBox('10,20,30'), 'three components');
ecosystemTestThrows(static fn() => avesmapsEcosystemParseBoundingBox('10,20,30,40,50'), 'five components');
ecosystemTestThrows(static fn() => avesmapsEcosystemParseBoundingBox('a,b,c,d'), 'non-numeric components');
ecosystemTestThrows(static fn() => avesmapsEcosystemParseBoundingBox('30,20,10,40'), 'min_x above max_x');
ecosystemTestThrows(static fn() => avesmapsEcosystemParseBoundingBox('10,40,30,20'), 'min_y above max_y');

// ---- the optimistic guard's reader -------------------------------------------------------------------
// REQUIRED, not optional: an optional guard is exactly how it silently fails to apply, and the second of
// two concurrent saves would win in silence.

assert(avesmapsEcosystemReadExpectedRevision(3) === 3);
assert(avesmapsEcosystemReadExpectedRevision('7') === 7);
ecosystemTestThrows(static fn() => avesmapsEcosystemReadExpectedRevision(null), 'omitted expected_revision');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadExpectedRevision(''), 'empty expected_revision');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadExpectedRevision(0), 'a geometry_revision starts at 1');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadExpectedRevision(-1), 'a negative revision');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadExpectedRevision('nope'), 'a non-numeric revision');

// ---- public ids and kinds ----------------------------------------------------------------------------

$uuid = '735a89f2-1111-4222-8333-444455556666';
assert(avesmapsEcosystemReadPublicId($uuid, 'public_id') === $uuid);
assert(avesmapsEcosystemReadPublicId(strtoupper($uuid), 'public_id') === $uuid, 'public ids normalize to lower case');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadPublicId('', 'public_id'), 'an empty public id');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadPublicId('not-a-uuid', 'public_id'), 'a malformed public id');

assert(avesmapsEcosystemReadKind('vegetation') === 'vegetation');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadKind('Vegetation'), 'kind is case sensitive');
ecosystemTestThrows(static fn() => avesmapsEcosystemReadKind('klima'), 'an unknown kind');

// ---- the type vocabulary -----------------------------------------------------------------------------
// The owner's V2.1 checkpoint counted 16 rows in phpMyAdmin (4 + 5 + 7); this is the same count, checkable
// without a database. 24 since 2026-07-29: 'flussland_flusstal', 'dschungel' and 'wuestenoase' joined the vegetation vocabulary and
// 'wadi', 'schlucht', 'hochebene', 'tiefebene' and 'tal' the topographic one (owner).
//
// 🪤 The number is meant to MOVE when a type is deliberately added -- what it guards against is a type
// vanishing unnoticed, and a duplicate being swallowed by INSERT IGNORE (the composite check below).
// Adjusting it alongside a seed entry is the intended workflow, not a weakening of the test.

assert(count(AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED) === 24, 'the seed is 24 rows');

$byKind = [];
foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $typeKey, $label, $sortOrder]) {
    assert(in_array($kind, AVESMAPS_ECOSYSTEM_KINDS, true), "seed kind {$kind} is a known kind");
    assert($label !== '', "seed {$typeKey} has a label");
    $byKind[$kind][] = $typeKey;
}
assert(count($byKind['derographisch']) === 4, 'derographisch: 4');
assert(count($byKind['topographie']) === 10, 'topographie: 10');
assert(count($byKind['vegetation']) === 10, 'vegetation: 10');

// The PRIMARY KEY is (kind, type_key): a duplicate would be swallowed by INSERT IGNORE and the count
// would silently be 15.
$seen = [];
foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $typeKey]) {
    $composite = $kind . '|' . $typeKey;
    assert(!isset($seen[$composite]), "seed row {$composite} appears twice");
    $seen[$composite] = true;
    // Every type_key must also be a real map_features label subtype -- that is what lets a later task
    // bridge the 540 existing landscape labels to a region. Checked against the LIVE allowlist.
    assert(avesmapsReadLabelSubtype($typeKey) === $typeKey, "{$typeKey} is a map_features label subtype");
}

// Deliberately absent, and each for its own reason (see the seed's comment): `ebene` has no travel factor
// telling it apart from normal ground, `berggipfel` are points and `fluss` are lines. All three ARE valid
// label subtypes, so only this test keeps them out.
foreach (['ebene', 'berggipfel', 'fluss'] as $excluded) {
    assert(!isset($seen['derographisch|' . $excluded]) && !isset($seen['topographie|' . $excluded])
        && !isset($seen['vegetation|' . $excluded]), "{$excluded} stays out of the seed");
}

// ---- wiki_region_key: parity with the derivation that keyed the wiki tables (V3.0b) ------------------
//
// 🔴 THIS IS THE POINT OF THE WHOLE TRANSCRIPTION. avesmapsEcosystemWikiSlug is a hand copy of
// avesmapsPoliticalSlug, because the plan's global rule 1 forbids CALLING political code at runtime while
// AGENTS.md §5 forbids inventing a second key derivation. Copy plus rule = a silent drift risk, and this
// is the guard against it: if the two ever disagree for any input, every join built on the key breaks --
// across ~10 tables, and quietly.
//
// The political library is required HERE and nowhere else: a test is not runtime, and a copy of the
// original inside the test would prove nothing at all.
require __DIR__ . '/../../political/territory.php';

$slugSamples = [
    'Farindel', 'Fürstentum Kosch', 'Große Wüste', 'Salamandersteine', 'Trollzacken',
    'Sümpfe von Ssikhrhaz', 'Weiden-See', 'Bornland', 'Áuris  Öl', 'Marktgrafschaft Tobrien',
    'Nördliche Windhag-Küste', '  führende und folgende Leerzeichen  ', 'ÄÖÜäöüß', 'Éclair-Straße',
    '', '---', 'a', str_repeat('Ödland ', 40),
];
foreach ($slugSamples as $sample) {
    assert(
        avesmapsEcosystemWikiSlug($sample) === avesmapsPoliticalSlug($sample),
        "the transcribed slug drifted from avesmapsPoliticalSlug for: {$sample}"
    );
}

// The wire form: a Wiki-Aventurica URL yields the article's BARE slug -- no 'wiki:' prefix. That prefix
// belongs to the political identity keys (avesmapsPoliticalBuildWikiKey); the table this key is meant to
// join, wiki_region_staging, stores avesmapsPoliticalSlug($canonical) without one.
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/Farindel') === 'farindel');
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/Gro%C3%9Fe_W%C3%BCste')
    === avesmapsPoliticalSlug('Große Wüste'), 'percent-encoded umlauts and underscores fold like the wiki key');
// No link -> no key. Deliberately no name-derived fallback: a key that joins to nothing looks like a link.
assert(avesmapsEcosystemWikiRegionKey('') === null);
assert(avesmapsEcosystemWikiRegionKey('   ') === null);
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/') === null);

// The client can never write the key: only wiki_url is read, and it always rewrites the key.
$derived = avesmapsEcosystemReadRegionFields(
    ['kind' => 'vegetation', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Farindel', 'wiki_region_key' => 'gefaelscht'],
    null
);
assert(($derived['wiki_region_key'] ?? null) === 'farindel', 'a hand-written wiki_region_key is ignored');
// Clearing the link clears the key -- the two must never drift apart.
$cleared = avesmapsEcosystemReadRegionFields(['wiki_url' => ''], 'vegetation');
assert(array_key_exists('wiki_region_key', $cleared) && $cleared['wiki_region_key'] === null);
// A payload without wiki_url does not touch the key at all (partial update).
$untouched = avesmapsEcosystemReadRegionFields(['name' => 'Farindel'], 'vegetation');
assert(!array_key_exists('wiki_region_key', $untouched), 'a partial update leaves the key alone');

echo "OK: ecosystem geometry, bbox, revision guard, vocabulary and wiki-key parity\n";

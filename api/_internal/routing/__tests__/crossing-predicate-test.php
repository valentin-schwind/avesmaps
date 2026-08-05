<?php

declare(strict_types=1);

/**
 * Finding A13 (c): the same question -- "is this a crossing?" -- was answered twice in one loop.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/crossing-predicate-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 WHY THIS IS NOT COSMETIC. avesmapsIsRouteCrossingLocation advanced the counter;
 * avesmapsBuildRouteLocationData decided the rename with its OWN, copied name check. They read the
 * same, so nothing broke. Had they ever drifted, a row would have been called `Kreuzung-5` without
 * the counter moving on -- and the next crossing would have got the same name. Location names are
 * GRAPH KEYS here; two nodes under one name is not a display glitch, it is a wrong route.
 *
 * ⚠️ What this change deliberately does NOT do: the names stay position numbers. That fix renames
 * 2.084 objects in the stable contract (A13 a/b) and is the owner's call.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../network-data.php';

$isCrossing = static fn(array $properties): bool => avesmapsRoutePropertiesAreCrossing($properties);

// --- Tier 1: feature_type -------------------------------------------------------------------------
// Catches: the feature_type tier removed. 798 legacy rows carry 'crossing' rather than 'junction'.
assert($isCrossing(['feature_type' => 'junction']), 'junction is a crossing');
assert($isCrossing(['feature_type' => 'crossing']), 'and so is the legacy spelling');
assert($isCrossing(['feature_type' => 'JUNCTION']), 'the comparison is case-insensitive, like the client');
assert(!$isCrossing(['feature_type' => 'location']), 'an ordinary place is not');

// --- Tier 2: the subtype, read under the client's four keys ---------------------------------------
// Catches: any one of the four keys dropped.
assert($isCrossing(['location_type' => 'crossing']), 'location_type says it');
assert($isCrossing(['settlement_class' => 'crossing']), 'settlement_class says it');
assert($isCrossing(['feature_subtype' => 'crossing']), 'feature_subtype says it');
assert($isCrossing(['locationType' => 'crossing']), 'and the camelCase spelling the client also reads');

// 💣 Catches: the key ORDER changed. The client reads location_type FIRST and stops at the first
// non-empty one -- so a row whose location_type says "dorf" is a village even if a later key says
// crossing. Reordering the keys here would make the two sides disagree about that row, which is
// precisely the drift this change exists to prevent.
assert(
    !$isCrossing(['location_type' => 'dorf', 'feature_subtype' => 'crossing', 'name' => 'Ein Dorf']),
    'the first non-empty key wins, in the client order'
);
assert(
    $isCrossing(['location_type' => 'crossing', 'feature_subtype' => 'dorf', 'name' => 'Ein Dorf']),
    'and the other way round too'
);
// An empty key is skipped rather than answering.
assert($isCrossing(['location_type' => '   ', 'settlement_class' => 'crossing']), 'blank keys are skipped');

// --- Tier 3: the name, which is all the server used to look at ------------------------------------
// Catches: the name tier removed -- that would stop renaming every crossing whose type says nothing.
assert($isCrossing(['name' => 'Kreuzung-Nord']), 'the name prefix still counts');
assert($isCrossing(['name' => 'Kreuzung am Fluss']), 'with or without a dash');
// 💣 Catches: the prefix widened. "Kreuzberg" starts with "Kreuz" and is not a crossing.
assert(!$isCrossing(['name' => 'Kreuzberg']), 'a longer word that merely starts alike is not one');
assert(!$isCrossing(['name' => 'Alte Kreuzung']), 'and the prefix is anchored at the start');
assert(!$isCrossing([]), 'nothing at all is not a crossing');
assert(!$isCrossing(['name' => 'Gareth', 'feature_type' => 'location', 'feature_subtype' => 'grossstadt']), 'a city is not one');

// --- The counter and the rename must ask the SAME predicate ---------------------------------------
//
// 💣 This is the finding. Feed a list where a row is a crossing by TYPE but not by name: under the
// old code the counter advanced (name check) while the rename did not, or vice versa. Now both
// answer alike, so the numbering stays dense and unique.
$features = [
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Kreuzung A']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Gareth', 'feature_subtype' => 'grossstadt']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Namenlos', 'feature_type' => 'junction']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Kreuzung B']],
];
$index = 1;
$names = [];
foreach ($features as $feature) {
    $built = avesmapsBuildRouteLocationData($feature, $index);
    $names[] = $built['name'];
    if (avesmapsIsRouteCrossingLocation($feature)) {
        $index++;
    }
}
assert(
    $names === ['Kreuzung-1', 'Gareth', 'Kreuzung-2', 'Kreuzung-3'],
    'counter and rename agree -- the numbering is dense and every name distinct'
);
assert(count($names) === count(array_unique($names)), 'no two nodes share a name');

// 💣 And the same list under the OLD rule would have collided: "Namenlos" was not renamed but also
// did not advance the counter... which is the harmless half. The dangerous half is the mirror image,
// and it is why one predicate matters rather than two that happen to agree.
assert(
    avesmapsIsRouteCrossingLocation(['properties' => ['name' => 'Namenlos', 'feature_type' => 'junction']]),
    'a crossing without the name prefix is now recognised by both sides'
);

// --- One rule, written once -----------------------------------------------------------------------
//
// Catches: somebody pasting the name check back in beside the shared predicate.
$source = file_get_contents(__DIR__ . '/../network-data.php');
assert(is_string($source) && $source !== '', 'the source is readable');
assert(
    substr_count($source, "strncmp(") === 1,
    'the name comparison exists exactly once in this file'
);
assert(
    substr_count($source, 'avesmapsRoutePropertiesAreCrossing(') === 3,
    'defined once, asked twice -- by the counter and by the rename'
);

echo "crossing-predicate ok\n";

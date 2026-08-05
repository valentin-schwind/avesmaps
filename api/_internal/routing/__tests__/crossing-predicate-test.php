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

// ⚠️ client-graph.php zuerst: die echte Schleife baut auch Wege, und deren Subtyp-Normalisierer
// wohnt dort. Ohne ihn stirbt der Aufruf an der ersten LineString-Vorlage -- und genau die braucht
// dieser Test, um zu belegen, dass eine Linie kein Ort ist.
require_once __DIR__ . '/../client-graph.php';
require_once __DIR__ . '/../network-data.php';

$isCrossing = static fn(array $properties): bool => avesmapsRoutePropertiesAreCrossing($properties);

// --- Tier 1: feature_type -------------------------------------------------------------------------
// Catches: the feature_type tier removed. ⚠️ Measured on the live map 06.08.2026: 782 rows carry the
// legacy 'crossing' spelling and 1.301 carry 'junction'. An earlier version of this line said "798",
// copied from a comment in map-features-location-lookup.js:16 rather than counted -- an unchecked
// number dressed as a measured one, in a change whose whole argument was that it measured first.
// The third row of the 2.084 is neither: one feature_type='location' with feature_subtype='crossing',
// which is what tier 2 exists for.
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
// 💣 THROUGH THE REAL LOOP, not a rebuilt one. The first version of this test assembled its own
// foreach here -- and thereby tested everything except the loop it was written for. Verified: making
// the COUNTER skip the legacy feature_type='crossing' spelling while the rename kept it produces 782
// duplicate graph keys on the live map, and that version stayed green. So did swapping the build and
// count lines (2.084 renumbered keys) and dropping the Point filter. All four are caught now, and
// the price is one function call.
$features = [
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Kreuzung A']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Gareth', 'feature_subtype' => 'grossstadt']],
    // A crossing whose NAME says nothing -- only the legacy feature_type does. This is the row that
    // separates the counter from the rename if they ever ask different questions.
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Namenlos', 'feature_type' => 'crossing']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Auch namenlos', 'feature_type' => 'junction']],
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Kreuzung B']],
    // Not a location at all: a label is skipped, and so is a line.
    ['geometry' => ['type' => 'Point'], 'properties' => ['name' => 'Ein Label', 'feature_type' => 'label']],
    ['geometry' => ['type' => 'LineString'], 'properties' => ['name' => 'Kreuzung C']],
];
$network = avesmapsBuildRouteNetworkData(['features' => $features]);
$names = array_column($network['locations'], 'name');

assert(
    $names === ['Kreuzung-1', 'Gareth', 'Kreuzung-2', 'Kreuzung-3', 'Kreuzung-4'],
    'counter and rename agree through the real loop -- dense numbering, label and line skipped'
);
// 💣 The damage this exists to prevent, stated as its own assertion: names are graph keys.
assert(count($names) === count(array_unique($names)), 'no two nodes share a name');
assert(count($network['locations']) === 5, 'the label and the line are not locations');

// ⚠️ Order matters as much as the predicate: the counter must advance AFTER the name is built, or
// every crossing is off by one. Caught by the numbering above -- `Kreuzung-2` would read `Kreuzung-3`.
assert($names[0] === 'Kreuzung-1', 'the first crossing is number one, not number two');

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
// ⚠️ The two assertions that used to stand here counted `strncmp(` and the predicate's own name in
// the source. Both were brittle in BOTH directions: rewriting the comparison as str_starts_with --
// behaviour for behaviour -- turned the first one red, and a legitimate third call of the shared
// predicate turned the second one red. They guarded a spelling, not a rule, and the rule is now
// guarded by the loop test above, which is where it belongs.
//
// What IS worth pinning from the source is that the two callers ask the shared predicate rather than
// carrying their own copy again -- the state this change removed.
$source = file_get_contents(__DIR__ . '/../network-data.php');
assert(is_string($source) && $source !== '', 'the source is readable');
assert(
    str_contains($source, 'return avesmapsRoutePropertiesAreCrossing($properties);')
        && str_contains($source, 'if (avesmapsRoutePropertiesAreCrossing($properties)) {'),
    'the counter and the rename both ask the shared predicate'
);

// --- 🔴 What this predicate deliberately does NOT mirror -------------------------------------------
//
// The client's second tier has a STOPPING half this one lacks: `if (isKnownLocationTypeKey(subtype))
// return subtype;` -- so once the subtype names a known settlement class, the client never looks at
// the name at all. Here, a row with feature_subtype='dorf' AND a name starting with "Kreuzung" is
// still treated as a crossing, while the client calls it a village.
//
// ⚠️ Measured on the live map before writing this: 0 rows. And it is left as it is on purpose --
// mirroring the stopping half needs the six settlement keys, which already exist as TWO separate
// literal copies in this codebase (api/app/report-location.php, api/edit/map/features.php). A third
// copy to close a zero-row gap would be the very duplication this change removed, one file over.
// The assertion below records the divergence rather than hiding it; it is meant to CHANGE the day
// that list gets a shared home.
assert(
    avesmapsRoutePropertiesAreCrossing(['feature_subtype' => 'dorf', 'name' => 'Kreuzung-auto-7']),
    'the name still wins over a known settlement subtype here -- the client stops earlier (0 live rows)'
);

echo "crossing-predicate ok\n";

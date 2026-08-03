<?php

declare(strict_types=1);

/**
 * Unit test for "which climate zone is this in?" -- the geometry half. No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/climate-membership-test.php
 * Exit 0 = all asserts passed.
 *
 * WHY THIS IS TESTED AND NOT JUST COMMENTED: every failure mode here is silent. A place put in the
 * neighbouring band still shows a plausible zone name; a band tested without its bounding box still
 * gives the right answer, only slowly; and a bubble-shaped divider produces a band that a y(x)
 * shortcut gets WRONG for exactly the points inside the bubble -- which is the whole reason this
 * module tests against the band polygon instead of the line.
 */

require_once __DIR__ . '/../climate-membership.php';

// ---------------------------------------------------------------- THE RING TEST -----------------

$square = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]];
assert(avesmapsClimateRingContains($square, 5.0, 5.0), 'the middle of a square is inside');
assert(!avesmapsClimateRingContains($square, 15.0, 5.0), 'a point to the east is outside');
assert(!avesmapsClimateRingContains($square, 5.0, 15.0), 'a point to the north is outside');
assert(!avesmapsClimateRingContains([[0.0, 0.0], [1.0, 1.0]], 0.5, 0.5), 'two points are not a ring');

// ---------------------------------------------------------------- BANDS THAT TILE ---------------
// Three stripes built the way avesmapsClimateBandGeometry builds them: upper edge left to right, lower
// edge right to left, closed. Together they cover 0..100 in y without gap or overlap.

$stripe = static fn(float $top, float $bottom): array => [
    'type' => 'Polygon',
    'coordinates' => [[
        [0.0, $top], [100.0, $top], [100.0, $bottom], [0.0, $bottom], [0.0, $top],
    ]],
];

$bands = [
    ['key' => 'nord', 'label' => 'Nordzone', 'min_y' => 66.0, 'max_y' => 100.0, 'geometry' => $stripe(100.0, 66.0)],
    ['key' => 'mitte', 'label' => 'Mittelzone', 'min_y' => 33.0, 'max_y' => 66.0, 'geometry' => $stripe(66.0, 33.0)],
    ['key' => 'sued', 'label' => 'Suedzone', 'min_y' => 0.0, 'max_y' => 33.0, 'geometry' => $stripe(33.0, 0.0)],
];

assert(avesmapsClimateZoneKeyAt($bands, 50.0, 90.0) === 'nord', 'high y is the northern zone');
assert(avesmapsClimateZoneKeyAt($bands, 50.0, 50.0) === 'mitte', 'the middle is the middle zone');
assert(avesmapsClimateZoneKeyAt($bands, 50.0, 10.0) === 'sued', 'low y is the southern zone');
assert(avesmapsClimateZoneKeyAt($bands, 50.0, 500.0) === '', 'off the map claims nothing');

// EVERY point gets exactly one zone. That is the promise the derived bands make, and it is the reason a
// place never needs a fallback label -- asked here of the polygons rather than of the lines.
for ($y = 1; $y < 100; $y += 1) {
    assert(avesmapsClimateZoneKeyAt($bands, 37.0, (float) $y) !== '', "y={$y} lands in a real zone");
}

// ---------------------------------------------------------------- THE BUBBLE --------------------
// 💣 THE CASE THAT DECIDED THIS MODULE'S DESIGN. Since 2026-08-03 a divider may run backwards in x, so a
// band can bulge. A point inside the bulge is NORTH of the line at its own x and SOUTH of it a little
// further along -- a y(x) comparison answers with whichever crossing it happens to find first. The
// polygon knows.

$withBubble = [
    'type' => 'Polygon',
    'coordinates' => [[
        [0.0, 100.0], [100.0, 100.0],           // top edge, straight
        [100.0, 40.0], [60.0, 40.0], [80.0, 70.0], [40.0, 70.0], [20.0, 40.0], [0.0, 40.0],  // bottom edge with a bulge
        [0.0, 100.0],
    ]],
];
assert(avesmapsClimateGeometryContains($withBubble, 50.0, 90.0), 'above the bulge is still in the band');
assert(!avesmapsClimateGeometryContains($withBubble, 50.0, 50.0), 'the bulge itself is NOT in the band');
assert(avesmapsClimateGeometryContains($withBubble, 10.0, 50.0), 'beside the bulge, the band reaches down');

// ---------------------------------------------------------------- MULTIPOLYGON + HOLE -----------

$multi = ['type' => 'MultiPolygon', 'coordinates' => [
    [[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]]],
    [[[20.0, 0.0], [30.0, 0.0], [30.0, 10.0], [20.0, 10.0], [20.0, 0.0]]],
]];
assert(avesmapsClimateGeometryContains($multi, 5.0, 5.0), 'first part of a MultiPolygon counts');
assert(avesmapsClimateGeometryContains($multi, 25.0, 5.0), 'second part counts too');
assert(!avesmapsClimateGeometryContains($multi, 15.0, 5.0), 'the gap between them does not');

$holed = ['type' => 'Polygon', 'coordinates' => [
    [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
    [[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0], [4.0, 4.0]],
]];
assert(!avesmapsClimateGeometryContains($holed, 5.0, 5.0), 'a hole is not inside');
assert(avesmapsClimateGeometryContains($holed, 2.0, 2.0), 'the ring around the hole is');

assert(!avesmapsClimateGeometryContains(['type' => 'LineString', 'coordinates' => []], 1.0, 1.0),
    'a LineString contains nothing');
assert(!avesmapsClimateGeometryContains(null, 1.0, 1.0), 'null contains nothing');

// ---------------------------------------------------------------- THE VOCABULARY ----------------

assert(avesmapsClimateVocabulary($bands) === [
    ['key' => 'nord', 'label' => 'Nordzone'],
    ['key' => 'mitte', 'label' => 'Mittelzone'],
    ['key' => 'sued', 'label' => 'Suedzone'],
], 'the vocabulary keeps the north-to-south order of the bands');

// ---------------------------------------------------------------- APPLYING TO FEATURES ----------

$features = [
    ['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [50.0, 90.0]],
        'properties' => ['feature_type' => 'location', 'public_id' => 'ort-1']],
    ['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [50.0, 10.0]],
        'properties' => ['feature_type' => 'location', 'public_id' => 'ort-2']],
    // A place outside every band keeps NO field -- an absent field is "nothing to say".
    ['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [50.0, 900.0]],
        'properties' => ['feature_type' => 'location', 'public_id' => 'ort-3']],
    ['type' => 'Feature', 'geometry' => null,
        'properties' => ['feature_type' => 'label', 'public_id' => 'l-1', 'ecosystem_region_public_id' => 'r-1']],
    ['type' => 'Feature', 'geometry' => null,
        'properties' => ['feature_type' => 'label', 'public_id' => 'l-2', 'ecosystem_region_public_id' => 'r-unknown']],
    // A way is not touched here: its zones live in path_ecosystem and travel through their own endpoint.
    ['type' => 'Feature', 'geometry' => ['type' => 'LineString', 'coordinates' => []],
        'properties' => ['feature_type' => 'path', 'public_id' => 'weg-1']],
];

avesmapsClimateApplyToFeatures($features, $bands, ['r-1' => [['mitte', 0.7], ['sued', 0.3]]]);

assert(($features[0]['properties']['climate_zone'] ?? '') === 'nord', 'the northern place gets its zone');
assert(($features[1]['properties']['climate_zone'] ?? '') === 'sued', 'the southern place gets its zone');
assert(!isset($features[2]['properties']['climate_zone']), 'a place off the map gets no field at all');
assert(($features[3]['properties']['climate_zones'] ?? null) === [['mitte', 0.7], ['sued', 0.3]],
    'a landscape label gets the shares of its region');
assert(!isset($features[4]['properties']['climate_zones']), 'a label of an unknown region gets no field');
assert(!isset($features[5]['properties']['climate_zone'], $features[5]['properties']['climate_zones']),
    'a way is left alone -- path_ecosystem answers for it');

// Nothing stored anywhere: the pass is a no-op and the payload looks exactly as it did before.
$untouched = [['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [1.0, 1.0]],
    'properties' => ['feature_type' => 'location']]];
$before = $untouched;
avesmapsClimateApplyToFeatures($untouched, [], []);
assert($untouched === $before, 'without bands and without shares nothing is added');

fwrite(STDOUT, "climate-membership-test: OK\n");

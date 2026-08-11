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

// ---- der Territorien-Leser (Owner 2026-08-12) ------------------------------------------------
// Er liest, was „Zugehoerigkeit rechnen" laengst geschrieben hat: ecosystem_region_territory, seit
// dem 2026-08-03 gefuellt und bis heute ohne Leser. Gegen sqlite, weil die Abfrage gewoehnliches
// SQL ist -- und weil es lokal keine MySQL gibt (php-js-test-commands).
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this half would silently pass" . PHP_EOL);
    exit(1);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// 🔴 Die leere Antwort kommt VOR dem Anlegen der Tabellen: „das Feature wurde nie eingerichtet"
// darf keine 500 werden (Purity-Vertrag oben in dieser Datei).
assert(avesmapsClimateReadTerritoryZones($pdo, 't-1') === [],
    'ohne Oekosystem-Tabellen: leere Liste, kein Fehler');

$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, kind TEXT, region_type TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, sort_order INTEGER)');
$pdo->exec('CREATE TABLE ecosystem_region_territory (region_id INTEGER, territory_public_id TEXT, share REAL, is_aggregate INTEGER)');

// Drei Klimabaender (Nord -> Sued), eine gewoehnliche Landschaft und ein abgeschaltetes Band.
$pdo->exec("INSERT INTO ecosystem_region (id, kind, region_type, is_active) VALUES
    (1, 'klima', 'polar', 1), (2, 'klima', 'gemaessigt', 1), (3, 'klima', 'tropisch', 1),
    (4, 'vegetation', 'wald', 1), (5, 'klima', 'abgeschaltet', 0)");
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES
    ('klima', 'polar', 'Polare Zone', 1), ('klima', 'gemaessigt', 'Gemaessigte Zone', 2),
    ('klima', 'tropisch', 'Tropische Zone', 3)");
$pdo->exec("INSERT INTO ecosystem_region_territory (region_id, territory_public_id, share, is_aggregate) VALUES
    (2, 'reich', 0.62, 0), (1, 'reich', 0.35, 0), (3, 'reich', 0.02, 0),
    (4, 'reich', 0.90, 0), (5, 'reich', 0.80, 0),
    (1, 'baronie', 0.50, 1), (3, 'baronie', 0.50, 1),
    (4, 'nur-wald', 1.00, 0)");

$reich = avesmapsClimateReadTerritoryZones($pdo, 'reich');
assert($reich === [['gemaessigt', 0.62], ['polar', 0.35]],
    'groesster Anteil zuerst; der 2-%-Splitter faellt unter die 5-%-Schwelle, die Landschaft (90 %!) '
    . 'und das abgeschaltete Band (80 %!) fallen ganz heraus: ' . json_encode($reich));

// 💣 Eine LANDSCHAFT ist keine Klimazone. Seit die Baender gewoehnliche ecosystem_area-Zeilen sind,
// haengen beide in derselben Tabelle -- ohne kind = 'klima' staende „wald" in der Klimazeile.
assert(avesmapsClimateReadTerritoryZones($pdo, 'nur-wald') === [],
    'ein Gebiet, das nur Landschaften trifft, hat keine Klimazeile');

// ⚠️ is_aggregate wird NICHT gefiltert: die Huelle eines Aggregats IST die gemessene Flaeche, und
// der Primaerschluessel (region_id, territory_public_id) laesst je Band ohnehin nur eine Zeile zu.
assert(count(avesmapsClimateReadTerritoryZones($pdo, 'baronie')) === 2,
    'ein Aggregat bekommt seine Zonen wie jedes andere Gebiet');

// Gleichstand entscheidet sort_order, also Nord vor Sued -- sonst tauschten zwei Haelften eines
// Reiches zwischen zwei Anfragen die Plaetze. Eingefuegt wird absichtlich Sued VOR Nord.
$pdo->exec("INSERT INTO ecosystem_region_territory (region_id, territory_public_id, share, is_aggregate)
    VALUES (3, 'halbe', 0.5, 0), (1, 'halbe', 0.5, 0)");
assert(avesmapsClimateReadTerritoryZones($pdo, 'halbe') === [['polar', 0.5], ['tropisch', 0.5]],
    'bei gleichem Anteil entscheidet Nord vor Sued, nicht die Zeilenreihenfolge');

assert(avesmapsClimateReadTerritoryZones($pdo, 'gibt-es-nicht') === [], 'ein unbekanntes Gebiet: leer');
assert(avesmapsClimateReadTerritoryZones($pdo, '   ') === [], 'ein leerer Schluessel: leere Liste');
// Der trim() ist die eigentliche Aussage des Riegels und wird hier gemessen: ungetrimmt fiele die
// Abfrage auf einen Schluessel mit Leerzeichen und faende nichts -- eine stille Fehlanzeige.
assert(avesmapsClimateReadTerritoryZones($pdo, '  reich  ') === [['gemaessigt', 0.62], ['polar', 0.35]],
    'Leerzeichen um den Schluessel werden abgeschnitten, nicht mitgesucht');

fwrite(STDOUT, "climate-membership-test: OK\n");

<?php
// api/_internal/routing/__tests__/offroad-astar-test.php
declare(strict_types=1);

/**
 * Unit tests for the cross-country A* (api/_internal/routing/offroad-grid.php).
 * Spec: docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md §5, measured in V11 §10.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-astar-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../offroad-grid.php';

$near = static function (float $a, float $b, float $eps = 1e-9): bool { return abs($a - $b) <= $eps; };

// ============================================================ 0. THE UNITS -- nailed down first
//
// 💣 THIS WENT WRONG LIVE ONCE. A rule of thumb put the Meile at 3.000 Schritt and was off by a
// factor of 3 all the way through, until a DSA player found it. The table, and it is short:
//   1 Schritt = 1 m · 1.000 Schritt = 1 Meile = 1 km · 1 Karteneinheit = 3.000 Schritt = 3 Meilen.
// Everything below asks the PRODUCTION functions, never a copy.

assert($near(AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE, 3000.0), '1 map unit is 3.000 Schritt');
assert($near(AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT, 3.0), '1 map unit is 3 Meilen');

// 3.000 Schritt of drop over 3 map units is a gradient of 1/3 -- the counter-sample from the
// instruction, asked of the function that owns the formula.
assert(avesmapsTerrainDescentIsSteep(3000.0, 3.0) === true, '1/3 is steeper than the 20 % threshold');
assert(avesmapsTerrainDescentIsSteep(3000.0, 30.0) === false, '1/30 = 3,3 % is not steep');
// Exactly at the threshold: 20 % is NOT „over 20 %".
assert(avesmapsTerrainDescentIsSteep(0.20 * 3000.0, 1.0) === false, '20,0 % exactly is not over the threshold');

// The time factor for the same climb: 3.000 Schritt over 3 map units = 9 Meilen, so
// 1 + (3000/100)/9 = 4,33 -- clamped to the ceiling 4,0. 💣 NOT „gradient 1/3": the function
// returns a TIME FACTOR, and it is called avesmapsTerrainLeistungsFactor, not ...TimeFactor.
assert($near(avesmapsTerrainLeistungsFactor(3000.0, 0.0, 3.0), 4.0), 'the clamp holds at 4,0');
// Level ground is EXACTLY 1,0, and missing data is too -- that exact 1,0 is what makes „off"
// bit-identical with today.
assert(avesmapsTerrainLeistungsFactor(0.0, 0.0, 3.0) === 1.0, 'level ground is exactly 1,0');
assert(avesmapsTerrainLeistungsFactor(null, null, 3.0) === 1.0, 'no data is exactly 1,0');
// 900 Schritt of climb over 3 units = 9 Meilen: 1 + 9/9 = 2,0. An unclamped value, to prove the
// arithmetic and not just the ceiling.
assert($near(avesmapsTerrainLeistungsFactor(900.0, 0.0, 3.0), 2.0), '900 Schritt over 9 Meilen doubles the time');

// ============================================================ 1. the box

$box = avesmapsBuildOffroadBox(10.0, 10.0, 20.0, 10.0, 0.5, 150000);
assert($box['cell'] === 0.5, 'the requested cell width survives when it fits');
// Air line 10, margin 30 % = 3 -> the box spans x 7..23, y 7..13.
assert($box['min_x'] <= 7.0 && $box['max_x'] >= 23.0, 'the margin is 30 % of the air line');
assert($box['cols'] * $box['rows'] === $box['cell_count'], 'cell_count is cols x rows');
assert($box['coarsened'] === false, 'a small box is not coarsened');

// 💣 THE CAP IS LOAD-BEARING FOR „Hierher reisen" (instruction §2): p50 10.600 cells, max 568.000.
// Over the cap the code coarsens FOR THIS REQUEST and reports the width it used.
$huge = avesmapsBuildOffroadBox(0.0, 0.0, 290.0, 290.0, 0.5, 150000);
assert($huge['cell_count'] <= 150000, 'the cap holds: ' . $huge['cell_count']);
assert($huge['cell'] > 0.5, 'over the cap the cell width grows');
assert($huge['coarsened'] === true, 'and the answer must be able to say so');
// Doubling, not an arbitrary fit -- so the reported width is always a clean multiple.
assert($near(fmod($huge['cell'] / 0.5, 1.0), 0.0), 'the width doubles: ' . $huge['cell']);

// A degenerate box (start = target) must still be a box, not a division by zero.
$dot = avesmapsBuildOffroadBox(5.0, 5.0, 5.0, 5.0, 0.5, 150000);
assert($dot['cols'] >= 1 && $dot['rows'] >= 1, 'a zero-length air line still yields cells');

// ============================================================ 2. the grid is a BINARY STRING

// 💣 NEVER A PHP ARRAY: measured 33,2 bytes per cell as integers against 1 byte as a string --
// 568.000 cells are 18 MB one way and 0,5 MB the other (V11 §10.2). This test pins the TYPE,
// because an array would pass every behavioural test in this file and only fail in production.
$square = static function (float $x1, float $y1, float $x2, float $y2): array {
    return [
        'geometry' => ['type' => 'Polygon', 'coordinates' => [[
            [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
        ]]],
        'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2,
    ];
};

$wallBox = avesmapsBuildOffroadBox(0.0, 5.0, 20.0, 5.0, 1.0, 150000);
// A wall across the whole box with a gap around y = 5 ... it is easier to state as two blocks.
$wall = avesmapsPrepareRouteAreas([
    $square(9.0, -20.0, 11.0, 3.0),
    $square(9.0, 7.0, 11.0, 30.0),
]);
$blocked = avesmapsOffroadRasteriseBlocked($wallBox, $wall);
assert(is_string($blocked), 'the occupancy grid is a binary string, not an array');
assert(strlen($blocked) === $wallBox['cell_count'], 'one byte per cell');

// ============================================================ 3. A*: the wall with a gap

$speed = 1.25;   // groupFoot cross-country, from the production speed table
$through = avesmapsOffroadFindPath($wallBox, $blocked, null, null, $speed, 0.0, 5.0, 20.0, 5.0);
assert($through !== null, 'a wall WITH a gap must be passable');
assert($through['distance'] > 0.0, 'and the way must have a length');
// Every point of the way must be dry.
foreach ($through['points'] as [$px, $py]) {
    assert(avesmapsRouteAreasContainPoint($px, $py, $wall) === false, "the way runs through the block at ($px, $py)");
}

// A full wall: no way. („kein Weg", not a way through the wall -- the failure that matters.)
$sealed = avesmapsOffroadRasteriseBlocked($wallBox, avesmapsPrepareRouteAreas([$square(9.0, -20.0, 11.0, 30.0)]));
assert(avesmapsOffroadFindPath($wallBox, $sealed, null, null, $speed, 0.0, 5.0, 20.0, 5.0) === null, 'a sealed wall has no way');

// 💣 START AND TARGET CELLS ARE ALWAYS PASSABLE (§5.2). 571 of 4.653 places lie geometrically IN
// water; without this a harbour town answers „kein Weg" immediately.
$wet = avesmapsOffroadRasteriseBlocked($wallBox, avesmapsPrepareRouteAreas([$square(-1.0, 4.0, 1.0, 6.0)]));
assert(avesmapsOffroadFindPath($wallBox, $wet, null, null, $speed, 0.0, 5.0, 20.0, 5.0) !== null, 'a start in water must still run');

// Start = target.
$same = avesmapsOffroadFindPath($wallBox, $blocked, null, null, $speed, 3.0, 5.0, 3.0, 5.0);
assert($same !== null && $near($same['distance'], 0.0), 'start = target is a way of length zero');

// ============================================================ 4. the endpoints are stitched on

// 💣 The A* walks CELL CENTRES; at 0,5 units a centre lies up to 0,35 units off the real point.
// Measured on Gluckenhang -> Wasserburg: the A* reported 2,2 units for an air line of 2,5 -- a way
// SHORTER than the straight line, which cannot be. First and last point are therefore replaced by
// the real coordinates and the length recomputed over the stitched sequence.
$openBox = avesmapsBuildOffroadBox(0.3, 0.3, 7.7, 0.3, 0.5, 150000);
$openGrid = avesmapsOffroadRasteriseBlocked($openBox, avesmapsPrepareRouteAreas([]));
$straight = avesmapsOffroadFindPath($openBox, $openGrid, null, null, $speed, 0.3, 0.3, 7.7, 0.3);
assert($straight !== null, 'an empty box always has a way');
$airLine = hypot(7.7 - 0.3, 0.0);
assert($straight['distance'] >= $airLine - 1e-9, "stitched length {$straight['distance']} must be >= air line {$airLine}");
assert($near($straight['points'][0][0], 0.3) && $near($straight['points'][0][1], 0.3), 'the first point is the real start');
$last = $straight['points'][count($straight['points']) - 1];
assert($near($last[0], 7.7) && $near($last[1], 0.3), 'the last point is the real target');

// 💣 THE UNIT OF `time`, nailed down: `Strecke[Karteneinheiten] / Tempo`, exactly as every road edge
// in the client graph computes it (`client-graph.php:386`). It is a COST, not hours -- one map unit
// is three Meilen, so the number is three times smaller than a clock would say. Both halves of this
// matter: pricing this edge in real hours would make it three times dearer than every road it
// competes with, and Dijkstra would refuse to use it; reading it as hours is the Faktor-3 trap that
// already went live once.
assert($near($straight['time'], $straight['distance'] / $speed, 1e-9),
    'on level ground the cost is exactly Strecke/Tempo -- the same unit as a road edge');

// ============================================================ 5. height: the flat way wins

// Two ways of equal length, one over a hump. The hump is a raster (§3: the pixel value IS the height
// in Schritt, no normalisation), sampled into the same box.
$heightBox = avesmapsBuildOffroadBox(0.0, 0.0, 12.0, 0.0, 1.0, 150000);
$heightGrid = avesmapsOffroadRasteriseBlocked($heightBox, avesmapsPrepareRouteAreas([]));
// A ridge across the direct line: it RISES to 1.200 Schritt and falls again, three raster columns
// wide at 1,5 units each.
//
// 💣 A PLATEAU WOULD PROVE NOTHING, and the first version of this fixture was one. Three columns of
// equal height cost exactly zero: the model prices the CLIMB, so walking along a flat 1.200-Schritt
// tableland is as cheap as walking along the sea. It also enters for free, because the step from
// „no data" to „1.200" is not a climb but an unknown -- V11's rule, and the right one. The hump has
// to have flanks.
$raster = ['origin_x' => 3.0, 'origin_y' => -2.0, 'cell' => 1.5, 'width' => 5, 'height' => 3,
    'samples' => pack('v*',
        0, 600, 1200, 600, 0,
        0, 600, 1200, 600, 0,
        0, 600, 1200, 600, 0)];
$heights = avesmapsOffroadSampleHeights($heightBox, [$raster]);
assert(is_string($heights), 'the height plane is a binary string too');

$flat = avesmapsOffroadFindPath($heightBox, $heightGrid, null, null, $speed, 0.0, 0.0, 12.0, 0.0);
$hilly = avesmapsOffroadFindPath($heightBox, $heightGrid, null, $heights, $speed, 0.0, 0.0, 12.0, 0.0);
assert($flat !== null && $hilly !== null, 'both runs must find a way');
// 🔴 THE PROOF THAT HEIGHT ACTS AT ALL: with the ridge the way is longer (it goes around) or slower
// (it climbs) -- never both unchanged. If this ever asserts, the height plane is not being read.
assert($hilly['distance'] > $flat['distance'] + 1e-9 || $hilly['time'] > $flat['time'] + 1e-9,
    'the ridge must change something: ' . $hilly['distance'] . ' / ' . $hilly['time']);
// And the detour has to stay off the ridge crest where it can.
assert($hilly['time'] <= $flat['time'] * 4.0 + 1e-9, 'the detour must not be worse than the clamp');

// ============================================================ 5a. EINE Auflösung für alles

// 🔴 Der Anstieg ist eine TOTALE VARIATION und waechst mit der Abtastdichte (x sqrt(2) je Halbierung,
// terrain-store.php:27-32). Deshalb integriert das ganze Haus bei AVESMAPS_TERRAIN_CELL_SIZE = 0,25 --
// und die Etappe muss es auch, sonst sieht dieselbe Flanke je nach Frager verschieden hoch aus, und
// beide Zahlen stehen im selben Reiseplan untereinander.
//
// Der Beleg: ein Kamm, dessen Wellen FEINER sind als eine Zelle. Die Zellebene (0,5) glaettet ihn
// weg, das Raster (0,25) sieht ihn.
assert(AVESMAPS_TERRAIN_CELL_SIZE === 0.25, 'die Hausauflösung steht in terrain-store.php');

$rippleSamples = [];
for ($rasterRow = 0; $rasterRow < 3; $rasterRow++) {
    for ($rasterCol = 0; $rasterCol < 41; $rasterCol++) {
        // Saegezahn mit einer Wellenlaenge von 0,5 Einheiten -- zwei Rasterpixel auf, zwei ab.
        $rippleSamples[] = ($rasterCol % 4) < 2 ? 0 : 600;
    }
}
$ripple = ['origin_x' => 0.0, 'origin_y' => -AVESMAPS_TERRAIN_CELL_SIZE, 'cell' => AVESMAPS_TERRAIN_CELL_SIZE,
    'width' => 41, 'height' => 3, 'samples' => pack('v*', ...$rippleSamples)];

$rippleBox = avesmapsBuildOffroadBox(0.5, 0.0, 9.5, 0.0, 0.5, 150000);
$rippleGrid = avesmapsOffroadRasteriseBlocked($rippleBox, avesmapsPrepareRouteAreas([]));
$ripplePlane = avesmapsOffroadSampleHeights($rippleBox, [$ripple]);

$coarse = avesmapsOffroadFindPath($rippleBox, $rippleGrid, null, $ripplePlane, $speed, 0.5, 0.0, 9.5, 0.0);
$fine = avesmapsOffroadFindPath($rippleBox, $rippleGrid, null, $ripplePlane, $speed, 0.5, 0.0, 9.5, 0.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [$ripple]);

assert($fine['ascent_schritt'] > $coarse['ascent_schritt'],
    'aus dem Raster gelesen findet die Etappe mehr Anstieg als aus der Zellebene: '
    . $fine['ascent_schritt'] . ' gegen ' . $coarse['ascent_schritt']);
assert($fine['time'] > $coarse['time'], 'und bezahlt ihn auch');
// ⚠️ Die LAENGE darf sich davon nicht ruehren -- gemessen wird dieselbe Linie, nur feiner abgetastet.
assert($near($fine['distance'], $coarse['distance'], 1e-9), 'die Laenge bleibt dieselbe');

// ⚠️ Ohne Raster bleibt es bei der Zellebene -- kein Verhalten aendert sich fuer Aufrufer, die keine
// Raster laden koennen (etwa ohne Datenbank).
assert($coarse['ascent_schritt'] !== null, 'auch die grobe Fassung kennt Hoehen');

// ============================================================ 5b. Raster in der Kiste ist kein Messwert

// 💣 GEFUNDEN AN EINEM ZUFALLSFALL, NICHT AM SCHREIBTISCH (Solfurt, 2026-08-02). Die Suchkiste spannt
// ueber ALLE Ausstiegskandidaten und streift dabei Gebiete, die der Weg nie berueht. Wer die
// Hoehensummen mit 0,0 beginnt, weil ein Raster GELADEN wurde, meldet dann „gemessen und eben" ueber
// 12,7 km Boden, von dem nichts bekannt ist. Die Rechnung stimmte dabei sogar (kein Steigungsfaktor
// wurde angesetzt) -- gelogen hat nur die Auskunft, und das ist die Sorte Fehler, die niemandem
// auffaellt, bis sie im Reiseplan steht.
//
// Der alte Test deckte nur „gar kein Raster" ab. Dieser hier deckt „Raster ja, aber nicht unter der
// Linie" -- und faellt ohne die Reparatur.
$abseitsBox = avesmapsBuildOffroadBox(0.5, 20.0, 9.5, 20.0, 0.5, 150000);
$abseitsGrid = avesmapsOffroadRasteriseBlocked($abseitsBox, avesmapsPrepareRouteAreas([]));
// Das Raster liegt am unteren Rand der Kiste, die Linie laeuft bei y = 20 -- weit darueber.
$abseitsRaster = ['origin_x' => 0.0, 'origin_y' => 0.0, 'cell' => 0.25, 'width' => 9, 'height' => 9,
    'samples' => pack('v*', ...array_fill(0, 81, 700))];
$abseitsPlane = avesmapsOffroadSampleHeights($abseitsBox, [$abseitsRaster]);

$abseits = avesmapsOffroadFindPath($abseitsBox, $abseitsGrid, null, $abseitsPlane, $speed, 0.5, 20.0, 9.5, 20.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [$abseitsRaster]);
assert($abseits !== null, 'die Strecke abseits des Rasters muss laufen');
assert($abseits['ascent_schritt'] === null,
    'ein Raster IN DER KISTE ist kein Messwert UNTER DER LINIE: ' . var_export($abseits['ascent_schritt'], true));
assert($abseits['descent_schritt'] === null, 'beide Haelften');
// ⭐ Und die Gegenprobe: dieselbe Kiste, aber die Linie laeuft DURCH das Raster -- dann sind 0,0
// richtig, denn dort wurde wirklich gemessen (ein Plateau ist eben).
$drueber = avesmapsOffroadFindPath($abseitsBox, $abseitsGrid, null, $abseitsPlane, $speed, 0.5, 1.0, 1.5, 1.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [$abseitsRaster]);
assert($drueber['ascent_schritt'] === 0.0, 'ueber dem Raster ist 0 ein Messwert: ' . var_export($drueber['ascent_schritt'], true));

// ============================================================ 6. terrain: three planes, MAXIMUM

// 💣 The three kinds lie ON TOP of each other -- a cell is „Kosch" AND „Wald" AND „Gebirge" at once.
// The factors combine by MAXIMUM, not by product: a product turns wood-in-mountains into a number
// nobody can explain (V11 §10.3).
$plainBox = avesmapsBuildOffroadBox(0.0, 0.0, 10.0, 0.0, 1.0, 150000);
$forest = avesmapsPrepareRouteAreas([$square(-5.0, -5.0, 15.0, 5.0)]);
$planes = [
    avesmapsOffroadRasteriseFactors($plainBox, [['prepared' => $forest, 'factor' => 1.40]]),
    avesmapsOffroadRasteriseFactors($plainBox, [['prepared' => $forest, 'factor' => 2.20]]),
    avesmapsOffroadRasteriseFactors($plainBox, [['prepared' => $forest, 'factor' => 1.05]]),
];
$combined = avesmapsOffroadCombineFactorPlanes($planes);
assert(is_string($combined), 'the combined factor plane is a binary string');
$mid = avesmapsOffroadFactorAt($plainBox, $combined, 5.0, 0.0);
assert($near($mid, 2.20, 1e-2), "maximum, not product: expected 2,20, got {$mid}");
// Outside every area the factor is 1,0 -- „no landscape here" is not „impassable" and not „free".
assert($near(avesmapsOffroadFactorAt($plainBox, $combined, 5.0, 4.9), 2.20, 1e-2), 'inside the wood stays 2,20');

// And it must actually cost time.
$plainGrid = avesmapsOffroadRasteriseBlocked($plainBox, avesmapsPrepareRouteAreas([]));
$cheap = avesmapsOffroadFindPath($plainBox, $plainGrid, null, null, $speed, 0.0, 0.0, 10.0, 0.0);
$dear = avesmapsOffroadFindPath($plainBox, $plainGrid, $combined, null, $speed, 0.0, 0.0, 10.0, 0.0);
assert($dear['time'] > $cheap['time'] * 2.0, 'a factor of 2,2 must be felt: ' . $dear['time'] . ' vs ' . $cheap['time']);
assert($near($dear['distance'], $cheap['distance'], 1e-9), 'and it must not change the LENGTH');

// ============================================================ 7. simplification: points, not length

// 💣 eps 0,10 costs nothing in length (measured over the four reference cases: 15 -> 4, 13 -> 5,
// 21 -> 10, 34 -> 6 points, each at 0,00 % length change). Bigger eps SHORTENS the line -- and the
// length is a travel time, so it may not shrink because the drawing gets prettier.
$stair = [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0], [4.0, 0.0], [5.0, 0.0]];
$simplified = avesmapsSimplifyLineDouglasPeucker($stair, 0.10);
assert(count($simplified) === 2, 'a straight run collapses to its two ends');

$lengthOf = static function (array $points): float {
    $sum = 0.0;
    for ($index = 1; $index < count($points); $index++) {
        $sum += hypot($points[$index][0] - $points[$index - 1][0], $points[$index][1] - $points[$index - 1][1]);
    }
    return $sum;
};
// A grid staircase at cell width 0,5 -- the shape the A* actually produces. Its corners sit 0,25
// off their chord, well above eps 0,10, so every one of them is KEPT.
//
// ⭐ THAT IS THE WHOLE REASON 0,10 COSTS NOTHING. It cannot remove a corner of a 0,5 grid, so it
// only ever drops collinear points -- which is why the four reference cases went 15/13/21/34 -> 4/5/10/6
// at 0,00 % length change. The saving comes from the straight runs, not from cutting bends.
$diagonal = [];
for ($step = 0; $step < 6; $step++) { $diagonal[] = [$step * 0.5, $step * 0.5]; $diagonal[] = [($step + 1) * 0.5, $step * 0.5]; }
$diagonalSimple = avesmapsSimplifyLineDouglasPeucker($diagonal, 0.10);
assert($near($lengthOf($diagonalSimple), $lengthOf($diagonal), 1e-9), 'eps 0,10 must not cost a single unit of length');

// 💣 AND A BIGGER EPS DOES SHORTEN IT. This is the assertion that defends the constant: at 0,50 the
// same staircase collapses towards its chord and loses length -- and the length IS a travel time.
$tooCoarse = avesmapsSimplifyLineDouglasPeucker($diagonal, 0.50);
assert($lengthOf($tooCoarse) < $lengthOf($diagonal) - 1e-9, 'a coarse eps shortens the line -- which is why it is 0,10');
assert(AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS === 0.10, 'the shipped constant is 0,10');

// The endpoints survive any eps -- they are the stitched real coordinates.
$kept = avesmapsSimplifyLineDouglasPeucker($diagonal, 99.0);
assert($kept[0] === $diagonal[0] && $kept[count($kept) - 1] === $diagonal[count($diagonal) - 1], 'the ends are never simplified away');
assert(count(avesmapsSimplifyLineDouglasPeucker([[1.0, 2.0]], 0.1)) === 1, 'a single point survives');

echo "offroad-astar-test: OK\n";

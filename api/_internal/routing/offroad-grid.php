<?php

declare(strict_types=1);

// V14: the cross-country A*. One calculator, two callers -- „Hierher reisen" (right click) and, later,
// the automatic detour trigger.
// Spec: docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md §5, whose first half was
// already designed AND MEASURED in V11 §10. Nothing here is derived anew; it is that entry taken over.
//
// PURITY CONTRACT: side-effect-free on include. Everything in this file is pure -- no PDO, no I/O.
// The two things that need the database (the water/land areas and the height rasters) are handed in
// already loaded, by land-areas.php, water-areas.php and heightmap-box.php.
//
// 💣 THE GRID IS NEVER A PHP ARRAY. Measured 33,2 bytes per cell as integers against 1 byte as a
// binary string: 568.000 cells are 18 MB one way and 0,5 MB the other (V11 §10.2). Every plane below
// is a string, read with $s[$i] and written with $s[$i] = chr(...).

require_once __DIR__ . '/land-areas.php';
require_once __DIR__ . '/terrain-factor.php';
require_once __DIR__ . '/../app/heightmap.php';

// ============================================================ the screws the owner may turn

// Cell width in map units. 0,5 units = 1.500 Schritt.
//
// 🔴 THE SEEN DECIDE THIS, NOT THE GEBIRGE. Measured narrowest bbox side per kind: Meer p50 129,9,
// Gebirge 26,4, Wald 15,0 -- and See 1,6, with 24 of 296 narrower than a single cell at 1,0. Since a
// touched cell counts as water, a 1 km wide lake would become a 3 km wall and a 60 km detour. At 0,5
// the typical lake is three cells wide and keeps its shape.
const AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS = 0.5;

// 💣 LOAD-BEARING FOR „Hierher reisen", where the boxes are large: air line from an arbitrary map
// point to the nearest named place is p50 39,5 / p90 157,8 / max 290 units -- p50 10.600 cells and
// max 568.000 (V11 §10.1). At 568.000 a MINIMAL A* already measured 816 ms, and the real one adds a
// height read, the curve, a terrain byte and a multiplication per relaxation (3-5x), with STRATO
// shared hosting another 2-3x on top: 5 to 12 seconds. Over the cap the code coarsens FOR THIS ONE
// REQUEST and writes the width it actually used into the answer.
const AVESMAPS_ROUTE_OFFROAD_CELL_LIMIT = 150000;

// The box is the bbox of the two points plus a margin, so the way may bulge out around an obstacle.
const AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_FRACTION = 0.30;
const AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_MIN = 2.0;

// ⚠️ 0,10 AND NOT MORE. Measured over the four reference cases it turns 15/13/21/34 raw grid points
// into 4/5/10/6 at a length change of 0,00 %. At 0,25 the line already shortens by 1,2-1,9 % -- and
// the length IS a travel time, so it may not shrink because the drawing gets prettier.
const AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS = 0.10;

// Factors are carried as one byte per cell at this scale: 2,20 -> 110. The largest seeded
// offroad_factor is 3,00 (suempfe_moore) -> 150, so 255 leaves room to 5,10.
const AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE = 50.0;

// 16 bit per cell, and the value IS the height in Schritt (V11 §3.2: no white point, no scaling).
// 💣 65535 means „NO DATA", not „very high". `null` and `0` are different things all the way through
// this house -- 0 is measured level ground, and the largest real height is ~15.000 Schritt.
const AVESMAPS_ROUTE_OFFROAD_HEIGHT_UNKNOWN = 65535;

// ============================================================ 1. the box

/**
 * PURE: the search box for two points -- bbox plus margin, snapped to whole cells.
 *
 * Over the cell cap the width DOUBLES until the box fits, so the width reported back to the caller
 * is always a clean multiple of the configured one.
 */
function avesmapsBuildOffroadBox(
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    float $cell = AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS,
    int $cellLimit = AVESMAPS_ROUTE_OFFROAD_CELL_LIMIT
): array {
    $margin = max(AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_MIN, hypot($x2 - $x1, $y2 - $y1) * AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_FRACTION);
    $minX = min($x1, $x2) - $margin;
    $minY = min($y1, $y2) - $margin;
    $maxX = max($x1, $x2) + $margin;
    $maxY = max($y1, $y2) + $margin;

    $width = $maxX - $minX;
    $height = $maxY - $minY;
    $requested = $cell > 0.0 ? $cell : AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS;
    $cell = $requested;
    $cols = (int) ceil($width / $cell) + 1;
    $rows = (int) ceil($height / $cell) + 1;
    while ($cols * $rows > $cellLimit) {
        $cell *= 2.0;
        $cols = (int) ceil($width / $cell) + 1;
        $rows = (int) ceil($height / $cell) + 1;
    }

    return [
        'min_x' => $minX,
        'min_y' => $minY,
        'max_x' => $minX + $cols * $cell,
        'max_y' => $minY + $rows * $cell,
        'cell' => $cell,
        'cols' => $cols,
        'rows' => $rows,
        'cell_count' => $cols * $rows,
        'coarsened' => $cell > $requested,
    ];
}

/** PURE: the centre of a cell, in map units. */
function avesmapsOffroadCellCentre(array $box, int $col, int $row): array
{
    return [
        $box['min_x'] + ($col + 0.5) * $box['cell'],
        $box['min_y'] + ($row + 0.5) * $box['cell'],
    ];
}

/** PURE: the cell a map point falls into, clamped into the box. */
function avesmapsOffroadCellOf(array $box, float $x, float $y): array
{
    $col = (int) floor(($x - $box['min_x']) / $box['cell']);
    $row = (int) floor(($y - $box['min_y']) / $box['cell']);

    return [
        max(0, min($box['cols'] - 1, $col)),
        max(0, min($box['rows'] - 1, $row)),
    ];
}

// ============================================================ 2. rasterising areas into the box

/**
 * PURE: walk every cell an area touches and hand it to $mark(int $index).
 *
 * Two passes, and both are needed:
 *   * a scanline over cell CENTRES fills the interior;
 *   * a walk along every edge catches areas thinner than a cell.
 * Together they implement „a touched cell counts", which is the safe direction for an obstacle
 * (rather go round than through) and the reason 0,5 is fine for a 1,6-unit lake.
 */
function avesmapsOffroadForEachTouchedCell(array $box, array $prepared, callable $mark): void
{
    $cell = $box['cell'];
    foreach (($prepared['areas'] ?? []) as $area) {
        if ($area['min_x'] > $box['max_x'] || $area['max_x'] < $box['min_x']
            || $area['min_y'] > $box['max_y'] || $area['max_y'] < $box['min_y']) {
            continue;
        }

        // -- interior, by cell centre
        $rowFrom = max(0, (int) floor(($area['min_y'] - $box['min_y']) / $cell) - 1);
        $rowTo = min($box['rows'] - 1, (int) ceil(($area['max_y'] - $box['min_y']) / $cell) + 1);
        $colFrom = max(0, (int) floor(($area['min_x'] - $box['min_x']) / $cell) - 1);
        $colTo = min($box['cols'] - 1, (int) ceil(($area['max_x'] - $box['min_x']) / $cell) + 1);
        for ($row = $rowFrom; $row <= $rowTo; $row++) {
            $y = $box['min_y'] + ($row + 0.5) * $cell;
            for ($col = $colFrom; $col <= $colTo; $col++) {
                $x = $box['min_x'] + ($col + 0.5) * $cell;
                if (avesmapsEcosystemPointInEdges($x, $y, $area['edges'])) {
                    $mark($row * $box['cols'] + $col);
                }
            }
        }

        // -- outline, in half-cell steps, so nothing thinner than a cell slips through
        foreach ($area['edges'] as $edge) {
            [$ex1, $ey1, $ex2, $ey2] = [$edge[0], $edge[1], $edge[2], $edge[3]];
            $steps = (int) ceil(hypot($ex2 - $ex1, $ey2 - $ey1) / ($cell * 0.5));
            for ($step = 0; $step <= $steps; $step++) {
                $t = $steps === 0 ? 0.0 : $step / $steps;
                $x = $ex1 + ($ex2 - $ex1) * $t;
                $y = $ey1 + ($ey2 - $ey1) * $t;
                if ($x < $box['min_x'] || $y < $box['min_y'] || $x > $box['max_x'] || $y > $box['max_y']) {
                    continue;
                }
                [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
                $mark($row * $box['cols'] + $col);
            }
        }
    }
}

/**
 * PURE: the occupancy plane -- "\x01" where water blocks, "\x00" elsewhere.
 *
 * 💣 The water areas come from V13's loader, unchanged. There is no second notion of water in this
 * house, and building one here would be the exact mistake the sources system paid for once.
 */
function avesmapsOffroadRasteriseBlocked(array $box, array $water): string
{
    $plane = str_repeat("\x00", $box['cell_count']);
    avesmapsOffroadForEachTouchedCell($box, $water, static function (int $index) use (&$plane): void {
        $plane[$index] = "\x01";
    });

    return $plane;
}

/**
 * PURE: ONE factor plane, one byte per cell, `chr(round(factor x 50))`; 0 means „nothing here".
 *
 * $layers is a list of ['prepared' => <prepared areas>, 'factor' => float]. Within ONE plane the
 * larger factor wins, which is the same maximum rule the three planes are combined by.
 */
function avesmapsOffroadRasteriseFactors(array $box, array $layers): string
{
    $plane = str_repeat("\x00", $box['cell_count']);
    foreach ($layers as $layer) {
        $prepared = is_array($layer['prepared'] ?? null) ? $layer['prepared'] : [];
        $byte = (int) round(((float) ($layer['factor'] ?? 1.0)) * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
        $byte = max(0, min(255, $byte));
        if ($byte === 0) { continue; }
        $character = chr($byte);
        avesmapsOffroadForEachTouchedCell($box, $prepared, static function (int $index) use (&$plane, $byte, $character): void {
            if (ord($plane[$index]) < $byte) { $plane[$index] = $character; }
        });
    }

    return $plane;
}

/**
 * PURE: the three kind planes into one, cell by cell, by MAXIMUM.
 *
 * 🔴 MAXIMUM, NOT PRODUCT, and this is a decision rather than an implementation detail (V11 §10.3):
 * `derographisch`, `vegetation` and `topographie` lie on top of each other, so a cell is „Kosch" AND
 * „Wald" AND „Gebirge" at once. Multiplying turns wood-in-mountains-in-a-region into a factor nobody
 * can explain afterwards.
 */
function avesmapsOffroadCombineFactorPlanes(array $planes): string
{
    $planes = array_values(array_filter($planes, static fn($plane): bool => is_string($plane) && $plane !== ''));
    if ($planes === []) { return ''; }

    $combined = array_shift($planes);
    $length = strlen($combined);
    foreach ($planes as $plane) {
        for ($index = 0; $index < $length; $index++) {
            if ($plane[$index] > $combined[$index]) { $combined[$index] = $plane[$index]; }
        }
    }

    return $combined;
}

/** PURE: the terrain factor at a map point; 1,0 where no landscape is known. */
function avesmapsOffroadFactorAt(array $box, string $plane, float $x, float $y): float
{
    if ($plane === '') { return 1.0; }
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
    $byte = ord($plane[$row * $box['cols'] + $col]);

    return $byte === 0 ? 1.0 : $byte / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE;
}

/**
 * PURE: the height plane -- 16 bit per cell, the value IS the height in Schritt.
 *
 * $rasters are already decoded (avesmapsHeightmapDecode). The sum over every raster covering a point
 * is V8's rule and the reader MUST sum: each raster holds only its own area's field, so reading „the
 * one raster that contains the point" is too low in every overlap strip and shows nothing unusual
 * doing it.
 */
function avesmapsOffroadSampleHeights(array $box, array $rasters): string
{
    $plane = str_repeat("\xFF\xFF", $box['cell_count']);
    if ($rasters === []) { return $plane; }

    // ⚠️ ONLY THE CELLS A RASTER CAN REACH. Sampling the whole box would ask every raster about
    // every cell -- at the 150.000-cell cap that is six figures of bilinear lookups to learn „no
    // data" for ground no raster covers. A raster is a mountain range; a box is a journey.
    $unionMinX = INF; $unionMinY = INF; $unionMaxX = -INF; $unionMaxY = -INF;
    foreach ($rasters as $raster) {
        $unionMinX = min($unionMinX, $raster['origin_x']);
        $unionMinY = min($unionMinY, $raster['origin_y']);
        $unionMaxX = max($unionMaxX, $raster['origin_x'] + ($raster['width'] - 1) * $raster['cell']);
        $unionMaxY = max($unionMaxY, $raster['origin_y'] + ($raster['height'] - 1) * $raster['cell']);
    }
    $rowFrom = max(0, (int) floor(($unionMinY - $box['min_y']) / $box['cell']) - 1);
    $rowTo = min($box['rows'] - 1, (int) ceil(($unionMaxY - $box['min_y']) / $box['cell']) + 1);
    $colFrom = max(0, (int) floor(($unionMinX - $box['min_x']) / $box['cell']) - 1);
    $colTo = min($box['cols'] - 1, (int) ceil(($unionMaxX - $box['min_x']) / $box['cell']) + 1);

    for ($row = $rowFrom; $row <= $rowTo; $row++) {
        $y = $box['min_y'] + ($row + 0.5) * $box['cell'];
        for ($col = $colFrom; $col <= $colTo; $col++) {
            $x = $box['min_x'] + ($col + 0.5) * $box['cell'];
            $height = avesmapsHeightmapSampleSum($rasters, $x, $y);
            if ($height === null) { continue; }
            $value = (int) round($height);
            $value = max(0, min(AVESMAPS_ROUTE_OFFROAD_HEIGHT_UNKNOWN - 1, $value));
            $offset = 2 * ($row * $box['cols'] + $col);
            $packed = pack('v', $value);
            $plane[$offset] = $packed[0];
            $plane[$offset + 1] = $packed[1];
        }
    }

    return $plane;
}

/** PURE: the height of one cell in Schritt, or null where nothing is known. */
function avesmapsOffroadHeightAtCell(?string $plane, int $index): ?float
{
    if ($plane === null || $plane === '') { return null; }
    $value = unpack('v', $plane, 2 * $index)[1];

    return $value === AVESMAPS_ROUTE_OFFROAD_HEIGHT_UNKNOWN ? null : (float) $value;
}

// ============================================================ 3. the A* itself

/**
 * PURE: the cheapest cross-country way from (x1,y1) to (x2,y2), or null when there is none.
 *
 * Cost of a step: `Strecke / Grundtempo(Querfeldein) x Steigungsfaktor x Geländefaktor` -- the V11
 * §10 formula, with the slope factor taken from the ONE place the model lives
 * (avesmapsTerrainLeistungsFactor), never recomputed here.
 *
 * ⭐ THE HEURISTIC IS SHARP, and no measurement is needed to know it. The Leistungskilometer model
 * has no floor (`terrain-factor.php:60-63`: „THERE IS NO FLOOR ANY MORE"), and every seeded
 * offroad_factor is >= 1,00 -- so the smallest possible factor is EXACTLY 1,0 and
 * `air line / speed` never overestimates. V14 §5.3 planned to measure the smallest occurring factor;
 * that measurement is void, because the answer is structural.
 *
 * ⚠️ Start and target cells are forced passable (§5.2). 571 of 4.653 places lie geometrically INSIDE
 * water -- without this every harbour town answers „kein Weg" before the search begins.
 *
 * Returns ['points' => [[x,y],...], 'distance' => map units, 'time' => graph cost, 'cells_opened' => int].
 * The points are STITCHED to the real endpoints and simplified; distance is measured over exactly
 * those points.
 *
 * 💣 `time` IS THE GRAPH'S COST UNIT, NOT HOURS. The whole client graph computes
 * `Strecke[Karteneinheiten] / Tempo[km/h]` (`client-graph.php:386`) -- consistent everywhere, and
 * three times smaller than real hours because one map unit is three Meilen. This function uses the
 * same convention deliberately: an edge that priced itself in hours would be three times dearer than
 * every road it competes with, and Dijkstra would refuse to use it. Reading it AS hours is the
 * Faktor-3 trap that already went live once.
 */
function avesmapsOffroadFindPath(
    array $box,
    string $blocked,
    ?string $factors,
    ?string $heights,
    float $speed,
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
    array $rasters = []
): ?array {
    if ($speed <= 0.0) { return null; }

    $cols = $box['cols'];
    $rows = $box['rows'];
    $cell = $box['cell'];
    [$startCol, $startRow] = avesmapsOffroadCellOf($box, $x1, $y1);
    [$goalCol, $goalRow] = avesmapsOffroadCellOf($box, $x2, $y2);
    $start = $startRow * $cols + $startCol;
    $goal = $goalRow * $cols + $goalCol;

    if ($start === $goal) {
        return avesmapsOffroadFinishPath([[$x1, $y1], [$x2, $y2]], $speed, $factors, $heights, $box, $eps, 0, $rasters);
    }

    // §5.2, and it is the reason $blocked is edited by value: the freeing applies to THIS request.
    //
    // 💣 ONE CELL IS NOT ENOUGH, and finding that out is what this rule is worth. A harbour town does
    // not sit on the edge of the sea polygon, it sits INSIDE it -- freeing only its own cell leaves
    // all eight neighbours blocked and the search is trapped before its first step. Freed is
    // therefore everything within V13's COASTAL TOLERANCE of an endpoint.
    //
    // ⭐ That constant is reused rather than invented: 1,0 map unit is the measured width of coastal
    // drawing slop (V13 §9 -- at 1,0 exactly 23 bridges come back and all 23 are coastal hops, while
    // all 7 real sea crossings stay blocked). A second number here would be a second answer to the
    // same question, and the two would drift.
    avesmapsOffroadFreeAround($box, $blocked, $x1, $y1);
    avesmapsOffroadFreeAround($box, $blocked, $x2, $y2);

    $goalCentre = avesmapsOffroadCellCentre($box, $goalCol, $goalRow);
    $best = [$start => 0.0];
    $cameFrom = [];
    $closed = str_repeat("\x00", $box['cell_count']);
    $queue = new SplPriorityQueue();
    $queue->setExtractFlags(SplPriorityQueue::EXTR_DATA);
    $queue->insert($start, 0.0);
    $opened = 0;

    // 8 neighbours as (dCol, dRow); the diagonal step is sqrt(2) cells long.
    $neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    $found = false;

    while (!$queue->isEmpty()) {
        $current = $queue->extract();
        if ($closed[$current] === "\x01") { continue; }
        $closed[$current] = "\x01";
        $opened++;
        if ($current === $goal) { $found = true; break; }

        $currentRow = intdiv($current, $cols);
        $currentCol = $current - $currentRow * $cols;
        $currentHeight = avesmapsOffroadHeightAtCell($heights, $current);
        $currentFactor = $factors === null || $factors === ''
            ? 1.0
            : (ord($factors[$current]) === 0 ? 1.0 : ord($factors[$current]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);

        foreach ($neighbours as [$deltaCol, $deltaRow]) {
            $nextCol = $currentCol + $deltaCol;
            $nextRow = $currentRow + $deltaRow;
            if ($nextCol < 0 || $nextRow < 0 || $nextCol >= $cols || $nextRow >= $rows) { continue; }
            $next = $nextRow * $cols + $nextCol;
            if ($blocked[$next] === "\x01" || $closed[$next] === "\x01") { continue; }

            $distance = ($deltaCol !== 0 && $deltaRow !== 0) ? $cell * M_SQRT2 : $cell;

            // The slope factor for this one step, from the two cell heights. Unknown on either side
            // means „no height data here" -> factor 1,0, exactly as V11 already does for ways.
            $nextHeight = avesmapsOffroadHeightAtCell($heights, $next);
            $slopeFactor = 1.0;
            if ($currentHeight !== null && $nextHeight !== null) {
                $ascent = max(0.0, $nextHeight - $currentHeight);
                $drop = max(0.0, $currentHeight - $nextHeight);
                $steepDrop = avesmapsTerrainDescentIsSteep($drop, $distance) ? $drop : 0.0;
                $slopeFactor = avesmapsTerrainLeistungsFactor($ascent, $steepDrop, $distance);
            }

            $nextFactor = $factors === null || $factors === ''
                ? 1.0
                : (ord($factors[$next]) === 0 ? 1.0 : ord($factors[$next]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
            // The larger of the two cells, so the cost of a step does not depend on its direction --
            // an asymmetric edge would break A*'s consistency, not just its numbers.
            $groundFactor = max($currentFactor, $nextFactor);

            $cost = ($best[$current] ?? INF) + ($distance / $speed) * $slopeFactor * $groundFactor;
            if ($cost >= ($best[$next] ?? INF)) { continue; }

            $best[$next] = $cost;
            $cameFrom[$next] = $current;
            $centre = avesmapsOffroadCellCentre($box, $nextCol, $nextRow);
            $heuristic = hypot($goalCentre[0] - $centre[0], $goalCentre[1] - $centre[1]) / $speed;
            $queue->insert($next, -($cost + $heuristic));
        }
    }

    if (!$found) { return null; }

    $cells = [];
    for ($node = $goal; $node !== $start; $node = $cameFrom[$node]) { $cells[] = $node; }
    $cells[] = $start;
    $cells = array_reverse($cells);

    $points = [];
    foreach ($cells as $node) {
        $nodeRow = intdiv($node, $cols);
        $points[] = avesmapsOffroadCellCentre($box, $node - $nodeRow * $cols, $nodeRow);
    }

    // 💣 STITCHED TO THE REAL ENDPOINTS (§5.4). A cell centre lies up to 0,35 units off the real
    // point at width 0,5; measured on Gluckenhang -> Wasserburg the raw A* reported 2,2 units against
    // an air line of 2,5 -- a way shorter than the straight line, which cannot be. Replacing the two
    // outer centres and recomputing the length over the stitched sequence is what makes every short
    // hop honest.
    $points[0] = [$x1, $y1];
    $points[count($points) - 1] = [$x2, $y2];

    return avesmapsOffroadFinishPath($points, $speed, $factors, $heights, $box, $eps, $opened, $rasters);
}

/**
 * PURE: simplify, then measure length AND time over exactly the line that will be shipped.
 *
 * 💣 MEASURED ALONG THE LINE, IN GRID STEPS -- not from the A*'s accumulated cost, and not from the
 * corner points alone. Two reasons, and both were found by a failing test rather than by thinking:
 *
 *   * The A*'s own cost belongs to the raw staircase, which is longer than the simplified line it is
 *     printed under. The number below a line has to be the number OF that line.
 *   * Sampling only the corner points measures nothing at all: after simplification a straight run
 *     across a ridge is TWO points, both of them off the raster, so every factor comes back 1,0 and
 *     the height silently stops acting. That is exactly what the ridge test caught.
 *
 * ⚠️ The climb is a TOTAL VARIATION and therefore depends on the sampling density -- half-cell steps
 * here, matching the resolution the search itself priced at. Same rule as V11 §5.3: one resolution
 * for everything, or the same ground yields two different ascents.
 */
function avesmapsOffroadFinishPath(array $points, float $speed, ?string $factors, ?string $heights, array $box, float $eps, int $opened, array $rasters = []): array
{
    $points = avesmapsSimplifyLineDouglasPeucker($points, $eps);

    // 🔴 EINE AUFLÖSUNG FÜR ALLES, und die steht in terrain-store.php:32. Der Anstieg ist eine TOTALE
    // VARIATION und waechst mit der Abtastdichte -- x sqrt(2) je Halbierung. Wer die Etappe im
    // Zellraster (0,5) integriert, waehrend jeder gezeichnete Weg im Rasterraster (0,25) integriert
    // wird, laesst dieselbe Flanke je nach Frager verschieden hoch aussehen -- und beide Zahlen
    // stehen im selben Reiseplan untereinander.
    //
    // ⚠️ Deshalb wird hier direkt aus den RASTERN gelesen, nicht aus der Zellebene: die kennt je
    // Zelle nur einen Wert und kann feiner gar nicht antworten. Die SUCHE darf gerne grob bleiben --
    // sie muss Wege nur ordnen --, aber die Zahl unter der Linie ist eine Aussage ueber das Gelaende
    // und gehoert in die Sprache aller anderen.
    $sampleStep = $rasters !== [] ? AVESMAPS_TERRAIN_CELL_SIZE : $box['cell'] * 0.5;
    $heightAt = $rasters !== []
        ? static fn(float $x, float $y): ?float => avesmapsHeightmapSampleSum($rasters, $x, $y)
        : static fn(float $x, float $y): ?float => avesmapsOffroadHeightAtCell($heights, avesmapsOffroadIndexOf($box, $x, $y));

    $knowsHeight = $rasters !== [] || ($heights !== null && $heights !== '');
    $distance = 0.0;
    $time = 0.0;
    $ascent = $knowsHeight ? 0.0 : null;
    $descent = $knowsHeight ? 0.0 : null;

    for ($index = 1; $index < count($points); $index++) {
        [$fromX, $fromY] = $points[$index - 1];
        [$toX, $toY] = $points[$index];
        $length = hypot($toX - $fromX, $toY - $fromY);
        if ($length <= 0.0) { continue; }
        $distance += $length;

        $steps = max(1, (int) ceil($length / $sampleStep));
        $stepLength = $length / $steps;
        $previousHeight = $heightAt($fromX, $fromY);
        for ($step = 1; $step <= $steps; $step++) {
            $t = $step / $steps;
            $x = $fromX + ($toX - $fromX) * $t;
            $y = $fromY + ($toY - $fromY) * $t;
            $height = $heightAt($x, $y);

            $slopeFactor = 1.0;
            if ($previousHeight !== null && $height !== null) {
                $climb = max(0.0, $height - $previousHeight);
                $drop = max(0.0, $previousHeight - $height);
                $steepDrop = avesmapsTerrainDescentIsSteep($drop, $stepLength) ? $drop : 0.0;
                $slopeFactor = avesmapsTerrainLeistungsFactor($climb, $steepDrop, $stepLength);
                if ($ascent !== null) { $ascent += $climb; $descent += $drop; }
            }

            $groundFactor = avesmapsOffroadFactorAt($box, $factors ?? '', $x, $y);
            $time += ($stepLength / $speed) * $slopeFactor * $groundFactor;
            $previousHeight = $height;
        }
    }

    return [
        'points' => $points,
        'distance' => $distance,
        'time' => $time,
        // V11's two sums, so the leg can say what it climbed exactly like a drawn way does.
        // 💣 `null` means „no height data along here", `0.0` means „measured level" -- never the same,
        // and `round` keeps that difference because it never turns null into a number.
        //
        // ⚠️ GANZE SCHRITT, wie ein gezeichneter Weg: `path_terrain.ascent_schritt` ist INT UNSIGNED.
        // 1 Schritt ist 1 Meter -- Nachkommastellen auf einer Summe bilinearer Abtastungen sind
        // Rauschen, und daneben im selben Reiseplan stehen ganze Zahlen.
        'ascent_schritt' => $ascent === null ? null : round($ascent),
        'descent_schritt' => $descent === null ? null : round($descent),
        'cells_opened' => $opened,
    ];
}

/**
 * PURE: free every cell whose centre lies within the coastal tolerance of (x, y).
 *
 * Always frees the point's own cell, whatever the tolerance -- a start you cannot leave is the one
 * failure this rule exists to prevent.
 */
function avesmapsOffroadFreeAround(array $box, string &$blocked, float $x, float $y): void
{
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
    $blocked[$row * $box['cols'] + $col] = "\x00";

    $reach = (int) ceil(AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE / $box['cell']);
    for ($deltaRow = -$reach; $deltaRow <= $reach; $deltaRow++) {
        $nextRow = $row + $deltaRow;
        if ($nextRow < 0 || $nextRow >= $box['rows']) { continue; }
        for ($deltaCol = -$reach; $deltaCol <= $reach; $deltaCol++) {
            $nextCol = $col + $deltaCol;
            if ($nextCol < 0 || $nextCol >= $box['cols']) { continue; }
            [$centreX, $centreY] = avesmapsOffroadCellCentre($box, $nextCol, $nextRow);
            if (hypot($centreX - $x, $centreY - $y) <= AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE) {
                $blocked[$nextRow * $box['cols'] + $nextCol] = "\x00";
            }
        }
    }
}

/** PURE: cell index of a map point. */
function avesmapsOffroadIndexOf(array $box, float $x, float $y): int
{
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);

    return $row * $box['cols'] + $col;
}

// ============================================================ 4. Douglas-Peucker, in PHP

/**
 * PURE: Douglas-Peucker with a real epsilon, in map units.
 *
 * 💣 NEW BUILD, and the spec's self-check wrongly listed it as present. The only simplifier in the
 * house is Leaflet's `L.LineUtil.simplify` (js/map-features/map-features-ecosystem-simplify.js) --
 * client-side, zero hits under api/, and it works towards a TARGET POINT COUNT rather than an eps.
 *
 * The two endpoints are never touched: they are the stitched real coordinates (§5.4).
 */
function avesmapsSimplifyLineDouglasPeucker(array $points, float $eps): array
{
    $count = count($points);
    if ($count <= 2 || $eps <= 0.0) { return array_values($points); }

    $keep = array_fill(0, $count, false);
    $keep[0] = true;
    $keep[$count - 1] = true;

    $stack = [[0, $count - 1]];
    while ($stack !== []) {
        [$first, $last] = array_pop($stack);
        if ($last <= $first + 1) { continue; }

        [$x1, $y1] = $points[$first];
        [$x2, $y2] = $points[$last];
        $deltaX = $x2 - $x1;
        $deltaY = $y2 - $y1;
        $lengthSquared = $deltaX * $deltaX + $deltaY * $deltaY;

        $worst = -1.0;
        $worstIndex = -1;
        for ($index = $first + 1; $index < $last; $index++) {
            [$px, $py] = $points[$index];
            if ($lengthSquared <= 0.0) {
                $distance = hypot($px - $x1, $py - $y1);
            } else {
                $t = (($px - $x1) * $deltaX + ($py - $y1) * $deltaY) / $lengthSquared;
                $t = max(0.0, min(1.0, $t));
                $distance = hypot($px - ($x1 + $t * $deltaX), $py - ($y1 + $t * $deltaY));
            }
            if ($distance > $worst) { $worst = $distance; $worstIndex = $index; }
        }

        if ($worst > $eps && $worstIndex > 0) {
            $keep[$worstIndex] = true;
            $stack[] = [$first, $worstIndex];
            $stack[] = [$worstIndex, $last];
        }
    }

    $simplified = [];
    foreach ($points as $index => $point) {
        if ($keep[$index]) { $simplified[] = $point; }
    }

    return $simplified;
}

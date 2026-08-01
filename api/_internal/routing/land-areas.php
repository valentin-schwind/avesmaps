<?php

declare(strict_types=1);

// „Hierher reisen": is the point the user right-clicked on LAND?
// Instruction: docs/superpowers/plans/2026-07-30-hierher-reisen-und-astar.md §1.
//
// PURITY CONTRACT: side-effect-free on include. The loader takes a PDO explicitly and never throws;
// everything below it is pure.
//
// 💣 THE CHECK GUARDS THE CLICKED POINT AND NOTHING ELSE. Owner, verbatim: „ORTE IM WASSER sind
// nicht zu überprüfen, diese können per Straße immer erreicht werden. Es geht bei der
// Wasser-Überprüfung um ‚Hierhin reisen' → einen beliebigen Punkt." An earlier draft wanted to test
// PLACES and had measured that 85 of 2.674 would fail (Belhanka, Nostria). That is the wrong
// question: extending this check to places builds a defect that never existed. V13 §2.3 says the
// same thing from the other side -- 571 of 4.653 places sit geometrically inside water.
//
// 💣 THERE WAS NO LAND LOADER. V13 reads `meer` + `see` and nothing else; `kontinent`/`insel` are
// loaded nowhere in the routing path. This file is that loader, built to V13's pattern -- same
// query shape, same „fail inert" rule, and the SAME prepared structure, so the point test below
// works on land and water alike.

require_once __DIR__ . '/water-areas.php';

// ⚠️ BY `region_type`, NEVER BY `kind`. The two land types sit on two different kinds since
// 2026-07-30: `kontinent` is `derographisch`, `insel` moved to `topographie`
// (avesmapsEcosystemMoveIslandsToTopographie). A `kind` filter loses one of them -- and „loses
// land" means „refuses to travel there", which looks like a broken feature, not a wrong filter.
//
// ⚠️ `kueste` and `inselgruppe` are deliberately absent, and by this rule they are neither land nor
// water. They fall into the 0,7 % measured below and are treated as water.
const AVESMAPS_ROUTE_LAND_REGION_TYPES = ['kontinent', 'insel'];

/**
 * Land areas for this request, already prepared. Returns the empty structure on ANY problem.
 *
 * ⭐ Failing inert is the designed behaviour, exactly as in V13: if the table is missing or the query
 * fails, no point is land and „Hierher reisen" refuses politely. A routing request may never 500
 * because the landscape layer had a bad day -- and refusing is the safe direction here, because the
 * alternative is planning a march across an ocean.
 *
 * 💣 NO DDL on this path. The ecosystem module owns these tables.
 */
function avesmapsLoadRouteLand(array $config, ?PDO $pdo = null): array
{
    try {
        $pdo ??= avesmapsCreatePdo($config['database'] ?? []);

        $statement = $pdo->prepare(
            'SELECT a.geometry_geojson, a.min_x, a.min_y, a.max_x, a.max_y
             FROM ecosystem_area a
             INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
             WHERE a.is_active = 1
               AND a.is_trial = 0
               AND r.region_type IN (' . implode(', ', array_fill(0, count(AVESMAPS_ROUTE_LAND_REGION_TYPES), '?')) . ')'
        );
        $statement->execute(AVESMAPS_ROUTE_LAND_REGION_TYPES);

        $rows = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
            if (!is_array($geometry)) { continue; }
            $rows[] = [
                'geometry' => $geometry,
                'min_x' => (float) ($row['min_x'] ?? 0.0),
                'min_y' => (float) ($row['min_y'] ?? 0.0),
                'max_x' => (float) ($row['max_x'] ?? 0.0),
                'max_y' => (float) ($row['max_y'] ?? 0.0),
            ];
        }

        return avesmapsPrepareRouteAreas($rows);
    } catch (Throwable) {
        return avesmapsPrepareRouteAreas([]);
    }
}

/**
 * PURE: rows -> areas (edges + bbox) plus a lookup grid.
 *
 * ⭐ This is V13's avesmapsPrepareRouteWater() under the name it always deserved: nothing in it is
 * about water. Land and water go through the SAME preparation on purpose, so „is this point inside
 * any of these areas" is one function asked twice instead of two functions that could drift.
 */
function avesmapsPrepareRouteAreas(array $rows): array
{
    return avesmapsPrepareRouteWater($rows);
}

/**
 * PURE: does (x, y) lie inside ANY of the prepared areas?
 *
 * The grid is a prefilter, never a filter: it narrows the candidates, and each candidate is then
 * asked exactly by its bbox and its edges. Empty structure -> false, so callers need no special case.
 */
function avesmapsRouteAreasContainPoint(float $x, float $y, array $prepared): bool
{
    $areas = $prepared['areas'] ?? [];
    if ($areas === []) { return false; }

    $cellKey = ((int) floor($x / AVESMAPS_ROUTE_WATER_GRID_CELL)) . ':'
        . ((int) floor($y / AVESMAPS_ROUTE_WATER_GRID_CELL));
    foreach (($prepared['grid'] ?? [])[$cellKey] ?? [] as $index) {
        $area = $areas[$index];
        if ($area['min_x'] > $x || $area['max_x'] < $x || $area['min_y'] > $y || $area['max_y'] < $y) {
            continue;
        }
        if (avesmapsEcosystemPointInEdges($x, $y, $area['edges'])) { return true; }
    }

    return false;
}

/**
 * PURE: the whole rule, in one line -- „in a land area AND in no water area".
 *
 * 💣 WATER BEATS LAND, and that ordering is the rule rather than a tidy-up: every lake on the map
 * lies geometrically inside a continent, so asking only „is it land?" answers yes for all 296 of
 * them. Measured over 262.144 raster points on 2026-07-30 (ecosystem_revision 6211): water 67,6 %,
 * land 31,7 %, in NEITHER 0,7 %, doubly declared 0,4 %. Coverage 99,3 %.
 *
 * The 0,7 % that are declared as nothing come out FALSE -- inventing land where the data is silent
 * would send a traveller into an unmapped void, while refusing merely says „pick another point".
 */
function avesmapsRoutePointIsOnLand(float $x, float $y, array $land, array $water): bool
{
    if (avesmapsRouteAreasContainPoint($x, $y, $water)) { return false; }

    return avesmapsRouteAreasContainPoint($x, $y, $land);
}

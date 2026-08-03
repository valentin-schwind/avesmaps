<?php

declare(strict_types=1);

/**
 * The season's grip on the ground: climate zone + season -> ground condition -> a speed factor per
 * way type.
 *
 * 🔴 THE SOURCE SUBTRACTS, IT DOES NOT ADD A PERCENTAGE. Geographia Aventurica S. 122 f.:
 * softened ground / light snow is **−0,1 on the movement multiplier**, heavily softened ground,
 * deep snow or ice **−0,2**, and "durch Boden kann der Gesamtwert nicht unter 0,05 sinken".
 * That single sentence is why no share table is needed: a subtraction hurts weak terrain far more
 * than strong terrain, all by itself.
 *
 *   Reichsstrasse 1,1 − 0,2 = 0,9  ->  +22 % travel time
 *   Strasse       1,0 − 0,2 = 0,8  ->  +25 %
 *   Gebirgspass   0,4 − 0,2 = 0,2  ->  +100 %
 *   Gebirgspfad   0,3 − 0,2 = 0,1  ->  +200 %
 *
 * "Roads get cleared, cross-country does not" therefore falls out of the source instead of being
 * modelled by hand.
 *
 * 💣 AND HERE IS THE AWKWARD PART, WRITTEN DOWN ON PURPOSE. Avesmaps keeps no movement multiplier.
 * It keeps SPEEDS per (transport x way type) in AVESMAPS_ROUTE_CLIENT_SPEED_TABLE, and those speeds
 * are not a clean image of the source table either: measured against Strasse = 1,0 our Pfad sits at
 * 0,749, the source says 0,8. So the subtraction needs a scale to happen ON, and that scale is
 * AVESMAPS_SEASON_GROUND_PATH_FACTORS below -- the source's own column, normalised to Strasse = 1,0.
 *
 * The deduction is applied RELATIVELY:
 *
 *     speed_new = speed_old * (max(0,05, f − penalty) / f)
 *
 * Two things follow, both wanted:
 *   - without a departure date the factor is exactly 1,0 and every number stays what it was today,
 *   - the deduction is independent of the mode of transport, exactly as the source states it. Deriving
 *     `f` from our own table instead would make it transport-dependent (groupFoot 0,876 on Weg,
 *     groupHorse 0,846) -- a winter that hits a rider differently than a walker, which no source says.
 */

require_once __DIR__ . '/travel-calendar.php';

/**
 * The source's terrain column (S. 123), normalised to Strasse = 1,0, for the way types Avesmaps
 * actually routes on. This is the scale the subtraction happens on -- not our speed table.
 *
 * Querfeldein = "Offenes Gelände" 0,75. Wuestenpfad = "Sandwüste/Geröllwüste" 0,5.
 * Flussweg/Seeweg carry no entry on purpose: water has no ground (see below).
 */
const AVESMAPS_SEASON_GROUND_PATH_FACTORS = [
    'Reichsstrasse' => 1.1,
    'Strasse' => 1.0,
    'Weg' => 0.8,
    'Pfad' => 0.8,
    'Gebirgspass' => 0.4,
    'Wuestenpfad' => 0.5,
    'Querfeldein' => 0.75,
];

/** „durch Boden kann der Gesamtwert nicht unter 0,05 sinken" (Reisehandbuch §11). */
const AVESMAPS_SEASON_GROUND_FLOOR = 0.05;

/**
 * The ground conditions the source knows, with their deduction and whether a paved road escapes them.
 *
 * 💣 THE ROAD EXEMPTION IS ONLY ABOUT WETNESS. §21 reads "aufgeweichter Boden … Straße ausgenommen
 * bei Nässe". Snow and ice hit the road as well -- an Reichsstrasse under deep snow is a road under
 * deep snow. Exempting it from everything would make a winter journey through the north as fast as a
 * summer one, which is the opposite of what the whole feature is for.
 */
const AVESMAPS_SEASON_GROUND_CONDITIONS = [
    'aufgeweicht' => ['penalty' => 0.1, 'road_exempt' => true],
    'tauboden' => ['penalty' => 0.1, 'road_exempt' => true],
    'schnee_leicht' => ['penalty' => 0.1, 'road_exempt' => false],
    'tiefschnee' => ['penalty' => 0.2, 'road_exempt' => false],
    'eis' => ['penalty' => 0.2, 'road_exempt' => false],
];

/** The way types the road exemption covers: paved and maintained. A Weg is a cart track, and a cart
 *  track softens. */
const AVESMAPS_SEASON_GROUND_ROAD_TYPES = ['Reichsstrasse', 'Strasse'];

/**
 * Climate zone x season -> ground condition. Owner-approved 2026-08-03.
 *
 * ⚠️ THIS TABLE IS A SETTING, NOT CANON. The source names the ground conditions and their deductions,
 * but no "month x region -> ground" table; that mapping is ours. It is deliberately one table in one
 * place so a correction is a line, not a rewrite. The zone keys are the seven of the climate layer
 * (docs/superpowers/specs/2026-08-03-klimazonen-design.md §3).
 *
 * Empty string = no deduction. The subtropics stay free on purpose: great heat is a WEATHER factor in
 * the source (x0,9 / x0,8), not a season, and the planner does not choose the weather. The tropics
 * stay free because the rainforest already slows cross-country travel through the terrain factor --
 * counting it again here would be the same brake twice.
 */
const AVESMAPS_SEASON_GROUND_TABLE = [
    'polar' => ['winter' => 'eis', 'fruehling' => 'eis', 'sommer' => 'tauboden', 'herbst' => 'eis'],
    'subpolar' => ['winter' => 'tiefschnee', 'fruehling' => 'aufgeweicht', 'sommer' => '', 'herbst' => 'aufgeweicht'],
    'boreal' => ['winter' => 'tiefschnee', 'fruehling' => 'aufgeweicht', 'sommer' => '', 'herbst' => 'aufgeweicht'],
    'gemaessigt' => ['winter' => 'schnee_leicht', 'fruehling' => 'aufgeweicht', 'sommer' => '', 'herbst' => 'aufgeweicht'],
    'subtropen_winterfeucht' => ['winter' => 'aufgeweicht', 'fruehling' => '', 'sommer' => '', 'herbst' => ''],
    'subtropisch' => ['winter' => '', 'fruehling' => '', 'sommer' => '', 'herbst' => ''],
    'tropisch' => ['winter' => '', 'fruehling' => '', 'sommer' => '', 'herbst' => ''],
];

/**
 * Water carries no ground. For a river or sea leg the season acts ONLY through a closure
 * (ice drift, winter storms) -- never through a deduction.
 */
const AVESMAPS_SEASON_GROUND_WATER_TYPES = ['Flussweg', 'Seeweg'];

/**
 * Climate zone + season -> the ground condition key, '' when the season leaves this zone alone.
 */
function avesmapsSeasonGroundCondition(?string $zoneKey, ?string $season): string
{
    $zone = strtolower(trim((string) $zoneKey));
    $seasonKey = strtolower(trim((string) $season));
    if ($zone === '' || $seasonKey === '' || !isset(AVESMAPS_SEASON_GROUND_TABLE[$zone])) {
        return '';
    }
    return AVESMAPS_SEASON_GROUND_TABLE[$zone][$seasonKey] ?? '';
}

/**
 * The factor a leg's speed is multiplied by. 1,0 means "unchanged" -- and that is what every caller
 * without a departure date, on water, or on an unknown way type gets.
 *
 * @param string      $pathType  route_type of the leg ('Strasse', 'Gebirgspass', 'Seeweg', …)
 * @param string|null $zoneKey   climate zone of the leg ('boreal', …)
 * @param string|null $season    'winter' | 'fruehling' | 'sommer' | 'herbst'
 */
function avesmapsSeasonSpeedFactor(string $pathType, ?string $zoneKey, ?string $season): float
{
    if (in_array($pathType, AVESMAPS_SEASON_GROUND_WATER_TYPES, true)) {
        return 1.0;
    }
    $condition = avesmapsSeasonGroundCondition($zoneKey, $season);
    if ($condition === '' || !isset(AVESMAPS_SEASON_GROUND_CONDITIONS[$condition])) {
        return 1.0;
    }
    $baseFactor = AVESMAPS_SEASON_GROUND_PATH_FACTORS[$pathType] ?? null;
    if ($baseFactor === null || $baseFactor <= 0.0) {
        // An unknown way type is left alone rather than guessed at. A wrong guess here would be a
        // silent, permanent slowdown on a type nobody thought about.
        return 1.0;
    }
    $rule = AVESMAPS_SEASON_GROUND_CONDITIONS[$condition];
    if ($rule['road_exempt'] && in_array($pathType, AVESMAPS_SEASON_GROUND_ROAD_TYPES, true)) {
        return 1.0;
    }
    $reduced = max(AVESMAPS_SEASON_GROUND_FLOOR, $baseFactor - (float) $rule['penalty']);
    return $reduced / $baseFactor;
}

/**
 * Everything a leg needs to explain itself in the plan: the condition, its deduction, the resulting
 * factor and the percentage of travel time it adds. Null when the season does nothing here -- so a
 * caller can leave the note off entirely instead of printing "+0 %".
 */
function avesmapsSeasonGroundReport(string $pathType, ?string $zoneKey, ?string $season): ?array
{
    $factor = avesmapsSeasonSpeedFactor($pathType, $zoneKey, $season);
    if ($factor >= 1.0) {
        return null;
    }
    $condition = avesmapsSeasonGroundCondition($zoneKey, $season);
    return [
        'condition' => $condition,
        'penalty' => (float) AVESMAPS_SEASON_GROUND_CONDITIONS[$condition]['penalty'],
        'speed_factor' => $factor,
        // Time is the reciprocal of speed: half the speed is twice the time, not "50 % more".
        'time_percent' => (1.0 / $factor - 1.0) * 100.0,
        'season' => strtolower(trim((string) $season)),
        'zone' => strtolower(trim((string) $zoneKey)),
    ];
}

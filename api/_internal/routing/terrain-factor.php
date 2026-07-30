<?php

declare(strict_types=1);

// V11: how a slope becomes a time factor. Spec §4.4.
//
// PURITY CONTRACT: side-effect-free on include, no PDO, no blob, no I/O. This file is the ONE place
// the curve lives, so the measurement of §7.2 can retune it by editing four numbers and nothing else.
//
// 🔴 THE NUMBERS BELOW WERE CHOSEN, AND THEN MEASURED AGAINST THE WHOLE STOCK ON 2026-07-30. They are
// anchored on the one number the published speed table already asserts: a Gebirgspass is 1,5 km/h
// against a Strasse's 4,0, so a typical mountain leg is ALREADY 2,67x slower. All four survived the
// measurement unchanged -- see docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md §2a.
//
// ⚠️ WHAT THE MEASUREMENT FOUND, AND WHY IT IS A DATA PROBLEM RATHER THAN A CURVE PROBLEM: the 2,67x
// anchor is honoured by construction (1 + 5,0 · 0,3333), but the DATA reach it in 5 of 4.300 way
// pieces. A typical Gebirgspass piece WITH a profile sits at exactly 1,0000, because 15 of the 16
// mountain areas still run on a placeholder maximum height. Retuning these constants against that
// would be calibrating to placeholder terrain. Revisit once real peak heights are entered.

// 1 map unit = 3.000 Schritt (V9 §4.1; spec §10.2 says 0,5 units = 1.500 Schritt, same statement).
// 💣 The unit trap is documented and expensive: reading the graph distance as miles overstates a
// gradient by 3x and the signal by 23x.
const AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE = 3000.0;

// Uphill. Anchored so that 3.000 Schritt of climb over 3 map units lands at 2,667 -- exactly the
// ratio the speed table already carries between Gebirgspass and Strasse.
const AVESMAPS_TERRAIN_UP_PENALTY = 5.0;

// Downhill, linear part: gentle descent is FASTER (owner decision 3). At a 0,1 gradient this gives
// 0,88 -- noticeable, not dramatic.
const AVESMAPS_TERRAIN_DOWN_BONUS = 1.5;

// Downhill, quadratic part: very steep descent brakes again. With the two above, the curve turns at
// a downhill gradient of DOWN_BONUS / (2 * DOWN_PENALTY) = 0,25 and is back at 1,0 by 0,5.
const AVESMAPS_TERRAIN_DOWN_PENALTY = 3.0;

// 💣 NOT THE RIVER CLAMP. avesmapsRouteClientNormalizeFlow clamps to [1,0 ... 3,0] because a current
// only ever slows you down. Inheriting that bound here would clamp every descent up to 1,0 and
// downhill would never be faster than level -- owner decision 3 silently taken back.
// ✅ THE CEILING IS DECIDED: 4,0 STAYS (owner, 2026-07-30, after the measurement of §2a). At 4,0 a
// steep pass would compute to 0,375 km/h -- under 10 km a day -- and nothing on the map comes close:
// measured over BOTH travel directions on all 2.493 land way pieces, the highest factor is 3,4782 and
// the ceiling bites 0 of them. 3,5 would also bite 0, 3,0 would bite 9.
//
// 💣 THE NUMBER TO WATCH IS NOT THE CEILING, IT IS THIS PAIR: uphill saturates where
// UP_PENALTY · gradient hits the ceiling, i.e. at gradient 0,6 -- and the steepest measured land
// gradient is 49,56 %, only 21 % short of it. Past that point two differently steep passes become
// indistinguishable, which is the real damage. Real peak heights (owner decision 5 allows 15.000
// Schritt against today's ~2.000-6.000) go well beyond it, so revisit UP_PENALTY *together with* the
// ceiling then -- never one of them alone.
//
// ⚠️ FACTOR_MIN IS DEAD AND STAYS. The curve's own minimum is 0,8125 (at downhill gradient 0,25) and
// that is also the smallest value measured anywhere, in either direction -- the theoretical floor is
// the real one. Steeper terrain does not push it lower, only makes it more common.
const AVESMAPS_TERRAIN_FACTOR_MIN = 0.5;
const AVESMAPS_TERRAIN_FACTOR_MAX = 4.0;

/**
 * PURE: does this pair carry a measurement at all?
 *
 * 💣 `null` means „no height data here", `0` means „measured and level". Never the same value.
 * Today 16 of 67 peaks carry a height; without the difference every reader takes the missing 51
 * for measured flat ground -- and a factor of 1,0 then means three different things at once.
 */
function avesmapsTerrainHasData(?float $ascentSchritt, ?float $descentSchritt): bool
{
    return $ascentSchritt !== null && $descentSchritt !== null;
}

/**
 * PURE: the slope factor for ONE traversal, in ONE direction.
 *
 * Ascent and descent are the sums along the traversal IN THAT DIRECTION, in Schritt; the distance is
 * the chord length in map units (the same measure the graph, the speed table and the leg distances
 * use -- NOT the drawn Catmull-Rom curve, which is longer).
 *
 * Returns EXACTLY 1.0 for level ground, for missing data and for a degenerate distance. That exact
 * 1.0 is what makes „switch off" bit-identical with today.
 */
function avesmapsTerrainTimeFactor(?float $ascentSchritt, ?float $descentSchritt, float $distanceMapunits): float
{
    if (!avesmapsTerrainHasData($ascentSchritt, $descentSchritt) || $distanceMapunits <= 0.0) {
        return 1.0;
    }

    $span = $distanceMapunits * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE;
    $up = max(0.0, (float) $ascentSchritt) / $span;
    $down = max(0.0, (float) $descentSchritt) / $span;
    if ($up === 0.0 && $down === 0.0) {
        return 1.0;
    }

    $factor = 1.0
        + AVESMAPS_TERRAIN_UP_PENALTY * $up
        - AVESMAPS_TERRAIN_DOWN_BONUS * $down
        + AVESMAPS_TERRAIN_DOWN_PENALTY * $down * $down;

    return max(AVESMAPS_TERRAIN_FACTOR_MIN, min(AVESMAPS_TERRAIN_FACTOR_MAX, $factor));
}

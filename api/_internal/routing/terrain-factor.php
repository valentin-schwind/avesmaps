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

// ---- Tobler's hiking function ---------------------------------------------------------------------
//
// 🔴 OWNER DECISION 2026-07-30: THE SLOPE FACTOR FOLLOWS TOBLER, not the hand-picked curve above.
// The same function for every transport for now -- caravan and coach are an open question, and the
// owner said explicitly: take the same one until it is answered.
//
// Why: the curve above was measured against Tobler over the real stock and it splits in two.
//  - UPHILL it is right, and not by luck. The best linear fit to Tobler over 2…25 % gradient is
//    k = 4,94 against its own 5,0, and on the four real climbs of Gareth → Thorwal the two agree
//    within 5 %. The anchor it was built on -- the published table's Gebirgspass 1,5 against
//    Strasse 4,0 -- lands where the hiking literature lands.
//  - DOWNHILL it is wrong in the SIGN, not the calibration. Tobler is fastest at a 5 % descent and
//    back to level speed by 10 %; a steep descent costs as much as a climb. The old curve handed out
//    a bonus all the way to 25 % and only started braking at 50 %. On the one real descent of that
//    route it said 0,856 (14 % faster) where Tobler says 1,371 (37 % slower) -- a factor of 1,6 apart,
//    on opposite sides of 1,0.
//
// 💣 AND IT MUST BE INTEGRATED PER SAMPLE, NOT APPLIED TO A LEG'S SUMS. The function is convex, so
// f(mean) != mean(f): a leg that climbs 500 and falls 500 is not a level leg. The old curve pooled the
// two (`+5·up − 1,5·down`), which let a rolling road's descents pay off part of its climbs. Tobler
// charges for both, which is why the profile run walks the samples and stores the RESULT.
const AVESMAPS_TERRAIN_TOBLER_BASE_KMH = 6.0;
const AVESMAPS_TERRAIN_TOBLER_DECAY = 3.5;
// The offset is what makes the fastest walking a gentle DESCENT rather than the level: -5 %.
const AVESMAPS_TERRAIN_TOBLER_OFFSET = 0.05;

/** PURE: Tobler's walking speed in km/h. `$slope` is dimensionless, positive uphill. */
function avesmapsTerrainToblerSpeed(float $slope): float
{
    return AVESMAPS_TERRAIN_TOBLER_BASE_KMH
        * exp(-AVESMAPS_TERRAIN_TOBLER_DECAY * abs($slope + AVESMAPS_TERRAIN_TOBLER_OFFSET));
}

/**
 * PURE: the TIME factor for one constant slope -- W(0) / W(slope), written as the one exp() it
 * collapses to (verified identical to the ratio form).
 *
 * ⚠️ NOT clamped here. The clamp belongs to the leg, after integration; clamping a single sample would
 * change what the integral means.
 */
function avesmapsTerrainToblerFactor(float $slope): float
{
    return exp(AVESMAPS_TERRAIN_TOBLER_DECAY
        * (abs($slope + AVESMAPS_TERRAIN_TOBLER_OFFSET) - AVESMAPS_TERRAIN_TOBLER_OFFSET));
}

/**
 * PURE: the time factor of ONE traversal, integrated over its height samples.
 *
 * `$heights` are the sampled heights in Schritt along the traversal, IN THE DIRECTION TRAVELLED, and
 * `null` where no raster covers the point. `$stepMapunits` is the distance between two samples.
 *
 * Returns the ratio „time under Tobler" / „time on the level over the same covered distance", so it
 * composes exactly like the old factor: an edge spanning several pieces is
 * `sum(factor_i * length_i) / sum(length_i)`.
 *
 * 💣 A GAP BREAKS THE CHAIN, it does not bridge it. Two samples with unknown ground between them would
 * otherwise be read as one long constant slope. Same rule as avesmapsTerrainProfileForLine.
 *
 * Returns null when no pair of neighbouring samples is covered at all -- „no height data", never 1.0.
 */
function avesmapsTerrainToblerFactorForSamples(array $heights, float $stepMapunits): ?float
{
    if ($stepMapunits <= 0.0) {
        return null;
    }
    $count = count($heights);
    $time = 0.0;
    $distance = 0.0;
    for ($index = 1; $index < $count; $index++) {
        $from = $heights[$index - 1];
        $to = $heights[$index];
        if ($from === null || $to === null) {
            continue;
        }
        $slope = ((float) $to - (float) $from) / ($stepMapunits * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE);
        $time += $stepMapunits * avesmapsTerrainToblerFactor($slope);
        $distance += $stepMapunits;
    }

    return $distance > 0.0 ? $time / $distance : null;
}

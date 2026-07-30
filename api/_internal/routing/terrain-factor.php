<?php

declare(strict_types=1);

// V11: how a slope becomes a time factor. Spec §4.4.
//
// PURITY CONTRACT: side-effect-free on include, no PDO, no blob, no I/O. This file is the ONE place
// the model lives.
//
// 🔴 THE MODEL IS THE LEISTUNGSKILOMETER (DIN 33466 / Marschzeitberechnung), NOT A CURVE OF OUR OWN.
// Owner decision 2026-07-30, after a DSA player pulled the previous numbers apart in public and was
// right to. The rule, and it is the whole rule:
//
//     Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg auf Hängen über 20 % Gefälle/150
//     Faktor = Leistungsmeilen / Meilen
//
// ⭐ THE UNITS TRANSFER 1:1 AND THAT IS WHY THIS MODEL WAS CHOSEN. 1 Schritt = 1 m and 1 Meile =
// 1.000 Schritt = 1 km, so the earthly constants ARE the aventurian ones. Nothing to convert, nothing
// to explain away -- and the arithmetic is the one German-speaking hikers already do.
//
// 🔴 WHY NOT THE OLD CURVE (`1 + 5·up − 1,5·down + 3·down²`), AND WHY NOT TOBLER EITHER. Both were
// measured against the live stock on 2026-07-30 and both failed the same independent test: convert the
// factor back into an implied CLIMBING RATE. On the Koschberge pass (669 Schritt over 2,8 Meilen,
// 23,9 %) the old curve implies 490 Hm/h and Tobler 466 Hm/h -- faster than every published norm for
// trained hikers (DIN 300, SAC 400). The Leistungskilometer implies 317 Hm/h. On top of that the old
// curve handed out a bonus for descents down to 25 % and only braked past 50 %, which is what drew the
// fire: a 150 % slope is a cliff, not a road. Tobler fixes the sign but keeps a bonus to 10 %.
// Measured over 4.080 land way-piece directions, this model's smallest factor is EXACTLY 1,0000 --
// nothing is ever faster than the level, which is the defensible stance for a planner.
//
// ⚠️ IT COSTS OWNER DECISION 3 („bergab schneller"), knowingly. See §2a of the measurement file.
//
// ⚠️ AND THE 20 % THRESHOLD IS DECIDED PER SAMPLE, NOT PER LEG. A leg whose AVERAGE descent is 16,6 %
// still carries a penalty when single stretches inside it exceed 20 % -- real ground is not smooth.
// That makes the model stricter than the rule of thumb suggests, and the infobox says so.

// 1 map unit = 3.000 Schritt (V9 §4.1; spec §10.2 says 0,5 units = 1.500 Schritt, same statement).
// 💣 The unit trap is documented and expensive: reading the graph distance as miles overstates a
// gradient by 3x and the signal by 23x. It cost a wrong infobox text on 2026-07-30, in public.
const AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE = 3000.0;

// 💣 MUST MATCH `DISTANCE_SCALING_FACTOR` IN js/config.js. One map unit is THREE displayed Meilen; the
// scale bar divides by it (js/ui/ui-controls.js) and `calculateScaledDistance` multiplies by it. The
// Leistungskilometer is defined per KILOMETRE, so the factor needs miles, not map units.
const AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT = 3.0;

// Schritt of climb that cost one extra Leistungsmeile. DIN 33466: 100 m of ascent per performance-km.
const AVESMAPS_TERRAIN_LKM_ASCENT_SCHRITT = 100.0;

// Schritt of descent that cost one extra Leistungsmeile -- but only on stretches steeper than the
// threshold below. Gentle descent is free: neither a penalty nor a bonus.
const AVESMAPS_TERRAIN_LKM_DESCENT_SCHRITT = 150.0;
const AVESMAPS_TERRAIN_LKM_DESCENT_THRESHOLD = 0.20;

// ⚠️ The ceiling, and under THIS model it finally earns its keep. Measured over 4.080 land way-piece
// directions it trims 20 of them (0,49 %) -- and those 20 are the artefacts of placeholder terrain
// (procedural noise puts 50 % slopes under paths that would really switch back), not real distinctions.
// Under the old curve it trimmed nothing at all and was therefore decoration. Owner: 4,0 stays.
//
// 🔴 THERE IS NO FLOOR ANY MORE, and that is structural rather than an omission: the model adds only
// non-negative terms to level ground, so the factor cannot fall below 1,0. `AVESMAPS_TERRAIN_FACTOR_MIN`
// was already dead under the old curve (its own minimum was 0,8125); here it would be meaningless.
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
 * PURE: is this sample step's descent steep enough to cost a Leistungsmeile?
 *
 * `$dropSchritt` is positive for a drop; `$stepMapunits` the horizontal step it happened over.
 */
function avesmapsTerrainDescentIsSteep(float $dropSchritt, float $stepMapunits): bool
{
    if ($stepMapunits <= 0.0 || $dropSchritt <= 0.0) {
        return false;
    }
    $gradient = $dropSchritt / ($stepMapunits * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE);

    return $gradient > AVESMAPS_TERRAIN_LKM_DESCENT_THRESHOLD;
}

/**
 * PURE: the time factor for ONE traversal, in ONE direction.
 *
 * Takes the two sums that direction actually pays for -- the climb, and the descent that fell on steep
 * ground -- plus the chord length in map units (the same measure the graph, the speed table and the leg
 * distances use, NOT the drawn Catmull-Rom curve).
 *
 * ⭐ THE MODEL IS ADDITIVE, which is what lets the profile run store per-piece sums and the router add
 * them up: the factor of an edge spanning several pieces is the factor of their summed parts.
 *
 * Returns EXACTLY 1.0 for level ground, for missing data and for a degenerate distance. That exact 1.0
 * is what makes „switch off" bit-identical with today.
 */
function avesmapsTerrainLeistungsFactor(?float $ascentSchritt, ?float $steepDescentSchritt, float $distanceMapunits): float
{
    if ($ascentSchritt === null || $steepDescentSchritt === null || $distanceMapunits <= 0.0) {
        return 1.0;
    }
    $miles = $distanceMapunits * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;
    if ($miles <= 0.0) {
        return 1.0;
    }
    $extra = max(0.0, $ascentSchritt) / AVESMAPS_TERRAIN_LKM_ASCENT_SCHRITT
        + max(0.0, $steepDescentSchritt) / AVESMAPS_TERRAIN_LKM_DESCENT_SCHRITT;
    if ($extra <= 0.0) {
        return 1.0;
    }

    return min(AVESMAPS_TERRAIN_FACTOR_MAX, 1.0 + $extra / $miles);
}

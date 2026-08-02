// The travel model, browser side -- everything in the way editor that COMPUTES.
//
// 🔴 THIS FILE IS THE MIRROR OF api/_internal/routing/terrain-factor.php, and it must stay one.
// The server owns the rule; this is the second implementation that draws it. Both are unit-tested
// against the SAME reference points (5 % -> 1,5 · 10 % -> 2,0 · 20 % -> 3,0 · 30 % -> 4,0), so a
// change on one side that the other does not follow turns a test red instead of quietly drawing a
// curve that nothing computes.
//
// The rule, and it is the whole rule:
//     Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg auf Hängen über 20 % Gefälle/150
//     Faktor          = Leistungsmeilen / Meilen
//
// ⭐ 1 Schritt = 1 m and 1 Meile = 1.000 Schritt = 1 km, so the earthly constants ARE the
// aventurian ones -- that is why this model was chosen. Nothing to convert.
//
// No DOM, no fetch, no globals beyond the export shim at the bottom: this file is loadable by node
// (js/pages/__tests__/wege-editor-model.test.js) and by the editor page alike.

"use strict";

// Schritt of climb that cost one extra Leistungsmeile (AVESMAPS_TERRAIN_LKM_ASCENT_SCHRITT).
var WP_LKM_ASCENT_SCHRITT = 100.0;
// Schritt of descent that cost one extra Leistungsmeile -- only on stretches steeper than the
// threshold below. Gentle descent is free: neither a penalty nor a bonus.
var WP_LKM_DESCENT_SCHRITT = 150.0;
var WP_LKM_DESCENT_THRESHOLD = 0.20;
// 💣 The ceiling. There is NO floor and that is structural, not an omission: the model adds only
// non-negative terms to level ground, so the factor cannot fall below 1,0.
var WP_FACTOR_MAX = 4.0;
// 1 map unit = 3 displayed Meilen (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT / DISTANCE_SCALING_FACTOR).
var WP_MEILEN_PER_MAPUNIT = 3.0;

// The land speed table, verbatim from AVESMAPS_ROUTE_CLIENT_SPEED_TABLE
// (api/_internal/routing/client-graph.php). Water transports are deliberately absent: the slope
// factor is a LAND rule (avesmapsRouteTerrainAppliesTo) and a boat does not climb.
var WP_SPEEDS = {
	lightRider:    { label: "Reiter",               Reichsstrasse: 8.5, Strasse: 8.0, Weg: 7.0, Pfad: 6.0, Gebirgspass: 3.0, Wuestenpfad: 4.0, Querfeldein: 2.5 },
	groupHorse:    { label: "Reisegruppe beritten", Reichsstrasse: 7.0, Strasse: 6.5, Weg: 5.5, Pfad: 4.5, Gebirgspass: 2.5, Wuestenpfad: 3.0, Querfeldein: 2.1 },
	// Weg and Gebirgspass carry the source's carriage rule („auf Karrenwegen und Pässen nur halbe
	// Geschwindigkeit", S. 123) and are therefore HALF of what the path-type factor alone would give.
	horseCarriage: { label: "Kutsche",              Reichsstrasse: 6.0, Strasse: 5.5, Weg: 2.25, Pfad: 3.0, Gebirgspass: 1.0, Wuestenpfad: 3.0, Querfeldein: 1.7 },
	lightWalker:   { label: "Zu Fuß",               Reichsstrasse: 5.5, Strasse: 5.0, Weg: 4.5, Pfad: 4.0, Gebirgspass: 2.0, Wuestenpfad: 3.5, Querfeldein: 1.7 },
	groupFoot:     { label: "Reisegruppe zu Fuß",   Reichsstrasse: 4.5, Strasse: 4.0, Weg: 3.5, Pfad: 3.0, Gebirgspass: 1.5, Wuestenpfad: 2.5, Querfeldein: 1.25 },
	caravan:       { label: "Karawane",             Reichsstrasse: 4.0, Strasse: 3.5, Weg: 3.0, Pfad: 2.5, Gebirgspass: 1.5, Wuestenpfad: 2.0, Querfeldein: 1.25 }
};

// The LAND way types, in the order the pictures are drawn.
var WP_LAND_TYPES = [
	{ key: "Reichsstrasse", label: "Reichsstraße" },
	{ key: "Strasse",       label: "Straße" },
	{ key: "Weg",           label: "Weg" },
	{ key: "Pfad",          label: "Pfad" },
	{ key: "Gebirgspass",   label: "Gebirgspass" },
	{ key: "Wuestenpfad",   label: "Wüstenpfad" },
	{ key: "Querfeldein",   label: "Querfeldein" }
];

// 🔴 FOUR SERIES, and the ceiling is a measured one -- see the note on --color-chart-* in
// css/base/tokens.css. A fifth series is refused, never given an invented fifth hue.
var WP_MAX_SERIES = 4;

/**
 * PURE: the time factor for a gradient given in PERCENT (positive = uphill, negative = downhill).
 *
 * Over one Meile (1.000 Schritt horizontal) a gradient s means 1.000·|s| Schritt of height, which
 * is what turns the two constants above into the short forms:
 *     uphill    F = 1 + 10 · s          (capped at 4,0, so the cap bites from 30 %)
 *     downhill  F = 1                   up to 20 %
 *               F = 1 + 6⅔ · |s|        beyond it (capped at 4,0, reached exactly at 45 %)
 *
 * 💣 THE STEP AT 20 % DESCENT IS REAL, not a rounding artefact. The threshold is decided per
 * sample step in the profile run (avesmapsTerrainDescentIsSteep), and above it the WHOLE descent
 * of that step counts -- so the factor jumps from 1,0 to 2⅓, it does not ramp. Two players
 * stumbled over exactly this in public; a curve that smooths it over would be lying.
 */
function wpFactorForGradientPercent(gradientPercent) {
	var s = Number(gradientPercent) / 100;
	if (!isFinite(s)) { return 1.0; }
	if (s >= 0) {
		return Math.min(WP_FACTOR_MAX, 1 + (1000 * s) / WP_LKM_ASCENT_SCHRITT);
	}
	var drop = -s;
	if (drop <= WP_LKM_DESCENT_THRESHOLD) { return 1.0; }
	return Math.min(WP_FACTOR_MAX, 1 + (1000 * drop) / WP_LKM_DESCENT_SCHRITT);
}

/**
 * PURE: the time factor of ONE traversal in ONE direction, from the stored sums.
 *
 * Mirrors avesmapsTerrainLeistungsFactor. `distanceMapunits` is the chord length in map units --
 * the same measure the graph and the speed table use, NOT the drawn Catmull-Rom curve.
 *
 * ⚠️ `capped: false` is what the CALIBRATION needs, and the difference is not cosmetic: without
 * the cap the model is additive, so a length-weighted mean over pieces is bit-identical with the
 * value of the whole way. min() breaks that. The profile run does not even know where the edges
 * are, so it must accumulate uncapped.
 */
function wpLeistungsFactor(ascentSchritt, steepDescentSchritt, distanceMapunits, options) {
	var capped = !options || options.capped !== false;
	if (ascentSchritt === null || ascentSchritt === undefined) { return 1.0; }
	if (steepDescentSchritt === null || steepDescentSchritt === undefined) { return 1.0; }
	if (!(distanceMapunits > 0)) { return 1.0; }
	var miles = distanceMapunits * WP_MEILEN_PER_MAPUNIT;
	if (!(miles > 0)) { return 1.0; }
	var extra = Math.max(0, ascentSchritt) / WP_LKM_ASCENT_SCHRITT
		+ Math.max(0, steepDescentSchritt) / WP_LKM_DESCENT_SCHRITT;
	if (!(extra > 0)) { return 1.0; }
	var factor = 1 + extra / miles;
	return capped ? Math.min(WP_FACTOR_MAX, factor) : factor;
}

/**
 * PURE: both directions of one way, from the ONE stored row.
 *
 * 💣 BOTH DIRECTIONS COME FROM THE SAME FOUR SUMS. Forwards pays `ascent` + `steep_descent`;
 * backwards the way's descent IS its climb, so it pays `descent` + `steep_ascent`. Getting this
 * pairing wrong prices a mountain pass as if it were flat in one direction -- and nothing looks
 * broken, the number is just wrong.
 *
 * `profile` is the stored profile_json: one [ascent, descent, steepAscent, steepDescent] per piece,
 * in STORED direction, in Schritt.
 */
function wpProfileSums(profile) {
	var sums = { ascent: 0, descent: 0, steepAscent: 0, steepDescent: 0 };
	if (!Array.isArray(profile)) { return null; }
	for (var i = 0; i < profile.length; i++) {
		var piece = profile[i];
		// 💣 THE LENGTH OF THIS ARRAY IS THE FORMAT GUARD. Rows written before 2026-07-30 hold
		// pairs of two; anything shorter than four is a pre-model row and must read as „no data",
		// never as a Leistungsmeilen sum.
		if (!Array.isArray(piece) || piece.length < 4) { return null; }
		sums.ascent += Number(piece[0]) || 0;
		sums.descent += Number(piece[1]) || 0;
		sums.steepAscent += Number(piece[2]) || 0;
		sums.steepDescent += Number(piece[3]) || 0;
	}
	return sums;
}

function wpBothDirectionFactors(profile, distanceMapunits, options) {
	var sums = wpProfileSums(profile);
	if (sums === null) { return null; }
	return {
		forward: wpLeistungsFactor(sums.ascent, sums.steepDescent, distanceMapunits, options),
		backward: wpLeistungsFactor(sums.descent, sums.steepAscent, distanceMapunits, options),
		sums: sums
	};
}

/**
 * PURE: the height curve of a way, by accumulating the per-piece differences.
 *
 * 💣 profile_json HOLDS NO ABSOLUTE HEIGHTS, only differences per piece. The curve therefore starts
 * wherever we choose -- here at 0 -- and the axis must be labelled RELATIVE. Anyone reading these
 * as „the pass is 900 Schritt high" is reading something that was never stored.
 *
 * 💣 AND IT IS A SIMPLIFICATION. `ascent` and `descent` are TOTAL VARIATIONS of the piece, so
 * `ascent - descent` is its net change -- correct for the curve, but blind to what goes up and down
 * INSIDE one piece. The sums know it, the line does not.
 *
 * `pieceLengths` (map units, one per piece) positions the points along x; without it the pieces are
 * spaced evenly, which is honest only when they are.
 */
function wpProfileCurve(profile, pieceLengths) {
	if (!Array.isArray(profile) || profile.length === 0) { return []; }
	var haveLengths = Array.isArray(pieceLengths) && pieceLengths.length === profile.length;
	var points = [{ x: 0, y: 0 }];
	var x = 0;
	var y = 0;
	for (var i = 0; i < profile.length; i++) {
		var piece = profile[i];
		if (!Array.isArray(piece) || piece.length < 4) { return []; }
		y += (Number(piece[0]) || 0) - (Number(piece[1]) || 0);
		x += haveLengths ? (Number(pieceLengths[i]) || 0) : 1;
		points.push({ x: x, y: y });
	}
	return points;
}

/**
 * PURE: group way SEGMENTS into WAYS.
 *
 * 💣 ONE WAY NAME STANDS FOR MANY SEGMENTS. „Reichsstraße 1" has 26 of them (measured,
 * docs/konfliktmanagement-design.md §6a: 215 groups holding 1547 objects between them). Listed
 * ungrouped they were 26 rows with the same name, the same type and the same second line -- there
 * was no way to tell which one you were editing. That is what this function exists to prevent.
 *
 * Grouped by the WIKI WAY where there is one, otherwise by name+subtype: two segments of the same
 * wiki way are certainly the same road, two same-named ways without a wiki link are not necessarily.
 *
 * ⭐ Segments are ordered GEOGRAPHICALLY (min_x, then min_y), not by whatever order the database
 * returned -- so „Abschnitt 3" lies between 2 and 4 and the number means something.
 */
function wpGroupWays(ways) {
	var groups = [];
	var byKey = {};
	(ways || []).forEach(function (way) {
		if (!way) { return; }
		var key = way.wiki_path && way.wiki_path.wiki_key
			? "wiki:" + way.wiki_path.wiki_key
			: "name:" + way.feature_subtype + ":" + way.name;
		if (!byKey[key]) {
			byKey[key] = {
				key: key,
				name: way.name,
				feature_subtype: way.feature_subtype,
				wiki_path: way.wiki_path || null,
				segments: []
			};
			groups.push(byKey[key]);
		}
		byKey[key].segments.push(way);
	});
	groups.forEach(function (group) {
		group.segments.sort(function (a, b) {
			var ax = a.bbox ? a.bbox[0] : 0;
			var bx = b.bbox ? b.bbox[0] : 0;
			if (ax !== bx) { return ax - bx; }
			var ay = a.bbox ? a.bbox[1] : 0;
			var by = b.bbox ? b.bbox[1] : 0;
			return ay - by;
		});
	});
	return groups;
}

/**
 * PURE: the rough extent of a segment in miles, from its bounding box.
 *
 * 💣 THIS IS NOT A LENGTH, it is a LOWER BOUND -- the diagonal of the box the way lies in. A
 * winding way is longer than its diagonal, never shorter. It exists to tell two sections APART in
 * the list and is therefore always shown with a „≈". The real length comes from the geometry
 * (wpPieceLengths), and column 3 uses that one.
 */
function wpRoughMiles(way) {
	if (!way || !way.bbox || way.bbox.length < 4) { return null; }
	var dx = Number(way.bbox[2]) - Number(way.bbox[0]);
	var dy = Number(way.bbox[3]) - Number(way.bbox[1]);
	if (!isFinite(dx) || !isFinite(dy)) { return null; }
	return Math.sqrt(dx * dx + dy * dy) * WP_MEILEN_PER_MAPUNIT;
}

/** PURE: chord lengths of a LineString's pieces, in map units. */
function wpPieceLengths(coordinates) {
	var lengths = [];
	if (!Array.isArray(coordinates)) { return lengths; }
	for (var i = 1; i < coordinates.length; i++) {
		var a = coordinates[i - 1];
		var b = coordinates[i];
		if (!Array.isArray(a) || !Array.isArray(b)) { return []; }
		lengths.push(Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1])));
	}
	return lengths;
}

// Node for the tests, plain globals for the editor page (no build step, AGENTS.md §3).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		WP_LKM_ASCENT_SCHRITT: WP_LKM_ASCENT_SCHRITT,
		WP_LKM_DESCENT_SCHRITT: WP_LKM_DESCENT_SCHRITT,
		WP_LKM_DESCENT_THRESHOLD: WP_LKM_DESCENT_THRESHOLD,
		WP_FACTOR_MAX: WP_FACTOR_MAX,
		WP_MEILEN_PER_MAPUNIT: WP_MEILEN_PER_MAPUNIT,
		WP_SPEEDS: WP_SPEEDS,
		WP_LAND_TYPES: WP_LAND_TYPES,
		WP_MAX_SERIES: WP_MAX_SERIES,
		wpFactorForGradientPercent: wpFactorForGradientPercent,
		wpLeistungsFactor: wpLeistungsFactor,
		wpProfileSums: wpProfileSums,
		wpBothDirectionFactors: wpBothDirectionFactors,
		wpProfileCurve: wpProfileCurve,
		wpPieceLengths: wpPieceLengths,
		wpGroupWays: wpGroupWays,
		wpRoughMiles: wpRoughMiles
	};
}

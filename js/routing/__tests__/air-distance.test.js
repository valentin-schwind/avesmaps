const assert = require("assert");
const fs = require("fs");
const path = require("path");

// The "Drachenflug" (air distance) of a planned journey.
//
// It used to be the single straight line from the FIRST to the LAST waypoint, which made it wrong for
// every route with a stop in between: for Wehrheim -> Lowangen -> Greifenfurt the planner printed
// 157.2 miles (Wehrheim -> Greifenfurt) while the leg Lowangen -> Wehrheim alone measures 313 miles.
// A total smaller than one of its own parts. The air distance is now the SUM over the stations, and the
// legs travel with it so the summary can show where the sum comes from.
//
// The numbers below are the live coordinates of those three towns (GET /api/locations/, 2026-07-30),
// in the app's own [lat, lng] order -- so this test measures the real distance between real places, not
// a hand-picked triangle. DISTANCE_SCALING_FACTOR is cut out of the REAL js/config.js for the same
// reason: a hardcoded 3 here would keep passing if someone rescaled the map.
//
// Run from the repo root:  node js/routing/__tests__/air-distance.test.js

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "..", ...parts), "utf8");

function extractFunction(source, name, file) {
	const start = source.indexOf(`function ${name}(`);
	assert.notStrictEqual(start, -1, `function ${name} not found in ${file}`);
	// Count from the brace that ENDS the signature line, not from the first brace in the source: a default
	// parameter (`options = {}`) opens and closes one inside the signature, which cut the body off after
	// the first line and made this file fail with a SyntaxError instead of an assertion.
	const signature = source.slice(start, source.indexOf("\n", start));
	let depth = 0;
	for (let i = start + signature.lastIndexOf("{"); i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}" && (depth -= 1) === 0) return source.slice(start, i + 1);
	}
	throw new Error(`unbalanced braces in ${name} (${file})`);
}

function extractConst(source, name, file) {
	const match = new RegExp(`^const ${name} = .*;$`, "m").exec(source);
	assert.notStrictEqual(match, null, `const ${name} not found in ${file}`);
	return match[0];
}

const utilsSource = read("js", "app", "utils.js");
const configSource = read("js", "config.js");
const resultSource = read("js", "routing", "route-result.js");
const planSource = read("js", "routing", "route-plan.js");
const i18nSource = read("js", "app", "i18n.js");

const load = (activeLang) => new Function(
	"windowStub",
	[
		"const window = windowStub;",
		extractConst(configSource, "DISTANCE_SCALING_FACTOR", "config.js"),
		extractFunction(utilsSource, "calculateCoordinateDistance", "utils.js"),
		extractFunction(utilsSource, "calculateScaledDistance", "utils.js"),
		extractFunction(utilsSource, "formatDecimalNumber", "utils.js"),
		extractFunction(resultSource, "resolveRouteStepTransport", "route-result.js"),
		extractFunction(resultSource, "countTransportTransfers", "route-result.js"),
		extractFunction(resultSource, "buildRouteSummary", "route-result.js"),
		extractFunction(planSource, "routeAirLegsNote", "route-plan.js"),
		extractFunction(planSource, "routeAirNoteMarkup", "route-plan.js"),
		// The REAL placeholder substitution, cut out of the i18n engine. A `(key, german) => german` stub
		// returns the template verbatim and would have let „{n} Stationen" ship with the braces in it.
		extractFunction(i18nSource, "formatTemplate", "i18n.js"),
		'const tr = (key, germanDefault, params) => formatTemplate(germanDefault, params);',
		'const escapeHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
		"return { buildRouteSummary, routeAirLegsNote, routeAirNoteMarkup, formatDecimalNumber, DISTANCE_SCALING_FACTOR };",
	].join("\n")
)({ avesmapsActiveLang: activeLang });

const de = load("de");
const en = load("en");

const WEHRHEIM = { name: "Wehrheim", coordinates: [572.74307, 558.5] };
const LOWANGEN = { name: "Lowangen", coordinates: [663.625, 507.21875] };
const GREIFENFURT = { name: "Greifenfurt", coordinates: [584.85355, 507.52209] };

const near = (actual, expected, what) => assert.ok(
	Math.abs(actual - expected) < 0.05,
	`${what}: expected ~${expected}, got ${actual}`
);

// A journey with a stop counts both air legs, not the shortcut between its ends.
{
	const summary = de.buildRouteSummary([WEHRHEIM, LOWANGEN, GREIFENFURT], []);
	near(summary.air_distance_miles, 549.4, "air distance over three stations");
	assert.strictEqual(summary.air_distance_legs.length, 2, "two legs for three stations");
	near(summary.air_distance_legs[0], 313.1, "leg Wehrheim -> Lowangen");
	near(summary.air_distance_legs[1], 236.3, "leg Lowangen -> Greifenfurt");
}

// The old, wrong value must not survive anywhere in the summary.
{
	const summary = de.buildRouteSummary([WEHRHEIM, LOWANGEN, GREIFENFURT], []);
	assert.ok(
		summary.air_distance_miles > 500,
		`start-to-destination shortcut is back: ${summary.air_distance_miles}`
	);
}

// Two waypoints: unchanged behaviour, and no derivation note -- it would just repeat the total.
{
	const summary = de.buildRouteSummary([WEHRHEIM, GREIFENFURT], []);
	near(summary.air_distance_miles, 157.2, "air distance Wehrheim -> Greifenfurt");
	assert.strictEqual(summary.air_distance_legs.length, 1, "one leg for two stations");
	assert.strictEqual(de.routeAirLegsNote(summary.air_distance_legs), "", "one leg needs no note");
}

// Three stations: the note names the legs, joined by "+" because the total IS their sum. The panel is
// 350px wide, so value and derivation live in two separate columns instead of one long line.
{
	const summary = de.buildRouteSummary([WEHRHEIM, LOWANGEN, GREIFENFURT], []);
	assert.strictEqual(de.routeAirLegsNote(summary.air_distance_legs), "313,1 + 236,3");
}

// ---- the derivation column of the Drachenflug row ------------------------------------------------
// Owner 2026-07-30: „Drachenflug 236,3 Meilen (2 Etappen) — einfach die anzahl wegpunktziele". The note
// now counts the STATIONS the sum spans, so the row says something even on a two-waypoint route (where
// the summands would only repeat the total). The summands move into the row's tooltip, so the number
// stays checkable without costing a line in a 350px panel.
{
	assert.strictEqual(de.routeAirNoteMarkup([157.19]), "2 Stationen", "one leg spans two stations");
	const twoLegs = de.routeAirNoteMarkup([313.06, 236.32]);
	assert.ok(twoLegs.includes("3 Stationen"), `three stations: ${twoLegs}`);
	assert.ok(twoLegs.includes('title="313,1 + 236,3 Meilen"'), `summands in the tooltip: ${twoLegs}`);
	assert.strictEqual(de.routeAirNoteMarkup([]), "", "no legs -> nothing to note");
	assert.strictEqual(de.routeAirNoteMarkup(null), "", "no legs at all -> nothing to note");
}

// German UI writes 549,4 -- the English overlay keeps 549.4. toFixed() could only ever do the latter.
{
	assert.strictEqual(de.formatDecimalNumber(549.37, 1), "549,4");
	assert.strictEqual(en.formatDecimalNumber(549.37, 1), "549.4");
	assert.strictEqual(de.formatDecimalNumber(61.9853, 2), "61,99");
	assert.strictEqual(en.routeAirLegsNote([313.06, 236.32]), "313.1 + 236.3");
}

// No route, one waypoint, missing coordinates: zero legs, zero miles, no crash.
{
	for (const locations of [[], [WEHRHEIM], [WEHRHEIM, { name: "Nirgendwo" }]]) {
		const summary = de.buildRouteSummary(locations, []);
		assert.strictEqual(summary.air_distance_miles, 0, `air distance for ${locations.length} waypoint(s)`);
		assert.deepStrictEqual(summary.air_distance_legs, [], "no legs without two usable coordinates");
	}
}

console.log("air-distance.test.js: all assertions passed");

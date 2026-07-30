// V11 „Höhenunterschiede", but for the WHOLE route: the line under the landscapes in the plan summary.
//
// 💣 The honest part is the coverage note, not the sum. Only a fraction of the way network carries
// height data (37 of 45 legs on a real route the day this shipped), and a bare „12.345 Schritt rauf"
// under a route summary reads as the total climb of the journey. It is a LOWER BOUND over the legs
// that were measured, so the line says how many legs it speaks for whenever it does not speak for all.
//
// 💣 And measured-but-level stays silent. „0 Schritt rauf · 0 Schritt runter" is noise to a traveller --
// the null/0 distinction matters one layer down (see route-entry-terrain.test.js), not here.
//
// Run from the repo root:  node js/routing/__tests__/route-terrain-summary.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Same harness as route-entry-terrain.test.js: route-engine.js wires up the server-primary route on
// load, and none of that may run here.
global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.getTransportOption = () => "groupFoot";
global.findPathByPublicId = () => null;

// The REAL number formatter, cut out of utils.js -- a stub would hide whether the line writes German
// thousands ("1.669") or a bare "1669", which is the whole point of the format work around it.
const utilsSource = fs.readFileSync(path.join(__dirname, "..", "..", "app", "utils.js"), "utf8");
const formatterStart = utilsSource.indexOf("function formatDecimalNumber(");
assert.notStrictEqual(formatterStart, -1, "formatDecimalNumber not found in utils.js");
const formatterEnd = utilsSource.indexOf("\n}", formatterStart);
vm.runInThisContext(`${utilsSource.slice(formatterStart, formatterEnd + 2)}\nglobal.formatDecimalNumber = formatDecimalNumber;`);

const load = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
// The REAL i18n engine, not a `(key, german) => german` stub: that stub returns the template verbatim and
// would have let „auf {covered} von {total} Etappen erfasst" ship with the braces still in it. It ran here
// exactly once and this assertion caught it. German is the default with an empty location.search.
load("../../app/i18n.js");
global.tr = global.window.tr;
assert.strictEqual(typeof global.tr, "function", "i18n.js must install window.tr");

load("../route-engine.js");
load("../route-plan.js");

// Three legs: two measured, one without height data at all.
const segments = [
	{ properties: { public_id: "a", ascent_schritt: 669, descent_schritt: 120 } },
	{ properties: { public_id: "b", ascent_schritt: 1000, descent_schritt: 780 } },
	{ properties: { public_id: "c" } },
];
const entries = [
	{ segmentIndexes: [0] },
	{ segmentIndexes: [1] },
	{ segmentIndexes: [2] },
];

// ---- the sum ------------------------------------------------------------------------------------
{
	const totals = routeTerrainTotals(entries, segments);
	assert.strictEqual(totals.ascent, 1669, "climb is summed over the measured legs");
	assert.strictEqual(totals.descent, 900, "and so is the fall");
	assert.strictEqual(totals.coveredEntries, 2, "two of the three legs carry data");
	assert.strictEqual(totals.totalEntries, 3, "and the line knows how many there were");
}

// A leg is not an edge: several segments in one entry are summed into that entry.
{
	const totals = routeTerrainTotals([{ segmentIndexes: [0, 1] }], segments);
	assert.strictEqual(totals.ascent, 1669, "both segments of the one leg count");
	assert.strictEqual(totals.coveredEntries, 1, "it is still a single leg");
}

// ---- nothing to say -----------------------------------------------------------------------------
{
	assert.strictEqual(routeTerrainTotals([{ segmentIndexes: [2] }], segments), null, "no data -> no totals");
	assert.strictEqual(routeTerrainTotals([], segments), null, "no legs -> no totals");
	assert.strictEqual(routeTerrainSummaryMarkup([{ segmentIndexes: [2] }], segments), "", "no data -> no line");
	const level = [{ properties: { public_id: "d", ascent_schritt: 0, descent_schritt: 0 } }];
	assert.strictEqual(
		routeTerrainSummaryMarkup([{ segmentIndexes: [0] }], level),
		"",
		"measured but level stays silent"
	);
}

// ---- the line -----------------------------------------------------------------------------------
{
	const markup = routeTerrainSummaryMarkup(entries, segments);
	assert.ok(markup.includes("Höhenunterschiede"), "the line carries the same label as the leg infobox");
	assert.ok(markup.includes("1.669 Schritt rauf"), `German thousands separator: ${markup}`);
	assert.ok(markup.includes("900 Schritt runter"), `fall is named too: ${markup}`);
	assert.ok(markup.includes("2 von 3"), `partial coverage is stated: ${markup}`);
	assert.ok(
		markup.includes('class="route-plan-summary__elevation"'),
		"it is its own element, like the landscapes line"
	);
}

// Fully covered: no coverage note, because there is nothing to qualify.
{
	const covered = routeTerrainSummaryMarkup([{ segmentIndexes: [0] }, { segmentIndexes: [1] }], segments);
	assert.ok(covered.includes("1.669 Schritt rauf"), "same sum");
	assert.ok(!/von/.test(covered), `no coverage note when every leg is measured: ${covered}`);
}

console.log("route-terrain-summary.test.js: all assertions passed");

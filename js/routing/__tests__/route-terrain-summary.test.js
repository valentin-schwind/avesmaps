// V11 „Höhenunterschiede", but for the WHOLE route: the line under the landscapes in the plan summary.
//
// 💣 The honest part is the coverage note, not the sum. Only a fraction of the way network carries
// height data (37 of 45 legs on a real route the day this shipped), and a bare „12.345 Schritt bergauf"
// under a route summary reads as the total climb of the journey. It is a LOWER BOUND over the legs
// that were measured, so the line says how many legs it speaks for whenever it does not speak for all.
//
// 💣 And measured-but-level stays silent. „0 Schritt bergauf · 0 Schritt bergab" is noise to a traveller --
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

// The REAL escaper too, for the same reason: a stubbed one hides exactly the escaping bugs it is there
// to catch (the arrows' aria-label/title run through it).
const escaperStart = utilsSource.indexOf("function escapeHtml(");
assert.notStrictEqual(escaperStart, -1, "escapeHtml not found in utils.js");
vm.runInThisContext(
	`${utilsSource.slice(escaperStart, utilsSource.indexOf("\n}", escaperStart) + 2)}\nglobal.escapeHtml = escapeHtml;`
);

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

// Three legs: two measured, one without height data at all. The distances matter for the steepness
// verdict below: 1 mile carries 1.000 Schritt of height (3.000 per map unit, 3 miles per unit -- see
// AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE in api/_internal/routing/terrain-factor.php).
const segments = [
	{ properties: { public_id: "a", ascent_schritt: 669, descent_schritt: 120 } },
	{ properties: { public_id: "b", ascent_schritt: 1000, descent_schritt: 780 } },
	{ properties: { public_id: "c" } },
];
const entries = [
	{ segmentIndexes: [0], distance: 8 },
	{ segmentIndexes: [1], distance: 12 },
	{ segmentIndexes: [2], distance: 40 },
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
// 💣 It has to fit ONE line in a 350px panel. Measured there: it does, as long as the unit is named once
// and the direction is an arrow -- even „(8/45)" appended pushes it onto a second line. So the numbers
// carry arrows, and every caveat goes into a quiet note line underneath.
{
	const markup = routeTerrainSummaryMarkup(entries, segments);
	assert.ok(markup.includes("Höhenunterschiede"), "the line carries the same label as the leg infobox");
	assert.ok(markup.includes("1.669"), `German thousands separator: ${markup}`);
	assert.ok(markup.includes("900"), `fall is named too: ${markup}`);
	assert.ok(markup.includes("Schritt"), `the unit appears -- once: ${markup}`);
	assert.strictEqual(markup.split("Schritt").length - 1, 1, `the unit must appear ONCE: ${markup}`);
	assert.ok(
		markup.includes('class="route-plan-summary__elevation"'),
		"it is its own element, like the landscapes line"
	);
}

// 🔴 An arrow alone is not a word: a screen reader would read „2.946 up arrow". Each direction carries
// its label, so „bergauf" and „bergab" survive for anyone who cannot see the glyph.
{
	const markup = routeTerrainSummaryMarkup(entries, segments);
	assert.ok(markup.includes("↑"), `climb arrow: ${markup}`);
	assert.ok(markup.includes("↓"), `fall arrow: ${markup}`);
	assert.ok(markup.includes('aria-label="bergauf"'), `the arrow says what it means: ${markup}`);
	assert.ok(markup.includes('aria-label="bergab"'), `the arrow says what it means: ${markup}`);
}

// ---- the caveats live in their own quiet line ----------------------------------------------------
// 1.669 Schritt over the 20 measured miles is a gradient of 0,083 -- past the 0,05 that the server's
// uphill curve turns into a time factor of 1,25. So this route is steep, and says so.
{
	const markup = routeTerrainSummaryMarkup(entries, segments);
	assert.ok(markup.includes('class="route-plan-summary__elevation-note"'), `note line exists: ${markup}`);
	const note = markup.slice(markup.indexOf("elevation-note"));
	assert.ok(note.includes("stark"), `steep route says so, quietly: ${note}`);
	assert.ok(note.includes("auf 2 von 3 Etappen"), `coverage sits in the note: ${note}`);
	// And the numbers line itself stays free of them, or it would wrap.
	const numbersLine = markup.slice(0, markup.indexOf("<span class=\"route-plan-summary__elevation-note\""));
	assert.ok(!numbersLine.includes("stark"), `the numbers line stays clean: ${numbersLine}`);
	assert.ok(!numbersLine.includes("von 3"), `the numbers line stays clean: ${numbersLine}`);
}

// Nothing to qualify -> no note line at all.
{
	const covered = routeTerrainSummaryMarkup([{ segmentIndexes: [0], distance: 80 }], segments);
	assert.ok(!covered.includes("elevation-note"), `no caveats, no note line: ${covered}`);
}

// 💣 The same climb spread over ten times the distance is not steep, and must NOT claim to be -- the
// speed dialog states exactly this („240 Schritt auf einer Meile wiegen schwer, dieselben 240 auf zehn
// Meilen kaum"). Without a gradient test, every long route with any height data would read as alpine.
{
	const gentle = routeTerrainSummaryMarkup(
		[{ segmentIndexes: [0], distance: 80 }, { segmentIndexes: [1], distance: 120 }],
		segments
	);
	assert.ok(gentle.includes("Höhenunterschiede"), "the line is still there");
	assert.ok(!gentle.includes("Starke"), `a gentle route never calls itself steep: ${gentle}`);
}

// No distances (a caller that has none) cannot judge steepness -- and then does not claim it.
{
	const unknown = routeTerrainSummaryMarkup([{ segmentIndexes: [0] }], segments);
	assert.ok(!unknown.includes("Starke"), `no distance -> no verdict: ${unknown}`);
}

// Fully covered: no coverage note, because there is nothing to qualify.
{
	const covered = routeTerrainSummaryMarkup([{ segmentIndexes: [0] }, { segmentIndexes: [1] }], segments);
	assert.ok(covered.includes("1.669"), "same sum");
	assert.ok(!/von \d/.test(covered), `no coverage note when every leg is measured: ${covered}`);
}

// ---- the leg row's own note ----------------------------------------------------------------------
// „… durch Weiden, Finsterkamm (12.680 Schritt bergauf, 12.176 Schritt bergab)" (Owner 2026-07-30): the
// same two numbers the leg infobox carries, at the end of the row that already says how long the leg is.
{
	const note = routeEntryTerrainNote({ segmentIndexes: [0] }, segments);
	assert.strictEqual(note, " (669 Schritt bergauf, 120 Schritt bergab)", `leg note: ${note}`);
}

// Silent in exactly the cases the other two are: no data, and measured-but-level.
{
	assert.strictEqual(routeEntryTerrainNote({ segmentIndexes: [2] }, segments), "", "no data -> no note");
	assert.strictEqual(routeEntryTerrainNote(null, segments), "", "no entry -> no note");
	const level = [{ properties: { public_id: "d", ascent_schritt: 0, descent_schritt: 0 } }];
	assert.strictEqual(routeEntryTerrainNote({ segmentIndexes: [0] }, level), "", "level -> no note");
}

// One wording for one thing: „bergauf/bergab", never „rauf/runter". The leg row has room to write it
// out; the summary line is at its width limit and carries the same words on its arrows instead.
{
	const legNote = routeEntryTerrainNote({ segmentIndexes: [0] }, segments);
	assert.ok(legNote.includes("Schritt bergauf"), `leg row writes it out: ${legNote}`);
	assert.ok(legNote.includes("Schritt bergab"), `leg row writes it out: ${legNote}`);

	const markup = routeTerrainSummaryMarkup(entries, segments);
	assert.ok(markup.includes('"bergauf"'), `summary carries the word on its arrow: ${markup}`);
	assert.ok(markup.includes('"bergab"'), `summary carries the word on its arrow: ${markup}`);
	assert.ok(!markup.includes("rauf ") && !markup.includes("runter"), `never rauf/runter: ${markup}`);
}

console.log("route-terrain-summary.test.js: all assertions passed");

// Unit test for the PURE half of the climate-divider editor: where a dragged handle may go, and where
// a new point is inserted. Everything Leaflet-bound (panes, markers, drag events) is not testable here
// -- js/map-features/ is loaded as bare <script>, so this installs the file's globals by hand into a
// vm context, the house pattern of the other tests in this folder.
//
// 🔴 What this pins down: the handle STOPS at its neighbour instead of crossing it. That is where
// "Klimazonen überlappen sich nicht" becomes something the editor can feel, rather than an error
// message they get after the fact.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-climate.js"), "utf8");
const context = {
	console,
	window: {},
	document: { getElementById: () => null, querySelectorAll: () => [] },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

let failures = 0;
function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		failures += 1;
	}
}

// ---- y at x ----------------------------------------------------------------------------------------

const straight = [[0, 800], [1024, 800]];
assert(context.climateYAtX(straight, 512) === 800, "y is constant on a straight divider");

const ramp = [[0, 100], [1024, 200]];
assert(Math.abs(context.climateYAtX(ramp, 512) - 150) < 1e-9, "y interpolates linearly");
assert(context.climateYAtX(ramp, -50) === 100, "left of the line: the first y");
assert(context.climateYAtX(ramp, 2000) === 200, "right of the line: the last y");
assert(context.climateYAtX([], 10) === 0, "an empty line answers 0 instead of throwing");

// ---- clamping a dragged handle vertically ----------------------------------------------------------

const north = [[0, 900], [1024, 900]];
const south = [[0, 500], [1024, 500]];

assert(context.climateClampVertexY(700, 512, north, south) === 700, "inside the corridor: unchanged");
assert(context.climateClampVertexY(950, 512, north, south) === 899, "clamped one unit below the northern neighbour");
assert(context.climateClampVertexY(400, 512, north, south) === 501, "clamped one unit above the southern neighbour");
assert(context.climateClampVertexY(2000, 512, null, south) === 1024, "no northern neighbour: the map edge");
assert(context.climateClampVertexY(-40, 512, north, null) === 0, "no southern neighbour: the map edge");

// A SLANTED neighbour is measured at the handle's own x, not at some fixed point -- otherwise a handle
// near the right edge would be clamped by the neighbour's height on the left.
const slanted = [[0, 900], [1024, 300]];
assert(context.climateClampVertexY(880, 1024, slanted, null) === 299,
	"the corridor is measured at the handle's x, not at the line's start");

// ---- clamping horizontally -------------------------------------------------------------------------

assert(context.climateClampVertexX(400, 300, 600) === 400, "inside: unchanged");
assert(context.climateClampVertexX(290, 300, 600) === 301, "cannot pass the previous point");
assert(context.climateClampVertexX(700, 300, 600) === 599, "cannot pass the next point");

// ---- where a new point goes ------------------------------------------------------------------------

const bent = [[0, 900], [400, 880], [1024, 910]];
assert(context.climateInsertionIndex(bent, 200) === 1, "a click in the first segment inserts at 1");
assert(context.climateInsertionIndex(bent, 700) === 2, "a click in the second segment inserts at 2");
assert(context.climateInsertionIndex(bent, 0) === 1, "exactly on the left end still lands inside");
assert(context.climateInsertionIndex(bent, 1024) === 2, "exactly on the right end lands in the last segment");
// 🔴 Never 0 and never length: the two edge points are mandatory, and an insertion outside them would
// push one of them out of its corner -- the band below would then stop short of the map edge.
[-100, 0, 512, 1024, 5000].forEach((x) => {
	const index = context.climateInsertionIndex(bent, x);
	assert(index >= 1 && index <= bent.length - 1, `insertion index for x=${x} stays inside the edges`);
});

// ---- wo der Zonenname sitzt (2026-08-03) -----------------------------------------------------------
// 🔴 Aus der FLÄCHE gerechnet, nicht aus den Trennlinien: die Namen stehen auch im Frontend, und dort
// gibt es die Trennlinien nicht -- sie kommen vom Editor-Endpunkt. Ein Band beginnt und endet auf dem
// Kartenrand, sein Ring hat bei x = 0 deshalb genau zwei Ecken; deren Mitte ist die Bandmitte.

const band = { type: "Polygon", coordinates: [[[0, 900], [1024, 880], [1024, 700], [0, 700], [0, 900]]] };
assert(JSON.stringify(context.climateAreaWestEdgeSpan(band)) === JSON.stringify({ min: 700, max: 900 }),
	"the west edge span comes from the two ring corners at x = 0");

// 🪤 Eine SCHRÄGE Südgrenze darf das Ergebnis nicht verschieben -- genau deshalb wird an der Westkante
// gemessen und nicht über `bounds`, dessen Mitte hier 790 statt 800 wäre.
const schraeg = { type: "Polygon", coordinates: [[[0, 900], [1024, 880], [1024, 600], [0, 700], [0, 900]]] };
assert(JSON.stringify(context.climateAreaWestEdgeSpan(schraeg)) === JSON.stringify({ min: 700, max: 900 }),
	"a slanted southern boundary does not move the label");

const multi = { type: "MultiPolygon", coordinates: [[[[0, 500], [1024, 500], [1024, 400], [0, 400], [0, 500]]]] };
assert(JSON.stringify(context.climateAreaWestEdgeSpan(multi)) === JSON.stringify({ min: 400, max: 500 }),
	"a MultiPolygon works the same way");

// Kein Punkt auf der Westkante: dann lieber kein Name als einer an geratener Stelle.
const abseits = { type: "Polygon", coordinates: [[[300, 500], [700, 500], [700, 400], [300, 400], [300, 500]]] };
assert(context.climateAreaWestEdgeSpan(abseits) === null, "an area that never touches the west edge gets no label");
assert(context.climateAreaWestEdgeSpan(undefined) === null, "and neither does a missing geometry");

if (failures > 0) {
	console.error(`ecosystem-climate.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-climate.test: OK");

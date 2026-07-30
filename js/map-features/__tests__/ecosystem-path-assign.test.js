const assert = require("assert");
const {
	ecosystemAreaEdges,
	ecosystemLineBounds,
	ecosystemPointInEdges,
	ecosystemLineIntervals,
} = require("../map-features-ecosystem-path-assign.js");

const near = (actual, expected, why) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, why + " -- erwartet " + expected + ", bekommen " + actual);

// A square 0..100.
const square = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] };
const squareEdges = ecosystemAreaEdges(square);

// A wood with a clearing -- the same fixture the geometry test uses, and the reason holes need no
// special case: a hole's edges flip the state exactly like an outer ring's.
const woodWithClearing = {
	type: "Polygon",
	coordinates: [
		[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
		[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
	],
};

// Two separate squares: ONE area, and a line crossing it TWICE. This is the shape that makes `seq`
// part of the key -- 244 real pairs cross more than once, one of them thirteen times.
const twoSquares = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]],
	],
};

// ---- edges -------------------------------------------------------------------------------------
assert.strictEqual(squareEdges.length, 4, "four edges -- the closing point is not a fifth");
assert.strictEqual(ecosystemAreaEdges(woodWithClearing).length, 8, "outer ring and hole together");
assert.strictEqual(ecosystemAreaEdges(twoSquares).length, 8, "both parts of a MultiPolygon");
assert.deepStrictEqual(ecosystemAreaEdges({ type: "Point", coordinates: [1, 2] }), [], "not an area");

// ---- bounds ------------------------------------------------------------------------------------
assert.deepStrictEqual(
	ecosystemLineBounds([[5, 7], [-3, 20], [11, 2]]),
	{ min_x: -3, min_y: 2, max_x: 11, max_y: 20 }
);

// ---- ray cast ----------------------------------------------------------------------------------
assert.strictEqual(ecosystemPointInEdges(50, 50, squareEdges), true, "middle of the square");
assert.strictEqual(ecosystemPointInEdges(150, 50, squareEdges), false, "right of the square");
assert.strictEqual(ecosystemPointInEdges(-50, 50, squareEdges), false, "left of the square");
assert.strictEqual(
	ecosystemPointInEdges(50, 50, ecosystemAreaEdges(woodWithClearing)), false,
	"the clearing is a hole, and a hole is outside"
);

// ---- no intersection ---------------------------------------------------------------------------
assert.deepStrictEqual(ecosystemLineIntervals([[200, 50], [300, 50]], squareEdges), []);

// ---- straight through --------------------------------------------------------------------------
let intervals = ecosystemLineIntervals([[-10, 50], [110, 50]], squareEdges);
assert.strictEqual(intervals.length, 1, "one crossing");
near(intervals[0].enter, 10, "enters 10 units after the start");
near(intervals[0].exit, 110, "leaves 110 units after the start");

// ---- starts inside -----------------------------------------------------------------------------
intervals = ecosystemLineIntervals([[50, 50], [110, 50]], squareEdges);
assert.strictEqual(intervals.length, 1);
near(intervals[0].enter, 0, "a line that starts inside enters at 0");
near(intervals[0].exit, 50, "and leaves at the boundary");

// ---- entirely inside ---------------------------------------------------------------------------
intervals = ecosystemLineIntervals([[10, 50], [90, 50]], squareEdges);
assert.strictEqual(intervals.length, 1);
near(intervals[0].enter, 0, "no boundary at all");
near(intervals[0].exit, 80, "so the interval is the whole line");

// ---- several vertices, the arc length keeps accumulating ----------------------------------------
intervals = ecosystemLineIntervals([[-10, 50], [50, 50], [50, 150]], squareEdges);
assert.strictEqual(intervals.length, 1, "in through the side, out through the top");
near(intervals[0].enter, 10, "enters on the left edge");
near(intervals[0].exit, 60 + 50, "60 along the first leg, then 50 up the second");

// ---- the hole makes a gap ----------------------------------------------------------------------
intervals = ecosystemLineIntervals([[-10, 50], [110, 50]], ecosystemAreaEdges(woodWithClearing));
assert.strictEqual(intervals.length, 2, "wood, clearing, wood");
near(intervals[0].enter, 10, "enters the wood");
near(intervals[0].exit, 50, "reaches the clearing");
near(intervals[1].enter, 70, "leaves the clearing");
near(intervals[1].exit, 110, "leaves the wood");

// ---- the same area twice -----------------------------------------------------------------------
intervals = ecosystemLineIntervals([[-5, 5], [35, 5]], ecosystemAreaEdges(twoSquares));
assert.strictEqual(intervals.length, 2, "two parts, two intervals, one area");
near(intervals[0].enter, 5, "first square");
near(intervals[0].exit, 15, "");
near(intervals[1].enter, 25, "second square");
near(intervals[1].exit, 35, "");

// ---- 💣 exactly through a corner -----------------------------------------------------------------
// (100,100) ends the right edge and starts the top edge. With u half-open on BOTH sides it counts
// ONCE. Counting it twice would toggle the state back and report zero intervals for a line that
// visibly leaves the square.
intervals = ecosystemLineIntervals([[50, 50], [150, 150]], squareEdges);
assert.strictEqual(intervals.length, 1, "a corner crossing counts once, not twice");
near(intervals[0].enter, 0, "starts inside");
near(intervals[0].exit, Math.hypot(50, 50), "leaves exactly at the corner");

// ---- grazing the boundary from either side -------------------------------------------------------
// The realistic near-tangent, and the one that has to be right: a hair inside is a full crossing, a
// hair outside is nothing at all. Exact collinearity (see below) is a different, degenerate story.
intervals = ecosystemLineIntervals([[-10, 0.001], [110, 0.001]], squareEdges);
assert.strictEqual(intervals.length, 1, "a hair inside the bottom edge is a crossing");
near(intervals[0].enter, 10, "");
near(intervals[0].exit, 110, "");
assert.deepStrictEqual(
	ecosystemLineIntervals([[-10, -0.001], [110, -0.001]], squareEdges), [],
	"a hair outside is nothing at all"
);

// ---- 💣 a way that BEGINS exactly on the boundary --------------------------------------------------
// Found by testing, not by reading: ways are drawn to start at borders, and the start point is the
// one place a ray cast cannot answer. Before the fix this came back inverted -- 100..110, a stretch
// entirely OUTSIDE the square -- because the state was read at the start point and because the cut
// sitting at distance 0 made a zero-length span flip it a second time.
intervals = ecosystemLineIntervals([[0, 50], [110, 50]], squareEdges);
assert.strictEqual(intervals.length, 1, "a way starting on the boundary runs INTO the area");
near(intervals[0].enter, 0, "from its very first metre");
near(intervals[0].exit, 100, "to the far edge");

assert.deepStrictEqual(
	ecosystemLineIntervals([[-10, 50], [0, 50]], squareEdges), [],
	"a way that merely reaches the boundary and stops has no passage"
);

// A vertex sitting exactly in a corner, coming from outside.
intervals = ecosystemLineIntervals([[-10, -10], [0, 0], [50, 50]], squareEdges);
assert.strictEqual(intervals.length, 1, "enters at the corner");
near(intervals[0].enter, Math.hypot(10, 10), "the corner is where it starts being inside");
near(intervals[0].exit, Math.hypot(10, 10) + Math.hypot(50, 50), "and it ends inside");

// ---- ⚠️ KNOWN LIMIT: a tangent touch is reported as a passage ---------------------------------------
// A line that touches the boundary and turns back without entering produces ONE cut, and one cut is
// indistinguishable from a crossing. Telling them apart means asking which side both neighbouring
// segments lie on -- real complexity for a case that needs exact float equality with a border.
// Pinned as characterisation, not as approval: if someone makes this right, this assertion is what
// tells them they succeeded.
assert.deepStrictEqual(
	ecosystemLineIntervals([[-10, 50], [0, 50], [-10, 60]], squareEdges),
	[{ enter: 10, exit: 10 + Math.hypot(10, 10) }],
	"a tangent touch currently reads as an entry -- known, rare, documented"
);

// ---- degenerate ----------------------------------------------------------------------------------
assert.deepStrictEqual(ecosystemLineIntervals([[50, 50], [50, 50]], squareEdges), [],
	"a zero-length line has no interval, and must not throw");
assert.deepStrictEqual(ecosystemLineIntervals([[-10, 50], [110, 50]], []), [],
	"an area without edges is skipped, not an error");
assert.deepStrictEqual(ecosystemLineIntervals([[10, 50]], squareEdges), [],
	"a single point is not a line");
assert.deepStrictEqual(ecosystemLineIntervals(null, squareEdges), [], "no coordinates, no throw");

// A repeated vertex must not divide by zero or shift the arc length.
intervals = ecosystemLineIntervals([[-10, 50], [-10, 50], [110, 50]], squareEdges);
assert.strictEqual(intervals.length, 1, "a duplicated vertex changes nothing");
near(intervals[0].enter, 10, "");
near(intervals[0].exit, 110, "");

// ---- the shared parity corpus -------------------------------------------------------------------
// The same file is read by the PHP twin's test (api/_internal/app/__tests__/ecosystem-line-intervals-
// test.php). Running it HERE too is what makes it trustworthy: the fixture claims to describe this
// implementation, so if it ever describes something else, this block says so before the twin does.
const fixture = require("./ecosystem-line-intervals-fixture.json");
const fixtureEdges = {};
Object.keys(fixture.areas).forEach((key) => {
	fixtureEdges[key] = ecosystemAreaEdges(fixture.areas[key]);
});
fixture.cases.forEach((testCase) => {
	const actual = ecosystemLineIntervals(testCase.line, fixtureEdges[testCase.area]);
	assert.strictEqual(
		actual.length, testCase.intervals.length,
		"Fixture „" + testCase.name + "\": erwartet " + testCase.intervals.length
			+ " Intervall(e), bekommen " + actual.length
	);
	testCase.intervals.forEach(([enter, exit], index) => {
		near(actual[index].enter, enter, "Fixture „" + testCase.name + "\" Intervall " + index + " enter");
		near(actual[index].exit, exit, "Fixture „" + testCase.name + "\" Intervall " + index + " exit");
	});
});
console.log("ecosystem-path-assign: alle Prüfungen bestanden, davon "
	+ fixture.cases.length + " aus der geteilten Fixture");

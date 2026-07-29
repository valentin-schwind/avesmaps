const assert = require("assert");

// The edit module reaches for ecosystemGeometryParts as a browser global (164 <script> tags, one scope).
// In Node it has to be handed over deliberately -- and it is the REAL one, not a stub, so the test also
// proves the two files agree about what a "part" is.
const { ecosystemGeometryParts } = require("../map-features-ecosystem-geometry.js");
global.ecosystemGeometryParts = ecosystemGeometryParts;

const {
	ecosystemEditRingIsClosed,
	ecosystemEditVertexCount,
	ecosystemEditSetVertex,
	ecosystemEditInsertVertex,
	ecosystemEditRemoveVertex,
	ecosystemEditNearestEdge,
	ecosystemEditSubdivideEdge,
	ecosystemEditNearestSnapPoint,
	pushEcosystemGeometryUndoStep,
	ECOSYSTEM_GEOMETRY_UNDO_LIMIT,
} = require("../map-features-ecosystem-edit.js");

const square = () => ({
	type: "Polygon",
	coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
});

// The Farindel case again: an area with a clearing in it. A hole edge is an edge you can want another
// corner on, so everything below has to work on ring 1 exactly as it does on ring 0.
const woodWithClearing = () => ({
	type: "Polygon",
	coordinates: [
		[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
		[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
	],
});

// ---- the closing duplicate ---------------------------------------------------------------------
// 💣 A GeoJSON ring repeats its first position as its last. Counting it as a corner gives two handles
// on one spot, one of which does nothing; forgetting it when corner 0 moves tears the ring open at
// exactly the corner being dragged.
assert.strictEqual(ecosystemEditRingIsClosed([[0, 0], [1, 0], [1, 1], [0, 0]]), true, "closed ring");
assert.strictEqual(ecosystemEditRingIsClosed([[0, 0], [1, 0], [1, 1]]), false, "open ring");
assert.strictEqual(ecosystemEditVertexCount([[0, 0], [1, 0], [1, 1], [0, 0]]), 3, "closed ring has 3 grabbable corners");
assert.strictEqual(ecosystemEditVertexCount([[0, 0], [1, 0], [1, 1]]), 3, "open ring has 3 too");

// ---- moving a corner ----------------------------------------------------------------------------
const moved = square();
assert.strictEqual(ecosystemEditSetVertex(moved.coordinates[0], 2, [80, 90]), true, "corner 2 moves");
assert.deepStrictEqual(moved.coordinates[0][2], [80, 90]);
assert.deepStrictEqual(moved.coordinates[0][4], [0, 0], "the closing duplicate is untouched by a middle corner");

// 💣 The load-bearing one: corner 0 drags the closing duplicate with it.
assert.strictEqual(ecosystemEditSetVertex(moved.coordinates[0], 0, [5, 7]), true, "corner 0 moves");
assert.deepStrictEqual(moved.coordinates[0][0], [5, 7]);
assert.deepStrictEqual(moved.coordinates[0][4], [5, 7], "ring stays closed after corner 0 moved");

// The closing duplicate is not addressable as a corner of its own.
assert.strictEqual(ecosystemEditSetVertex(moved.coordinates[0], 4, [1, 1]), false, "index 4 is not a corner");
assert.strictEqual(ecosystemEditSetVertex(moved.coordinates[0], -1, [1, 1]), false, "negative index refused");

// ---- Ctrl+click sets ONE corner, and it lands ON the edge ---------------------------------------
// 💣 The template sets FOUR (subdivideRegionEditHoveredEdge, called with 4 at
// map-features-region-vertex-detach-edit.js:461) -- the wrong grain for a coastline. One is the point
// of this file, so the count is asserted, not just the position.
const edge = ecosystemEditNearestEdge([50, 3], square());
assert.strictEqual(edge.partIndex, 0);
assert.strictEqual(edge.ringIndex, 0, "the southern edge belongs to the outer ring");
assert.strictEqual(edge.insertAt, 1, "between corner 0 and corner 1");
assert.deepStrictEqual(edge.position, [50, 0], "the corner lands ON the edge, not under the cursor");
assert.strictEqual(edge.distance, 3);

const oneMore = square();
const cornersBefore = ecosystemEditVertexCount(oneMore.coordinates[0]);
assert.strictEqual(ecosystemEditInsertVertex(oneMore, edge), true);
assert.strictEqual(
	ecosystemEditVertexCount(oneMore.coordinates[0]),
	cornersBefore + 1,
	"exactly ONE corner more -- not four"
);
assert.deepStrictEqual(oneMore.coordinates[0][1], [50, 0], "the new corner sits where the edge was");
assert.strictEqual(ecosystemEditRingIsClosed(oneMore.coordinates[0]), true, "ring still closed after inserting");

// A hole edge answers too, with its own ring index -- otherwise a corner meant for the clearing would
// be spliced into the outer ring and the shape would fold over itself.
const holeEdge = ecosystemEditNearestEdge([50, 41], woodWithClearing());
assert.strictEqual(holeEdge.ringIndex, 1, "the clearing's edge is ring 1");
assert.deepStrictEqual(holeEdge.position, [50, 40]);

const withHoleCorner = woodWithClearing();
assert.strictEqual(ecosystemEditInsertVertex(withHoleCorner, holeEdge), true);
assert.strictEqual(ecosystemEditVertexCount(withHoleCorner.coordinates[1]), 5, "the hole gained one corner");
assert.strictEqual(ecosystemEditVertexCount(withHoleCorner.coordinates[0]), 4, "the outer ring gained none");

// A MultiPolygon reports the part it belongs to; without that the corner lands in the wrong island.
const twoIslands = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[100, 100], [110, 100], [110, 110], [100, 110], [100, 100]]],
	],
};
assert.strictEqual(ecosystemEditNearestEdge([105, 99], twoIslands).partIndex, 1, "second island wins");

// ---- Ctrl+click lays FOUR corners, evenly spaced ------------------------------------------------
// Two grains, two gestures (owner 2026-07-26): the double-click above places one corner exactly where
// it was aimed, Ctrl+click fans four along the whole segment so a straight edge can become a curve.
const fanned = square();
const southEdge = ecosystemEditNearestEdge([50, 3], square());
assert.strictEqual(ecosystemEditSubdivideEdge(fanned, southEdge, 4), true);
assert.strictEqual(ecosystemEditVertexCount(fanned.coordinates[0]), 8, "4 corners -> 8");
assert.deepStrictEqual(
	fanned.coordinates[0].slice(1, 5),
	[[20, 0], [40, 0], [60, 0], [80, 0]],
	"evenly spaced along the segment, endpoints untouched"
);
assert.deepStrictEqual(fanned.coordinates[0][0], [0, 0], "the segment start stays put");
assert.deepStrictEqual(fanned.coordinates[0][5], [100, 0], "and so does its end");
assert.strictEqual(ecosystemEditRingIsClosed(fanned.coordinates[0]), true, "ring still closed");

// The same call on a hole edge subdivides the HOLE, not the outer ring.
const fannedHole = woodWithClearing();
assert.strictEqual(ecosystemEditSubdivideEdge(fannedHole, ecosystemEditNearestEdge([50, 41], woodWithClearing()), 4), true);
assert.strictEqual(ecosystemEditVertexCount(fannedHole.coordinates[1]), 8, "the clearing gained four");
assert.strictEqual(ecosystemEditVertexCount(fannedHole.coordinates[0]), 4, "the outer ring gained none");

// count is honoured, and a nonsensical one is refused rather than silently treated as 4.
const fannedOne = square();
assert.strictEqual(ecosystemEditSubdivideEdge(fannedOne, southEdge, 1), true);
assert.strictEqual(ecosystemEditVertexCount(fannedOne.coordinates[0]), 5, "count = 1 inserts one");
assert.deepStrictEqual(fannedOne.coordinates[0][1], [50, 0], "and it lands mid-segment");
assert.strictEqual(ecosystemEditSubdivideEdge(square(), southEdge, 0), false, "count = 0 is refused");
assert.strictEqual(ecosystemEditSubdivideEdge(square(), { insertAt: 0 }, 4), false, "insertAt 0 has no segment before it");

// ---- deleting a corner ---------------------------------------------------------------------------
const shrinking = square();
assert.strictEqual(ecosystemEditRemoveVertex(shrinking, { vertexIndex: 2 }), true, "4 corners -> 3");
assert.strictEqual(ecosystemEditVertexCount(shrinking.coordinates[0]), 3);
// The floor: below three corners it is not a face any more.
assert.strictEqual(ecosystemEditRemoveVertex(shrinking, { vertexIndex: 0 }), false, "3 corners is the floor");
assert.strictEqual(ecosystemEditVertexCount(shrinking.coordinates[0]), 3, "the refusal changed nothing");

// 💣 Deleting corner 0 leaves the closing duplicate pointing at a corner that no longer exists.
const dropFirst = square();
assert.strictEqual(ecosystemEditRemoveVertex(dropFirst, { vertexIndex: 0 }), true);
assert.strictEqual(ecosystemEditRingIsClosed(dropFirst.coordinates[0]), true, "ring re-closed against the new first corner");
assert.deepStrictEqual(dropFirst.coordinates[0][0], [100, 0]);
assert.deepStrictEqual(dropFirst.coordinates[0][dropFirst.coordinates[0].length - 1], [100, 0]);

// ---- the undo stack ------------------------------------------------------------------------------
// 💣 The snapshot must be a DEEP COPY. A stack sharing arrays with the live geometry would follow every
// later drag, and "undo" would restore the present -- a bug that looks like undo doing nothing.
const live = square();
const stack = [];
pushEcosystemGeometryUndoStep(stack, live);
ecosystemEditSetVertex(live.coordinates[0], 1, [999, 999]);
assert.deepStrictEqual(stack[0].coordinates[0][1], [100, 0], "the snapshot did not follow the drag");
assert.deepStrictEqual(live.coordinates[0][1], [999, 999], "the live geometry did move");

// 20 steps, oldest dropped -- the plan's number, and the reason the stack cannot grow without bound
// during a long coastline.
const capped = [];
for (let i = 0; i < ECOSYSTEM_GEOMETRY_UNDO_LIMIT + 5; i += 1) {
	const step = square();
	step.coordinates[0][1] = [i, 0];
	pushEcosystemGeometryUndoStep(capped, step);
}
assert.strictEqual(capped.length, ECOSYSTEM_GEOMETRY_UNDO_LIMIT, "stack is capped at 20");
assert.deepStrictEqual(capped[0].coordinates[0][1], [5, 0], "the oldest steps fell off the bottom, not the newest");
assert.deepStrictEqual(
	capped[capped.length - 1].coordinates[0][1],
	[ECOSYSTEM_GEOMETRY_UNDO_LIMIT + 4, 0],
	"the newest step is on top"
);

// ---- snapping (editors' request, owner 2026-07-29) ----------------------------------------------
// The neighbour a corner may stick to: a square butting against `square()` along x = 100.
const neighbour = () => ({
	type: "Polygon",
	coordinates: [[[100, 0], [200, 0], [200, 100], [100, 100], [100, 0]]],
});

// 💣 A CORNER BEATS AN EDGE even when the edge is nearer. Landing on the corner joins the two outlines
// at a position both sides still recognise after the next drag; landing 2 px away on the edge only
// looks joined. Here the point sits 4 from the corner [100, 0] and 3 from the edge x = 100.
const cornerWins = ecosystemEditNearestSnapPoint([103, 3], [neighbour()], 10);
assert.strictEqual(cornerWins.kind, "vertex", "a corner in reach wins over a nearer edge");
assert.deepStrictEqual(cornerWins.position, [100, 0]);

// Out of the corner's reach, the edge catches it.
const edgeCatches = ecosystemEditNearestSnapPoint([103, 50], [neighbour()], 10);
assert.strictEqual(edgeCatches.kind, "edge", "no corner near => the edge catches");
assert.deepStrictEqual(edgeCatches.position, [100, 50], "and it lands on the projection, not the cursor");

// Nothing in reach: no snap, and no "nearest anyway".
assert.strictEqual(ecosystemEditNearestSnapPoint([140, 50], [neighbour()], 10), null, "too far => null");
assert.strictEqual(ecosystemEditNearestSnapPoint([103, 50], [], 10), null, "no candidates => null");
assert.strictEqual(ecosystemEditNearestSnapPoint([103, 50], [neighbour()], 0), null, "no tolerance => null");

// The nearest of several corners wins.
const twoNeighbours = [neighbour(), { type: "Polygon", coordinates: [[[104, 4], [150, 4], [150, 40], [104, 40], [104, 4]]] }];
assert.deepStrictEqual(
	ecosystemEditNearestSnapPoint([103, 3], twoNeighbours, 10).position,
	[104, 4],
	"the closer of two corners wins"
);

// Holes count too: an area's inner boundary is a boundary somebody can want to meet.
const clearingSnap = ecosystemEditNearestSnapPoint([41, 41], [woodWithClearing()], 5);
assert.strictEqual(clearingSnap.kind, "vertex", "the clearing's corner is snappable");
assert.deepStrictEqual(clearingSnap.position, [40, 40]);

// MultiPolygon: every part is a candidate.
const islands = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[300, 300], [310, 300], [310, 310], [300, 310], [300, 300]]],
	],
};
assert.deepStrictEqual(ecosystemEditNearestSnapPoint([302, 302], [islands], 5).position, [300, 300], "the far island still attracts");

// 🪤 The closing duplicate must not be measured as a second corner -- it is the same one. A tie between
// ring[0] and ring[last] would otherwise be decided by loop order rather than by distance.
assert.deepStrictEqual(
	ecosystemEditNearestSnapPoint([100, 1], [neighbour()], 10).position,
	[100, 0],
	"the first corner answers once, not twice"
);

// ---- rivers snap too (owner 2026-07-29) ---------------------------------------------------------
// 💣 A river is a LINE, handed in as a Polygon with a single ring. That is only sound because the
// segment walk goes 0..n-2 and never closes the ring -- otherwise there would be a phantom segment
// straight from the mouth back to the source, and a corner near it would snap onto open water.
// This asserts exactly that absence.
const river = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 100]]] };

// On the line: caught.
assert.strictEqual(ecosystemEditNearestSnapPoint([50, 2], [river], 10).kind, "edge", "the river bed catches");
assert.deepStrictEqual(ecosystemEditNearestSnapPoint([50, 2], [river], 10).position, [50, 0]);
// Its corners are corners like any other.
assert.strictEqual(ecosystemEditNearestSnapPoint([2, 2], [river], 10).kind, "vertex", "a bend is a corner");
assert.deepStrictEqual(ecosystemEditNearestSnapPoint([2, 2], [river], 10).position, [0, 0]);

// 🔴 THE ONE THAT MATTERS: the straight line from the last point [100,100] back to the first [0,0]
// runs right past [50,50]. If the ring were closed, that point would snap. It must not.
assert.strictEqual(
	ecosystemEditNearestSnapPoint([50, 50], [river], 10),
	null,
	"no phantom segment from the end back to the start"
);
// And a point genuinely far from every segment stays unsnapped.
assert.strictEqual(ecosystemEditNearestSnapPoint([50, 40], [river], 10), null, "open water is not a target");

console.log("ecosystem edit tests passed");

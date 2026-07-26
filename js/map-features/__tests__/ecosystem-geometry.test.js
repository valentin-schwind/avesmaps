const assert = require("assert");
const {
	ecosystemGeometryRings,
	ecosystemDistanceToSegment,
	distanceToEcosystemEdge,
	ecosystemRingArea,
	ecosystemGeometryArea,
	ecosystemGeometryBounds,
	normalizeEcosystemDrawnRing,
	repairEcosystemGeometry,
} = require("../map-features-ecosystem-geometry.js");
const { pointInGeometry } = require("../map-features-point-in-polygon.js");

// A wood with a clearing in it: outer ring 0..100, hole 40..60. This is the shape the plan calls the
// Farindel case -- everything below is about not treating the clearing as wood.
const woodWithClearing = {
	type: "Polygon",
	coordinates: [
		[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
		[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
	],
};

// ---- ring-awareness, step 1 of the plan --------------------------------------------------------
// The plan asks for an inPoly "over all rings, outer/hole per GeoJSON". That function already exists
// (map-features-point-in-polygon.js) and the ecosystem layer uses it rather than growing a second
// one -- so what is asserted here is that the EXISTING one satisfies the requirement.
assert.strictEqual(pointInGeometry([10, 10], woodWithClearing), true, "in the wood");
assert.strictEqual(pointInGeometry([50, 50], woodWithClearing), false, "in the clearing => outside");
assert.strictEqual(pointInGeometry([150, 50], woodWithClearing), false, "outside the wood entirely");

// ---- distance to the edge, over ALL rings ------------------------------------------------------
// 💣 The load-bearing assertion. Just inside the clearing's edge the distance must be SMALL. Over the
// outer ring alone it would be ~38 (the way to the map-facing edge), the bump would keep its height
// there, and every hole would get a cliff around it.
assert.ok(distanceToEcosystemEdge([50, 41], woodWithClearing) < 1.001, "hole edge is near, not far");
assert.ok(distanceToEcosystemEdge([41, 50], woodWithClearing) < 1.001, "hole edge from the other side");

// In the middle of the wood, away from both, the nearest boundary is the outer ring.
assert.strictEqual(distanceToEcosystemEdge([20, 20], woodWithClearing), 20, "outer ring wins here");
// Dead centre of the clearing: 10 to the hole edge, 50 to the outer ring -> the hole wins.
assert.strictEqual(distanceToEcosystemEdge([50, 50], woodWithClearing), 10, "hole wins over outer ring");
// Standing on a corner is distance 0, not a special case.
assert.strictEqual(distanceToEcosystemEdge([0, 0], woodWithClearing), 0, "on the corner");

// The projection is clamped to the SEGMENT: a point beyond the end measures to the end, not to the
// line's continuation (unclamped this would read 0).
assert.strictEqual(ecosystemDistanceToSegment([20, 0], [0, 0], [10, 0]), 10, "clamped past the end");
assert.strictEqual(ecosystemDistanceToSegment([5, 3], [0, 0], [10, 0]), 3, "perpendicular within");

// MultiPolygon: the nearest part answers, and every part's rings are considered.
const twoWoods = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[100, 0], [110, 0], [110, 10], [100, 10], [100, 0]]],
	],
};
assert.strictEqual(ecosystemGeometryRings(twoWoods).length, 2, "both parts contribute a ring");
assert.strictEqual(distanceToEcosystemEdge([12, 5], twoWoods), 2, "nearest part answers");
assert.strictEqual(distanceToEcosystemEdge([0, 0], { type: "Polygon", coordinates: [] }), Infinity, "no boundary at all");

// ---- area: outer minus holes -------------------------------------------------------------------
assert.strictEqual(ecosystemRingArea([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]), 100, "closed ring");
assert.strictEqual(ecosystemRingArea([[0, 0], [10, 0], [10, 10], [0, 10]]), 100, "open ring, same area");
assert.strictEqual(ecosystemRingArea([[0, 0], [0, 10], [10, 10], [10, 0]]), 100, "reverse winding, same area");
assert.strictEqual(ecosystemGeometryArea(woodWithClearing), 100 * 100 - 20 * 20, "clearing is subtracted");
assert.strictEqual(ecosystemGeometryArea(twoWoods), 200, "parts are summed");
assert.deepStrictEqual(ecosystemGeometryBounds(twoWoods), { min_x: 0, min_y: 0, max_x: 110, max_y: 10 });

// ---- the ring the drawing tool hands over ------------------------------------------------------
assert.strictEqual(normalizeEcosystemDrawnRing([[0, 0], [10, 0]]), null, "two corners are not a polygon");
assert.strictEqual(normalizeEcosystemDrawnRing([[0, 0], [0, 0], [10, 0]]), null, "a repeat is not a third corner");
assert.strictEqual(normalizeEcosystemDrawnRing("nope"), null, "garbage in, null out");
// The finishing double-click lands twice on the same spot -- that must not become a zero-length edge.
assert.deepStrictEqual(
	normalizeEcosystemDrawnRing([[0, 0], [10, 0], [10, 10], [10, 10]]),
	[[0, 0], [10, 0], [10, 10], [0, 0]],
	"consecutive duplicate dropped, ring closed once"
);
// An already-closed ring keeps exactly one closing point and still counts three corners.
assert.deepStrictEqual(
	normalizeEcosystemDrawnRing([[0, 0], [10, 0], [10, 10], [0, 0]]),
	[[0, 0], [10, 0], [10, 10], [0, 0]],
	"closing point is not doubled"
);

// ---- repairing a self-intersection -------------------------------------------------------------
// A bowtie: the drawn line crossed its own tail. Its shoelace area is the DIFFERENCE of the two
// lobes -- here 0, because they are equal -- while the repaired shape is their SUM. That is why the
// plausibility check is on the bounds and not on the area: an "area must not grow" rule would reject
// precisely the case this function exists for.
const bowtie = { type: "Polygon", coordinates: [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]] };
assert.strictEqual(ecosystemGeometryArea(bowtie), 0, "the bowtie's raw area is the lobes' difference");

// Without the library the repair must hand the input straight back -- never undefined, never a throw.
// In the browser polygon-clipping is a <script> global; asserting this BEFORE installing it is the
// only moment the absent case can be observed.
assert.strictEqual(repairEcosystemGeometry(bowtie), bowtie, "no polygon-clipping -> input unchanged");

global.polygonClipping = require("../../third-party/polygon-clipping.umd.min.js");
const repaired = repairEcosystemGeometry(bowtie);
assert.ok(ecosystemGeometryArea(repaired) > 0, "the repair produces real area");
const repairedBounds = ecosystemGeometryBounds(repaired);
assert.deepStrictEqual(repairedBounds, { min_x: 0, min_y: 0, max_x: 10, max_y: 10 }, "repair stays inside the input bounds");

// A clean polygon comes back with the same area -- the repair is not allowed to "improve" it.
const clean = { type: "Polygon", coordinates: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]] };
assert.strictEqual(ecosystemGeometryArea(repairEcosystemGeometry(clean)), 400, "clean polygon survives unchanged");
// A hole survives the repair; polygon-clipping must not fill the clearing in.
assert.strictEqual(ecosystemGeometryArea(repairEcosystemGeometry(woodWithClearing)), 100 * 100 - 20 * 20, "hole survives");
// Nothing to work on -> the input comes back, never undefined.
assert.deepStrictEqual(repairEcosystemGeometry({ type: "Point", coordinates: [1, 2] }), { type: "Point", coordinates: [1, 2] });

console.log("ecosystem geometry tests passed");

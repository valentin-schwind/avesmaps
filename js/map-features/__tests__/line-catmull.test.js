const assert = require("assert");
const {
	AVESMAPS_CATMULL_DEFAULTS,
	getCatmullRomSplineCoordinates,
	getCatmullRomPoint,
} = require("../map-features-line-catmull.js");

// The numbers below are NOT invented. They were read off the implementation as it stood inside
// js/routing/route-graph-core.js before V9 moved it here, and this test exists to prove the move
// changed nothing: V9 stores intervals along the DRAWN curve, so a shifted sample would make every
// stored basis=1 row describe a line the map does not actually draw.

assert.deepStrictEqual(AVESMAPS_CATMULL_DEFAULTS, { samples: 8, tension: 0.5 });

const near = (actual, expected, why) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, why + " -- erwartet " + expected + ", bekommen " + actual);

// ---- two points: no neighbours to bend towards, so the samples sit on the straight line ---------
assert.deepStrictEqual(
	getCatmullRomSplineCoordinates([[0, 0], [10, 0]], { samples: 2, tension: 0.5 }),
	[[0, 0], [5, 0], [10, 0]],
	"two points, two samples: the plain midpoint"
);

// ---- a straight line stays straight -------------------------------------------------------------
const straight = getCatmullRomSplineCoordinates([[0, 0], [10, 0], [20, 0]], { samples: 4, tension: 0.5 });
assert.strictEqual(straight.length, 1 + 2 * 4, "one start point plus samples per segment");
straight.forEach(([, y]) => assert.ok(Math.abs(y) < 1e-12, "a straight line must not bulge"));
assert.deepStrictEqual(straight[straight.length - 1], [20, 0], "ends exactly on the last vertex");

// ---- the right angle: the curve OVERSHOOTS on both sides of the corner --------------------------
// This is the shape that decides where a way enters a forest, so it is pinned exactly rather than
// as "roughly bends". It dips below the incoming leg before the corner and swings past the outgoing
// one after it -- both by the same 0,732422.
const corner = getCatmullRomSplineCoordinates([[0, 0], [10, 0], [10, 10]], AVESMAPS_CATMULL_DEFAULTS);
assert.strictEqual(corner.length, 17, "one start point plus 8 samples for each of the two segments");
assert.deepStrictEqual(corner[0], [0, 0], "starts on the first vertex");
assert.deepStrictEqual(corner[corner.length - 1], [10, 10], "ends on the last vertex");
assert.deepStrictEqual(corner[8], [10, 0], "the middle sample lands exactly on the shared vertex");
near(Math.max(...corner.map((point) => point[0])), 10.732421875, "overshoot in x after the corner");
near(Math.min(...corner.map((point) => point[1])), -0.732421875, "undershoot in y before the corner");

// ---- one sampled point, exactly ------------------------------------------------------------------
const point = getCatmullRomPoint([0, 0], [10, 0], [10, 10], [0, 10], 0.5, 0.5);
near(point[0], 11.25, "x at t=0.5");
near(point[1], 5, "y at t=0.5");

// ---- 💣 tension 0 does NOT straighten the curve ---------------------------------------------------
// `Number(config.tension) || 0.5` treats 0 as missing, because 0 is falsy -- so asking for no
// tension silently returns the default 0.5 curve. Verified against the pre-extraction implementation
// (identical output), so this is inherited behaviour, faithfully kept.
//
// It is pinned rather than fixed for two reasons: nothing passes 0 today (js/config.js hard-codes
// 0.5), and "fixing" it would change the drawn curve the day someone did -- which, per the V9 spec,
// is a change that silently invalidates every stored basis=1 row.
const slack = getCatmullRomSplineCoordinates([[0, 0], [10, 0], [10, 10]], { samples: 4, tension: 0 });
const taut = getCatmullRomSplineCoordinates([[0, 0], [10, 0], [10, 10]], { samples: 4, tension: 0.5 });
assert.deepStrictEqual(slack, taut, "tension 0 falls back to 0.5 -- inherited, not intended");

console.log("line-catmull: alle Prüfungen bestanden");

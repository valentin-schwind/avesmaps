// Unit test (Node, no build) for the pure way-label helpers in
// js/map-features/map-features-way-labels.js:
//   - wayLabelEndpointKey(coord): rounds [x,y] to 2 decimals -> phase-1 strict-join key.
//   - buildWayLabelChains(segments, eps): TWO-PHASE chain builder. Phase 1 joins segments
//     strictly over (rounded) shared endpoints; at junctions (degree >= 3) the two most
//     direction-continuous arms (smallest bend angle, and only under 90 degrees) pass
//     through as ONE run, all other arms cut there. Phase 2 bridges gaps between FREE chain
//     ends (phase-1 degree 1 only) by iteratively merging the globally closest pair of ends
//     of different chains within eps map units (hand-drawn town joints; default
//     WAY_LABEL_CHAIN_GAP_EPS = 7).
//   - wayLabelArmDirection(coordinates, atStart): unit vector with which a segment arm
//     LEAVES its endpoint (skipping duplicate/float-noise vertices) -- basis for the
//     junction pass-through pairing.
//   - computeWayLabelIntervalOffsets(totalLenPx, intervalPx, textLenPx): center offsets
//     (px along the chain) for placing repeated labels at a fixed screen interval.
//   - wayLabelHitTest(register, point): pure hit-test over the click-placement register built
//     by the canvas overlay's redraw() (Task 16, clickable way-name labels). Returns the LAST
//     entry (of possibly several) whose rect contains {x,y} -- "last" because later entries were
//     drawn on top in the same redraw pass -- else null.
//
// Run: node tools/paths/test-way-labels.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const wayLabelsSource = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-way-labels.js"), "utf8");

function extractFunction(source, name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in source`);
	}
	let i = source.indexOf("{", startIndex);
	let depth = 0;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(startIndex, i + 1);
			}
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

// Extracts a single-line `const NAME = ...;` module-level declaration from the source (used for
// WAY_LABEL_CHAIN_GAP_EPS, which buildWayLabelChains reads as its default bridging eps).
function extractConst(source, name) {
	const startMarker = `const ${name} = `;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`const ${name} not found in source`);
	}
	const endIndex = source.indexOf(";", startIndex);
	if (endIndex === -1) {
		throw new Error(`unterminated const ${name}`);
	}
	return source.slice(startIndex, endIndex + 1);
}

const sandbox = new Function(`
	${extractConst(wayLabelsSource, "WAY_LABEL_CHAIN_GAP_EPS")}
	${extractFunction(wayLabelsSource, "wayLabelEndpointKey")}
	${extractFunction(wayLabelsSource, "wayLabelArmDirection")}
	${extractFunction(wayLabelsSource, "buildWayLabelChains")}
	${extractFunction(wayLabelsSource, "computeWayLabelIntervalOffsets")}
	${extractFunction(wayLabelsSource, "wayLabelHitTest")}
	return { wayLabelEndpointKey, wayLabelArmDirection, buildWayLabelChains, computeWayLabelIntervalOffsets, wayLabelHitTest };
`)();
const { wayLabelEndpointKey, wayLabelArmDirection, buildWayLabelChains, computeWayLabelIntervalOffsets, wayLabelHitTest } = sandbox;

// Euclidean distance -- used by assertChainsWellFormed to check end-to-start connectivity
// against the SAME tolerance buildWayLabelChains itself bridges with in phase 2 (default eps=7,
// see WAY_LABEL_CHAIN_GAP_EPS in the source), rather than requiring exact coordinate equality.
function dist(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
const DEFAULT_TEST_EPS = 7;

let passed = 0;
function check(label, fn) {
	fn();
	passed++;
	console.log(`ok ${label}`);
}

// Asserts the invariants any buildWayLabelChains output must hold, regardless of how
// segments were partitioned into chains: every segment id from the input appears
// exactly once across all chains, and consecutive entries within a chain connect
// end-to-start within the bridging tolerance (default WAY_LABEL_CHAIN_GAP_EPS=7).
function assertChainsWellFormed(chains, segments, eps = DEFAULT_TEST_EPS) {
	const seenIds = [];
	chains.forEach((chain) => {
		assert.ok(Array.isArray(chain) && chain.length > 0, "chain must be a non-empty array");
		chain.forEach((entry) => seenIds.push(entry.id));
		for (let i = 1; i < chain.length; i += 1) {
			const prev = chain[i - 1];
			const cur = chain[i];
			const prevCoords = segments.find((s) => s.id === prev.id).coordinates;
			const curCoords = segments.find((s) => s.id === cur.id).coordinates;
			const prevEnd = prev.reversed ? prevCoords[0] : prevCoords[prevCoords.length - 1];
			const curStart = cur.reversed ? curCoords[curCoords.length - 1] : curCoords[0];
			assert.ok(
				dist(prevEnd, curStart) <= eps,
				`chain entries ${prev.id} -> ${cur.id} must connect end-to-start within eps=${eps} (got ${dist(prevEnd, curStart)})`
			);
		}
	});
	const expectedIds = segments.map((s) => s.id).slice().sort();
	const actualIds = seenIds.slice().sort();
	assert.deepEqual(actualIds, expectedIds, "every segment must appear exactly once across all chains");
}

check("endpoint key rounds coordinates to 2 decimals (phase-1 strict-join grid)", () => {
	// Float noise (~0.001 measured) collapses onto the same 0.01-grid key ...
	assert.equal(wayLabelEndpointKey([10.0004, 5.0004]), wayLabelEndpointKey([10.0009, 5.0001]));
	assert.equal(wayLabelEndpointKey([10, 0]), wayLabelEndpointKey([10.0008, 0]));
	// ... while 0.01-scale differences stay distinct (min segment length 2.32 is far above).
	assert.notEqual(wayLabelEndpointKey([10.0, 5.0]), wayLabelEndpointKey([10.01, 5.0]));
});

check("arm direction: unit away-vector at either end, noise vertices skipped, degenerate -> null", () => {
	// Direction with which an arm LEAVES its endpoint: atStart=true reads forward from the
	// first point, atStart=false backward from the last point.
	assert.deepEqual(wayLabelArmDirection([[0, 0], [10, 0]], true), [1, 0]);
	assert.deepEqual(wayLabelArmDirection([[0, 0], [10, 0]], false), [-1, 0]);
	// Exact duplicate and float-noise vertices (below half the 0.01 join grid) don't define
	// a direction -- skip to the first distinguishable vertex.
	assert.deepEqual(wayLabelArmDirection([[0, 0], [0, 0], [0.001, 0], [0, 7]], true), [0, 1]);
	// Degenerate arms (no distinguishable second point) have no direction.
	assert.equal(wayLabelArmDirection([[5, 5], [5, 5]], true), null);
	assert.equal(wayLabelArmDirection([[5, 5]], false), null);
});

check("two segments sharing an endpoint -> one chain of 2, correct order and reversed flags", () => {
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [20, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 1);
	assert.equal(chains[0].length, 2);
	assert.equal(chains[0][0].id, "seg-A");
	assert.equal(chains[0][0].reversed, false);
	assert.equal(chains[0][1].id, "seg-B");
	assert.equal(chains[0][1].reversed, false);
});

check("joint endpoints 3 map units apart (below gap eps) -> one connected chain of 2 (phase-2 bridge)", () => {
	// Real hand-drawn town-joint case: segments don't share an exact vertex, they meet
	// "at" a town within a few map units. 3 < WAY_LABEL_CHAIN_GAP_EPS(7) -> free ends bridge.
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[13, 0], [20, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 1, "free chain ends within gap eps must be bridged into one chain");
	assert.equal(chains[0].length, 2);
});

check("float-noise gap of 0.0008 map units -> one connected chain of 2 (phase-1 rounding)", () => {
	// Measured on production data: ~10% of nearest-neighbor endpoint gaps are float noise
	// (~0.001) just ABOVE the old 1e-4 rounding grid -- the 0.01 grid joins these strictly.
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10.0008, 0], [20, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 1, "float-noise gaps well under the 0.01 grid must join in phase 1");
	assert.equal(chains[0].length, 2);
});

check("segments A-B and C-D with a 50-unit gap -> two chains", () => {
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [20, 0]] },
		{ id: "seg-C", coordinates: [[70, 0], [80, 0]] },
		{ id: "seg-D", coordinates: [[80, 0], [90, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 2);
	const idsPerChain = chains.map((chain) => chain.map((e) => e.id).sort()).sort();
	assert.deepEqual(idsPerChain, [["seg-A", "seg-B"], ["seg-C", "seg-D"]]);
});

check("gap of 20 map units (above gap eps) -> two chains", () => {
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[30, 0], [40, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 2, "a 20-unit gap is well above eps=7 and must not bridge");
});

check("T-junction (degree 3): the two straightest arms pass through, the spur is cut", () => {
	// Junction pass-through (was: every degree-3+ node cut ALL arms; on real data 3+ segments
	// of the SAME way meet at town nodes and the way fell apart into short chains): the two
	// arms with the smallest bend between incoming and outgoing direction pair into ONE run,
	// every other arm still cuts. seg-A (0,0)->(10,0) and seg-B (10,0)->(20,0) are collinear
	// through the junction (10,0); seg-C branches off at 90 degrees and stays separate.
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [20, 0]] },
		{ id: "seg-C", coordinates: [[10, 0], [10, 10]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 2, "straight-through pair joins into one chain, spur stays separate");
	const idsPerChain = chains.map((chain) => chain.map((e) => e.id).sort()).sort();
	assert.deepEqual(idsPerChain, [["seg-A", "seg-B"], ["seg-C"]]);
});

check("4-arm star: only the two most collinear arms pair, remaining arms start their own chains", () => {
	// Node (50,50), degree 4. Away directions: seg-W (-1,0) and seg-E ~(1,0.025) form the
	// straightest pair (bend ~1.4 deg). seg-N (0,1) and seg-SE ~(0.71,-0.71) would pair at a
	// 45-degree bend, but only ONE pass-through pair per node is allowed -- remaining arms
	// are cut arms and start new chains.
	const segments = [
		{ id: "seg-W", coordinates: [[10, 50], [50, 50]] }, // stored pointing INTO the node
		{ id: "seg-E", coordinates: [[50, 50], [90, 51]] },
		{ id: "seg-N", coordinates: [[50, 50], [50, 90]] },
		{ id: "seg-SE", coordinates: [[50, 50], [80, 20]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 3, "one through-pair plus two cut arms");
	const idsPerChain = chains.map((chain) => chain.map((e) => e.id).sort()).sort();
	assert.deepEqual(idsPerChain, [["seg-E", "seg-W"], ["seg-N"], ["seg-SE"]]);
});

check("run between two junctions chains fully regardless of stored segment orientation", () => {
	// Regression: segments between two junctions have no degree-1 endpoint, so the old code
	// started them in pass 2 with the STORED orientation -- walking into the near junction
	// after one segment and leaving the rest fragmented (and those degree-2 break joints are
	// invisible to phase 2, which only bridges degree-1 ends). Starting walks at CUT arms
	// (junction arms outside the through-pair) makes the whole run one chain: left arm ->
	// through J1 (0,0) -> run-A (stored backwards on purpose) -> run-B -> through J2 (20,0)
	// -> right arm. The two spurs stay separate chains.
	const segments = [
		{ id: "seg-L", coordinates: [[0, 0], [-30, 0]] },
		{ id: "seg-spurN", coordinates: [[0, 0], [0, 30]] },
		{ id: "seg-runA", coordinates: [[10, 0], [0, 0]] }, // stored backwards on purpose
		{ id: "seg-runB", coordinates: [[10, 0], [20, 0]] },
		{ id: "seg-R", coordinates: [[20, 0], [30, 0]] },
		{ id: "seg-spurS", coordinates: [[20, 0], [20, -30]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 3, "main run is ONE chain through both junctions, plus the two spurs");
	const idsPerChain = chains.map((chain) => chain.map((e) => e.id).sort()).sort();
	assert.deepEqual(idsPerChain, [
		["seg-L", "seg-R", "seg-runA", "seg-runB"],
		["seg-spurN"],
		["seg-spurS"],
	]);
});

check("fan junction (all arms leave into the same half-plane) -> no pass-through, all arms cut", () => {
	// Guard: a pass-through pair needs a bend angle under 90 degrees (dot of the away
	// directions < 0). Here all three arms leave the node roughly eastwards -- ANY pairing
	// would fold the label run back on itself (hairpin) -- so the junction cuts all arms.
	// Doubles as the phase-2 junction regression: the three ends coincide at (0,0) (well
	// inside gap eps) but junction ends (degree 3) are not free and must never re-bridge.
	// (The FAR ends are kept > 7 units apart on purpose -- those are genuine free ends and
	// would otherwise legitimately bridge.)
	const segments = [
		{ id: "seg-F1", coordinates: [[0, 0], [40, 0]] },
		{ id: "seg-F2", coordinates: [[0, 0], [40, 12]] },
		{ id: "seg-F3", coordinates: [[0, 0], [40, -16]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 3, "no arm pair continues onward -> junction cuts everything");
	chains.forEach((chain) => assert.equal(chain.length, 1));
});

check("reversed geometry (second segment stored end-to-start) -> reversed:true and connected", () => {
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[20, 0], [10, 0]] }, // stored backwards: end is (10,0), matches seg-A's end
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 1);
	assert.equal(chains[0].length, 2);
	const byId = Object.fromEntries(chains[0].map((e) => [e.id, e]));
	assert.equal(byId["seg-A"].reversed, false);
	assert.equal(byId["seg-B"].reversed, true);
});

check("offsets: totalLen 2000, interval 600, textLen 120 -> centers [300, 900, 1500], spans inside bounds", () => {
	const offsets = computeWayLabelIntervalOffsets(2000, 600, 120);
	assert.deepEqual(offsets, [300, 900, 1500]);
	offsets.forEach((c) => {
		assert.ok(c - 60 >= 8, `span start for center ${c} must stay inside the low bound`);
		assert.ok(c + 60 <= 2000 - 8, `span end for center ${c} must stay inside the high bound`);
	});
});

check("offsets: totalLen 500, interval 600, textLen 120 -> [250]", () => {
	const offsets = computeWayLabelIntervalOffsets(500, 600, 120);
	assert.deepEqual(offsets, [250]);
});

check("offsets: totalLen 100, interval 600, textLen 120 -> []", () => {
	const offsets = computeWayLabelIntervalOffsets(100, 600, 120);
	assert.deepEqual(offsets, []);
});

check("short-segment safety: 2-unit middle segment with exact joints -> ONE chain of 3 (no self-merge)", () => {
	// Live regression (Kronstraße): median segment length 7.84 map units, 10/24 segments SHORTER
	// than 7. Wholesale endpoint snapping at eps=7 merged such a segment's own two endpoints into
	// one node (self-loop, degree +2) and let town nodes swallow 3+ endpoints (degree >= 3 ->
	// junction cut everywhere; live: 23 chains from 24 segments). Exact joints + one 2-unit
	// segment must chain up as ONE run of 3.
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [12, 0]] },
		{ id: "seg-C", coordinates: [[12, 0], [22, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 1, "a segment shorter than the gap eps must not self-merge and fragment the way");
	assert.equal(chains[0].length, 3);
	assert.deepEqual(chains[0].map((e) => e.id), ["seg-A", "seg-B", "seg-C"]);
});

check("branch + gap combined: three free ends within 7 of each other -> exactly one bridge (nearest pair), third stays free", () => {
	// A true Y-branch drawn with small gaps (no exact shared vertex): X's right end (30,0),
	// Y's left end (33,0) and Z's bottom end (31,5) are pairwise within 7 (3 / ~5.10 / ~5.39).
	// Gap bridging must merge ONLY the nearest pair (X-Y, distance 3); after that merge both
	// joined ends are interior, so Z cannot bridge anywhere and stays its own chain.
	const segments = [
		{ id: "seg-X", coordinates: [[0, 0], [30, 0]] },
		{ id: "seg-Y", coordinates: [[33, 0], [60, 0]] },
		{ id: "seg-Z", coordinates: [[31, 5], [31, 40]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 2, "exactly one bridge: nearest pair merges, third end stays free");
	const idsBySize = chains.map((c) => c.map((e) => e.id)).sort((a, b) => b.length - a.length);
	assert.deepEqual(idsBySize[0], ["seg-X", "seg-Y"]);
	assert.deepEqual(idsBySize[1], ["seg-Z"]);
});

check("closed ring of 4 segments -> terminates, every segment used exactly once, chains connect end-to-start", () => {
	// Square ring: (0,0)->(10,0)->(10,10)->(0,10)->(0,0). Every joint has degree 2 (no open end,
	// no branch) -- this is the pure-loop case (Pass 2 in buildWayLabelChains): no Grad-1 start
	// exists, so walkFrom must still terminate by re-consuming the starting segment via `used`
	// rather than looping forever back to it.
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [10, 10]] },
		{ id: "seg-C", coordinates: [[10, 10], [0, 10]] },
		{ id: "seg-D", coordinates: [[0, 10], [0, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 1, "a closed ring with no branch has exactly one chain");
	assert.equal(chains[0].length, 4, "all four segments end up in that one chain");
});

check("wayLabelHitTest: point inside a single rect -> that entry", () => {
	const register = [
		{ left: 10, top: 10, right: 50, bottom: 30, wikiKey: "letta", name: "Letta" },
	];
	const hit = wayLabelHitTest(register, { x: 20, y: 20 });
	assert.equal(hit && hit.wikiKey, "letta");
});

check("wayLabelHitTest: point outside every rect -> null", () => {
	const register = [
		{ left: 10, top: 10, right: 50, bottom: 30, wikiKey: "letta", name: "Letta" },
	];
	assert.equal(wayLabelHitTest(register, { x: 200, y: 200 }), null);
});

check("wayLabelHitTest: empty register -> null", () => {
	assert.equal(wayLabelHitTest([], { x: 20, y: 20 }), null);
	assert.equal(wayLabelHitTest(undefined, { x: 20, y: 20 }), null);
});

check("wayLabelHitTest: overlapping rects -> LAST entry wins (drawn on top)", () => {
	const register = [
		{ left: 0, top: 0, right: 100, bottom: 100, wikiKey: "unten", name: "Unten" },
		{ left: 40, top: 40, right: 60, bottom: 60, wikiKey: "oben", name: "Oben" },
	];
	// Point inside BOTH rects -> the later (topmost-drawn) entry must win.
	assert.equal(wayLabelHitTest(register, { x: 50, y: 50 }).wikiKey, "oben");
	// Point inside only the first (bottom) rect -> that one wins.
	assert.equal(wayLabelHitTest(register, { x: 10, y: 10 }).wikiKey, "unten");
});

check("wayLabelHitTest: rect boundary is inclusive on all four edges", () => {
	const register = [{ left: 10, top: 10, right: 50, bottom: 30, wikiKey: "kante", name: "Kante" }];
	assert.equal(wayLabelHitTest(register, { x: 10, y: 20 }).wikiKey, "kante", "left edge");
	assert.equal(wayLabelHitTest(register, { x: 50, y: 20 }).wikiKey, "kante", "right edge");
	assert.equal(wayLabelHitTest(register, { x: 30, y: 10 }).wikiKey, "kante", "top edge");
	assert.equal(wayLabelHitTest(register, { x: 30, y: 30 }).wikiKey, "kante", "bottom edge");
});

console.log(`${passed}/23 passed`);

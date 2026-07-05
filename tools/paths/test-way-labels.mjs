// Unit test (Node, no build) for the pure way-label helpers in
// js/map-features/map-features-way-labels.js:
//   - wayLabelEndpointKey(coord): rounds [x,y] to a stable string key (join tolerance).
//   - buildWayLabelChains(segments): endpoint-adjacency walk that stitches same-way
//     segments into ordered chains (continuous label runs), CUTTING at junctions
//     (degree > 2) so a chain never crosses a branch point.
//   - computeWayLabelIntervalOffsets(totalLenPx, intervalPx, textLenPx): center offsets
//     (px along the chain) for placing repeated labels at a fixed screen interval.
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

const sandbox = new Function(`
	${extractFunction(wayLabelsSource, "wayLabelEndpointKey")}
	${extractFunction(wayLabelsSource, "buildWayLabelChains")}
	${extractFunction(wayLabelsSource, "computeWayLabelIntervalOffsets")}
	return { wayLabelEndpointKey, buildWayLabelChains, computeWayLabelIntervalOffsets };
`)();
const { wayLabelEndpointKey, buildWayLabelChains, computeWayLabelIntervalOffsets } = sandbox;

let passed = 0;
function check(label, fn) {
	fn();
	passed++;
	console.log(`ok ${label}`);
}

// Asserts the invariants any buildWayLabelChains output must hold, regardless of how
// segments were partitioned into chains: every segment id from the input appears
// exactly once across all chains, and consecutive entries within a chain connect
// end-to-start (using the same rounding tolerance as wayLabelEndpointKey).
function assertChainsWellFormed(chains, segments) {
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
			assert.equal(
				wayLabelEndpointKey(prevEnd),
				wayLabelEndpointKey(curStart),
				`chain entries ${prev.id} -> ${cur.id} must connect end-to-start`
			);
		}
	});
	const expectedIds = segments.map((s) => s.id).slice().sort();
	const actualIds = seenIds.slice().sort();
	assert.deepEqual(actualIds, expectedIds, "every segment must appear exactly once across all chains");
}

check("endpoint key rounds coordinates to a stable string", () => {
	assert.equal(wayLabelEndpointKey([12.34567, 8.90123]), wayLabelEndpointKey([12.345669999, 8.901230001]));
	assert.notEqual(wayLabelEndpointKey([12.3456, 8.9012]), wayLabelEndpointKey([12.3457, 8.9012]));
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

check("segments A-B and C-D with a gap -> two chains", () => {
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [20, 0]] },
		{ id: "seg-C", coordinates: [[100, 0], [110, 0]] },
		{ id: "seg-D", coordinates: [[110, 0], [120, 0]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	assert.equal(chains.length, 2);
	const idsPerChain = chains.map((chain) => chain.map((e) => e.id).sort()).sort();
	assert.deepEqual(idsPerChain, [["seg-A", "seg-B"], ["seg-C", "seg-D"]]);
});

check("three segments meeting at one point (degree-3 junction) -> junction cuts, no chain crosses it", () => {
	// Star: seg-A (0,0)->(10,0), seg-B (10,0)->(20,0), seg-C (10,0)->(10,10) all touch (10,0) at degree 3.
	const segments = [
		{ id: "seg-A", coordinates: [[0, 0], [10, 0]] },
		{ id: "seg-B", coordinates: [[10, 0], [20, 0]] },
		{ id: "seg-C", coordinates: [[10, 0], [10, 10]] },
	];
	const chains = buildWayLabelChains(segments);
	assertChainsWellFormed(chains, segments);
	// Invariant: the junction point (10,0) must never appear as an INTERNAL point of any
	// chain (i.e. no chain has a segment continuing past it) -- every chain that touches
	// the junction must have it only at a chain END (first or last entry's outer endpoint).
	const junctionKey = wayLabelEndpointKey([10, 0]);
	chains.forEach((chain) => {
		for (let i = 1; i < chain.length; i += 1) {
			const prev = chain[i - 1];
			const prevCoords = segments.find((s) => s.id === prev.id).coordinates;
			const prevEnd = prev.reversed ? prevCoords[0] : prevCoords[prevCoords.length - 1];
			// An internal joint equal to the junction point would mean the chain crossed the
			// junction (walked straight through instead of cutting) -- only allowed if this
			// is genuinely the last connecting joint, which by construction of this fixture
			// (all three segments meet at ONE junction) can't happen for a well-cut result.
			assert.notEqual(wayLabelEndpointKey(prevEnd), junctionKey, "chain must not walk through the junction internally");
		}
	});
	// Each segment appears exactly once (already checked by assertChainsWellFormed), and since
	// no two of these three segments can be joined without crossing the shared junction, every
	// segment must end up as its own single-entry chain.
	assert.equal(chains.length, 3);
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

console.log(`${passed}/9 passed`);

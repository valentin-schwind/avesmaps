// Unit test (Node, no build) for the client river-flow helpers (Flussrichtung spec §4):
//   - getRiverFlowTimeFactors (js/routing/route-graph-routing.js): per-direction time
//     factors for the graph edges (forward = stored drawing order).
//   - getRouteSegmentUpstreamFactor (js/routing/route-node.js): upstream factor for the
//     plan display recomputation (traversal from buildOrientedRouteSegmentEndpoints).
// Run: node tools/routing/test-client-route-flow.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

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

const graphSource = readFileSync(path.join(repoRoot, "js", "routing", "route-graph-routing.js"), "utf8");
const nodeSource = readFileSync(path.join(repoRoot, "js", "routing", "route-node.js"), "utf8");
const getRiverFlowTimeFactors = new Function(`${extractFunction(graphSource, "getRiverFlowTimeFactors")}; return getRiverFlowTimeFactors;`)();
const getRouteSegmentUpstreamFactor = new Function(`${extractFunction(nodeSource, "getRouteSegmentUpstreamFactor")}; return getRouteSegmentUpstreamFactor;`)();
const resolveRouteSegmentFlowFactor = new Function(
	`${extractFunction(nodeSource, "getRouteSegmentUpstreamFactor")}; ${extractFunction(nodeSource, "resolveRouteSegmentFlowFactor")}; return resolveRouteSegmentFlowFactor;`
)();

// --- getRiverFlowTimeFactors ---
assert.equal(getRiverFlowTimeFactors({ flow: { dir: "forward" } }, "Weg"), null, "non-river ignored");
assert.equal(getRiverFlowTimeFactors({}, "Flussweg"), null, "missing flow ignored");
assert.equal(getRiverFlowTimeFactors({ flow: { factor: 2 } }, "Flussweg"), null, "missing dir ignored");
assert.deepEqual(getRiverFlowTimeFactors({ flow: { dir: "forward" } }, "Flussweg"),
	{ forwardFactor: 1, backwardFactor: 1.5 }, "forward default");
assert.deepEqual(getRiverFlowTimeFactors({ flow: { dir: "reverse", factor: 2 } }, "Flussweg"),
	{ forwardFactor: 2, backwardFactor: 1 }, "reverse custom factor");
assert.deepEqual(getRiverFlowTimeFactors({ flow: { dir: "forward", factor: 9 } }, "Flussweg"),
	{ forwardFactor: 1, backwardFactor: 3 }, "factor clamped");

// --- getRouteSegmentUpstreamFactor ---
const coords = [[0, 0], [10, 0]];
const riverSegment = (flow) => ({ properties: { flow }, geometry: { coordinates: coords } });
const forwardTraversal = { start: coords[0], end: coords[1] };
const reverseTraversal = { start: coords[1], end: coords[0] };
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), forwardTraversal, "Flussweg"), 1, "downstream forward");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), reverseTraversal, "Flussweg"), 1.5, "upstream default");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "reverse", factor: 2 }), forwardTraversal, "Flussweg"), 2, "upstream reverse-dir");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "reverse" }), reverseTraversal, "Flussweg"), 1, "downstream reverse-dir");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward", factor: 9 }), reverseTraversal, "Flussweg"), 3, "clamped");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), null, "Flussweg"), 1, "no orientation -> neutral");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), reverseTraversal, "Seeweg"), 1, "non-river neutral");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment(undefined), reverseTraversal, "Flussweg"), 1, "no flow neutral");

// --- resolveRouteSegmentFlowFactor ---
// Explicit server-shipped factor (flow_time_factor) takes priority over the derived
// flow.dir + orientation calculation used for client-engine segments.
assert.equal(
	resolveRouteSegmentFlowFactor({ properties: { flow_time_factor: 2 } }, null, "Flussweg"),
	2,
	"explicit factor preferred"
);
assert.equal(
	resolveRouteSegmentFlowFactor({ properties: { flow_time_factor: 9 } }, null, "Flussweg"),
	3,
	"explicit factor clamped"
);
assert.equal(
	resolveRouteSegmentFlowFactor(
		{ properties: { flow_time_factor: 1, flow: { dir: "forward" } } },
		reverseTraversal,
		"Flussweg"
	),
	1,
	"explicit neutral factor preferred over derived upstream"
);
assert.equal(
	resolveRouteSegmentFlowFactor(
		{ properties: { flow: { dir: "forward" } }, geometry: { coordinates: coords } },
		reverseTraversal,
		"Flussweg"
	),
	1.5,
	"falls back to derived factor when flow_time_factor absent"
);
assert.equal(
	resolveRouteSegmentFlowFactor(
		{ properties: { flow_time_factor: 0, flow: { dir: "forward" } }, geometry: { coordinates: coords } },
		reverseTraversal,
		"Flussweg"
	),
	1.5,
	"falls back to derived factor when flow_time_factor is 0 (invalid)"
);
assert.equal(
	resolveRouteSegmentFlowFactor(
		{ properties: { flow_time_factor: "abc", flow: { dir: "forward" } }, geometry: { coordinates: coords } },
		reverseTraversal,
		"Flussweg"
	),
	1.5,
	"falls back to derived factor when flow_time_factor is non-numeric"
);

console.log("test-client-route-flow: all assertions passed");

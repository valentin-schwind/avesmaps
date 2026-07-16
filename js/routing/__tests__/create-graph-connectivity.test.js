const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// route-graph-routing.js and its deps are browser globals (no module system) -- load the REAL sources
// into this realm so the test exercises the shipped code. Mirrors js/review/__tests__/path-transport-options.test.js.
global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../../map-features/map-features-location-editing.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// A--B: a normal Weg -> an edge exists.
// C: isolated, no path touches it -> stays disconnected.
// D--E: a river whose recorded allowed_transports is an explicit empty list ("unbefahrbar", e.g. a
// river source too wild to travel). A DRAWN path is an existing connection regardless of whether any
// transport may use it: the tool hunts MISSING ways, not impassable ones (Owner, 2026-07-16).
// F=G: two separate paths between the same pair -> 2 edges but only 1 neighbour (the way COUNT must
// not collapse to the neighbour count -- that distinction drives the sparse-crossing marker).
locationData = [loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0), loc("F", 50, 0), loc("G", 60, 0)];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Flussweg", [30, 0], [40, 0], { transport_domain: "river", allowed_transports: [] }),
	path_("p3", "Weg", [50, 0], [60, 0]),
	path_("p4", "Pfad", [50, 0], [60, 0]),
];

const graph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });

assert.ok(Object.keys(graph.A).length > 0, "A connects to B");
assert.ok(Object.keys(graph.B).length > 0, "B connects to A");
assert.strictEqual(Object.keys(graph.C).length, 0, "C is isolated");
assert.strictEqual(countGraphNodePathEdges(graph, "D"), 1, "D: an unbefahrbar river still counts as a drawn connection");
assert.strictEqual(countGraphNodePathEdges(graph, "E"), 1, "E: an unbefahrbar river still counts as a drawn connection");
assert.strictEqual(countGraphNodePathEdges(graph, "C"), 0, "C has no ways at all");
assert.strictEqual(syntheticPathSegments.size, 0, "skipSyntheticConnections: no Querfeldein edges added, C stays isolated");

// Way COUNT vs neighbour count: F and G are joined by two distinct paths.
assert.strictEqual(Object.keys(graph.F).length, 1, "F has a single neighbour (G)");
assert.strictEqual(countGraphNodePathEdges(graph, "F"), 2, "F carries TWO ways even though both lead to G");
assert.strictEqual(countGraphNodePathEdges(graph, "G"), 2, "G carries TWO ways even though both lead to F");

console.log("create-graph connectivity tests passed");

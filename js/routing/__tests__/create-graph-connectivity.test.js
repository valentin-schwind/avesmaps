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
loadBrowserScript("../../review/review-paths.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// A--B: a normal Weg (no recorded restriction) -> an edge exists in the "all transports" graph.
// C: isolated, no path touches it -> stays disconnected.
// D--E: a Weg whose recorded allowed_transports is an explicit empty list ("unbefahrbar") -- the spec's
// "Kanten-Randfall": still counts as disconnected even though a path is drawn between them.
locationData = [loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0)];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Weg", [30, 0], [40, 0], { transport_domain: "land", allowed_transports: [] }),
];

const graph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });

assert.ok(Object.keys(graph.A).length > 0, "A connects to B");
assert.ok(Object.keys(graph.B).length > 0, "B connects to A");
assert.strictEqual(Object.keys(graph.C).length, 0, "C is isolated");
assert.strictEqual(Object.keys(graph.D).length, 0, "D: unbefahrbar path -> no edge (Kanten-Randfall)");
assert.strictEqual(Object.keys(graph.E).length, 0, "E: unbefahrbar path -> no edge (Kanten-Randfall)");
assert.strictEqual(syntheticPathSegments.size, 0, "skipSyntheticConnections: no Querfeldein edges added, C stays isolated");

console.log("create-graph connectivity tests passed");

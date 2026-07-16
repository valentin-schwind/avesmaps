const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
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
loadBrowserScript("../../map-features/map-features-location-lookup.js");
loadBrowserScript("../../map-features/map-features-powerlines.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y, locationType = "dorf") => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType });
const crossing = (name, x, y) => loc(name, x, y, "crossing");
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// --- unconnected ---
// A--B connected by a path. C isolated (no path, no powerline) -> unconnected. D--E joined by an
// unbefahrbar river (a river source): DRAWN, so NOT unconnected (Owner 2026-07-16). F has no path
// but IS a powerline endpoint -> not unconnected.
// --- sparse crossings (<= 2 ways) ---
// K0: crossing, no ways at all      -> sparse (and unconnected)
// K1: crossing, 1 way               -> sparse
// K2: crossing, 2 ways              -> sparse
// K3: crossing, 3 ways              -> NOT sparse (a real crossing)
locationData = [
	loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0), loc("F", 50, 0),
	crossing("K0", 100, 0),
	crossing("K1", 110, 0), loc("K1end", 111, 0),
	crossing("K2", 120, 0), loc("K2a", 121, 0), loc("K2b", 122, 0),
	crossing("K3", 130, 0), loc("K3a", 131, 0), loc("K3b", 132, 0), loc("K3c", 133, 0),
];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Flussweg", [30, 0], [40, 0], { transport_domain: "river", allowed_transports: [] }),
	path_("k1a", "Weg", [110, 0], [111, 0]),
	path_("k2a", "Weg", [120, 0], [121, 0]),
	path_("k2b", "Weg", [120, 0], [122, 0]),
	path_("k3a", "Weg", [130, 0], [131, 0]),
	path_("k3b", "Weg", [130, 0], [132, 0]),
	path_("k3c", "Weg", [130, 0], [133, 0]),
];
powerlineData = [{ properties: { from_public_id: "pid-F", to_public_id: "pid-A" } }];
locationConnectivityIndex = null;

const unconnected = getUnconnectedLocationPublicIds();
assert.deepStrictEqual([...unconnected].sort(), ["pid-C", "pid-K0"], "only genuinely way-less, powerline-less nodes");
assert.strictEqual(unconnected.has("pid-D"), false, "a drawn but unbefahrbar river is a connection");
assert.strictEqual(unconnected.has("pid-E"), false, "a drawn but unbefahrbar river is a connection");
assert.strictEqual(unconnected.has("pid-F"), false, "powerline endpoint counts as connected");

const sparse = getSparseCrossingPublicIds();
assert.deepStrictEqual([...sparse].sort(), ["pid-K0", "pid-K1", "pid-K2"], "crossings with <= 2 ways");
assert.strictEqual(sparse.has("pid-K3"), false, "a 3-way crossing is a real crossing");
assert.strictEqual(sparse.has("pid-C"), false, "sparse marks CROSSINGS only, never settlements");

// --- cache ---
assert.strictEqual(getUnconnectedLocationPublicIds(), unconnected, "cached: same Set instance until invalidated");
assert.strictEqual(getSparseCrossingPublicIds(), sparse, "cached: same Set instance until invalidated");

locationConnectivityIndex = null;
const rebuilt = getUnconnectedLocationPublicIds();
assert.notStrictEqual(rebuilt, unconnected, "invalidation forces a fresh index");
assert.deepStrictEqual([...rebuilt].sort(), ["pid-C", "pid-K0"]);

console.log("location connectivity index tests passed");

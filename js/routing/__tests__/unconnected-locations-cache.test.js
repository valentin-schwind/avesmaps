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
loadBrowserScript("../../review/review-paths.js");
loadBrowserScript("../../map-features/map-features-powerlines.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// A--B connected by path. C isolated (no path, no powerline) -> unconnected. D--E connected only by an
// unbefahrbar path -> both unconnected. F is isolated by path but IS a powerline endpoint -> NOT unconnected.
locationData = [loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0), loc("F", 50, 0)];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Weg", [30, 0], [40, 0], { transport_domain: "land", allowed_transports: [] }),
];
powerlineData = [{ properties: { from_public_id: "pid-F", to_public_id: "pid-A" } }];
unconnectedLocationPublicIds = null;

const first = getUnconnectedLocationPublicIds();
assert.deepStrictEqual([...first].sort(), ["pid-C", "pid-D", "pid-E"]);

const second = getUnconnectedLocationPublicIds();
assert.strictEqual(second, first, "cached: same Set instance until invalidated");

unconnectedLocationPublicIds = null;
const third = getUnconnectedLocationPublicIds();
assert.notStrictEqual(third, first, "invalidation forces a fresh Set");
assert.deepStrictEqual([...third].sort(), ["pid-C", "pid-D", "pid-E"]);

console.log("unconnected-locations cache tests passed");

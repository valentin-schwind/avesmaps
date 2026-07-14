const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// review-paths.js and its deps are browser globals (no module system), so the REAL sources are loaded
// into this realm -- the test exercises the shipped code, not a copy of the transport tables. Both
// files are declaration-only, the stubs just satisfy config.js's top-level window/document touches.
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
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../review-paths.js");

const desertPath = (properties) => ({ properties: { feature_subtype: "Wuestenpfad", ...properties } });

// The Wuestenpfad rule: the carriage is not offered at all, every other land transport is.
const desertOptions = getTransportOptionsForPathSubtype("Wuestenpfad");
assert.ok(!desertOptions.includes("horseCarriage"), "no carriage on a desert path");
assert.deepStrictEqual(desertOptions, ["caravan", "groupFoot", "lightWalker", "groupHorse", "lightRider"]);

// A desert path with no list recorded: everything but the carriage is pre-checked.
assert.deepStrictEqual(getPathAllowedTransports(desertPath({})), desertOptions);

// The 26 rows a one-off admin repair left with an empty list and NO transport_domain: that shape was
// never saved by this form, so it is treated as "nothing recorded" -- the dialog offers the defaults
// again instead of showing an all-unchecked form that would save the path as impassable.
assert.deepStrictEqual(getPathAllowedTransports(desertPath({ allowed_transports: [] })), desertOptions);

// A list the form DID save (it always writes the pair) stays authoritative, empty list included.
assert.deepStrictEqual(getPathAllowedTransports(desertPath({ transport_domain: "land", allowed_transports: [] })), []);
assert.deepStrictEqual(
	getPathAllowedTransports(desertPath({ transport_domain: "land", allowed_transports: ["caravan", "groupFoot"] })),
	["caravan", "groupFoot"]
);

// A stored carriage (from an older save) is still dropped for a desert path.
assert.deepStrictEqual(
	getPathAllowedTransports(desertPath({ transport_domain: "land", allowed_transports: ["caravan", "horseCarriage"] })),
	["caravan"]
);

// Rivers keep their own domain: the upper Raller allows nothing, the lower one only the barge.
const river = (properties) => ({ properties: { feature_subtype: "Flussweg", ...properties } });
assert.deepStrictEqual(getPathAllowedTransports(river({})), ["riverSailer", "riverBarge"]);
assert.deepStrictEqual(getPathAllowedTransports(river({ transport_domain: "river", allowed_transports: [] })), []);
assert.deepStrictEqual(getPathAllowedTransports(river({ transport_domain: "river", allowed_transports: ["riverBarge"] })), ["riverBarge"]);

console.log("path transport option tests passed");

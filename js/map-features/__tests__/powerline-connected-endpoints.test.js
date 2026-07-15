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
loadBrowserScript("../map-features-powerlines.js");

powerlineData = [
	{ properties: { from_public_id: "pid-A", to_public_id: "pid-C" } },
	{ properties: { from_public_id: "pid-D" } },
];

const endpoints = getPowerlineConnectedLocationPublicIds();
assert.deepStrictEqual([...endpoints].sort(), ["pid-A", "pid-C", "pid-D"]);
assert.strictEqual(endpoints.has("pid-B"), false, "pid-B is not a powerline endpoint");

console.log("powerline endpoint helper tests passed");

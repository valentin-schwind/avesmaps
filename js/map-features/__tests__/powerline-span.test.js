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
loadBrowserScript("../map-features-location-lookup.js");
loadBrowserScript("../map-features-powerlines.js");

const segment = (name, from, to) => ({ properties: { name, from_public_id: from, to_public_id: to } });
const place = (publicId, name) => ({ publicId, name, locationType: "dorf", marker: null, location: null });
const crossing = (publicId) => ({ publicId, name: "Kreuzung-1", locationType: CROSSING_LOCATION_TYPE, marker: null, location: null });

// Kette: Ewiges Eis -- K1 -- K2 -- Suedmeer, drei gleichnamige Segmente.
locationMarkers = [place("eis", "Ewiges Eis"), crossing("k1"), crossing("k2"), place("meer", "Südmeer")];
powerlineData = [
	segment("Basiliuslinie", "eis", "k1"),
	segment("Basiliuslinie", "k1", "k2"),
	segment("Basiliuslinie", "k2", "meer"),
];
assert.deepStrictEqual(
	getPowerlineSpanEndpointIds(powerlineData[1]),
	{ fromPublicId: "eis", toPublicId: "meer" },
	"middle segment must report the span of the WHOLE line"
);

// Kreuzungen an den Enden werden uebersprungen.
locationMarkers = [crossing("k0"), place("gareth", "Gareth"), place("punin", "Punin"), crossing("k9")];
powerlineData = [
	segment("Konzilslinie", "k0", "gareth"),
	segment("Konzilslinie", "gareth", "punin"),
	segment("Konzilslinie", "punin", "k9"),
];
assert.deepStrictEqual(
	getPowerlineSpanEndpointIds(powerlineData[0]),
	{ fromPublicId: "gareth", toPublicId: "punin" },
	"bare crossings at the chain ends are skipped inward"
);

// Namenlose Linie bildet keine Gruppe.
locationMarkers = [place("a", "A"), place("b", "B")];
powerlineData = [segment("", "a", "b")];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "an unnamed powerline has no span");

// Verzweigung (drei Enden) -> lieber keine Zeile als eine falsche.
locationMarkers = [place("m", "Mitte"), place("x", "X"), place("y", "Y"), place("z", "Z")];
powerlineData = [
	segment("Fächer der Macht", "m", "x"),
	segment("Fächer der Macht", "m", "y"),
	segment("Fächer der Macht", "m", "z"),
];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "a branching line reports no span");

// Nur Kreuzungen -> kein benennbares Ende.
locationMarkers = [crossing("k1"), crossing("k2")];
powerlineData = [segment("Namenlos-Kette", "k1", "k2")];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "a chain of bare crossings reports no span");

console.log("powerline span tests passed");

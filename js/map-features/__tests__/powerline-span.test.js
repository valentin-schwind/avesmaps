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

// Verzweigung (drei Enden): KEIN Zwei-Enden-Span -- aber die Topologie kennt alle drei Enden.
// Am Live-Bestand sind 6 von 61 Namen verzweigt, darunter Basiliuslinie (4 Enden) und
// Yaquirlinie (6). Eine erste Fassung gab hier gar nichts zurueck und schwieg damit ausgerechnet
// die groessten Linien tot -- 44 von 162 Segmenten.
locationMarkers = [place("m", "Mitte"), place("x", "X"), place("y", "Y"), place("z", "Z")];
powerlineData = [
	segment("Fächer der Macht", "m", "x"),
	segment("Fächer der Macht", "m", "y"),
	segment("Fächer der Macht", "m", "z"),
];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "a branching line has no two-end span");
const branch = getPowerlineTopology(powerlineData[0]);
assert.deepStrictEqual([...branch.endpointIds].sort(), ["x", "y", "z"], "all three ends must be reported");
assert.deepStrictEqual(branch.stationIds, ["m"], "the hub is a station, not an end");
assert.strictEqual(branch.segmentCount, 3);
assert.strictEqual(branch.isRing, false);

// Ring (kein einziges Ende) -- Hexenband(-schleife) im Live-Bestand. Ohne Enden traegt nur die
// Stationsliste, deshalb darf sie hier NICHT leer sein.
locationMarkers = [place("a", "A"), place("b", "B"), place("c", "C")];
powerlineData = [
	segment("Hexenband(-schleife)", "a", "b"),
	segment("Hexenband(-schleife)", "b", "c"),
	segment("Hexenband(-schleife)", "c", "a"),
];
const ring = getPowerlineTopology(powerlineData[0]);
assert.strictEqual(ring.isRing, true, "a closed loop must be recognised as a ring");
assert.deepStrictEqual(ring.endpointIds, [], "a ring has no ends");
assert.deepStrictEqual([...ring.stationIds].sort(), ["a", "b", "c"], "a ring is carried by its stations");
assert.strictEqual(ring.segmentCount, 3);

// Nur Kreuzungen -> kein benennbares Ende.
locationMarkers = [crossing("k1"), crossing("k2")];
powerlineData = [segment("Namenlos-Kette", "k1", "k2")];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "a chain of bare crossings reports no span");

console.log("powerline span tests passed");

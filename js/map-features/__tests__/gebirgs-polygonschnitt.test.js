"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../map-features-ecosystem-height-render.js"), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("\tfunction nachbarnVon(area)");
const funktion = source.slice(start, source.indexOf("\n\t}", start) + 3);
const polygon = (coordinates) => ({ type: "Polygon", coordinates });
const a = { public_id: "a", bounds: { min_x: 0, min_y: 0, max_x: 10, max_y: 10 },
	geometry: polygon([[[0, 0], [10, 0], [0, 10], [0, 0]]]) };
const b = { public_id: "b", bounds: a.bounds,
	geometry: polygon([[[10, 10], [10, 1], [1, 10], [10, 10]]]) };
const c = { public_id: "c", bounds: a.bounds,
	geometry: polygon([[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]) };
const d = { public_id: "d", bounds: a.bounds,
	geometry: polygon([[[10, 0], [10, 10], [0, 10], [10, 0]]]) };
let areas = [a, b, c, d];
const context = vm.createContext({
	window: { polygonClipping: require("../../third-party/polygon-clipping.umd.min.js") },
	topographyAreas: () => areas, geometrieVon: (area) => area.geometry,
});
vm.runInContext("let nachbarSchnittCache = new WeakMap();\n" + funktion, context);
assert.deepEqual(Array.from(context.nachbarnVon(a), (n) => n.area.public_id), ["c"],
	"Gleiche Rasterrechtecke und bloßer Randkontakt sind keine Nachbarschaft.");
const loch = { ...a, geometry: polygon([
	[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
	[[0.5, 0.5], [4, 0.5], [4, 4], [0.5, 4], [0.5, 0.5]],
]) };
areas = [loch, c];
assert.equal(context.nachbarnVon(loch).length, 0, "Ein Gebirge im Polygonloch bleibt unabhängig.");
console.log("OK: Polygonschnitt statt Rechteck, Randkontakt und Löcher.");

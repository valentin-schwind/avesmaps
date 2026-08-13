// pointInGeometry traegt in Sitzung 2 die Siedlung-Flaeche-Zuordnung. Das Modul ist alt und
// bewaehrt; dieser Test sichert genau die drei Eigenschaften, auf die sich der Zuordnungslauf
// verlaesst -- nicht mehr.
const assert = require("node:assert");
const { pointInGeometry } = require("../map-features-point-in-polygon.js");

const quadrat = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
assert.strictEqual(pointInGeometry([5, 5], quadrat), true, "innen");
assert.strictEqual(pointInGeometry([15, 5], quadrat), false, "aussen");

// 💣 Zwei getrennte Teile sind EINE Flaeche -- ein Ort im zweiten Teil gehoert dazu. Genau das
// unterscheidet MultiPolygon von Polygon, und die Haelfte der Landschaftsflaechen ist mehrteilig.
const zweiTeile = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
	],
};
assert.strictEqual(pointInGeometry([25, 25], zweiTeile), true, "zweiter Teil");
assert.strictEqual(pointInGeometry([15, 15], zweiTeile), false, "zwischen den Teilen");

// 💣 x und y NICHT vertauschen. GeoJSON ist [x, y]; Leaflet spricht [lat, lng] = [y, x], und
// dieser Tausch ist im Haus schon mehrfach danebengegangen (AGENTS.md §5). Ein laengliches
// Rechteck faengt die Verwechslung, ein Quadrat nie.
const breit = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 5], [0, 5], [0, 0]]] };
assert.strictEqual(pointInGeometry([50, 2], breit), true, "x lang, y kurz");
assert.strictEqual(pointInGeometry([2, 50], breit), false, "vertauscht faellt heraus");

console.log("point-in-geometry: OK");

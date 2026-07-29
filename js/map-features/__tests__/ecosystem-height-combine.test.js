// Unit tests for combining the height fields of SEVERAL areas (V8).
//
// 🔴 The rule under test, in one line: areas SUM, and one peak window over all of them keeps every
// named peak reading its own number. No containment test, no tree, no parent/child windowing --
// Owner decision 2026-07-28: "sie brauchen sich nicht zu schachteln/zu fenstern. die überlappung und
// verschmelzung zu einem zug ist ok."
//
// Run: node js/map-features/__tests__/ecosystem-height-combine.test.js

const assert = require("assert");

// Handed over deliberately, as browser globals are (164 <script> tags, one scope).
const { distanceToEcosystemEdge, ecosystemGeometryBounds, ecosystemGeometryArea } =
	require("../map-features-ecosystem-geometry.js");
const { pointInGeometry } = require("../map-features-point-in-polygon.js");
const heightField = require("../map-features-ecosystem-height-field.js");
global.distanceToEcosystemEdge = distanceToEcosystemEdge;
global.ecosystemGeometryBounds = ecosystemGeometryBounds;
global.ecosystemGeometryArea = ecosystemGeometryArea;
global.pointInGeometry = pointInGeometry;
global.buildEcosystemPeakWindow = heightField.buildEcosystemPeakWindow;
global.buildEcosystemHeightField = heightField.buildEcosystemHeightField;
global.sampleEcosystemHeightField = heightField.sampleEcosystemHeightField;

const { buildEcosystemHeightStack, sampleEcosystemHeightStack } =
	require("../map-features-ecosystem-height-combine.js");

const box = (x0, y0, x1, y1) => ({ type: "Polygon",
	coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

// Two ranges that OVERLAP in the strip 80..120 -- the owner's case: they merge into one range.
// The high one is 5000, the low one 3000, and the question the tests answer is what the ground
// does between them.
const high = { public_id: "high", geometry: box(0, 0, 120, 100), geometry_revision: 1 };
const low = { public_id: "low", geometry: box(80, 0, 240, 100), geometry_revision: 1 };
const peaks = [
	{ publicId: "ph", x: 40, y: 50, height: 5000 },
	{ publicId: "pl", x: 200, y: 50, height: 3000 },
];
const stack = buildEcosystemHeightStack([high, low], peaks);
const at = (x, y) => sampleEcosystemHeightStack(stack, x, y);

// 1. 💣 THE assertion: each peak reads its OWN number. Not 8000, not 4200, not 5000 for both.
assert.ok(Math.abs(at(40, 50) - 5000) < 1, `the 5000 peak stays 5000, got ${at(40, 50)}`);
assert.ok(Math.abs(at(200, 50) - 3000) < 1, `the 3000 peak stays 3000, got ${at(200, 50)}`);

// 2. A peak inside the OTHER area's footprint still reads its own number. Move the low peak into
//    the overlap strip: two areas cover it, and it must still be exactly 3000. This is the case
//    that an unwindowed sum would inflate, and the one a containment tree was going to solve.
const overlapped = buildEcosystemHeightStack([high, low], [
	{ publicId: "ph", x: 40, y: 50, height: 5000 },
	{ publicId: "pl", x: 100, y: 50, height: 3000 }]);
const atOverlapped = sampleEcosystemHeightStack(overlapped, 100, 50);
assert.ok(Math.abs(atOverlapped - 3000) < 1,
	`a peak covered by two areas must not be inflated, got ${atOverlapped}`);

// 3. Between the two peaks there is a SADDLE: below both, but clearly above zero. A notch down to
//    nothing would mean two separate mountains, which is what the merge is supposed to avoid.
const saddle = at(120, 50);
assert.ok(saddle < 3000, `the saddle is lower than the lower peak, got ${saddle}`);
assert.ok(saddle > 0, `the saddle is not a notch down to zero, got ${saddle}`);

// 4. No cliff where one area's edge falls inside the other. Crossing the low area's left edge
//    (x = 80) must be no steeper than the surrounding slope, because that area's own field is zero
//    there anyway.
//
// 🪤 Measured against the NEIGHBOURING step, not against a fixed number. The first version compared
// the crossing to an absolute 50 Schritt and failed at 52.7 -- on a perfectly smooth field, because
// a range dropping 5000 over 80 units simply slopes 62 per unit. An absolute threshold tests the
// terrain's steepness, not its smoothness; the second difference is what "cliff" actually means.
const crossing = Math.abs(at(80.5, 50) - at(79.5, 50));
const control = Math.abs(at(78.5, 50) - at(77.5, 50));
assert.ok(crossing < control * 2 + 5,
	`the area edge must not be steeper than the slope around it (crossing ${crossing.toFixed(1)} vs control ${control.toFixed(1)})`);

// 5. Each peak is the local maximum -- the high point does not wander off it.
for (const [px, py] of [[40, 50], [200, 50]]) {
	const here = at(px, py);
	for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
		assert.ok(here >= at(px + dx, py + dy) - 1e-9,
			`peak (${px},${py}) must be the local maximum`);
	}
}

// 6. Outside everything is zero, and an area without any peak stays flat rather than inventing a
//    mountain (see the height field: the noise level is derived from the peaks of that area).
assert.strictEqual(at(400, 400), 0, "empty ground is flat");
const peakless = buildEcosystemHeightStack(
	[{ public_id: "empty", geometry: box(300, 300, 400, 400), geometry_revision: 1 }], []);
assert.strictEqual(sampleEcosystemHeightStack(peakless, 350, 350), 0,
	"an area with no recorded peak stays flat");

// 7. Deterministic: same input, same answer.
assert.strictEqual(at(120, 50),
	sampleEcosystemHeightStack(buildEcosystemHeightStack([high, low], peaks), 120, 50));

// 8. Nesting is NOT a special case -- it is just an overlap where one outline happens to sit inside
//    the other. The inner peak still reads its own height, which is the whole reason the containment
//    tree could be dropped: 3000 + 5000 = 8000 never arises, because the window kills the noise and
//    the separation clamp keeps the other peak's bump from reaching.
const outer = { public_id: "outer", geometry: box(0, 0, 200, 200), geometry_revision: 1 };
const inner = { public_id: "inner", geometry: box(80, 80, 120, 120), geometry_revision: 1 };
const nested = buildEcosystemHeightStack([outer, inner], [
	{ publicId: "po", x: 30, y: 30, height: 5000 },
	{ publicId: "pi", x: 100, y: 100, height: 3000 }]);
const atInner = sampleEcosystemHeightStack(nested, 100, 100);
assert.ok(atInner < 5000, `a nested peak must not stack up to 8000, got ${atInner}`);
assert.ok(Math.abs(atInner - 3000) < 1, `and it reads its own 3000, got ${atInner}`);

// 9. 🔴 EIN GEBIRGE OHNE GIPFEL, ABER MIT EINGETRAGENER MAXIMALHÖHE, KOMMT IN DEN STAPEL (2026-07-29).
//
// 💣 DIESER TEST IST DER EIGENTLICHE. Der Feldbau hat das schon vorher richtig gerechnet -- der Stapel
// hat das fertige Feld aber weggeworfen, weil er „hat Gipfelbuckel?" fragte statt „trägt Gelände bei?".
// Die Feld-Unit-Tests blieben grün (sie rufen den Feldbau direkt), und auf der KARTE wäre nichts
// passiert. Genau die Sorte Fehler, die nur der echte Ladeweg zeigt.
const ohneGipfel = { public_id: "ohne", geometry: box(300, 300, 400, 400), geometry_revision: 1,
	terrain_avg_height: 2000 };
const stapelOhne = buildEcosystemHeightStack([ohneGipfel], []);
assert.strictEqual(stapelOhne.fields.length, 1,
	"eine Fläche mit eingetragener Maximalhöhe gehört in den Stapel, auch ohne Gipfel");
assert.strictEqual(stapelOhne.areaIdsByField[0], "ohne", "und sie wird der richtigen Fläche zugeordnet");
let hoechsterOhne = 0;
for (let y = 305; y < 400; y += 4) {
	for (let x = 305; x < 400; x += 4) {
		hoechsterOhne = Math.max(hoechsterOhne, sampleEcosystemHeightStack(stapelOhne, x, y));
	}
}
assert.ok(hoechsterOhne > 1000, `und sie zeichnet wirklich Gelände (höchster Punkt ${hoechsterOhne.toFixed(0)})`);
for (const [x, y] of [[300, 350], [400, 350], [350, 300], [350, 400]]) {
	assert.strictEqual(sampleEcosystemHeightStack(stapelOhne, x, y), 0,
		`und ihr Rand bleibt exakt 0 bei (${x},${y})`);
}
// Ohne Maximalhöhe bleibt sie draussen -- der Stapel wird nicht mit flachen Feldern geflutet.
assert.strictEqual(buildEcosystemHeightStack(
	[{ public_id: "flach", geometry: box(300, 300, 400, 400), geometry_revision: 1 }], []).fields.length, 0,
	"ohne Gipfel UND ohne Maximalhöhe bleibt die Fläche aus dem Stapel");

console.log("ecosystem-height-combine: all assertions passed");

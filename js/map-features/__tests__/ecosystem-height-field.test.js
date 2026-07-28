// Unit tests for the per-area height field (V8) -- the bump sum ported from
// html/landschaften-modell.html (cellHash :402, level :413, peakWindow :452, rawArea :464,
// buildArea :491).
//
// Run: node js/map-features/__tests__/ecosystem-height-field.test.js

const assert = require("assert");

// Handed over deliberately, as browser globals are (164 <script> tags, one scope). The REAL ones, so
// these tests also prove the height field and the geometry helpers agree about rings, holes and bounds.
const { distanceToEcosystemEdge, ecosystemGeometryBounds } = require("../map-features-ecosystem-geometry.js");
const { pointInGeometry } = require("../map-features-point-in-polygon.js");
global.distanceToEcosystemEdge = distanceToEcosystemEdge;
global.ecosystemGeometryBounds = ecosystemGeometryBounds;
global.pointInGeometry = pointInGeometry;

const { buildEcosystemHeightField, sampleEcosystemHeightField, buildEcosystemPeakWindow,
	ecosystemHeightCellHash } = require("../map-features-ecosystem-height-field.js");

const square = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] };
const area = { public_id: "a", geometry: square, geometry_revision: 1 };

// One area on its own: build its field with a window over its own peaks, and read it back
// through that same window. Task 7 does exactly this, only with the peaks of EVERY area.
function fieldOf(theArea, peaks, options) {
	const window = buildEcosystemPeakWindow(peaks);
	const built = buildEcosystemHeightField(theArea, peaks, window, options);
	return { built, at: (x, y) => sampleEcosystemHeightField(built, x, y, window.sample(x, y)) };
}

// 1. Deterministic: the same seed gives the same field, always.
assert.strictEqual(ecosystemHeightCellHash(7, 0, 3, 4, 1), ecosystemHeightCellHash(7, 0, 3, 4, 1));
assert.notStrictEqual(ecosystemHeightCellHash(7, 0, 3, 4, 1), ecosystemHeightCellHash(7, 0, 3, 4, 2));
const hashes = [];
for (let i = 0; i < 200; i++) {
	hashes.push(ecosystemHeightCellHash(11, 0, i, 3, 1));
}
assert.ok(hashes.every((v) => v >= 0 && v < 1), "the hash stays in [0,1)");
assert.ok(new Set(hashes).size > 190, "the hash does not collapse onto a few values");

// 2. A peak reads its OWN height at its own position -- the window erases the noise there,
//    and it erases it with ZERO SLOPE, so the high point does not wander off the peak.
const one = fieldOf(area, [{ publicId: "p", x: 50, y: 50, height: 3000 }]);
assert.ok(Math.abs(one.at(50, 50) - 3000) < 1, `the peak carries exactly its own height, got ${one.at(50, 50)}`);
assert.ok(one.at(50, 50) >= one.at(52, 50) && one.at(50, 50) >= one.at(50, 52),
	"the peak is the local maximum, not a point next to it");

// 3. The foot is zero: on the boundary nothing is left. This is the invariant that a
//    single-ring distEdge would break.
for (const [x, y] of [[0, 50], [100, 50], [50, 0], [50, 100]]) {
	assert.strictEqual(one.at(x, y), 0, `edge (${x},${y}) is flat`);
}

// 4. A hole is an edge too. A peak near the hole must not lean into it.
const withHole = { type: "Polygon", coordinates: [
	[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
	[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
] };
const holed = fieldOf({ public_id: "b", geometry: withHole, geometry_revision: 1 },
	[{ publicId: "q", x: 30, y: 50, height: 3000 }]);
assert.strictEqual(holed.at(50, 50), 0, "the hole stays at zero");

// 5. A peak without a recorded height must not poison the field with NaN.
const noHeight = fieldOf(area, [{ publicId: "r", x: 50, y: 50, height: null }]);
assert.ok(Number.isFinite(noHeight.at(50, 50)), "missing height stays finite");
assert.ok(noHeight.at(50, 50) > 0, "and it still produces terrain, from the documented placeholder");

// 6. Refining adds DETAIL, it does not grow the mountain.
//
// 🪤 Measured as a MEAN over the area, never at a single point: at one spot the finer field is
// supposed to differ -- that is what the extra levels are for. The first version of this test
// compared one point and failed for the right reason on a correct field.
//
// 💣 The property itself is not cosmetic. oekosystem-instruction.md §4.1: the travel-time factor
// rises monotonically with the number of bumps, so if "how finely do I model this" changed the
// terrain height, the modelling depth alone would shift routes. The prototype damps from the COARSE
// level only and therefore does grow -- measured here at +85% from 1 to 3 levels before this module
// moved the damping behind all levels.
const peak = [{ publicId: "p", x: 50, y: 50, height: 3000 }];
const meanOf = (field) => {
	let sum = 0;
	let count = 0;
	for (let y = 5; y <= 95; y += 5) {
		for (let x = 5; x <= 95; x += 5) {
			sum += field.at(x, y);
			count++;
		}
	}
	return sum / count;
};
const coarseMean = meanOf(fieldOf(area, peak, { levels: 1 }));
const fineMean = meanOf(fieldOf(area, peak, { levels: 4 }));
assert.ok(Math.abs(fineMean - coarseMean) < 0.35 * coarseMean,
	`refining must not inflate the terrain (mean ${coarseMean.toFixed(1)} at 1 level vs ${fineMean.toFixed(1)} at 4)`);

// 7. Two peaks in ONE area keep their separation: neither bump reaches the other, so each
//    still reads its own number. Task 7 asserts the same across areas.
const twoPeaks = fieldOf(area, [
	{ publicId: "hi", x: 30, y: 50, height: 5000 },
	{ publicId: "lo", x: 70, y: 50, height: 3000 }]);
assert.ok(Math.abs(twoPeaks.at(30, 50) - 5000) < 1, `the high peak stays 5000, got ${twoPeaks.at(30, 50)}`);
assert.ok(Math.abs(twoPeaks.at(70, 50) - 3000) < 1, `the low peak stays 3000, it is not lifted, got ${twoPeaks.at(70, 50)}`);

// 8. An area with NO peak stays flat rather than inventing a mountain: the noise level is
//    derived from the peaks of that area, and there is nothing to derive it from.
const peakless = fieldOf(area, []);
assert.strictEqual(peakless.at(50, 50), 0, "an area without a recorded peak stays flat");

// 9. A peak OUTSIDE the area contributes no bump, but still windows the noise -- that split is
//    the whole reason task 7 can hand every area the full peak list.
const outsidePeak = fieldOf(area, [
	{ publicId: "in", x: 50, y: 50, height: 3000 },
	{ publicId: "out", x: 500, y: 500, height: 9000 }]);
assert.ok(Math.abs(outsidePeak.at(50, 50) - 3000) < 1,
	"a far-away peak does not lift this area");
assert.strictEqual(outsidePeak.at(0, 50), 0, "and it does not break the foot invariant either");

// 10. Same input, same field -- no Math.random anywhere in the chain.
const twice = [fieldOf(area, peak).at(37, 61), fieldOf(area, peak).at(37, 61)];
assert.strictEqual(twice[0], twice[1], "deterministic across builds");

// 11. 💣 Two peaks close together somewhere must NOT shrink a lone peak elsewhere.
//
// The separation clamp is what keeps one peak's bump from reaching another. Taken as a GLOBAL minimum
// -- which is what the prototype does, and correct in its world of a few peaks in one area -- a single
// close pair anywhere clamps every radius on the map. Live that is the normal case: 62 peaks, two of
// them duplicate names at nearly the same spot. It showed up in the rendered image as nine bright dots
// on an otherwise flat surface, and no test up to here could see it, because they all used two peaks.
const bigSquare = { type: "Polygon", coordinates: [[[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]]] };
const bigArea = { public_id: "big", geometry: bigSquare, geometry_revision: 1 };
const lonePeak = { publicId: "lone", x: 200, y: 200, height: 4000 };
const alone = fieldOf(bigArea, [lonePeak]);
const withDistantPair = fieldOf(bigArea, [
	lonePeak,
	{ publicId: "twin-a", x: 20, y: 380, height: 1000 },
	{ publicId: "twin-b", x: 21, y: 380, height: 1000 }]);
const radiusAlone = alone.built.peakBumps.find((bump) => bump.x === 200).r;
const radiusWithPair = withDistantPair.built.peakBumps.find((bump) => bump.x === 200).r;
assert.strictEqual(radiusAlone, radiusWithPair,
	`a close pair 250 units away must not shrink the lone peak (${radiusAlone} vs ${radiusWithPair})`);

// And the invariant the clamp exists for still holds: neither twin reaches the other's summit.
const twinA = withDistantPair.built.peakBumps.find((bump) => bump.x === 20);
const twinB = withDistantPair.built.peakBumps.find((bump) => bump.x === 21);
assert.ok(twinA.r < 1 && twinB.r < 1, "the twins clamp each OTHER, tightly");
assert.ok(Math.abs(withDistantPair.at(20, 380) - 1000) < 1, "and each still reads its own height");

// 12. 🔴 DIE ZWEI INVARIANTEN ÜBERSTEHEN ALLE DREI DARSTELLUNGSVERFAHREN.
//
// Warping verschiebt die Abfragestelle, Slope Weighting multipliziert mit e^(-α·|∇h|). Beide dürfen
// weder den Gipfel von seiner Zahl holen noch den Rand von der Null -- sonst bricht die Verschmelzung
// zweier überlappender Flächen, und zwar unsichtbar, weil sie nur an den Nahtstellen auffällt.
for (const method of ["perlin", "warp", "slope"]) {
	const w = buildEcosystemPeakWindow(peak);
	const built = buildEcosystemHeightField(area, peak, w, { method });
	const at = (x, y) => sampleEcosystemHeightField(built, x, y, w.sample(x, y));
	assert.strictEqual(built.method, method, `${method}: das Verfahren kommt am Feld an`);
	assert.ok(Math.abs(at(50, 50) - 3000) < 1,
		`${method}: der Gipfel liest weiter seine eigene Höhe (${at(50, 50)})`);
	for (const [x, y] of [[0, 50], [100, 50], [50, 0], [50, 100]]) {
		assert.strictEqual(at(x, y), 0, `${method}: der Rand bleibt flach bei (${x},${y})`);
	}
	assert.ok(Number.isFinite(at(31, 67)), `${method}: keine NaN im Feld`);
}

// Und ein unbekanntes Verfahren fällt auf das additive Rauschen zurück, statt die Fläche zu verlieren.
const unbekannt = buildEcosystemHeightField(area, peak, buildEcosystemPeakWindow(peak), { method: "gibtsnicht" });
assert.strictEqual(unbekannt.method, "perlin", "ein unbekanntes Verfahren fällt auf perlin zurück");

console.log("ecosystem-height-field: all assertions passed");

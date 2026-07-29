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
	ecosystemHeightCellHash, solveEcosystemNoiseExponent, ecosystemRidgedNoise,
	ECOSYSTEM_NOISE_EXPONENT_MIN, ECOSYSTEM_NOISE_EXPONENT_MAX }
	= require("../map-features-ecosystem-height-field.js");

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

// 8. An area with NO peak AND no recorded maximum height stays flat rather than inventing a
//    mountain: the noise level would be derived from the peaks of that area, and there is
//    nothing to derive it from.
const peakless = fieldOf(area, []);
assert.strictEqual(peakless.at(50, 50), 0, "an area without a recorded peak stays flat");
// 🪤 Eine eingetragene 0 heisst in diesem Modul überall wörtlich „flach" -- auch hier, und sie darf
// nicht als „nichts eingestellt" durchgehen.
assert.strictEqual(fieldOf(area, [], { avgHeight: 0 }).at(50, 50), 0,
	"eine ausdrückliche Maximalhöhe 0 heisst flach, nicht „ableiten“");

// 8b. 🔴 ABER MIT EINGETRAGENER MAXIMALHÖHE ENTSTEHT GELÄNDE, AUCH OHNE GIPFEL (2026-07-29).
//
// Die Fläche trägt seit V8 ihre eigene Höhe; damit ist sie ein zweiter, gleichwertiger Stützpunkt und
// das Gelände nicht mehr „erfunden", sondern erfasst. Live stand „Thasch" (Gebirge, 2.000/500
// eingetragen, kein Gipfel) flach da, obwohl beide Zahlen gesetzt waren -- vom Owner gemeldet.
//
// 💣 Beide Invarianten müssen auch hier stehen, und die Randprobe ist der eigentliche Test: ohne
// Gipfel gibt es kein Gipfelfenster, das irgendetwas dämpft -- was am Rand auf null geht, geht allein
// über den kompakten Träger der Buckel auf null.
for (const method of ["perlin", "warp", "slope", "ridged"]) {
	const ohneGipfel = fieldOf(area, [], { method, avgHeight: 2000 });
	let hoechster = 0;
	for (let y = 2; y < 99; y += 2.7) {
		for (let x = 2; x < 99; x += 2.7) {
			const wert = ohneGipfel.at(x, y);
			assert.ok(Number.isFinite(wert), `${method}: ohne Gipfel keine NaN bei (${x},${y})`);
			hoechster = Math.max(hoechster, wert);
		}
	}
	assert.ok(hoechster > 1000,
		`${method}: ohne Gipfel entsteht wirklich Gelände (höchster Punkt ${hoechster.toFixed(0)})`);
	assert.ok(hoechster <= 2000 * 1.1,
		`${method}: und es trifft die eingetragene Maximalhöhe (${hoechster.toFixed(0)} gegen 2000)`);
	// 💣 `hmax` fällt ohne Gipfel auf die eingetragene Maximalhöhe. Auf `Math.max(...[])` = -Infinity
	// gelassen klemmen Warping und Slope es beide auf 1 -- kein NaN, aber ein Bezug, als wäre der Berg
	// 100 Schritt hoch. Das sähe heil aus und wäre still falsch.
	assert.strictEqual(ohneGipfel.built.hmax, 2000, `${method}: hmax folgt der eingetragenen Höhe`);
	// Der ganze Rand, nicht nur vier Punkte -- ein Sockel stünde überall.
	for (let t = 0; t <= 100; t += 2.5) {
		for (const [x, y] of [[t, 0], [t, 100], [0, t], [100, t]]) {
			assert.strictEqual(ohneGipfel.at(x, y), 0,
				`${method}: ohne Gipfel bleibt der Rand exakt 0 bei (${x},${y})`);
		}
	}
}
// Und die Durchschnittshöhe wirkt dort genauso: mehr Ø hebt die Fläche, das Maximum bleibt stehen.
const flachOhne = fieldOf(area, [], { avgHeight: 2000, meanHeight: 300 });
const vollOhne = fieldOf(area, [], { avgHeight: 2000, meanHeight: 1100 });
assert.ok(meanOf(vollOhne) > 1.5 * meanOf(flachOhne),
	`ohne Gipfel wirkt der Ø-Regler (${meanOf(vollOhne).toFixed(0)} gegen ${meanOf(flachOhne).toFixed(0)})`);

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

// 🔴 UND DIE ZWILLINGE VERSCHMELZEN, statt sich gegenseitig auf nichts zu klemmen.
//
// Bis 2026-07-28 stand hier das Gegenteil: `twinA.r < 1`, „die Zwillinge klemmen einander eng". Das war
// die Regel des Prototyps, und am Livebestand machte sie aus jedem Gipfel einen Stecknadelkopf --
// gemessene Radien 2/1/5/2/0/3/1/3 auf einer 1024 Einheiten breiten Karte. Der Mindestradius kehrt das
// um: zwei Kuppen eine Einheit auseinander SIND ein Massiv und werden auch so gezeichnet.
//
// Der Preis steht im Feldmodul: für dicht stehende Gipfel gilt „jeder liest exakt seine Zahl" nicht
// mehr. Tragbar, weil das Feld Darstellung ist und V11 aus `height_schritt` rechnet.
const twinA = withDistantPair.built.peakBumps.find((bump) => bump.x === 20);
const twinB = withDistantPair.built.peakBumps.find((bump) => bump.x === 21);
assert.ok(twinA.r >= 20 && twinB.r >= 20,
	`die Zwillinge bekommen den Mindestradius statt sich kleinzuklemmen (${twinA.r} / ${twinB.r})`);
// Der EINZELNE Gipfel weit weg liest trotzdem weiter seine eigene Zahl -- ihn erreicht kein fremder
// Buckel, und genau dafür ist der Mindestradius am Randabstand mitgeklemmt.
assert.ok(Math.abs(withDistantPair.at(200, 200) - 4000) < 1,
	`der einzelne Gipfel behält seine 4000 (${withDistantPair.at(200, 200)})`);

// 12. 🔴 DIE ZWEI INVARIANTEN ÜBERSTEHEN ALLE DREI DARSTELLUNGSVERFAHREN.
//
// Warping verschiebt die Abfragestelle, Slope Weighting multipliziert mit e^(-α·|∇h|). Beide dürfen
// weder den Gipfel von seiner Zahl holen noch den Rand von der Null -- sonst bricht die Verschmelzung
// zweier überlappender Flächen, und zwar unsichtbar, weil sie nur an den Nahtstellen auffällt.
for (const method of ["perlin", "warp", "slope", "ridged"]) {
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

// 12b. 🔴 DAS GRATVERFAHREN IM EINZELNEN. Die zwei Invarianten oben prüft die Schleife für alle vier
// mit; hier steht, was NUR für „ridged" gilt und was beim Bauen leicht kaputtgeht.
//
// 💣 Das Gratmuster allein ist ein GLOBALES Feld -- `1 − |n|` wird gerade dort groß, wo das Rauschen
// durch null geht, und das passiert auch am Flächenrand. Dass der Rand trotzdem exakt 0 bleibt, hängt
// einzig daran, dass es das Buckelfeld MULTIPLIZIERT. Wer die Multiplikation je in eine Addition
// umbaut („damit die Grate auch am Rand zu sehen sind"), bricht die Verschmelzung zweier Flächen.
{
	const w = buildEcosystemPeakWindow(peak);
	const gratig = buildEcosystemHeightField(area, peak, w, { method: "ridged" });
	const at = (x, y) => sampleEcosystemHeightField(gratig, x, y, w.sample(x, y));

	// Das Muster selbst liegt in 0..1 -- sonst verschöbe das Verfahren die HÖHE, statt nur zu formen.
	let kleinstes = Infinity;
	let groesstes = -Infinity;
	for (let y = 0; y < 200; y += 3.1) {
		for (let x = 0; x < 200; x += 3.1) {
			const wert = ecosystemRidgedNoise(12345, x, y, 20);
			kleinstes = Math.min(kleinstes, wert);
			groesstes = Math.max(groesstes, wert);
		}
	}
	assert.ok(kleinstes >= 0 && groesstes <= 1,
		`das Gratmuster bleibt in 0..1 (${kleinstes.toFixed(3)} .. ${groesstes.toFixed(3)})`);
	assert.ok(groesstes > 0.6, `und es nutzt seinen Bereich wirklich aus (max ${groesstes.toFixed(3)})`);

	// 🔴 Und es sind wirklich GRATE, keine Buckel: entlang einer Gratlinie ist das Feld hoch und bleibt
	// hoch, während es quer dazu abfällt. Gemessen als Anisotropie -- die Buckelsumme hat keine.
	// Ohne diese Prüfung wäre „ridged" grün, auch wenn es bloß anderes Gewölbe erzeugte.
	const hochpunkte = [];
	for (let y = 5; y < 195; y += 1) {
		for (let x = 5; x < 195; x += 1) {
			if (ecosystemRidgedNoise(999, x, y, 25) > 0.9) {
				hochpunkte.push([x, y]);
			}
		}
	}
	assert.ok(hochpunkte.length > 50, `es gibt genug sehr hohe Stellen zum Messen (${hochpunkte.length})`);
	// Ein Gratpunkt hat mindestens EINEN sehr hohen Nachbarn in 1 Einheit Abstand (die Linie läuft
	// weiter). Ein isolierter Buckelgipfel hätte keinen.
	const menge = new Set(hochpunkte.map(([x, y]) => `${x}|${y}`));
	const mitNachbar = hochpunkte.filter(([x, y]) =>
		menge.has(`${x + 1}|${y}`) || menge.has(`${x - 1}|${y}`)
		|| menge.has(`${x}|${y + 1}`) || menge.has(`${x}|${y - 1}`)).length;
	assert.ok(mitNachbar / hochpunkte.length > 0.8,
		`Gratpunkte liegen auf LINIEN, nicht vereinzelt (${(100 * mitNachbar / hochpunkte.length).toFixed(0)} %)`);

	// Und das fertige Feld ist trotzdem ein Gebirge: der Gipfel trägt seine Zahl, der Rand ist 0,
	// dazwischen steht Gelände (nicht alles auf null gedrückt).
	assert.ok(Math.abs(at(50, 50) - 3000) < 1, `Gratverfahren: der Gipfel bleibt 3000 (${at(50, 50)})`);
	let hatGelaende = false;
	for (let y = 10; y < 95 && !hatGelaende; y += 7) {
		for (let x = 10; x < 95 && !hatGelaende; x += 7) {
			if (Math.hypot(x - 50, y - 50) > 25 && at(x, y) > 1) {
				hatGelaende = true;
			}
		}
	}
	assert.ok(hatGelaende, "das Gratverfahren drückt nicht die ganze Fläche auf null");

	// 💣 Und es überlebt die Durchschnittshöhe aus Aufgabe A -- die Potenz liegt auf dem PRODUKT aus
	// Buckelfeld und Grat, nicht auf einem der beiden. Beides zusammen ist der Fall, der live auftritt.
	const w2 = buildEcosystemPeakWindow(peak);
	const beides = buildEcosystemHeightField(area, peak, w2,
		{ method: "ridged", avgHeight: 2000, meanHeight: 800 });
	const at2 = (x, y) => sampleEcosystemHeightField(beides, x, y, w2.sample(x, y));
	assert.ok(beides.noiseExponent !== 1, `Grat + Ø: die Potenz wurde gesucht (${beides.noiseExponent})`);
	assert.ok(Math.abs(at2(50, 50) - 3000) < 1, `Grat + Ø: der Gipfel bleibt 3000 (${at2(50, 50)})`);
	for (const [x, y] of [[0, 50], [100, 50], [50, 0], [50, 100]]) {
		assert.strictEqual(at2(x, y), 0, `Grat + Ø: der Rand bleibt flach bei (${x},${y})`);
	}
}

// Und ein unbekanntes Verfahren fällt auf das additive Rauschen zurück, statt die Fläche zu verlieren.
const unbekannt = buildEcosystemHeightField(area, peak, buildEcosystemPeakWindow(peak), { method: "gibtsnicht" });
assert.strictEqual(unbekannt.method, "perlin", "ein unbekanntes Verfahren fällt auf perlin zurück");

// 13. 🔴 OHNE DURCHSCHNITTSHÖHE ÄNDERT SICH NICHTS. Das ist die Zusicherung, an der die 2 lebenden
// Gebirgsflächen hängen: `terrain_mean_height` ist NULL, also muss das Feld Zahl für Zahl dasselbe sein
// wie vor der Trennung von Ø und Maximum. Potenz 1 und Faktor 1 heissen genau das -- die Skalierung
// sitzt dann wie seit V8 in den Buckelamplituden und die Malschleife rechnet keinen Takt mehr.
const ohneMittel = buildEcosystemHeightField(area, peak, buildEcosystemPeakWindow(peak), { avgHeight: 900 });
const mitNull = buildEcosystemHeightField(area, peak, buildEcosystemPeakWindow(peak),
	{ avgHeight: 900, meanHeight: null });
assert.strictEqual(ohneMittel.noiseExponent, 1, "ohne Durchschnittshöhe bleibt die Potenz exakt 1");
assert.strictEqual(ohneMittel.noiseScale, 1, "und der Faktor sitzt in den Amplituden, nicht am Feld");
assert.strictEqual(mitNull.noiseExponent, 1, "und ein ausdrückliches null heisst dasselbe wie gar nichts");
const fenster13 = buildEcosystemPeakWindow(peak);
for (let y = 1; y < 100; y += 7.3) {
	for (let x = 1; x < 100; x += 7.3) {
		assert.strictEqual(
			sampleEcosystemHeightField(ohneMittel, x, y, fenster13.sample(x, y)),
			sampleEcosystemHeightField(mitNull, x, y, fenster13.sample(x, y)),
			`ohne Ø ist das Feld bei (${x},${y}) unverändert`);
	}
}

// 14. 🔴 DIE ZWEI INVARIANTEN ÜBERSTEHEN AUCH DIE DURCHSCHNITTSHÖHE, und zwar für ALLE Verfahren.
//
// Die Potenz formt die SUMME des Rauschens um -- also genau das, was zwischen Gipfel und Rand liegt.
// Sie darf weder den Gipfel von seiner Zahl holen (das Fenster zieht das Rauschen dort auf 0, und die
// Potenz sitzt bewusst VOR dem Fenster) noch den Rand von der Null (`Faktor · 0^p` ist 0, und der
// kompakte Träger der Buckel sorgt dafür, dass am Rand wirklich 0 ankommt).
//
// 💣 Bräche eines von beiden, wäre es an einer EINZELNEN Fläche unsichtbar -- auffallen würde es erst
// dort, wo zwei Flächen überlappen und ihre Felder addiert werden, als Stufe an der Naht.
for (const method of ["perlin", "warp", "slope", "ridged"]) {
	const w = buildEcosystemPeakWindow(peak);
	const built = buildEcosystemHeightField(area, peak, w, { method, avgHeight: 2000, meanHeight: 800 });
	const at = (x, y) => sampleEcosystemHeightField(built, x, y, w.sample(x, y));
	assert.ok(built.noiseExponent !== 1,
		`${method}: die Potenz wurde wirklich gesucht (${built.noiseExponent})`);
	assert.ok(Math.abs(at(50, 50) - 3000) < 1,
		`${method}: der Gipfel liest trotz Potenz seine eigene Höhe (${at(50, 50)})`);
	for (const [x, y] of [[0, 50], [100, 50], [50, 0], [50, 100]]) {
		assert.strictEqual(at(x, y), 0, `${method}: der Rand bleibt trotz Potenz flach bei (${x},${y})`);
	}
	assert.ok(Number.isFinite(at(31, 67)), `${method}: keine NaN durch die Potenz`);
}

// 15. 💣 KEIN ADDITIVER SOCKEL. Der billige Weg zu einem hohen Durchschnitt wäre „überall mindestens Ø
// draufrechnen" -- und genau der bricht die Fusshöhe-0-Invariante. Deshalb wird der ganze Rand abgefahren
// und nicht nur die vier Seitenmitten von oben: ein Sockel stünde überall, eine Potenz nirgends.
const sockelprobe = fieldOf(area, peak, { avgHeight: 2500, meanHeight: 1600 });
for (let t = 0; t <= 100; t += 2.5) {
	for (const [x, y] of [[t, 0], [t, 100], [0, t], [100, t]]) {
		assert.strictEqual(sockelprobe.at(x, y), 0,
			`ein Sockel würde hier auffallen: (${x},${y}) muss exakt 0 sein`);
	}
}

// 16. 🔴 UND DIE ZAHL WIRKT AUCH. Ein Hochplateau ist etwas anderes als zerklüftetes Vorland: bei
// GLEICHER Maximalhöhe muss die höhere Durchschnittshöhe eine deutlich höhere Fläche ergeben.
// Ohne diese Prüfung könnte die Potenz falsch herum wirken oder gar nicht, und alle Invarianten oben
// blieben trotzdem grün.
const hochplateau = fieldOf(area, peak, { avgHeight: 3000, meanHeight: 1800 });
const vorland = fieldOf(area, peak, { avgHeight: 3000, meanHeight: 400 });
assert.ok(meanOf(hochplateau) > 1.5 * meanOf(vorland),
	`Ø 1800 muss deutlich über Ø 400 liegen (${meanOf(hochplateau).toFixed(0)} vs ${meanOf(vorland).toFixed(0)})`);
// Und das Maximum bleibt, wo es hingehört -- die zweite Zahl verschiebt die FORM, nicht die Spitze.
// Gemessen am Rauschen allein: der Gipfelbuckel überragt es und würde die Messung sonst dominieren.
const noiseMaxOf = (gebaut) => {
	const nurRauschen = { ...gebaut.built, peakBumps: [] };
	let groesster = 0;
	for (let y = 2; y <= 98; y += 2) {
		for (let x = 2; x <= 98; x += 2) {
			groesster = Math.max(groesster, sampleEcosystemHeightField(nurRauschen, x, y, 1));
		}
	}
	return groesster;
};
for (const [name, gebaut] of [["Hochplateau", hochplateau], ["Vorland", vorland]]) {
	const gemessen = noiseMaxOf(gebaut);
	assert.ok(Math.abs(gemessen - 3000) < 0.1 * 3000,
		`${name}: die Maximalhöhe bleibt bei 3000 (gemessen ${gemessen.toFixed(0)})`);
}

// 17. Die Suche selbst: sie klemmt, statt Unmögliches zu versprechen, und sie rechnet monoton.
//
// ⚠️ Die obere Klemme ist nicht kosmetisch (siehe Modulkopf): unter ihr wird aus dem Randauslauf eine
// Wand, und die Naht zweier überlappender Flächen als Kante sichtbar. Ein Ø nahe am Maximum ist deshalb
// ausdrücklich NICHT erfüllbar -- die Suche liefert die flachste erlaubte Potenz und sättigt sichtbar.
const gleichverteilt = [];
for (let i = 0; i <= 100; i++) {
	gleichverteilt.push(i / 100);
}
assert.strictEqual(solveEcosystemNoiseExponent([], 1, 0.5), 1, "ohne Abtastungen bleibt die Potenz 1");
assert.strictEqual(solveEcosystemNoiseExponent(gleichverteilt, 0, 0.5), 1, "und ohne lautesten Punkt auch");
assert.strictEqual(solveEcosystemNoiseExponent(gleichverteilt, 1, 0.999), ECOSYSTEM_NOISE_EXPONENT_MIN,
	"ein Ø fast auf dem Maximum klemmt auf die flachste erlaubte Potenz");
assert.strictEqual(solveEcosystemNoiseExponent(gleichverteilt, 1, 0.001), ECOSYSTEM_NOISE_EXPONENT_MAX,
	"und ein Ø fast bei null auf die zerklüftetste");
// Dazwischen: mehr Ø heisst kleinere Potenz, ausnahmslos.
let vorige = Infinity;
for (const ziel of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
	const p = solveEcosystemNoiseExponent(gleichverteilt, 1, ziel);
	assert.ok(p < vorige, `ein höheres Ø muss die Potenz senken (bei ${ziel}: ${p} nicht unter ${vorige})`);
	vorige = p;
}
// Und sie trifft: über eine bekannte Verteilung nachgerechnet, ohne Histogramm.
const p05 = solveEcosystemNoiseExponent(gleichverteilt, 1, 0.5);
const nachgerechnet = gleichverteilt.reduce((sum, u) => sum + Math.pow(u, p05), 0) / gleichverteilt.length;
assert.ok(Math.abs(nachgerechnet - 0.5) < 0.01,
	`die gefundene Potenz ${p05.toFixed(3)} trifft das Ziel 0,5 (nachgerechnet ${nachgerechnet.toFixed(3)})`);

console.log("ecosystem-height-field: all assertions passed");

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER ABNAHMEFALL. Die Vorgabetafel muss das Bild reproduzieren, das die Karte am 16.08.2026
// gezeichnet hat -- sonst ändert eine Auslieferung, die "nichts ändern" soll, die ganze Karte.
//
// Deshalb steht die ABGESCHAFFTE Rechnung hier noch einmal, als Literale: die geometrische
// Markerkurve (LOCATION_MARKER_RADIUS_SPEC) und die alte Schrifttafel
// (LOCATION_NAME_LABEL_SIZE_BY_ZOOM samt LOCATION_NAME_LABEL_CONFIG[*].minZoom). Sie sind der
// Zeuge, nicht die Quelle -- werden sie je "angepasst", damit der Test grün wird, ist der Test wertlos.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-vorgabe.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);

// ---- Die abgeschaffte Markerkurve (Stand 16.08.2026) ------------------------------------------
const ALTE_KURVE = {
	metropole: { from: 0, start: 2.5, end: 20 },
	grossstadt: { from: 0, start: 1.5, end: 15 },
	stadt: { from: 0, start: 0.5, end: 12 },
	kleinstadt: { from: 1, start: 0.5, end: 9.33 },
	dorf: { from: 2, start: 0.5, end: 6.67 },
	gebaeude: { from: 3, start: 0.5, end: 4.67 },
};
const ALTES_MAX_ZOOM = 6;
const ALTE_KONTUR = 0.33;

const alterAussendurchmesser = (typ, z) => {
	const spec = ALTE_KURVE[typ];
	const geklemmt = Math.max(spec.from, Math.min(ALTES_MAX_ZOOM, z));
	const spanne = ALTES_MAX_ZOOM - spec.from;
	const t = spanne > 0 ? (geklemmt - spec.from) / spanne : 0;
	const kern = spec.start * Math.pow(spec.end / spec.start, t);
	return Math.round(kern * (1 + ALTE_KONTUR) * 2 * 100) / 100;
};

// ---- Die abgeschaffte Schrifttafel (Stand 16.08.2026) -----------------------------------------
const ALTE_SCHRIFT = {
	metropole: { 0: 8, 1: 9, 2: 11, 3: 13, 4: 17, 5: 19 },
	grossstadt: { 0: 8, 1: 8.5, 2: 10, 3: 12, 4: 15, 5: 17 },
	stadt: { 0: 8, 1: 8, 2: 9, 3: 11, 4: 13, 5: 15 },
	kleinstadt: { 0: 8, 1: 8, 2: 8.5, 3: 9.5, 4: 11, 5: 13 },
	dorf: { 0: 8, 1: 8, 2: 8, 3: 8.5, 4: 10, 5: 11 },
	gebaeude: { 0: 8, 1: 8, 2: 8, 3: 8, 4: 9, 5: 9 },
};
const ALTE_SCHRIFT_MINZOOM = { metropole: 0, grossstadt: 0, stadt: 2, kleinstadt: 3, dorf: 4, gebaeude: 4 };
const ALTES_LABEL_MAX_ZOOM = 5; // VISUAL_MAX_ZOOM_LEVEL

const KLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

// ---- A. Der Marker ----------------------------------------------------------------------------
KLASSEN.forEach((typ) => {
	const zeile = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker[typ];
	assert.ok(Array.isArray(zeile) && zeile.length === 8, `${typ}: acht Markerzellen`);
	for (let z = 0; z <= 7; z += 1) {
		if (z < ALTE_KURVE[typ].from) {
			assert.strictEqual(zeile[z], null,
				`${typ} z${z}: die Klasse erschien früher erst ab z${ALTE_KURVE[typ].from}`);
			continue;
		}
		assert.strictEqual(zeile[z], alterAussendurchmesser(typ, z),
			`${typ} z${z}: Vorgabe ${zeile[z]}, alte Kurve ${alterAussendurchmesser(typ, z)}`);
	}
	// z7 erbt z6 -- die alte Kurve klemmte dort.
	assert.strictEqual(zeile[7], zeile[6], `${typ}: z7 erbt z6`);
});

// ---- B. Der Name ------------------------------------------------------------------------------
KLASSEN.forEach((typ) => {
	const zeile = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.label[typ];
	assert.ok(Array.isArray(zeile) && zeile.length === 8, `${typ}: acht Schriftzellen`);
	for (let z = 0; z <= 7; z += 1) {
		if (z < ALTE_SCHRIFT_MINZOOM[typ]) {
			assert.strictEqual(zeile[z], null,
				`${typ} z${z}: der Name erschien früher erst ab z${ALTE_SCHRIFT_MINZOOM[typ]}`);
			continue;
		}
		const alt = ALTE_SCHRIFT[typ][Math.min(ALTES_LABEL_MAX_ZOOM, z)];
		assert.strictEqual(zeile[z], Math.max(8, alt),
			`${typ} z${z}: Vorgabe ${zeile[z]}, alte Tafel ${Math.max(8, alt)}`);
	}
	assert.strictEqual(zeile[6], zeile[5], `${typ}: z6 erbt z5 (alter Deckel)`);
	assert.strictEqual(zeile[7], zeile[5], `${typ}: z7 erbt z5 (alter Deckel)`);
});

// ---- C. Die Erscheinungsstufen stimmen mit den abgeschafften Konstanten überein ---------------
// 💣 Bis heute stand die Marker-Untergrenze ZWEIMAL im Code: als if-Kette `minZoomByType` und als
// LOCATION_MARKER_RADIUS_SPEC[*].from. Beide sagten 0/0/0/1/2/3. Ab jetzt gibt es sie einmal --
// als Form der Tabelle.
assert.deepStrictEqual(
	KLASSEN.map((typ) => avesmapsLocationZoomBandMinZoom("marker", typ)),
	[0, 0, 0, 1, 2, 3],
	"die Erscheinungsstufen der Marker"
);
assert.deepStrictEqual(
	KLASSEN.map((typ) => avesmapsLocationZoomBandMinZoom("label", typ)),
	[0, 0, 2, 3, 4, 4],
	"die Erscheinungsstufen der Namen"
);

console.log("zoombaender-vorgabe: alle Zusicherungen erfüllt");

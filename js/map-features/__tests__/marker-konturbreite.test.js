const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Konturbreite des Ortsmarkers: wie dick der weisse Ring um den roten Kern ist.
// Owner 26.08.2026: „mit dem Punkt wachsen" -- der Ring ist ein ANTEIL des Kernradius (Prozent),
// kein fester Pixelwert. Ein grosser Punkt bekommt einen dicken Ring, ein kleiner einen duennen.
//
// 🔴 DER AUSSENDURCHMESSER BLEIBT DER CHEF. Er steht im Marker-Plot; der Anteil teilt ihn nur in
// Kern und Ring auf. Ein dickerer Ring macht den Punkt NICHT groesser, er frisst den Kern von innen
// auf. Ohne diese Regel verstellte der Regler heimlich die Groesse, die einen Absatz darueber
// eingestellt wird -- zwei Regler auf derselben Zahl, von denen nur einer sie benennt.
//
// Harness wie zoombaender-erscheinungsstufe.test.js.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/marker-konturbreite.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

global.window = {};
global.CROSSING_LOCATION_TYPE = "crossing";
global.VISUAL_MAX_ZOOM_LEVEL = 5;

loadBrowserScript(path.join(__dirname, "../location-zoom-bands.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-marker-rendering.js"));

const KLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const rund = (v) => Math.round(v * 1e6) / 1e6;

// ---- A. Die Vorgabe ist der heutige Wert, als Prozentzahl --------------------------------------
// 💣 Die abgeschaffte Konstante hiess LOCATION_MARKER_CONTOUR_RATIO = 0.33. Sie steht hier als
// ZEUGE: die Vorgabe muss sie zifferngenau reproduzieren, sonst aendert das Ausliefern des Reglers
// das Kartenbild -- und zwar bei JEDEM Ort, ohne dass jemand etwas eingestellt haette.
assert.strictEqual(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.abstaende.kontur, 33,
	"die Vorgabe der Konturbreite sind 33 % -- die alte Konstante 0.33");

avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsLocationMarkerContourRatio(), 0.33,
	"der Zeichner bekommt einen BRUCH (0,33), keine Prozentzahl -- er rechnet damit");

// ---- B. Bei der Vorgabe rechnet der Zeichner Ziffer fuer Ziffer wie vorher ----------------------
// Die alte Rechnung, woertlich aus map-features-location-marker-rendering.js vor dem Umbau:
//   kern   = aussen / 2 / (1 + 0.33)
//   kontur = max(0.5, kern * 0.33)
const ALTE_RECHNUNG = (aussen) => {
	const kern = aussen / 2 / 1.33;
	return { kern: kern, kontur: Math.max(0.5, kern * 0.33) };
};

KLASSEN.forEach((cls) => {
	for (let z = 0; z <= 8; z += 1) {
		const aussen = getLocationMarkerSize(cls, z);
		const alt = ALTE_RECHNUNG(aussen);
		assert.strictEqual(rund(getLocationMarkerCoreRadius(cls, z)), rund(alt.kern),
			`${cls} bei z${z}: der Kernradius ist unveraendert`);
		assert.strictEqual(rund(getLocationMarkerContourWidth(cls, z)), rund(alt.kontur),
			`${cls} bei z${z}: die Konturbreite ist unveraendert`);
	}
});

// ---- C. Der Regler wirkt, und zwar auf ALLE Klassen zugleich ------------------------------------
// GLOBAL wie die vier Abstaende: EIN Wert fuer alle Ortsklassen und Zoomstufen.
avesmapsApplyLocationZoomBands({ abstaende: { kontur: 60 } });
assert.strictEqual(avesmapsLocationMarkerContourRatio(), 0.6);
KLASSEN.forEach((cls) => {
	const aussen = getLocationMarkerSize(cls, 6);
	const kern = aussen / 2 / 1.6;
	assert.strictEqual(rund(getLocationMarkerCoreRadius(cls, 6)), rund(kern),
		`${cls}: 60 % schnuert den Kern enger`);
});

// ---- D. 🔴 DER AUSSENDURCHMESSER RUEHRT SICH NICHT ----------------------------------------------
// Die Owner-Regel, und die einzige, die man beim Bauen versehentlich bricht: Kern PLUS Kontur ist
// immer der Wert aus dem Plot. Gemessen wird ueber die ganze Spanne des Reglers.
[0, 1, 12, 33, 50, 75, 100].forEach((prozent) => {
	avesmapsApplyLocationZoomBands({ abstaende: { kontur: prozent } });
	KLASSEN.forEach((cls) => {
		for (let z = 3; z <= 7; z += 1) {
			const aussen = getLocationMarkerSize(cls, z);
			// ⚠️ Nur ueber der Untergrenze pruefbar: bei winzigen Markern hebt der 0,5-px-Boden die
			// Kontur an, und der Punkt wird dadurch groesser als sein Band sagt. Das ist ein
			// VORBESTEHENDER Zustand (Block F) und nicht Sache dieses Reglers.
			const kern = getLocationMarkerCoreRadius(cls, z);
			if (kern * (prozent / 100) < 0.5 && prozent > 0) { continue; }
			assert.strictEqual(
				rund(kern + getLocationMarkerContourWidth(cls, z)),
				rund(aussen / 2),
				`${prozent} %, ${cls} bei z${z}: Kern + Kontur = halber Aussendurchmesser`
			);
		}
	});
});

// ---- E. 0 % heisst KEIN Ring, nicht „ein halber Pixel Ring" -------------------------------------
// 💣 Wer den 0,5-px-Boden bedingungslos stehen laesst, macht bei 0 % JEDEN Marker der Karte um
// einen Pixel groesser -- der Boden ist dafuer da, dass ein GEWOLLTER Ring nicht verschwindet, nicht
// dafuer, einen abgeschalteten zu erzwingen.
avesmapsApplyLocationZoomBands({ abstaende: { kontur: 0 } });
KLASSEN.forEach((cls) => {
	assert.strictEqual(getLocationMarkerContourWidth(cls, 6), 0, `${cls}: bei 0 % gibt es keine Kontur`);
	assert.strictEqual(getLocationMarkerBorderWidth(cls, 6), 0, `${cls}: und die gerundete Breite ist ebenfalls 0`);
	assert.strictEqual(
		rund(getLocationMarkerCoreRadius(cls, 6) * 2),
		rund(getLocationMarkerSize(cls, 6)),
		`${cls}: bei 0 % IST der Kern der ganze Punkt`
	);
});

// ---- F. Ueber 0 % gilt die Untergrenze von einem halben Pixel weiter ----------------------------
// Ein Dorf bei z2 ist 1,33 px gross; 33 % seines Kerns waeren 0,165 px -- unter einem halben Pixel
// sieht man keinen Ring mehr, und der Marker haette dann gar keine Kontur.
avesmapsApplyLocationZoomBands(null);
assert.ok(getLocationMarkerCoreRadius("dorf", 2) * 0.33 < 0.5, "die Fixture trifft wirklich den Boden");
assert.strictEqual(getLocationMarkerContourWidth("dorf", 2), 0.5, "der Boden haelt die Kontur bei 0,5 px");

// ---- G. Schranken: 0 bis 100 %, alles andere faellt auf die Vorgabe zurueck ---------------------
[-1, 100.5, 1000, "33", null, undefined, NaN, [], {}].forEach((muell) => {
	avesmapsApplyLocationZoomBands({ abstaende: { kontur: muell } });
	assert.strictEqual(avesmapsLocationMarkerContourRatio(), 0.33,
		`ein unbrauchbarer Wert (${JSON.stringify(muell)}) faellt auf die Vorgabe zurueck`);
});
// Die Raender selbst sind gueltig.
avesmapsApplyLocationZoomBands({ abstaende: { kontur: 0 } });
assert.strictEqual(avesmapsLocationMarkerContourRatio(), 0, "0 % ist ein gueltiger Wert, kein Rueckfall");
avesmapsApplyLocationZoomBands({ abstaende: { kontur: 100 } });
assert.strictEqual(avesmapsLocationMarkerContourRatio(), 1, "100 % ebenso");

// ---- H. Kreuzungen tragen weiterhin gar keine Kontur --------------------------------------------
// Sie sind kein Ortstyp und kennen kein Band (Owner 2026-08-14) -- der Regler darf sie nicht
// nachtraeglich beringen.
[0, 33, 100].forEach((prozent) => {
	avesmapsApplyLocationZoomBands({ abstaende: { kontur: prozent } });
	assert.strictEqual(getLocationMarkerBorderWidth("crossing", 5), 0,
		`Kreuzungen bleiben bei ${prozent} % ohne Kontur`);
});

// ---- I. Die Schranke steht in derselben Tafel wie die der Abstaende ------------------------------
// 🔴 GELESEN, NIE ABGESCHRIEBEN -- das Fenster klemmt seinen Regler gegen genau diese Zahlen.
assert.deepStrictEqual(avesmapsLocationLabelSpacingLimits("kontur"), { min: 0, max: 100 },
	"die Konturbreite hat eine EIGENE Schranke (0-100 %), nicht die der Abstaende (0-20 px)");
assert.deepStrictEqual(avesmapsLocationLabelSpacingLimits("spalt"), { min: 0, max: 20 },
	"und die Abstaende behalten ihre eigene");

// ---- J. Die drei Markertöne stehen an EINER Stelle -- und der Canvas hält seine Kopie ----------
// 💣 Ein <canvas> löst keine CSS-Variable auf, der Zeichner MUSS die Zeichenketten führen. Genau
// deshalb braucht es hier eine Zusicherung: sonst ändert jemand das Token, die DOM-Marker und die
// Vorschau folgen, und der Canvas -- der die Karte tatsächlich zeichnet -- bleibt beim alten Ton.
const lies = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");
const tokens = lies("css/base/tokens.css");
const canvas = lies("js/map-features/map-features-location-canvas-layer.js");
const markerCss = lies("css/features/location-popups-markers.css");
const editorSeite = lies("html/wiki-sync-settlement-editor.html");

const TOENE = {
	"--color-marker-settlement": "#cc2f2a",
	"--color-marker-settlement-site": "#7a4fd0",
	"--color-marker-settlement-contour": "#ffffff",
};
Object.entries(TOENE).forEach(([token, hex]) => {
	assert.ok(new RegExp(`${token}:\\s*${hex};`).test(tokens), `${token} ist in tokens.css auf ${hex} definiert`);
});
assert.ok(canvas.includes('"#cc2f2a"') && canvas.includes('"#7a4fd0"'),
	"der Canvas-Zeichner führt dieselben Kerntöne als Zeichenkette");

// Und niemand schreibt sie daneben noch einmal ab.
assert.ok(!/#cc2f2a/i.test(markerCss) && !/#7a4fd0/i.test(markerCss),
	"die Marker-CSS liest die Töne aus den Tokens, statt sie abzuschreiben");
assert.ok(!/#cc2f2a/i.test(editorSeite) && !/#7a4fd0/i.test(editorSeite),
	"und die Vorschau im Ortseditor ebenso");

avesmapsApplyLocationZoomBands(null);
console.log("marker-konturbreite.test.js: OK");

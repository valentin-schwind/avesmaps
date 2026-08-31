const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER TREFFERRADIUS DER ORTSMARKER -- und der Grund, warum dieser Test existiert:
// `LOCATION_MARKER_CONTOUR_RATIO` wurde am 26.08.2026 abgeschafft (der Kontur-Anteil ist seither
// ein Regler in location-zoom-bands.js, `abstaende.kontur`). Zwei Aufrufstellen in
// map-features-location-canvas-layer.js blieben stehen und warfen live einen ReferenceError:
//   - _onMouseMove          -> bei JEDER Mausbewegung ueber der Karte
//   - _tryOpenAtContainerPoint -> beim KLICK; das ist der Klick-Arbiter, den Wege, Regionen und
//     Territorien als Erstes rufen (docs/click-arbiter-coordination.md)
//
// 💣 EINE ABGESCHAFFTE KONSTANTE STIRBT STILL. `php -l`/`node --check` sehen sie nicht, kein
// Quelltexttest sah sie, und der Zeichenpfad war heil -- nur die beiden Zeigerpfade nicht. Gemeldet
// hat es der Owner ueber die Browserkonsole („364 Uncaught ReferenceError").
//
// ⭐ Der Ersatz ist nicht 0,33, sondern `item.core + item.contour` -- die Aussenkante, die der
// Zeichner ohnehin benutzt. Damit folgt der Trefferradius dem Kontur-Regler, was die
// festverdrahtete Zahl nie tat.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/marker-treffer-radius.test.js

const punkt = (x, y) => ({ x, y, round: () => punkt(Math.round(x), Math.round(y)) });

global.window = { location: { search: "" }, getComputedStyle: () => ({ zIndex: "600" }) };
global.URLSearchParams = URLSearchParams;
global.document = { querySelectorAll: () => [] };
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const kontext = {
	canvas: { width: 800, height: 600 },
	setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
	save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {},
	set fillStyle(v) {}, get fillStyle() { return ""; },
	set shadowColor(v) {}, set shadowBlur(v) {},
};
global.L = {
	DomUtil: {
		create: () => ({ style: {}, classList: { add() {} }, getContext: () => kontext, width: 0, height: 0 }),
		setPosition() {}, setTransform() {},
	},
};
global.avesmapsCanvasDpr = () => 1;
global.getVisualZoomLevel = (z) => z;
global.getSelectedMapLayerMode = () => "standard";
global.activeLocationPublicId = "";
global.getLocationMarkerSize = () => 24;
global.getLocationMarkerCoreRadius = () => 9;     // Kern
global.getLocationMarkerBorderWidth = () => 3;    // Kontur -> Aussenkante 12
// Der Weg nach einem Treffer („Marker zu DOM befoerdern und Popup oeffnen") ist hier nicht das
// Pruefobjekt -- er muss nur nicht werfen.
global.createLocationMarkerIcon = () => ({});
global.openLocationPopupForMarkerEntry = () => {};

// Die Ortsmarke liegt bei Containerpunkt (100, 100).
const ORT = { lat: 1, lng: 1 };
const karte = {
	_zoom: 4,
	getZoom() { return 4; },
	getZoomScale() { return 2; },
	getSize() { return { x: 800, y: 600 }; },
	latLngToLayerPoint() { return punkt(100, 100); },
	latLngToContainerPoint() { return punkt(100, 100); },
	containerPointToLayerPoint() { return punkt(0, 0); },
	containerPointToLatLng() { return { lat: 0, lng: 0 }; },
	getPane(n) { return this._panes[n]; },
	createPane(n) { this._panes[n] = { style: {}, appendChild() {} }; },
	getContainer() { return this._container; },   // _onMouseMove setzt daran den Zeiger
	_container: { style: {} },
	hasLayer() { return false; }, addLayer() {}, removeLayer() {},
	on() {},
	_panes: {
		locationCanvasPane: { style: {}, appendChild() {} },
		locationsPane: { style: { zIndex: "600" } },
	},
};

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../zoom-uebergang.js"), "utf8"), { filename: "zoom-uebergang.js" });
// 💣 Das geteilte Bauwerks-Merkmal MUSS mitgeladen werden (js/ui/ortsklassen.js): der Zeichner
// fragt seit dem 31.08.2026 avesmapsIstBauwerksklasse(), statt auf "gebaeude" zu vergleichen --
// es gibt zwei Bauwerksklassen. Im Browser teilen sich die Skripte den globalen Raum, ein
// Pruefstand hat ihn NICHT: ohne diese Zeile faellt er mit einem ReferenceError um, der wie ein
// Fehler des Zeichners aussieht und keiner ist.
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "..", "..", "ui", "ortsklassen.js"), "utf8"),
	{ filename: "ortsklassen.js" });
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../map-features-location-canvas-layer.js"), "utf8"),
	{ filename: "map-features-location-canvas-layer.js" });

locationCanvasLayer.init(karte);
locationCanvasLayer._ctx = kontext;
locationCanvasLayer.setEntries([
	{
		locationType: "stadt", publicId: "p1", location: {},
		marker: { getLatLng: () => ORT, setIcon() {}, once() {}, openPopup() {} },
	},
]);
const eintrag = locationCanvasLayer._entries[0];

// ⚠️ Ein Treffer befoerdert den Eintrag zu einem DOM-Marker (`_canvasPromoted`), und danach
// ueberspringt ihn der Hit-Test. Fuer eine Messreihe muss das zwischen den Proben zurueck.
const trifft = (dx) => {
	eintrag.entry._canvasPromoted = false;
	return locationCanvasLayer._tryOpenAtContainerPoint(punkt(100 + dx, 100));
};
const aussenkante = eintrag.core + eintrag.contour;   // 12
assert.strictEqual(aussenkante, 12, "Der Prueffstand selbst stimmt nicht.");

// ---- Der Zeigerpfad darf NICHT werfen ----------------------------------------------------------
// 🔴 Das ist die Zusicherung, die den ReferenceError vom 26.08.2026 gefangen haette.
assert.doesNotThrow(() => {
	locationCanvasLayer._onMouseMove({ containerPoint: punkt(100, 100) });
}, "💣 _onMouseMove wirft -- das feuert bei JEDER Mausbewegung ueber der Karte.");

assert.doesNotThrow(() => { trifft(0); },
	"💣 _tryOpenAtContainerPoint wirft -- das ist der Klick-Arbiter, den Wege, Regionen und "
	+ "Territorien als ERSTES rufen. Ein Wurf dort bricht die ganze Klickkette.");

// ---- Und der Radius muss der AUSSENKANTE folgen, nicht einer festen Zahl -----------------------
// Ein Punkt knapp INNERHALB (Aussenkante 12 + 3 Kulanz = 15) trifft, einer knapp ausserhalb nicht.
assert.strictEqual(trifft(14), true, "Ein Punkt 14 px neben der Mitte muss treffen.");
assert.strictEqual(trifft(16), false, "Ein Punkt 16 px neben der Mitte darf nicht mehr treffen.");

// ⭐ Der Radius folgt dem KONTUR-REGLER: eine dickere Kontur vergroessert das Ziel. Mit der
// abgeschafften festen 0,33 tat er das nie.
eintrag.contour = 9;   // Aussenkante jetzt 18, Trefferradius 21
assert.strictEqual(trifft(20), true,
	"💣 Der Trefferradius folgt der Kontur nicht -- er haengt noch an einer festen Zahl.");
assert.strictEqual(trifft(22), false, "Auch mit dicker Kontur endet das Ziel bei 21 px.");

// ---- Die abgeschaffte Konstante darf nirgends mehr stehen --------------------------------------
// 🪤 Kommentare ZUERST strippen: sie NENNEN die Konstante zu Recht (als Beleg, was sie einmal war),
// und ein Test, der daran anschlaegt, laesst den naechsten Leser genau diese Belege loeschen.
const WURZEL = path.join(__dirname, "..", "..", "..");
const dateien = [];
(function sammle(verz) {
	for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
		const p = path.join(verz, e.name);
		if (e.isDirectory()) { if (e.name !== "third-party") { sammle(p); } }
		else if (e.name.endsWith(".js")) { dateien.push(p); }
	}
})(path.join(WURZEL, "js"));
for (const datei of dateien) {
	if (datei.includes("__tests__")) { continue; }
	const quelle = fs.readFileSync(datei, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	assert.ok(!/LOCATION_MARKER_CONTOUR_RATIO/.test(quelle),
		"💣 " + path.relative(WURZEL, datei) + " benutzt die abgeschaffte Konstante "
		+ "LOCATION_MARKER_CONTOUR_RATIO -- sie ist seit dem Kontur-Regler (26.08.2026) nicht mehr "
		+ "definiert und wirft zur Laufzeit. Der Kontur-Anteil steht in location-zoom-bands.js "
		+ "(`abstaende.kontur`); am Marker selbst ist die Aussenkante `core + contour`.");
}

console.log("marker-treffer-radius.test.js: alle Zusicherungen erfuellt");

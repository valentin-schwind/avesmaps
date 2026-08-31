const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER REGRESSIONSTEST ZUM FEHLSCHLAG VOM 26.08.2026, und er ist der Grund, warum es ihn gibt:
// die Marker-Gegenrechnung war gegen ZWOELF Mutationen dicht und hat den echten Fehler trotzdem
// nicht gesehen -- weil kein Test den Zeichenpfad je gegen eine sich BEWEGENDE Karte ausgefuehrt
// hat. Owner live: „ortsmarkierungen springen wild umher" und „zeigt waehrend dem zoom
// ortschaften an, die zwischen den beiden levels ueberhaupt nicht sichtbar sein sollten".
//
// 💣 DIE URSACHE STEHT IN LEAFLETS EIGENEM CODE (js/third-party/leaflet.js, minifiziert):
//     _animateZoom: … this.fire("zoomanim", {center,zoom}), … this._move(center, zoom, void 0, true)
// und `_move` setzt `this._zoom = zoom` sowie `this._pixelOrigin = this._getNewPixelOrigin(center)`.
// UNMITTELBAR NACHDEM `zoomanim` GEFEUERT HAT, STEHT LEAFLETS INTERNER ZUSTAND SCHON AUF DER
// ZIELSTUFE. Die 250 ms Animation laufen mit map.getZoom() = Ziel; nur das Bild interpoliert ueber
// die CSS-Transform.
// Wer waehrend der Animation `latLngToLayerPoint` ruft, bekommt also ZIEL-Koordinaten -- waehrend
// der Canvas die Transform traegt, die QUELL-Koordinaten ins Zielbild abbildet. Der Inhalt wird
// damit zweimal transformiert: die Marker fliegen auseinander, und solche, die ausserhalb der
// Zeichenflaeche lagen, werden hineingezogen (das waren die „fremden Ortschaften" -- es waren nie
// fremde, es waren die richtigen an falschen Stellen).
//
// ⭐ Die Loesung: die Bildschirmlage EINMAL im zoomanim einfrieren und waehrend der Animation aus
// dem Schnappschuss zeichnen. Das ist zugleich billiger -- pro Bild entfallen alle Projektionen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/marker-zoom-koordinaten.test.js

// ---- Prüfstand: eine Karte, die sich wie Leaflet verhält ---------------------------------------
// Weltmodell: layerPoint = [lng, lat] * 2^zoom. Einfach, aber es trennt die Zoomstufen sauber.
const welt = (latLng, zoom) => ({
	x: latLng.lng * Math.pow(2, zoom),
	y: latLng.lat * Math.pow(2, zoom),
});
const punkt = (x, y) => ({ x, y, round: () => punkt(Math.round(x), Math.round(y)) });

function baueKarte(startZoom) {
	const zuhoerer = {};
	return {
		_zoom: startZoom,
		_ecke: { lat: 0, lng: 0 },   // Weltkoordinate der linken oberen Ecke
		getZoom() { return this._zoom; },
		getZoomScale(ziel) { return Math.pow(2, ziel - this._zoom); },
		getSize() { return { x: 800, y: 600 }; },
		latLngToLayerPoint(ll) { const w = welt(ll, this._zoom); return punkt(w.x, w.y); },
		containerPointToLayerPoint() { const w = welt(this._ecke, this._zoom); return punkt(w.x, w.y); },
		containerPointToLatLng() { return this._ecke; },
		_latLngToNewLayerPoint(ll, zoom) { const w = welt(ll, zoom); return punkt(w.x, w.y); },
		getPane(name) { return this._panes[name]; },
		createPane(name) { this._panes[name] = { style: {}, appendChild() {} }; },
		on(namen, fn, ctx) {
			String(namen).split(" ").forEach((n) => { (zuhoerer[n] = zuhoerer[n] || []).push([fn, ctx]); });
		},
		feuere(name, ereignis) { (zuhoerer[name] || []).forEach(([fn, ctx]) => fn.call(ctx || this, ereignis)); },
		_panes: {
			locationCanvasPane: { style: {}, appendChild() {} },
			locationsPane: { style: { zIndex: "600" } },
		},
		/**
		 * 💣 GENAU DAS, WAS LEAFLET TUT: erst zoomanim feuern, DANN den internen Zustand auf die
		 * Zielstufe setzen. Ohne diese Reihenfolge prueft der Test den Fehler nicht, den es gab.
		 */
		zoomeAnimiert(zielZoom, schicht) {
			schicht._onZoomAnim({ zoom: zielZoom, center: this._ecke });
			this._zoom = zielZoom;   // <- Leaflets _move(…, true)
		},
	};
}

// Ein Zeichenkontext, der jeden Kreis mitschreibt.
function baueKontext() {
	const kreise = [];
	return {
		kreise,
		canvas: { width: 800, height: 600 },
		setTransform() {}, clearRect() { kreise.length = 0; }, beginPath() {},
		arc(x, y, r) { kreise.push({ x, y, r }); }, fill() {}, save() {}, restore() {},
		translate() {}, rotate() {}, fillRect() {},
		set fillStyle(v) {}, get fillStyle() { return ""; },
		set shadowColor(v) {}, set shadowBlur(v) {},
	};
}

// ---- Globale Umgebung, so klein wie moeglich ---------------------------------------------------
const bilder = [];   // manuell abgearbeitete requestAnimationFrame-Warteschlange
let uhr = 0;

global.window = { location: { search: "" }, getComputedStyle: () => ({ zIndex: "600" }) };
global.URLSearchParams = URLSearchParams;
global.document = { querySelectorAll: () => [] };
global.performance = { now: () => uhr };
global.requestAnimationFrame = (fn) => { bilder.push(fn); return bilder.length; };
global.cancelAnimationFrame = (id) => { if (id) { bilder[id - 1] = null; } };

let kontext = baueKontext();
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

// Ortsklassen mit ABSICHTLICH verschiedenen Wachstumsfaktoren -- so wie live.
const TAFEL = { metropole: [4, 8, 16, 24, 34, 48], gebaeude: [2, 2, 2, 2, 4, 8] };
global.getLocationMarkerSize = (typ, z) => TAFEL[typ][Math.max(0, Math.min(5, z))];
global.getLocationMarkerCoreRadius = (typ, z) => global.getLocationMarkerSize(typ, z) / 2 * 0.75;
global.getLocationMarkerBorderWidth = (typ, z) => global.getLocationMarkerSize(typ, z) / 2 * 0.25;

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

// ---- Der Fall ----------------------------------------------------------------------------------
const ORT = { lat: 30, lng: 50 };
const karte = baueKarte(4);
locationCanvasLayer.init(karte);
locationCanvasLayer._canvas.getContext = () => kontext;
locationCanvasLayer._ctx = kontext;
locationCanvasLayer.setEntries([
	{ locationType: "metropole", publicId: "p1", marker: { getLatLng: () => ORT }, location: {} },
]);

// Wo liegt der Marker in QUELL-Koordinaten (Zoom 4)? Das ist die Wahrheit, die waehrend der ganzen
// Animation gelten muss -- die Transform besorgt den Rest.
const quellX = welt(ORT, 4).x - welt(karte._ecke, 4).x;
const quellY = welt(ORT, 4).y - welt(karte._ecke, 4).y;

uhr = 1000;
karte.zoomeAnimiert(5, locationCanvasLayer);

// Ein Bild der Animation abarbeiten (die Haelfte der Zeit).
uhr = 1000 + AVESMAPS_ZOOM_DAUER_MS / 2;
const naechstes = bilder.filter(Boolean)[0];
assert.ok(typeof naechstes === "function",
	"💣 Der zoomanim hat keine Bildschleife gestartet -- die Gegenrechnung laeuft gar nicht.");
kontext.kreise.length = 0;
naechstes();

assert.ok(kontext.kreise.length > 0, "Im Bild wurde nichts gezeichnet.");
const gezeichnet = kontext.kreise[kontext.kreise.length - 1];

// 🔴 DIE ZUSICHERUNG, DIE DEN FEHLSCHLAG VOM 26.08.2026 GEFANGEN HAETTE.
assert.ok(Math.abs(gezeichnet.x - quellX) < 1e-6 && Math.abs(gezeichnet.y - quellY) < 1e-6,
	"💣 Waehrend der Zoom-Animation wird in ZIEL-Koordinaten gezeichnet (" + gezeichnet.x + ", "
	+ gezeichnet.y + ") statt in QUELL-Koordinaten (" + quellX + ", " + quellY + "). Leaflet hat "
	+ "map._zoom direkt nach dem zoomanim-Ereignis auf die Zielstufe gesetzt; der Canvas traegt "
	+ "aber die Transform, die Quell- auf Zielkoordinaten abbildet. Der Inhalt wuerde damit ZWEIMAL "
	+ "transformiert -- die Marker fliegen auseinander, und Marker von ausserhalb werden "
	+ "hereingezogen.");

// ---- Und die Groesse muss trotzdem gegengerechnet sein -----------------------------------------
// Bei der halben ZEIT ist der Weganteil der ease-in-out-Kurve genau 0,5.
{
	const e = avesmapsZoomEasing(0.5);
	const erwarteterFaktor = avesmapsMarkerZoomSizeFactor(TAFEL.metropole[4], TAFEL.metropole[5], e, 2);
	const kern = global.getLocationMarkerCoreRadius("metropole", 4);
	const treffer = kontext.kreise.some((k) => Math.abs(k.r - kern * erwarteterFaktor) < 1e-6);
	assert.ok(treffer,
		"💣 Die Groessen sind nicht gegengerechnet -- gezeichnete Radien "
		+ JSON.stringify(kontext.kreise.map((k) => +k.r.toFixed(3)))
		+ ", erwartet u.a. " + (kern * erwarteterFaktor).toFixed(3));
}

// ---- Am Ende der Animation landet er ohne Sprung ------------------------------------------------
uhr = 1000 + AVESMAPS_ZOOM_DAUER_MS;
const letztes = bilder.filter(Boolean).pop();
kontext.kreise.length = 0;
letztes();
{
	const kern = global.getLocationMarkerCoreRadius("metropole", 4);
	const zielKern = global.getLocationMarkerCoreRadius("metropole", 5);
	// scheinbar = gezeichnet x Massstab (2)
	const treffer = kontext.kreise.some((k) => Math.abs(k.r * 2 - zielKern) < 1e-6);
	assert.ok(treffer,
		"💣 Am Ende der Animation landet der Marker nicht auf seiner Zielgroesse. Gezeichnet "
		+ JSON.stringify(kontext.kreise.map((k) => +(k.r * 2).toFixed(3))) + ", erwartet "
		+ zielKern + " (Ausgangskern " + kern + ").");
}

// ---- Nach dem Zoom darf nichts von der Korrektur uebrig bleiben ---------------------------------
kontext.kreise.length = 0;
karte.feuere("zoomend");
assert.strictEqual(locationCanvasLayer._zoomGroessenFaktoren, null,
	"💣 Die Groessenkorrektur ueberlebt den Zoom -- danach zeichnete jeder Pan die Marker in einer "
	+ "Zwischengroesse, und zwar unauffaellig.");

// 🔴 UND DER LAGE-SCHNAPPSCHUSS MUSS AUCH WEG SEIN -- als VERHALTEN geprueft, nicht als Feld.
// Ueberlebte er den Zoom, klebten die Marker beim naechsten PAN an ihren alten Bildschirmstellen,
// waehrend die Karte darunter wegwandert. (Eine Mutationsprobe am 26.08.2026 hat genau diese
// Luecke gefunden: die Feldabfrage allein liess das Loeschen des Ruecksetzers durchgehen.)
{
	const zielX = welt(ORT, 5).x - welt(karte._ecke, 5).x;
	const zielY = welt(ORT, 5).y - welt(karte._ecke, 5).y;
	const nachDemZoom = kontext.kreise[kontext.kreise.length - 1];
	assert.ok(nachDemZoom, "Nach dem zoomend wurde nichts gezeichnet.");
	assert.ok(Math.abs(nachDemZoom.x - zielX) < 1e-6 && Math.abs(nachDemZoom.y - zielY) < 1e-6,
		"💣 Nach dem Zoom wird immer noch aus dem eingefrorenen Schnappschuss gezeichnet ("
		+ nachDemZoom.x + ", " + nachDemZoom.y + ") statt frisch projiziert (" + zielX + ", "
		+ zielY + "). Beim naechsten Pan klebten die Marker an ihren alten Stellen.");
	assert.strictEqual(locationCanvasLayer._zoomLagen, null,
		"💣 Der Lage-Schnappschuss ueberlebt den Zoom.");
}

console.log("marker-zoom-koordinaten.test.js: alle Zusicherungen erfuellt");

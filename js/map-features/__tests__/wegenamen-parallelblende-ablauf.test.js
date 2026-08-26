const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER PRUEFSTAND ZUM OWNER-BEFUND VOM 26.08.2026: „strassen und fluesse sind wieder kaputt --
// die gingen doch gerade" (davor: „flussnamen sind jetzt scheisse -- zuerst stabil, dann ploetzlich
// sprung auf neues"). Der Quelltext-Test daneben (wegenamen-parallelblende.test.js) war gegen seine
// Mutationen dicht und konnte diesen Fehler NIE sehen -- er prueft, DASS gerufen wird, nicht was
// zwei Bilder spaeter mit den gesetzten Uebergaengen passiert.
//
// 💣 DER FEHLER: zeichneJetzt() rief bei JEDEM Zeichnen pfadLabelBlendeEin() -- auch beim
// Vorabzeichnen im zoomanim. Deren Doppel-requestAnimationFrame feuerte ~2 Bilder nach dem
// Zoomstart und ueberschrieb die eben gesetzten Uebergaenge:
//   1. `vorne.style.transition = "opacity …"` OHNE transform -- eine laufende Transition, deren
//      Eigenschaft nicht mehr in der Liste steht, wird ABGEBROCHEN (CSS Transitions §3): die neue
//      Schrift sprang auf ihre Endlage und stand dann fest im Bild, waehrend die Karte darunter
//      noch 200 ms weiterzoomte. Die ganze Gegenrechnung (avesmapsZoomVorabFlaeche) war damit zur
//      Laufzeit wirkungslos -- getestet, gesetzt, und zwei Bilder spaeter weggeworfen.
//   2. `hinten.style.transition = "none"; hinten.style.opacity = "0"` -- das gestaffelte
//      Ausblenden der alten Schrift (AUSBLENDEN_MS) wurde nach ~2 Bildern hart gekappt.
// Beides betrifft NUR die Wegenamen: die Grenznamen zeichnen im zoomanim direkt
// (drawTerritoryBorderLabels) und rufen ihre Blende dabei nicht.
//
// ⭐ Bauform nach marker-zoom-koordinaten.test.js: eine Karte, die sich wie Leaflet verhaelt
// (erst zoomanim feuern, DANN den Zustand umstellen), und eine von Hand abgearbeitete
// rAF-Warteschlange als „Bilder waehrend des Zooms".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-parallelblende-ablauf.test.js

// ---- Weltmodell wie im Marker-Pruefstand -------------------------------------------------------
const welt = (latLng, zoom) => ({
	x: latLng.lng * Math.pow(2, zoom),
	y: latLng.lat * Math.pow(2, zoom),
});
function punkt(x, y) {
	return {
		x, y,
		subtract(p) { return punkt(x - p.x, y - p.y); },
		add(p) { return punkt(x + p.x, y + p.y); },
		round() { return punkt(Math.round(x), Math.round(y)); },
	};
}
function latLng(lat, lng) {
	return { lat, lng, equals(o) { return !!o && o.lat === lat && o.lng === lng; } };
}

function baueKarte(startZoom) {
	const zuhoerer = {};
	return {
		_zoom: startZoom,
		_ecke: latLng(0, 0),
		getZoom() { return this._zoom; },
		getZoomScale(ziel) { return Math.pow(2, ziel - this._zoom); },
		getSize() { return punkt(800, 600); },
		project(ll, zoom) { const w = welt(ll, zoom); return punkt(w.x, w.y); },
		unproject(p, zoom) { return latLng(p.y / Math.pow(2, zoom), p.x / Math.pow(2, zoom)); },
		latLngToLayerPoint(ll) { const w = welt(ll, this._zoom); return punkt(w.x, w.y); },
		latLngToContainerPoint(ll) { const w = welt(ll, this._zoom); return punkt(w.x, w.y); },
		containerPointToLayerPoint() { const w = welt(this._ecke, this._zoom); return punkt(w.x, w.y); },
		containerPointToLatLng() { return this._ecke; },
		_latLngToNewLayerPoint(ll, zoom) { const w = welt(ll, zoom); return punkt(w.x, w.y); },
		getPane(name) { return this._panes[name]; },
		createPane(name) { this._panes[name] = { style: {}, appendChild() {} }; },
		getContainer() { return { style: {} }; },
		on(namen, fn, ctx) {
			String(namen).split(" ").forEach((n) => { (zuhoerer[n] = zuhoerer[n] || []).push([fn, ctx]); });
		},
		feuere(name, ereignis) { (zuhoerer[name] || []).forEach(([fn, ctx]) => fn.call(ctx || this, ereignis)); },
		_panes: {},
		/**
		 * 💣 GENAU DAS, WAS LEAFLET TUT: erst zoomanim feuern, DANN den internen Zustand auf die
		 * Zielstufe setzen (_move). Ohne diese Reihenfolge prueft der Test nicht die Wirklichkeit.
		 */
		zoomeAnimiert(zielZoom) {
			this.feuere("zoomanim", { zoom: zielZoom, center: this._ecke });
			this._zoom = zielZoom;
		},
	};
}

// Zeichenkontext-Stummel -- gezeichnet wird hier nichts Pruefbares, es geht um die Uebergaenge.
const kontext = {
	canvas: { width: 800, height: 600 },
	setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, save() {}, restore() {},
	translate() {}, rotate() {}, fillText() {}, strokeText() {}, measureText: () => ({ width: 10 }),
	set fillStyle(v) {}, set strokeStyle(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
	set shadowColor(v) {}, set shadowBlur(v) {}, set lineJoin(v) {}, set lineCap(v) {}, set lineWidth(v) {},
};

// Canvas-Attrappen in ERZEUGUNGSREIHENFOLGE -- K[0] startet als `vorne`, K[1] als `hinten`;
// beim parallelen Zoomschritt tauschen die Rollen (die neue Schrift landet in K[1]).
const flaechen = [];
function baueCanvas() {
	const c = {
		style: {}, width: 0, height: 0,
		classList: { add() {} },
		getContext: () => kontext,
	};
	flaechen.push(c);
	return c;
}

// ---- Globale Umgebung --------------------------------------------------------------------------
const bilder = [];   // requestAnimationFrame-Warteschlange, von Hand abgearbeitet
function bilderAbarbeiten() {
	// Verschachtelte rAF (die Doppel-Anmeldung von pfadLabelBlendeEin) laufen mit -- jede Runde der
	// Schleife ist ein „Bild".
	let schutz = 0;
	while (bilder.length && schutz < 50) {
		const fn = bilder.shift();
		if (fn) { fn(); }
		schutz += 1;
	}
}

global.window = {
	location: { search: "?parallelfade=1" },
	setTimeout() { return 0; },   // die Erst-Redraw-Timer laufen im Pruefstand nicht
};
global.URLSearchParams = URLSearchParams;
global.document = {
	createElement: () => baueCanvas(),
	documentElement: { style: { setProperty() {} } },
	querySelectorAll: () => [],
};
global.performance = { now: () => 0 };
global.requestAnimationFrame = (fn) => { bilder.push(fn); return bilder.length; };
global.cancelAnimationFrame = () => {};
global.L = {
	point: (x, y) => punkt(x, y),
	latLng: (a, b) => latLng(a, b),
	DomUtil: {
		setPosition(el, p) { el.style.transform = "translate(" + p.x + "px, " + p.y + "px)"; },
		setTransform(el, p, massstab) {
			el.style.transform = "translate(" + p.x + "px, " + p.y + "px) scale(" + (massstab || 1) + ")";
		},
	},
};
global.avesmapsCanvasDpr = () => 1;

const karte = baueKarte(4);
global.map = karte;

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../zoom-uebergang.js"), "utf8"), { filename: "zoom-uebergang.js" });
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../map-features-path-label-canvas-overlay.js"), "utf8"),
	{ filename: "map-features-path-label-canvas-overlay.js" });

assert.strictEqual(flaechen.length, 2, "Das Overlay hat nicht genau zwei Beschriftungsflaechen gebaut.");
const K = flaechen;

// ---- Ausgangslage: ein normales Zeichnen setzt den Anker ---------------------------------------
global.window.AvesmapsPathLabelCanvasOverlay.redraw();
bilderAbarbeiten();   // die Blende des Erst-Zeichnens abraeumen -- sie gehoert nicht zum Zoomschritt
assert.strictEqual(K[0].style.opacity, "1", "Ausgangslage: die vordere Flaeche muss sichtbar sein.");
assert.strictEqual(K[1].style.opacity, "0", "Ausgangslage: die hintere Flaeche muss unsichtbar sein.");

// ---- Der Zoomschritt mit ?parallelfade=1 -------------------------------------------------------
karte.zoomeAnimiert(5);

// Unmittelbar nach dem zoomanim: die neue Schrift (K[1], nach dem Rollentausch `vorne`) traegt die
// Gegenrechnung -- Transform-Glide + verzoegertes Einblenden; die alte (K[0]) ihr gestaffeltes
// Ausblenden.
assert.ok(K[1].style.transition.includes("transform"),
	"Direkt nach dem zoomanim fehlt der neuen Schrift die Transform-Transition -- die Gegenrechnung "
	+ "wurde gar nicht erst gesetzt.");
assert.ok(K[0].style.transition.includes("opacity"),
	"Direkt nach dem zoomanim fehlt der alten Schrift ihr Ausblenden.");

// 💣 JETZT DIE BILDER WAEHREND DES ZOOMS. Hier feuerte die Doppel-Anmeldung von
// pfadLabelBlendeEin() aus dem Vorabzeichnen -- und loeschte beides wieder aus.
bilderAbarbeiten();

// 🔴 ZUSICHERUNG 1 (Entwurf 2026-08-26-zoom-uebergang-konsistenz-design.md §5): die neue Schrift
// GLEITET auf ihren Platz -- ihre Transform-Transition muss den ganzen Zoom ueberleben. Wird sie
// mitten im Zoom entfernt, bricht der Browser die laufende Transition ab (Eigenschaft nicht mehr
// in der Liste => Abbruch, kein Weiterlaufen), die Namen springen auf die Endlage und stehen dann
// fest im Bild, waehrend die Karte darunter weiterzoomt.
assert.ok(K[1].style.transition.includes("transform"),
	"💣 Waehrend des Zooms wurde die Transform-Transition der neuen Schrift entfernt (steht jetzt: \""
	+ K[1].style.transition + "\"). Der Browser bricht die laufende Transition damit ab -- die neue "
	+ "Schrift springt auf ihre Endlage und klebt am Bildschirm, waehrend die Karte weiterzoomt. "
	+ "Genau der Owner-Befund „strassen und fluesse sind wieder kaputt\".");

// 🔴 ZUSICHERUNG 2 (docs/kartenflaechen-und-zoomblenden.md §5a: gestaffelt, erst raus, dann rein):
// das Ausblenden der alten Schrift laeuft ueber AUSBLENDEN_MS -- es darf nicht zwei Bilder nach
// dem Start hart auf 0 gekappt werden.
assert.ok(K[0].style.transition.includes("opacity"),
	"💣 Waehrend des Zooms wurde das gestaffelte Ausblenden der alten Schrift gekappt (transition "
	+ "steht jetzt: \"" + K[0].style.transition + "\"). Die alte Schrift verschwindet damit in einem "
	+ "Bild statt ueber ihren Anteil der Zoomdauer.");

// ---- Und der Vorgabeweg (zoomend) muss weiter funktionieren ------------------------------------
karte.feuere("zoomend");
bilderAbarbeiten();
assert.strictEqual(K[1].style.opacity, "1",
	"Nach dem zoomend ist die neue Schrift nicht sichtbar -- das Einblenden ist verlorengegangen.");
assert.ok(!K[1].style.transition.includes("transform"),
	"💣 Nach dem zoomend traegt die sichtbare Flaeche noch eine Transform-Transition -- damit zieht "
	+ "jeder Pan die Position nach (Owner 24.08.2026: „die 2x nach\").");
assert.strictEqual(K[0].style.opacity, "0",
	"Nach dem zoomend ist die alte Schrift nicht weggeraeumt.");

console.log("wegenamen-parallelblende-ablauf.test.js: alle Zusicherungen erfuellt");

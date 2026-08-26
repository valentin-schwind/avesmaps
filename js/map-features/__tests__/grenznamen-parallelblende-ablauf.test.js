const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER AUSFUEHRENDE PRUEFSTAND FUER SCHRITT 3 (Grenznamen kommen WAEHREND des Zooms herein,
// ?parallelfade=1) -- das Gegenstueck zu wegenamen-parallelblende-ablauf.test.js. Anlass: Owner
// 26.08.2026 abends, „grenzbeschriftungen sind noch nicht im fading integriert -- frueher waren
// sie das". Der Quelltext-Test daneben (grenznamen-parallelblende.test.js) liest nur Text; ob der
// zoomanim-Pfad WIRKLICH durchlaeuft (kein Laufzeitfehler in drawTerritoryBorderLabels, kein
// spaeter Schreiber, der die Uebergaenge wieder ausloescht), kann nur Ausfuehrung zeigen -- bei
// den Wegenamen sass genau dort der Fehler, den zwoelf Quelltext-Mutationen nie gesehen haben.
//
// Gefahren wird der volle Weg: Init -> erster redraw (setzt den Anker) -> zoomanim wie Leaflet
// (erst Ereignis, DANN Zustand umstellen) -> rAF-Warteschlange als Bilder waehrend des Zooms ->
// zoomend -> Bilder danach. Die Tore des Vorabzeichnens sind alle offen: ?parallelfade=1,
// Ansicht "deregraphic", abgeleitete Geometrie vorhanden, Zielzoom >= TERRITORY_LABEL_MIN_ZOOM.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/grenznamen-parallelblende-ablauf.test.js

// ---- Weltmodell wie im Marker-/Wegenamen-Pruefstand --------------------------------------------
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
		/** 💣 Leaflets Reihenfolge: erst zoomanim feuern, DANN _move (Zustand aufs Ziel). */
		zoomeAnimiert(zielZoom) {
			this.feuere("zoomanim", { zoom: zielZoom, center: this._ecke });
			this._zoom = zielZoom;
		},
	};
}

// Zeichenkontext-Stummel.
const kontext = {
	canvas: { width: 800, height: 600 },
	setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, save() {},
	restore() {}, translate() {}, rotate() {}, fillText() {}, strokeText() {}, moveTo() {}, lineTo() {},
	closePath() {}, setLineDash() {}, clip() {}, rect() {}, quadraticCurveTo() {}, bezierCurveTo() {},
	ellipse() {}, createPattern: () => null, measureText: () => ({ width: 10 }),
	set fillStyle(v) {}, set strokeStyle(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
	set shadowColor(v) {}, set shadowBlur(v) {}, set lineJoin(v) {}, set lineCap(v) {}, set lineWidth(v) {},
	set globalAlpha(v) {},
};

// Canvas-Attrappen in Erzeugungsreihenfolge: [0] Linien, [1] und [2] die zwei Beschriftungsflaechen
// (labelVorne startet auf [1], beim parallelen Zoomschritt tauschen die Rollen auf [2]).
const flaechen = [];
function baueCanvas() {
	const style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ""; } };
	const c = { style, width: 0, height: 0, classList: { add() {} }, getContext: () => kontext };
	flaechen.push(c);
	return c;
}

// ---- Globale Umgebung --------------------------------------------------------------------------
const bilder = [];
function bilderAbarbeiten() {
	let schutz = 0;
	while (bilder.length && schutz < 50) {
		const fn = bilder.shift();
		if (fn) { fn(); }
		schutz += 1;
	}
}

global.window = {
	location: { search: "?parallelfade=1" },
	setTimeout() { return 0; },   // settle-Redraw-Timer laufen im Pruefstand nicht
	setInterval() { return 0; },  // der Daten-Nachlade-Puls ebensowenig
	// Eine abgeleitete Aussengrenze mit kleinem Ring (< 8 Punkte): oeffnet hasDerivedData(), und
	// drawTerritoryBorderLabels steigt je Feature sauber aus, ohne zu zeichnen.
	regionData: [{
		properties: { is_derived_geometry: true, name: "Testreich" },
		geometry: { type: "Polygon", coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] },
	}],
};
global.URLSearchParams = URLSearchParams;
global.document = {
	createElement: () => baueCanvas(),
	documentElement: { style: { setProperty() {} } },
	getElementById: () => null,
	querySelector: () => null,
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
global.BOUNDARY_OVERLAY_MODES = ["political", "deregraphic"];   // aus js/config.js
// Ansicht umschaltbar: der erste redraw laeuft in "none" (nur Anker setzen), der Zoomschritt in
// "deregraphic" -- der einzigen Ansicht mit Grenzbeschriftungen.
let ansicht = "none";
global.getSelectedMapLayerMode = () => ansicht;

const karte = baueKarte(4);
global.map = karte;

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../zoom-uebergang.js"), "utf8"), { filename: "zoom-uebergang.js" });
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../map-features-boundary-canvas-overlay.js"), "utf8"),
	{ filename: "map-features-boundary-canvas-overlay.js" });

assert.strictEqual(flaechen.length, 3,
	"Das Overlay hat nicht drei Flaechen gebaut (Linien + zwei Beschriftungen).");
const LV = flaechen[1];   // labelVorne beim Start
const LH = flaechen[2];   // labelHinten beim Start

// ---- Ausgangslage: ein redraw setzt den Anker (canvasTopLeftLatLng) ----------------------------
global.window.AvesmapsBoundaryCanvasOverlay.redraw();
bilderAbarbeiten();

// ---- Der Zoomschritt mit offenen Toren ---------------------------------------------------------
ansicht = "deregraphic";
karte.zoomeAnimiert(5);

// Nach dem Rollentausch ist LH die einblendende Flaeche, LV die ausgehende.
assert.ok(LH.style.transition && LH.style.transition.includes("transform")
	&& LH.style.transition.includes("opacity"),
	"💣 Nach dem zoomanim traegt die einblendende Flaeche nicht Transform-Glide UND gestaffelte "
	+ "Deckkraft (steht: \"" + LH.style.transition + "\") -- der Grenznamen-Parallelpfad ist nicht "
	+ "durchgelaufen. Wenn hier stattdessen schon eine Ausnahme geflogen ist: genau die wuerde den "
	+ "Pfad live stumm toeten (Owner: 'grenzbeschriftungen sind noch nicht im fading integriert').");
assert.strictEqual(LH.style.opacity, "1",
	"Die einblendende Flaeche steht nach dem zoomanim nicht auf opacity 1 -- kein Einblenden gesetzt.");
assert.strictEqual(LV.style.opacity, "0",
	"Die ausgehende Flaeche blendet nicht aus (opacity muesste 0 sein).");
assert.ok(String(LV.style["--border-label-fade-out"] || "").endsWith("ms"),
	"Die Ausblende-Dauer (--border-label-fade-out) wurde nicht vor dem Start gesetzt.");

// 💣 Bilder WAEHREND des Zooms: hier darf KEIN nachlaufender Schreiber die Uebergaenge ausloeschen
// (bei den Wegenamen sass genau dort die Doppelanmeldung von pfadLabelBlendeEin).
bilderAbarbeiten();
assert.ok(LH.style.transition.includes("transform"),
	"💣 Waehrend des Zooms wurde die Transform-Transition der einblendenden Flaeche entfernt -- die "
	+ "neue Schrift springt auf ihre Endlage und klebt am Bildschirm, waehrend die Karte weiterzoomt.");
assert.ok(LH.style.transition.includes("opacity"),
	"💣 Waehrend des Zooms wurde die Deckkraft-Staffelung der einblendenden Flaeche entfernt.");

// ---- zoomend: Aufraeumen + redraw duerfen das Ergebnis nicht zuruecknehmen ---------------------
karte.feuere("zoomend");
bilderAbarbeiten();
assert.strictEqual(LH.style.transition, "",
	"Nach dem zoomend ist die Inline-Transition nicht geloescht -- jeder Pan zoege die Position nach.");
assert.strictEqual(LH.style.opacity, "1",
	"Nach dem zoomend ist die neue Schrift nicht sichtbar.");
assert.strictEqual(LV.style.opacity, "0",
	"Nach dem zoomend ist die alte Schrift nicht weggeraeumt.");

console.log("grenznamen-parallelblende-ablauf.test.js: alle Zusicherungen erfuellt");

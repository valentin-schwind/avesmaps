// Die linke Maustaste ist beim Zeichnen doppelt belegt (Owner 26.08.2026: „Wenn ich Vegetation
// zeichnen möchte, wird manchmal der Klick als Scrolling interpretiert, aber kein Punkt gesetzt").
//
// Leaflet wertet einen gedrueckten Klick ab `clickTolerance` (Standard 3) Pixeln MANHATTAN-Bewegung
// (|dx|+|dy|, Draggable._onMove) als Karten-Ziehen -- danach schluckt Map._draggableMoved den Klick,
// und der Punkt entsteht nie. Waehrend einer Zeichen-/Bearbeitungssitzung gilt deshalb eine
// groessere Toleranz -- gemerkt und beim Schliessen WIEDERHERGESTELLT, nie global veraendert
// (dieselbe Regel wie beim Doppelklick-Zoom, Owner: „nur beim editieren von flächen").
//
// ZUR LAUFZEIT gefahren: die echten start/stop- bzw. open/close-Wege der drei Flaechenwerkzeuge
// laufen im vm-Kontext, und gemessen wird die Toleranz an der Draggable-Attrappe.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral (AGENTS.md §9): Arbeitskopie CRLF, CI LF.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");

function schneideFunktion(quelltext, name) {
	const start = quelltext.indexOf(`\nfunction ${name}(`);
	assert.ok(start >= 0, `function ${name} nicht gefunden`);
	// Erst die PARAMETERKLAMMER zu Ende zaehlen -- eine Destrukturierung im Kopf
	// (`{ flush = true } = {}`) traegt sonst die erste geschweifte Klammer, und der Schnitt
	// endet vor dem Rumpf.
	let klammern = 0;
	let rumpfSuche = quelltext.indexOf("(", start);
	for (; rumpfSuche < quelltext.length; rumpfSuche += 1) {
		if (quelltext[rumpfSuche] === "(") klammern += 1;
		else if (quelltext[rumpfSuche] === ")") {
			klammern -= 1;
			if (klammern === 0) { rumpfSuche += 1; break; }
		}
	}
	let tiefe = 0;
	let ende = quelltext.indexOf("{", rumpfSuche);
	for (; ende < quelltext.length; ende += 1) {
		if (quelltext[ende] === "{") tiefe += 1;
		else if (quelltext[ende] === "}") {
			tiefe -= 1;
			if (tiefe === 0) { ende += 1; break; }
		}
	}
	return quelltext.slice(start, ende);
}

const mapFeaturesQuelle = lies("js/map-features/map-features.js");

// Der Sitzungswert kommt aus der QUELLE, nicht als abgeschriebene Zahl.
const wertTreffer = mapFeaturesQuelle.match(/const AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX = (\d+)/);
assert.ok(wertTreffer, "AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX nicht in map-features.js gefunden");
const SITZUNGSWERT = Number(wertTreffer[1]);
const LEAFLET_STANDARD = 3;
assert.ok(SITZUNGSWERT > LEAFLET_STANDARD,
	"die Sitzungstoleranz muss ueber Leaflets Standard (3) liegen, sonst aendert sie nichts");

// ---- Buehne ---------------------------------------------------------------------------------------

function baueDraggable() {
	return { options: { clickTolerance: LEAFLET_STANDARD } };
}

function baueMap() {
	const handler = new Map();
	return {
		_handler: handler,
		on(typ, fn) { if (!handler.has(typ)) handler.set(typ, []); handler.get(typ).push(fn); },
		off(typ, fn) { const l = handler.get(typ) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
		addLayer() {}, removeLayer() {}, hasLayer: () => false,
		getContainer: () => ({ classList: { add() {}, remove() {} } }),
		dragging: { _draggable: baueDraggable() },
		doubleClickZoom: { _an: true, enable() { this._an = true; }, disable() { this._an = false; }, enabled() { return this._an; } },
	};
}

const toleranzVon = (mapAttrappe) => mapAttrappe.dragging._draggable.options.clickTolerance;

// ---- A. Der Helfer selbst (ausgeschnitten und AUSGEFUEHRT) ---------------------------------------

{
	const map = baueMap();
	const kontext = { map, console };
	vm.createContext(kontext);
	vm.runInContext([
		`const AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX = ${SITZUNGSWERT};`,
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzAnheben"),
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzZuruecknehmen"),
	].join("\n;\n"), kontext);

	kontext.avesmapsWerkzeugKlickToleranzAnheben();
	assert.strictEqual(toleranzVon(map), SITZUNGSWERT, "Anheben setzt die Sitzungstoleranz");

	// 💣 Idempotenz: hebt ein zweites Werkzeug an, ohne dass das erste zuruecknahm, darf der
	// gemerkte Urzustand nicht mit dem Sitzungswert ueberschrieben werden.
	kontext.avesmapsWerkzeugKlickToleranzAnheben();
	kontext.avesmapsWerkzeugKlickToleranzZuruecknehmen();
	assert.strictEqual(toleranzVon(map), LEAFLET_STANDARD,
		"Zuruecknehmen stellt den GEMERKTEN Urzustand her -- auch nach doppeltem Anheben");

	// Zuruecknehmen ohne Anheben: kein Wurf, keine Veraenderung.
	kontext.avesmapsWerkzeugKlickToleranzZuruecknehmen();
	assert.strictEqual(toleranzVon(map), LEAFLET_STANDARD, "ohne offene Sitzung aendert die Ruecknahme nichts");

	// Ohne Draggable (dragging nie aktiviert): beide Wege duerfen nicht werfen.
	kontext.map = { dragging: {} };
	kontext.avesmapsWerkzeugKlickToleranzAnheben();
	kontext.avesmapsWerkzeugKlickToleranzZuruecknehmen();
	kontext.map = map;
}

// ---- B. Landschaften-Zeichnen (der gemeldete Fall) ------------------------------------------------

{
	const map = baueMap();
	const kontext = {
		console, JSON, Math, Number, String, Boolean, Array, Object, Promise,
		document: { addEventListener() {}, removeEventListener() {}, documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
		map,
		L: { latLng: (a, b) => (typeof a === "object" ? { lat: a.lat, lng: a.lng } : { lat: a, lng: b }) },
		performance: { now: () => 0 },
		isEcosystemLayerModeActive: () => true,
		closeEcosystemGeometryEdit() {},
		setSelectedEcosystemArea() {},
		syncEcosystemMapEditingClass() {},
		syncEcosystemDoubleClickZoom() {},
		clearEcosystemEditSnapPreview() {},
		renderEcosystemEditSnapPreview() {},
		ecosystemEditSnapTarget: () => null,
		isEcosystemEditDetachModifier: () => false,
		showFeedbackToast() {},
		avesmapsWerkzeugKlickToleranzAnheben: null,   // kommt gleich aus map-features.js
		avesmapsWerkzeugKlickToleranzZuruecknehmen: null,
	};
	kontext.window = {};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext([
		`const AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX = ${SITZUNGSWERT};`,
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzAnheben"),
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzZuruecknehmen"),
		lies("js/map-features/map-features-ecosystem-draw.js"),
	].join("\n;\n"), kontext);

	kontext.startEcosystemAreaDrawing();
	assert.strictEqual(toleranzVon(map), SITZUNGSWERT,
		"waehrend des Zeichnens gilt die Sitzungstoleranz -- ein verwackelter Klick setzt den Punkt statt zu schieben");
	kontext.stopEcosystemAreaDrawing();
	assert.strictEqual(toleranzVon(map), LEAFLET_STANDARD,
		"nach dem Zeichnen gilt wieder Leaflets Standard -- nie global veraendert");
}

// ---- C. Landschaften-Eckeneditor (Strg+Klick setzt Ecken -- dieselbe Falle) -----------------------

{
	const map = baueMap();
	const ecosystemEditQuelle = lies("js/map-features/map-features-ecosystem-edit.js");
	const layer = {
		_ecosystemArea: {
			public_id: "flaeche-1",
			kind: "vegetation",
			geometry_revision: 1,
			geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
		},
		on() {}, off() {},
	};
	const kontext = {
		// 💣 `Map` ausdruecklich aus DIESEM Realm: openEcosystemGeometryEdit prueft
		// `ecosystemLayers instanceof Map`, und eine Host-Map faellt am vm-eigenen Map durch.
		console, JSON, Math, Number, String, Boolean, Array, Object, Promise, Map,
		map,
		window: { clearTimeout() {}, setTimeout: () => 0 },
		activeEcosystemGeometryEdit: null,
		ecosystemGeometrySaveTimeoutId: null,
		ecosystemLayers: new Map([["flaeche-1", layer]]),
		setSelectedEcosystemArea() {},
		isDerivedEcosystemKind: () => false,
		applyEcosystemEditClass() {},
		syncEcosystemMapEditingClass() {},
		syncEcosystemDoubleClickZoom() {},
		refreshEcosystemEditHandles() {},
		clearEcosystemEditHandles() {},
		clearEcosystemEditEdgeHover() {},
		clearEcosystemEditSnapPreview() {},
		flushEcosystemGeometrySave: () => Promise.resolve(),
		sayEcosystemEdit() {},
		handleEcosystemEditEdgeClick() {},
		handleEcosystemEditMouseMove() {},
		handleEcosystemEditFinishDoubleClick() {},
		avesmapsWerkzeugKlickToleranzAnheben: null,
		avesmapsWerkzeugKlickToleranzZuruecknehmen: null,
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext([
		`const AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX = ${SITZUNGSWERT};`,
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzAnheben"),
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzZuruecknehmen"),
		schneideFunktion(ecosystemEditQuelle, "openEcosystemGeometryEdit"),
		schneideFunktion(ecosystemEditQuelle, "closeEcosystemGeometryEdit"),
	].join("\n;\n"), kontext);

	kontext.openEcosystemGeometryEdit("flaeche-1");
	assert.ok(kontext.activeEcosystemGeometryEdit, "Vorbedingung: die Sitzung ist wirklich offen");
	assert.strictEqual(toleranzVon(map), SITZUNGSWERT, "im Eckeneditor gilt die Sitzungstoleranz");
	kontext.closeEcosystemGeometryEdit({ flush: false });
	assert.strictEqual(toleranzVon(map), LEAFLET_STANDARD, "nach dem Eckeneditor gilt wieder der Standard");
}

// ---- D. Regionen/Territorien-Werkzeug (start + BEIDE clear-Fassungen) -----------------------------

{
	const map = baueMap();
	const punkt = (x, y) => ({ x, y, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y); } });
	const latLng = (a, b) => {
		const lat = (typeof a === "object" && a) ? a.lat : a;
		const lng = (typeof a === "object" && a) ? a.lng : b;
		return { lat, lng, distanceTo(o) { return Math.hypot(this.lat - o.lat, this.lng - o.lng); } };
	};
	map.latLngToContainerPoint = (ll) => punkt(ll.lng, ll.lat);
	map.containerPointToLatLng = (p) => latLng(p.y, p.x);
	const kontext = {
		console, JSON, Math, Number, String, Boolean, Array, Object, Promise,
		document: { addEventListener() {}, removeEventListener() {} },
		map,
		L: {
			latLng, point: punkt,
			divIcon: (o) => o,
			polyline: () => ({ setLatLngs() {}, on() {}, addTo() { return this; } }),
			DomEvent: { stop() {}, preventDefault() {}, stopPropagation() {}, disableClickPropagation() {}, disableScrollPropagation() {} },
		},
		activeRegionGeometryEdit: null,
		REGION_EDIT_EDGE_HIT_TOLERANCE_PX: 22,
		cancelPoliticalTerritoryLayerReload() {},
		acquireFeatureSoftLock: () => Promise.resolve(),
		releaseFeatureSoftLock: () => Promise.resolve(),
		refreshRegionEditHandles() {},
		updateRegionLabelPosition() {},
		scheduleRegionGeometrySave() {},
		pushRegionGeometryUndoStep() {},
		flushRegionGeometrySaves() {},
		clearRegionEditSnapPreview() {},
		renderRegionEditSnapPreview() {},
		findNearestRegionSnapPoint: () => null,
		applySharedBoundaryVertexMove: () => [],
		showFeedbackToast() {},
		avesmapsWerkzeugKlickToleranzAnheben: null,
		avesmapsWerkzeugKlickToleranzZuruecknehmen: null,
	};
	kontext.window = {
		setTimeout() { throw new Error("der Override haette sofort installieren muessen"); },
		addEventListener() {},
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext([
		`const AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX = ${SITZUNGSWERT};`,
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzAnheben"),
		schneideFunktion(mapFeaturesQuelle, "avesmapsWerkzeugKlickToleranzZuruecknehmen"),
		lies("js/map-features/map-features-region-geometry-helpers.js"),
		lies("js/map-features/map-features-region-edit-edge-controls.js"),
		lies("js/map-features/map-features-region-geometry-edit-lifecycle.js"),
		";window.refreshRegionEditHandles = refreshRegionEditHandles;\nwindow.handleRegionEditMouseMove = handleRegionEditMouseMove;",
		lies("js/map-features/map-features-region-vertex-detach-edit.js"),
	].join("\n;\n"), kontext);
	assert.strictEqual(typeof kontext.window.clearRegionGeometryEdit, "function",
		"der Laufzeit-Override (vertex-detach-edit) hat nicht installiert");

	const gebiet = {
		publicId: "pt-1",
		source: "political_territory",
		layer: {
			_ringe: [[latLng(0, 0), latLng(0, 10), latLng(10, 10), latLng(10, 0)]],
			getLatLngs() { return this._ringe; },
			setLatLngs(r) { this._ringe = r; },
			setStyle() {}, bringToFront() {}, options: {},
		},
	};

	kontext.startRegionGeometryEdit(gebiet);
	assert.strictEqual(toleranzVon(map), SITZUNGSWERT, "im Regionen/Territorien-Werkzeug gilt die Sitzungstoleranz");
	kontext.window.clearRegionGeometryEdit();
	assert.strictEqual(toleranzVon(map), LEAFLET_STANDARD, "die Override-Fassung von clear stellt den Standard her");

	kontext.startRegionGeometryEdit(gebiet);
	assert.strictEqual(toleranzVon(map), SITZUNGSWERT);
	kontext.clearRegionGeometryEdit();
	assert.strictEqual(toleranzVon(map), LEAFLET_STANDARD,
		"die Fallback-Fassung von clear stellt den Standard ebenso her -- je nach Ladezeitpunkt ist sie die installierte");
}

console.log("ok - werkzeug-klick-toleranz");

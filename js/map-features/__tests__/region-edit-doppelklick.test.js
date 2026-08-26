// Doppelklick beim Formen von Regionen und Territorien (Owner 26.08.2026: „Punkte setzen und
// Scrollen durch Doppelklick sind sehr nah beieinander").
//
// Zwei Zusagen, beide ZUR LAUFZEIT gefahren, nicht per Grep -- die echten Dateien laufen in einem
// vm-Kontext, und die Ereignisse gehen durch die echten Handler:
//
//  1. Der Doppelklick-Zoom ist NUR waehrend einer offenen Geometrie-Sitzung aus (Owner, woertlich:
//     „nicht dass du den doppelklick insgesamt abstellst - nur beim editieren von flächen").
//     Beim Schliessen kommt der GEMERKTE Zustand zurueck, nicht stumpf enable().
//     💣 clearRegionGeometryEdit gibt es ZWEIMAL: die Fallback-Fassung (geometry-edit-lifecycle)
//     und den Laufzeit-Override (vertex-detach-edit, der gewinnt). BEIDE muessen wiederherstellen
//     -- „either may be the one actually installed" steht als Regel schon an deren dragstart.
//
//  2. Ein Doppelklick NEBEN der Flaeche setzt die Ecke trotzdem, wenn die naechste Kante innerhalb
//     REGION_EDIT_EDGE_HIT_TOLERANCE_PX liegt -- vorher entschied die Polygonkante selbst, und ein
//     Pixel ausserhalb zoomte die Karte bzw. wechselte die Sitzung auf den Nachbarn. Die Suche geht
//     ueber ALLE Ringe: ein Doppelklick im LOCH nahe der Lochkante gehoert der Lochkante, nicht dem
//     Aussenring (ein Klick im Loch trifft nie die Flaeche -- Leaflet fuellt Loecher nicht).

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral lesen (AGENTS.md §9): die Arbeitskopie traegt CRLF, die CI legt LF hin.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");

const mapFeaturesQuelle = lies("js/map-features/map-features.js");

// Die Toleranz kommt aus der QUELLE, nicht als abgeschriebene Zahl -- sonst misst der Test nach
// einer Aenderung der Konstante weiter den alten Wert.
const toleranzTreffer = mapFeaturesQuelle.match(/const REGION_EDIT_EDGE_HIT_TOLERANCE_PX = (\d+)/);
assert.ok(toleranzTreffer, "REGION_EDIT_EDGE_HIT_TOLERANCE_PX nicht in map-features.js gefunden");
const TOLERANZ = Number(toleranzTreffer[1]);

// map-features.js laedt als Ganzes zu viel Buehne -- der eine Erzeuger wird AUSGESCHNITTEN und
// AUSGEFUEHRT (die Lehre aus quelltexttest-trifft-die-definitionszeile-mit: nicht per includes()
// auf die Definitionszeile hereinfallen, sondern den Code laufen lassen).
function schneideFunktion(quelltext, name) {
	const start = quelltext.indexOf(`\nfunction ${name}(`);
	assert.ok(start >= 0, `function ${name} nicht gefunden`);
	let tiefe = 0;
	let ende = quelltext.indexOf("{", start);
	for (; ende < quelltext.length; ende += 1) {
		if (quelltext[ende] === "{") tiefe += 1;
		else if (quelltext[ende] === "}") {
			tiefe -= 1;
			if (tiefe === 0) { ende += 1; break; }
		}
	}
	return quelltext.slice(start, ende);
}

// ---- Die Buehne: gerade so viel Leaflet und Karte, dass die echten Handler laufen ----------------

function punkt(x, y) {
	return { x, y, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y); } };
}
function latLng(a, b) {
	const lat = (typeof a === "object" && a) ? a.lat : a;
	const lng = (typeof a === "object" && a) ? a.lng : b;
	return { lat, lng, distanceTo(o) { return Math.hypot(this.lat - o.lat, this.lng - o.lng); } };
}

const mapHandler = new Map();
const map = {
	on(typ, fn) {
		if (!mapHandler.has(typ)) mapHandler.set(typ, []);
		mapHandler.get(typ).push(fn);
	},
	off(typ, fn) {
		const liste = mapHandler.get(typ) || [];
		const i = liste.indexOf(fn);
		if (i >= 0) liste.splice(i, 1);
	},
	// 1:1-Projektion (L.CRS.Simple im Massstab dieses Tests): Karteneinheit == Pixel, x=lng, y=lat.
	latLngToContainerPoint: (ll) => punkt(ll.lng, ll.lat),
	containerPointToLatLng: (p) => latLng(p.y, p.x),
	addLayer() {}, removeLayer() {}, hasLayer: () => false,
	doubleClickZoom: {
		_an: true,
		enable() { this._an = true; },
		disable() { this._an = false; },
		enabled() { return this._an; },
	},
};

const L = {
	latLng,
	point: punkt,
	polyline: () => ({ setLatLngs() {}, on() {}, addTo() { return this; } }),
	circleMarker: () => ({ addTo() { return this; } }),
	layerGroup: () => ({ addTo() { return this; } }),
	divIcon: (o) => o,
	marker: () => { throw new Error("L.marker darf hier nie gebraucht werden -- refreshRegionEditHandles ist Attrappe"); },
	DomEvent: {
		stop(e) { e.__gestoppt = true; if (e.originalEvent) e.originalEvent._stopped = true; },
		preventDefault() {},
		stopPropagation() {},
		disableClickPropagation() {},
		disableScrollPropagation() {},
	},
};

const gemerkteSaves = [];
const kontext = {
	console, Math, JSON, Number, String, Boolean, Array, Object, Promise,
	document: { addEventListener() {}, removeEventListener() {} },
	map, L,
	activeRegionGeometryEdit: null,
	// Die Konstante steht in map-features.js, das hier nicht als Ganzes laedt -- der Wert oben ist
	// aus derselben Quelle gelesen.
	REGION_EDIT_EDGE_HIT_TOLERANCE_PX: TOLERANZ,
	cancelPoliticalTerritoryLayerReload() {},
	acquireFeatureSoftLock: () => Promise.resolve(),
	releaseFeatureSoftLock: () => Promise.resolve(),
	refreshRegionEditHandles() {},
	updateRegionLabelPosition() {},
	scheduleRegionGeometrySave(eintrag) { gemerkteSaves.push(eintrag); },
	pushRegionGeometryUndoStep() {},
	flushRegionGeometrySaves() {},
	clearRegionEditSnapPreview() {},
	renderRegionEditSnapPreview() {},
	findNearestRegionSnapPoint: () => null,
	applySharedBoundaryVertexMove: () => [],
	showFeedbackToast() {},
};
kontext.window = {
	// Der Install des Laufzeit-Overrides gelingt unten sofort -- die Warteschleife darf nie anlaufen.
	setTimeout() { throw new Error("der Override haette sofort installieren muessen"); },
	addEventListener() {},
};
kontext.globalThis = kontext;
vm.createContext(kontext);

vm.runInContext([
	lies("js/map-features/map-features-region-geometry-helpers.js"),
	lies("js/map-features/map-features-region-edit-edge-controls.js"),
	lies("js/map-features/map-features-region-geometry-edit-lifecycle.js"),
	// Im Browser sind Top-Level-Funktionsdeklarationen window-Eigenschaften; im vm nicht. Der
	// Override prueft window.* vor dem Install -- hier gespiegelt.
	";window.refreshRegionEditHandles = refreshRegionEditHandles;\nwindow.handleRegionEditMouseMove = handleRegionEditMouseMove;",
	lies("js/map-features/map-features-region-vertex-detach-edit.js"),
	schneideFunktion(mapFeaturesQuelle, "handleEditableRegionDoubleClick"),
].join("\n;\n"), kontext);

assert.strictEqual(typeof kontext.window.clearRegionGeometryEdit, "function",
	"der Laufzeit-Override (vertex-detach-edit) hat nicht installiert -- damit prueft der Test die falsche Fassung");

// ---- Fixture: Aussenring (0..100) mit Loch (40..60) ----------------------------------------------

function polygonAttrappe(ringe) {
	return {
		_ringe: ringe,
		getLatLngs() { return this._ringe; },
		setLatLngs(r) { this._ringe = r; },
		setStyle() {},
		bringToFront() {},
		options: {},
	};
}

const gebiet = {
	publicId: "pt-test",
	source: "political_territory",
	layer: polygonAttrappe([
		[latLng(0, 0), latLng(0, 100), latLng(100, 100), latLng(100, 0)],
		[latLng(40, 40), latLng(40, 60), latLng(60, 60), latLng(60, 40)],
	]),
};

const dblclickListe = () => (mapHandler.get("dblclick") || []);
function feuerDblclick(latlng, originalEvent = {}) {
	const ereignis = {
		latlng: latLng(latlng.lat, latlng.lng),
		originalEvent: { ctrlKey: false, target: { closest: () => null }, ...originalEvent },
	};
	// Schnappschuss: der Erzeuger meldet den Handler waehrend des Laufs ab und wieder an.
	[...dblclickListe()].forEach((fn) => fn(ereignis));
	return ereignis;
}
const ringe = () => kontext.getPolygonLatLngRings(gebiet.layer);

// ---- 1. Sitzung auf: Doppelklick-Zoom aus, GENAU EIN dblclick-Handler an der Karte ---------------

assert.strictEqual(map.doubleClickZoom.enabled(), true, "Vorbedingung: Zoom an");
kontext.startRegionGeometryEdit(gebiet);
assert.strictEqual(map.doubleClickZoom.enabled(), false,
	"Sitzung offen -> Doppelklick-Zoom aus (nur fuer die Dauer der Sitzung, nie global)");
assert.strictEqual(dblclickListe().length, 1, "die Sitzung bindet genau EINEN dblclick an der Karte");

// ---- 2. Doppelklick WEITER als die Toleranz: nichts passiert -------------------------------------

const fern = feuerDblclick({ lat: -(TOLERANZ + 30), lng: 50 });
assert.strictEqual(ringe()[0].length, 4, "jenseits der Toleranz wird keine Ecke gesetzt");
assert.ok(!fern.__gestoppt, "und das Ereignis bleibt unangetastet");

// ---- 3. Strg+Doppelklick gehoert der Kanten-Unterteilung, nicht diesem Tor -----------------------

feuerDblclick({ lat: -10, lng: 50 }, { ctrlKey: true });
assert.strictEqual(ringe()[0].length, 4, "Strg+Doppelklick setzt hier keine Ecke");

// ---- 4. Ziel ist ein Griff-Element: dessen eigener Doppelklick loescht, das Tor schweigt ---------

feuerDblclick({ lat: -10, lng: 50 }, {
	target: { closest: (sel) => (sel === ".region-edit-handle-marker" ? {} : null) },
});
assert.strictEqual(ringe()[0].length, 4, "ein Griff-Doppelklick darf nicht ZUSAETZLICH eine Ecke setzen");

// ---- 5. Doppelklick NEBEN der Kante, innerhalb der Toleranz: Ecke am gezielten Punkt -------------

const nah = feuerDblclick({ lat: -10, lng: 50 });
assert.strictEqual(ringe()[0].length, 5, "innerhalb der Toleranz wird die Ecke gesetzt");
assert.deepStrictEqual(
	{ lat: ringe()[0][1].lat, lng: ringe()[0][1].lng },
	{ lat: -10, lng: 50 },
	"am GEZIELTEN Punkt, eingereiht an der getroffenen Kante",
);
assert.strictEqual(nah.__gestoppt, true, "und das Ereignis ist gestoppt");
assert.ok(gemerkteSaves.includes(gebiet), "der Save laeuft gebuendelt an, wie bei jeder Eckenarbeit");

// ---- 6. Doppelklick im LOCH nahe der Lochkante: die Ecke gehoert dem Lochring --------------------
// (45,50) liegt IM Loch -- im Browser faellt so ein Klick durch die ungefuellte Flaeche auf die
// Karte. Naechste Kante: die Lochkante bei lng=40 (Abstand 5); der Aussenring ist 45 entfernt.

feuerDblclick({ lat: 50, lng: 45 });
assert.strictEqual(ringe()[1].length, 5, "die Ecke sitzt im LOCHRING");
assert.strictEqual(ringe()[0].length, 5, "und der Aussenring ist unangetastet");
const lochEcke = ringe()[1].some((ll) => ll.lat === 50 && ll.lng === 45);
assert.ok(lochEcke, "am gezielten Punkt im Lochring");

// ---- 7. Sitzung zu (LAUFZEIT-Override, die gewinnende Fassung): Zoom kommt zurueck ---------------

kontext.window.clearRegionGeometryEdit();
assert.strictEqual(map.doubleClickZoom.enabled(), true,
	"Override-Fassung: der gemerkte Zoom ist nach der Sitzung zurueck");
assert.strictEqual(dblclickListe().length, 0, "und der dblclick-Handler ist abgemeldet");
assert.strictEqual(kontext.activeRegionGeometryEdit, null, "die Sitzung ist wirklich zu");

// ---- 8. Dieselbe Zusage fuer die FALLBACK-Fassung ------------------------------------------------

kontext.startRegionGeometryEdit(gebiet);
assert.strictEqual(map.doubleClickZoom.enabled(), false);
kontext.clearRegionGeometryEdit();
assert.strictEqual(map.doubleClickZoom.enabled(), true,
	"Fallback-Fassung: stellt den Zoom ebenso wieder her -- je nach Ladezeitpunkt ist sie die installierte");

// ---- 9. WIEDERHERGESTELLT heisst nicht enable(): war er vorher aus, bleibt er aus ----------------

map.doubleClickZoom.disable();
kontext.startRegionGeometryEdit(gebiet);
assert.strictEqual(map.doubleClickZoom.enabled(), false);
kontext.window.clearRegionGeometryEdit();
assert.strictEqual(map.doubleClickZoom.enabled(), false,
	"war der Zoom beim Einstieg schon aus, laesst das Schliessen ihn aus (kein blindes enable)");
map.doubleClickZoom.enable();

// ---- 10. Verdrahtung, die der vm nicht fahren kann (kommentarbereinigt gezaehlt) -----------------
// Der Fremdflaechen-Zweig: beim Nachziehen einer gemeinsamen Grenze liegt der NACHBAR unter dem
// Klick, und ohne das Tor wechselte ausgerechnet der Klick an der Kante die Sitzung.

function ohneKommentare(quelltext) {
	return quelltext
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/([^:"'])\/\/.*$/gm, "$1")
		.replace(/^\/\/.*$/gm, "");
}

const mfBereinigt = ohneKommentare(mapFeaturesQuelle);
assert.strictEqual(
	(mfBereinigt.match(/regionEditDoubleClickSetsCorner\(event\)/g) || []).length,
	1,
	"der Doppelklick auf einer FREMDEN Flaeche fragt das Kanten-Tor, bevor er die Sitzung wechselt",
);
assert.strictEqual(
	/\bfindNearestRegionSegmentInsertIndex\b/.test(mfBereinigt),
	false,
	"die zweite Kantensuche ist restlos weg -- EINE Wahrheit ueber die naechste Kante (blanker Bezeichner, nicht nur die Aufrufform)",
);
assert.strictEqual(
	(ohneKommentare(lies("js/map-features/map-features-region-edit-edge-controls.js"))
		.match(/handleEditableRegionDoubleClick\(/g) || []).length,
	1,
	"das Tor ruft DENSELBEN Erzeuger wie der Doppelklick auf der Flaeche -- keinen zweiten Einfuegepfad",
);

console.log("ok - region-edit-doppelklick");

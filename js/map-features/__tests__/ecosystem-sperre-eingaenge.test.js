// Fragt JEDE Zeigergeste einer Landschaftsfläche die Sperr-Weiche?
//
// 💣 ZUR LAUFZEIT GEZÄHLT, NICHT PER GREP. Ein Suchmuster findet, was jemand hingeschrieben hat;
// dieser Test findet, was wirklich aufgerufen wird. Vorbild ist
// api/_internal/map/__tests__/field-origins-test.php — der zählte die Schreibwege zur Laufzeit und
// fand damit den zweiten, den der Autor übersehen hatte.
//
// 💣 Die Falle, gegen die er steht, ist die vom 14.08.2026: die Verkehrsmittel-Sperre band zwei von
// vier Erzeugern, und der Kommentar daneben sagte „ERZEUGER 1 VON 2". Eine Zahl liest sich wie eine
// vollständige Liste, also suchte niemand weiter. Hier steht keine Zahl im Code — hier zählt der Test.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const geometrie = require("../map-features-ecosystem-geometry.js");

// ---- Die Bühne: gerade so viel Leaflet, dass eine Fläche entsteht --------------------------------

const gestenHandler = new Map();

const layerAttrappe = {
	_ecosystemArea: null,
	_path: { style: {} },
	on(typ, handler) { gestenHandler.set(typ, handler); return this; },
	bindTooltip() { return this; },
	closeTooltip() { return this; },
	setStyle() { return this; },
	bringToFront() { return this; },
	getElement() { return this._path; },
};

let gefragt = [];

const kontext = {
	console,
	Map,
	Array,
	Number,
	String,
	Boolean,
	Object,
	JSON,
	Math,
	module: { exports: {} },
	document: { getElementById: () => null, addEventListener: () => {}, documentElement: {} },
	// Die Farben der Ebene stehen als Token in css/base/tokens.css und werden aus dem berechneten
	// Stil gelesen (AGENTS.md §12: keine hartkodierte Farbe im JS). Ohne Browser gibt es keinen —
	// die Attrappe liefert leere Werte, und die Farbe interessiert diesen Test nicht.
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	L: {
		polygon: () => layerAttrappe,
		DomEvent: { stop: () => {}, stopPropagation: () => {} },
	},
	// Die Nachbarn, die der Renderer im Browser aus dem globalen Namensraum liest.
	ecosystemGeometryParts: geometrie.ecosystemGeometryParts,
	ecosystemGeometryRings: geometrie.ecosystemGeometryRings,
	ecosystemGeometryArea: geometrie.ecosystemGeometryArea,
	// Die Registrierung der Flächen. Leer: dieser Test baut EINE Fläche und ruft ihre Handler direkt.
	ecosystemLayers: new Map(),
	canOperateEcosystemLayers: () => true,
	isEcosystemDrawing: () => false,
	isEcosystemEditingInProgress: () => false,
	isEcosystemGeometryEditOpen: () => false,
	openEcosystemGeometryEdit: () => {},
	handleEcosystemEditEdgeDoubleClick: () => false,
	setHighlightedEcosystemRegion: () => {},
	showFeedbackToast: () => {},
	setActiveEcosystemLayerKind: () => {},
	isEcosystemShowAllLayers: () => false,
};
kontext.window = {
	// 🔴 DER SPION. Er meldet jede Geste, die ihn fragt, und antwortet „ja, weitergereicht" --
	// jede Geste muss danach SOFORT aussteigen.
	avesmapsEcosystemReichtWeiter: (layer, event) => {
		gefragt.push(event && event.__geste);
		return true;
	},
	AvesmapsEcosystemAreaMenu: { open: () => { gefragt.push("MENUE-GEOEFFNET"); } },
	AvesmapsEcosystemGeometryOps: { claimsMapClick: () => false, handleAreaClick: () => { gefragt.push("ZIELWAHL"); return false; } },
	AvesmapsEcosystemTerritoryImport: { claimsMapClick: () => false },
};
kontext.globalThis = kontext;
vm.createContext(kontext);
vm.runInContext(
	fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-rendering.js"), "utf8"),
	kontext
);

// ---- Eine gesperrte Fläche bauen -----------------------------------------------------------------

const flaeche = {
	public_id: "gesperrt-1",
	region_public_id: "r-1",
	region_name: "Große Steppe",
	kind: "vegetation",
	is_locked: true,
	stack_order: 10,
	geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
};

const layer = kontext.buildEcosystemAreaLayer(flaeche);
assert.ok(layer, "buildEcosystemAreaLayer hat keine Fläche gebaut");
layerAttrappe._ecosystemArea = flaeche;

// ---- Jede Zeigergeste muss die Weiche fragen und danach aussteigen -------------------------------

const GESTEN = ["click", "dblclick", "contextmenu"];

GESTEN.forEach((geste) => {
	assert.ok(gestenHandler.has(geste), `Die Fläche hört gar nicht auf "${geste}"`);
});

GESTEN.forEach((geste) => {
	gefragt = [];
	gestenHandler.get(geste)({
		__geste: geste,
		originalEvent: { clientX: 5, clientY: 5, type: geste, target: layerAttrappe._path },
		latlng: { lat: 5, lng: 5 },
	});

	assert.ok(
		gefragt.includes(geste),
		`Die Geste "${geste}" fragt die Sperr-Weiche NICHT. Jede Zeigergeste der Fläche muss durch `
			+ "avesmapsEcosystemReichtWeiter gehen — sonst ist die Sperre für genau diese Geste wirkungslos."
	);
	assert.deepStrictEqual(
		gefragt,
		[geste],
		`Die Geste "${geste}" hat nach der Weiche weitergearbeitet (${gefragt.join(", ")}). `
			+ 'Sagt die Weiche „weitergereicht", ist der Handler fertig — sonst tut die Fläche ihre '
			+ "Arbeit ZUSÄTZLICH zu der, die darunter liegt."
	);
});

// ---- Und die Zielwahl? ----------------------------------------------------------------------------
// ⭐ Sie braucht keine eigene Sperre: `handleAreaClick` hängt am Klickhandler und bekommt den Klick
// erst, wenn die Weiche ihn durchgelassen hat. Der Fall oben beweist genau das — bei gesperrter
// Fläche steht „ZIELWAHL" NICHT in der Liste.
gefragt = [];
kontext.window.avesmapsEcosystemReichtWeiter = () => false;   // offene Fläche
gestenHandler.get("click")({
	__geste: "click",
	originalEvent: { clientX: 5, clientY: 5, type: "click", target: layerAttrappe._path },
	latlng: { lat: 5, lng: 5 },
});
assert.ok(
	gefragt.includes("ZIELWAHL"),
	"Bei einer OFFENEN Fläche muss die Zielwahl weiterhin drankommen — sonst hätte die Sperre "
		+ "eine Geste stillgelegt, die sie gar nicht betrifft."
);

console.log("ok - ecosystem-sperre-eingaenge");

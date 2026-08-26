// MELDUNG #103: die Unterbringung muss im geteilten Link mitreisen.
//
// 💣 SIE STEHT IM `DEFAULT_PLANNER_STATE` UND KOSTET GELD, UND GENAU DAS IST DER MASSSTAB.
// `buildPlannerSearchParams` schrieb sie nicht mit, `applyPlannerStateFromUrl` las sie nicht
// zurueck -- der Empfaenger eines Links fiel still auf „Gemeinschaftszimmer". Fuer Gareth ->
// Perricum sind das 1 D 2 S gegen 3 D 9 S 3 H: derselbe Link, zwei Reisekassen.
//
// ⭐ Direkt unter `lodging:` in js/config.js steht der Grundsatz, der hier verletzt war -- er
// begruendet dort, warum der REISEMONAT mitreist: „ein geteilter Link muss beim Empfaenger dieselbe
// Zahl zeigen wie beim Absender". Der Monat reiste, die Unterbringung nicht.
//
// 🔴 GEPRUEFT WIRD DIE RUNDREISE, nicht eine der beiden Haelften. Ein Test, der nur das Schreiben
// zusichert, laesst genau den Fall durch, der hier vorlag: ein Parameter, den niemand liest.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/teilen-unterbringung.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- Die Bedienelemente, so schmal wie moeglich --------------------------------------------------
const felder = {
	"#travelLodging": "bett",
	"#travelStartMonth": "",
	"#travelStartDay": "1",
	"#travelHoursPerDay": "8.0",
	"#landTransport": "groupFoot",
	"#riverTransport": "riverSailer",
	"#seaTransport": "cargoShip",
	'input[name="pathType"]:checked': "fastest",
};
const haken = {
	"#togglePaths": false, "#minimizeTransfers": false,
	"#allowLand": true, "#allowRiver": true, "#allowSea": true,
	"#toggleCrossings": false, "#toggleUnconnected": false, "#toggleSparseCrossings": false,
	"#toggleOpenPathEnds": false, "#toggleNodix": false, "#toggleHidden": false,
	"#toggleLabelsWithRegion": false,
};
global.$ = (selector) => ({
	val(value) {
		if (value === undefined) { return felder[selector]; }
		felder[selector] = String(value);
		return this;
	},
	is: () => Boolean(haken[selector]),
	prop(name, value) { haken[selector] = Boolean(value); return this; },
	toggleClass() { return this; },
});

global.window = { location: { search: "" }, addEventListener() {} };
global.document = {
	getElementById: () => null,
	dispatchEvent() {},
	querySelectorAll: () => [],
};
global.CustomEvent = function CustomEvent(name) { this.type = name; };
global.localStorage = { getItem: () => null, setItem() {} };
global.IS_EDIT_MODE = false;
global.activeMapStyle = "stylized";
global.sharePinCoordinates = null;
global.SHARE_PIN_QUERY_PARAM = "pin";
global.DEFAULT_ROUTE_QUERY_PARAM = "route";
global.ROUTE_QUERY_PARAM_ALIASES = ["route", "routes", "router"];
// Reine Kulisse (der Test faehrt zwei Wegpunkte) -- aber der ECHTE Wert, damit hier keine falsche
// Zahl steht, die jemand spaeter fuer die Regel haelt.
global.MAX_SHARED_WAYPOINTS = 25;
global.EDIT_MODE_PLANNER_STATE_STORAGE_KEY = "avesmaps.edit.plannerState";
global.LOCATION_TYPE_KEYS = [];
global.LOCATION_TYPE_CONFIG = {};
global.LOCATION_TYPE_VISIBILITY_ORDER = [];
global.isLocationTypeVisible = () => false;
global.getLocationToggleButton = () => ({ toggleClass() { return this; } });
global.syncLocationToggleButtons = () => {};
global.setSelectedMapLayerMode = () => {};
global.getSelectedMapLayerMode = () => "deregraphic";
global.applyFrontendLayerModeDefaults = () => {};
global.getWaypointInputValues = () => ["Gareth", "Perricum"];
global.resetWaypointInputs = () => {};
global.setSharePin = () => {};
global.clearSharePin = () => {};
let syncAufrufe = 0;
let standBeimNachziehen = null;
// 💣 Der Spion haelt fest, WAS beim Nachziehen im Feld stand -- nicht nur DASS nachgezogen wurde.
// Die Reihenfolge ist die halbe Regel: wer die Unterbringung danach setzt, hat eine Beschriftung,
// die „Gemeinschaftszimmer" sagt, waehrend gerechnet wird.
global.syncTransportControls = () => { syncAufrufe += 1; standBeimNachziehen = felder["#travelLodging"]; };
global.L = { latLng: (a, b) => ({ lat: a, lng: b }) };
global.isWithinMapBounds = () => true;

// ---- Die ECHTEN Listen und der ECHTE Leser -------------------------------------------------------
// 🪤 Kein nachgebautes TRAVEL_COST_LODGING_KEYS und kein nachgebautes getPlannerLodging: das eine
// ist die Liste, gegen die der Link geprueft wird, das andere der Leser, den die Kostenrechnung
// benutzt. Nachgebaut prueften sie sich selbst.
const ZEILENENDE = String.fromCharCode(10);
const repoWurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(repoWurzel, rel), "utf8");
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZEILENENDE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};
const konfig = lies("js/config.js");
// ⚠️ Einzeiler, kein Block -- deshalb ueber die ZEILE geschnitten und nicht ueber den Blockschluss.
const zeile = (quelle, anfang) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	return quelle.slice(start, quelle.indexOf(ZEILENENDE, start));
};
vm.runInThisContext(zeile(konfig, "const TRAVEL_COST_LODGING_KEYS")
	+ ZEILENENDE + "global.TRAVEL_COST_LODGING_KEYS = TRAVEL_COST_LODGING_KEYS;");
vm.runInThisContext(schnitt(konfig, "const DEFAULT_PLANNER_STATE", "};")
	+ ZEILENENDE + "global.DEFAULT_PLANNER_STATE = DEFAULT_PLANNER_STATE;");
vm.runInThisContext(schnitt(konfig, "const VALID_TRANSPORT_OPTIONS", "};")
	+ ZEILENENDE + "global.VALID_TRANSPORT_OPTIONS = VALID_TRANSPORT_OPTIONS;");
assert.strictEqual(DEFAULT_PLANNER_STATE.lodging, "bett", "ohne die echte Vorgabe prueft der Test nichts");
assert.ok(TRAVEL_COST_LODGING_KEYS.includes("zimmer"), "und ohne die echte Liste ebenso");

const utils = lies("js/app/utils.js");
vm.runInThisContext(schnitt(utils, "function getPlannerLodging(", "}")
	+ ZEILENENDE + "global.getPlannerLodging = getPlannerLodging;");
global.getPlannerRestHoursPerDay = () => DEFAULT_PLANNER_STATE.restHours;

vm.runInThisContext(lies("js/map-features/map-features-layer-state.js"),
	{ filename: "map-features-layer-state.js" });

// ---- 1. Der Absender: die gewaehlte Unterbringung steht im Link -----------------------------------
felder["#travelLodging"] = "zimmer";
const mitEinzelzimmer = buildPlannerSearchParams();
assert.strictEqual(mitEinzelzimmer.get("lodging"), "zimmer",
	"das gewaehlte Einzelzimmer reist im Link mit");

// 🔴 Die Vorgabe steht NICHT im Link -- wie bei jedem anderen Planerwert. Ein Link, der jeden
// Vorgabewert mitschleppt, waere laenger und saehe wie eine Einstellung aus, die jemand getroffen hat.
felder["#travelLodging"] = DEFAULT_PLANNER_STATE.lodging;
assert.strictEqual(buildPlannerSearchParams().has("lodging"), false,
	"die Vorgabe „Gemeinschaftszimmer\" bleibt aus dem Link heraus");

// Ein erfundener Wert kommt gar nicht erst hinein: getPlannerLodging faellt auf die Vorgabe.
felder["#travelLodging"] = "palast";
assert.strictEqual(buildPlannerSearchParams().has("lodging"), false,
	"ein unbekannter Wert wird nicht mitgeschickt");

// ---- 2. Der Empfaenger: der Link stellt sie wieder ein --------------------------------------------
const empfange = (query) => {
	window.avesmapsSearchParams = () => new URLSearchParams(query);
	felder["#travelLodging"] = "bett";
	syncAufrufe = 0;
	applyPlannerStateFromUrl();
	return felder["#travelLodging"];
};
assert.strictEqual(empfange("?route=Gareth&route=Perricum&lodging=zimmer"), "zimmer",
	"der Empfaenger bekommt das Einzelzimmer, nicht den Rueckfall");
assert.ok(syncAufrufe > 0, "die Kombinationsfelder werden nachgezogen");
assert.strictEqual(standBeimNachziehen, "zimmer",
	"und zwar NACHDEM die Unterbringung steht -- sonst zeigt die Beschriftung weiter den alten Wert, "
	+ "waehrend die Rechnung schon den neuen nimmt");
assert.strictEqual(empfange("?route=Gareth&lodging=frei"), "frei", "und jede andere Stufe ebenso");

// 🔴 Ein unbekannter Wert aendert NICHTS. Lieber rechnet ein getippter Link wie bisher, als dass er
// eine Unterkunft erfindet -- dieselbe Regel wie beim Reisemonat zwei Zeilen darueber.
assert.strictEqual(empfange("?route=Gareth&lodging=palast"), "bett",
	"ein unbekannter Wert faellt still auf die Vorgabe zurueck");
assert.strictEqual(empfange("?route=Gareth"), "bett", "und ein Link ohne Angabe ebenso");

// ---- 3. Die Rundreise ----------------------------------------------------------------------------
// 💣 DAS IST DIE EIGENTLICHE ZUSICHERUNG. Beide Haelften einzeln richtig zu haben, nuetzt nichts,
// wenn sie sich auf verschiedene Namen einigen -- genau so entstand die Luecke.
TRAVEL_COST_LODGING_KEYS.forEach((stufe) => {
	felder["#travelLodging"] = stufe;
	const query = "?" + buildPlannerSearchParams().toString();
	assert.strictEqual(empfange(query), stufe,
		"Rundreise fuer „" + stufe + "\": was der Absender schreibt, liest der Empfaenger");
});

console.log("OK teilen-unterbringung");

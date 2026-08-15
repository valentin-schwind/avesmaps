const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Ein versteckter Ort wird nicht gezeichnet -- ausser der Editor hakt ihn an, oder er ist in dieser
// Sitzung aufgedeckt worden, oder ein Pruefhaken hat ihn gefunden.
//
// Harness wie pruefhaken-sichtbarkeit.test.js: runInThisContext statt vm-Sandbox, damit die Globals
// der Dateien gegen die echten Funktionen aufloesen statt gegen Stubs.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

global.window = {};
global.IS_EDIT_MODE = true;
global.CROSSING_LOCATION_TYPE = "crossing";
global.activeMapStyle = "stylized";
global.VISUAL_MAX_ZOOM_LEVEL = 5;
global.LOCATION_NAME_LABEL_CONFIG = { dorf: { minZoom: 2 }, gebaeude: { minZoom: 3 } };

let checkedToggles = new Set();
let visibleTypes = new Set();
let unconnectedIds = new Set();
let sparseCrossingIds = new Set();

global.$ = (selector) => ({ is: () => checkedToggles.has(selector) });
global.isLocationTypeVisible = (locationType) => visibleTypes.has(locationType);
global.getUnconnectedLocationPublicIds = () => unconnectedIds;
global.getSparseCrossingPublicIds = () => sparseCrossingIds;
global.getSelectedMapLayerMode = () => "default";
global.isNodixLocation = (location) => Boolean(location?.isNodix);
global.isCrossingLocation = (location) => Boolean(location?.isCrossing);
global.avesmapsRevealedHiddenLocationIds = new Set();

loadBrowserScript(path.join(__dirname, "../map-features-location-marker-rendering.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-name-labels.js"));

// NACH dem Laden: isMarkerEntryInRenderBounds steht in der geprueften Datei selbst und wuerde einen
// Stub von vorher ueberschreiben. Der Ausschnitt ist nicht Gegenstand dieses Tests.
global.isMarkerEntryInRenderBounds = () => true;

const RENDER_BOUNDS = {};
const showMarker = (entry, zoomLevel) => shouldShowLocationMarker(entry, zoomLevel, RENDER_BOUNDS, createLocationVisibilityContext());
const showLabel = (entry, zoomLevel) => shouldShowLocationNameLabel(entry, zoomLevel, createLocationVisibilityContext());

const versteckt = { locationType: "dorf", name: "Feenplatz", publicId: "loc-fee", location: { publicId: "loc-fee", isHidden: true } };
const offen = { locationType: "dorf", name: "Gareth", publicId: "loc-gar", location: { publicId: "loc-gar" } };

const reset = () => {
	checkedToggles = new Set();
	visibleTypes = new Set(["dorf"]);   // die Ortsgroesse ist AN -- sonst prueft der Test nichts
	unconnectedIds = new Set();
	sparseCrossingIds = new Set();
	global.getSelectedMapLayerMode = () => "default";
	global.avesmapsRevealedHiddenLocationIds = new Set();
};

// --- 1. versteckt heisst weg, obwohl die Ortsgroesse eingeschaltet ist ---------------------------
reset();
assert.strictEqual(showMarker(offen, 5), true, "Vorbedingung: der gewoehnliche Ort wird gezeichnet");
assert.strictEqual(showMarker(versteckt, 5), false, "ein versteckter Ort wird nicht gezeichnet");
assert.strictEqual(showLabel(versteckt, 5), false, "und sein Name auch nicht");

// --- 2. kein Zoom deckt ihn auf ------------------------------------------------------------------
reset();
[0, 1, 2, 3, 4, 5].forEach((zoom) => {
	assert.strictEqual(showMarker(versteckt, zoom), false, `auch auf Zoomstufe ${zoom} bleibt er weg`);
});

// --- 3. der Editor-Haken holt ihn zurueck ---------------------------------------------------------
reset();
checkedToggles.add("#toggleHidden");
assert.strictEqual(showMarker(versteckt, 5), true, "„Versteckte Orte\" zeigt ihn");
assert.strictEqual(showLabel(versteckt, 5), true, "... samt Namen, sonst steht dort ein anonymer Punkt");

// --- 4. aufgedeckt heisst sichtbar ----------------------------------------------------------------
reset();
global.avesmapsRevealedHiddenLocationIds = new Set(["loc-fee"]);
assert.strictEqual(showMarker(versteckt, 5), true, "wer ihn gefunden hat, sieht ihn");
assert.strictEqual(showLabel(versteckt, 5), true, "samt Namen");

// --- 5. 💣 EIN PRUEFHAKEN ZEIGT SEINE FUNDE, auch versteckte --------------------------------------
// Owner 2026-08-14. Ein versteckter Ort ohne Weganbindung IST eine Anbindungsluecke; stuende der
// Versteckt-Riegel ueber dem Pruefhaken, waere „verstecken" ein Weg, den Pruefhaken stillzulegen --
// und der Editor saehe die Luecke nie wieder.
reset();
visibleTypes = new Set();          // Ortsgroesse AUS -- der Fund muss trotzdem durch
checkedToggles.add("#toggleUnconnected");
unconnectedIds.add("loc-fee");
assert.strictEqual(showMarker(versteckt, 5), true, "der Pruefhaken schlaegt den Versteckt-Riegel");
assert.strictEqual(resolveLocationCheckFinding(versteckt, createLocationVisibilityContext()), "unconnected");

// --- 6. im Kraftlinien-Modus schlaegt „versteckt" den Nodix-Zweig ---------------------------------
// Ein versteckter Nodix ist versteckt. Wer beides will, hakt „Versteckte Orte" an.
reset();
global.getSelectedMapLayerMode = () => "powerlines";
const versteckterNodix = { locationType: "dorf", name: "Feenplatz", publicId: "loc-fee", location: { publicId: "loc-fee", isHidden: true, isNodix: true } };
const offenerNodix = { locationType: "dorf", name: "Nodix", publicId: "loc-nod", location: { publicId: "loc-nod", isNodix: true } };
assert.strictEqual(showMarker(offenerNodix, 5), true, "Vorbedingung: der offene Nodix leuchtet");
assert.strictEqual(showMarker(versteckterNodix, 5), false, "der versteckte nicht");

// --- 7. ein gewoehnlicher Ort bleibt vom Haken unberuehrt -----------------------------------------
reset();
checkedToggles.add("#toggleHidden");
assert.strictEqual(showMarker(offen, 5), true, "der Haken blendet nichts aus");

console.log("versteckter-ort-sichtbarkeit: all asserts passed");

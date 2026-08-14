const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// „Ein Prüfhaken ZEIGT seine Funde“ (Owner 2026-08-14): „Unverbunden“, „Kreuzungen ≤ 2 Wege“ und
// „Kreuzungen“ blenden ihre Treffer ein -- unabhaengig davon, welche Ortsgroessen eingeschaltet sind,
// und unabhaengig von der Zoomstufe. Vorher ringelte „Unverbunden“ nur, was die Groessenkaskade
// ohnehin zeigte, „Kreuzungen ≤ 2 Wege“ tat ohne „Kreuzungen“ gar nichts, und Kreuzungen erschienen
// erst ab Zoom 3 -- also blieben genau die gesuchten Orte unsichtbar.
//
// runInThisContext statt vm-Sandbox: dieselbe Technik wie settlement-infobox-without-wiki.test.js --
// beide Dateien haengen auf Modulebene an keinem Leaflet-/DOM-Aufruf, und ihre Globals loesen so
// gegen die echten Funktionen auf statt gegen Stubs. Beide muessen geladen sein: der Namenspfad ruft
// resolveLocationCheckFinding aus der Marker-Datei (in index.html laedt sie VOR dieser).
const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

// --- Umgebung: nur das, was die beiden Sichtbarkeits-Funktionen wirklich lesen -------------------
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

loadBrowserScript(path.join(__dirname, "../map-features-location-marker-rendering.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-name-labels.js"));

// NACH dem Laden: isMarkerEntryInRenderBounds steht in der geprueften Datei selbst und wuerde einen
// Stub von vorher ueberschreiben (es liefe dann gegen Leaflet und gaebe undefined zurueck). Der
// Ausschnitt ist nicht Gegenstand dieses Tests -- er gilt weiter und steht hier auf „im Bild“.
global.isMarkerEntryInRenderBounds = () => true;

const RENDER_BOUNDS = {}; // nur durchgereicht, isMarkerEntryInRenderBounds oben ist der Stub
const dorf = { locationType: "dorf", name: "Ausserhalb", publicId: "dorf-1", location: { publicId: "dorf-1" } };
const crossing = { locationType: "crossing", name: "Kreuzung-7", publicId: "kr-7", location: { isCrossing: true } };

const showMarker = (entry, zoomLevel) => shouldShowLocationMarker(entry, zoomLevel, RENDER_BOUNDS, createLocationVisibilityContext());
const showLabel = (entry, zoomLevel) => shouldShowLocationNameLabel(entry, zoomLevel, createLocationVisibilityContext());

const reset = () => {
	checkedToggles = new Set();
	visibleTypes = new Set();
	unconnectedIds = new Set();
	sparseCrossingIds = new Set();
};

// --- 1. „Unverbunden“ blendet den Ort ein, obwohl seine Ortsgroesse AUS ist ----------------------
reset();
assert.strictEqual(showMarker(dorf, 5), false, "Vorbedingung: ohne Haken und mit ausgeschalteter Groesse bleibt das Dorf weg");
checkedToggles.add("#toggleUnconnected");
unconnectedIds.add("dorf-1");
assert.strictEqual(showMarker(dorf, 5), true, "„Unverbunden“ muss den unverbundenen Ort einblenden, auch wenn „Dörfer“ aus ist");
assert.strictEqual(showLabel(dorf, 5), true, "... samt Namen, sonst steht dort ein anonymer Punkt");
assert.strictEqual(resolveLocationCheckFinding(dorf, createLocationVisibilityContext()), "unconnected",
	"eingeblendet UND geringelt: derselbe Aufruf beantwortet beides");

// --- 2. ... und zwar auf JEDER Zoomstufe (Dorf laege sonst unter seiner Mindeststufe 2) ----------
assert.strictEqual(showMarker(dorf, 0), true, "der Fund darf nicht an der Mindestzoomstufe des Typs haengen (Owner: „auch unabhängig von der Zoomstufe“)");
assert.strictEqual(showLabel(dorf, 0), true, "dasselbe fuer den Namen");

// --- 3. Ein Ort OHNE Befund bleibt trotz gesetztem Haken weg -------------------------------------
const verbunden = { locationType: "dorf", name: "Angebunden", publicId: "dorf-2", location: { publicId: "dorf-2" } };
assert.strictEqual(showMarker(verbunden, 5), false, "der Haken zeigt seine FUNDE, nicht alle Orte");
assert.strictEqual(showLabel(verbunden, 5), false, "... und benennt auch nur diese");

// --- 4. „Kreuzungen ≤ 2 Wege“ wirkt allein, ohne „Kreuzungen“ ------------------------------------
reset();
sparseCrossingIds.add("kr-7");
checkedToggles.add("#toggleSparseCrossings");
assert.strictEqual(showMarker(crossing, 5), true, "„Kreuzungen ≤ 2 Wege“ muss ohne „Kreuzungen“ wirken -- vorher tat der Haken allein gar nichts");
assert.strictEqual(showMarker(crossing, 0), true, "auch hier ohne Zoomuntergrenze");
assert.strictEqual(resolveLocationCheckFinding(crossing, createLocationVisibilityContext()), "sparse-crossing");

// --- 5. Rangfolge: eine Kreuzung ganz ohne Weg ist BEIDES -- pink gewinnt ------------------------
reset();
checkedToggles.add("#toggleUnconnected");
checkedToggles.add("#toggleSparseCrossings");
unconnectedIds.add("kr-7");
sparseCrossingIds.add("kr-7");
assert.strictEqual(resolveLocationCheckFinding(crossing, createLocationVisibilityContext()), "unconnected",
	"die fehlende Anbindung ist der gravierendere Befund und gewinnt gegen „ueberfluessige Kreuzung“");

// --- 6. „Kreuzungen“ zeigt alle Kreuzungen, jetzt auf jeder Zoomstufe ----------------------------
reset();
checkedToggles.add("#toggleCrossings");
assert.strictEqual(showMarker(crossing, 5), true, "Vorbedingung: „Kreuzungen“ zeigt Kreuzungen");
assert.strictEqual(showMarker(crossing, 0), true, "„Kreuzungen“ darf nicht mehr an Zoom >= 3 haengen (Owner 2026-08-14)");
assert.strictEqual(resolveLocationCheckFinding(crossing, createLocationVisibilityContext()), "",
	"ohne die beiden Befund-Haken traegt sie keinen Ring");

// --- 7. Kein Prüfhaken an -> exakt das alte Verhalten ---------------------------------------------
reset();
assert.strictEqual(showMarker(crossing, 5), false, "ohne „Kreuzungen“ bleibt die Kreuzung weg");
visibleTypes.add("dorf");
assert.strictEqual(showMarker(dorf, 5), true, "die normale Groessenkaskade bleibt unberuehrt");
assert.strictEqual(showMarker(dorf, 1), false, "... samt ihrer Mindestzoomstufe (Dorf ab 2)");

// --- 8. Ausserhalb des Bearbeiten-Modus wirkt nichts davon ----------------------------------------
reset();
global.IS_EDIT_MODE = false;
checkedToggles.add("#toggleUnconnected");
unconnectedIds.add("dorf-1");
assert.strictEqual(resolveLocationCheckFinding(dorf, createLocationVisibilityContext()), "",
	"die Prüfhaken sind Editorwerkzeug -- im Frontend darf kein Fund entstehen");
assert.strictEqual(showMarker(dorf, 5), false, "und damit auch keine Einblendung");
global.IS_EDIT_MODE = true;

console.log("pruefhaken-sichtbarkeit: alle Zusicherungen erfuellt");

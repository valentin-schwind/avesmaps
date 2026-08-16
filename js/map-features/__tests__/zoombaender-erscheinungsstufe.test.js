const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die erste gefüllte Zelle des Zoombands steuert Marker UND Name -- es gibt keine zweite Zahl mehr.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §3.1
//
// Harness wie versteckter-ort-sichtbarkeit.test.js: runInThisContext, damit die Globals der Dateien
// gegen die echten Funktionen auflösen statt gegen Stubs.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

global.window = {};
global.IS_EDIT_MODE = false;
global.CROSSING_LOCATION_TYPE = "crossing";
global.activeMapStyle = "stylized";
global.VISUAL_MAX_ZOOM_LEVEL = 5;

let visibleTypes = new Set(["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"]);
global.$ = () => ({ is: () => false });
global.isLocationTypeVisible = (locationType) => visibleTypes.has(locationType);
global.getUnconnectedLocationPublicIds = () => new Set();
global.getSparseCrossingPublicIds = () => new Set();
global.getSelectedMapLayerMode = () => "deregraphic";
global.isNodixLocation = () => false;
global.isCrossingLocation = () => false;
global.avesmapsRevealedHiddenLocationIds = new Set();

loadBrowserScript(path.join(__dirname, "../location-zoom-bands.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-marker-rendering.js"));
// Für die Namens-Hälfte (Block F/G): shouldShowLocationNameLabel/getLocationNameLabelSize.
loadBrowserScript(path.join(__dirname, "../map-features-location-name-labels.js"));

// NACH dem Laden: isMarkerEntryInRenderBounds steht in der geprüften Datei selbst.
global.isMarkerEntryInRenderBounds = () => true;

const RENDER_BOUNDS = {};
const eintrag = (locationType) => ({ locationType, name: "Probe", publicId: "loc-" + locationType, location: {} });
const zeigtMarker = (locationType, z) =>
	shouldShowLocationMarker(eintrag(locationType), z, RENDER_BOUNDS, createLocationVisibilityContext());

avesmapsApplyLocationZoomBands(null);

// ---- A. Die Vorgabe: 0/0/0/1/2/3 --------------------------------------------------------------
const ERWARTET = { metropole: 0, grossstadt: 0, stadt: 0, kleinstadt: 1, dorf: 2, gebaeude: 3 };
Object.entries(ERWARTET).forEach(([typ, ab]) => {
	for (let z = 0; z <= 8; z += 1) {
		assert.strictEqual(zeigtMarker(typ, z), z >= ab,
			`${typ} bei z${z}: erwartet ${z >= ab ? "sichtbar" : "unsichtbar"}`);
	}
});

// ---- B. Eine Übersteuerung verschiebt die Stufe ------------------------------------------------
avesmapsApplyLocationZoomBands({ marker: { dorf: [null, null, null, null, null, 9.28, 17.74, 17.74, 17.74] } });
assert.strictEqual(zeigtMarker("dorf", 4), false, "das Dorf erscheint jetzt erst ab z5");
assert.strictEqual(zeigtMarker("dorf", 5), true);
assert.strictEqual(getLocationMarkerSize("dorf", 5), 9.28, "und trägt den eingestellten Durchmesser");

// ---- C. Eine ganz leere Zeile blendet die Klasse überall aus -----------------------------------
avesmapsApplyLocationZoomBands({ marker: { gebaeude: [null, null, null, null, null, null, null, null, null] } });
for (let z = 0; z <= 8; z += 1) {
	assert.strictEqual(zeigtMarker("gebaeude", z), false, `Bauwerke sind bei z${z} aus`);
}
assert.strictEqual(avesmapsLocationZoomBandMinZoom("marker", "gebaeude"), null);

// ---- D. 💣 UNTERHALB DES BANDES GIBT ES TROTZDEM EINE GRÖSSE ----------------------------------
// Die Prüfhaken zeigen ihre Funde OHNE Rücksicht auf die Zoomstufe (Owner 2026-08-14) -- sie
// steigen in shouldShowLocationMarker VOR der Bandprüfung aus. Gäbe getLocationMarkerSize dort 0
// zurück, bekäme der Fund einen Marker der Größe null: eingeblendet und unsichtbar zugleich.
// Genau das tat die abgeschaffte Kurve mit Math.max(spec.from, z) -- sie klemmte auf die erste Stufe.
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(getLocationMarkerSize("gebaeude", 0), AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker.gebaeude[3],
	"unter dem Band gilt die erste gefüllte Zelle");
assert.strictEqual(getLocationMarkerSize("dorf", 0), AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker.dorf[2]);
assert.ok(getLocationMarkerSize("gebaeude", 0) > 0, "nie 0 -- sonst ist der Fund unsichtbar");

// ---- E. Kern und Kontur folgen dem Außendurchmesser --------------------------------------------
const aussen = getLocationMarkerSize("metropole", 5);
assert.strictEqual(Math.round(getLocationMarkerCoreRadius("metropole", 5) * 100) / 100,
	Math.round((aussen / 2 / 1.33) * 100) / 100, "Kern = Außen ÷ 2 ÷ 1,33");
assert.ok(getLocationMarkerBorderWidth("metropole", 5) >= 0.5, "die Kontur hat eine Untergrenze");

// ---- F. Der Name: eigene, spätere Erscheinungsstufe --------------------------------------------
const zeigtName = (locationType, z) =>
	shouldShowLocationNameLabel(eintrag(locationType), z, createLocationVisibilityContext());

avesmapsApplyLocationZoomBands(null);
const ERWARTET_NAME = { metropole: 0, grossstadt: 0, stadt: 2, kleinstadt: 3, dorf: 4, gebaeude: 4 };
Object.entries(ERWARTET_NAME).forEach(([typ, ab]) => {
	for (let z = 0; z <= 8; z += 1) {
		assert.strictEqual(zeigtName(typ, z), z >= ab,
			`Name ${typ} bei z${z}: erwartet ${z >= ab ? "sichtbar" : "unsichtbar"}`);
	}
});

// Der Name erscheint nie vor seinem Marker.
Object.keys(ERWARTET_NAME).forEach((typ) => {
	assert.ok(avesmapsLocationZoomBandMinZoom("label", typ) >= avesmapsLocationZoomBandMinZoom("marker", typ),
		`${typ}: der Name darf nicht vor dem Marker kommen`);
});

// ---- G. Schriftgröße unter dem Band -----------------------------------------------------------
// ⚠️ Unter dem Band gilt 8 pt -- die alte Untergrenze aus Math.max(8, …). Das reproduziert den
// bisherigen Wert für alle Klassen mit EINER benannten Ausnahme: das Dorf lieferte bei z3 8,5.
// Diese Zahl bediente nur die Wegenamen, und die haben seit dem 16.08.2026 ihre eigene Tafel
// (map-features-path-labels.js). Für Ortsnamen selbst ist der Pfad ohnehin nur über den
// Siedlungsfilter und den angepinnten Suchtreffer erreichbar.
assert.strictEqual(getLocationNameLabelSize("dorf", 0), 8, "unter dem Band gilt die alte Untergrenze");
assert.strictEqual(getLocationNameLabelSize("gebaeude", 2), 8);
assert.strictEqual(getLocationNameLabelSize("metropole", 0), 8, "im Band gilt der Bandwert");
assert.strictEqual(getLocationNameLabelSize("dorf", 5), 11);

// 💣 Die Vorgabe ist ab z5 flach (11, 11, 11) -- mit ihr sind eine 0-7-Klemme und eine 0-5-Klemme
// nicht zu unterscheiden. Erst eine Übersteuerung, die oben ANDERE Werte trägt, macht den
// Unterschied sichtbar: über getVisualZoomLevel (klemmt auf 5) käme hier dreimal 11 heraus.
avesmapsApplyLocationZoomBands({ label: { dorf: [null, null, null, null, 10, 11, 14, 16, 18] } });
assert.strictEqual(getLocationNameLabelSize("dorf", 5), 11);
assert.strictEqual(getLocationNameLabelSize("dorf", 6), 14, "z6 ist eine eigene Stufe, keine Kopie von z5");
assert.strictEqual(getLocationNameLabelSize("dorf", 7), 16, "z7 ebenso -- die Ortsschrift klemmt auf 0-8, nicht auf 5");
assert.strictEqual(getLocationNameLabelSize("dorf", 8), 18, "z8 ebenso -- die neue Spalte ist keine Kopie von z7");
avesmapsApplyLocationZoomBands(null); // Zustand für die folgenden Blöcke zurücksetzen

console.log("zoombaender-erscheinungsstufe: alle Zusicherungen erfüllt");

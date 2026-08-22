// avesmapsKurvenlabelKandidaten() ist der schmale Leser fuer Kanal C (Aufgabe 5): welche Labels
// haben eine Kurve UND waeren nach shouldShowLabelMarker JETZT sichtbar? Der Test soll genau die
// Verdrahtung beweisen, nicht nur, dass die Funktion existiert (siehe MEMORY.md
// "Gruener Test beweist nichts ohne Verdrahtung" / "Zusicherung, die ihr Subjekt trivial erfuellt").
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ⚠️ map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an, siehe
// curve-label-normalize.test.js). Geprueft wird deshalb nur der Rumpf von
// avesmapsKurvenlabelKandidaten, aus der Datei geschnitten -- der Test misst genau die Funktion, um
// die es geht, und behauptet nichts ueber den Rest der Datei.
const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");
const von = quelle.indexOf("function avesmapsKurvenlabelKandidaten(");
assert.ok(von >= 0, "avesmapsKurvenlabelKandidaten steht in der Datei");
const bis = quelle.indexOf("\n}", von);
assert.ok(bis > von, "und hat ein Ende");
const rumpf = quelle.slice(von, bis + 2);

// shouldShowLabelMarker, map, getMapRenderBounds und isMapLabelEditorOverrideActive sind freie
// Bezeichner im Rumpf -- als Parameter des new Function(...)-Aufbaus stehen sie ihm zur Verfuegung,
// ohne dass ihre echte (DOM-/Leaflet-abhaengige) Fassung geladen werden muss.
function bauen({shouldShowLabelMarker, labelMarkers, zoomLevel = 3, renderBounds = "BOUNDS", editorOverride = null}) {
	const map = {getZoom: () => zoomLevel};
	const getMapRenderBounds = () => renderBounds;
	const isMapLabelEditorOverrideActive = () => editorOverride;
	return new Function(
		"labelMarkers", "map", "getMapRenderBounds", "isMapLabelEditorOverrideActive", "shouldShowLabelMarker",
		rumpf + "; return avesmapsKurvenlabelKandidaten;"
	)(labelMarkers, map, getMapRenderBounds, isMapLabelEditorOverrideActive, shouldShowLabelMarker);
}

// --- Vorfilter: keine oder zu kurze Kurve faellt heraus, AUCH wenn shouldShowLabelMarker zusagt ----
{
	let aufrufe = 0;
	const immerSichtbar = () => { aufrufe += 1; return true; };
	const entries = [
		{label: {publicId: "ohneKurve", curveLine: null, text: "Meer"}},
		{label: {publicId: "einPunkt", curveLine: [[1, 2]], text: "Zu kurz"}},
		{label: {publicId: "mitKurve", curveLine: [[1, 2], [3, 4]], text: "Drachensteine"}},
	];
	const kandidaten = bauen({shouldShowLabelMarker: immerSichtbar, labelMarkers: entries})();
	assert.strictEqual(kandidaten.length, 1, "nur die Kurve mit >= 2 Punkten bleibt");
	assert.strictEqual(kandidaten[0].publicId, "mitKurve");
	// shouldShowLabelMarker darf fuer die beiden ohne brauchbare Kurve gar nicht erst gefragt werden
	// (Kurve ist die billige Vorpruefung) -- hier zaehlt nur, dass am Ende nicht mehr als eine
	// Sichtbarkeitspruefung noetig war.
	assert.strictEqual(aufrufe, 1, "shouldShowLabelMarker wird nur fuer die brauchbare Kurve gerufen");
}

// --- Die Sichtbarkeitsregel entscheidet WIRKLICH mit, nicht nur die Kurve -------------------------
// Das ist die Verdrahtungsprobe: ein Stub, der `false` liefert, muss den sonst brauchbaren Kandidaten
// wegnehmen. Ohne diese Zusicherung wuerde ein versehentlich entferntes zweites `.filter(...)` nicht
// auffallen -- genau die Fehlerklasse, die AGENTS.md an der Verkehrsmittel-Sperre vom 14.08.2026 nennt.
{
	const versteckt = {label: {publicId: "versteckt", curveLine: [[1, 2], [3, 4]], text: "Koschberge"}};
	const sichtbar = {label: {publicId: "sichtbar", curveLine: [[1, 2], [3, 4]], text: "Drachensteine"}};
	const nurEinerDarf = (entry) => entry === sichtbar;
	const kandidaten = bauen({shouldShowLabelMarker: nurEinerDarf, labelMarkers: [versteckt, sichtbar]})();
	assert.strictEqual(kandidaten.length, 1);
	assert.strictEqual(kandidaten[0].publicId, "sichtbar", "die Sichtbarkeitsregel filtert wirklich, nicht nur die Kurve");
}

// --- Weitergabe der Argumente: Zoom, Bildausschnitt und Editor-Override kommen bei jedem Aufruf an -
{
	const gesehen = [];
	const merken = (entry, zoomLevel, renderBounds, editorOverride) => {
		gesehen.push({publicId: entry.label.publicId, zoomLevel, renderBounds, editorOverride});
		return true;
	};
	const entry = {label: {publicId: "l1", curveLine: [[1, 2], [3, 4]]}};
	bauen({shouldShowLabelMarker: merken, labelMarkers: [entry], zoomLevel: 5, renderBounds: "R", editorOverride: true})();
	assert.deepStrictEqual(gesehen, [{publicId: "l1", zoomLevel: 5, renderBounds: "R", editorOverride: true}]);
}

// --- Ergebnis sind LABELS, keine Eintraege (das Overlay braucht curveLine/curveMax/text direkt) ---
{
	const entry = {marker: "wuerde-hier-nicht-gebraucht", label: {publicId: "l2", curveLine: [[1, 2], [3, 4]], curveMax: 2, text: "Name"}};
	const kandidaten = bauen({shouldShowLabelMarker: () => true, labelMarkers: [entry]})();
	assert.strictEqual(kandidaten[0], entry.label, "es ist dasselbe Label-Objekt, kein Kopie/Wrapper");
	assert.strictEqual(kandidaten[0].marker, undefined, "kein Marker-Feld -- das ist der Eintrag, nicht das Label");
}

// --- Fehlender/kaputter Bestand: leere Liste statt Wurf -------------------------------------------
{
	assert.deepStrictEqual(bauen({shouldShowLabelMarker: () => true, labelMarkers: undefined})(), []);
	assert.deepStrictEqual(bauen({shouldShowLabelMarker: () => true, labelMarkers: "kaputt"})(), []);
}

console.log("kurvenlabel-kandidaten: alle Zusicherungen erfuellt");

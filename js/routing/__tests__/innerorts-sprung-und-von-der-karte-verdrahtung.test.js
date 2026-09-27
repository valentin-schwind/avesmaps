// Verdrahtung in js/routing/routing.js fuer Task 4 (Entwurf
// docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §4.1, §6.2):
//   - der Klick-Zweig "take-location-off-map" delegiert an takeLocationOffMap()
//   - der document-weite Zuhoerer fuer ".innerorts-sprung" (auch fuer Besucher, §6.2)
//   - avesmapsSpringeZuInnerortsPunkt() selbst, ECHT ausgefuehrt (nicht nur gelesen)
//
// 🪤 Der Klick-Zweig ist verdrahtet und delegiert an den benannten Helfer -- dieselbe Hausform wie
// bei "report-crossing" (js/ui/__tests__/popup-crossing-report.test.js): der Verteiler selbst
// haengt an jQuery/Leaflet/einem Dutzend Nachbarmodulen und wird deshalb als Text geprueft; die
// eigentliche LOGIK (avesmapsSpringeZuInnerortsPunkt) wird unten als der ECHTE Code ausgefuehrt.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/routing/__tests__/innerorts-sprung-und-von-der-karte-verdrahtung.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral: routing.js traegt CRLF (AGENTS.md §9, die zweite CRLF-Falle) -- ein Suchmuster
// mit blossem "\n" faende sein eigenes Zeilenende nie.
const routing = fs.readFileSync(path.join(ROOT, "js", "routing", "routing.js"), "utf8").replace(/\r\n/g, "\n");

// ── A) Der Klick-Zweig "take-location-off-map" ────────────────────────────────────────────────
assert.ok(routing.includes('action === "take-location-off-map"'), "der Klick-Zweig existiert");
{
	const start = routing.indexOf('action === "take-location-off-map"');
	const zweig = routing.slice(start, routing.indexOf("\n\t}", start));
	assert.ok(/void takeLocationOffMap\(/.test(zweig), "und delegiert an takeLocationOffMap(...)");
	assert.ok(/findLocationMarkerByPublicId\(this\.dataset\.publicId\)/.test(zweig),
		"der Marker wird ueber die publicId gesucht, wie bei den Nachbar-Zweigen");
}

// ── B) Der document-weite Zuhoerer fuer ".innerorts-sprung" ───────────────────────────────────
assert.ok(routing.includes('$(document).on("click", ".innerorts-sprung"'),
	"der Sprung ⊕ ist document-weit delegiert -- auch fuer Besucher (Spec §6.2), NICHT hinter IS_EDIT_MODE");
{
	const start = routing.indexOf('$(document).on("click", ".innerorts-sprung"');
	const ende = routing.indexOf("\n});", start);
	const block = routing.slice(start, ende);
	assert.ok(/avesmapsSpringeZuInnerortsPunkt\(publicId\)/.test(block), "er ruft avesmapsSpringeZuInnerortsPunkt");
	assert.ok(/showFeedbackToast\(/.test(block), "und meldet einen Fehlschlag (z. B. Marker nicht mehr aktiv)");
	assert.ok(!/IS_EDIT_MODE/.test(block), "kein Riegel hinter IS_EDIT_MODE -- Besucher sehen die Zeile ebenfalls");
}

// ── C) avesmapsSpringeZuInnerortsPunkt: ECHT ausgefuehrt ──────────────────────────────────────
// Die Funktion selbst braucht kein jQuery/Leaflet -- nur `findLocationMarkerByPublicId`, `map`, die Zoomregel und den Infobox-Trichter.
// Extrahiert aus der Datei (dieselbe Technik wie cutDeclaration in
// js/app/__tests__/dubletten-verweis.test.js), damit der ECHTE Funktionskoerper laeuft, ohne den
// riesigen Rest von routing.js (jQuery-Dispatcher, Leaflet-Zustand, …) mit aufzubauen.
function extrahiere(quelle, start) {
	const von = quelle.indexOf(start);
	assert.notStrictEqual(von, -1, "Funktion nicht gefunden: " + start);
	const bis = quelle.indexOf("\n}\n", von);
	assert.notStrictEqual(bis, -1, "Funktionsende nicht gefunden: " + start);
	return quelle.slice(von, bis + 3);
}
const springFnQuelle = extrahiere(routing, "function avesmapsSpringeZuInnerortsPunkt(publicId) {");

// 💣 GEPRUEFT WIRD DER HAUSWEG, NICHT `marker.openPopup()`. Die erste Fassung rief `openPopup()` am
// Marker -- an einem Leinwand-Marker (LOCATION_CANVAS_MARKERS_ENABLED) mit Infopanel tut das STILL
// nichts, und ihr Test faelschte genau dieses `openPopup` und war gruen. Die Attrappen unten TRAGEN
// deshalb ein `openPopup`, das den Test rot macht, sobald es gerufen wird. Geprueft wird, dass der
// Trichter openLocationPopupForMarkerEntry (Infopanel, Leinwand-Marker, verborgene Orte) gerufen
// wird und die Zoomstufe aus der Regel des Spotlight-Treffers kommt (getSpotlightLocationZoom).
function baueSandbox({ findLocationMarkerByPublicId, map, getSpotlightLocationZoom, openLocationPopupForMarkerEntry }) {
	const zeitgeber = [];
	const sandbox = { findLocationMarkerByPublicId, map, getSpotlightLocationZoom, openLocationPopupForMarkerEntry, console };
	sandbox.window = { setTimeout: (fn) => { zeitgeber.push(fn); return zeitgeber.length; } };
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(springFnQuelle, sandbox, { filename: "avesmapsSpringeZuInnerortsPunkt.js" });
	sandbox.zeitgeberAusfuehren = () => zeitgeber.splice(0).forEach((fn) => fn());
	return sandbox;
}

function markerOhneOpenPopup(latlng) {
	return {
		getLatLng: () => latlng,
		openPopup: () => { throw new Error("marker.openPopup() gerufen -- an einem Leinwand-Marker tut das still nichts"); },
	};
}

// -- gefunden: fliegt auf die Zoomstufe des Spotlight-Treffers und oeffnet die Infobox ueber den Trichter --
{
	const flyToAufrufe = [];
	const trichterAufrufe = [];
	const zoomFragen = [];
	const markerEntry = { marker: markerOhneOpenPopup({ lat: 12, lng: 34 }), locationType: "stadtviertel", publicId: "pid-1" };
	const sandbox = baueSandbox({
		findLocationMarkerByPublicId: (id) => (id === "pid-1" ? markerEntry : null),
		map: { getZoom: () => 2, flyTo: (latlng, zoom, opts) => flyToAufrufe.push({ latlng, zoom, opts }) },
		getSpotlightLocationZoom: (entry) => { zoomFragen.push(entry); return 6; },
		openLocationPopupForMarkerEntry: (entry, opts) => trichterAufrufe.push({ entry, opts }),
	});
	const ergebnis = sandbox.avesmapsSpringeZuInnerortsPunkt("pid-1");
	assert.strictEqual(ergebnis, true, "gefunden -> true");
	assert.strictEqual(flyToAufrufe.length, 1, "genau ein flyTo");
	assert.deepStrictEqual(flyToAufrufe[0].latlng, { lat: 12, lng: 34 });
	assert.strictEqual(zoomFragen[0], markerEntry, "die Zoomstufe kommt aus der Regel des Spotlight-Treffers (Zoomband)");
	assert.strictEqual(flyToAufrufe[0].zoom, 6, "und genau diese Stufe wird angeflogen");
	assert.strictEqual(trichterAufrufe.length, 0, "die Infobox oeffnet erst nach dem Start des Flugs (wie focusSpotlightLocation)");
	sandbox.zeitgeberAusfuehren();
	assert.strictEqual(trichterAufrufe.length, 1, "die Infobox oeffnet ueber openLocationPopupForMarkerEntry");
	assert.strictEqual(trichterAufrufe[0].entry, markerEntry, "mit dem Marker-Eintrag des Punkts");
	assert.strictEqual(trichterAufrufe[0].opts.pan, false, "ohne eigenes Schwenken -- der Flug hat das schon getan");
}

// -- ohne die Zoomregel (Rueckfall): mindestens 4, der hoehere Zoom gewinnt --
{
	const flyToAufrufe = [];
	const sandbox = baueSandbox({
		findLocationMarkerByPublicId: () => ({ marker: markerOhneOpenPopup({ lat: 1, lng: 1 }) }),
		map: { getZoom: () => 6, flyTo: (l, z) => flyToAufrufe.push(z) },
		getSpotlightLocationZoom: undefined,
		openLocationPopupForMarkerEntry: () => {},
	});
	sandbox.avesmapsSpringeZuInnerortsPunkt("egal");
	assert.strictEqual(flyToAufrufe[0], 6, "der bestehende Zoom gewinnt, wenn er hoeher als 4 ist");
}

// -- nicht gefunden: kein flyTo, keine Infobox, kein Wurf, false --
{
	const flyToAufrufe = [];
	const trichterAufrufe = [];
	const sandbox = baueSandbox({
		findLocationMarkerByPublicId: () => null,
		map: { getZoom: () => 4, flyTo: (l, z) => flyToAufrufe.push(z) },
		getSpotlightLocationZoom: () => 5,
		openLocationPopupForMarkerEntry: (e) => trichterAufrufe.push(e),
	});
	const ergebnis = sandbox.avesmapsSpringeZuInnerortsPunkt("verschwunden");
	sandbox.zeitgeberAusfuehren();
	assert.strictEqual(ergebnis, false, "kein Marker -> false");
	assert.strictEqual(flyToAufrufe.length, 0, "kein flyTo ohne Marker");
	assert.strictEqual(trichterAufrufe.length, 0, "keine Infobox ohne Marker");
}

console.log("innerorts-sprung-und-von-der-karte-verdrahtung: alle Zusicherungen erfüllt");

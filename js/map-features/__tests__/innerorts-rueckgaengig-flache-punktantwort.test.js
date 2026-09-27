// „Rückgängig" (js/review/review-panels-change-log.js ~Z. 1284) reicht eine FLACHE Punktantwort
// durch applyMapFeatureEditResult() -> applyLiveLocationFeature() -> applyFeatureResponseToMarker().
// Der mittlere Schritt (map-features-feature-dispatcher.js, `applyMapFeatureEditResult`) baute dafuer
// ein EIGENES properties-Objekt und liess `innerorts` dabei aus -- ein „Rückgängig" von
// take_off_map/put_on_map/set_innerorts nahm der Kachel „Von der Karte nehmen" damit still ihre
// Grundlage (Review-Befund nach Task 4, Ruling: beheben, NUR dieses Feld).
//
// 🔴 DAS BAUTEIL WIRD AUSGEFÜHRT: beide Dateien laufen im selben vm-Kontext (derselbe geteilte
// Funktions-/Variablenraum wie im Browser -- klassische Skripte ohne module.exports), damit der
// ECHTE Aufrufpfad läuft, nicht eine Kopie seiner Regel.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/innerorts-rueckgaengig-flache-punktantwort.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function ladeSandbox() {
	const win = {
		avesmapsInSettlementPlaces: [],
		avesmapsStaettenIndex: null,
		avesmapsRefreshInfopanel() {},
	};
	const sandbox = {
		console,
		window: win,
		CROSSING_LOCATION_TYPE: "kreuzung",
		LOCATION_TYPE_CONFIG: {},
		tr: (key, fallback) => fallback,
		map: { getZoom: () => 3 },
		locationMarkers: [],
		locationData: [],
		refusePowerlineAnchoredDeletion: () => false,
		removeLocationNameLabel: () => {},
		clearWaypointLocationName: () => false,
		updateRevisionFromEditResponse: () => {},
		refreshPlannerAfterFeatureChange: () => {},
		showFeedbackToast: () => {},
		findLocationMarkerByPublicId: (id) => sandbox.locationMarkers.find((entry) => entry.publicId === id) || null,
		isCrossingLocation: () => false,
		resolveLocationTypeFromFeature: () => "",
		normalizeLocationType: (v) => v,
		readFeatureWikiUrl: (properties) => properties?.wiki_url || "",
		readFeatureOtherSource: () => null,
		refreshLocationMarkerPopup: () => {},
		ensureLocationNameLabel: () => {},
		refreshPowerlineLayers: () => {},
		syncLocationNameLabelVisibility: () => {},
		replaceWaypointLocationName: () => false,
		submitMapFeatureEdit: async () => { throw new Error("nicht gestubbt"); },
		// map-features-feature-dispatcher.js deklariert weitere Zweige (Pfade/Kraftlinien/Regionen) --
		// sie werden in diesem Test nie AUSGEFÜHRT (nur der flache Punkt-Zweig ist es), Stubs reichen,
		// damit das Modul beim Laden nicht auf `undefined` bricht, falls irgendwo referenziert.
		findPathByPublicId: () => null,
		removePathFeature: () => {},
		findPowerlineByPublicId: () => null,
		powerlineLayers: [],
		powerlineData: [],
		labelMarkers: [],
		labelData: [],
		regionPolygons: [],
		regionLabels: [],
		applyLivePowerlineFeature: () => {},
		applyLivePathFeature: () => {},
		applyLiveLabelFeature: () => {},
		applyRegionFeatureResponse: () => {},
		addRegionFeatureToMap: () => {},
		normalizeRegionFeature: (f) => f,
		readPoliticalTerritoryDerivedSourceIds: () => [],
		readOptionalRegionZoom: () => null,
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "map-features", "map-features-location-editing.js"), sandbox, { filename: "map-features-location-editing.js" });
	vm.runInContext(read("js", "map-features", "map-features-feature-dispatcher.js"), sandbox, { filename: "map-features-feature-dispatcher.js" });
	return sandbox;
}

function testMarkerBehaeltInnerortsNachRueckgaengig() {
	const sandbox = ladeSandbox();
	const markerEntry = {
		name: "Neu-Gareth",
		publicId: "pid-neu-gareth",
		locationType: "stadtviertel",
		marker: { isPopupOpen: () => false, setLatLng: () => {} },
		location: { innerorts: { ort: "pid-alt-gareth" } }, // der Stand VOR dem Rückgängig
	};
	sandbox.locationMarkers = [markerEntry];
	sandbox.locationData = [markerEntry.location];

	// Die flache Punktantwort, wie „Rückgängig" sie liefert (avesmapsBuildPointFeatureResponse) --
	// mit einer ANDEREN Stadt, um eine bloß unveränderte Übernahme des alten Werts auszuschließen.
	const undoErgebnis = {
		feature: {
			public_id: "pid-neu-gareth",
			name: "Neu-Gareth",
			feature_type: "location",
			feature_subtype: "stadtviertel",
			location_type: "stadtviertel",
			lat: 12,
			lng: 34,
			innerorts: { ort: "pid-gareth" },
			revision: 99,
		},
	};

	const angewendet = sandbox.applyMapFeatureEditResult(undoErgebnis);
	assert.strictEqual(angewendet, true, "applyMapFeatureEditResult meldet Erfolg");
	assert.deepStrictEqual(markerEntry.location.innerorts, { ort: "pid-gareth" },
		"der Marker trägt nach 'Rückgängig' die innerorts-Angabe der Antwort -- weder null noch der alte Stand");

	console.log("Marker behält innerorts nach Rückgängig (flache Antwort): OK");
}

function testExplizitesLoesenBleibtLoesen() {
	// Gegenprobe in die andere Richtung: trägt die Antwort AUSDRÜCKLICH keine Zugehörigkeit (z. B.
	// „Rückgängig" eines set_innerorts, das die Zugehörigkeit löste), gilt weiterhin `null` -- die
	// Fallunterscheidung ist "undefined verloren" vs. "die Antwort sagt: keine Stadt", nicht "immer
	// den alten Markerwert behalten".
	const sandbox = ladeSandbox();
	const markerEntry = {
		name: "Neu-Gareth",
		publicId: "pid-neu-gareth",
		locationType: "stadtviertel",
		marker: { isPopupOpen: () => false, setLatLng: () => {} },
		location: { innerorts: { ort: "pid-gareth" } },
	};
	sandbox.locationMarkers = [markerEntry];
	sandbox.locationData = [markerEntry.location];

	sandbox.applyMapFeatureEditResult({
		feature: {
			public_id: "pid-neu-gareth", name: "Neu-Gareth", feature_type: "location",
			feature_subtype: "stadtviertel", location_type: "stadtviertel",
			lat: 12, lng: 34, innerorts: null, revision: 100,
		},
	});
	assert.strictEqual(markerEntry.location.innerorts, null, "eine ausdrücklich leere Antwort löscht die Zugehörigkeit weiterhin");

	console.log("Ausdrückliches Lösen bleibt Lösen: OK");
}

testMarkerBehaeltInnerortsNachRueckgaengig();
testExplizitesLoesenBleibtLoesen();
console.log("innerorts-rueckgaengig-flache-punktantwort: alle Zusicherungen erfüllt");

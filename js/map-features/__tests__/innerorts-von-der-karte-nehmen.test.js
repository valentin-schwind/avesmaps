// „Von der Karte nehmen" / „Ort löschen" an einem innerorts-Punkt -- die Gesten aus
// js/map-features/map-features-location-editing.js (Task 4, Entwurf
// docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §4.1/§4.2).
//
// 🔴 DAS BAUTEIL WIRD AUSGEFÜHRT (vm-Sandkasten), nicht sein Quelltext gelesen: takeLocationOffMap,
// deleteLocationMarker und markiereInnerortsPunktAufDerKarte laufen als der ECHTE Code dieser
// Datei, mit gestubbten Nachbarn (map, submitMapFeatureEdit, showFeedbackToast, …) -- dieselbe
// Rezeptur wie in popup-crossing-report.test.js.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/map-features/__tests__/innerorts-von-der-karte-nehmen.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function ladeLocationEditing(overrides) {
	const toasts = [];
	const removedLayers = [];
	const removedLabels = [];
	const clearedWaypoints = [];
	const revisionUpdates = [];
	const plannerRefreshes = [];
	const confirms = [];
	let confirmAntwort = true;

	const win = {
		confirm: (text) => {
			confirms.push(text);
			return confirmAntwort;
		},
		avesmapsInSettlementPlaces: [],
		avesmapsStaettenIndex: "alt",
		avesmapsRefreshInfopanel_aufrufe: 0,
		avesmapsRefreshInfopanel() {
			this.avesmapsRefreshInfopanel_aufrufe += 1;
		},
	};

	const markerStub = {
		removed: false,
	};

	const sandbox = Object.assign({
		console,
		window: win,
		CROSSING_LOCATION_TYPE: "kreuzung",
		LOCATION_TYPE_CONFIG: {},
		tr: (key, fallback) => fallback,
		L: { latLng: (v) => v },
		map: { removeLayer: (marker) => removedLayers.push(marker) },
		locationMarkers: [],
		locationData: [],
		refusePowerlineAnchoredDeletion: () => false,
		removeLocationNameLabel: (entry) => removedLabels.push(entry),
		clearWaypointLocationName: (name) => {
			clearedWaypoints.push(name);
			return false;
		},
		updateRevisionFromEditResponse: (result) => revisionUpdates.push(result),
		refreshPlannerAfterFeatureChange: (opts) => plannerRefreshes.push(opts),
		showFeedbackToast: (message, type) => toasts.push({ message, type }),
		findLocationMarkerByPublicId: () => null,
		isCrossingLocation: () => false,
		resolveLocationTypeFromFeature: () => "",
		normalizeLocationType: (v) => v,
		submitMapFeatureEdit: async () => { throw new Error("submitMapFeatureEdit nicht gestubbt"); },
	}, overrides || {});
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "map-features", "map-features-location-editing.js"), sandbox, { filename: "map-features-location-editing.js" });

	return {
		sandbox,
		toasts,
		removedLayers,
		removedLabels,
		clearedWaypoints,
		revisionUpdates,
		plannerRefreshes,
		confirms,
		setConfirmAntwort: (v) => { confirmAntwort = v; },
		win,
	};
}

function baueMarkerEntry(overrides) {
	return Object.assign({
		name: "Neu-Gareth",
		publicId: "pid-neu-gareth",
		locationType: "stadtviertel",
		marker: { removedFromMap: false },
		location: { innerorts: { ort: "pid-gareth" } },
	}, overrides || {});
}

async function testTakeLocationOffMapErfolg() {
	const gareth = { name: "Gareth", marker: {} };
	const antwort = { ok: true, revision: 42, innerorts_ort: { public_id: "pid-gareth", name: "Gareth" } };
	const { sandbox, toasts, removedLayers, removedLabels, confirms, win } = ladeLocationEditing({
		findLocationMarkerByPublicId: (id) => (id === "pid-gareth" ? gareth : null),
		submitMapFeatureEdit: async (payload) => {
			assert.strictEqual(payload.action, "take_off_map");
			assert.strictEqual(payload.public_id, "pid-neu-gareth");
			return antwort;
		},
	});
	win.avesmapsInSettlementPlaces = [
		{ public_id: "pid-neu-gareth", name: "Neu-Gareth", settlement: "Gareth", auf_der_karte: true },
	];

	const markerEntry = baueMarkerEntry();
	sandbox.locationMarkers = [markerEntry];
	sandbox.locationData = [markerEntry.location];

	await sandbox.takeLocationOffMap(markerEntry);

	assert.strictEqual(confirms.length, 1, "genau eine Rückfrage");
	assert.strictEqual(confirms[0],
		"„Neu-Gareth“ von der Karte nehmen? Es bleibt als Stätte von Gareth erhalten und kann dort wieder auf die Karte gesetzt werden.",
		"Rückfragetext wörtlich aus Spec §4.1");

	assert.strictEqual(removedLayers[0], markerEntry.marker, "der Marker wird von der Karte genommen");
	assert.strictEqual(removedLabels[0], markerEntry, "das Namenslabel wird entfernt");
	assert.strictEqual(sandbox.locationMarkers.length, 0, "der Marker ist aus locationMarkers entfernt");
	assert.strictEqual(sandbox.locationData.length, 0, "der Ort ist aus locationData entfernt");

	assert.strictEqual(toasts.length, 1);
	assert.strictEqual(toasts[0].message, "„Neu-Gareth“ ist jetzt Stätte von Gareth.", "Meldungstext wörtlich aus Spec §4.1");
	assert.strictEqual(toasts[0].type, "success");

	// Stätten-Index verworfen + Nutzlast nachgezogen (Brief: "Stätten-Index verwerfen")
	assert.strictEqual(win.avesmapsStaettenIndex, null, "der Stätten-Index wurde verworfen");
	assert.strictEqual(win.avesmapsInSettlementPlaces[0].auf_der_karte, false,
		"der Eintrag der Stätten-Liste wird auf 'nicht auf der Karte' nachgezogen");
	assert.strictEqual(win.avesmapsRefreshInfopanel_aufrufe, 1, "das Infopanel wurde aufgefrischt");

	console.log("takeLocationOffMap Erfolg: OK");
}

async function testTakeLocationOffMapAbbrechen() {
	let aufgerufen = false;
	const { sandbox } = ladeLocationEditing({
		submitMapFeatureEdit: async () => { aufgerufen = true; return { ok: true }; },
	});

	const markerEntry = baueMarkerEntry();
	sandbox.window.confirm = () => false;
	await sandbox.takeLocationOffMap(markerEntry);

	assert.strictEqual(aufgerufen, false, "bei Abbrechen wird nichts an den Server geschickt");
	console.log("takeLocationOffMap Abbrechen: OK");
}

async function testTakeLocationOffMapKraftlinienRiegel() {
	let confirmGerufen = false;
	const { sandbox } = ladeLocationEditing({
		refusePowerlineAnchoredDeletion: () => true,
	});
	sandbox.window.confirm = () => { confirmGerufen = true; return true; };
	const markerEntry = baueMarkerEntry();
	await sandbox.takeLocationOffMap(markerEntry);
	assert.strictEqual(confirmGerufen, false, "der Kraftlinien-Riegel verweigert VOR der Rückfrage");
	console.log("takeLocationOffMap Kraftlinien-Riegel: OK");
}

async function testTakeLocationOffMapFehlerVomServer() {
	const { sandbox, toasts, removedLayers } = ladeLocationEditing({
		findLocationMarkerByPublicId: () => ({ name: "Gareth" }),
		submitMapFeatureEdit: async () => { throw new Error("Dieser Punkt ist innerorts nicht mehr gültig."); },
	});
	const markerEntry = baueMarkerEntry();
	await sandbox.takeLocationOffMap(markerEntry);
	assert.strictEqual(removedLayers.length, 0, "bei einem Fehlschlag bleibt der Marker auf der Karte");
	assert.strictEqual(toasts.length, 1);
	assert.strictEqual(toasts[0].type, "warning");
	assert.strictEqual(toasts[0].message, "Dieser Punkt ist innerorts nicht mehr gültig.");
	console.log("takeLocationOffMap Server-Fehler: OK");
}

async function testDeleteLocationMarkerMitInnerorts() {
	const gareth = { name: "Gareth" };
	const { sandbox, confirms } = ladeLocationEditing({
		findLocationMarkerByPublicId: () => gareth,
		submitMapFeatureEdit: async (payload) => {
			assert.strictEqual(payload.action, "delete_feature");
			return { ok: true, deleted: true };
		},
	});
	const markerEntry = baueMarkerEntry({ locationType: "stadtviertel" });
	await sandbox.deleteLocationMarker(markerEntry);
	assert.strictEqual(confirms.length, 1);
	assert.strictEqual(confirms[0],
		"„Neu-Gareth“ wirklich löschen? Es wird auch nicht als Stätte von Gareth geführt.",
		"die ergänzte Rückfrage aus Spec §4.1, wörtlich");
	console.log("deleteLocationMarker (innerorts-Punkt): OK");
}

async function testDeleteLocationMarkerOhneInnerorts() {
	const { sandbox, confirms } = ladeLocationEditing({
		submitMapFeatureEdit: async () => ({ ok: true, deleted: true }),
	});
	const markerEntry = baueMarkerEntry({ location: {} }); // kein innerorts
	await sandbox.deleteLocationMarker(markerEntry);
	assert.strictEqual(confirms[0], "Neu-Gareth wirklich löschen?", "die alte Rückfrage bleibt unverändert, wenn kein innerorts gesetzt ist");
	console.log("deleteLocationMarker (ohne innerorts): OK");
}

function testMarkiereInnerortsPunktAufDerKarte() {
	const { sandbox, win } = ladeLocationEditing({});
	win.avesmapsInSettlementPlaces = [
		{ public_id: "a", name: "A", settlement: "X", auf_der_karte: true },
		{ public_id: "b", name: "B", settlement: "X", auf_der_karte: false },
	];
	sandbox.markiereInnerortsPunktAufDerKarte("b", true);
	assert.strictEqual(win.avesmapsInSettlementPlaces[1].auf_der_karte, true);
	assert.strictEqual(win.avesmapsInSettlementPlaces[0].auf_der_karte, true, "der unbeteiligte Eintrag bleibt unangetastet");
	assert.strictEqual(win.avesmapsStaettenIndex, null);
	assert.strictEqual(win.avesmapsRefreshInfopanel_aufrufe, 1);

	// Ohne Liste (Seite ohne Karte): kein Wurf.
	const { sandbox: sandbox2 } = ladeLocationEditing({});
	sandbox2.window.avesmapsInSettlementPlaces = undefined;
	assert.doesNotThrow(() => sandbox2.markiereInnerortsPunktAufDerKarte("x", true));
	console.log("markiereInnerortsPunktAufDerKarte: OK");
}

(async () => {
	await testTakeLocationOffMapErfolg();
	await testTakeLocationOffMapAbbrechen();
	await testTakeLocationOffMapKraftlinienRiegel();
	await testTakeLocationOffMapFehlerVomServer();
	await testDeleteLocationMarkerMitInnerorts();
	await testDeleteLocationMarkerOhneInnerorts();
	testMarkiereInnerortsPunktAufDerKarte();
	console.log("innerorts-von-der-karte-nehmen: alle Zusicherungen erfüllt");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});

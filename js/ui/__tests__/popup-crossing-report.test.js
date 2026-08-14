const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

// Woertlich aus popup-editor-band.test.js -- dort laeuft crossingActionsMarkup schon durch.
function ladePopups({ editMode }) {
	const sandbox = {
		IS_EDIT_MODE: editMode,
		CROSSING_LOCATION_TYPE: "kreuzung",
		pendingPathCreationStart: null,
		pendingPowerlineCreationStart: null,
		escapeHtml: (v) => String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		buildHtmlAttributes: (attrs) => Object.entries(attrs || {})
			.filter(([, v]) => v !== undefined && v !== null)
			.map(([k, v]) => ` ${k}="${String(v)}"`).join(""),
		tr: (key, german) => german,
		withAssetVersion: (u) => u,
		findWaypointIdByLocationName: () => "",
		findLocationMarkerByPublicId: () => null,
		findLabelEntryByPublicId: () => null,
		buildSuggestChangeButtonSpec: () => null,
		console,
		window: {},
		document: { querySelector: () => null, querySelectorAll: () => [] },
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "ui", "popups.js"), sandbox, { filename: "popups.js" });
	return sandbox;
}

// Laedt map-features-share-pin.js (das Modul, das reportCrossingWithFeedback jetzt traegt) in eine
// eigene vm-Umgebung. findLocationMarkerByPublicId, locationConnectivityIndex und der
// getLocationConnectivityIndex-Spion sind je Aufruf parametrisiert, damit dieselbe Attrappe fuer
// alle drei Szenarien (markiert / unmarkiert-aber-verbunden / Marker fehlt) wiederverwendet wird.
//
// 💣 navigator.clipboard.writeText wird gestubbt, NICHT copyTextToClipboard selbst: die echte
// Funktion ist in genau dieser Datei definiert, eine vorbelegte Attrappe desselben Namens wuerde die
// Funktionsdeklaration beim Laden des Skripts kommentarlos ueberschreiben (JS-Hoisting im
// vm-Kontext) -- der Test wuerde dann unbemerkt den STUB testen, nie den echten Code.
function ladeSharePin({ findMarker, connectivityIndex, clipboardShouldFail = false }) {
	const copiedTexts = [];
	const toasts = [];
	const indexSpion = { aufgerufen: false };
	const sandbox = {
		findLocationMarkerByPublicId: findMarker,
		locationConnectivityIndex: connectivityIndex,
		SPARSE_CROSSING_WAY_COUNT: 2,
		// Finding 1's eigentliche Wache: existierte dieser Aufruf im Code, wuerde er hier durchlaufen
		// und den Spion umlegen -- statt den echten (teuren) Graphbau anzustossen.
		getLocationConnectivityIndex: () => {
			indexSpion.aufgerufen = true;
			return connectivityIndex;
		},
		showFeedbackToast: (message, type) => toasts.push({ message, type }),
		SHARE_PIN_QUERY_PARAM: "pin",
		formatSharePinQueryValue: (latlng) => `${latlng.lat},${latlng.lng}`,
		tr: (key, german) => german,
		console,
		window: { location: { origin: "https://avesmaps.de", pathname: "/" } },
		document: { querySelector: () => null, querySelectorAll: () => [] },
		URLSearchParams,
		navigator: {
			clipboard: {
				writeText: async (text) => {
					copiedTexts.push(text);
					if (clipboardShouldFail) {
						throw new Error("Zwischenablage verweigert (Testfall)");
					}
				},
			},
		},
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "map-features", "map-features-share-pin.js"), sandbox, { filename: "map-features-share-pin.js" });
	return { sandbox, copiedTexts, toasts, indexSpion };
}

async function main() {
	const editor = ladePopups({ editMode: true });
	const markup = editor.crossingActionsMarkup("Kreuzung-2090", "pid-kr");

	// 💣 NUR die Melden-Kachel herausschneiden. „Kreuzung verschieben" und „Kreuzung loeschen" tragen
	// data-location-name zu Recht -- sie fassen den Marker ueber seinen Namen an. Ein Vergleich gegen
	// das GANZE Markup wuerde deshalb immer anschlagen und nichts beweisen.
	const kachel = /<button[^>]*data-popup-action="report-crossing"[^>]*>/.exec(markup);
	assert.ok(kachel, "der Editor bekommt die Melden-Kachel");
	assert.ok(kachel[0].includes('data-public-id="pid-kr"'), "sie traegt die stabile publicId");
	assert.ok(!kachel[0].includes("data-location-name"),
		"💣 und NICHT den angezeigten Namen: „Kreuzung-2090\" ist ein laufender Zaehler ueber die Payload-Reihenfolge und verschiebt sich, sobald jemand eine Kreuzung anlegt, die frueher einsortiert");

	const besucher = ladePopups({ editMode: false });
	assert.strictEqual(besucher.crossingActionsMarkup("Kreuzung-2090", "pid-kr"), "",
		"ein Besucher sieht das Band gar nicht");

	// Der Klick-Zweig ist verdrahtet und delegiert an den benannten Helfer -- die Hausform, die auch
	// share-place-link, write-review & Co. benutzen, statt Promise-Verarbeitung in den Dispatcher zu
	// mischen.
	const routing = read("js", "routing", "routing.js");
	assert.ok(routing.includes('action === "report-crossing"'), "der Klick-Zweig existiert");
	assert.ok(/report-crossing[\s\S]{0,400}void reportCrossingWithFeedback\(/.test(routing),
		"und delegiert an reportCrossingWithFeedback, statt die Zwischenablage selbst zu bedienen");

	// --- reportCrossingWithFeedback selbst: markierte Kreuzung, Index bereits gebaut. ---
	const marker = { location: { coordinates: [12.5, 34.25] } };
	const { sandbox: sbMarkiert, copiedTexts: copiedMarkiert, toasts: toastsMarkiert, indexSpion: spionMarkiert } = ladeSharePin({
		findMarker: (publicId) => (publicId === "pid-kr" ? marker : null),
		connectivityIndex: { unconnected: new Set(), sparseCrossings: new Set(["pid-kr"]) },
	});
	const erwarteterPin = sbMarkiert.buildSharePinLink({ lat: 12.5, lng: 34.25 });
	const didCopyMarkiert = await sbMarkiert.reportCrossingWithFeedback("pid-kr");
	assert.strictEqual(didCopyMarkiert, true, "erfolgreiches Kopieren meldet true");
	assert.strictEqual(copiedMarkiert.length, 1, "genau ein Zwischenablage-Schreibversuch");
	assert.ok(copiedMarkiert[0].includes(erwarteterPin), "die Zeile traegt den ECHTEN Pin-Link (buildSharePinLink), keinen selbstgebauten");
	assert.ok(copiedMarkiert[0].includes("· 2 Arme"), "eine markierte Kreuzung traegt die Armzahl aus SPARSE_CROSSING_WAY_COUNT");
	assert.strictEqual(spionMarkiert.aufgerufen, false,
		"🔴 getLocationConnectivityIndex() darf hier NICHT laufen -- das waere ein Graphbau ueber 5929 Wege bei einem blossen Popup-Klick");
	assert.deepStrictEqual(toastsMarkiert, [{ message: "Kreuzung in die Zwischenablage kopiert.", type: "success" }]);

	// --- Index (noch) nicht gebaut: kein Armzahl-Zusatz, und der Index wird dafuer nicht extra gebaut. ---
	const ohneIndex = ladeSharePin({ findMarker: () => marker, connectivityIndex: null });
	const didCopyOhneIndex = await ohneIndex.sandbox.reportCrossingWithFeedback("pid-sonst");
	assert.strictEqual(didCopyOhneIndex, true);
	assert.ok(!ohneIndex.copiedTexts[0].includes("Arme"), "ohne gebauten Index gibt es keine Armzahl -- nicht 'unmarkiert', sondern 'unbekannt'");
	assert.strictEqual(ohneIndex.indexSpion.aufgerufen, false, "auch hier: kein Nachbau des Index nur fuer die Meldung");

	// --- Marker fehlt (geloescht/verschoben zwischen Popup-Oeffnen und Klick): kein Wurf, kein Schreibversuch. ---
	const ohneMarker = ladeSharePin({ findMarker: () => null, connectivityIndex: null });
	const didCopyOhneMarker = await ohneMarker.sandbox.reportCrossingWithFeedback("verschwunden");
	assert.strictEqual(didCopyOhneMarker, false, "ohne Koordinaten wird nichts kopiert, aber auch nichts geworfen");
	assert.strictEqual(ohneMarker.copiedTexts.length, 0, "kein Schreibversuch ohne Koordinaten");

	// --- Zwischenablage verweigert das Schreiben: gemeldet als false/Warnung, nicht als Wurf. ---
	const clipboardVersagt = ladeSharePin({ findMarker: () => marker, connectivityIndex: null, clipboardShouldFail: true });
	const didCopyVersagt = await clipboardVersagt.sandbox.reportCrossingWithFeedback("pid-versagt");
	assert.strictEqual(didCopyVersagt, false, "ein Zwischenablage-Fehlschlag wird nicht geworfen, sondern als false gemeldet");
	assert.deepStrictEqual(clipboardVersagt.toasts, [{ message: "Konnte nicht automatisch kopiert werden.", type: "warning" }]);

	console.log("popup crossing report tests passed");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

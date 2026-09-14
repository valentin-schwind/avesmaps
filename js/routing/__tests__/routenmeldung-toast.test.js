// Die Meldungen des Routenplaners kommen als Toast des Hauses, nicht als natives alert().
//
// Owner 14.09.2026 (Paket 4 der Performance-Analyse): 5 s Anzeigedauer, Tonfall „warning". Bis dahin
// hielten zwoelf alert()-Aufrufe die Seite an -- „Keine Route gefunden", „Orte nicht gefunden: …", die
// Absage eines Kartenpunkts --, ein Browserdialog, der nicht zur Designsprache gehoert.
//
// ⭐ AUSGEFUEHRT, NICHT GEGREPT: showFeedbackToast und showRouteNotice werden aus map-features.js
// geschnitten und gegen ein gefaelschtes Toast-Element gefahren; route-engine.js wird ganz geladen, der
// Client-Weg updateMapView aus routing.js geschnitten. Ein natives alert() WIRFT.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/routenmeldung-toast.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (relativ) => fs.readFileSync(path.join(REPO, relativ), "utf8").replace(/\r\n/g, "\n");
// Mit vorangestelltem Zeilenumbruch, damit auch eine Deklaration in Zeile 1 gefunden wird.
const schneide = (quelle, name, datei) => {
	const treffer = ("\n" + quelle).match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, `function ${name}() nicht in ${datei} gefunden -- umbenannt?`);
	return treffer[0];
};
const zeile = (quelle, muster, datei) => {
	const treffer = ("\n" + quelle).match(muster);
	assert.ok(treffer, `${muster} nicht in ${datei} gefunden`);
	return treffer[0];
};

// ---- Das Toast-Element und die Uhr ---------------------------------------------------------------------
const toast = { textContent: "", hidden: true, dataset: {}, klassen: new Set() };
toast.classList = { add: (k) => toast.klassen.add(k), remove: (k) => toast.klassen.delete(k) };
const wecker = [];
global.window = {
	location: { search: "" },
	setTimeout: (fn, ms) => { wecker.push({ fn, ms }); return wecker.length; },
	clearTimeout: (id) => { if (wecker[id - 1]) { wecker[id - 1].fn = null; } },
};
global.document = { getElementById: (id) => (id === "copy-feedback-toast" ? toast : null) };
global.feedbackToastTimeoutId = null;
const letzterWecker = () => wecker[wecker.length - 1];
const laufAb = () => { const w = letzterWecker(); if (w && w.fn) { const fn = w.fn; w.fn = null; fn(); } };
const zuruecksetzen = () => { laufAb(); toast.textContent = ""; toast.hidden = true; };

// ---- Raender fuer die Routen-Engine -------------------------------------------------------------------
global.alert = (message) => { throw new Error("natives alert() im Routenplaner: " + message); };
global.tr = (key, fallback, vars) => String(fallback).replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] !== undefined ? vars[name] : ""));
global.$ = () => ({ is: () => false, val: () => "fastest", text: () => {}, empty: () => {} });
global.buildRouteOptionsFromPlannerControls = () => ({ allowLand: true, allowRiver: true, allowSea: true, landOption: "groupFoot" });
global.getPlannerRestHoursPerDay = () => 16;
global.normalizePathSubtype = (value) => String(value || "Weg");
global.findPathByPublicId = () => null;
global.pathData = [];
global.syntheticPathSegments = new Map();
global.getTransportOptionForRouteType = () => "groupFoot";
global.syncPlannerStateToUrl = () => {};
global.resetRoutePresentation = () => {};
global.removeStaleRouteLine = () => {};
global.collectAndValidateSelectedLocations = () => {};
global.renderRouteWaypointMarkers = () => {};
global.invalidLocationInputs = [];
global.focusMapOnActiveTargets = () => {};
global.logRoutePoints = () => {};
global.drawRoute = () => {};
global.showRoutePlan = () => {};
global.zoomToCurrentRoute = () => {};
global.showRouteClosureRefusal = () => {};
global.resetOverview = () => {};
global.routePlanDepartureFromPanel = () => null;
global.createGraph = () => ({});
global.graphData = null;
global.currentRouteClosures = [];
global.currentRouteSeasonalWays = [];
global.isTravelHereErrorCode = (code) => code === "no_land_route";
global.travelHereErrorMessage = () => "Dorthin führt kein Landweg.";

const echtesLog = console.log;
const echterFehler = console.error;
console.log = () => {};
console.error = () => {};
console.info = () => {};

const features = lies("js/map-features/map-features.js");
vm.runInThisContext(
	schneide(features, "getFeedbackToastElement", "js/map-features/map-features.js")
		+ zeile(features, /\nconst FEEDBACK_TOAST_DEFAULT_MS = [^;]+;/, "js/map-features/map-features.js")
		+ schneide(features, "showFeedbackToast", "js/map-features/map-features.js")
		+ zeile(features, /\nconst ROUTE_NOTICE_TOAST_MS = [^;]+;/, "js/map-features/map-features.js")
		+ zeile(features, /\nlet routeNoticeText = [^;]+;/, "js/map-features/map-features.js")
		+ schneide(features, "showRouteNotice", "js/map-features/map-features.js"),
	{ filename: "toast-ausgeschnitten.js" }
);
vm.runInThisContext(lies("js/routing/route-engine.js"), { filename: "route-engine.js" });
vm.runInThisContext(schneide(lies("js/routing/routing.js"), "updateMapView", "js/routing/routing.js"), { filename: "routing-updateMapView.js" });

// ---- Der Server --------------------------------------------------------------------------------------
let naechsteAntwort = null;
global.calculateRouteServer = async () => {
	const wert = naechsteAntwort;
	if (wert instanceof Error) {
		throw wert;
	}
	return { source: "server", ok: true, found: wert.found, segments: wert.segments || [], route: wert };
};
const etappe = (id) => ({ edge_id: id, from_node: "Gareth", to_node: "Perricum", subtype: "Strasse", geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } });

const serverweg = async (antwort, { ungueltig = [] } = {}) => {
	zuruecksetzen();
	global.selectedLocations = [{ name: "Gareth" }, { name: "Perricum" }];
	global.invalidLocationInputs = ungueltig;
	naechsteAntwort = antwort;
	await updateMapViewServerPrimary();
	return toast.textContent;
};

(async () => {
	// ---- A) Das Bauteil ------------------------------------------------------------------------------
	{
		zuruecksetzen();
		showRouteNotice("Keine Route gefunden.");
		assert.strictEqual(toast.textContent, "Keine Route gefunden.", "A: der Satz steht im Toast");
		assert.strictEqual(toast.hidden, false, "A: sichtbar");
		assert.ok(toast.klassen.has("is-visible"));
		assert.strictEqual(toast.dataset.toastType, "warning", "A: Tonfall warning, wie die Nicht-gefunden-Meldungen im Routing");
		assert.strictEqual(letzterWecker().ms, 5000, "A: Owner 14.09.2026 -- eine Routenmeldung steht 5 s");

		zuruecksetzen();
		showFeedbackToast("Gespeichert.", "success");
		assert.strictEqual(letzterWecker().ms, 2200, "A: jeder andere Toast behaelt seine 2,2 s");

		// Reihung: zwei Meldungen derselben Berechnung ersetzen sich nicht.
		zuruecksetzen();
		showRouteNotice("Orte nicht gefunden: Gartheh");
		showRouteNotice("Keine Route zwischen Gareth und Perricum gefunden.");
		assert.strictEqual(toast.textContent, "Orte nicht gefunden: Gartheh · Keine Route zwischen Gareth und Perricum gefunden.",
			"A: die erste Meldung geht nicht verloren: " + toast.textContent);
		assert.strictEqual(letzterWecker().ms, 5000, "A: und die Uhr beginnt neu");
		showRouteNotice("Keine Route zwischen Gareth und Perricum gefunden.");
		assert.strictEqual(toast.textContent, "Orte nicht gefunden: Gartheh · Keine Route zwischen Gareth und Perricum gefunden.",
			"A: dieselbe Meldung wird nicht doppelt angehaengt");

		// Ist die Meldung abgelaufen, beginnt die naechste neu.
		laufAb();
		assert.strictEqual(toast.hidden, true, "A: nach Ablauf ist der Toast zu");
		showRouteNotice("Keine Route gefunden.");
		assert.strictEqual(toast.textContent, "Keine Route gefunden.", "A: nach Ablauf wird nicht angehaengt");

		// Ein fremder Toast dazwischen: nie an ihn anhaengen.
		showFeedbackToast("Link kopiert.", "success");
		showRouteNotice("Orte nicht gefunden: Gartheh");
		assert.strictEqual(toast.textContent, "Orte nicht gefunden: Gartheh", "A: an einen fremden Toast wird nicht angehaengt");
		assert.strictEqual(toast.dataset.toastType, "warning");

		zuruecksetzen();
		showRouteNotice("   ");
		assert.strictEqual(toast.hidden, true, "A: eine leere Meldung zeigt nichts");
	}

	// ---- B) Der Serverweg: jede Meldung als Toast, nie als alert() ---------------------------------------
	assert.strictEqual(await serverweg({ found: false, segments: [], duration: {}, closures: [] }),
		"Keine Route zwischen Gareth und Perricum gefunden.", "B: keine Route");
	assert.strictEqual(await serverweg({ found: true, segments: [], duration: {}, closures: [] }),
		"Die Serverroute zwischen Gareth und Perricum konnte nicht angezeigt werden.", "B: Route nicht darstellbar");
	assert.strictEqual(await serverweg(new Error("HTTP 503")), "HTTP 503", "B: Serverfehler");
	{
		const absage = new Error("x");
		absage.code = "no_land_route";
		assert.strictEqual(await serverweg(absage), "Dorthin führt kein Landweg.", "B: Absage eines Kartenpunkts");
	}
	assert.strictEqual(await serverweg({ found: false, segments: [], duration: {}, closures: [] }, { ungueltig: ["Gartheh"] }),
		"Orte nicht gefunden: Gartheh · Keine Route zwischen Gareth und Perricum gefunden.",
		"B: ungueltiger Ort UND keine Route -- beide Meldungen stehen");
	{
		const echt = global.buildRouteResultFromSelectedLocationsServer;
		global.buildRouteResultFromSelectedLocationsServer = async () => ({ routeNodeNames: [], segments: [] });
		assert.strictEqual(await serverweg({ found: true, segments: [etappe("e1")], duration: {}, closures: [] }),
			"Keine gültigen Server-Routensegmente gefunden.", "B: keine gueltigen Segmente");
		global.buildRouteResultFromSelectedLocationsServer = echt;
	}
	assert.strictEqual(toast.dataset.toastType, "warning");
	assert.strictEqual(letzterWecker().ms, 5000);

	// ---- C) Der Client-Weg (?clientrouting=1) --------------------------------------------------------
	{
		global.probeServerRouteForClientSegment = () => {};
		global.getRouteSegments = () => [];
		updateMapViewServerPrimary.requestId = 7;

		zuruecksetzen();
		global.selectedLocations = [{ name: "Gareth" }, { name: "Perricum" }];
		global.invalidLocationInputs = [];
		global.calculateRouteClientLegacy = () => [];
		updateMapViewClientLegacy(false, 7);
		assert.strictEqual(toast.textContent, "Keine Route zwischen Gareth und Perricum gefunden.", "C: keine Route (Client)");

		zuruecksetzen();
		global.calculateRouteClientLegacy = () => [{ from: "Gareth", to: "Perricum" }];
		updateMapViewClientLegacy(false, 7);
		assert.strictEqual(toast.textContent, "Keine gültigen Routensegmente gefunden.", "C: keine gueltigen Segmente (Client)");

		zuruecksetzen();
		global.invalidLocationInputs = ["Gartheh"];
		global.selectedLocations = [{ name: "Gareth" }];
		updateMapViewClientLegacy(false, 7);
		assert.strictEqual(toast.textContent, "Orte nicht gefunden: Gartheh", "C: ungueltiger Ort (Client)");

		// Die aelteste Fassung in routing.js -- erreichbar, wenn der Serverweg abgeschaltet ist.
		global.shouldUseServerPrimaryRouting = () => false;
		zuruecksetzen();
		global.invalidLocationInputs = ["Gartheh"];
		global.selectedLocations = [{ name: "Gareth" }];
		updateMapView();
		assert.strictEqual(toast.textContent, "Orte nicht gefunden: Gartheh", "C: ungueltiger Ort (routing.js)");

		zuruecksetzen();
		global.invalidLocationInputs = [];
		global.selectedLocations = [{ name: "Gareth" }, { name: "Perricum" }];
		updateMapView();
		assert.strictEqual(toast.textContent, "Keine gültigen Routensegmente gefunden.", "C: keine gueltigen Segmente (routing.js)");
	}

	// ---- D) Kein alert() und kein ajaxError-Handler mehr im Routing -------------------------------------
	// Der Handler konnte nie ausloesen: ausser den Bibliotheken ruft niemand jQuery-Ajax auf.
	{
		const verzeichnis = path.join(REPO, "js", "routing");
		const dateien = fs.readdirSync(verzeichnis).filter((name) => name.endsWith(".js"));
		assert.ok(dateien.length > 10, "D: das Routing-Verzeichnis ist lesbar");
		for (const name of dateien) {
			const code = lies(`js/routing/${name}`).split("\n")
				.filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
				.map((z) => z.replace(/\s\/\/.*$/, ""))
				.join("\n");
			assert.ok(!/(^|[^\w.])alert\(/.test(code), `D: ${name} ruft noch alert() auf`);
			assert.ok(!/\.ajaxError\(/.test(code), `D: ${name} haengt noch einen ajaxError-Handler an`);
		}
	}

	console.log = echtesLog;
	console.error = echterFehler;
	echtesLog("routenmeldung-toast.test.js: all assertions passed");
})().catch((error) => {
	console.error = echterFehler;
	echterFehler(error);
	process.exit(1);
});

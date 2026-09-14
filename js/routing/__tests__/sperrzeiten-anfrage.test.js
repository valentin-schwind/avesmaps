// Der Routenplaner fragt mit Reisedatum und sammelt die Sperrberichte je Wegpunktpaar.
// Entwurf docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md §7.
//
// ⭐ AUSGEFUEHRT, NICHT GEGREPT: route-engine.js wird geladen, `calculateRouteServer` durch eine
// Attrappe ersetzt, die die Anfragen mitschreibt und vorbereitete Antworten gibt -- und dann laufen
// die echten `buildRouteResultFromSelectedLocationsServer` und `updateMapViewServerPrimary`.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/sperrzeiten-anfrage.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- Raender -----------------------------------------------------------------------------------------
// Die Meldungen des Planers (seit 14.09.2026 ein Toast statt alert(), js/map-features/map-features.js).
// Der Name `alerts` bleibt: gezaehlt wird dieselbe Meldung, nur ihr Bauteil hat gewechselt.
const alerts = [];
const refusals = [];
let overviewText = null;
let closuresBeimZeichnen = null;
global.window = { location: { search: "" }, setTimeout: () => 0 };
global.showRouteNotice = (message) => alerts.push(String(message));
global.alert = (message) => { throw new Error("natives alert() im Routenplaner: " + message); };
global.tr = (key, fallback, vars) => String(fallback).replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] !== undefined ? vars[name] : ""));
global.$ = (selector) => ({
	is: () => false,
	val: () => "fastest",
	text: (value) => { if (selector === "#overview") { overviewText = value; } },
});
global.buildRouteOptionsFromPlannerControls = () => ({ allowLand: true, allowRiver: true, allowSea: true, landOption: "horseCarriage" });
global.getPlannerRestHoursPerDay = () => 16;
global.normalizePathSubtype = (value) => String(value || "Weg");
global.findPathByPublicId = () => null;
global.pathData = [];
global.syntheticPathSegments = new Map();
global.getTransportOptionForRouteType = () => "horseCarriage";
global.syncPlannerStateToUrl = () => {};
global.resetRoutePresentation = () => { global.currentRouteClosures = []; global.currentRouteSeasonalWays = []; };
// Die gedimmte vorige Route (Paket 4, 14.09.2026) -- hier nicht Gegenstand, siehe alte-route-bleibt-stehen.test.js.
global.removeStaleRouteLine = () => {};
let saisonalBeimZeichnen = null;
global.collectAndValidateSelectedLocations = () => {};
global.renderRouteWaypointMarkers = () => {};
global.invalidLocationInputs = [];
global.focusMapOnActiveTargets = () => {};
global.logRoutePoints = () => {};
global.drawRoute = () => {};
global.showRoutePlan = () => { closuresBeimZeichnen = global.currentRouteClosures; saisonalBeimZeichnen = global.currentRouteSeasonalWays; };
global.zoomToCurrentRoute = () => {};
global.showRouteClosureRefusal = (refusal) => refusals.push(refusal);
global.currentRouteClosures = [];

const load = (relative) => {
	const absolute = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
load("../route-buendel.js");
load("../route-engine.js");

// ---- Die Attrappe des Servers -------------------------------------------------------------------------
let anfragen = [];
let antworten = [];
global.calculateRouteServer = async (request) => {
	anfragen.push(JSON.parse(JSON.stringify(request)));
	const antwort = antworten.shift();
	return { source: "server", ok: true, found: antwort.found, segments: antwort.segments || [], route: antwort };
};
const etappe = (id, von, nach) => ({
	edge_id: id, from_node: von, to_node: nach, subtype: "Strasse",
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
});
const bericht = (kante, extra = {}) => ({
	leg_index: 0, blocked: false, diverges_at_node: "Yrramis", diverges_at_edge_id: kante,
	avoided: [{ kind: "transport", path_name: "Schattenbachpass", public_ids: ["pub-Q"], allowed: ["groupFoot", "lightWalker"] }],
	actual: { distance_units: 980.9, travel_hours: 375.4, travel_days: 36.43 },
	unrestricted: { distance_units: 94.9, travel_hours: 115.6, travel_days: 14.45 },
	...extra,
});

(async () => {
	// Muehlingen als Kartenpunkt: Buendelgrenze -- die Abschnitte 1 bis 6 pruefen weiter ZWEI Anfragen je Reise.
	global.selectedLocations = [{ name: "Yrramis" }, { name: "Mühlingen", isMapPoint: true }, { name: "Greifenfurt" }];

	// ---- 1. Mit Reisebeginn: Paar 2 beginnt nach der Kalenderzeit von Paar 1 --------------------------
	global.routePlanDepartureFromPanel = () => ({ monthKey: "firun", day: 3 });
	anfragen = [];
	antworten = [
		{ found: true, segments: [etappe("e1", "Yrramis", "Mühlingen")], duration: { travel_days: 2 }, closures: [] },
		{ found: true, segments: [etappe("e2", "Mühlingen", "X"), etappe("e3", "X", "Greifenfurt")], duration: { travel_days: 1 }, closures: [bericht("e3")] },
	];
	const mitDatum = await buildRouteResultFromSelectedLocationsServer(false);
	assert.deepStrictEqual(anfragen[0].departure, { month: "firun", day: 3, elapsed_hours: 0 }, "Paar 1 schickt den Reisebeginn");
	assert.deepStrictEqual(anfragen[1].departure, { month: "firun", day: 3, elapsed_hours: 48 },
		"Paar 2 schickt DENSELBEN Reisebeginn plus die Kalenderstunden von Paar 1: " + JSON.stringify(anfragen[1].departure));
	assert.strictEqual(mitDatum.segments.length, 3, "drei Segmente ueber beide Paare");
	assert.strictEqual(mitDatum.closures.length, 1, "ein Bericht");
	assert.strictEqual(mitDatum.closures[0].segmentOffset, 1, "der Bericht von Paar 2 kennt seinen Versatz: " + JSON.stringify(mitDatum.closures[0]));
	assert.strictEqual(mitDatum.closures[0].segmentCount, 2, "und die Zahl seiner Segmente");
	assert.strictEqual(mitDatum.closures[0].diverges_at_edge_id, "e3", "der Bericht bleibt unveraendert");

	// ---- 2. Ohne Reisebeginn: kein departure-Feld, die Reisemittel-Sperre meldet sich trotzdem -------
	global.routePlanDepartureFromPanel = () => null;
	anfragen = [];
	antworten = [
		{ found: true, segments: [etappe("e1", "Yrramis", "Mühlingen")], duration: { travel_days: 2 }, closures: [bericht("e1")] },
		{ found: true, segments: [etappe("e2", "Mühlingen", "Greifenfurt")], duration: { travel_days: 1 }, closures: [] },
	];
	const ohneDatum = await buildRouteResultFromSelectedLocationsServer(false);
	assert.ok(!("departure" in anfragen[0]) && !("departure" in anfragen[1]), "ohne Monat kein departure: " + JSON.stringify(anfragen[0]));
	assert.strictEqual(ohneDatum.closures.length, 1, "der Kutschenbericht kommt ohne Datum");
	assert.strictEqual(ohneDatum.closures[0].segmentOffset, 0, "Paar 1 beginnt bei Segment 0");

	// ---- 3. Nur wegen einer Sperre keine Route: Absage im Panel, KEIN Popup -------------------------
	alerts.length = 0;
	antworten = [{ found: false, segments: [], duration: {}, closures: [bericht("", { blocked: true, actual: null })] }];
	const absage = await buildRouteResultFromSelectedLocationsServer(false);
	assert.ok(absage && absage.refusal, "die Absage kommt als Ergebnis zurueck: " + JSON.stringify(absage));
	assert.strictEqual(absage.refusal.start, "Yrramis");
	assert.strictEqual(absage.refusal.end, "Mühlingen");
	assert.strictEqual(absage.refusal.report.blocked, true);
	assert.strictEqual(alerts.length, 0, "kein Popup: " + JSON.stringify(alerts));

	// ---- 4. Die uebrigen Absagen bleiben, wie sie sind ---------------------------------------------
	antworten = [{ found: false, segments: [], duration: {}, closures: [] }];
	const alteAbsage = await buildRouteResultFromSelectedLocationsServer(false);
	assert.strictEqual(alteAbsage, null, "ohne Sperrbericht die alte Absage");
	assert.strictEqual(alerts.length, 1, "mit ihrem Popup");

	// ---- 5. Die Verdrahtung: Berichte liegen beim Zeichnen bereit, die Absage geht ins Panel ---------
	global.routePlanDepartureFromPanel = () => ({ monthKey: "firun", day: 3 });
	global.selectedLocations = [{ name: "Yrramis" }, { name: "Greifenfurt" }];
	antworten = [{ found: true, segments: [etappe("e1", "Yrramis", "Greifenfurt")], duration: { travel_days: 36.43 }, closures: [bericht("e1")] }];
	await updateMapViewServerPrimary();
	assert.ok(Array.isArray(closuresBeimZeichnen) && closuresBeimZeichnen.length === 1,
		"showRoutePlan sieht die Berichte: " + JSON.stringify(closuresBeimZeichnen));

	alerts.length = 0;
	antworten = [{ found: false, segments: [], duration: {}, closures: [bericht("", { blocked: true, actual: null })] }];
	await updateMapViewServerPrimary();
	assert.strictEqual(refusals.length, 1, "die Absage wird im Panel gezeigt");
	assert.strictEqual(alerts.length, 0, "ohne Popup");
	assert.deepStrictEqual(global.currentRouteClosures, [], "und haengt keinen alten Bericht an");

	// ---- 6. Reisebeginn unbekannt: die Wege mit Sperrzeit werden gesammelt und liegen beim Zeichnen bereit
	global.routePlanDepartureFromPanel = () => null;
	// Muehlingen als Kartenpunkt: Buendelgrenze -- die Abschnitte 1 bis 6 pruefen weiter ZWEI Anfragen je Reise.
	global.selectedLocations = [{ name: "Yrramis" }, { name: "Mühlingen", isMapPoint: true }, { name: "Greifenfurt" }];
	const weg = { path_name: "Saljethweg", public_ids: ["pub-P"], open_from: { month: "peraine", day: 15 }, open_to: { month: "efferd", day: 30 } };
	antworten = [
		{ found: true, segments: [etappe("e1", "Yrramis", "Mühlingen")], duration: { travel_days: 2 }, seasonal_ways: [weg] },
		{ found: true, segments: [etappe("e2", "Mühlingen", "Greifenfurt")], duration: { travel_days: 1 } },
	];
	const unbekannt = await buildRouteResultFromSelectedLocationsServer(false);
	assert.deepStrictEqual(unbekannt.seasonalWays, [weg], "die Wege mit Sperrzeit reisen aus dem Paar heraus");
	antworten = [
		{ found: true, segments: [etappe("e1", "Yrramis", "Mühlingen")], duration: { travel_days: 2 }, seasonal_ways: [weg] },
		{ found: true, segments: [etappe("e2", "Mühlingen", "Greifenfurt")], duration: { travel_days: 1 } },
	];
	await updateMapViewServerPrimary();
	assert.ok(Array.isArray(saisonalBeimZeichnen) && saisonalBeimZeichnen.length === 1,
		"showRoutePlan sieht sie: " + JSON.stringify(saisonalBeimZeichnen));

	// ---- 7. Buendel (Entwurf 2026-09-14 §5.3): drei Orte ohne Kartenpunkt sind EINE Anfrage mit `via` -----
	global.routePlanDepartureFromPanel = () => null;
	global.selectedLocations = [{ name: "Yrramis" }, { name: "Mühlingen" }, { name: "Greifenfurt" }];
	anfragen = [];
	antworten = [{ found: true, segments: [etappe("e1", "Yrramis", "Mühlingen"), etappe("e2", "Mühlingen", "Greifenfurt")],
		duration: { travel_days: 3 }, closures: [bericht("e2", { leg_index: 1 })] }];
	const gebuendelt = await buildRouteResultFromSelectedLocationsServer(false);
	assert.strictEqual(anfragen.length, 1, "eine Anfrage: " + JSON.stringify(anfragen.map((a) => [a.from, a.via, a.to])));
	assert.deepStrictEqual([anfragen[0].from, anfragen[0].via, anfragen[0].to], ["Yrramis", ["Mühlingen"], "Greifenfurt"]);
	assert.strictEqual(gebuendelt.segments.length, 2);
	assert.strictEqual(gebuendelt.closures[0].segmentOffset, 0, "der Versatz gilt dem Buendel");
	assert.strictEqual(gebuendelt.closures[0].segmentCount, 2, "und die Zahl seiner Segmente");
	// Die Absage nennt die ETAPPE aus leg_index, nicht das Buendel
	antworten = [{ found: false, segments: [], duration: {}, closures: [bericht("", { leg_index: 1, blocked: true, actual: null })] }];
	const buendelAbsage = await buildRouteResultFromSelectedLocationsServer(false);
	assert.deepStrictEqual([buendelAbsage.refusal.start, buendelAbsage.refusal.end], ["Mühlingen", "Greifenfurt"]);
	// Eine Absage ohne Sperrbericht nennt Anfang und Ende des Buendels
	alerts.length = 0;
	antworten = [{ found: false, segments: [], duration: {}, closures: [] }];
	assert.strictEqual(await buildRouteResultFromSelectedLocationsServer(false), null);
	assert.ok(alerts[0].includes("Yrramis") && alerts[0].includes("Greifenfurt"), alerts[0]);

	console.log("sperrzeiten-anfrage.test.js: all assertions passed");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});

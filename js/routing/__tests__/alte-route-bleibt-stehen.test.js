// Beim Neuberechnen bleibt die vorige Route GEDIMMT stehen, bis die neue gezeichnet ist.
//
// Owner 14.09.2026 (Paket 4 der Performance-Analyse, „gedimmt" statt weg). Vorher raeumte
// resetRoutePresentation die Linie sofort ab: live gemessen stand die Karte beim Umschalten
// Schnellste -> Kuerzeste (Gareth -> Perricum) 1,74 s ohne Route.
//
// ⭐ AUSGEFUEHRT, NICHT GEGREPT: route-engine.js wird ganz geladen, resetRoutePresentation (map-features.js),
// drawRoute und seine zwei Helfer (route-render.js) werden aus den ausgelieferten Dateien geschnitten,
// Leaflet ist eine Attrappe, die mitschreibt, was auf der Karte liegt, und der Server antwortet erst,
// wenn der Test es sagt.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/alte-route-bleibt-stehen.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (relativ) => fs.readFileSync(path.join(REPO, relativ), "utf8").replace(/\r\n/g, "\n");
// Deklarationen stehen in Spalte 0 -- eine schliessende Klammer in Spalte 0 beendet die Funktion.
// ⚠️ Mit vorangestelltem Zeilenumbruch -- createRouteNodeMarkersForSegment steht in Zeile 1.
const schneide = (quelle, name, datei) => {
	const treffer = ("\n" + quelle).match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, `function ${name}() nicht in ${datei} gefunden -- umbenannt?`);
	return treffer[0];
};
const konstante = (quelle, name, datei) => {
	const treffer = quelle.match(new RegExp("\\nconst " + name + " = [^;]+;"));
	assert.ok(treffer, `const ${name} nicht in ${datei} gefunden`);
	return treffer[0];
};

// ---- Leaflet-Attrappe --------------------------------------------------------------------------------
const aufKarte = new Set();
global.map = {
	addLayer(layer) { aufKarte.add(layer); return this; },
	removeLayer(layer) { aufKarte.delete(layer); return this; },
};
class Gruppe {
	constructor() { this.layers = []; }
	addLayer(layer) { this.layers.push(layer); return this; }
	getLayers() { return this.layers; }
	eachLayer(fn) { this.layers.forEach(fn); }
	addTo(karte) { karte.addLayer(this); return this; }
}
class Linie {
	constructor(koordinaten, optionen) {
		this.options = { ...optionen };
		this.handler = {};
		const klassen = new Set(this.options.interactive === false ? [] : ["leaflet-interactive"]);
		this.element = { classList: { remove: (k) => klassen.delete(k), contains: (k) => klassen.has(k) } };
	}
	setStyle(stil) { Object.assign(this.options, stil); return this; }
	on(ereignis, fn) { this.handler[ereignis] = fn; return this; }
	off(ereignis) { delete this.handler[ereignis]; return this; }
	getElement() { return this.element; }
}
global.L = { layerGroup: () => new Gruppe(), polyline: (koordinaten, optionen) => new Linie(koordinaten, optionen) };

// ---- Raender -----------------------------------------------------------------------------------------
const alerts = [];
let overviewText = null;
global.window = { location: { search: "" }, setTimeout: () => 0 };
global.alert = (message) => alerts.push(String(message));
global.tr = (key, fallback, vars) => String(fallback).replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] !== undefined ? vars[name] : ""));
global.$ = (selector) => ({
	is: () => false,
	val: () => "fastest",
	text: (value) => { if (selector === "#overview") { overviewText = value; } },
	empty: () => {},
});
global.buildRouteOptionsFromPlannerControls = () => ({ allowLand: true, allowRiver: true, allowSea: true, landOption: "groupFoot" });
global.getPlannerRestHoursPerDay = () => 16;
global.normalizePathSubtype = (value) => String(value || "Weg");
global.findPathByPublicId = () => null;
global.pathData = [];
global.syntheticPathSegments = new Map();
global.getTransportOptionForRouteType = () => "groupFoot";
global.syncPlannerStateToUrl = () => {};
global.collectAndValidateSelectedLocations = () => {};
global.renderRouteWaypointMarkers = () => {};
global.invalidLocationInputs = [];
global.focusMapOnActiveTargets = () => {};
global.logRoutePoints = () => {};
global.showRoutePlan = () => {};
global.zoomToCurrentRoute = () => {};
global.showRouteClosureRefusal = () => {};
global.routePlanDepartureFromPanel = () => null;
global.clearRouteDirectionMarkers = () => {};
global.removeHighlightedRouteNodes = () => {};
global.resetOverview = () => {};
global.smoothLineCoordinatesForDisplay = (koordinaten) => koordinaten;
global.VISUAL_LINE_CATMULL_ROM_CONFIG = {};
global.getRouteSegmentStyle = (segment) => ({ pane: "routePane", opacity: segment?.properties?.synthetic ? 0.7 : 1, interactive: true });
global.getRouteSegmentOutlineStyle = (segment) => ({ pane: "routeOutlinePane", opacity: segment?.properties?.synthetic ? 0.7 : 1, interactive: false });
global.selectRoutePlanEntryForSegment = () => {};
// Der Laufzeitzustand, wie runtime-state.js ihn anlegt.
global.currentRouteLayer = null;
global.staleRouteLayer = null;
global.currentRouteNodeLayer = null;
global.currentRouteSegmentLayers = [];
global.currentRoutePlanEntries = [];
global.currentRouteSegments = [];
global.currentRouteNames = [];
global.currentRouteClosures = [];
global.currentRouteSeasonalWays = [];
global.activeRoutePlanEntryIndex = null;
global.graphData = null;

// Die Routen-Engine protokolliert jede Route ausfuehrlich -- hier nur Rauschen.
const echtesLog = console.log;
console.log = () => {};
vm.runInThisContext(lies("js/routing/route-engine.js"), { filename: "route-engine.js" });
const render = lies("js/routing/route-render.js");
const features = lies("js/map-features/map-features.js");
vm.runInThisContext(
	konstante(lies("js/config.js"), "ROUTE_STALE_OPACITY_FACTOR", "js/config.js")
		+ schneide(features, "resetRoutePresentation", "js/map-features/map-features.js")
		+ schneide(render, "createRouteNodeMarkersForSegment", "js/routing/route-render.js")
		+ schneide(render, "drawRoute", "js/routing/route-render.js")
		+ schneide(render, "retireCurrentRouteLineAsStale", "js/routing/route-render.js")
		+ schneide(render, "removeStaleRouteLine", "js/routing/route-render.js"),
	{ filename: "ausgeschnitten.js" }
);
const FAKTOR = vm.runInThisContext("ROUTE_STALE_OPACITY_FACTOR");

// ---- Der Server: jede Anfrage wartet, bis der Test sie beantwortet ------------------------------------
const offeneAnfragen = [];
global.calculateRouteServer = (request) => new Promise((aufloesen, ablehnen) => {
	offeneAnfragen.push({ request, aufloesen, ablehnen });
});
const etappe = (id, von, nach, extra = {}) => ({
	edge_id: id, from_node: von, to_node: nach, subtype: "Strasse",
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	...extra,
});
const antwort = (route) => ({ source: "server", ok: true, found: route.found, segments: route.segments || [], route });
const gefunden = (id) => antwort({ found: true, segments: [etappe(id, "Gareth", "Perricum")], duration: { travel_days: 1 }, closures: [] });
const mikrotasks = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((fertig) => setImmediate(fertig));
	}
};
// Beantwortet die aelteste offene Anfrage und wartet, bis die Berechnung durchgelaufen ist.
const beantworte = async (wert) => {
	const anfrage = offeneAnfragen.shift();
	assert.ok(anfrage, "es wartet keine Anfrage");
	if (wert instanceof Error) {
		anfrage.ablehnen(wert);
	} else {
		anfrage.aufloesen(wert);
	}
	await mikrotasks();
};
const zweiWegpunkte = () => { global.selectedLocations = [{ name: "Gareth" }, { name: "Perricum" }]; };
const linienVon = (gruppe) => gruppe.getLayers();

// Eine gezeichnete Route als Ausgangslage.
const zeichneErsteRoute = async () => {
	zweiWegpunkte();
	const lauf = updateMapViewServerPrimary();
	await beantworte(gefunden("alt"));
	await lauf;
	assert.ok(global.currentRouteLayer && aufKarte.has(global.currentRouteLayer), "Ausgangslage: eine Route liegt auf der Karte");
	assert.strictEqual(global.staleRouteLayer, null, "Ausgangslage: keine veraltete Linie");
	return global.currentRouteLayer;
};

(async () => {
	assert.strictEqual(FAKTOR, 0.4, "Owner 14.09.2026: gedimmt, nicht weg -- der Faktor ist ein festgelegter Wert");

	// ---- 1. Neuberechnen: die vorige Linie bleibt gedimmt stehen, bis die neue da ist -------------------
	{
		const alt = await zeichneErsteRoute();
		const lauf = updateMapViewServerPrimary();
		// Der Server hat noch nicht geantwortet.
		assert.ok(aufKarte.has(alt), "1: die vorige Route liegt waehrend der Berechnung WEITER auf der Karte");
		assert.strictEqual(global.staleRouteLayer, alt, "1: als veraltete Linie");
		assert.strictEqual(global.currentRouteLayer, null, "1: und NICHT als aktuelle -- Mitleser sehen keine Route");
		assert.deepStrictEqual(global.currentRouteSegmentLayers, [], "1: die Etappenwahl sieht keine Segmente");
		for (const linie of linienVon(alt)) {
			const erwartet = (linie.options.pane === "routePane" || linie.options.pane === "routeOutlinePane") ? FAKTOR : null;
			assert.ok(Math.abs(linie.options.opacity - erwartet) < 1e-9, "1: jede Linie ist gedimmt: " + linie.options.opacity);
			assert.strictEqual(linie.options.interactive, false, "1: und nimmt keine Klicks");
			assert.strictEqual(linie.element.classList.contains("leaflet-interactive"), false, "1: auch nicht im SVG");
			assert.strictEqual(linie.handler.click, undefined, "1: ihr Klick waehlte eine Etappe aus einem Plan, den es nicht mehr gibt");
		}
		await beantworte(gefunden("neu"));
		await lauf;
		assert.ok(!aufKarte.has(alt), "1: die neue Route ersetzt die vorige");
		assert.strictEqual(global.staleRouteLayer, null, "1: keine veraltete Linie mehr");
		assert.ok(global.currentRouteLayer && aufKarte.has(global.currentRouteLayer), "1: die neue liegt auf der Karte");
		assert.notStrictEqual(global.currentRouteLayer, alt);
	}

	// ---- 2. Eine Querfeldein-Etappe tritt im selben Verhaeltnis zurueck ----------------------------------
	{
		zweiWegpunkte();
		const lauf0 = updateMapViewServerPrimary();
		await beantworte(antwort({ found: true, segments: [etappe("q", "Gareth", "Perricum", { synthetic: true, subtype: "Querfeldein" })], duration: { travel_days: 1 }, closures: [] }));
		await lauf0;
		const alt = global.currentRouteLayer;
		const vorher = linienVon(alt).map((linie) => linie.options.opacity);
		const lauf = updateMapViewServerPrimary();
		linienVon(alt).forEach((linie, i) => {
			assert.ok(Math.abs(linie.options.opacity - vorher[i] * FAKTOR) < 1e-9, "2: Faktor auf die EIGENE Deckkraft: " + vorher[i] + " -> " + linie.options.opacity);
		});
		await beantworte(gefunden("neu2"));
		await lauf;
	}

	// ---- 3. Jeder Ausgang ohne neue Route raeumt die veraltete Linie ab ----------------------------------
	const ausgaenge = [
		["Serverfehler", new Error("HTTP 503")],
		["keine Route", antwort({ found: false, segments: [], duration: {}, closures: [] })],
		["Sperre", antwort({ found: false, segments: [], duration: {}, closures: [{ leg_index: 0, blocked: true, avoided: [] }] })],
		["Route ohne Segmente", antwort({ found: true, segments: [], duration: {}, closures: [] })],
	];
	for (const [name, wert] of ausgaenge) {
		const alt = await zeichneErsteRoute();
		const lauf = updateMapViewServerPrimary();
		assert.ok(aufKarte.has(alt), `3 (${name}): waehrend der Berechnung steht die vorige Linie`);
		await beantworte(wert);
		await lauf;
		assert.ok(!aufKarte.has(alt), `3 (${name}): danach ist sie weg`);
		assert.strictEqual(global.staleRouteLayer, null, `3 (${name}): und keine veraltete Linie bleibt zurueck`);
	}

	// ---- 4. Weniger als zwei Wegpunkte: keine Berechnung, die Linie geht --------------------------------
	{
		const alt = await zeichneErsteRoute();
		global.selectedLocations = [{ name: "Gareth" }];
		await updateMapViewServerPrimary();
		assert.strictEqual(offeneAnfragen.length, 0, "4: es wird nichts gefragt");
		assert.ok(!aufKarte.has(alt), "4: die vorige Route ist weg");
		assert.strictEqual(global.staleRouteLayer, null);
	}

	// ---- 5. UEBERHOLT: die aeltere Berechnung raeumt die Linie NICHT ab, die neuere uebernimmt sie -------
	{
		const alt = await zeichneErsteRoute();
		const lauf1 = updateMapViewServerPrimary();
		const lauf2 = updateMapViewServerPrimary();
		assert.strictEqual(offeneAnfragen.length, 2, "5: zwei Berechnungen laufen");
		await beantworte(new Error("HTTP 503")); // die aeltere scheitert
		await lauf1;
		assert.ok(aufKarte.has(alt), "5: die ueberholte Berechnung laesst die vorige Linie stehen");
		assert.strictEqual(global.staleRouteLayer, alt, "5: sie gehoert jetzt der neueren");
		await beantworte(gefunden("neuer"));
		await lauf2;
		assert.ok(!aufKarte.has(alt), "5: die neuere ersetzt sie");
		assert.strictEqual(global.staleRouteLayer, null);
	}

	// ---- 6. Ohne keepRouteLine raeumt das Zuruecksetzen wie bisher ALLES ab ------------------------------
	{
		const alt = await zeichneErsteRoute();
		const lauf = updateMapViewServerPrimary();
		assert.strictEqual(global.staleRouteLayer, alt);
		resetRoutePresentation(); // z. B. der Client-Weg (?clientrouting=1)
		assert.ok(!aufKarte.has(alt), "6: das gewoehnliche Zuruecksetzen nimmt auch die veraltete Linie mit");
		assert.strictEqual(global.staleRouteLayer, null);
		await beantworte(gefunden("danach"));
		await lauf;
	}

	// ---- 7. Eine noch aeltere veraltete Linie bleibt nie verwaist auf der Karte liegen -----------------
	//    Ueber den Planer ist der Fall heute nicht erreichbar (drawRoute raeumt vorher ab) -- der Riegel
	//    steht trotzdem, und eine vergessene Linie waere eine, die niemand mehr entfernen kann.
	{
		global.currentRouteLayer = null;
		global.staleRouteLayer = null;
		const erste = new Gruppe().addLayer(new Linie([], { pane: "routePane", opacity: 1 })).addTo(map);
		global.currentRouteLayer = erste;
		retireCurrentRouteLineAsStale();
		const zweite = new Gruppe().addLayer(new Linie([], { pane: "routePane", opacity: 1 })).addTo(map);
		global.currentRouteLayer = zweite;
		retireCurrentRouteLineAsStale();
		assert.ok(!aufKarte.has(erste), "7: die aeltere veraltete Linie geht, statt verwaist liegen zu bleiben");
		assert.strictEqual(global.staleRouteLayer, zweite, "7: die juengere ist jetzt die veraltete");
		removeStaleRouteLine();
		assert.ok(!aufKarte.has(zweite));
	}

	echtesLog("alte-route-bleibt-stehen.test.js: all assertions passed");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});

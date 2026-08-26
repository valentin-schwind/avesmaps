// Der geparste Zwischenspeicher der politischen Ebene -- und die Frage, wer ihn leert.
//
// 💣 DER GROESSTE EINZELPOSTEN BEIM ZOOMEN. Bis 26.08.2026 wurde die Ebene bei JEDEM Zoomschritt neu
// geholt (der Zoom ist ein Anfrageparameter, der Client erzwang no-store plus Cachebrecher) und die
// ~3-4-MB-Antwort neu durch den fetch-Abfangjaeger geschickt. Live gemessen: 280-330 ms je
// Zoomschritt in der Standardansicht, rund 1 s in der politischen.
//
// 💣 UND ES SIND ZWEI SPEICHER MIT ZWEI INVALIDIERUNGSWEGEN. Der api-client haelt die laufende
// Zusage (5 s), der Loader das fertige Ergebnis. Geleert wird aus dem Loader
// (schedulePoliticalTerritoryLayerReload mit immediate) UND aus dem api-client (nach einem
// Schreibvorgang, js/app/api-client.js). Eine Regel, die einen von zwei Erzeugern bindet, ist keine
// Regel -- daran sind in diesem Projekt schon die Verkehrsmittel-Sperre und die Ausstiegsregel
// gescheitert. Dieser Test faehrt BEIDE Wege.
//
// ⭐ Und er fuehrt loadPoliticalTerritoryLayer wirklich AUS, statt ihren Quelltext zu lesen: nur ein
// Ablauf beantwortet "wird beim zweiten Zoom auf dieselbe Stufe wirklich nicht mehr geholt".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ebenen-zwischenspeicher.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const loader = lies("js/map-features/map-features-political-territory-loader.js");
const apiClient = lies("js/app/api-client.js");

// --- Umgebung: alles, was loadPoliticalTerritoryLayer anfasst ------------------------------------
let zoom = 3;
let geholt = [];
global.window = { AvesmapsBoundaryCanvasOverlay: null, AvesmapsContestedHatchOverlay: null };
global.map = { getZoom: () => zoom };
global.POLITICAL_TERRITORIES_API_URL = "api/app/political-territories.php";
global.POLITICAL_TERRITORY_LAYER_PARSED_CACHE_TTL_MS = 300000;
global.politicalTimelineYear = 1049;
global.IS_EDIT_MODE = false;
global.isPoliticalTerritoryLayerLoading = false;
global.politicalTerritoryApiUnavailable = false;
global.politicalTerritoryLayerLoadedZoom = null;
global.politicalTerritoryLayerReloadPending = null;
global.activeRegionGeometryEdit = null;
global.pendingRegionOperation = null;
global.pendingRegionMoveState = null;
global.regionData = [];
global.POLITICAL_LAYER_CACHE = new Map();
global.fetchPoliticalTerritories = async (params) => {
	geholt.push(params.zoom + "|" + params.year_bf + "|" + params.edit_mode);
	// Jede Antwort ein EIGENES Objekt -- sonst koennte der Test eine Gleichheit messen, die nur
	// daher kommt, dass die Attrappe immer dasselbe zurueckgibt.
	return { ok: true, features: [{ id: "z" + params.zoom, properties: {} }] };
};
global.refreshPoliticalTerritoryStyleCache = async () => ({});
global.clearPoliticalTerritoryTimelineSelection = () => {};
global.snapshotRegionLabelsForReuse = () => {};
global.clearRenderedRegionLayers = () => {};
global.discardUnusedReusableRegionLabels = () => {};
global.applyPoliticalTerritoryCachedStyle = () => {};
global.applyPoliticalTerritoryPendingStyleOverrides = () => {};
global.applyPoliticalTerritoryDerivedBoundaryVisibility = () => {};
global.normalizeRegionFeature = (f) => f;
global.addRegionFeatureToMap = () => {};
global.syncRegionVisibility = () => {};
global.scheduleLabelCollisionResolution = () => {};
global.schedulePoliticalTerritoryLayerReload = () => {};

// --- Die ECHTEN Bauteile, aus den echten Dateien geschnitten -------------------------------------
vm.runInThisContext(schnitt(loader, "const politicalTerritoryLayerParsedCache", "}"));
vm.runInThisContext(schnitt(loader, "function invalidatePoliticalTerritoryLayerParsedCache", "}"));
vm.runInThisContext(
	schnitt(loader, "function invalidatePoliticalTerritoryLayerFetchCache", "}")
		// Der Fan-out-Speicher gehoert nicht zu dieser Frage; nur seine eine Zeile wird ersetzt.
		.replace("politicalTerritoryLayerFetchCache.clear();", "void 0;")
);
vm.runInThisContext(schnitt(loader, "async function loadPoliticalTerritoryLayer", "}"));
vm.runInThisContext(schnitt(apiClient, "function avesmapsPoliticalLayerBrowserCacheable", "}"));
vm.runInThisContext(schnitt(apiClient, "function invalidatePoliticalLayerCache", "}"));

(async () => {
	// --- 1) Dieselbe Zoomstufe wird nur EINMAL geholt --------------------------------------------
	geholt = [];
	await loadPoliticalTerritoryLayer();           // z3, kalt
	zoom = 4; await loadPoliticalTerritoryLayer(); // z4, kalt
	zoom = 3; await loadPoliticalTerritoryLayer(); // z3, muss aus dem Speicher kommen
	zoom = 4; await loadPoliticalTerritoryLayer(); // z4, ebenso
	assert.deepStrictEqual(geholt, ["3|1049|0", "4|1049|0"],
		"jede Zoomstufe genau einmal geholt -- das ist der ganze Zweck");

	// --- 2) Das Jahr gehoert in den Schluessel ----------------------------------------------------
	// Ohne das zeigte die Zeitleiste nach einem Jahressprung die Gebiete des alten Jahres.
	geholt = [];
	zoom = 3;
	global.politicalTimelineYear = 1000;
	await loadPoliticalTerritoryLayer();
	assert.deepStrictEqual(geholt, ["3|1000|0"], "anderes Jahr -> eigener Eintrag");
	global.politicalTimelineYear = 1049;

	// --- 3) Der Loader-Weg leert ------------------------------------------------------------------
	geholt = [];
	invalidatePoliticalTerritoryLayerFetchCache();
	zoom = 3;
	await loadPoliticalTerritoryLayer();
	assert.deepStrictEqual(geholt, ["3|1049|0"], "nach dem Loader-Invalidator wird neu geholt");

	// --- 4) UND der api-client-Weg leert (der zweite Erzeuger) -----------------------------------
	// 💣 Genau diese Haelfte fehlt, wenn jemand nur den Loader anfasst: js/app/api-client.js leert
	// nach einem Schreibvorgang und kaeme sonst nie an das fertige Ergebnis heran.
	geholt = [];
	zoom = 3;
	await loadPoliticalTerritoryLayer();
	assert.deepStrictEqual(geholt, [], "Vorbedingung: z3 liegt im Speicher");
	invalidatePoliticalLayerCache();
	await loadPoliticalTerritoryLayer();
	assert.deepStrictEqual(geholt, ["3|1049|0"],
		"invalidatePoliticalLayerCache (api-client) leert den geparsten Speicher MIT");

	// --- 5) Im Bearbeiten-Modus wird NICHT zwischengespeichert -------------------------------------
	// Ein Editor, der seine eigene Aenderung minutenlang nicht sieht, ist schlimmer als ein
	// langsamer Zoom.
	invalidatePoliticalTerritoryLayerFetchCache();
	global.IS_EDIT_MODE = true;
	geholt = [];
	zoom = 3;
	await loadPoliticalTerritoryLayer();
	await loadPoliticalTerritoryLayer();
	assert.deepStrictEqual(geholt, ["3|1049|1", "3|1049|1"], "im Editor holt jeder Lauf frisch");
	global.IS_EDIT_MODE = false;

	// --- 6) Der Browser-Riegel: nur die Ansichts-Ebene ist zwischenspeicherbar ---------------------
	assert.strictEqual(avesmapsPoliticalLayerBrowserCacheable({ action: "layer", edit_mode: 0 }), true,
		"Ansicht + layer -> der Browser darf behalten");
	assert.strictEqual(avesmapsPoliticalLayerBrowserCacheable({ action: "list" }), false,
		"andere Aktionen senden gar keine Cache-Kopfzeilen -> nie behalten");
	assert.strictEqual(avesmapsPoliticalLayerBrowserCacheable({ action: "layer", edit_mode: 1 }), false,
		"edit_mode=1 in den Parametern schliesst aus");
	global.IS_EDIT_MODE = true;
	assert.strictEqual(avesmapsPoliticalLayerBrowserCacheable({ action: "layer", edit_mode: 0 }), false,
		"Bearbeiten-Modus schliesst aus");
	delete global.IS_EDIT_MODE;
	assert.strictEqual(avesmapsPoliticalLayerBrowserCacheable({ action: "layer", edit_mode: 0 }), false,
		"🔴 IM ZWEIFEL NEIN: ohne definiertes IS_EDIT_MODE gilt Bearbeiten");
	global.IS_EDIT_MODE = false;

	console.log("OK: geparster Ebenen-Zwischenspeicher -- Schluessel, beide Invalidierungswege, Editor-Ausnahme, Browser-Riegel.");
})().catch((fehler) => { console.error(fehler); process.exit(1); });

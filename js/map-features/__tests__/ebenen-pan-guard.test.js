// Ein Pan bei gleichem Zoom, Jahr und Bearbeiten-Modus holt die politische Ebene NICHT neu -- in
// ALLEN Ansichten, auch in "political".
//
// 💣 Gemessen 03.09.2026 im Editor, politische Ansicht: EIN Pan = 8 Anfragen, ~6,5 MB (Ebene, sechs
// Nachbarzooms, Stilliste). In der Standardansicht derselbe Pan: 0 Anfragen. Der Unterschied war
// eine einzige Bedingung (`mapLayerMode !== "political"`) im Guard.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ebenen-pan-guard.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const loader = lies("js/map-features/map-features-political-territory-loader.js");
const config = lies("js/config.js");

// --- Umgebung -----------------------------------------------------------------------------------
let zoom = 4;
let modus = "political";
let geladen = 0;
global.window = { setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {} };
global.map = { getZoom: () => zoom };
global.POLITICAL_TERRITORIES_API_URL = "api/app/political-territories.php";
global.politicalTerritoryApiUnavailable = false;
global.politicalTimelineYear = 1049;
global.IS_EDIT_MODE = true;
global.getSelectedMapLayerMode = () => modus;
global.TERRITORY_BOUNDARY_MODES = ["political", "deregraphic", "ecosystem"];
global.isPoliticalTerritoryLayerLoading = false;
global.politicalTerritoryLayerReloadPending = null;
global.politicalTerritoryLayerReloadTimerId = null;
global.activeRegionGeometryEdit = null;
global.pendingRegionOperation = null;
global.pendingRegionMoveState = null;
global.regionData = [{ properties: {} }];
global.hasLoadedDerivedRegionData = () => true;
global.invalidatePoliticalTerritoryLayerFetchCache = () => {};
global.invalidatePoliticalLayerCache = () => {};
global.loadPoliticalTerritoryLayer = async () => { geladen += 1; };

// --- Die ECHTEN Bauteile ------------------------------------------------------------------------
vm.runInThisContext(schnitt(loader, "let politicalTerritoryLayerLoadedZoom", ""));
vm.runInThisContext(schnitt(loader, "let politicalTerritoryLayerLoadedKey", ""));
vm.runInThisContext(schnitt(loader, "function buildPoliticalTerritoryLayerParsedCacheKey", "}"));
vm.runInThisContext(schnitt(loader, "function avesmapsPoliticalLayerAktuellerSchluessel", "}"));
vm.runInThisContext(schnitt(loader, "function schedulePoliticalTerritoryLayerReload", "}"));

// 1) Noch nie geladen -> laden.
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 1, "erster Aufruf laedt");

// 2) Als geladen markieren (so wie loadPoliticalTerritoryLayer es tut) -> ein Pan laedt NICHT.
politicalTerritoryLayerLoadedZoom = 4;
politicalTerritoryLayerLoadedKey = buildPoliticalTerritoryLayerParsedCacheKey(4, 1049, 1);
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 1, "political, gleicher Schluessel, Daten da -> kein Reload beim Pan");

// 3) Zoomwechsel laedt.
zoom = 5;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 2, "anderer Zoom -> Reload");
zoom = 4;

// 4) Jahreswechsel (Zeitleiste) laedt.
global.politicalTimelineYear = 1000;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 3, "anderes Jahr -> Reload");
global.politicalTimelineYear = 1049;

// 5) immediate (Speichern) laedt IMMER.
schedulePoliticalTerritoryLayerReload({ immediate: true });
assert.strictEqual(geladen, 4, "immediate -> Reload");

// 6) Ohne Daten (z. B. nach clearRenderedRegionLayers) laedt der Pan wieder.
global.regionData = [];
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 5, "political ohne regionData -> Reload");
global.regionData = [{ properties: {} }];

// 7) Standardansicht: derselbe Guard, ueber die Derived-Daten.
modus = "deregraphic";
global.hasLoadedDerivedRegionData = () => false;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 6, "deregraphic ohne Derived-Daten -> Reload");
global.hasLoadedDerivedRegionData = () => true;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 6, "deregraphic mit Derived-Daten, gleicher Schluessel -> kein Reload");

// 8) Die Fristen: Fan-out 300 s, Stilliste 30 s -- beide standen auf 60 s bzw. 1 s.
assert.ok(/const POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS = 300000;/.test(config),
	"Fan-out-Frist 300 s (js/config.js) -- 60 s hiess sechs Volltransfers je Minute in der politischen Ansicht");
assert.ok(/const POLITICAL_TERRITORY_STYLE_CACHE_TTL_MS = 30000;/.test(loader),
	"Stilliste 30 s -- 1 s hiess ein Fuenf-Tabellen-Join je Pan");

// 9) loadPoliticalTerritoryLayer setzt den Schluessel neben dem Zoom.
const laden = schnitt(loader, "async function loadPoliticalTerritoryLayer", "}");
assert.ok(laden.includes("politicalTerritoryLayerLoadedZoom = requestedZoom;"), "Zoom wird gesetzt");
assert.ok(laden.includes("politicalTerritoryLayerLoadedKey = parsedCacheKey;"), "und der Schluessel direkt daneben");

console.log("OK ebenen-pan-guard (9 Abschnitte)");

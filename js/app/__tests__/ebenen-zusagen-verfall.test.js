// POLITICAL_LAYER_CACHE haelt keine abgelaufenen Zusagen mehr. Bis 03.09.2026 wurde nie ein Eintrag
// geloescht, nur nach einer Speicherung alles geleert -- im Editor je Zoom x Jahr eine geparste Ebene
// mit 4-5 MB JSON, mit der Zeitleiste ohne Grenze.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/ebenen-zusagen-verfall.test.js
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

const apiClient = lies("js/app/api-client.js");

global.window = { location: { href: "https://avesmaps.de/" } };
global.IS_EDIT_MODE = true;
global.POLITICAL_TERRITORIES_API_URL = "api/app/political-territories.php";
global.fetchWithRetry = async () => ({ ok: true, status: 200 });
global.readJsonResponse = async () => ({ ok: true, features: [] });
global.apiErrorMessage = (d, f) => f;
let jetzt = 0;
const echtesNow = Date.now;
Date.now = () => jetzt;

vm.runInThisContext(schnitt(apiClient, "const POLITICAL_LAYER_CACHE", ""));
vm.runInThisContext(schnitt(apiClient, "const POLITICAL_LAYER_CACHE_TTL_MS", ""));
vm.runInThisContext(schnitt(apiClient, "function buildPoliticalTerritoriesParamKey", "}"));
vm.runInThisContext(schnitt(apiClient, "function avesmapsPoliticalLayerBrowserCacheable", "}"));
vm.runInThisContext(schnitt(apiClient, "async function fetchPoliticalTerritories", "}"));

(async () => {
	await fetchPoliticalTerritories({ action: "layer", zoom: 3, year_bf: 1049, edit_mode: 1 });
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 1, "erste Zusage liegt");

	jetzt = 1000;
	await fetchPoliticalTerritories({ action: "layer", zoom: 4, year_bf: 1049, edit_mode: 1 });
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 2, "innerhalb der Frist bleibt die erste liegen");

	jetzt = 7000;
	await fetchPoliticalTerritories({ action: "layer", zoom: 5, year_bf: 1049, edit_mode: 1 });
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 1, "beim Setzen fliegen alle abgelaufenen (>5 s) hinaus");
	assert.ok([...POLITICAL_LAYER_CACHE.keys()][0].includes("zoom=5"), "nur die frische bleibt");

	// Die Zeitleiste: zehn Jahre nacheinander -> hoechstens die Eintraege der letzten 5 s.
	for (let jahr = 1000; jahr < 1010; jahr += 1) {
		jetzt += 6000;
		await fetchPoliticalTerritories({ action: "layer", zoom: 5, year_bf: jahr, edit_mode: 1 });
	}
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 1, "zehn Jahre spaeter liegt genau eine Zusage");

	Date.now = echtesNow;
	console.log("OK ebenen-zusagen-verfall");
})().catch((error) => { Date.now = echtesNow; console.error(error); process.exit(1); });

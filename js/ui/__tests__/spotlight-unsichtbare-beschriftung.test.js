// Unsichtbare Beschriftungen in der Kartensuche -- Frontend gegen Editormodus.
//
// 🔴 Owner 14.09.2026 (Variante B): eine UNSICHTBARE Beschriftung einer Landschaft („See-318",
// „Regionname anzeigen" aus) ist im FRONTEND kein eigener Treffer -- die Landschaft vertritt sie. Im
// EDITORMODUS bleibt sie einer: die Editoren muessen „See-318" wiederfinden.
//
// Die Fallliste teilt sich dieser Test mit dem Server (api/app/__tests__/map-search-verdrahtung-test.php):
// api/_internal/app/__tests__/fixtures/unsichtbare-beschriftungen.json.
//
// 💣 Gefahren wird die echte Suche (searchSpotlightEntries), nicht der Filter allein -- und die ANFRAGEN aller
// Aufrufer des Endpunkts: fehlt einem der Modus, antwortet der Server im Editor wie im Frontend, und das
// saehe von aussen genau so aus wie „die Suche findet See-318 nicht mehr".
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/spotlight-unsichtbare-beschriftung.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

const { faelle } = JSON.parse(lies("api/_internal/app/__tests__/fixtures/unsichtbare-beschriftungen.json"));

function labelMarkerAusFall(fall) {
	return {
		label: {
			publicId: fall.public_id,
			text: fall.text,
			labelType: fall.subtype,
			coordinates: [100, 200],
			// So liest normalizeLabelFeature (js/map-features/map-features-labels.js) das Feld: nur ein
			// ausdrueckliches false verbirgt, ein fehlendes Feld heisst „anzeigen".
			showName: fall.show_name !== false,
			// Die Kartennutzlast loest BEIDE Richtungen auf (avesmapsEcosystemApplyLabelRegionsToFeatures): der
			// Browser sieht den Zeiger, egal auf welcher Seite er gespeichert ist.
			ecosystemRegionPublicId: fall.bindung ? fall.region.public_id : "",
		},
	};
}

// `editMode` undefined = die Konstante fehlt ganz.
function createContext(editMode) {
	const log = { fetches: [] };
	const element = (id) => ({
		id,
		hidden: true,
		isConnected: true,
		value: "",
		innerHTML: "",
		textContent: "",
		addEventListener() {},
		setAttribute() {},
		removeAttribute() {},
		querySelectorAll: () => [],
		closest: () => null,
	});
	const elements = {};
	["spotlight-search-overlay", "spotlight-search-dialog", "spotlight-search-input", "spotlight-search-results", "spotlight-search-status"]
		.forEach((id) => { elements[id] = element(id); });

	const context = { console, Promise, Map, Set, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, URL, AbortController };
	context.window = context;
	context.globalThis = context;
	context.location = { href: "https://avesmaps.de/" };
	context.Element = function Element() {};
	context.document = {
		getElementById: (id) => elements[id] || null,
		addEventListener() {},
		querySelectorAll: () => [],
		querySelector: () => null,
	};
	context.L = { latLngBounds: () => ({ isValid: () => true, pad() { return this; } }), latLng: (value) => value };
	context.map = { on() {}, off() {}, getMaxZoom: () => 7 };
	context.locationMarkers = [];
	context.labelMarkers = faelle.map(labelMarkerAusFall);
	context.regionPolygons = [];
	context.pathData = [];
	context.powerlineData = [];
	context.labelData = [];
	context.VISUAL_MAX_ZOOM_LEVEL = 5;
	context.tr = (key, fallback) => fallback;
	// Wohnt in spotlight-search-focus.js; die Deeplinks brechen ohne sie VOR dem Abruf ab. Geprueft wird hier nur
	// die Adresse, nicht der Flug.
	context.selectSpotlightSearchEntry = () => {};
	context.MAP_SEARCH_API_URL = "api/app/map-search.php";
	context.fetch = async (url) => {
		log.fetches.push(String(url));
		return { ok: true, json: async () => ({ ok: true, results: [] }) };
	};
	if (editMode !== undefined) {
		context.IS_EDIT_MODE = editMode;
	}

	vm.createContext(context);
	// Die echte Artbezeichnung der Beschriftungen -- in der App vor der Suche geladen.
	vm.runInContext(lies("js/ui/label-arten.js"), context);
	vm.runInContext(lies("js/ui/spotlight-search.js"), context);
	vm.runInContext(lies("js/app/wiki-deeplink.js"), context);
	return { context, log };
}

function labelGefunden(context, fall) {
	return context.searchSpotlightEntries(fall.text)
		.some((entry) => entry.kind === "label" && [...(entry.publicIds || [])].includes(fall.public_id));
}

async function warteAufNetz() {
	for (let i = 0; i < 8; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

async function main() {
	let checks = 0;

	// ── 0. Die Liste kann den Unterschied ueberhaupt zeigen ───────────────────────────────────────────
	assert.ok(faelle.some((fall) => !fall.beschriftung_im_frontend && fall.beschriftung_im_editor),
		"die Liste braucht eine Beschriftung, die NUR im Editor gefunden wird -- sonst prueft der Modus nichts"); checks++;
	assert.ok(faelle.some((fall) => fall.beschriftung_im_frontend && fall.show_name === false),
		"…und eine unsichtbare, die trotzdem bleibt (frei) -- sonst verbirgt ein Filter, der ALLE Unsichtbaren nimmt, gruen"); checks++;
	assert.ok(faelle.some((fall) => fall.beschriftung_im_frontend && fall.bindung !== null),
		"…und eine gebundene, die bleibt -- sonst verbirgt ein Filter, der ALLE Gebundenen nimmt, gruen"); checks++;

	// ── A. Frontend: die Landschaft vertritt ihre unsichtbare Beschriftung ────────────────────────────
	{
		const { context } = createContext(false);
		for (const fall of faelle) {
			assert.strictEqual(labelGefunden(context, fall), fall.beschriftung_im_frontend,
				`Frontend, "${fall.text}" (show_name ${fall.show_name}, Bindung ${fall.bindung})`); checks++;
		}
	}

	// ── B. Editormodus: jede Beschriftung bleibt auffindbar ───────────────────────────────────────────
	{
		const { context } = createContext(true);
		for (const fall of faelle) {
			assert.strictEqual(labelGefunden(context, fall), fall.beschriftung_im_editor,
				`Editor, "${fall.text}" -- die Editoren muessen See-318 wiederfinden`); checks++;
		}
	}

	// ── C. Fehlt die Konstante, gilt das Frontend (lieber verstecken) ─────────────────────────────────
	{
		const { context } = createContext(undefined);
		for (const fall of faelle) {
			assert.strictEqual(labelGefunden(context, fall), fall.beschriftung_im_frontend,
				`ohne IS_EDIT_MODE, "${fall.text}"`); checks++;
		}
	}

	// ── D. Die Serversuche erfaehrt den Modus ─────────────────────────────────────────────────────────
	for (const [editMode, erwartet] of [[false, null], [true, "1"]]) {
		const { context, log } = createContext(editMode);
		await context.fetchBackendSpotlightResults("See-318");
		assert.strictEqual(log.fetches.length, 1); checks++;
		assert.strictEqual(new URL(log.fetches[0]).searchParams.get("edit_mode"), erwartet,
			`💣 Spotlight, Editormodus ${editMode}: ${log.fetches[0]}`); checks++;
	}

	// ── E. …auch ueber die zwei Deeplink-Aufrufer derselben Suche ─────────────────────────────────────
	for (const [editMode, erwartet] of [[false, null], [true, "1"]]) {
		const { context, log } = createContext(editMode);
		context.avesmapsFocusPoliticalTerritory("Weiden");
		context.resolveWikiDeeplinkViaMapSearch({ pageName: "Oase_Tarfui", kinds: ["label"] });
		await warteAufNetz();
		assert.strictEqual(log.fetches.length, 2, "beide Deeplink-Aufrufer fragen die Suche: " + log.fetches.join(" | ")); checks++;
		for (const adresse of log.fetches) {
			assert.strictEqual(new URL(adresse).searchParams.get("edit_mode"), erwartet,
				`💣 Deeplink, Editormodus ${editMode}: ${adresse}`); checks++;
		}
	}

	// ── F. Die Ortsvorschlaege der Editorseiten sind Editormodus ──────────────────────────────────────
	// Kartensammlung und Literatur weisen ueber die Suche EXAKTE Ziele zu (kind "label" -> target_kind
	// "region"). Ohne den Modus bekaemen sie fuer „Oase Tarfui" die Landschaft statt der Beschriftung.
	{
		let gezaehlt = 0;
		for (const seite of ["html/citymap-editor.html", "html/game-literature-editor.html"]) {
			const abrufe = lies(seite).match(/fetch\(\s*"\/api\/app\/map-search\.php\?[^"]*"/g) || [];
			assert.ok(abrufe.length > 0, `${seite} fragt die Suche nicht mehr -- Test anpassen, nicht loeschen`); checks++;
			for (const abruf of abrufe) {
				assert.ok(/[?&]edit_mode=1(&|")/.test(abruf), `💣 ${seite}: ${abruf}`); checks++;
				gezaehlt++;
			}
		}
		assert.strictEqual(gezaehlt, 3, "drei Ortsvorschlags-Abrufe auf zwei Editorseiten (14.09.2026)"); checks++;
	}

	console.log(`spotlight-unsichtbare-beschriftung: ${checks} Pruefungen OK`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

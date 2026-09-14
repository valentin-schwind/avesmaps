// Landschaften ohne eigene Beschriftung als Suchtreffer -- der ABLAUF im Browser.
// Entwurf: docs/superpowers/specs/2026-08-28-landschaften-in-der-suche-design.md §6
//
// 🔴 Gefahren wird der echte Weg, den ein Serverergebnis nimmt: resolveBackendSpotlightEntries ->
// selectSpotlightSearchEntry -> Ansicht, Ebene, Flug, Infopanel, Umrisse. Kein Bauer wird allein
// geprueft, weil genau die Naht die Falle ist:
// 💣 resolveBackendSpotlightEntries VERWIRFT STILL, was es nicht kennt, und selectSpotlightSearchEntry
// tut STILL nichts bei einer Art ohne Zweig. Ein Server, der „landscape" liefert, saehe im Endpunkt
// richtig aus und erschiene nie im Fenster -- oder erschiene und taete beim Klick nichts.
//
// Geladen werden die DREI echten Dateien (Suche, Fokus, Flaechen-Rendering): die Zeile benutzt die
// Untertitel-Regel des Flaechen-Panels, und das Panel oeffnet der echte showEcosystemAreaInfopanel.
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

const MISTEL = {
	kind: "landscape",
	public_id: "r-mistel",
	public_ids: ["r-mistel"],
	name: "Mistelwald",
	type_label: "Wald",
	feature_subtype: "wald",
	ecosystem_kind: "vegetation",
	min_x: 30, min_y: 40, max_x: 35, max_y: 45,
};
const PERLEN = {
	kind: "landscape",
	public_id: "r-perlen-1",
	public_ids: ["r-perlen-1", "r-perlen-2"],
	name: "Archipel der Perlen",
	type_label: "Insel",
	feature_subtype: "insel",
	ecosystem_kind: "topographie",
	min_x: 965, min_y: 584, max_x: 974, max_y: 590,
};
const FINSTER = {
	kind: "landscape",
	public_id: "r-finster",
	public_ids: ["r-finster"],
	name: "Finsterkamm",
	type_label: "",
	feature_subtype: "",
	ecosystem_kind: "derographisch",
	min_x: 90, min_y: 90, max_x: 99, max_y: 99,
};
// 🪤 ECHTE Ringe mit mindestens drei Punkten: gezeichnet wird mit dem echten ecosystemAreaLatLngs aus
// map-features-ecosystem-rendering.js, und der verwirft einen leeren oder zu kurzen Ring (NaN-Riegel).
// Mit Platzhalter-Geometrie blieb die Hervorhebung leer, und das sah aus wie ein Fehler im Treffer.
const ring = (minX, minY, maxX, maxY) => ({
	type: "Polygon",
	coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
});
const FLAECHEN = [
	{ region_public_id: "r-mistel", geometry: ring(30, 40, 32, 42), bounds: { min_x: 30, min_y: 40, max_x: 32, max_y: 42 } },
	{ region_public_id: "r-mistel", geometry: ring(33, 43, 35, 45), bounds: { min_x: 33, min_y: 43, max_x: 35, max_y: 45 } },
	{ region_public_id: "r-perlen-1", geometry: ring(965, 584, 969, 587), bounds: { min_x: 965, min_y: 584, max_x: 969, max_y: 587 } },
	{ region_public_id: "r-perlen-2", geometry: ring(972, 585, 974, 588), bounds: { min_x: 972, min_y: 585, max_x: 974, max_y: 588 } },
];

function createContext({ showAll = false, activeKind = "topographie" } = {}) {
	const log = { modes: [], kinds: [], flights: [], panels: [], fetches: [], polygons: [] };
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

	const context = { console, Promise, Map, Set, setTimeout, clearTimeout, encodeURIComponent };
	context.window = context;
	context.globalThis = context;
	context.Element = function Element() {};
	context.document = {
		getElementById: (id) => elements[id] || null,
		addEventListener() {},
		querySelectorAll: () => [],
		querySelector: () => null,
	};
	const bounds = (corners) => ({ corners, isValid: () => true, pad() { return this; } });
	context.L = {
		latLngBounds: (a, b) => bounds(b === undefined ? a : [a, b]),
		latLng: (value) => value,
		layerGroup: () => {
			const layers = [];
			return { layers, getLayers: () => layers, addTo() { return this; }, eachLayer: (fn) => layers.forEach(fn) };
		},
		polygon: (latlngs, options) => ({
			latlngs,
			options,
			addTo(group) { group.layers.push(this); log.polygons.push(this); return this; },
		}),
	};
	context.map = {
		on() {},
		off() {},
		removeLayer() {},
		getMaxZoom: () => 7,
		flyToBounds: (target, options) => log.flights.push({ target, options }),
		flyTo() {},
		dragging: { moved: () => false },
	};
	// Der lokale Suchbestand ist leer: eine Landschaft hat NIE einen lokalen Eintrag.
	context.locationMarkers = [];
	context.labelMarkers = [];
	context.regionPolygons = [];
	context.pathData = [];
	context.powerlineData = [];
	context.VISUAL_MAX_ZOOM_LEVEL = 5;
	// Die Kartengroesse -- die Hervorhebung fragt sie, um einen kontinentgrossen Umriss ungefuellt zu lassen.
	context.IMG_WIDTH = 1024;
	context.IMG_HEIGHT = 1024;
	context.IS_INFOPANEL_MODE = true;
	context.labelData = [];
	context.syncModalDialogBodyState = () => {};
	context.setSelectedMapLayerMode = (mode) => log.modes.push(mode);
	context.isEcosystemShowAllLayers = () => showAll;
	context.getActiveEcosystemLayerKind = () => activeKind;
	context.setActiveEcosystemLayerKind = (kind) => log.kinds.push(kind);
	context.ECOSYSTEM_AREAS_API_URL = "/api/app/ecosystem-areas.php";
	context.fetch = async (url) => {
		log.fetches.push(String(url));
		return { ok: true, json: async () => ({ ok: true, areas: FLAECHEN }) };
	};
	// Das Panel selbst: unterscheidbar, damit geprueft wird, WAS gebaut wurde.
	context.escapeHtml = (value) => String(value);
	context.locationPopupMarkup = (spec) => `<area-panel>${spec.name}|${spec.locationTypeLabel}</area-panel>`;
	context.infoHeaderImageMarkup = () => "";
	context.regionHeaderImageBasename = () => "";
	context.avesmapsShowInfopanel = (markup, activeName) => log.panels.push({ markup, activeName });

	vm.createContext(context);
	// index.html laedt die Namensregel vor rendering.js -- der Untertitel fragt sie.
	vm.runInContext(lies("js/map-features/map-features-ecosystem-naming.js"), context);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-rendering.js"), context);
	vm.runInContext(lies("js/ui/spotlight-search.js"), context);
	vm.runInContext(lies("js/ui/spotlight-search-focus.js"), context);
	return { context, log };
}

async function warteAufNetz() {
	for (let i = 0; i < 8; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

async function main() {
	let checks = 0;

	// ── A. Das Serverergebnis wird ein Eintrag, und die Zeile sagt Art UND Ebene ─────────────────────
	{
		const { context } = createContext();
		const eintraege = context.resolveBackendSpotlightEntries([MISTEL, FINSTER], []);
		assert.strictEqual(eintraege.length, 2,
			"💣 resolveBackendSpotlightEntries hat die Landschaft verworfen -- der Treffer erschiene nie im Fenster"); checks++;
		const [mistel, finster] = eintraege;
		assert.strictEqual(mistel.kind, "landscape"); checks++;
		assert.strictEqual(mistel.name, "Mistelwald"); checks++;
		assert.strictEqual(mistel.typeLabel, "Wald · Vegetation",
			"die Zeile traegt Art und Ebene -- dieselbe Regel wie der Untertitel des Flaechen-Panels"); checks++;
		assert.deepStrictEqual([...mistel.publicIds], ["r-mistel"]); checks++;
		assert.ok(mistel.bounds && mistel.bounds.isValid(), "die bbox des Servers wird eine Leaflet-Huelle"); checks++;
		assert.strictEqual(JSON.stringify(mistel.bounds.corners), JSON.stringify([[40, 30], [45, 35]]),
			"💣 [lat, lng] = [y, x] -- vertauscht fliegt die Karte an die Diagonale gespiegelt"); checks++;
		assert.strictEqual(finster.typeLabel, "Derographie",
			"ohne Art steht die Ebene allein, und nicht zweimal"); checks++;
	}

	// ── B. Der Klick aus einer ANDEREN Einzelebene ────────────────────────────────────────────────────
	{
		const { context, log } = createContext({ showAll: false, activeKind: "topographie" });
		const [eintrag] = context.resolveBackendSpotlightEntries([MISTEL], []);
		context.selectSpotlightSearchEntry(eintrag);
		assert.deepStrictEqual(log.modes, ["ecosystem"], "💣 ohne Zweig in selectSpotlightSearchEntry tut der Klick nichts"); checks++;
		assert.deepStrictEqual(log.kinds, ["vegetation"], "die Ebene des Treffers wird gewaehlt"); checks++;
		assert.strictEqual(log.flights.length, 1, "die Karte fliegt hin"); checks++;
		assert.strictEqual(log.flights[0].target, eintrag.bounds, "…und zwar auf die Huelle des Treffers"); checks++;
		assert.strictEqual(log.flights[0].options.maxZoom, 5, "gedeckelt auf die sichtbare Hoechststufe"); checks++;
		assert.strictEqual(log.panels.length, 1, "das Infopanel geht SOFORT auf, ohne auf das Netz zu warten"); checks++;
		assert.strictEqual(log.panels[0].activeName, "Mistelwald"); checks++;
		assert.strictEqual(log.panels[0].markup, "<area-panel>Mistelwald|Wald</area-panel>",
			"es ist das Flaechen-Panel, gebaut vom echten showEcosystemAreaInfopanel"); checks++;
		assert.strictEqual(log.fetches.length, 1); checks++;
		assert.ok(log.fetches[0].includes("regions=r-mistel"), "die Umrisse kommen ueber den Regionsfilter: " + log.fetches[0]); checks++;
		await warteAufNetz();
		assert.strictEqual(log.polygons.length, 2, "beide Flaechen der Region werden umrandet"); checks++;
		assert.strictEqual(log.polygons[0].options.fill, true, "gefuellt, wie die Hervorhebung der Vorkommen"); checks++;
	}

	// ── C. Aus „Alle" bleibt „Alle" ───────────────────────────────────────────────────────────────────
	{
		const { context, log } = createContext({ showAll: true, activeKind: "topographie" });
		const [eintrag] = context.resolveBackendSpotlightEntries([MISTEL], []);
		context.selectSpotlightSearchEntry(eintrag);
		assert.deepStrictEqual(log.modes, ["ecosystem"]); checks++;
		assert.deepStrictEqual(log.kinds, [], "💣 in „Alle“ ist jede Ebene sichtbar -- ein Wechsel naehme dem Leser die Uebersicht"); checks++;
	}

	// ── D. Dieselbe Ebene: kein Wechsel ──────────────────────────────────────────────────────────────
	{
		const { context, log } = createContext({ showAll: false, activeKind: "vegetation" });
		const [eintrag] = context.resolveBackendSpotlightEntries([MISTEL], []);
		context.selectSpotlightSearchEntry(eintrag);
		assert.deepStrictEqual(log.kinds, [], "steht die Karte schon auf der Ebene, wird nichts umgestellt"); checks++;
	}

	// ── E. Mehrere Regionen in EINEM Treffer ─────────────────────────────────────────────────────────
	{
		const { context, log } = createContext({ showAll: true });
		const [eintrag] = context.resolveBackendSpotlightEntries([PERLEN], []);
		context.selectSpotlightSearchEntry(eintrag);
		assert.ok(log.fetches[0].includes("regions=r-perlen-1%2Cr-perlen-2"), "alle Regionen in einer Anfrage: " + log.fetches[0]); checks++;
		await warteAufNetz();
		assert.strictEqual(log.polygons.length, 2, "jede Insel wird umrandet"); checks++;
	}

	// ── F. Wer inzwischen etwas anderes gewaehlt hat, wird nicht uebermalt ──────────────────────────
	{
		const { context, log } = createContext({ showAll: true });
		const [eintrag] = context.resolveBackendSpotlightEntries([MISTEL], []);
		context.selectSpotlightSearchEntry(eintrag);
		vm.runInContext("spotlightActiveSelectionId = 'path:andere'", context);
		await warteAufNetz();
		assert.strictEqual(log.polygons.length, 0, "💣 eine spaete Antwort zeichnet nicht ueber die neue Auswahl"); checks++;
	}

	// ── G. Das Kanon-Etikett liest die Flaeche ───────────────────────────────────────────────────────
	{
		const { context } = createContext();
		context.resolveFeatureKanon = (typ, id) => (typ === "ecosystem" && id === "r-perlen-2"
			? { kanon: "inoffiziell", bezeichner_type: "briefspiel", bezeichner_label: "Briefspiel" }
			: null);
		const [eintrag] = context.resolveBackendSpotlightEntries([PERLEN], []);
		assert.deepStrictEqual([...context.spotlightEntryKanonRef(eintrag)], ["ecosystem", "r-perlen-2"],
			"das Etikett kommt von der sprechenden Flaeche der Gruppe"); checks++;
	}

	// ── H. Eine unbekannte Art bleibt verworfen -- der neue Zweig oeffnet keine Tuer fuer alles ──────
	{
		const { context } = createContext();
		assert.strictEqual(context.resolveBackendSpotlightEntries([{ ...MISTEL, kind: "irgendwas" }], []).length, 0); checks++;
	}

	console.log(`spotlight-landschaft: ${checks} Pruefungen OK`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

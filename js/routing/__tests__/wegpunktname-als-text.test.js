// Ein Wegpunktname ist TEXT -- in der Reiseueberschrift und in den Meldungen des Routenplaners.
//
// Ein Wegpunkt ist in diesem Planer der Text seines Eingabefelds, und nicht jeder solche Text ist ein
// Ortsname aus den Kartendaten: ein Kartenpunkt heisst so, wie sein Feld beschriftet ist
// (parseMapPointWaypoint). Was dort steht, erscheint deshalb ueberall als Text und nie als Markup --
// das <strong> um Start und Ziel ist das einzige Markup der Reiseueberschrift.
//
// ⭐ AUSGEFUEHRT, NICHT GEGREPT: der Weg vom Eingabefeld bis zur Anzeige ist echt --
// collectAndValidateSelectedLocations und validateLocation (routing.js), parseMapPointWaypoint
// (route-travel-here.js), updateMapViewServerPrimary (route-engine.js), showRoutePlan (route-plan.js),
// showRouteNotice und showFeedbackToast (map-features.js). Gefaelscht sind nur der Server, das DOM der
// Wegpunktzeilen, #overview und das Toast-Element -- dieselbe Umgebung wie sperrzeiten-hinweis.test.js
// und routenmeldung-toast.test.js.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/wegpunktname-als-text.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (relativ) => fs.readFileSync(path.join(REPO, relativ), "utf8").replace(/\r\n/g, "\n");
const lade = (relativ) => vm.runInThisContext(lies(relativ), { filename: relativ });
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

// Was ein Leser sieht: Tags weg, Entitaeten aufgeloest, Leerraum zusammengezogen. `&amp;` zuletzt,
// sonst wuerde aus einem escapten „&amp;lt;" faelschlich ein „<".
const sichtbarerText = (markup) => String(markup)
	.replace(/<[^>]*>/g, "")
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, '"')
	.replace(/&#039;/g, "'")
	.replace(/&uuml;/g, "ü")
	.replace(/&amp;/g, "&")
	.replace(/\s+/g, " ")
	.trim();
// Welche Elemente das Markup baut -- ein Name darf keines beisteuern.
const elemente = (markup) => Array.from(String(markup).matchAll(/<([A-Za-z][A-Za-z0-9-]*)/g), (treffer) => treffer[1].toLowerCase());

// ---- Das Toast-Element: es nimmt Text, nie Markup -------------------------------------------------------
const toast = { textContent: "", hidden: true, dataset: {}, klassen: new Set() };
toast.classList = { add: (k) => toast.klassen.add(k), remove: (k) => toast.klassen.delete(k) };
const keinMarkup = () => { throw new Error("der Toast bekommt Markup statt Text"); };
Object.defineProperty(toast, "innerHTML", { get: keinMarkup, set: keinMarkup });
Object.defineProperty(toast, "outerHTML", { get: keinMarkup, set: keinMarkup });
toast.insertAdjacentHTML = keinMarkup;
const toastLeeren = () => { toast.textContent = ""; toast.hidden = true; };

// ---- Umgebung -----------------------------------------------------------------------------------------
// Die Uhr wird nur aufgezeichnet, nie gefahren: der Toast soll stehen bleiben, bis er gelesen ist.
const wecker = [];
global.window = {
	location: { search: "" },
	addEventListener() {},
	setTimeout: (fn, ms) => { wecker.push({ fn, ms }); return wecker.length; },
	clearTimeout: () => {},
};
global.document = {
	getElementById: (id) => (id === "copy-feedback-toast" ? toast : null),
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: {},
};
global.localStorage = { getItem: () => null, setItem() {} };
global.feedbackToastTimeoutId = null;
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.DISTANCE_SCALING_FACTOR = 3;
global.SYNTHETIC_ROUTE_LONG_LEG_WARN_DISTANCE = 1e9;
global.ROUTE_ICON_PATHS = { Weg: "weg.svg" };
global.SPEED_TABLE = { groupFoot: { Weg: 3.5 } };
global.THRESHOLD = 0.5;
global.ROUTE_CITY_NODE_THRESHOLD = 0.15;
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.getTransportOptionForRouteType = () => "groupFoot";
global.buildRouteOptionsFromPlannerControls = () => ({ allowLand: true, allowRiver: true, allowSea: true, landOption: "groupFoot" });
global.findPathByPublicId = () => null;
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;
global.isCrossingLocation = () => false;
global.locationData = [{ name: "Beran", coordinates: [0, 30] }, { name: "Ceran", coordinates: [0, 60] }];
global.selectedLocations = [];
global.invalidLocationInputs = [];
global.currentRoutePlanEntries = [];
global.currentRouteSegments = [];
global.currentRouteNames = [];
global.currentRouteClosures = [];
global.currentRouteSeasonalWays = [];
global.activeRoutePlanEntryIndex = null;
global.graphData = null;
global.syncPlannerStateToUrl = () => {};
global.resetRoutePresentation = () => {};
global.removeStaleRouteLine = () => {};
global.renderRouteWaypointMarkers = () => {};
global.focusMapOnActiveTargets = () => {};
global.resetOverview = () => {};
global.logRoutePoints = () => {};
global.drawRoute = () => {};
global.highlightError = () => {};

// Die Wegpunktzeilen: je Zeile der Text ihres Eingabefelds.
let wegpunktZeilen = [];
const wegpunkte = (...texte) => {
	wegpunktZeilen = texte.map((wert, index) => ({ istWegpunktZeile: true, wert, id: `wp-${index + 1}` }));
};
global.getWaypointContainers = () => ({
	each(fn) {
		wegpunktZeilen.forEach((zeileDesPlaners, index) => fn.call(zeileDesPlaners, index, zeileDesPlaners));
	},
});

// #overview zeichnet auf, was hineingeschrieben wird; `.text()` ersetzt den Inhalt wie in jQuery.
let angehaengt = [];
let vorangestellt = [];
let ueberblickText = "";
const kette = { on() { return kette; }, find() { return kette; }, empty() { return kette; } };
const ueberblick = {
	empty() { angehaengt = []; vorangestellt = []; ueberblickText = ""; return ueberblick; },
	append(markup) { angehaengt.push(String(markup)); return ueberblick; },
	prepend(markup) { vorangestellt.push(String(markup)); return ueberblick; },
	text(wert) { angehaengt = []; vorangestellt = []; ueberblickText = String(wert); return ueberblick; },
	find() { return kette; },
};
global.$ = (selektor) => {
	if (selektor === "#overview") {
		return ueberblick;
	}
	if (selektor && selektor.istWegpunktZeile) {
		return { find: () => ({ val: () => selektor.wert, css() {} }), data: () => selektor.id };
	}
	return { val: () => "fastest", is: () => false, on() { return kette; }, find() { return kette; }, text() {}, empty() {}, length: 0 };
};

const echtesLog = console.log;
const echterFehler = console.error;
console.log = () => {};
console.info = () => {};
console.warn = () => {};

// ---- Die echten Dateien, in der Reihenfolge von index.html ---------------------------------------------
lade("js/app/i18n.js");
global.tr = global.window.tr;
lade("js/app/utils.js");
lade("js/map-features/path-einschraenkung.js");
lade("js/routing/travel-calendar.js");
lade("js/routing/route-result.js");
lade("js/routing/route-view-model.js");
lade("js/routing/route-node.js");
lade("js/routing/route-plan-calendar.js");
lade("js/routing/route-closures.js");
lade("js/routing/route-plan.js");
lade("js/routing/route-buendel.js");
lade("js/routing/route-engine.js");
lade("js/routing/route-travel-here.js");
const kartenFeatures = lies("js/map-features/map-features.js");
vm.runInThisContext(
	schneide(kartenFeatures, "getFeedbackToastElement", "js/map-features/map-features.js")
		+ zeile(kartenFeatures, /\nconst FEEDBACK_TOAST_DEFAULT_MS = [^;]+;/, "js/map-features/map-features.js")
		+ schneide(kartenFeatures, "showFeedbackToast", "js/map-features/map-features.js")
		+ zeile(kartenFeatures, /\nconst ROUTE_NOTICE_TOAST_MS = [^;]+;/, "js/map-features/map-features.js")
		+ zeile(kartenFeatures, /\nlet routeNoticeText = [^;]+;/, "js/map-features/map-features.js")
		+ schneide(kartenFeatures, "showRouteNotice", "js/map-features/map-features.js"),
	{ filename: "map-features-toast-ausgeschnitten.js" }
);
const planer = lies("js/routing/routing.js");
vm.runInThisContext(
	zeile(planer, /\nconst normalizeLocationSearchName = \(name\) => \{[\s\S]*?\n\};/, "js/routing/routing.js")
		+ zeile(planer, /\nconst validateLocation = \(name\) => \{[\s\S]*?\n\};/, "js/routing/routing.js")
		+ schneide(planer, "collectAndValidateSelectedLocations", "js/routing/routing.js"),
	{ filename: "routing-wegpunkte-ausgeschnitten.js" }
);
// 💣 NACH dem Laden gesetzt: utils.js und route-plan.js bringen ihre echten Fassungen mit, die das DOM
// bzw. die Karte brauchen.
global.getPlannerRestHoursPerDay = () => 16;
global.zoomToCurrentRoute = () => {};

// ---- Der Server --------------------------------------------------------------------------------------
let serverAntwort = null;
global.calculateRouteServer = async () => {
	const route = serverAntwort;
	return { source: "server", ok: true, found: Boolean(route.found), segments: route.segments || [], route };
};
const strecke = (id, von, bis, x0, x1) => ({
	edge_id: id, from_node: von, to_node: bis, subtype: "Weg", public_id: `pub-${id}`,
	geometry: { type: "LineString", coordinates: [[x0, 0], [x1, 0]] },
});
const gefunden = { found: true, segments: [strecke("e1", "Startpunkt", "Beran", 0, 30), strecke("e2", "Beran", "Ceran", 30, 60)], duration: { travel_days: 1 }, closures: [] };
const nichtGefunden = { found: false, segments: [], duration: {}, closures: [] };

const KARTENPUNKT = "<b>Fett</b> (0.000, 0.000)";
const NUR_TEXT = "<b>Fett</b>";

const planen = async (antwort, ...texte) => {
	toastLeeren();
	wegpunkte(...texte);
	serverAntwort = antwort;
	await updateMapViewServerPrimary();
};

(async () => {
	// ---- A) Das Ansichtsmodell: jeder der drei Zweige escapt seinen Namen, das <strong> bleibt ---------
	{
		const namen = [{ name: "<b>A</b>" }, { name: "<i>B</i>" }, { name: "<u>C</u>" }];
		const ausOrten = buildRoutePlanViewModel({ summary: {}, steps: [] }, [], namen).routeDescription;
		assert.deepStrictEqual(elemente(ausOrten), ["strong", "strong"], "A: nur das <strong> um Start und Ziel ist Markup:\n" + ausOrten);
		assert.strictEqual(sichtbarerText(ausOrten), "von <b>A</b> über <i>B</i> nach <u>C</u>", "A: von, über und nach zeigen den Namen als Text");

		// Ohne Wegpunkte faellt die Ueberschrift auf die Knotennamen der Route zurueck -- dieselbe Regel.
		const ausKnoten = buildRoutePlanViewModel({ summary: {}, steps: [] }, ["<b>A</b>", "<i>B</i>", "<u>C</u>"], []).routeDescription;
		assert.strictEqual(ausKnoten, ausOrten, "A: die Knotennamen gehen durch dieselbe Regel");

		// Ein gewoehnlicher Name steht Zeichen fuer Zeichen da wie zuvor.
		const gewoehnlich = buildRoutePlanViewModel({ summary: {}, steps: [] }, [], [{ name: "Gareth" }, { name: "Perricum" }]).routeDescription;
		assert.strictEqual(gewoehnlich, "von <strong>Gareth</strong> nach <strong>Perricum</strong>", "A: gewoehnliche Namen unveraendert");
		const mitZeichen = buildRoutePlanViewModel({ summary: {}, steps: [] }, [], [{ name: "Al'Anfa" }, { name: "Tempel & Hof" }, { name: "Mühlingen" }]).routeDescription;
		assert.strictEqual(sichtbarerText(mitZeichen), "von Al'Anfa über Tempel & Hof nach Mühlingen", "A: Apostroph, & und Umlaut lesen sich wie zuvor");
	}

	// ---- B) Die Reiseueberschrift im echten Ablauf, vom Eingabefeld bis #overview ------------------------
	{
		await planen(gefunden, KARTENPUNKT, "Ceran");
		assert.strictEqual(selectedLocations.length, 2, "B: beide Wegpunkte gelten");
		assert.strictEqual(selectedLocations[0].isMapPoint, true, "B: der erste ist ein Kartenpunkt");
		assert.strictEqual(selectedLocations[0].name, KARTENPUNKT, "B: und heisst, wie sein Feld beschriftet ist");

		const kopf = vorangestellt.join("");
		const knopf = '<button type="button" class="route-plan-entry route-plan-summary">';
		const ab = kopf.indexOf(knopf);
		assert.ok(ab >= 0, "B: die Reiseueberschrift ist gezeichnet:\n" + kopf);
		const ueberschrift = kopf.slice(ab + knopf.length, kopf.indexOf("</button>", ab));
		assert.deepStrictEqual(elemente(ueberschrift), ["strong", "strong"], "B: der Name baut kein Element:\n" + ueberschrift);
		assert.strictEqual(sichtbarerText(ueberschrift), `Die Reise von ${KARTENPUNKT} nach Ceran`, "B: die Ueberschrift zeigt den Namen als Text");

		// Und nirgends sonst im Reiseplan wird aus dem Namen ein Element -- auch nicht in den Etappenzeilen.
		const plan = vorangestellt.join("") + angehaengt.join("");
		assert.ok(angehaengt.length > 0, "B: die Etappen sind gezeichnet");
		assert.ok(!elemente(plan).includes("b"), "B: kein <b>-Element im ganzen Reiseplan");
		assert.ok(sichtbarerText(angehaengt.join("")).includes(`von ${KARTENPUNKT}`), "B: die erste Etappe nennt den Namen als Text");
	}

	// ---- C) Die Absage im Panel (nur eine Sperre verstellt die Route) ------------------------------------
	{
		const gesperrt = {
			found: false, segments: [], duration: {},
			closures: [{ blocked: true, leg_index: 0, avoided: [{ kind: "transport", path_name: "Schattenbachpass", public_ids: ["pub-Q"],
				subtype: "Gebirgspass", transport: "horseCarriage", from_node: "Beran", allowed: ["groupFoot"] }] }],
		};
		await planen(gesperrt, KARTENPUNKT, "Ceran");
		const absage = angehaengt.join("");
		assert.ok(absage.includes('class="route-plan-absage"'), "C: die Absage steht im Panel:\n" + absage);
		assert.ok(!elemente(absage).includes("b"), "C: der Name baut kein Element:\n" + absage);
		assert.ok(sichtbarerText(absage).includes(`Keine offene Route von ${KARTENPUNKT} nach Ceran`), "C: die Absage nennt den Namen als Text");
	}

	// ---- D) Die Toasts: Text, nie Markup -------------------------------------------------------------------
	{
		await planen(nichtGefunden, KARTENPUNKT, "Ceran");
		assert.strictEqual(toast.textContent, `Keine Route zwischen ${KARTENPUNKT} und Ceran gefunden.`, "D: keine Route");
		assert.strictEqual(toast.hidden, false, "D: der Toast ist sichtbar");
		assert.strictEqual(ueberblickText, "Keine Route gefunden", "D: und #overview bekommt Text");

		await planen(nichtGefunden, NUR_TEXT, "Ceran");
		assert.deepStrictEqual(invalidLocationInputs.slice(), [NUR_TEXT], "D: ein Text ohne Ort und ohne Koordinaten gilt nicht");
		assert.strictEqual(toast.textContent, `Orte nicht gefunden: ${NUR_TEXT}`, "D: Orte nicht gefunden");

		// Beide Meldungen derselben Berechnung reihen sich -- und bleiben beide Text.
		await planen(nichtGefunden, NUR_TEXT, KARTENPUNKT, "Ceran");
		assert.strictEqual(toast.textContent, `Orte nicht gefunden: ${NUR_TEXT} · Keine Route zwischen ${KARTENPUNKT} und Ceran gefunden.`,
			"D: beide Meldungen, beide als Text: " + toast.textContent);
	}

	console.log = echtesLog;
	console.error = echterFehler;
	echtesLog("wegpunktname-als-text.test.js: all assertions passed");
})().catch((error) => {
	console.log = echtesLog;
	console.error = echterFehler;
	echterFehler(error);
	process.exit(1);
});

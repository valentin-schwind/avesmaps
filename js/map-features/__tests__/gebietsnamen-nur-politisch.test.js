// Gebietsnamen werden nur in der Ansicht "Politisch" gebaut -- in den Grenzen-Ansichten ("Standard",
// "Landschaften") nur vorgemerkt und beim Wechsel nach "Politisch" nachgetragen.
//
// 💣 WARUM: Die politische Ebene laedt auch in "Standard" und "Landschaften" (fuer die Grenzlinien),
// und jeder Aufbau rasterte fuer JEDES Gebiet den Namen zu einem Bild -- gezeigt werden Namen aber
// nur in "Politisch". Gemessen am 23.09.2026 bei Zoom 4: 853 Namen gebaut, 0 auf der Karte, rund 1 s
// Blockade je neuer Zoomstufe allein fuer die Namensbilder.
//
// 🔴 EIN WEG: der Loader baut Namen nie selbst, er merkt sie vor; syncRegionVisibility baut sie, sobald
// "Politisch" angezeigt wird -- direkt nach dem Aufbau und beim Wechsel der Ansicht.
//
// 🔴 DIE ZUSAGE, DIE DIESER TEST HAELT: das ergibt DIESELBEN Namen wie der alte Aufbau, der jeden Namen
// sofort beim Zeichnen baute -- dieselben Traeger, dieselbe Reihenfolge, dieselben Anker, dasselbe Bild.
// Die Reihenfolge ist tragend: der Name eines Territoriums gehoert seinem ERSTEN Stueck, das ihn bekommen
// darf (und ein Quellstueck weicht der Aussenhuelle aus, auch wenn es vor ihr kommt).
//
// ⭐ Ausgefuehrt, nicht gelesen: der echte Loader (loadPoliticalTerritoryLayer), der echte Aufbau
// (addRegionFeatureToMap samt Namensfunktion), die echte Normalisierung und BEIDE Fassungen von
// syncRegionVisibility (die aktive aus dem Loader und die Vorlage) laufen gegen Leaflet-Attrappen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/gebietsnamen-nur-politisch.test.js
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

const rendering = lies("js/map-features/map-features-region-rendering.js");
const loader = lies("js/map-features/map-features-political-territory-loader.js");
const vorlage = lies("js/map-features/map-features-political-region-visibility.js");
const normalisierung = lies("js/map-features/map-features-region-feature-normalization.js");

// --- Leaflet und Karte als Attrappen ------------------------------------------------------------
let zoom = 4;
let modus = "deregraphic";
const aufKarte = new Set();
global.window = global;
global.L = {
	latLng: (lat, lng) => ({ lat, lng }),
	polygon: (latlngs) => {
		const ring = latlngs[0];
		const lats = ring.map((p) => p[0]);
		const lngs = ring.map((p) => p[1]);
		const mitte = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
		return { bringToFront() {}, bringToBack() {}, getBounds: () => ({ getCenter: () => mitte }), addTo() { return this; } };
	},
	tooltip: () => {
		const t = { _latlng: null, _inhalt: null };
		t.setLatLng = (ll) => { t._latlng = ll; return t; };
		t.setContent = (inhalt) => { t._inhalt = inhalt; return t; };
		t.getLatLng = () => t._latlng;
		return t;
	},
};
global.map = {
	getZoom: () => zoom,
	latLngToContainerPoint: (ll) => ({ x: ll.lng * 2 ** zoom, y: -ll.lat * 2 ** zoom }),
	addLayer: (layer) => { aufKarte.add(layer); },
	removeLayer: (layer) => { aufKarte.delete(layer); },
	hasLayer: (layer) => aufKarte.has(layer),
};

// Das Namensbild: gezaehlt, und die Argumente stehen im Ergebnis -- so vergleicht der Test, WOMIT
// jeder Name gebaut wurde (Anzeigename, Umbruchbreite, Zoom).
let namensbilder = 0;
// Wie viele Flaechen standen auf der Karte, waehrend ein Name gebaut wurde? Der Nachtrag laeuft VOR der
// Flaechen-Schleife -- so wie frueher der Aufbau baute; danach kostete er messbar mehr Rechenzeit.
let flaechenBeimBauen = 0;
global.createRegionLabelMarkup = (entry, name, breite, z) => {
	namensbilder += 1;
	flaechenBeimBauen = Math.max(flaechenBeimBauen, regionPolygons.filter((p) => aufKarte.has(p)).length);
	return `${name}|${breite === null ? "-" : Math.round(breite)}|z${z}`;
};
// Ankerpunkt: die Mitte der Huellbox des ersten Rings, Radius 1 -- genug, um zu sehen, WELCHE
// Geometrie der Anker genommen hat (die Aussenhuelle ist groesser als ihr Quellstueck).
global.avesmapsComputeLabelPoint = (geometry) => {
	const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
	const xs = ring.map((p) => p[0]);
	const ys = ring.map((p) => p[1]);
	return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, distance: (Math.max(...xs) - Math.min(...xs)) / 4 };
};
let abstossungen = 0;
global.scheduleLabelCollisionResolution = () => { abstossungen += 1; };

// --- Was die echten Funktionen ausserdem anfassen -----------------------------------------------
global.regionPolygons = [];
global.regionLabels = [];
global.regionData = [];
global.recentRegionOverlapSelection = null;
global.IS_EDIT_MODE = false;
global.getSelectedMapLayerMode = () => modus;
global.buildRegionPolygonStyle = () => ({});
global.avesmapsRegionPolygonIsInteractive = () => false;
global.bindRegionPolygonEditEvents = () => {};
global.bindRegionCompactTooltip = () => {};
global.bindRegionHoverTooltip = () => {};
global.closeRegionCompactTooltip = () => {};
global.clearPendingRegionTargetHighlight = () => {};
global.clearRegionGeometryEdit = () => {};
global.closeRegionContextMenu = () => {};
global.cancelPendingRegionOperation = () => {};
global.syncPoliticalTimelineVisibility = () => {};
global.syncLocationMarkerVisibility = () => {};
global.readFeatureOtherSource = () => "";
global.avesmapsRegionDerivedIsSourceless = () => false;
global.normalizeRegionParentheticalSpacing = (v) => String(v || "");
global.normalizeRegionStringList = () => [];
global.TERRITORY_BOUNDARY_MODES = ["political", "deregraphic", "ecosystem"];
global.POLITICAL_TERRITORIES_API_URL = "api/app/political-territories.php";
global.POLITICAL_TERRITORY_LAYER_PARSED_CACHE_TTL_MS = 300000;
global.politicalTimelineYear = 1049;
global.isPoliticalTerritoryLayerLoading = false;
global.politicalTerritoryApiUnavailable = false;
global.politicalTerritoryLayerLoadedZoom = null;
global.politicalTerritoryLayerLoadedKey = null;
global.politicalTerritoryLayerReloadPending = null;
global.activeRegionGeometryEdit = null;
global.pendingRegionOperation = null;
global.pendingRegionMoveState = null;
global.refreshPoliticalTerritoryStyleCache = async () => ({});
global.clearPoliticalTerritoryTimelineSelection = () => {};
global.applyPoliticalTerritoryCachedStyle = () => {};
global.applyPoliticalTerritoryPendingStyleOverrides = () => {};
global.applyPoliticalTerritoryDerivedBoundaryVisibility = () => {};
let nachladen = 0;
global.schedulePoliticalTerritoryLayerReload = () => { nachladen += 1; };

// --- Die Gebiete: jede Regel, die ueber den Namen entscheidet, einmal ---------------------------
const quadrat = (x, y, s) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
const gebiet = (id, territorium, geometrie, extra = {}) => ({
	type: "Feature",
	id,
	geometry: geometrie,
	properties: Object.assign({
		public_id: id, territory_public_id: territorium, feature_type: "political_territory",
		name: "Gebiet " + id, min_zoom: 0, max_zoom: 7,
	}, extra),
});
const GEBIETE = [
	// Zwei Stuecke EINES Territoriums: nur das erste traegt den Namen.
	gebiet("A1", "A", { type: "Polygon", coordinates: quadrat(10, 10, 4) }),
	gebiet("A2", "A", { type: "Polygon", coordinates: quadrat(20, 10, 4) }),
	// Quellstueck VOR seiner Aussenhuelle: es weicht aus, die Huelle traegt den Namen (Anker der Huelle).
	gebiet("B-quelle", "B", { type: "Polygon", coordinates: quadrat(30, 30, 2) }),
	gebiet("B-huelle", "B", { type: "Polygon", coordinates: quadrat(28, 28, 12) }, { is_derived_geometry: true }),
	// Ausdruecklich ohne Namen.
	gebiet("C", "C", { type: "Polygon", coordinates: quadrat(50, 10, 4) }, { show_region_label: false }),
	// Von einer Aussengrenze verborgen.
	gebiet("D", "D", { type: "Polygon", coordinates: quadrat(60, 10, 4) }, { visual_hidden_by_derived_boundary: true }),
	// Mehrteilig: der Name nur am ersten Teil.
	gebiet("E", "E", { type: "MultiPolygon", coordinates: [quadrat(70, 10, 6), quadrat(90, 10, 2)] }),
	// Ohne Territoriumsschluessel: jeder bekommt seinen Namen, keiner verdraengt den anderen.
	gebiet("F1", "", { type: "Polygon", coordinates: quadrat(10, 50, 4) }),
	gebiet("F2", "", { type: "Polygon", coordinates: quadrat(20, 50, 4) }),
	// Ausserhalb des Zoombands: der Name entsteht, steht aber nicht auf der Karte.
	gebiet("G", "G", { type: "Polygon", coordinates: quadrat(40, 60, 4) }, { min_zoom: 5 }),
];
global.fetchPoliticalTerritories = async () => ({ ok: true, features: JSON.parse(JSON.stringify(GEBIETE)) });

// --- Die ECHTEN Bauteile ------------------------------------------------------------------------
vm.runInThisContext(normalisierung);
vm.runInThisContext(schnitt(rendering, "let politicalRegionLabeledTerritoryKeys", ""));
vm.runInThisContext(schnitt(rendering, "let pendingRegionLabels", ""));
vm.runInThisContext(schnitt(rendering, "let reusableRegionLabelsByKey", ""));
vm.runInThisContext(schnitt(rendering, "function snapshotRegionLabelsForReuse", "}"));
vm.runInThisContext(schnitt(rendering, "function discardUnusedReusableRegionLabels", "}"));
vm.runInThisContext(schnitt(rendering, "let politicalRegionDerivedByTerritory", ""));
vm.runInThisContext(schnitt(rendering, "const REGION_LABEL_WRAP_WIDTH_FACTOR", "})();"));
vm.runInThisContext(schnitt(rendering, "function computeRegionLabelMaxWidthPx", "}"));
vm.runInThisContext(schnitt(rendering, "function indexPoliticalRegionDerivedByTerritory", "}"));
vm.runInThisContext(schnitt(rendering, "let politicalRegionFillSuppressedByDisplayingChild", ""));
vm.runInThisContext(schnitt(rendering, "function clearRenderedRegionLayers", "}"));
vm.runInThisContext(schnitt(rendering, "function shouldHideRegionForDerivedBoundary", "}"));
vm.runInThisContext(schnitt(rendering, "function getActiveOuterBoundaryHideTargets", "}"));
vm.runInThisContext(schnitt(rendering, "function readDerivedBoundarySourceTerritoryIds", "}"));
vm.runInThisContext(schnitt(rendering, "function readDerivedBoundarySourceGeometryIds", "}"));
vm.runInThisContext(schnitt(rendering, "function addRegionLabelForPolygon", "}"));
vm.runInThisContext(schnitt(rendering, "function addPendingRegionLabels", "}"));
vm.runInThisContext(schnitt(rendering, "function addRegionFeatureToMap", "}"));
vm.runInThisContext(schnitt(loader, "const politicalTerritoryLayerParsedCache", ""));
vm.runInThisContext(schnitt(loader, "function buildPoliticalTerritoryLayerParsedCacheKey", "}"));
vm.runInThisContext(schnitt(loader, "function arePublicIdSetsEqual", "}"));
vm.runInThisContext(schnitt(loader, "async function loadPoliticalTerritoryLayer", "}"));
// Erst die Vorlage (sie ist die globale syncRegionVisibility, bis der Loader seine installiert) ...
vm.runInThisContext(vorlage);
const syncVorlage = global.syncRegionVisibility;
// ... dann die aktive Fassung aus dem Loader.
vm.runInThisContext(schnitt(loader, "function installPoliticalRegionVisibilityBehavior", "}"));
installPoliticalRegionVisibilityBehavior();
const syncAktiv = global.syncRegionVisibility;
assert.notStrictEqual(syncAktiv, syncVorlage, "der Loader installiert seine eigene syncRegionVisibility");

// --- Werkzeuge ------------------------------------------------------------------------------------
const vorgemerkt = () => vm.runInThisContext("pendingRegionLabels.length");
// Was ein Name ist: welches Stueck ihn traegt, sein Territorium, sein Anker, sein Bild, sein Rang --
// und ob er auf der Karte steht.
const namen = () => {
	const traeger = new Map();
	regionPolygons.forEach((p) => {
		if (p._regionEntry && p._regionEntry.label) traeger.set(p._regionEntry.label, p._regionEntry.publicId);
	});
	return regionLabels.map((l) => ({
		traeger: traeger.get(l),
		schluessel: l._territoryKey,
		anker: [l.getLatLng().lat, l.getLatLng().lng],
		bild: l._regionLabelMarkup,
		rang: l._regionLabelPriority,
		aufKarte: aufKarte.has(l),
	}));
};
const eintragVon = (id) => regionPolygons.find((p) => p._regionEntry && p._regionEntry.publicId === id)._regionEntry;
async function laden(ansicht) {
	modus = ansicht;
	politicalTerritoryLayerParsedCache.clear();
	await loadPoliticalTerritoryLayer();
}

(async () => {
	// --- 1) Referenz: der ALTE Aufbau, jeder Name sofort beim Zeichnen ------------------------------
	modus = "political";
	clearRenderedRegionLayers();
	global.regionData = JSON.parse(JSON.stringify(GEBIETE));
	regionData.forEach((region) => addRegionFeatureToMap(region, normalizeRegionFeature(region)));
	assert.strictEqual(vorgemerkt(), 0, "ohne Angabe wird sofort gebaut, nichts vorgemerkt");
	syncAktiv();
	const referenz = namen();
	const referenzBilder = namensbilder;
	assert.deepStrictEqual(referenz.map((n) => n.schluessel), ["A", "B", "E", "", "", "G"],
		"die Regeln der Namensvergabe: erstes Stueck, Huelle statt Quelle, keiner fuer C/D, je einer fuer F1/F2");
	assert.strictEqual(referenzBilder, referenz.length, "je Name genau ein Namensbild");
	assert.deepStrictEqual(referenz.map((n) => n.traeger), ["A1", "B-huelle", "E", "F1", "F2", "G"],
		"wer den Namen traegt: das ERSTE Stueck von A, die HUELLE von B (nicht das fruehere Quellstueck)");
	assert.deepStrictEqual(referenz[1].anker, [34, 34], "B steht am Anker der Huelle");
	assert.deepStrictEqual(referenz.map((n) => n.aufKarte), [true, true, true, true, true, false],
		"G liegt ausserhalb seines Zoombands");

	// --- 1b) Der Loader in "Politisch": vorgemerkt und direkt danach gebaut, dasselbe Ergebnis ------
	namensbilder = 0;
	await laden("political");
	assert.deepStrictEqual(namen(), referenz, "Loader in Politisch = alter Aufbau");
	assert.strictEqual(namensbilder, referenzBilder, "mit genau so vielen Namensbildern");
	assert.strictEqual(vorgemerkt(), 0, "und nichts bleibt vorgemerkt");

	// --- 2) Aufbau in "Standard": KEIN Name wird gebaut, jedes Gebiet vorgemerkt -------------------
	namensbilder = 0;
	await laden("deregraphic");
	assert.strictEqual(namensbilder, 0, "in Standard entsteht kein einziges Namensbild");
	assert.strictEqual(regionLabels.length, 0, "und kein Name");
	assert.strictEqual(vorgemerkt(), GEBIETE.length, "je Gebiet eine Vormerkung (nur fuer sein erstes Stueck)");
	assert.strictEqual(regionPolygons.filter((p) => aufKarte.has(p)).length, 0, "und nichts davon steht auf der Karte");

	// --- 3) Wechsel nach "Politisch": dieselben Namen wie in 1) -------------------------------------
	const abstossungenVorher = abstossungen;
	modus = "political";
	syncAktiv();
	assert.deepStrictEqual(namen(), referenz, "nachgetragen = alter Aufbau: Traeger, Reihenfolge, Anker, Bild, Rang, Sichtbarkeit");
	assert.strictEqual(namensbilder, referenzBilder, "und genau so viele Namensbilder wie direkt");
	assert.strictEqual(vorgemerkt(), 0, "die Vormerkungen sind abgearbeitet");
	assert.strictEqual(abstossungen, abstossungenVorher + 1, "danach einmal die Abstossung der Namen");
	assert.strictEqual(flaechenBeimBauen, 0, "gebaut wurde, bevor die Flaechen auf die Karte kamen (Wechsel und Aufbau)");

	// --- 4) Ein zweiter Durchgang baut nichts mehr ---------------------------------------------------
	syncAktiv();
	assert.strictEqual(namensbilder, referenzBilder, "kein zweites Namensbild");
	assert.strictEqual(abstossungen, abstossungenVorher + 1, "und ohne neue Namen keine zweite Abstossung");

	// --- 5) Hin und zurueck bei gleichem Zoom: die Namen bleiben, nichts wird neu gebaut ----------
	modus = "deregraphic";
	syncAktiv();
	assert.strictEqual(namen().filter((n) => n.aufKarte).length, 0, "in Standard steht kein Name auf der Karte");
	modus = "political";
	syncAktiv();
	assert.deepStrictEqual(namen(), referenz, "zurueck in Politisch: dieselben Namen");
	assert.strictEqual(namensbilder, referenzBilder, "ohne ein einziges neues Namensbild");

	// --- 6) Ein Stueck, das inzwischen nicht mehr gezeichnet wird, bekommt keinen Namen ------------
	await laden("deregraphic");
	const a1 = eintragVon("A1");
	global.regionPolygons = regionPolygons.filter((p) => p._regionEntry !== a1); // wie beim Loeschen
	modus = "political";
	syncAktiv();
	assert.strictEqual(a1.label, null, "A1 ist weg und bekommt keinen Namen");
	assert.strictEqual(eintragVon("A2").label && eintragVon("A2").label._territoryKey, "A",
		"der Name von A geht an das naechste Stueck -- so wie ein Aufbau ohne A1 es taete");

	// Vorgemerkt, aber kein Stueck mehr gezeichnet: kein Name, also auch keine Abstossung.
	await laden("deregraphic");
	global.regionPolygons = [];
	const abstossungenLeer = abstossungen;
	modus = "political";
	syncAktiv();
	assert.strictEqual(regionLabels.length, 0, "nichts mehr gezeichnet -> kein Name");
	assert.strictEqual(abstossungen, abstossungenLeer, "und ohne neuen Namen keine Abstossung");

	// --- 7) Ein Eintrag, der schon einen Namen hat, bekommt keinen zweiten ------------------------
	await laden("deregraphic");
	const e = eintragVon("E");
	const schonDa = { _territoryKey: "E", getLatLng: () => ({ lat: 0, lng: 0 }) };
	e.label = schonDa;
	modus = "political";
	syncAktiv();
	assert.strictEqual(e.label, schonDa, "der vorhandene Name bleibt");
	assert.strictEqual(regionLabels.filter((l) => l._territoryKey === "E").length, 0, "kein zweiter Name fuer E");

	// --- 8) Ein neuer Aufbau verwirft alte Vormerkungen ---------------------------------------------
	await laden("deregraphic");
	clearRenderedRegionLayers();
	assert.strictEqual(vorgemerkt(), 0, "clearRenderedRegionLayers leert die Vormerkungen mit");
	namensbilder = 0;
	modus = "political";
	syncAktiv();
	assert.strictEqual(namensbilder, 0, "ohne Aufbau nichts nachzutragen");

	// --- 9) Es zaehlt die Ansicht beim Sichtbarmachen, nicht die beim Abruf ---------------------------
	const echterAbruf = global.fetchPoliticalTerritories;
	global.fetchPoliticalTerritories = async (p) => { modus = "political"; return echterAbruf(p); };
	namensbilder = 0;
	await laden("deregraphic"); // der Benutzer wechselt waehrend des Abrufs nach Politisch
	assert.strictEqual(vorgemerkt(), 0, "gewechselt waehrend des Abrufs: nichts vorgemerkt ...");
	assert.strictEqual(namensbilder, referenzBilder, "... sondern gleich mit Namen gebaut");
	global.fetchPoliticalTerritories = async (p) => { modus = "deregraphic"; return echterAbruf(p); };
	namensbilder = 0;
	await laden("political"); // und umgekehrt
	assert.strictEqual(namensbilder, 0, "weg von Politisch waehrend des Abrufs: kein Namensbild");
	assert.strictEqual(vorgemerkt(), GEBIETE.length, "sondern vorgemerkt");
	global.fetchPoliticalTerritories = echterAbruf;

	// --- 10) Die Vorlage (Fallback bis zur Installation) traegt ebenso nach ------------------------
	await laden("deregraphic");
	flaechenBeimBauen = 0;
	modus = "political";
	syncVorlage();
	assert.deepStrictEqual(namen(), referenz, "auch die Vorlage traegt nach, mit demselben Ergebnis");
	assert.strictEqual(flaechenBeimBauen, 0, "auch dort vor der Flaechen-Schleife");

	// --- 11) Die uebrigen Aufrufer bauen weiterhin sofort (Vorgabe withLabels = true) --------------
	await laden("deregraphic");
	namensbilder = 0;
	const neu = gebiet("H", "H", { type: "Polygon", coordinates: quadrat(80, 80, 4) });
	addRegionFeatureToMap(neu, normalizeRegionFeature(neu)); // wie beim Anlegen im Editor
	assert.strictEqual(namensbilder, 1, "ohne Angabe wird der Name sofort gebaut");
	assert.strictEqual(vorgemerkt(), GEBIETE.length, "und nicht vorgemerkt");

	console.log("OK gebietsnamen-nur-politisch (11 Abschnitte)");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});

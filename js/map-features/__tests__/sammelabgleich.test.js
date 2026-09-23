const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Run: node js/map-features/__tests__/sammelabgleich.test.js
//
// ⭐ DER SAMMELABGLEICH (23.09.2026): teure Voll-Abgleiche der Karte laufen am Ende einer Folge von
// Aenderungen EINMAL statt je Objekt. Vorher fror ein fremdes „Weg teilen“ jeden offenen Editor
// 0,55 s ein und ein Import-Stapel von 50 Objekten fuenfzigmal so lange.
// Geprueft wird (1) das Bauteil selbst und (2) die echten Stellen, AUSGEFUEHRT: jede Funktion wird aus
// ihrer Datei geschnitten und gefahren, nicht nachgebaut -- ein Quelltext-Muster haette die
// Reihenfolge-Fehler, um die es hier geht, nie gesehen.

const repo = path.join(__dirname, "..", "..", "..");
// 💣 Zeilenendenneutral: hier liegt CRLF, im Deploy-Tor LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
// Eine Funktion der obersten Ebene aus ihrer Datei schneiden: vom Kopf bis zur ersten `}` am Zeilenanfang.
function schneide(rel, name) {
	const text = lies(rel);
	const kopf = new RegExp("^(?:async )?function " + name + "\\(", "m");
	const treffer = kopf.exec(text);
	assert.ok(treffer, `${name} steht in ${rel}`);
	const ende = text.indexOf("\n}", treffer.index);
	assert.ok(ende > treffer.index, `${name} endet in ${rel}`);
	return text.slice(treffer.index, ende + 2);
}
const lade = (rel, namen) => vm.runInThisContext(namen.map((name) => schneide(rel, name)).join("\n\n"), { filename: rel });

vm.runInThisContext(lies("js/map-features/sammelabgleich.js"), { filename: "sammelabgleich.js" });

// --- 1. Das Bauteil ------------------------------------------------------------------------------
{
	assert.strictEqual(avesmapsSammelabgleichVormerken("wege", () => {}), false,
		"ausserhalb eines Sammelabgleichs wird nichts vorgemerkt -- der Aufrufer gleicht sofort ab wie bisher");
	let sofort = 0;
	avesmapsSammelabgleichDanach(() => { sofort += 1; });
	assert.strictEqual(sofort, 1, "und `Danach` laeuft ausserhalb sofort");

	const ablauf = [];
	const merke = (name) => (optionen) => ablauf.push(name + (optionen ? JSON.stringify(optionen) : ""));
	const ergebnis = avesmapsSammelabgleich(() => {
		avesmapsSammelabgleichVormerken("wegnamen", merke("wegnamen"));
		avesmapsSammelabgleichVormerken("wege", merke("wege"));
		avesmapsSammelabgleichVormerken("planer", merke("planer"), { updateRoute: false });
		avesmapsSammelabgleichVormerken("fremd", merke("fremd"));
		avesmapsSammelabgleichVormerken("wege", merke("wege-doppelt"));
		avesmapsSammelabgleichVormerken("planer", merke("planer-doppelt"), { updateRoute: true });
		avesmapsSammelabgleichVormerken("orte", merke("orte"));
		avesmapsSammelabgleichDanach(() => ablauf.push("danach"));
		assert.deepStrictEqual(ablauf, [], "waehrend gesammelt wird, laeuft nichts");
		return 42;
	});
	assert.strictEqual(ergebnis, 42, "der Rueckgabewert der Arbeit kommt durch");
	assert.deepStrictEqual(ablauf, ['planer{"updateRoute":true}', "orte", "wege", "wegnamen", "fremd", "danach"],
		"jeder Abgleich EINMAL, in der festen Reihenfolge (Planer vor Wegen), Unbekanntes danach, `Danach` zuletzt -- "
		+ "und updateRoute ODER-verknuepft: EINE Anforderung mit Route genuegt");
}

{
	// Verschachtelt: nachgeholt wird erst am Ende des AEUSSERSTEN Sammelabgleichs.
	const ablauf = [];
	avesmapsSammelabgleich(() => {
		avesmapsSammelabgleich(() => {
			avesmapsSammelabgleichVormerken("orte", () => ablauf.push("orte"));
		});
		assert.deepStrictEqual(ablauf, [], "der innere Sammelabgleich holt nichts nach");
		avesmapsSammelabgleichVormerken("orte", () => ablauf.push("orte-2"));
	});
	assert.deepStrictEqual(ablauf, ["orte"], "am Ende des aeusseren genau einmal");
}

{
	// ⭐ WAEHREND DES NACHHOLENS WIRD WEITER GESAMMELT. Der Planer zieht ueber „Offene Wegenden“ die
	// Wege nach, die Wege zeichnen die Wegnamen: liefe das sofort, liefen die Wege zweimal.
	const ablauf = [];
	const wege = () => {
		ablauf.push("wege");
		avesmapsSammelabgleichVormerken("wegnamen", () => ablauf.push("wegnamen"));
	};
	avesmapsSammelabgleich(() => {
		avesmapsSammelabgleichVormerken("wege", wege);
		avesmapsSammelabgleichVormerken("planer", () => {
			ablauf.push("planer");
			avesmapsSammelabgleichVormerken("wege", wege);
		});
	});
	assert.deepStrictEqual(ablauf, ["planer", "wege", "wegnamen"],
		"die Nachforderung des Planers verschmilzt mit den vorgemerkten Wegen, die der Wege mit den Wegnamen");
}

{
	// Erledigt: ein Abgleich, den ein anderer mitgezogen hat, faellt aus der Liste.
	const ablauf = [];
	avesmapsSammelabgleich(() => {
		avesmapsSammelabgleichVormerken("ortsnamen", () => ablauf.push("ortsnamen"));
		avesmapsSammelabgleichVormerken("orte", () => {
			ablauf.push("orte");
			avesmapsSammelabgleichErledigt("ortsnamen");
		});
	});
	assert.deepStrictEqual(ablauf, ["orte"], "die vom Orts-Abgleich mitgezogenen Ortsnamen laufen nicht ein zweites Mal");
	avesmapsSammelabgleichErledigt("gibtsnicht");
}

{
	// 💣 Wirft die Arbeit, wird TROTZDEM nachgeholt -- was bis dahin eingespielt ist, muss auf die Karte.
	const ablauf = [];
	assert.throws(() => avesmapsSammelabgleich(() => {
		avesmapsSammelabgleichVormerken("wege", () => ablauf.push("wege"));
		throw new Error("kaputt");
	}), /kaputt/, "der Fehler der Arbeit geht unveraendert weiter");
	assert.deepStrictEqual(ablauf, ["wege"], "und das Vorgemerkte ist trotzdem gelaufen");

	// Wirft EIN Abgleich, laufen die anderen trotzdem; der erste Fehler kommt danach.
	const zweiter = [];
	assert.throws(() => avesmapsSammelabgleich(() => {
		avesmapsSammelabgleichVormerken("orte", () => { throw new Error("orte kaputt"); });
		avesmapsSammelabgleichVormerken("wege", () => zweiter.push("wege"));
		avesmapsSammelabgleichDanach(() => zweiter.push("danach"));
	}), /orte kaputt/, "der Fehler eines Abgleichs wird nicht verschluckt");
	assert.deepStrictEqual(zweiter, ["wege", "danach"], "eine kaputte Stelle haelt die uebrigen nicht auf");
	avesmapsSammelabgleich(() => {});
	assert.strictEqual(avesmapsSammelabgleichVormerken("x", () => {}), false, "und danach wird nicht mehr gesammelt");
}

{
	// Ein Abgleich, der sich ueber Umwege selbst wieder anfordert, darf die Seite nicht aufhaengen.
	const fehlerAusgabe = console.error;
	let gemeldet = 0;
	console.error = () => { gemeldet += 1; };
	let laeufe = 0;
	const kreis = () => { laeufe += 1; avesmapsSammelabgleichVormerken("kreis", kreis); };
	try {
		avesmapsSammelabgleich(() => avesmapsSammelabgleichVormerken("kreis", kreis));
	} finally {
		console.error = fehlerAusgabe;
	}
	assert.ok(laeufe <= 50 && laeufe > 1, `der Kreislauf wird abgebrochen (${laeufe} Laeufe)`);
	assert.strictEqual(gemeldet, 1, "und laut gemeldet, nicht still");
	assert.strictEqual(avesmapsSammelabgleichVormerken("x", () => {}), false, "danach ist nichts mehr offen");
}

{
	const vorher = avesmapsSammelabgleichBilanz().bilanzprobe || { angefordert: 0, ausgefuehrt: 0 };
	avesmapsSammelabgleich(() => {
		avesmapsSammelabgleichVormerken("bilanzprobe", () => {});
		avesmapsSammelabgleichVormerken("bilanzprobe", () => {});
		avesmapsSammelabgleichVormerken("bilanzprobe", () => {});
	});
	const nachher = avesmapsSammelabgleichBilanz().bilanzprobe;
	assert.strictEqual(nachher.angefordert - vorher.angefordert, 3, "die Bilanz zaehlt drei Anforderungen");
	assert.strictEqual(nachher.ausgefuehrt - vorher.ausgefuehrt, 1, "und EINE Ausfuehrung");
}

// --- 2. Die echten Stellen -----------------------------------------------------------------------
// Zaehler fuer das, was die Voll-Abgleiche wirklich TUN. Die Wrapper sind echt, der teure Rumpf nicht.
const lauf = { wege: 0, orte: 0, ortsnamen: [], wegnamen: 0, autocomplete: 0, url: 0, offeneEnden: 0,
	invalidiert: 0, pruefhakenSync: 0, route: 0 };
const ablaufLog = [];
globalThis.syncPathVisibilityJetzt = () => { lauf.wege += 1; ablaufLog.push("wege"); };
globalThis.syncLocationMarkerVisibilityJetzt = () => { lauf.orte += 1; ablaufLog.push("orte"); };
globalThis.syncLocationNameLabelVisibilityJetzt = (kontext) => { lauf.ortsnamen.push(kontext); };
globalThis.window = globalThis;
globalThis.AvesmapsPathLabelCanvasOverlay = { redraw: () => { lauf.wegnamen += 1; } };
globalThis.refreshWaypointAutocompleteSources = () => { lauf.autocomplete += 1; };
globalThis.syncPlannerStateToUrl = () => { lauf.url += 1; };
globalThis.avesmapsRefreshOpenPathEnds = () => { lauf.offeneEnden += 1; };
globalThis.avesmapsInvalidateOpenPathEndCheck = () => { lauf.invalidiert += 1; };
globalThis.avesmapsSyncOpenPathEndCheck = () => { lauf.pruefhakenSync += 1; };
let wegpunkte = [];
globalThis.getWaypointInputValues = () => wegpunkte;
globalThis.updateRouteKeepingCurrentMapView = () => { lauf.route += 1; };
globalThis.graphData = null;
globalThis.locationConnectivityIndex = null;
const nullen = () => Object.keys(lauf).forEach((k) => { lauf[k] = Array.isArray(lauf[k]) ? [] : 0; });

lade("js/map-features/map-features-display-mode.js", ["syncPathVisibility", "avesmapsWegnamenNeuZeichnen"]);
lade("js/map-features/map-features-location-marker-rendering.js", ["syncLocationMarkerVisibility"]);
lade("js/map-features/map-features-location-name-labels.js", ["syncLocationNameLabelVisibility"]);
lade("js/routing/route-render.js", ["refreshPlannerAfterFeatureChange", "refreshPlannerAfterFeatureChangeJetzt"]);

{
	// Ausserhalb: jeder Aufruf gleicht sofort ab -- genau wie vorher.
	nullen();
	syncPathVisibility();
	syncPathVisibility();
	syncLocationMarkerVisibility();
	syncLocationNameLabelVisibility();
	avesmapsWegnamenNeuZeichnen();
	refreshPlannerAfterFeatureChange();
	assert.strictEqual(lauf.wege, 2, "ohne Sammelabgleich laufen die Wege bei jedem Aufruf");
	assert.strictEqual(lauf.orte, 1);
	assert.deepStrictEqual(lauf.ortsnamen, [null]);
	assert.strictEqual(lauf.wegnamen, 1);
	assert.strictEqual(lauf.autocomplete, 1, "und die Planer-Auffrischung sofort");
}

{
	// Im Sammelabgleich: fuenf Anforderungen je Art, EIN Lauf je Art.
	nullen();
	wegpunkte = ["Gareth", "Perricum"];
	avesmapsSammelabgleich(() => {
		for (let i = 0; i < 5; i += 1) {
			globalThis.graphData = { alt: true };
			globalThis.locationConnectivityIndex = { alt: true };
			refreshPlannerAfterFeatureChange({ updateRoute: i === 3 });
			// 🔴 Verworfen wird SOFORT -- sonst rechnete ein Abgleich dazwischen mit dem alten Stand.
			assert.strictEqual(globalThis.graphData, null, "graphData wird sofort verworfen, auch im Sammelabgleich");
			assert.strictEqual(globalThis.locationConnectivityIndex, null, "der Kreuzungs-Index ebenso");
			syncPathVisibility();
			syncLocationMarkerVisibility();
			syncLocationNameLabelVisibility();
			avesmapsWegnamenNeuZeichnen();
		}
		assert.strictEqual(lauf.invalidiert, 5, "der Index von „Offene Wegenden“ wird bei JEDER Aenderung verworfen");
		assert.strictEqual(lauf.autocomplete + lauf.wege + lauf.orte + lauf.wegnamen + lauf.route, 0,
			"waehrend gesammelt wird, rechnet und zeichnet nichts");
	});
	assert.strictEqual(lauf.autocomplete, 1, "die Planer-Auffrischung laeuft EINMAL");
	assert.strictEqual(lauf.url, 1);
	assert.strictEqual(lauf.offeneEnden, 1);
	assert.strictEqual(lauf.pruefhakenSync, 1, "„Offene Wegenden“ wird EINMAL neu gezeichnet");
	assert.strictEqual(lauf.route, 1, "und die Route EINMAL neu angefragt -- weil EINE der fuenf Anforderungen sie wollte");
	assert.strictEqual(lauf.wege, 1, "die Wege EINMAL");
	assert.strictEqual(lauf.orte, 1, "die Orte EINMAL");
	assert.deepStrictEqual(lauf.ortsnamen, [null], "die Ortsnamen EINMAL");
	assert.strictEqual(lauf.wegnamen, 1, "die Wegnamen EINMAL");
	wegpunkte = [];
}

{
	// Ohne Route-Wunsch keine Routenanfrage, auch nicht gesammelt.
	nullen();
	wegpunkte = ["Gareth", "Perricum"];
	avesmapsSammelabgleich(() => {
		refreshPlannerAfterFeatureChange();
		refreshPlannerAfterFeatureChange({ updateRoute: false });
	});
	assert.strictEqual(lauf.route, 0, "keine der Anforderungen wollte eine Route -- es wird keine angefragt");
	wegpunkte = [];
}

{
	// ⚠️ Die Ortsnamen mit MITGEGEBENEM Kontext laufen sofort: der Orts-Abgleich reicht seinen frischen
	// herein und wendet ihn sofort an.
	nullen();
	const kontext = { frisch: true };
	avesmapsSammelabgleich(() => {
		syncLocationNameLabelVisibility(kontext);
		assert.deepStrictEqual(lauf.ortsnamen, [kontext], "mit Kontext sofort, nicht vorgemerkt");
	});
}

// --- 3. Der Live-Abgleich sammelt ueber ALLE Objekte eines Deltas ---------------------------------
{
	nullen();
	ablaufLog.length = 0;
	wegpunkte = ["Gareth", "Perricum"];
	const eingespielt = [];
	globalThis.IS_EDIT_MODE = true;
	globalThis.MAP_FEATURES_API_URL = "https://avesmaps.test/api/app/map-features.php";
	globalThis.MAP_REVISION_API_URL = "https://avesmaps.test/api/app/map-revision.php";
	globalThis.isLiveMapUpdatePending = false;
	globalThis.mapDataSourceStatus = { revision: 10 };
	globalThis.document = { hidden: false };
	globalThis.location = { href: "https://avesmaps.test/?edit=1" };
	globalThis.avesmapsLiveSyncShouldSkipDelta = () => false;
	globalThis.apiErrorMessage = (d, t) => t;
	globalThis.loadChangeLog = () => Promise.resolve();
	globalThis.showFeedbackToast = () => {};
	globalThis.updateMapDataStatus = () => {};
	const antwort = (daten) => Promise.resolve({ ok: true, json: () => Promise.resolve(daten) });
	globalThis.fetch = (url) => (String(url).includes("map-revision")
		? antwort({ ok: true, revision: 13 })
		: antwort({ ok: true, revision: 13, features: [{ id: "a" }, { id: "b" }, { id: "c" }] }));
	// So spielt der echte Dispatcher ein Objekt ein: Wege, Orte, Planer -- je Objekt.
	globalThis.applyLiveMapFeatureUpdate = (feature) => {
		eingespielt.push(feature.id);
		syncPathVisibility();
		syncLocationMarkerVisibility();
		refreshPlannerAfterFeatureChange({ updateRoute: false });
	};
	lade("js/routing/routing.js", ["pollLiveMapUpdates"]);
	const warnung = console.warn;
	const warnungen = [];
	console.warn = (...a) => warnungen.push(a.join(" "));
	(async () => {
		try {
			await pollLiveMapUpdates();
		} finally {
			console.warn = warnung;
		}
		assert.deepStrictEqual(warnungen, [], "der Live-Abgleich lief ohne Fehler durch");
		assert.deepStrictEqual(eingespielt, ["a", "b", "c"], "alle drei Objekte eingespielt");
		assert.strictEqual(lauf.wege, 1, "die Wege EINMAL fuer drei Objekte (vorher dreimal)");
		assert.strictEqual(lauf.orte, 1, "die Orte EINMAL");
		assert.strictEqual(lauf.autocomplete, 1, "die Planer-Auffrischung EINMAL (vorher viermal)");
		assert.strictEqual(lauf.route, 1, "und die Route EINMAL -- der Abschluss des Live-Abgleichs will sie");
		assert.strictEqual(globalThis.mapDataSourceStatus.revision, 13, "die Revision ist nachgezogen");
		wegpunkte = [];

		// --- 4. Weg teilen: fuenf Schritte, EIN Abgleich, das Popup danach -----------------------------
		nullen();
		ablaufLog.length = 0;
		const weg = { id: "w1", geometry: { coordinates: [[0, 0], [1, 1], [2, 2]] } };
		globalThis.pathData = [weg];
		globalThis.locationData = [];
		globalThis.locationMarkers = [];
		globalThis.activePathGeometryEdit = null;
		globalThis.getPathPublicId = (p) => p.id;
		globalThis.getPathSplitCoordinateGroups = () => ({ firstCoordinates: [], secondCoordinates: [] });
		globalThis.submitMapFeatureEdit = () => Promise.resolve({ feature: {
			paths: [{ id: "w1a" }, { id: "w1b" }],
			crossing: { public_id: "x1", lat: 1, lng: 1 },
		} });
		globalThis.clearPathGeometryEdit = () => {};
		globalThis.updateRevisionFromEditResponse = () => {};
		globalThis.removePathFeature = () => refreshPlannerAfterFeatureChange({ updateRoute: true });
		globalThis.addCreatedPathFeature = () => {
			syncPathVisibility();
			refreshPlannerAfterFeatureChange({ updateRoute: true });
		};
		globalThis.getNextCrossingDisplayName = () => "Kreuzung-1";
		globalThis.CROSSING_LOCATION_TYPE = "crossing";
		globalThis.tr = (k, t) => t;
		globalThis.createEditablePointMarkerEntry = (location) => ({
			location,
			marker: { openPopup: () => ablaufLog.push("popup") },
		});
		globalThis.$ = () => ({ prop: () => {} });
		lade("js/map-features/map-features-location-editing.js", ["addCreatedCrossingMarker", "ensureCrossingsEnabled"]);
		lade("js/map-features/map-features-path-geometry-editing.js", ["splitPathAtNode"]);

		await splitPathAtNode({ path: weg, nodeIndex: 1 });
		assert.strictEqual(lauf.wege, 1, "Weg teilen: die Wege EINMAL (vorher dreimal)");
		assert.strictEqual(lauf.orte, 1, "die Orte EINMAL (vorher zweimal)");
		assert.strictEqual(lauf.autocomplete, 1, "die Planer-Auffrischung EINMAL (vorher viermal)");
		// 💣 Das Popup der neuen Kreuzung oeffnet sich erst, wenn der Marker auf der Karte steht -- an
		// einem Marker ohne Karte steigt Leaflet still aus, und das Popup bliebe einfach zu.
		assert.deepStrictEqual(ablaufLog, ["orte", "wege", "popup"],
			"das Popup der neuen Kreuzung oeffnet sich NACH dem Orts-Abgleich");

		// Ausserhalb eines Sammelabgleichs oeffnet es sich wie bisher sofort (Kreuzung setzen per Klick).
		ablaufLog.length = 0;
		addCreatedCrossingMarker({ public_id: "x2", lat: 2, lng: 2 });
		assert.deepStrictEqual(ablaufLog, ["orte", "popup"], "einzeln: Orts-Abgleich, dann sofort das Popup");

		// --- 5. Eine geaenderte Weggeometrie zeichnet die Wegnamen ueber denselben Weg ----------------
		// updatePathLayerGeometry zeichnete die Wegnamen-Leinwand je Weg voll neu (0,2 s je Weg).
		nullen();
		globalThis.getPathVisualLatLngCoordinates = (k) => k;
		globalThis.getPathLabelVisualLatLngCoordinates = (k) => k;
		globalThis.getReadablePathLabelLatLngCoordinates = (k) => k;
		lade("js/map-features/map-features-path-rendering.js", ["updatePathLayerGeometry"]);
		const neuerWeg = () => ({ geometry: { coordinates: [[0, 0], [1, 1]] }, _pathLines: [{ setLatLngs() {} }], _pathLabelLine: { setLatLngs() {} } });
		updatePathLayerGeometry(neuerWeg());
		assert.strictEqual(lauf.wegnamen, 1, "einzeln: die Wegnamen sofort, wie bisher");
		nullen();
		avesmapsSammelabgleich(() => {
			updatePathLayerGeometry(neuerWeg());
			updatePathLayerGeometry(neuerWeg());
			updatePathLayerGeometry(neuerWeg());
			assert.strictEqual(lauf.wegnamen, 0, "gesammelt: noch nichts gezeichnet");
		});
		assert.strictEqual(lauf.wegnamen, 1, "drei geaenderte Wege, EINMAL die Wegnamen");

		// --- 6. Der Orts-Abgleich erledigt die vorgemerkten Ortsnamen mit -----------------------------
		// Der ECHTE Rumpf von syncLocationMarkerVisibilityJetzt (ohne Marker, damit er ohne Leaflet laeuft):
		// er zieht die Ortsnamen mit seinem frischen Kontext nach -- ein vorgemerkter Ortsnamen-Abgleich
		// danach waere dieselbe Arbeit noch einmal.
		nullen();
		const frischerKontext = { frisch: true };
		globalThis.syncLocationToggleButtons = () => {};
		globalThis.map = { getZoom: () => 5 };
		globalThis.getMapRenderBounds = () => null;
		globalThis.createLocationVisibilityContext = () => frischerKontext;
		globalThis.LOCATION_CANVAS_MARKERS_ENABLED = false;
		globalThis.locationMarkers = [];
		globalThis.$ = Object.assign(() => ({ prop: () => {} }), { each: (liste, fn) => liste.forEach((wert, i) => fn(i, wert)) });
		lade("js/map-features/map-features-location-marker-rendering.js", ["syncLocationMarkerVisibilityJetzt"]);
		avesmapsSammelabgleich(() => {
			syncLocationNameLabelVisibility();
			syncLocationMarkerVisibility();
		});
		assert.deepStrictEqual(lauf.ortsnamen, [frischerKontext],
			"die Ortsnamen laufen EINMAL -- mit dem Kontext des Orts-Abgleichs, nicht noch einmal danach");

		console.log("sammelabgleich tests passed");
	})().catch((fehler) => {
		console.error(fehler);
		process.exit(1);
	});
}

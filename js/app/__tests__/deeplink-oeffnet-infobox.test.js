// Ein Deep-Link oeffnet die Infobox -- nicht nur die Stelle.
//
// Owner 14.09.2026: „wär schön, wenn das ging". Befund davor, live gemessen:
//   - ?place=<Gareth> sprang zu Gareth, aber das Infopanel blieb zu. applyPlaceFocusFromUrl
//     (js/routing/routing.js) hatte eine EIGENE Fassung des Fokus und rief am Ende
//     `marker.openPopup()` -- im Infopanel-Modus, der Vorgabe, oeffnet das nichts.
//   - ?place=<Altenforst-Label> ebenso (focusSharedLabelFromUrl, dieselbe Bauart).
//   - ?region=Altenforst traf das Label im Browser NIE: der Abgleich las `label.wikiUrl`, das es
//     nicht gibt (der Artikel steht in label.wikiRegion.wiki_url) -- 0 von 661 Beschriftungen.
//     Jeder solche Link wartete auf map-search und nahm, was der Server zuerst nannte.
//   - focusSpotlightLabel trug noch das Tor labelHasWikiRegion, das der Kartenklick laengst nicht
//     mehr hat -- eine Beschriftung ohne Wiki-Artikel liess sich ueber ihren eigenen ?place=-Link
//     nicht oeffnen.
//
// ⭐ Geprueft wird der ABLAUF, nicht der Quelltext: die echten Dateien laufen in einem vm-Kontext --
// wiki-deeplink.js, spotlight-search.js, spotlight-search-focus.js, das ECHTE Infopanel-Modul
// (map-features-infopanel.js) und die echten Funktionen applyPlaceFocusFromUrl (routing.js) und
// openLocationPopupForMarkerEntry (map-features-location-lookup.js), herausgeschnitten und
// ausgefuehrt. Gefaelscht sind nur Leaflet, das DOM und die zwei Markup-Bauer; ob das Panel am Ende
// OFFEN ist, entscheidet das echte Modul an seiner eigenen Klasse `is-hidden`.
// ⚠️ Die Dateien werden relativ zum Arbeitsverzeichnis gelesen (wie die Nachbartests) -- der Lauf
// geht vom Repo-Wurzelverzeichnis aus.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

const lies = (relPfad) => fs.readFileSync(relPfad, "utf8");

// Eine Funktion samt Rumpf aus einer Quelldatei schneiden. Die Klammerzaehlung ueberspringt
// Kommentare und Zeichenketten -- ein `{` in einem Kommentar oder ein `{ pan = true } = {}` in der
// Parameterliste darf den Rumpf nicht verschieben.
function schneideFunktion(quelle, name) {
	const start = quelle.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `function ${name} nicht gefunden`);
	let i = quelle.indexOf("(", start);
	let tiefe = 0;
	for (; i < quelle.length; i += 1) {
		if (quelle[i] === "(") tiefe += 1;
		else if (quelle[i] === ")") {
			tiefe -= 1;
			if (tiefe === 0) break;
		}
	}
	i = quelle.indexOf("{", i);
	tiefe = 0;
	for (; i < quelle.length; i += 1) {
		const z = quelle[i];
		const n = quelle[i + 1];
		if (z === "/" && n === "/") { i = quelle.indexOf("\n", i); continue; }
		if (z === "/" && n === "*") { i = quelle.indexOf("*/", i) + 1; continue; }
		if (z === "\"" || z === "'" || z === "`") {
			for (i += 1; i < quelle.length && quelle[i] !== z; i += 1) {
				if (quelle[i] === "\\") i += 1;
			}
			continue;
		}
		if (z === "{") tiefe += 1;
		else if (z === "}") {
			tiefe -= 1;
			if (tiefe === 0) return quelle.slice(start, i + 1);
		}
	}
	throw new Error(`Rumpf von ${name} nicht geschlossen`);
}

// Ein DOM-Element, gerade genug fuer das Infopanel-Modul und die Suche.
class FakeElement {
	constructor(tag) {
		this.tagName = String(tag || "div").toUpperCase();
		this.children = [];
		this.style = { setProperty() {} };
		this.attributes = {};
		this.dataset = {};
		this.klassen = new Set();
		this.innerHTML = "";
		this.textContent = "";
		this.value = "";
		this.hidden = false;
		this.scrollTop = 0;
		this.scrollLeft = 0;
	}
	get className() { return [...this.klassen].join(" "); }
	set className(wert) { this.klassen = new Set(String(wert).split(/\s+/).filter(Boolean)); }
	get classList() {
		const k = this.klassen;
		return {
			add: (...namen) => namen.forEach((x) => k.add(x)),
			remove: (...namen) => namen.forEach((x) => k.delete(x)),
			contains: (x) => k.has(x),
			toggle: (x, erzwingen) => {
				const an = erzwingen === undefined ? !k.has(x) : Boolean(erzwingen);
				if (an) k.add(x); else k.delete(x);
				return an;
			},
		};
	}
	setAttribute(k, v) { this.attributes[k] = String(v); }
	getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
	removeAttribute(k) { delete this.attributes[k]; }
	appendChild(kind) { this.children.push(kind); return kind; }
	insertBefore(kind) { this.children.unshift(kind); return kind; }
	removeChild() {}
	addEventListener() {}
	removeEventListener() {}
	querySelector() { return null; }
	querySelectorAll() { return []; }
	closest() { return null; }
	focus() {}
	blur() {}
	scrollBy() {}
	getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

function marker(lat, lng) {
	return { getLatLng: () => ({ lat, lng }), openPopup() {}, getPopup: () => null };
}

// Die Welt der Karte: ein Ort mit Wiki-Artikel, eine Kreuzung (steht NICHT im Suchindex), ein
// Landschaftslabel mit Wiki-Artikel und eines ohne.
function bauWelt() {
	const gareth = {
		publicId: "ort-gareth",
		name: "Gareth",
		locationType: "metropole",
		locationTypeLabel: "Metropole",
		location: { publicId: "ort-gareth", name: "Gareth", coordinates: [532.969, 551.625], wikiUrl: "https://de.wiki-aventurica.de/wiki/Gareth" },
		marker: marker(532.969, 551.625),
	};
	const kreuzung = {
		publicId: "kreuzung-7",
		name: "Kreuzung-7",
		locationType: "dorf",
		location: { publicId: "kreuzung-7", name: "Kreuzung-7", coordinates: [400, 410], placeKind: "crossing" },
		marker: marker(400, 410),
	};
	const altenforst = {
		label: {
			publicId: "label-altenforst",
			text: "Altenforst",
			labelType: "urwald",
			coordinates: [661.063, 627],
			minZoom: 3,
			maxZoom: 7,
			wikiRegion: { wiki_key: "altenforst", name: "Altenforst", wiki_url: "https://de.wiki-aventurica.de/wiki/Altenforst" },
		},
		marker: marker(661.063, 627),
	};
	const cronwald = {
		label: { publicId: "label-cronwald", text: "Cronwald", labelType: "wald", coordinates: [500, 400], minZoom: 2, maxZoom: 7 },
		marker: marker(500, 400),
	};
	return { gareth, kreuzung, altenforst, cronwald };
}

function bauKontext({ placeId = "", suche = "" } = {}) {
	const welt = bauWelt();
	const protokoll = { fluege: [], ebenen: [], toasts: [], abrufe: 0 };
	const timer = [];
	const elementeNachId = new Map();
	const body = new FakeElement("body");

	const kontext = {
		console,
		URL,
		URLSearchParams,
		Promise,
		Map,
		Set,
		// Zeit und Zeitgeber unter Kontrolle des Tests.
		setTimeout: (fn) => { timer.push(fn); return timer.length; },
		clearTimeout() {},
		setInterval: () => 0,
		clearInterval() {},
		fetch: () => { protokoll.abrufe += 1; return new Promise(() => {}); },
	};
	kontext.window = kontext;
	kontext.globalThis = kontext;
	kontext.addEventListener = () => {};
	kontext.removeEventListener = () => {};
	kontext.Element = FakeElement;
	kontext.location = { href: `https://avesmaps.de/${suche ? "?" + suche : ""}`, search: suche ? "?" + suche : "", pathname: "/", origin: "https://avesmaps.de" };
	kontext.document = {
		body,
		documentElement: new FakeElement("html"),
		activeElement: null,
		readyState: "complete",
		createElement: (tag) => new FakeElement(tag),
		createElementNS: (ns, tag) => new FakeElement(tag),
		getElementById: (id) => {
			if (id === "waypoints") return null;
			if (!elementeNachId.has(id)) {
				const el = new FakeElement("div");
				el.id = id;
				el.hidden = true;
				elementeNachId.set(id, el);
			}
			return elementeNachId.get(id);
		},
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener() {},
	};

	// Leaflet, gerade genug.
	kontext.L = {
		latLng: (a, b) => (Array.isArray(a) ? { lat: a[0], lng: a[1] } : (typeof a === "object" && a ? { lat: a.lat, lng: a.lng } : { lat: a, lng: b })),
		latLngBounds: () => ({ isValid: () => false }),
		layerGroup: () => ({ getLayers: () => [], addTo() {}, eachLayer() {} }),
		point: (x, y) => ({ x, y }),
	};
	kontext.map = {
		flyTo: (ziel, zoom) => protokoll.fluege.push({ lat: ziel.lat, lng: ziel.lng, zoom }),
		flyToBounds() {},
		setView() {},
		panTo() {},
		getZoom: () => 3,
		getMaxZoom: () => 7,
		getBoundsZoom: () => 4,
		hasLayer: () => false,
		addLayer() {},
		removeLayer() {},
		openPopup() {},
		on() {},
		off() {},
		getContainer: () => new FakeElement("div"),
		dragging: { moved: () => false },
	};

	// Die Karte, wie routing.js sie nach der Hydrierung hinterlaesst.
	kontext.IS_INFOPANEL_MODE = true;
	kontext.IS_EDIT_MODE = false;
	kontext.VISUAL_MAX_ZOOM_LEVEL = 5;
	kontext.MAP_SEARCH_API_URL = "/api/app/map-search.php";
	kontext.INITIAL_SEARCH_PARAMS = new URLSearchParams(suche);
	kontext.PLACE_FOCUS_PUBLIC_ID = placeId;
	kontext.locationMarkers = [welt.gareth, welt.kreuzung];
	kontext.labelMarkers = [welt.altenforst, welt.cronwald];
	kontext.regionPolygons = [];
	kontext.pathData = [];
	kontext.powerlineData = [];
	kontext.LOCATION_TYPE_CONFIG = {};
	kontext.tr = (schluessel, rueckfall) => rueckfall;
	kontext.avesmapsLabelArtName = (art) => art;
	kontext.isCrossingLocation = (location) => location?.placeKind === "crossing";
	kontext.findLocationMarkerByPublicId = (id) => kontext.locationMarkers.find((e) => e.publicId === id) || null;
	kontext.avesmapsLocationZoomBandMinZoom = () => 4;
	kontext.setSelectedMapLayerMode = (modus) => protokoll.ebenen.push(modus);
	kontext.syncLabelVisibility = () => {};
	kontext.syncPlannerStateToUrl = () => {};
	kontext.syncModalDialogBodyState = () => {};
	kontext.showFeedbackToast = (text, art) => protokoll.toasts.push({ text, art });
	kontext.clearNearestLookupPinnedMarker = () => {};
	// Die zwei Markup-Bauer: sie schreiben den NAMEN, damit der Test den Inhalt pruefen kann.
	kontext.buildLocationMarkerPopupHtml = (markerEntry) => `<h2 class="probe">${markerEntry.name}</h2>`;
	kontext.buildRegionLabelViewPopupHtml = (label) => `<h2 class="probe">${label.text}</h2>`;

	vm.createContext(kontext);
	vm.runInContext(lies("js/app/wiki-deeplink.js"), kontext);
	vm.runInContext(lies("js/ui/spotlight-search.js"), kontext);
	vm.runInContext(lies("js/ui/spotlight-search-focus.js"), kontext);
	vm.runInContext(lies("js/map-features/map-features-infopanel.js"), kontext);
	vm.runInContext(schneideFunktion(lies("js/map-features/map-features-location-lookup.js"), "openLocationPopupForMarkerEntry"), kontext);
	vm.runInContext(schneideFunktion(lies("js/routing/routing.js"), "applyPlaceFocusFromUrl"), kontext);

	const panel = body.children.find((kind) => kind.klassen && kind.klassen.has("avesmaps-infopanel"));
	assert.ok(panel, "das Infopanel-Modul hat sein Panel angelegt");
	const panelBody = panel.children.find((kind) => kind.klassen.has("avesmaps-infopanel__body"));

	const abarbeiten = () => {
		for (let runde = 0; timer.length && runde < 50; runde += 1) {
			timer.shift()();
		}
	};
	const zustand = () => ({ offen: !panel.klassen.has("is-hidden"), inhalt: panelBody.innerHTML });
	return { kontext, welt, protokoll, abarbeiten, zustand };
}

// ---- 0. Vorbedingung: ohne Deep-Link ist das Panel zu -------------------------------------------
{
	const { kontext, abarbeiten, zustand } = bauKontext();
	kontext.applyPlaceFocusFromUrl();
	kontext.applyWikiDeeplinkFromUrl();
	abarbeiten();
	assert.strictEqual(zustand().offen, false, "ohne Deep-Link bleibt das Panel zu -- sonst beweisen die Faelle unten nichts");
	zaehl();
}

// ---- 1. ?place=<Ort> fliegt hin UND oeffnet die Infobox ------------------------------------------
{
	const { kontext, protokoll, abarbeiten, zustand } = bauKontext({ placeId: "ort-gareth", suche: "place=ort-gareth" });
	kontext.applyPlaceFocusFromUrl();
	abarbeiten();
	assert.deepStrictEqual(zustand(), { offen: true, inhalt: '<h2 class="probe">Gareth</h2>' },
		"?place=<Ort> oeffnet das Panel mit der Infobox des Orts");
	zaehl();
	assert.strictEqual(protokoll.fluege.length, 1, "genau ein Flug");
	// Zoom 5: getSpotlightLocationZoom -- max(Erscheinungsstufe des Namens, VISUAL_MAX_ZOOM_LEVEL). Dieselbe
	// Zahl wie bei einem Suchtreffer und bei ?siedlung=; die alte eigene Fassung sprang auf max(Zoom, 4).
	assert.deepStrictEqual({ ...protokoll.fluege[0] }, { lat: 532.969, lng: 551.625, zoom: 5 },
		"der Flug geht zum Ort, auf dieselbe Stufe wie ein Suchtreffer");
	zaehl();
	// ⚠️ Dass die Adresse stehen bleibt, prueft dieser Test bewusst NICHT: syncPlannerStateToUrl kehrt
	// ausserhalb des Bearbeiten-Modus sofort zurueck und fasst history nie an, und der Merker
	// isWikiDeeplinkUrlSyncSuppressed hat im Produktivcode keinen Leser. Eine Zusicherung darauf hielte
	// toten Code fest, kein Verhalten -- ein Pruefagent hat genau das am 14.09.2026 per Mutation belegt.
	assert.strictEqual(vm.runInContext("spotlightActiveSelectionId", kontext), "location:ort-gareth",
		"die Auswahl traegt die Kennung des Suchtreffers -- ein Ort, eine Auswahl, egal ob per Link oder Suche");
	zaehl();
	assert.strictEqual(protokoll.toasts.length, 0, "kein Hinweis, wenn der Ort gefunden wurde");
	zaehl();
}

// ---- 2. ?place=<Beschriftung OHNE Wiki-Artikel> oeffnet die Infobox ------------------------------
// Genau diese Beschriftungen bekommen einen ?place=-Link (buildShareLinkPath) -- und genau sie hielt
// das Tor labelHasWikiRegion in focusSpotlightLabel zu.
{
	const { kontext, protokoll, abarbeiten, zustand } = bauKontext({ placeId: "label-cronwald", suche: "place=label-cronwald" });
	kontext.labelHasWikiRegion = (label) => Boolean(label && label.wikiRegion && label.wikiRegion.wiki_key);
	kontext.applyPlaceFocusFromUrl();
	abarbeiten();
	assert.deepStrictEqual(zustand(), { offen: true, inhalt: '<h2 class="probe">Cronwald</h2>' },
		"?place=<Beschriftung ohne Wiki> oeffnet das Panel -- dieselbe Regel wie beim Kartenklick (Spec §5.2)");
	zaehl();
	assert.deepStrictEqual({ ...protokoll.fluege[0] }, { lat: 500, lng: 400, zoom: 5 }, "der Flug geht zur Beschriftung");
	assert.deepStrictEqual([...protokoll.ebenen], ["deregraphic"], "und schaltet auf die Ebene, in der sie gezeichnet wird");
	zaehl();
}

// ---- 3. ?place=<Beschriftung MIT Wiki-Artikel> ----------------------------------------------------
{
	const { kontext, abarbeiten, zustand } = bauKontext({ placeId: "label-altenforst", suche: "place=label-altenforst" });
	kontext.applyPlaceFocusFromUrl();
	abarbeiten();
	assert.deepStrictEqual(zustand(), { offen: true, inhalt: '<h2 class="probe">Altenforst</h2>' },
		"?place=<Altenforst-Label> oeffnet das Panel");
	zaehl();
}

// ---- 4. ?place=<Kreuzung>: nicht im Suchindex, aber ein Ort ---------------------------------------
{
	const { kontext, abarbeiten, zustand } = bauKontext({ placeId: "kreuzung-7", suche: "place=kreuzung-7" });
	assert.strictEqual(vm.runInContext("getSpotlightSearchLookup().byPublicId.has('location:kreuzung-7')", kontext), false,
		"Vorbedingung: die Kreuzung steht wirklich nicht im Suchindex");
	zaehl();
	kontext.applyPlaceFocusFromUrl();
	abarbeiten();
	assert.deepStrictEqual(zustand(), { offen: true, inhalt: '<h2 class="probe">Kreuzung-7</h2>' },
		"eine Kreuzung oeffnet ueber den Marker-Rueckfall trotzdem");
	zaehl();
}

// ---- 5. ?place=<unbekannt>: Hinweis statt Stille ---------------------------------------------------
{
	const { kontext, protokoll, abarbeiten, zustand } = bauKontext({ placeId: "gibt-es-nicht", suche: "place=gibt-es-nicht" });
	kontext.applyPlaceFocusFromUrl();
	abarbeiten();
	assert.strictEqual(zustand().offen, false, "nichts gefunden -- nichts geoeffnet");
	assert.strictEqual(protokoll.fluege.length, 0, "und nirgendwohin geflogen");
	assert.strictEqual(protokoll.toasts.length, 1, "aber ein Hinweis, statt still nichts zu tun");
	zaehl();
}

// ---- 6. ?region=Altenforst trifft im Browser, OHNE Serverabruf ------------------------------------
{
	const { kontext, protokoll, abarbeiten, zustand } = bauKontext({ suche: "region=Altenforst" });
	kontext.applyWikiDeeplinkFromUrl();
	abarbeiten();
	assert.strictEqual(protokoll.abrufe, 0,
		"die Beschriftung wird am GELADENEN Wiki-Artikel erkannt (label.wikiRegion.wiki_url) -- kein Umweg ueber map-search");
	zaehl();
	assert.deepStrictEqual(zustand(), { offen: true, inhalt: '<h2 class="probe">Altenforst</h2>' },
		"?region=Altenforst oeffnet das Panel mit der Landschaft");
	zaehl();
	assert.deepStrictEqual({ ...protokoll.fluege[0] }, { lat: 661.063, lng: 627, zoom: 5 }, "und fliegt zu ihr");
	zaehl();
}

// ---- 7. ?siedlung=Gareth: der bestehende Weg bleibt heil -------------------------------------------
{
	const { kontext, protokoll, abarbeiten, zustand } = bauKontext({ suche: "siedlung=Gareth" });
	kontext.applyWikiDeeplinkFromUrl();
	abarbeiten();
	assert.strictEqual(protokoll.abrufe, 0, "Gareth wird im Browser erkannt");
	assert.deepStrictEqual(zustand(), { offen: true, inhalt: '<h2 class="probe">Gareth</h2>' }, "?siedlung=Gareth oeffnet das Panel");
	zaehl();
}

// ---- 8. Kein eigener Fokus mehr in routing.js -----------------------------------------------------
// Eine zweite Fassung neben dem Trichter ist genau das, was hier kaputt war. Der Test oben faengt
// sie im Ablauf; diese Zeile nennt sie beim Namen, falls jemand sie „als Rueckfall" zurueckholt.
// 🪤 KEIN Blockkommentar-Entferner ueber die ganze Datei: routing.js traegt `/*` in Zeichenketten, und ein
// `/\/\*[\s\S]*?\*\//` frisst von dort bis zum naechsten `*/` echten Code -- samt dieser Funktion (beim Bau
// genau so passiert). Geschnitten wird mit schneideFunktion, die Kommentare und Zeichenketten kennt; danach
// fallen nur noch Zeilenkommentare, weil der Kommentar ueber dem Rumpf das alte `marker.openPopup()` nennt.
{
	const routing = lies("js/routing/routing.js");
	const ohneZeilenkommentare = (text) => text.replace(/^[ \t]*\/\/.*$/gm, "");
	assert.ok(!/function\s+focusSharedLabelFromUrl\s*\(/.test(routing),
		"focusSharedLabelFromUrl ist wieder da -- ein ?place= fuer Beschriftungen gehoert durch selectSpotlightSearchEntry");
	const rumpf = ohneZeilenkommentare(schneideFunktion(routing, "applyPlaceFocusFromUrl"));
	assert.ok(!/\.openPopup\s*\(/.test(rumpf),
		"applyPlaceFocusFromUrl ruft wieder marker.openPopup() -- das oeffnet im Infopanel-Modus nichts");
	zaehl();
}

console.log("deeplink-oeffnet-infobox.test.js: " + pruefungen + " Zusicherungen erfuellt");

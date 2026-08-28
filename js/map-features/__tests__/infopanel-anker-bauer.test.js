// Ein Panel-Inhalt, der als BAUER hereinkommt, kann sich auffrischen -- einer als fertiger Text nie.
//
// 💣 DER BEFUND (Owner 28.08.2026): eine im Editor gerade hinzugefuegte Quelle erschien in der
// Infobox der Beschriftung nicht. Ein Teil davon war der Speicher der Karte
// (js/review/__tests__/quellen-sofort-sichtbar.test.js), der andere DIESER:
// `avesmapsShowInfopanel` setzt bei jedem Inhaltswechsel `lastPanelRender = null`, und nur die
// Show-*-Funktionen setzten den Anker danach wieder. Die Beschriftung ruft `avesmapsShowInfopanel`
// DIREKT -- ihr Panel hatte also nie einen Anker, und `avesmapsRefreshInfopanel` gab bei ihr
// ausnahmslos sofort auf. Selbst mit frischen Daten haette sich nichts bewegt.
//
// ⭐ Der Bauer IST der Anker: hereingereicht wird eine Funktion, sie wird sofort gerufen (sie
// liefert den Inhalt) und behalten (sie ist die Anweisung, ihn neu zu bauen). Dasselbe Muster, mit
// dem Leaflet-Popups im Haus gebunden werden -- es zaehlt der Stand von JETZT.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/infopanel-anker-bauer.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

// ---- Ein Papier-DOM: nur die Handgriffe, die die Panel-IIFE beim Aufbau wirklich tut ----------
function macheKnoten(name) {
	const knoten = {
		nodeName: name,
		children: [],
		_klassen: new Set(),
		style: { setProperty() {}, removeProperty() {} },
		dataset: {},
		innerHTML: "",
		textContent: "",
		scrollTop: 0,
		scrollLeft: 0,
		offsetWidth: 100,
		scrollWidth: 100,
		clientWidth: 100,
		hidden: false,
		disabled: false,
		classList: {
			add(...k) { k.forEach((x) => knoten._klassen.add(x)); },
			remove(...k) { k.forEach((x) => knoten._klassen.delete(x)); },
			toggle(k, an) { if (an) { knoten._klassen.add(k); } else { knoten._klassen.delete(k); } },
			contains: (k) => knoten._klassen.has(k),
		},
		setAttribute() {},
		removeAttribute() {},
		getAttribute: () => null,
		appendChild(kind) { knoten.children.push(kind); return kind; },
		removeChild() {},
		insertBefore(kind) { knoten.children.push(kind); return kind; },
		addEventListener() {},
		removeEventListener() {},
		querySelector: () => null,
		querySelectorAll: () => [],
		closest: () => null,
		getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }),
		focus() {},
		scrollTo() {},
		contains: () => false,
	};
	return knoten;
}

function macheKontext() {
	const dokument = macheKnoten("#document");
	dokument.body = macheKnoten("body");
	dokument.documentElement = macheKnoten("html");
	dokument.createElement = (name) => macheKnoten(name);
	dokument.createElementNS = (ns, name) => macheKnoten(name);
	dokument.getElementById = () => null;
	dokument.querySelector = () => null;
	dokument.addEventListener = () => {};

	const fenster = {
		addEventListener() {},
		removeEventListener() {},
		setTimeout: (fn) => { fn(); return 0; },
		clearTimeout() {},
		requestAnimationFrame: (fn) => { fn(); return 0; },
		matchMedia: () => ({ matches: false, addEventListener() {} }),
		innerWidth: 1440,
		innerHeight: 900,
	};

	const context = {
		console,
		document: dokument,
		window: fenster,
		IS_INFOPANEL_MODE: true,
		IS_EDIT_MODE: false,
		setTimeout: fenster.setTimeout,
		clearTimeout() {},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(lies("js", "map-features", "map-features-infopanel.js"), context);
	assert.strictEqual(typeof fenster.avesmapsShowInfopanel, "function",
		"die Panel-IIFE muss im Papier-DOM wirklich durchgelaufen sein");
	return { context, fenster, body: fenster.avesmapsInfopanelBody() };
}

// ---- 1. Ein Bauer wird gerufen UND behalten ---------------------------------------------------
{
	const { fenster, body } = macheKontext();
	let baut = 0;
	const bauer = () => { baut += 1; return "<p>Stand " + baut + "</p>"; };

	fenster.avesmapsShowInfopanel(bauer, "Ceälan");
	assert.strictEqual(baut, 1, "der Bauer wird sofort gerufen -- er IST der Inhalt");
	zaehl();
	assert.strictEqual(body.innerHTML, "<p>Stand 1</p>");
	zaehl();

	fenster.avesmapsRefreshInfopanel();
	assert.strictEqual(baut, 2,
		"und er wird behalten: avesmapsRefreshInfopanel zeichnet mit IHM neu. Ohne den Anker gaebe "
		+ "der Refresh sofort auf -- genau daran hing die fehlende Quelle in der Label-Infobox.");
	zaehl();
	assert.strictEqual(body.innerHTML, "<p>Stand 2</p>",
		"neu gezeichnet wird der Stand von JETZT, nicht der vom ersten Oeffnen");
	zaehl();
}

// ---- 2. Ein fertiger Text hat weiterhin keinen Anker ------------------------------------------
// 🔴 Absicht, kein Versehen: ein Inhalt ohne eigenen Bauer (die Route) soll sich nicht in eine
// fremde Ansicht zurueckverwandeln. Der Kommentar an lastPanelRender sagt genau das.
{
	const { fenster, body } = macheKontext();
	fenster.avesmapsShowInfopanel("<p>fest</p>", "");
	fenster.avesmapsRefreshInfopanel();
	assert.strictEqual(body.innerHTML, "<p>fest</p>");
	zaehl();
}

// ---- 3. Ein Bauer, der nichts liefert, hinterlaesst KEINEN Anker ------------------------------
// 💣 Sonst zeichnete ein spaeterer Refresh ein geleertes Panel neu -- und riesse es dabei auf.
{
	const { fenster } = macheKontext();
	let baut = 0;
	fenster.avesmapsShowInfopanel(() => { baut += 1; return ""; }, "");
	fenster.avesmapsRefreshInfopanel();
	assert.strictEqual(baut, 1, "ein leerer Bauer wird genau einmal gerufen und nicht behalten");
	zaehl();
}

// ---- 4. Ein neuer Inhalt entwertet den alten Anker --------------------------------------------
// 💣 Die Reihenfolge im Code ist tragend: erst `lastPanelRender = null`, dann fuellen, dann den
// NEUEN Anker setzen. Wer ihn zu frueh setzt, loescht ihn im selben Aufruf wieder.
{
	const { fenster, body } = macheKontext();
	let alt = 0;
	fenster.avesmapsShowInfopanel(() => { alt += 1; return "<p>alt</p>"; }, "");
	fenster.avesmapsShowInfopanel("<p>neu</p>", "");
	fenster.avesmapsRefreshInfopanel();
	assert.strictEqual(alt, 1, "der Bauer des vorigen Inhalts darf nicht weiterleben");
	zaehl();
	assert.strictEqual(body.innerHTML, "<p>neu</p>");
	zaehl();
}

// ---- 5. Die Beschriftung reicht wirklich einen Bauer herein -----------------------------------
// Der Kartenklick und der Editor-Zweig liegen in createLabelMarker (Leaflet), der Spotlight-Fokus
// in focusSpotlightLabel. Alle drei bauen dasselbe Markup -- und alle drei muessen die FUNKTION
// reichen, nicht ihr Ergebnis. Ein Aufrufer, der es vergisst, faellt lautlos auf den Zustand von
// vorher zurueck: das Panel steht, nur frischt es nie auf.
{
	const ohneKommentare = (text) => text
		.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
	const quellen = [
		["js/map-features/map-features-labels.js", lies("js", "map-features", "map-features-labels.js")],
		["js/ui/spotlight-search-focus.js", lies("js", "ui", "spotlight-search-focus.js")],
	];
	let gefunden = 0;
	for (const [name, roh] of quellen) {
		const text = ohneKommentare(roh);
		const muster = /avesmapsShowInfopanel\(\s*(\(\s*\)\s*=>\s*)?buildRegionLabelViewPopupHtml/g;
		let treffer;
		while ((treffer = muster.exec(text)) !== null) {
			gefunden += 1;
			assert.ok(treffer[1],
				name + ": avesmapsShowInfopanel bekommt hier das ERGEBNIS von "
				+ "buildRegionLabelViewPopupHtml statt der Funktion -- dieses Panel kann sich dann nie "
				+ "auffrischen.");
			zaehl();
		}
	}
	assert.strictEqual(gefunden, 3,
		"es sind drei Stellen (Kartenklick, Editor-Popup, Spotlight-Fokus) -- gefunden: " + gefunden);
	zaehl();
}

console.log("infopanel-anker-bauer.test.js: " + pruefungen + " Zusicherungen erfuellt");

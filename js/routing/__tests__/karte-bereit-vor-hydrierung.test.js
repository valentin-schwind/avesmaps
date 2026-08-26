// Die Hydrierung der Kartendaten darf erst laufen, wenn die ECHTE Karte steht.
//
// 🔴 EINE LIVE-REGRESSION VOM 27.08.2026, und sie ist lehrreicher als ihr Umfang. routing.js laedt
// vor bootstrap.js, die Kartennutzlast brauchte aber 2,1-2,5 s -- bis die Antwort da war, stand die
// Karte laengst. An diesem Tag kamen zwei Beschleunigungen zusammen (Vorabruf im Kopf,
// Ganzkoerper-Dateicache), die Antwort traf nach 88 ms ein, und damit VOR bootstrap.js. Ergebnis:
// „TypeError: map.getZoom is not a function", die ganze .then-Kette brach ab, die Karte stand ohne
// Grenzen und ohne Wege.
// ⭐ Der Wettlauf war die ganze Zeit da. Gehalten hat ihn nur die LANGSAMKEIT.
//
// 💣 UND DIE FANGFRAGE STECKT IM NAMEN: `<div id="map">` legt `window.map` an -- HTML-Kennungen
// werden globale Variablen. Bis bootstrap.js ausgewertet ist, ist `map` deshalb NICHT undefiniert,
// sondern das DIV. Eine Pruefung `typeof map !== "undefined"` ist hier wirkungslos; genau daran hat
// sich der Fehler getarnt (die Meldung lautete nicht „map is not defined"). Dieser Test stellt
// deshalb ausdruecklich ein DIV-aehnliches Objekt hin, kein `undefined`.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/karte-bereit-vor-hydrierung.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: Arbeitskopie CRLF, Deploy-Tor LF.
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const routing = lies("js/routing/routing.js");

// --- Eine Umgebung, die den Ernstfall nachstellt -------------------------------------------------
let horcher = [];
global.document = {
	readyState: "loading",
	addEventListener(name, fn) { horcher.push({ name, fn }); },
};
// 🔴 DAS DIV, nicht undefined -- der Zustand, in dem der Fehler wirklich auftrat.
global.map = { nodeName: "DIV", id: "map" };

vm.runInThisContext(schnitt(routing, "function avesmapsKarteBereit", "}"));

(async () => {
	// --- 1) Solange nur das DIV da ist, wird NICHT hydriert --------------------------------------
	let aufgeloest = false;
	const warten = avesmapsKarteBereit().then(() => { aufgeloest = true; });
	await new Promise((r) => setTimeout(r, 20));
	assert.strictEqual(aufgeloest, false,
		"💣 Die Zusage loest auf, obwohl `map` noch das DIV ist -- genau der Live-Fehler.");
	assert.ok(horcher.some((h) => h.name === "DOMContentLoaded"),
		"Es wird nicht auf DOMContentLoaded gewartet.");

	// --- 2) Nach DOMContentLoaded geht es weiter --------------------------------------------------
	horcher.filter((h) => h.name === "DOMContentLoaded").forEach((h) => h.fn());
	await warten;
	assert.strictEqual(aufgeloest, true, "Nach DOMContentLoaded muss die Zusage aufloesen.");

	// --- 3) Steht die echte Karte schon, wird gar nicht gewartet ----------------------------------
	// Der Normalfall bei einer langsamen Antwort -- er darf keine Runde kosten.
	horcher = [];
	global.map = { getZoom: () => 3 };
	let sofort = false;
	await avesmapsKarteBereit().then(() => { sofort = true; });
	assert.strictEqual(sofort, true, "Mit fertiger Karte muss sofort aufgeloest werden.");
	assert.strictEqual(horcher.length, 0,
		"Mit fertiger Karte darf kein Horcher angemeldet werden.");

	// --- 4) Ein `map` im toten Bereich darf nicht durchschlagen -----------------------------------
	// (Eine globale lexikalische Bindung wirft beim Zugriff vor ihrer Auswertung.)
	horcher = [];
	Object.defineProperty(global, "map", {
		configurable: true,
		get() { throw new ReferenceError("Cannot access 'map' before initialization"); },
	});
	global.document.readyState = "loading";
	let nachTdz = false;
	const wartenTdz = avesmapsKarteBereit().then(() => { nachTdz = true; });
	await new Promise((r) => setTimeout(r, 20));
	assert.strictEqual(nachTdz, false, "Ein Wurf beim Zugriff auf `map` muss als „noch nicht da\" gelten.");
	horcher.filter((h) => h.name === "DOMContentLoaded").forEach((h) => h.fn());
	await wartenTdz;
	delete global.map;

	// --- 5) Und die Kette benutzt den Riegel wirklich ---------------------------------------------
	// 💣 Ohne diese Zusicherung koennte jemand die Funktion stehen lassen und den Aufruf entfernen --
	// der Riegel waere dann vorhanden und wirkungslos.
	const ohneKommentare = routing.split(ZE).filter((z) => !z.trim().startsWith("//")).join(ZE);
	assert.ok(/routeDataRequest\s*\n\s*\.then\(\(data\) => avesmapsKarteBereit\(\)\.then\(\(\) => data\)\)/
		.test(ohneKommentare),
		"💣 Die Hydrierungskette wartet nicht auf avesmapsKarteBereit().");
	// 🔴 Und der ABRUF selbst darf nicht mitwarten -- sonst waere der Vorabruf im Kopf aufgehoben.
	assert.ok(/const routeDataRequest = loadRouteData\(\);/.test(ohneKommentare),
		"🔴 loadRouteData() startet nicht mehr sofort -- die Beschleunigung waere zurueckgenommen.");

	console.log("OK: die Hydrierung wartet auf die echte Karte (DIV, TDZ, Normalfall, Verdrahtung).");
})().catch((fehler) => { console.error(fehler); process.exit(1); });

"use strict";
// Namensklick im Bearbeiten-Modus (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4). AUSGEFUEHRT: der Karten-Klick
// der Wege-Auswahl mit Attrappen, der Treffer-Ausgang und der Zeiger-Zuhoerer des Overlays aus dem Quelltext geschnitten.
// Aus der Wurzel: node js/map-features/__tests__/weg-namensklick.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt nicht gefunden: " + anfang);
	return text.slice(a, e + ende.length);
};

// ---- Aufbau wie weg-auswahl-karte.test.js --------------------------------------------------------------------
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const menue = { hidden: true };
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: true,
	activePathGeometryEdit: null,
	locationData: [],
	document: { getElementById: (id) => (id === "map-context-menu" ? menue : null) },
	window: {},
});
global.findPathByPublicId = (id) => global.pathData.find((p) => p.properties.public_id === id) || null;
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-auswahl.js")));
const K = require(path.join(WURZEL, "js/map-features/map-features-weg-auswahl.js"));
Object.assign(global, K);

const gefeuert = [];
const RS = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" };
const weg = (id, koordinaten) => {
	const pfad = {
		properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "Reichsstrasse-" + id, display_name: RS.name, wiki_path: RS },
		geometry: { coordinates: koordinaten },
	};
	// Die Mittellinie: `fire("click")` faehrt denselben Zuhoerer wie ein Linien-Klick (createPathLayer) -- hier sein Kern.
	pfad._pathLines = [{}, { fire: (typ, ereignis) => { gefeuert.push([id, typ, ereignis]); K.avesmapsWegAuswahlKlick(pfad); } }];
	return pfad;
};
global.pathData = [weg("rs-6", [[0, 0], [10, 0]]), weg("rs-7", [[10, 0], [20, 0]]), weg("rs-8", [[20, 0], [30, 0]])];
const [rs6, rs7, rs8] = global.pathData;

let treffer = { wikiKey: "reichsstrasse-2", name: "Reichsstraße 2" };
let werkzeug = false;
global.window.avesmapsWegNamenTreffer = () => treffer;
global.window.avesmapsKeyboardShortcuts = { toolActive: () => werkzeug };
const klick = (x, y) => ({ latlng: { lat: y, lng: x }, containerPoint: { x: 1, y: 1 }, layerPoint: { x: 1, y: 1 }, originalEvent: {} });

// ---- 1. Treffer: der NAECHSTE Abschnitt bekommt den Linien-Klick, mit dem Ereignis ---------------------------
K.avesmapsWegKartenKlick(klick(27, 2));
assert.strictEqual(gefeuert.length, 1);
assert.strictEqual(gefeuert[0][0], "rs-8", "der Abschnitt, der dem Klickpunkt am naechsten liegt -- latlng wird zu [x, y] gedreht");
assert.strictEqual(gefeuert[0][1], "click");
assert.deepStrictEqual(gefeuert[0][2].latlng, { lat: 2, lng: 27 });
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), { gruppe: "wiki:reichsstrasse-2", publicId: null }, "erster Klick: ganze Strasse");

// ---- 2. EIN Zuhoerer: der zweite Namensklick markiert den Abschnitt, derselbe Klick hebt nichts auf --------------
K.avesmapsWegKartenKlick(klick(27, 2));
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs8), { gruppe: "wiki:reichsstrasse-2", publicId: "rs-8" },
	"zweiter Klick: der Abschnitt -- mit zwei getrennten Zuhoerern haette das Aufheben ihn wieder auf „ganze Strasse“ geworfen");

// ---- 3. Kein Treffer: der Klick hebt auf -----------------------------------------------------------------------
treffer = null;
K.avesmapsWegKartenKlick(klick(27, 2));
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs8), null, "daneben geklickt: Markierung weg");
treffer = { wikiKey: "reichsstrasse-2" };

// ---- 4. Die Riegel ----------------------------------------------------------------------------------------------
const ohneFeuer = (grund, vorbereiten, aufraeumen) => {
	gefeuert.length = 0;
	vorbereiten();
	K.avesmapsWegKartenKlick(klick(5, 1));
	aufraeumen();
	assert.strictEqual(gefeuert.length, 0, grund + ": kein Namensklick");
};
ohneFeuer("ein Werkzeug laeuft", () => { werkzeug = true; }, () => { werkzeug = false; });
ohneFeuer("der Wiki-Ziel-Pick laeuft", () => { global.window.__pathAssignPending = { wikiKey: "x" }; }, () => { global.window.__pathAssignPending = null; });
ohneFeuer("der Verlauf-Editor laeuft", () => { global.activePathGeometryEdit = { path: rs6 }; }, () => { global.activePathGeometryEdit = null; });
ohneFeuer("das Kontextmenue ist offen", () => { menue.hidden = false; }, () => { menue.hidden = true; });
const tastatur = global.window.avesmapsKeyboardShortcuts;
ohneFeuer("ohne Tastatur-Modul GESCHLOSSEN", () => { delete global.window.avesmapsKeyboardShortcuts; }, () => { global.window.avesmapsKeyboardShortcuts = tastatur; });
ohneFeuer("Besucher", () => { global.IS_EDIT_MODE = false; }, () => { global.IS_EDIT_MODE = true; });
ohneFeuer("Treffer ohne Wiki-Schluessel", () => { treffer = { name: "x" }; }, () => { treffer = { wikiKey: "reichsstrasse-2" }; });
gefeuert.length = 0;
K.avesmapsWegKartenKlick(klick(5, 1));
assert.strictEqual(gefeuert[0][0], "rs-6", "Gegenprobe: ohne Riegel wirkt der Namensklick");
K.avesmapsWegKartenKlick(undefined);
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), null, "ohne Ereignis (Aufruf ohne Argument) wird nur aufgehoben");

// ---- 5. Verdrahtung und die ECHTE Klickreihenfolge -----------------------------------------------------------------
// 💣 §4 prueft den Menue-Riegel nur isoliert und war damit falsch gruen: bootstrap.js:1160 meldet `closeMapContextMenu`
// als Karten-Klick-Zuhoerer an, lange BEVOR routing.js:611 (nach dem Datenladen) die Wege-Auswahl verdrahtet -- beim
// Lesen ist das Menue schon zu. Nachgestellt wie Leaflets _fireDOMEvent: erst `preclick`, dann die click-Zuhoerer in
// Anmeldereihenfolge.
const anmeldungen = [];
global.map = { on: (typ, fn) => { anmeldungen.push([typ, fn]); } };
K.avesmapsWegAuswahlVerdrahten();
const schliesseMenue = () => { menue.hidden = true; };   // closeMapContextMenu (bootstrap.js:1061)
const zuhoerer = (typ) => anmeldungen.filter((a) => a[0] === typ).map((a) => a[1]);
const leafletKlick = (ereignis, klickReihe) => {
	zuhoerer("preclick").forEach((fn) => fn(ereignis));
	klickReihe.forEach((fn) => fn(ereignis));
};
const frueh = () => [schliesseMenue, ...zuhoerer("click")];   // die echte Reihenfolge
const spaet = () => [...zuhoerer("click"), schliesseMenue];   // umgekehrt: der Riegel haengt an keiner Reihenfolge

K.avesmapsWegAuswahlAufheben();
gefeuert.length = 0;
menue.hidden = false;
leafletKlick(klick(5, 1), frueh());
assert.strictEqual(menue.hidden, true, "der Klick schliesst das Menue (bootstrap.js)");
assert.strictEqual(gefeuert.length, 0, "Menue beim Druecken offen: der Klick schliesst es und markiert NICHTS -- auch wenn closeMapContextMenu vorher lief");
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), null);

menue.hidden = false;
leafletKlick(klick(5, 1), spaet());
assert.strictEqual(gefeuert.length, 0, "umgekehrte Anmeldereihenfolge: ebenso nichts");

leafletKlick(klick(5, 1), frueh());
assert.strictEqual(gefeuert.length, 1, "Menue zu: derselbe Klick markiert wieder");
assert.strictEqual(gefeuert[0][0], "rs-6");

menue.hidden = false;
leafletKlick(klick(5, 1), frueh());
gefeuert.length = 0;
K.avesmapsWegKartenKlick(klick(5, 1));
assert.strictEqual(gefeuert.length, 1, "der Merker gilt EINEM Klick: ein Klick ohne preclick danach sperrt nicht das alte Menue");

assert.deepStrictEqual(anmeldungen.map((a) => a[0]), ["preclick", "click"]);
assert.strictEqual(zuhoerer("preclick")[0], K.avesmapsWegKartenVorKlick, "der preclick-Zuhoerer haelt fest, ob das Menue beim Druecken offen war");
assert.strictEqual(zuhoerer("click")[0], K.avesmapsWegKartenKlick, "der Karten-Klick-Zuhoerer ist avesmapsWegKartenKlick");

// ---- 6. Der Treffer-Ausgang des Overlays -------------------------------------------------------------------------
const overlay = lies("js/map-features/map-features-path-label-canvas-overlay.js");
const wegLabels = lies("js/map-features/map-features-way-labels.js");
const eintrag = { left: 0, top: 0, right: 100, bottom: 20, wikiKey: "reichsstrasse-2" };
const kurve = { left: 200, top: 0, right: 300, bottom: 20, label: {} };
const ov = vm.createContext({ window: {}, cssZoomActive: false, wayLabelsEnabled: true, wayLabelClickRegister: [eintrag] });
vm.runInContext(schneide(wegLabels, "function wayLabelHitTest(register, point) {", "\n}\n"), ov);
vm.runInContext(schneide(overlay, "window.avesmapsWegNamenTreffer = function (containerPoint) {", "\n\t};"), ov);
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 50, y: 10 }), eintrag);
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 250, y: 10 }), null);
ov.cssZoomActive = true;
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 50, y: 10 }), null, "waehrend der CSS-Zoom-Animation ist das Register veraltet");
ov.cssZoomActive = false;
ov.wayLabelsEnabled = false;
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 50, y: 10 }), null, "?waylabels=0");

// ---- 7. Der Hand-Zeiger ------------------------------------------------------------------------------------------
const behaelter = { style: { cursor: "" } };
let zeigerZuhoerer = null;
let werkzeugZeiger = false;
const zc = vm.createContext({
	IS_EDIT_MODE: true, cssZoomActive: false, labelCursorActive: false, labelCursorLastCheck: 0,
	wayLabelsEnabled: true, wayLabelClickRegister: [eintrag], kurvenlabelClickRegister: [kurve],
	avesmapsWegWerkzeugLaeuft: () => werkzeugZeiger, Date, Boolean,
	map: { on: (typ, fn) => { if (typ === "mousemove") { zeigerZuhoerer = fn; } }, getContainer: () => behaelter },
});
vm.runInContext(schneide(wegLabels, "function wayLabelHitTest(register, point) {", "\n}\n"), zc);
vm.runInContext(schneide(overlay, "\tmap.on(\"mousemove\", (event) => {", "\n\t});"), zc);
const bewege = (x) => { zc.labelCursorLastCheck = 0; zeigerZuhoerer({ containerPoint: { x: x, y: 10 } }); };
bewege(50);
assert.strictEqual(behaelter.style.cursor, "pointer", "Editor ueber einem Wegnamen: Hand");
bewege(250);
assert.strictEqual(behaelter.style.cursor, "", "Editor ueber einem Kurvenlabel: keine Hand -- die bleiben im Editor stumm");
bewege(50);
werkzeugZeiger = true;
bewege(50);
assert.strictEqual(behaelter.style.cursor, "", "ein Werkzeug startet: die stehengebliebene Hand wird zurueckgenommen");
assert.strictEqual(zc.labelCursorActive, false);
werkzeugZeiger = false;
zc.IS_EDIT_MODE = false;
bewege(250);
assert.strictEqual(behaelter.style.cursor, "pointer", "Besucher ueber einem Kurvenlabel: Hand wie bisher");

// ---- 7b. Die Werkzeugfrage steht HINTER der 100-ms-Drossel -------------------------------------------------------
zc.IS_EDIT_MODE = true;
let werkzeugFragen = 0;
zc.avesmapsWegWerkzeugLaeuft = () => { werkzeugFragen += 1; return werkzeugZeiger; };
bewege(50);
assert.strictEqual(werkzeugFragen, 1, "Drossel frei: einmal gefragt");
assert.strictEqual(behaelter.style.cursor, "pointer");
zc.labelCursorLastCheck = Date.now();
zeigerZuhoerer({ containerPoint: { x: 50, y: 10 } });
assert.strictEqual(werkzeugFragen, 1, "eine gedrosselte Mausbewegung fragt das Werkzeug nicht -- toolActive liest Klassen und das DOM");
// Waehrend der CSS-Zoom-Animation laeuft keine Drossel: dort nur gefragt, solange eine Hand steht.
zc.cssZoomActive = true;
werkzeugZeiger = true;
zeigerZuhoerer({ containerPoint: { x: 50, y: 10 } });
assert.strictEqual(behaelter.style.cursor, "", "Werkzeugstart mitten im Zoom: die Hand geht trotzdem");
const fragenImZoom = werkzeugFragen;
zeigerZuhoerer({ containerPoint: { x: 50, y: 10 } });
assert.strictEqual(werkzeugFragen, fragenImZoom, "ohne stehende Hand fragt der Zoom-Zweig nicht");
zc.cssZoomActive = false;
werkzeugZeiger = false;

console.log("weg-namensklick.test.js: ok");

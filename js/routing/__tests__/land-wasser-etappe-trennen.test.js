// MELDUNG #102: eine Land- und eine Wasseretappe duerfen NICHT zu einer Anzeige-Etappe verschmelzen.
//
// 💣 DER GRENZ-LAUF UEBERSCHREIBT DIE ART, UND DREI RECHNUNGEN LESEN GENAU DIESE ART.
// `cleanRoutePlanNoiseEntries` sammelt Roh-Etappen bis zum naechsten echten Ort und behaelt dabei
// `type`, `transport` und `flowState` der ERSTEN. Liegt vor dem Anleger ein kurzes Stueck Weg, erbt
// die ganze Flussfahrt „Weg" und „zu Fuss":
//   * `buildTravelCostRows` zaehlt Flussmeilen nur bei `type === "Flussweg"` -> die Zeile
//     „Flusspassage" verschwindet ersatzlos;
//   * `avesmapsTravelCostNightKinds` liest `TRAVEL_COST_SHELTER_BY_SUBTYPE[type]` -> aus Naechten an
//     Bord werden bezahlte Wirtshausnaechte;
//   * `avesmapsRouteLegTravelHours` liest das Reisemittel -> die Flussfahrt rechnet mit dem
//     8-Stunden-Reisetag des Landes statt mit den 12 des Wassers, und das verschiebt Kalendertage,
//     Rast, Jahreszeit und Ankunft.
//
// Live gemessen am 26.08.2026 (Gareth -> Perricum, Vorgabe-Route): die Antwort endet mit 3,042
// Meilen `Weg` zu Fuss ab Hausen und 187,667 Meilen `Flussweg` mit dem Flusssegler. Der Reiseplan
// zeigte EINE Etappe „Weg ueber Darpat (190,71 Meilen) von Hausen bis Perricum", 8 x
// Gemeinschaftszimmer und keine Flusspassage.
//
// ⭐ Die Regel steht seit Juli im Code, nur fuer das Querfeldein formuliert („nie mit einer
// andersartigen Etappe verschmelzen"). Das Kostenmodell (03.08.) und der Reisetag je Etappe
// (14.08.) kamen spaeter obendrauf und haben den Satz „Land<->Fluss verschmilzt wie bisher" geerbt,
// ohne dass ihn jemand gegen sie geprueft hat.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/land-wasser-etappe-trennen.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };

// 🪤 Diese Globals stammen aus js/config.js und werden hier festgenagelt. Fehlt eines, prueft der
// Test den Rueckfall statt der Regel.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.THRESHOLD = 0.5;
global.SPEED_TABLE = { groupFoot: { Weg: 4.04 }, riverSailer: { Flussweg: 6.0 } };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.normalizeLocationSearchName = (value) => String(value || "");
global.getTransportOption = (type) => (type === "Flussweg" ? "riverSailer" : "groupFoot");
global.selectedLocations = [];
global.locationData = [];
global.findPathByPublicId = () => null;
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;

const load = (relative) => {
	const absolute = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
load("../../app/i18n.js");
global.tr = global.window.tr;
load("../route-node.js");
load("../route-plan.js");

assert.strictEqual(SYNTHETIC_ROUTE_TYPE, "Querfeldein", "ohne die echte Konstante prueft der Test nichts");

const etappe = (over) => Object.assign({
	type: "Weg",
	transport: "groupFoot",
	flowState: null,
	startName: "Anfang",
	endName: "Ende",
	segmentLabel: "",
	distance: 10,
	travelTime: 3,
	restTime: 0,
	segmentIndexes: [0],
}, over);

// ---- 1. Der gemeldete Fall ----------------------------------------------------------------------
const gemeldet = cleanRoutePlanNoiseEntries([
	etappe({ type: "Weg", transport: "groupFoot", startName: "Hausen", endName: "Kreuzung-2115", distance: 3.042, travelTime: 0.896, segmentIndexes: [9] }),
	etappe({ type: "Flussweg", transport: "riverSailer", flowState: "downstream", startName: "Kreuzung-2115", endName: "Perricum", distance: 187.667, travelTime: 37.221, segmentLabel: "Darpat", segmentIndexes: [10, 11, 12, 13, 14, 15] }),
]);
assert.strictEqual(gemeldet.length, 2, "Land und Fluss bleiben zwei Etappen");
assert.strictEqual(gemeldet[0].type, "Weg", "die Landetappe behaelt ihre Art");
assert.strictEqual(gemeldet[1].type, "Flussweg", "und die Flussetappe ihre -- daran haengt die Flusspassage");
assert.strictEqual(gemeldet[1].transport, "riverSailer", "und ihr Reisemittel -- daran haengt der 12-Stunden-Reisetag");
assert.strictEqual(gemeldet[1].flowState, "downstream", "und ihre Stroemung -- daran haengt der Aufschlag stromauf");
assert.ok(Math.abs(gemeldet[0].distance - 3.042) < 1e-9,
	"die Landetappe waechst NICHT auf 190,71 Meilen, gemessen: " + gemeldet[0].distance);
assert.ok(Math.abs(gemeldet[1].distance - 187.667) < 1e-9, "und die Flussetappe behaelt ihre 187,667");
assert.deepStrictEqual(gemeldet[1].segmentIndexes, [10, 11, 12, 13, 14, 15], "mit ihren eigenen Segmenten");

// ---- 2. Und dasselbe am ENDE der Liste ----------------------------------------------------------
// 💣 Die Schluss-Absorption ist eine ZWEITE Stelle mit derselben Regel. Fuer das Querfeldein wurde
// sie am 01.08.2026 einzeln nachgezogen, nachdem der Fall live aufgetreten war -- eine Regel, die
// nur die Mitte der Liste bindet, ist keine.
const wasserSchluss = cleanRoutePlanNoiseEntries([
	etappe({ type: "Weg", transport: "groupFoot", startName: "Gareth", endName: "Hausen", distance: 40 }),
	etappe({ type: "Flussweg", transport: "riverSailer", startName: "Hausen", endName: "Markierung", distance: 20, segmentIndexes: [1] }),
]);
assert.strictEqual(wasserSchluss.length, 2, "eine Wasser-Schluss-Etappe verschwindet nicht in der Landetappe davor");
assert.strictEqual(wasserSchluss[1].type, "Flussweg", "und behaelt ihre Art");
assert.strictEqual(wasserSchluss[0].distance, 40, "die Landetappe waechst nicht um 20 Meilen");

// ---- 3. Fluss und See sind auch nicht dasselbe ---------------------------------------------------
// Beide sind Wasser, aber nicht dasselbe Schiff: der Lastensegler fuehre sonst zum Kahnpreis, und
// die Meilen des Meeres stuenden in der Zeile „Flusspassage".
const flussDannSee = cleanRoutePlanNoiseEntries([
	etappe({ type: "Flussweg", transport: "riverSailer", endName: "Kreuzung-9", distance: 30 }),
	etappe({ type: "Seeweg", transport: "cargoShip", startName: "Kreuzung-9", endName: "Havena", distance: 90, segmentIndexes: [1] }),
]);
assert.strictEqual(flussDannSee.length, 2, "Fluss und See bleiben getrennt");
assert.strictEqual(flussDannSee[1].transport, "cargoShip", "und das Meer behaelt sein Schiff");

// ---- 4. Was weiterhin verschmelzen MUSS ----------------------------------------------------------
// 🔴 Der Grenz-Lauf ist kein Fehler, sondern der Sinn der Etappenliste: eine Reise ueber Reichs-
// strasse, Strasse und Weg ist EIN Marsch bis zur naechsten Stadt. Nur das Reisemittel trennt.
const dreiWegarten = cleanRoutePlanNoiseEntries([
	etappe({ type: "Reichsstrasse", transport: "groupFoot", startName: "Gareth", endName: "Kreuzung-1", distance: 12, segmentIndexes: [0] }),
	etappe({ type: "Strasse", transport: "groupFoot", startName: "Kreuzung-1", endName: "Kreuzung-2", distance: 8, segmentIndexes: [1] }),
	etappe({ type: "Weg", transport: "groupFoot", startName: "Kreuzung-2", endName: "Hartsteen", distance: 5, segmentIndexes: [2] }),
]);
assert.strictEqual(dreiWegarten.length, 1, "drei Wegarten desselben Reisemittels bleiben EINE Etappe");
assert.strictEqual(dreiWegarten[0].distance, 25, "und ihre Strecke ist die Summe");
assert.deepStrictEqual(dreiWegarten[0].segmentIndexes, [0, 1, 2], "mit allen Segmenten");

const zweiFluss = cleanRoutePlanNoiseEntries([
	etappe({ type: "Flussweg", transport: "riverSailer", flowState: "downstream", endName: "Kreuzung-7", distance: 30 }),
	etappe({ type: "Flussweg", transport: "riverSailer", flowState: "downstream", startName: "Kreuzung-7", endName: "Perricum", distance: 20, segmentIndexes: [1] }),
]);
assert.strictEqual(zweiFluss.length, 1, "zwei gleichgerichtete Flussstuecke bleiben EINE Etappe");

// ---- 5. Der Uebergang bekommt einen Namen --------------------------------------------------------
// ⚠️ Ohne ihn hiesse die neue Grenze „Markierung" -- die Trennung waere richtig und die Auskunft
// schlechter als vorher. Ein echter Ort am Uebergang behaelt seinen Namen (dieselbe Regel wie beim
// Abgangspunkt).
const benannt = nameRoutePlanTransferPoints(gemeldet);
assert.notStrictEqual(benannt[0].endName, "Kreuzung-2115", "die anonyme Kreuzung heisst nicht mehr so");
assert.strictEqual(benannt[0].endName, benannt[1].startName, "beide Seiten des Uebergangs heissen gleich");
assert.strictEqual(benannt[0].endName, "Anlegestelle", "und zwar Anlegestelle");

const mitOrt = nameRoutePlanTransferPoints([
	etappe({ type: "Weg", transport: "groupFoot", startName: "Gareth", endName: "Hausen" }),
	etappe({ type: "Flussweg", transport: "riverSailer", startName: "Hausen", endName: "Perricum", segmentIndexes: [1] }),
]);
assert.strictEqual(mitOrt[0].endName, "Hausen", "ein echter Ort am Anleger behaelt seinen Namen");

// 🔴 Und die aeltere Regel bleibt, wie sie war: Weg <-> Gelaende heisst weiter Abgangspunkt bzw.
// Anschlusspunkt, auch wenn die andere Seite Wasser ist.
const gelaendeAmFluss = nameRoutePlanTransferPoints([
	etappe({ type: "Querfeldein", transport: "groupFoot", startName: "Rovik", endName: "Markierung" }),
	etappe({ type: "Flussweg", transport: "riverSailer", startName: "Markierung", endName: "Skarsten", segmentIndexes: [1] }),
]);
assert.strictEqual(gelaendeAmFluss[0].endName, "Anschlusspunkt",
	"Gelaende -> Weg behaelt seinen Namen -- die neue Regel draengt sich nicht davor");

// ---- 6. Und die Landetappe weiss jetzt, WOMIT sie reist ------------------------------------------
// 💣 Bis zum 26.08.2026 trug nur das Wasser-Aggregat ein `transport`. `resolveRouteStepTransport`
// fiel bei einer Landetappe auf die WEGART zurueck -- was den Reisetag zufaellig richtig traf
// (weder „Weg" noch „groupFoot" stehen in TRANSPORT_TRAVEL_HOURS bzw. beide ergeben den Planerwert),
// aber keinen Vergleich erlaubte: eine Regel darf nicht davon abhaengen, dass ein Feld FEHLT.
const ausSegmenten = buildRoutePlanEntries(["A", "B"], [{
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	properties: { feature_subtype: "Weg", public_id: "p1" },
}]);
assert.strictEqual(ausSegmenten.length, 1, "eine Etappe");
assert.strictEqual(ausSegmenten[0].transport, "groupFoot", "und sie nennt ihr Reisemittel");

// ---- 7. Und die dritte Rechnung: der REISETAG -----------------------------------------------
// 💣 DAS IST DIE TEUERSTE FOLGE UND STAND NICHT IN DER MELDUNG. `avesmapsRouteLegTravelHours`
// (route-result.js) liest das Reisemittel der Etappe: Land faehrt den Reisetag aus dem Planerfeld
// (Vorgabe 8 h), das Schiff seine eigenen 12. Erbt die Flussfahrt „zu Fuss", rechnet sie mit 8 --
// und das verschiebt Kalendertage, Rast, Jahreszeit und Ankunftsdatum, nicht nur die Heller.
//
// Die ECHTEN Tabellen und die ECHTE Funktion, nicht nachgebaut: ein Nachbau verstuende genau den
// Rueckfall falsch, um den es hier geht.
// ⚠️ Zeilenendenneutral geschnitten -- die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
const ZEILENENDE = String.fromCharCode(10);
const schnitt = (quelle, anfang, schluss, zugabe) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZEILENENDE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length) + zugabe;
};

const konfigQuelle = fs.readFileSync(path.join(__dirname, "..", "..", "config.js"), "utf8");
const holeKonstante = (name) => schnitt(konfigQuelle, "const " + name, "};",
	ZEILENENDE + "global." + name + " = " + name + ";");
vm.runInThisContext(holeKonstante("TRANSPORT_TRAVEL_HOURS"));
vm.runInThisContext(holeKonstante("VALID_TRANSPORT_OPTIONS"));
assert.strictEqual(TRANSPORT_TRAVEL_HOURS.riverSailer, 12, "ohne den echten Reisetag prueft der Test nichts");
assert.ok(VALID_TRANSPORT_OPTIONS.land.has("groupFoot"), "und ohne die echte Landliste ebenso");

const ergebnisQuelle = fs.readFileSync(path.join(__dirname, "..", "route-result.js"), "utf8");
const holeFunktion = (name) => schnitt(ergebnisQuelle, "function " + name + "(", "}",
	ZEILENENDE + "global." + name + " = " + name + ";");
vm.runInThisContext(holeFunktion("resolveRouteStepTransport"));
vm.runInThisContext(holeFunktion("avesmapsRouteLegTravelHours"));

const reisetag = (eintrag) => avesmapsRouteLegTravelHours(resolveRouteStepTransport(eintrag, eintrag.type), 8);
assert.strictEqual(reisetag(gemeldet[1]), 12, "die getrennte Flussfahrt rechnet mit dem 12-Stunden-Tag des Wassers");
assert.strictEqual(reisetag(gemeldet[0]), 8, "und der Marsch davor mit den acht Stunden des Landes");
// Der Zustand VOR der Reparatur, zum Vergleich: als „Weg" zu Fuss saehen 187,667 Meilen Fluss einen
// 8-Stunden-Tag -- die Haelfte mehr Kalendertage fuer dieselbe Fahrt.
assert.strictEqual(reisetag({ type: "Weg", transport: "groupFoot" }), 8,
	"und genau das war der Fehler: verschmolzen bekam die Flussfahrt diesen Wert");

console.log("OK land-wasser-etappe-trennen");

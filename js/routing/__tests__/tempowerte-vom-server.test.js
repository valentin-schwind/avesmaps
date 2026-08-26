// Die im Fenster „Tempowerte" gespeicherte Tempotabelle gilt auch fuer die KARTE.
//
// 💣 ZWEI WAHRHEITEN UEBER DIESELBE ZAHL, UND SIE WAREN LIVE AUSEINANDER. Der Router liest sein
// Raster ueber avesmapsTravelValuesRead() -- Konstante, darueber die gespeicherten Werte. Der
// Browser trug `SPEED_TABLE` als feste Zahl in js/config.js. Live gemessen am 26.08.2026 an der
// Route Gareth -> Perricum: der Server fuhr die Reisegruppe zu Fuss mit 5,07 Meilen/h ueber die
// Reichsstrasse, der Browser rechnete mit 5,18; den Flusssegler mit 5,95 gegen 6,00. Der Reiseplan
// zeigte dadurch rund 2 % kuerzere Zeiten, als der Router selbst gerechnet hatte.
//
// 🔴 DIE LEITUNG GAB ES SCHON -- fuer die drei REISETAGE (`travel_hours`, seit 16.08.2026). Die
// Tempotabelle faehrt seit dem 26.08.2026 auf derselben, in derselben Nutzlast, mit derselben
// Ausfallart: sagt der Server nichts, bleibt die Konstante des Browsers stehen.
//
// ⚠️ Die Konstante ist damit kein zweiter Anspruch mehr auf dieselbe Wahrheit, sondern die Antwort
// auf „der Server sagt nichts". Sie darf deshalb NICHT verschwinden.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/tempowerte-vom-server.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };

const ZEILENENDE = String.fromCharCode(10);
const repoWurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(repoWurzel, rel), "utf8");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZEILENENDE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

// 🪤 Die ECHTEN Tabellen aus js/config.js. Ein Nachbau pruefte sich selbst -- und genau die Frage
// „stimmen Browser und Server ueberein" ist der Gegenstand.
const konfig = lies("js/config.js");
const holeKonstante = (name, schluss) => vm.runInThisContext(
	schnitt(konfig, "const " + name, schluss) + ZEILENENDE + "global." + name + " = " + name + ";");
holeKonstante("SPEED_TABLE", "};");
holeKonstante("TRANSPORT_TRAVEL_HOURS", "};");
holeKonstante("VALID_TRANSPORT_OPTIONS", "};");
assert.strictEqual(SPEED_TABLE.groupFoot.Reichsstrasse, 5.18, "ohne die echte Tempotabelle prueft der Test nichts");
assert.strictEqual(SPEED_TABLE.riverSailer.Flussweg, 6, "und ohne den echten Flusssegler ebenso");

// Die beiden Uebernehmer aus routing.js, ausgefuehrt statt im Quelltext gesucht.
// 💣 Ein `includes("applyServerTravelHours(data)")` sagt nur, dass die Zeile DASTEHT -- nicht, was
// sie tut. Genau so ein Quelltext-Test bewachte die Reisetage, und er haette einen vertauschten
// Land-/Wasserwert nie bemerkt.
const routingQuelle = lies("js/routing/routing.js");
const holeFunktion = (name) => vm.runInThisContext(
	schnitt(routingQuelle, "function " + name + "(", "}") + ZEILENENDE + "global." + name + " = " + name + ";");
holeFunktion("applyServerTravelHours");
holeFunktion("applyServerTravelSpeeds");

// ---- 1. Der gemessene Live-Fall ------------------------------------------------------------------
applyServerTravelSpeeds({
	travel_speeds: {
		groupFoot: { Reichsstrasse: 5.07 },
		riverSailer: { Flussweg: 5.95 },
	},
});
assert.strictEqual(SPEED_TABLE.groupFoot.Reichsstrasse, 5.07, "die Reichsstrasse uebernimmt den Serverwert");
assert.strictEqual(SPEED_TABLE.riverSailer.Flussweg, 5.95, "der Flusssegler ebenso");
// 🔴 Zelle fuer Zelle, nie das ganze Raster ersetzt: ein Reisemittel oder eine Wegart, die der
// Server nicht nennt, behaelt ihren Wert. Ein ersetztes Raster liesse den Rest als `undefined`
// zurueck -- und `SPEED_TABLE[t]?.[type] || 1` macht daraus klaglos Tempo 1.
assert.strictEqual(SPEED_TABLE.groupFoot.Strasse, 4.61, "eine ungenannte Wegart behaelt ihren Wert");
assert.strictEqual(SPEED_TABLE.caravan.Weg, 3.95, "und ein ungenanntes Reisemittel sein ganzes Raster");

// ---- 2. Was NICHT uebernommen wird ---------------------------------------------------------------
const vorher = JSON.parse(JSON.stringify(SPEED_TABLE));
applyServerTravelSpeeds({
	travel_speeds: {
		groupFoot: { Reichsstrasse: 0, Strasse: -3, Weg: "schnell", Pfad: null },
		luftschiff: { Reichsstrasse: 99 },
		groupHorse: { Sternenpfad: 42 },
	},
});
assert.deepStrictEqual(SPEED_TABLE, vorher,
	"Null, negativ, Text, null, ein unbekanntes Reisemittel und eine unbekannte Wegart aendern NICHTS");
// 💣 Ein unbekannter Schluessel darf nicht ANGELEGT werden: eine Wegart, die es nicht gibt, waere
// eine Zelle, die niemand liest -- und ein Reisemittel, das es nicht gibt, eines, das der Planer
// nie anbietet, waehrend die Tabelle so tut, als koenne er es.
assert.strictEqual(SPEED_TABLE.luftschiff, undefined, "kein erfundenes Reisemittel");
assert.strictEqual(SPEED_TABLE.groupHorse.Sternenpfad, undefined, "keine erfundene Wegart");

applyServerTravelSpeeds({});
applyServerTravelSpeeds({ travel_speeds: null });
applyServerTravelSpeeds(null);
applyServerTravelSpeeds({ travel_speeds: [] });
assert.deepStrictEqual(SPEED_TABLE, vorher, "eine Antwort ohne Tempotabelle laesst alles, wie es ist");

// ---- 3. Die Reisetage fahren auf derselben Leitung ------------------------------------------------
// 🔴 Sie tun das seit dem 16.08.2026; hier steht, dass die zweite Leitung die erste nicht bricht.
applyServerTravelHours({ travel_hours: { land: 10, water: 14, night: 24 } });
assert.strictEqual(TRANSPORT_TRAVEL_HOURS.groupFoot, 10, "der Landtag kommt vom Server");
assert.strictEqual(TRANSPORT_TRAVEL_HOURS.riverSailer, 14, "der Wassertag ebenso");
assert.strictEqual(TRANSPORT_TRAVEL_HOURS.fastShip, 24, "und der Schnellsegler behaelt seinen eigenen");

// ---- 4. Und der Reiseplan rechnet wirklich damit --------------------------------------------------
// 💣 DAS IST DIE EIGENTLICHE ZUSICHERUNG. Eine Tabelle zu beschreiben ist eine Sache; dass die
// angezeigte Reisezeit ihr folgt, eine andere -- und nur die zweite hat der Melder gesehen.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.THRESHOLD = 0.5;
global.normalizePathSubtype = (v) => String(v || "Weg");
global.normalizeNodeName = (v) => String(v || "");
global.normalizeLocationSearchName = (v) => String(v || "");
global.getTransportOption = () => "groupFoot";
global.selectedLocations = [];
global.locationData = [];
global.findPathByPublicId = () => null;
// 1 Karteneinheit = 3 Meilen (DISTANCE_SCALING_FACTOR), wie calculateScaledDistance in utils.js.
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;
const lade = (rel) => vm.runInThisContext(lies(rel), { filename: rel });
lade("js/app/i18n.js");
global.tr = global.window.tr;
lade("js/routing/route-node.js");
lade("js/routing/route-plan.js");

const eineEtappe = (tempo) => {
	applyServerTravelSpeeds({ travel_speeds: { groupFoot: { Reichsstrasse: tempo } } });
	const entries = buildRoutePlanEntries(["A", "B"], [{
		geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },   // 10 Einheiten = 30 Meilen
		properties: { feature_subtype: "Reichsstrasse", public_id: "p1" },
	}]);
	assert.strictEqual(entries.length, 1, "eine Etappe");
	return entries[0].travelTime;
};
const mitServerTempo = eineEtappe(5.07);
const mitKonstante = eineEtappe(5.18);
assert.ok(Math.abs(mitServerTempo - (30 / 5.07) * 1.19) < 1e-9,
	"die Etappenzeit folgt dem Servertempo, gemessen: " + mitServerTempo);
assert.ok(mitServerTempo > mitKonstante,
	"und das langsamere Servertempo ergibt eine LAENGERE Reise -- genau die 2 %, die live fehlten");
assert.ok(Math.abs(mitServerTempo / mitKonstante - 5.18 / 5.07) < 1e-9,
	"und zwar um genau das Verhaeltnis der beiden Tempi");

console.log("OK tempowerte-vom-server");

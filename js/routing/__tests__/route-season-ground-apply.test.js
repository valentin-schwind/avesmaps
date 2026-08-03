// Der Bodenabzug an der ETAPPENZEIT: Klimazone + Jahreszeit der Etappe -> langsamer -> laenger.
//
// 💣 DER JAHRESZEITWECHSEL FAELLT MITTEN IN DIE ROUTE. Eine Reise dauert Wochen; wer im Phex
// aufbricht, faehrt im Peraine weiter. Der Abzug haengt deshalb am Datum JEDER Etappe, und dieses
// Datum haengt an der bis dahin verstrichenen Zeit -- die der Abzug selbst verlaengert hat. Genau
// deshalb laeuft die Rechnung sequentiell in EINEM Durchgang: das Datum einer Etappe haengt nur von
// den VORHERIGEN ab, ein Fixpunkt ist nicht noetig.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/route-season-ground-apply.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };

global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.DISTANCE_SCALING_FACTOR = 3;
global.THRESHOLD = 0.5;
global.ROUTE_CITY_NODE_THRESHOLD = 0.15;
global.SPEED_TABLE = { groupFoot: { Weg: 3.5, Strasse: 4.0, Reichsstrasse: 4.5, Pfad: 3.0 } };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.getTransportOption = () => "groupFoot";
global.normalizeLocationSearchName = (value) => String(value || "");
global.findPathByPublicId = () => null;
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;
global.isCrossingLocation = () => false;
global.selectedLocations = [];
global.currentRoutePlanEntries = [];
global.currentRouteSegments = [];
global.currentRouteNames = [];
global.activeRoutePlanEntryIndex = null;

const load = (relative) => {
	const absolute = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
load("../../app/i18n.js");
global.tr = global.window.tr;
load("../../app/utils.js");
load("../travel-calendar.js");
load("../season-ground.js");
load("../route-season-ground.js");
load("../route-node.js");
// buildRoutePlanEntries lebt in route-plan.js; route-result.js ruft es. Der jQuery-Rand wird dabei
// nicht gebraucht -- der Test ruft `buildRouteSteps`, nicht `showRoutePlan`.
global.$ = () => ({ empty() { return this; }, append() { return this; }, prepend() { return this; }, find() { return this; }, on() { return this; }, val: () => "fastest" });
load("../route-plan.js");
load("../route-result.js");

// Gegenprobe: die ECHTEN Rechner, kein Stub, der die Regel schluckt.
assert.strictEqual(typeof seasonSpeedFactor, "function", "der echte Bodenrechner muss geladen sein");
assert.strictEqual(SEASON_GROUND_PATH_FACTORS.Strasse, 1.0, "ohne die echte Faktorenspalte prueft der Test nichts");
assert.strictEqual(SEASON_GROUND_TABLE.gemaessigt.winter, "schnee_leicht", "ohne die echte Zonentabelle ebenso");

// ---- Die Strecke ------------------------------------------------------------------------------------
// Vier Etappen zu je 90 Meilen. Bei Tempo 3,5 und Zeitfaktor 1,19 sind das 30,6 Reisestunden.
const places = ["Aran", "Beran", "Ceran", "Deran", "Eran"];
global.locationData = places.map((name, index) => ({ name, coordinates: [0, index * 30] }));
const routeNames = places.slice();
const makeSegments = (subtype) => [0, 1, 2, 3].map((index) => ({
	geometry: { type: "LineString", coordinates: [[index * 30, 0], [(index + 1) * 30, 0]] },
	properties: { feature_subtype: subtype, public_id: `p${index}` },
}));

// Die Klimazone einer Etappe kommt aus der Wege-Landschaftsablage -- hier gestellt, wie sie der
// Zugehoerigkeitslauf schreibt: `in` sind Paare [regionKey, gedeckte Laenge].
const setZone = (zoneArt) => {
	global.avesmapsPathLandscapesStore = {
		landscapes: { z1: { kind: "klima", art: zoneArt, name: zoneArt } },
		paths: {},
		pending: {},
	};
	[0, 1, 2, 3].forEach((index) => {
		avesmapsPathLandscapesStore.paths[`p${index}`] = { length: 30, in: [["z1", 30]] };
	});
};

const steps = ({ subtype = "Weg", month = "", day = 1, restHoursPerDay = 12 } = {}) => buildRouteSteps(routeNames, makeSegments(subtype), {
	includeRests: restHoursPerDay > 0,
	restHoursPerDay,
	departure: month ? { monthKey: month, day } : null,
});

// ---- Rueckwaertskompatibel: ohne Reisebeginn aendert sich NICHTS ------------------------------------
setZone("gemaessigt");
const plain = steps({});
const winterOff = steps({ month: "" });
assert.strictEqual(plain.length, 4, "vier Etappen erwartet");
plain.forEach((step, index) => {
	assert.strictEqual(step.travel_time, winterOff[index].travel_time, "ohne Reisebeginn bleibt die Zeit gleich");
	assert.ok(!step.season_ground, "ohne Reisebeginn gibt es keinen Vermerk");
});
const baseline = plain[0].travel_time;
assert.ok(Math.abs(baseline - (90 / 3.5) * 1.19) < 1e-9, `Grundlinie 30,6 h, war ${baseline}`);

// ---- 🔴 DER KERN: im Winter dauert dieselbe Strecke laenger -----------------------------------------
// Gemaessigte Zone + Winter = leichter Schnee, -0,1. „Weg" hat Faktor 0,8 -> 0,7/0,8 = 0,875 Tempo,
// also 1/0,875 = +14,3 % Zeit.
const winter = steps({ month: "firun", day: 1 });
const expectedFactor = (0.8 - 0.1) / 0.8;
assert.ok(
	Math.abs(winter[0].travel_time - baseline / expectedFactor) < 1e-9,
	`Winter auf einem Weg: ${baseline / expectedFactor} erwartet, war ${winter[0].travel_time}`
);
assert.ok(winter[0].season_ground, "die Etappe erklaert sich: ein Vermerk haengt dran");
assert.strictEqual(winter[0].season_ground.condition, "schnee_leicht", "leichter Schnee im gemaessigten Winter");

// 💣 Die Rast waechst mit: sie ist aus der Reisezeit gerechnet, nicht daneben.
assert.ok(winter[0].rest_time > plain[0].rest_time, "mehr Reisezeit heisst mehr Rast");
assert.ok(
	Math.abs(winter[0].rest_time - winter[0].travel_time) < 1e-9,
	"bei 12 Reisestunden am Tag ist Rast = Reisezeit"
);

// ---- 🔴 Die SUMME traegt denselben Abzug wie ihre Etappen -------------------------------------------
// 💣 Genau der Fehler, den route-plan-terrain-time.test.js fuer das Gelaende beschreibt, nur
// andersherum: eine Etappenliste, die ihrer eigenen Summe widerspricht. Deshalb greift der Abzug VOR
// buildRouteSummary -- die Summe zaehlt die Etappen, sie rechnet nicht selbst.
const winterSummary = buildRouteSummary(
	places.map((name, index) => ({ name, coordinates: [0, index * 30] })),
	winter,
	{ optimize: "fastest" }
);
const summedTravel = winter.reduce((total, step) => total + step.travel_time, 0);
assert.ok(
	Math.abs(winterSummary.travel_hours - summedTravel) < 1e-9,
	"die Reisezeit der Zusammenfassung ist die Summe der Etappen"
);
assert.ok(
	winterSummary.travel_hours > 4 * baseline,
	`die Summe traegt den Abzug: ${winterSummary.travel_hours} muss ueber ${4 * baseline} liegen`
);
assert.ok(
	Math.abs(winterSummary.total_hours - (winterSummary.travel_hours + winterSummary.rest_hours)) < 1e-9,
	"und die Gesamtzeit bleibt Reise + Rast"
);

// ---- Die Strassenausnahme gilt der Naesse, nicht dem Schnee -----------------------------------------
// Fruehling = aufgeweicht (-0,1, Strasse ausgenommen) -> Strasse unveraendert, Weg langsamer.
const springRoad = steps({ subtype: "Strasse", month: "peraine", day: 1 });
const plainRoad = steps({ subtype: "Strasse" });
assert.ok(
	Math.abs(springRoad[0].travel_time - plainRoad[0].travel_time) < 1e-9,
	"aufgeweichter Boden laesst die Strasse in Ruhe (§21)"
);
// ... aber der SCHNEE trifft sie sehr wohl.
const winterRoad = steps({ subtype: "Strasse", month: "firun", day: 1 });
assert.ok(winterRoad[0].travel_time > plainRoad[0].travel_time, "Schnee trifft auch die Strasse");

// ---- 🔴 DER JAHRESZEITWECHSEL MITTEN IN DER ROUTE ---------------------------------------------------
// Prüfkriterium der Instruction: Aufbruch 28. Phex (Winter). Jede Etappe belegt gut 2,5 Kalendertage,
// mit Abzug mehr -- die Route laeuft also in den Peraine (Fruehling) hinein. Vorne leichter Schnee,
// hinten aufgeweichter Boden: DERSELBE Abzug, aber ein anderer Bodenzustand, und das muss die Etappe
// sagen koennen. Bliebe der Zustand ueber alle vier gleich, rechnete jemand die ganze Reise mit der
// Jahreszeit des Aufbruchs -- der Fehler, gegen den der mitlaufende Kalender gebaut wurde.
const crossing = steps({ month: "phex", day: 28 });
const conditions = crossing.map((step) => (step.season_ground ? step.season_ground.condition : ""));
assert.ok(conditions[0] === "schnee_leicht", `die erste Etappe liegt im Winter, war „${conditions[0]}"`);
assert.ok(
	conditions[conditions.length - 1] === "aufgeweicht",
	`die letzte Etappe liegt im Fruehling, war „${conditions[conditions.length - 1]}"\nalle: ${conditions.join(" | ")}`
);

// ---- Zonen ohne Wirkung, Wasser, und Unsinn ---------------------------------------------------------
setZone("tropisch");
const tropics = steps({ month: "firun", day: 1 });
assert.ok(
	Math.abs(tropics[0].travel_time - baseline) < 1e-9,
	"die Tropen kennen keinen Winterboden -- die Zeit bleibt"
);
setZone("");   // keine Zone zugeordnet
const unknownZone = steps({ month: "firun", day: 1 });
assert.ok(Math.abs(unknownZone[0].travel_time - baseline) < 1e-9, "ohne Zone wird nicht geraten");
global.avesmapsPathLandscapesStore = undefined;   // die Ablage ist noch gar nicht da (Abruf laeuft)
const noStore = steps({ month: "firun", day: 1 });
assert.ok(Math.abs(noStore[0].travel_time - baseline) < 1e-9, "ohne geladene Landschaften rechnet es wie bisher");

console.log("route-season-ground-apply.test.js: all assertions passed");

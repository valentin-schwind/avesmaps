// Der Hinweis im Reiseplan: oben DASS und wie viel laenger, am Abzweig WELCHER Weg und WARUM
// (Variante C, Owner 14.09.2026). Entwurf docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md §7.
//
// ⭐ Geprueft wird das ECHTE Markup aus `showRoutePlan()` -- dieselbe Umgebung wie
// route-plan-leg-date.test.js, dazu die echten Satzformen aus path-einschraenkung.js.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/sperrzeiten-hinweis.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
const monthSelectMarkup = indexHtml.slice(indexHtml.indexOf('<select id="travelStartMonth"'));
const monthOptions = Array.from(
	monthSelectMarkup.slice(0, monthSelectMarkup.indexOf("</select>")).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g),
	(match) => ({ value: match[1], textContent: match[2] })
);
assert.ok(monthOptions.length === 13, "die Monatswahl steht im Markup");

// ---- Umgebung (wie route-plan-leg-date.test.js) -------------------------------------------------------
const monthSelect = { get value() { return ""; }, options: monthOptions };
global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = {
	getElementById: (id) => (id === "travelStartMonth" ? monthSelect : null),
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: {},
};
global.localStorage = { getItem: () => null, setItem() {} };
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.DISTANCE_SCALING_FACTOR = 3;
global.SYNTHETIC_ROUTE_LONG_LEG_WARN_DISTANCE = 1e9;
global.ROUTE_ICON_PATHS = { Weg: "weg.svg" };
global.SPEED_TABLE = { groupFoot: { Weg: 3.5 } };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.getTransportOption = () => "groupFoot";
global.THRESHOLD = 0.5;
global.ROUTE_CITY_NODE_THRESHOLD = 0.15;
global.normalizeLocationSearchName = (value) => String(value || "");
global.findPathByPublicId = () => null;
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;
global.isCrossingLocation = () => false;
global.getPlannerRestHoursPerDay = () => 16;
const placeNames = ["Aran", "Beran", "Ceran", "Deran", "Eran"];
global.locationData = placeNames.map((name, index) => ({ name, coordinates: [0, index * 30] }));
global.selectedLocations = [];
global.currentRoutePlanEntries = [];
global.currentRouteSegments = [];
global.currentRouteNames = [];
global.currentRouteClosures = [];
global.activeRoutePlanEntryIndex = null;

let appended = [];
let prepended = [];
let optimize = "fastest";
const chainable = { on() { return chainable; }, empty() { return chainable; } };
const overview = {
	empty() { appended = []; prepended = []; return overview; },
	append(markup) { appended.push(String(markup)); return overview; },
	prepend(markup) { prepended.push(String(markup)); return overview; },
	find() { return chainable; },
};
global.$ = (selector) => {
	if (selector === "#overview") { return overview; }
	return { val: () => optimize, on() { return chainable; }, find() { return chainable; }, length: 0 };
};

const load = (relative) => {
	const absolute = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
load("../../app/i18n.js");
global.tr = global.window.tr;
load("../../app/utils.js");
load("../../map-features/path-einschraenkung.js");
load("../travel-calendar.js");
load("../route-plan-calendar.js");
load("../route-node.js");
load("../route-result.js");
load("../route-view-model.js");
load("../route-closures.js");
load("../route-plan.js");

assert.strictEqual(typeof avesmapsWegMittelWorte, "function", "die echten Satzformen sind geladen");
assert.strictEqual(typeof routeClosureHeadMarkup, "function", "der Kopfbauer ist geladen");

// ---- Die Reise: vier Etappen, je eine je Segment ----------------------------------------------------
const segments = [0, 1, 2, 3].map((index) => ({
	geometry: { type: "LineString", coordinates: [[index * 30, 0], [(index + 1) * 30, 0]] },
	properties: { id: `e${index}`, feature_subtype: "Weg", public_id: `p${index}` },
}));
const routeNames = ["A", "B", "C", "D", "E"];
const kutsche = {
	leg_index: 0, blocked: false, diverges_at_node: "Ceran", diverges_at_edge_id: "e2",
	avoided: [{ kind: "transport", path_name: "Schattenbachpass", public_ids: ["pub-Q"], subtype: "Gebirgspass",
		transport: "horseCarriage", from_node: "Ceran", allowed: ["groupFoot", "lightWalker"] }],
	actual: { distance_units: 20, travel_hours: 375.4, travel_days: 36.35 },
	unrestricted: { distance_units: 12, travel_hours: 115.6, travel_days: 14.45 },
	segmentOffset: 0, segmentCount: 4,
};
const zeichne = (closures, saisonal = []) => {
	// 💣 NACH dem Laden gesetzt: utils.js bringt die echte Fassung mit, die das Stundenfeld im DOM liest.
	global.getPlannerRestHoursPerDay = () => 16;
	global.currentRouteClosures = closures;
	global.currentRouteSeasonalWays = saisonal;
	showRoutePlan(routeNames, segments);
	return { legs: appended.slice(), head: prepended.join("") };
};

// ---- 1. Kein Bericht: keine Spur ----------------------------------------------------------------------
const ohne = zeichne([]);
assert.strictEqual(ohne.legs.length, 4, "vier Etappen");
assert.ok(!ohne.head.includes("route-plan-sperrung"), "ohne Bericht kein Kopf-Hinweis");
assert.ok(!ohne.legs.join("").includes("route-plan-entry__sperrung") && !ohne.legs.join("").includes("--umweg"), "und kein Vermerk");

// ---- 2. Variante C: oben DASS und wie viel laenger -----------------------------------------------------
const mit = zeichne([kutsche]);
const kopfAb = mit.head.indexOf('class="route-plan-sperrung"');
assert.ok(kopfAb > mit.head.indexOf("route-plan-summary__head"), "der Hinweis steht NACH dem Reisetitel:\n" + mit.head);
assert.ok(kopfAb < mit.head.indexOf("route-plan-summary__time"), "und VOR den Zahlen");
assert.ok(mit.head.includes("Wegen einer Sperrung anders geführt"), "oben steht DASS");
assert.ok(mit.head.includes("21,9 Tage länger"), "und wie viel laenger (36,35 − 14,45):\n" + mit.head);
assert.ok(!mit.head.includes("Schattenbachpass"), "🔴 der Weg steht NICHT oben -- keine Aussage zweimal");

// ---- 3. Am Abzweig: WELCHER Weg und WARUM, in genau der Etappe mit der Abzweigkante -------------------
const mitVermerk = mit.legs.map((markup) => markup.includes("route-plan-entry__sperrung"));
assert.deepStrictEqual(mitVermerk, [false, false, true, false], "der Vermerk steht in Etappe 3 (Segment e2)");
assert.ok(mit.legs[2].includes("route-plan-entry--umweg"), "und ihre Perle traegt die Markierung");
assert.ok(!mit.legs[1].includes("route-plan-entry--umweg"), "die anderen nicht");
// Owner 14.09.2026 abends: „die warnung in eine rote box tun wie oben" -- derselbe Kasten, dasselbe Zeichen.
assert.ok(mit.legs[2].includes('class="route-plan-sperrung route-plan-entry__sperrung" role="note"'), "der Vermerk steht im Warnkasten:\n" + mit.legs[2]);
assert.ok(/route-plan-sperrung__zeichen[^>]*>⚠&#xFE0E;<\/span><span class="route-plan-sperrung__text">Gesperrt:/.test(mit.legs[2]), "mit Warnzeichen vor dem Satz");
assert.ok(mit.legs[2].includes("Gesperrt:"), "artikelfrei: " + mit.legs[2]);
assert.ok(mit.legs[2].includes(">Schattenbachpass</button>"), "der Wegname ist ein Knopf");
assert.ok(mit.legs[2].includes('data-public-ids="pub-Q"'), "der auf den Weg zoomt");
assert.ok(mit.legs[2].includes("mit Kutsche nicht befahrbar, nur zu Fuß."), "die Satzform aus path-einschraenkung.js:\n" + mit.legs[2]);
assert.ok(!mit.legs[2].includes("Tage länger"), "🔴 die Mehrzeit steht NICHT am Abzweig");

// ---- 4. Zeitfenster: das Datum und das Fenster, mit den Monatsnamen aus dem Markup -------------------
const fenster = { ...kutsche, avoided: [{ kind: "season", path_name: "Saljethweg", public_ids: ["pub-P1", "pub-P2"], subtype: "Gebirgspass",
	transport: "groupFoot", from_node: "Ceran", reached_on: { month: "firun", day: 3, nameless: false },
	open_from: { month: "peraine", day: 15 }, open_to: { month: "efferd", day: 30 } }] };
const mitFenster = zeichne([fenster]);
assert.ok(mitFenster.legs[2].includes("am 3. Firun, befahrbar vom 15. Peraine bis zum 30. Efferd."), "Zeitfenster:\n" + mitFenster.legs[2]);
assert.ok(mitFenster.legs[2].includes('data-public-ids="pub-P1,pub-P2"'), "beide Abschnitte im Zoom");

// ---- 5. Kuerzeste Route: Mehraufwand in Meilen; zwei Sperren; ein Name ohne Wiki ----------------------
optimize = "shortest";
const kurz = zeichne([kutsche]);
assert.ok(kurz.head.includes("24,0 Meilen länger"), "Kuerzeste nennt Meilen ((20 − 12) × 3):\n" + kurz.head);
optimize = "fastest";
const zwei = zeichne([kutsche, { ...fenster, diverges_at_edge_id: "e0" }]);
assert.ok(zwei.head.includes("Wegen zweier Sperrungen anders geführt"), "zwei Sperren:\n" + zwei.head);
assert.ok(zwei.legs[0].includes("Saljethweg") && zwei.legs[2].includes("Schattenbachpass"), "jede an ihrem eigenen Abzweig");
const namenlos = zeichne([{ ...kutsche, avoided: [{ ...kutsche.avoided[0], path_name: "", subtype: "Seeweg", from_node: "Enqui" }] }]);
assert.ok(namenlos.legs[2].includes("ab Enqui"), "ein namenloser Weg wird ueber seinen Ort beschrieben:\n" + namenlos.legs[2]);
const kreuzung = zeichne([{ ...kutsche, avoided: [{ ...kutsche.avoided[0], path_name: "", subtype: "Seeweg", from_node: "Kreuzung-2777" }] }]);
assert.ok(!kreuzung.legs[2].includes("Kreuzung"), "aber nie ueber eine Kreuzungsnummer:\n" + kreuzung.legs[2]);
const boese = zeichne([{ ...kutsche, avoided: [{ ...kutsche.avoided[0], path_name: "<b>x</b>" }] }]);
assert.ok(!boese.legs[2].includes("<b>x</b>"), "der Name wird escaped");

// ---- 6. Neuzeichnen behaelt den Hinweis (Reisebeginn umgestellt) --------------------------------------
zeichne([kutsche]);
redrawRoutePlan();
assert.ok(prepended.join("").includes("route-plan-sperrung"), "redrawRoutePlan liest die Berichte wieder");

// ---- 8. Der Versatz des Wegpunktpaares zaehlt: dieselbe Kanten-ID in zwei Paaren --------------------
// 💣 Die Karte fragt je Paar, und zwei Paare koennen dieselbe Kante fahren (hin und zurueck ueber denselben
// Weg). Der Bericht von Paar 2 gehoert an Paar 2 -- nie an den ersten Treffer der ID in der ganzen Route.
const doppelteIds = [0, 1, 2, 3].map((index) => ({
	geometry: { type: "LineString", coordinates: [[index * 30, 0], [(index + 1) * 30, 0]] },
	properties: { id: index % 2 === 0 ? "hin" : "weiter", feature_subtype: "Weg", public_id: `d${index}` },
}));
global.getPlannerRestHoursPerDay = () => 16;
global.currentRouteClosures = [{ ...kutsche, diverges_at_edge_id: "hin", segmentOffset: 2, segmentCount: 2 }];
showRoutePlan(routeNames, doppelteIds);
const paarZwei = appended.map((markup) => markup.includes("route-plan-entry__sperrung"));
assert.deepStrictEqual(paarZwei, [false, false, true, false], "der Vermerk steht in Paar 2, nicht am ersten Treffer der ID: " + JSON.stringify(paarZwei));

// ---- 10. Reisebeginn unbekannt: nichts gesperrt, aber die Bitte, den Reisebeginn zu pruefen -----------
// Owner 14.09.2026: „bei ‚Unbekanntem' Reisebeginn keine Sperrungen passieren, aber ein Hinweis kommt, dass
// man die Reisezeit überprüfen sollte".
const saljeth = { path_name: "Saljethweg", public_ids: ["pub-P1", "pub-P2"], subtype: "Gebirgspass", transport: "groupFoot",
	from_node: "Aran", open_from: { month: "peraine", day: 15 }, open_to: { month: "efferd", day: 30 } };
const unbekannt = zeichne([], [saljeth, { ...saljeth }]);
assert.ok(unbekannt.head.includes("Ohne Reisebeginn geplant"), "der Hinweis steht oben:\n" + unbekannt.head);
assert.ok(unbekannt.head.includes(">Saljethweg</button> (befahrbar vom 15. Peraine bis zum 30. Efferd). Bitte den Reisebeginn prüfen."),
	"mit Weg, Fenster und Bitte:\n" + unbekannt.head);
assert.strictEqual((unbekannt.head.match(/Saljethweg/g) || []).length, 1, "derselbe Weg aus zwei Paaren steht EINMAL da");
assert.ok(!unbekannt.legs.join("").includes("route-plan-entry__sperrung") && !unbekannt.legs.join("").includes("--umweg"),
	"und keine Etappe traegt einen Vermerk -- es ist ja nichts umgangen");
const ohneSaisonal = zeichne([], []);
assert.ok(!ohneSaisonal.head.includes("Ohne Reisebeginn geplant"), "ohne solche Wege kein Hinweis");

// ---- 9. Abzweigkante nicht auffindbar: der Hinweis oben bleibt, ein Vermerk wird NICHT geraten --------
global.currentRouteClosures = [{ ...kutsche, diverges_at_edge_id: "gibt-es-nicht" }];
showRoutePlan(routeNames, segments);
assert.ok(prepended.join("").includes("Wegen einer Sperrung anders geführt"), "der Kopf-Hinweis steht trotzdem");
assert.ok(!appended.join("").includes("route-plan-entry__sperrung") && !appended.join("").includes("--umweg"),
	"und keine Etappe bekommt einen geratenen Vermerk");

// ---- 7. Die Absage im Panel --------------------------------------------------------------------------
const absage = routeClosureRefusalMarkup({ start: "Yrramis", end: "Mühlingen", report: { ...fenster, blocked: true, actual: null } });
assert.ok(absage.includes('class="route-plan-absage"'), "die Absage hat ihre Huelle");
assert.ok(absage.includes("Keine offene Route von Yrramis nach Mühlingen"), "sie nennt die Reise:\n" + absage);
assert.ok(absage.includes("Gesperrt:") && absage.includes("am 3. Firun, befahrbar vom 15. Peraine bis zum 30. Efferd."), "und den Grund");

console.log("sperrzeiten-hinweis.test.js: all assertions passed");

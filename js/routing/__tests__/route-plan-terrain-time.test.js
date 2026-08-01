// V11: die ANGEZEIGTE Reisezeit muss den Geländefaktor tragen, den der Router bezahlt hat.
//
// 💣 DER FEHLER, DEN DAS HIER VERHINDERT, WAR LIVE. `buildRoutePlanEntries` rechnet die Stunden aus
// Strecke ÷ Grundtempo neu — und multiplizierte den Strömungsfaktor hinein, den Geländefaktor aber
// nicht. Der Server wählt die Route mit der geländekorrigierten Kantenzeit, der Plan zeigte die
// unkorrigierte. Auf Lowangen→Greifenfurt (live gemessen 2026-08-01) war der streckengewichtete
// Faktor 1,1299 — die Anzeige lag also 13 % unter dem, was der Router selbst gerechnet hat, und die
// Gesamtsumme erbte den Fehler, weil `buildRouteSummary` (route-result.js) die Etappen aufsummiert.
//
// ⭐ Die Regel stand schon im Code, zwei Zeilen über der Fundstelle, nur für die Strömung formuliert:
// „must match the graph edge cost or the shown hours would contradict the chosen route."
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/route-plan-terrain-time.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };

// 🪤 Diese Globals stammen aus js/config.js und werden hier festgenagelt. Fehlt eines, prüft der Test
// den Fallback statt der Regel — `SPEED_TABLE[t]?.[type] || 1` liefert dann klaglos Tempo 1.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.SPEED_TABLE = { groupFoot: { Weg: 3.5, Flussweg: 5.0 } };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.getTransportOption = () => "groupFoot";
// 💣 KEIN Stub für getRoutePlanWaypointNameSet: route-plan.js definiert die Funktion selbst und
// überschreibt jeden Stub, der vor dem Laden gesetzt wird. Der Test bekäme dann die echte Funktion
// mit fehlenden Globals und stürbe an einer ReferenceError — also die echten Eingaben stellen.
global.selectedLocations = [];
global.normalizeLocationSearchName = (value) => String(value || "");
// route-node.js schlägt die Etappennamen in den Kartendaten nach. Leer ist hier richtig: der Test
// prüft die ZEIT, und ohne Treffer fallen die Namen auf die übergebenen Knotennamen zurück.
global.locationData = [];
global.findPathByPublicId = () => null;
// 1 Karteneinheit = 3 Meilen (DISTANCE_SCALING_FACTOR), wie calculateScaledDistance in utils.js.
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;

const load = (relative) => {
	const absolute = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
load("../../app/i18n.js");
global.tr = global.window.tr;
load("../route-node.js");
load("../route-plan.js");

assert.strictEqual(TIME_SCALE_FACTOR, 1.19, "ohne den echten Zeitfaktor prüft der Test nichts");
assert.strictEqual(SPEED_TABLE.groupFoot.Weg, 3.5, "ohne die echte Tempotabelle ebenso");

// Eine Etappe von genau 3 Meilen (1 Karteneinheit) auf einem „Weg".
const leg = (properties) => ({
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	properties: { feature_subtype: "Weg", public_id: "p1", ...properties },
});
const hours = (properties) => {
	const entries = buildRoutePlanEntries(["A", "B"], [leg(properties)]);
	assert.strictEqual(entries.length, 1, "eine Etappe erwartet");
	return entries[0].travelTime;
};

// ---- die Grundlinie: ohne Gelände ändert sich nichts ---------------------------------------------
const flat = (3 / 3.5) * 1.19;
assert.ok(Math.abs(hours({}) - flat) < 1e-12, "ohne Geländefeld bleibt die Zeit unverändert");
assert.ok(Math.abs(hours({ terrain_time_factor: 1 }) - flat) < 1e-12, "Faktor 1,0 ist ein No-op");

// ---- die Regel ------------------------------------------------------------------------------------
// 🔴 DAS IST DER TEST. Vor der Reparatur lieferte er `flat` statt `flat * 2,195`.
assert.ok(
	Math.abs(hours({ terrain_time_factor: 2.195 }) - flat * 2.195) < 1e-12,
	"die angezeigte Zeit trägt den Geländefaktor des Servers"
);
assert.ok(
	Math.abs(hours({ terrain_time_factor: 4 }) - flat * 4) < 1e-12,
	"auch am Deckel 4,0"
);

// ---- Strömung und Gelände multiplizieren sich, sie ersetzen einander nicht -------------------------
// Ein Flussweg trägt nie Gelände (Wasser ist von der Steigung ausgenommen), aber die Rechnung muss
// beide Faktoren durchlassen — sonst überschriebe die eine Reparatur die andere.
const river = buildRoutePlanEntries(["A", "B"], [{
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	properties: { feature_subtype: "Flussweg", public_id: "r1", flow_time_factor: 1.5, terrain_time_factor: 2 },
}]);
assert.ok(
	Math.abs(river[0].travelTime - (3 / 5.0) * 1.19 * 1.5 * 2) < 1e-12,
	"Strömung und Gelände multiplizieren beide auf die Zeit"
);

// ---- Unsinn vom Server darf die Zeit nicht zerstören ----------------------------------------------
// 💣 `|| 1` wäre hier falsch für ascent_schritt (null ≠ 0), für einen FAKTOR ist es richtig: 0 und
// negativ sind keine legitimen Werte, sondern kaputte Zeilen.
[0, -1, NaN, null, undefined, "zwei"].forEach((bad) => {
	assert.ok(
		Math.abs(hours({ terrain_time_factor: bad }) - flat) < 1e-12,
		`ein unbrauchbarer Faktor (${String(bad)}) fällt auf 1,0 zurück statt die Etappe zu verschlucken`
	);
});

console.log("route-plan-terrain-time.test.js: all assertions passed");

// Die Etappen-INFOBOX zeigt alle vier Angaben: Waren · Fauna · Flora · Klimazone (Owner 2026-08-12,
// „zieh etappen nach, die sollen auch alle 4 anzeigen" — „aber nicht im routenplaner sondern im
// infopanel").
//
// 🔴 GEPRUEFT WIRD buildRouteLegPopupHtml, und das ist NUR die Infobox. Die Etappen-ZEILE im
// Reiseplan wird von fillRoutePlanLandscapes gebaut und bleibt unberuehrt — sie ist die Erzaehlung,
// die Infobox der Beleg (map-features-path-landscapes.js, formatLandscapesForPlanner/-ForMapLinks).
// Wer hier eine Zeile ergaenzt und dabei den Planer mitnimmt, hat den Auftrag verfehlt.
//
// Bis 2026-08-12 stand in der Infobox `kinds: "flora|fauna"` (Owner 2026-07-29) und gar keine
// Klimazeile (Entscheid 2026-08-03, „der Routenplaner bekommt keine"). Beides ist hiermit aufgehoben.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = {
	location: { search: "" },
	localStorage: { getItem: () => null, setItem() {} },
	addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
};
global.document = {
	getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {},
};
global.localStorage = global.window.localStorage;
global.MutationObserver = function () { this.observe = () => {}; };
global.AbortController = function () { this.abort = () => {}; this.signal = null; };
// 🪤 Aus js/config.js. Ohne diese Globals prueft der Test den Fallback statt der Regel
// (vm-sandbox-stub-swallows-rule) — dieselbe Falle, die route-plan-offroad-tail.test.js schon nennt.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.THRESHOLD = 0.5;
global.tr = (key, fallback) => fallback;
global.formatDecimalNumber = (value, digits) => Number(value).toFixed(digits);
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");

const load = (relative) => {
	const file = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
};
load("../../app/utils.js");                                   // escapeHtml, echt
load("../../map-features/map-features-ecosystem-naming.js");
load("../../map-features/map-features-climate-row.js");
load("../../map-features/map-features-path-landscapes.js");
load("../../map-features/map-features-lore.js");
load("../route-plan.js");

// Die Infobox-Huelle interessiert hier nicht; geprueft werden die ZEILEN, die hineingereicht werden.
global.locationPopupMarkup = (options) => String(options.actionsMarkup || "");

assert.strictEqual(SYNTHETIC_ROUTE_TYPE, "Querfeldein", "die Konstante muss stimmen, sonst prueft der Test nichts");
assert.strictEqual(typeof buildRouteLegPopupHtml, "function", "der Bauer muss geladen sein");

// Der Speicher, den showRoutePlan beim Zeichnen der Route in EINEM Abruf fuellt.
avesmapsPathLandscapesMerge({
	ok: true,
	stamp: { ecosystem_revision: 1, map_revision: 1 },
	landscapes: {
		"r-weiden": { name: "Weiden", art: "Region", kind: "derographisch", wiki_key: "weiden" },
		"r-forst": { name: "Reichsforst", art: "Wald", kind: "vegetation", wiki_key: "reichsforst" },
		"k-gem": { name: "Gemäßigte Zone", art: "Gemäßigte Zone", kind: "klima", wiki_key: "" },
		"k-sub": { name: "Winterfeuchte Subtropen", art: "Winterfeuchte Subtropen", kind: "klima", wiki_key: "" },
	},
	paths: {
		"p-land": { length: 10, in: [["r-weiden", 10], ["r-forst", 7], ["k-gem", 10]] },
		"p-see": { length: 10, in: [["k-sub", 10]] },
		"p-leer": { length: 10, in: [] },
	},
});

global.currentRouteSegments = [
	{ properties: { public_id: "p-land" } },
	{ properties: { public_id: "p-see" } },
	{ properties: { public_id: "p-leer" } },
];
const leg = (index, label, type) => ({
	segmentLabel: label, type, segmentIndexes: [index],
	startName: "Gareth", endName: "Elenvina", distance: 42.8, travelTime: 9.5, restTime: 0, flowState: null,
});

// ---- 1 · Etappe mit Landschaften UND Klimazone ------------------------------------------------
const land = buildRouteLegPopupHtml(leg(0, "Reichsstraße 2", "Reichsstraße"));

assert.ok(land.indexOf("Führt durch") >= 0, "die Landschaftszeile steht wie bisher da");
assert.ok(land.indexOf('data-lore-fetch="weiden,reichsforst"') >= 0,
	"beide Landschaften der Etappe gehen als EIN Abruf hinaus: " + land);
assert.ok(land.indexOf('data-lore-kinds=""') >= 0,
	"💣 ALLE Arten, kein flora|fauna mehr (Owner 2026-08-12): " + land);
assert.ok(land.indexOf('data-lore-name="Weiden · Reichsforst"') >= 0,
	"der „+N\"-Dialog wird nach den LANDSCHAFTEN benannt, nicht nach der Etappe: " + land);
assert.ok(land.indexOf("Klimazone") >= 0 && land.indexOf("Gemäßigte Zone") >= 0,
	"und die Klimazone hat jetzt ihre Zeile: " + land);

// 💣 Die Klimazone gehoert NICHT in „Führt durch" und NICHT in den Lore-Abruf. Beides waere eine
// Rechengroesse neben zwei Orten bzw. „Flora der Gemaessigten Zone".
const durch = land.slice(land.indexOf("Führt durch"), land.indexOf("Führt durch") + 300);
assert.ok(durch.indexOf("Gemäßigte Zone") < 0, "die Zone steht nicht in der Landschaftszeile: " + durch);
assert.ok(land.indexOf("data-lore-fetch=\"weiden,reichsforst\"") >= 0
	&& land.indexOf("gemaessigt") < 0, "und nicht im Lore-Schluessel");

// 💣 REIHENFOLGE: Führt durch -> Waren/Fauna/Flora -> Klimazone. Vertauscht sieht die Box
// unauffaellig aus (alle Zeilen da, eine an der falschen Stelle) — genau deshalb geprueft.
assert.ok(land.indexOf("Führt durch") < land.indexOf("avesmaps-lore-rows"),
	"„Führt durch\" steht vor den Lore-Zeilen");
assert.ok(land.indexOf("avesmaps-lore-rows") < land.indexOf("avesmaps-climate__row"),
	"💣 die Klimazone steht UNTER Flora, nie darueber (Owner 2026-08-03)");

// ---- 2 · Seeweg: keine Landschaft, aber eine Zone ---------------------------------------------
// 💣 Der Grund, warum die Klimazeile NICHT an `landscapes.length` haengt. Genau hier waere sie das
// Einzige, was die Box zu sagen haette — und genau hier fiele sie weg.
const see = buildRouteLegPopupHtml(leg(1, "", "Seeweg"));
assert.ok(see.indexOf("Führt durch") < 0, "ohne Landschaft keine Landschaftszeile");
assert.ok(see.indexOf("avesmaps-lore-rows") < 0, "und kein Lore-Container, also auch kein Abruf");
assert.ok(see.indexOf("Winterfeuchte Subtropen") >= 0,
	"💣 aber die Klimazone steht da — sonst haette eine Seeetappe gar nichts: " + see);

// ---- 3 · gar keine Zuordnung ------------------------------------------------------------------
const leer = buildRouteLegPopupHtml(leg(2, "", "Querfeldein"));
assert.ok(leer.indexOf("Führt durch") < 0 && leer.indexOf("avesmaps-lore-rows") < 0
	&& leer.indexOf("avesmaps-climate__row") < 0,
	"ohne jede Zuordnung keine der vier Zeilen — kein „keine Angabe\": " + leer);
assert.ok(leer.indexOf("Distanz") >= 0, "die gewoehnlichen Etappenzeilen bleiben aber stehen");

console.log("OK: die Etappen-Infobox zeigt Waren, Fauna, Flora und die Klimazone -- in dieser Reihenfolge");

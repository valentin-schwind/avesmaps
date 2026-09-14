// Der Reisebeginn aendert seit dem 14.09.2026 die ROUTE, nicht nur ihre Anzeige: der Server prueft die
// Zeitfenster der Wege gegen das Datum. Steht eine Route, muss ein Monatswechsel sie NEU SUCHEN -- sonst
// bleibt die alte Route samt altem Sperrhinweis stehen. Ohne Route bleibt es beim Neuzeichnen.
// Entwurf docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md.
//
// ⭐ AUSGEFUEHRT: map-features-waypoints.js wird mit einem gefaelschten document geladen, der echte
// `change`-Zuhoerer an der Monatswahl wird gerufen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/reisebeginn-sucht-neu.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const zuhoerer = {};
const element = (id) => ({
	id,
	value: "",
	disabled: false,
	addEventListener(typ, fn) { zuhoerer[`${id}:${typ}`] = fn; },
});
const monat = element("travelStartMonth");
const tag = element("travelStartDay");
global.document = {
	readyState: "complete",
	getElementById: (id) => (id === "travelStartMonth" ? monat : id === "travelStartDay" ? tag : null),
	addEventListener(typ, fn) { zuhoerer[`document:${typ}`] = fn; },
	querySelectorAll: () => [],
};
global.window = { addEventListener() {} };

let neuGesucht = 0;
let neuGezeichnet = 0;
global.updateMapView = () => { neuGesucht += 1; };
global.redrawRoutePlan = () => { neuGezeichnet += 1; };
global.currentRouteSegments = [];

const datei = path.join(__dirname, "..", "map-features-waypoints.js");
vm.runInThisContext(fs.readFileSync(datei, "utf8"), { filename: datei });

assert.strictEqual(typeof zuhoerer["travelStartMonth:change"], "function", "die Monatswahl hat ihren Zuhoerer");
assert.strictEqual(typeof zuhoerer["travelStartDay:change"], "function", "der Tag auch");

// ---- 1. Ohne Route: nur neu zeichnen (das tut dann von sich aus nichts) ------------------------------
monat.value = "firun";
zuhoerer["travelStartMonth:change"]();
assert.strictEqual(neuGesucht, 0, "ohne Route wird nichts gesucht");
assert.strictEqual(neuGezeichnet, 1, "sondern neu gezeichnet");

// ---- 2. Mit Route: NEU SUCHEN, nicht nur zeichnen -----------------------------------------------------
global.currentRouteSegments = [{ properties: { id: "e1" } }];
monat.value = "praios";
zuhoerer["travelStartMonth:change"]();
assert.strictEqual(neuGesucht, 1, "ein Monatswechsel sucht die stehende Route neu");
assert.strictEqual(neuGezeichnet, 1, "und zeichnet nicht zusaetzlich die alte");
zuhoerer["travelStartDay:change"]();
assert.strictEqual(neuGesucht, 2, "ein Tageswechsel ebenso");

// ---- 3. Der Tag bleibt ohne Monat ausgegraut ----------------------------------------------------------
monat.value = "";
zuhoerer["travelStartMonth:change"]();
assert.strictEqual(tag.disabled, true, "ohne Monat ist der Tag ausgegraut");

console.log("reisebeginn-sucht-neu.test.js: all assertions passed");

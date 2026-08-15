const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Wegpunktsuche bietet versteckte Orte an -- gekennzeichnet. Sie ist eine SUCHE, kein Scrollen
// ueber die Karte; waere sie strenger als das Spotlight, waeren die beiden Wege ungleich streng.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/wegpunkt-versteckt-label.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-waypoints.js"), "utf8");
const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in map-features-waypoints.js gefunden -- umbenannt?`);
	return match[0];
};

const context = { String, Boolean, Array, Object, tr: (key, fallback) => fallback };
vm.runInNewContext(extract("waypointSuggestionLabel"), context);
const { waypointSuggestionLabel } = context;

assert.strictEqual(waypointSuggestionLabel("Gareth", {}), "Gareth", "ein gewoehnlicher Ort steht blank da");
assert.strictEqual(waypointSuggestionLabel("Gareth", null), "Gareth", "und ein fehlender Eintrag aendert nichts");
assert.strictEqual(waypointSuggestionLabel("Feenplatz", { isHidden: true }), "Feenplatz (verborgen)");

// 💣 EINE KLAMMER, NICHT ZWEI (Owner 15.08.2026). Ein Innerorts-Objekt fuehrt zur STADT -- die
// Klammer nennt sie, und „verborgen" beschreibt dieselbe Stadt. Zwei Klammern hintereinander
// („(Imdal) (verborgen)") lesen sich wie zwei Aussagen ueber zwei Dinge.
assert.strictEqual(
	waypointSuggestionLabel("Schänke Schnapsfass (Imdal)", { isHidden: true }),
	"Schänke Schnapsfass (Imdal · verborgen)",
	"die Kennzeichnung geht IN die vorhandene Klammer",
);
// ⚠️ Und nur in eine Klammer ganz am Ende. Steht sie mitten im Namen, waere das Anhaengen dort ein
// Eingriff in den Namen selbst.
assert.strictEqual(
	waypointSuggestionLabel("Burg (alt) am See", { isHidden: true }),
	"Burg (alt) am See (verborgen)",
	"eine Klammer mitten im Namen bleibt unberuehrt",
);

// --- das Innerorts-Objekt erbt die Frage von seinem ZIEL -------------------------------------------
// 🔴 Sein Wegpunkt ist die STADT, nicht das Objekt. Ist die Stadt versteckt, sagt die Zeile das --
// sonst fuehren mehrere unbeschriftete Vorschlaege an denselben versteckten Ort wie der eine
// beschriftete daneben (live gesehen: drei Objekte in Warunk).
assert.ok(
	/isHidden: versteckteOrtsnamen\.has\(/.test(source),
	"die Innerorts-Eintraege muessen den Verborgen-Zustand ihrer Stadt uebernehmen",
);
assert.ok(
	/label: waypointSuggestionLabel\(waypointInSettlementLabel\(/.test(source),
	"und der Innerorts-Zweig muss durch denselben Kennzeichner laufen",
);

// --- der Eintrag muss das Merkmal ueberhaupt TRAGEN ----------------------------------------------
// 💣 getWaypointAutocompleteEntries baute bis zum 15.08.2026 {name, normalizedName} -- das
// location-Objekt fiel schon im ersten .map() weg. Ohne diese Zeile hiesse `entry.isHidden` immer
// `undefined`, der Test oben bliebe gruen und die Liste kennzeichnete nie etwas.
assert.ok(
	/isHidden: Boolean\(loc\?\.isHidden\)/.test(source),
	"getWaypointAutocompleteEntries muss isHidden mitfuehren",
);
assert.ok(
	/label: waypointSuggestionLabel\(match\.entry\.name, match\.entry\)/.test(source),
	"die Vorschlagsliste muss waypointSuggestionLabel mit dem EINTRAG aufrufen",
);

// ⚠️ Die Regel „niemals einen blanken String" (jQuery UI normalisiert die Liste am ERSTEN Eintrag)
// haengt an js/map-features/__tests__/waypoint-autocomplete-items.test.js -- sie wird hier nicht
// zweitgeprueft, nur nicht gebrochen: beide Zweige geben weiterhin {label, value} zurueck.

console.log("wegpunkt-versteckt-label: all asserts passed");

"use strict";
// Der Gruppenschluessel der Karte bildet denselben Weg wie der Wege-Editor (Entwurf 2026-09-14 §3.2).
// Aus der Wurzel: node js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");

function schneide(quelle, name) {
	const start = quelle.indexOf("\nfunction " + name + "(");
	assert.ok(start >= 0, name + " nicht gefunden -- umbenannt?");
	const ende = quelle.indexOf("\n}\n", start);
	return quelle.slice(start, ende + 3);
}

// Die Voraussetzung, auf der der Fehler beruht: im Browser ist properties.name der Maschinenname.
assert.ok(/name:\s*`\$\{routeType\}-\$\{pathId\}`/.test(lies("js", "map-features", "map-features-path-prepare.js")),
	"Voraussetzung: normalizeRoutePathFeature schreibt `<Wegart>-<n>` nach properties.name");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(schneide(lies("js", "map-features", "path-einschraenkung.js"), "avesmapsWegGruppenSchluessel"), ctx);
const schluessel = (p) => vm.runInContext("avesmapsWegGruppenSchluessel", ctx)(p);
const model = require(path.join(WURZEL, "js", "pages", "wege-editor-model.js"));

const normalisiert = (maschine) => ({ properties: {
	feature_subtype: "Strasse", name: maschine, display_name: "Alte Straße", original_name: "Alte Straße" } });
const k1 = schluessel(normalisiert("Strasse-17"));
const k2 = schluessel(normalisiert("Strasse-18"));
assert.strictEqual(k1, k2, "zwei Abschnitte derselben unzugewiesenen Strasse bilden EINE Gruppe: " + k1 + " / " + k2);
assert.strictEqual(k1, model.wpGroupKeyOf({ feature_subtype: "Strasse", name: "Alte Straße" }),
	"und dieselbe Gruppe wie im Wege-Editor (paths-editor.php schickt display_name als name)");

assert.strictEqual(schluessel({ properties: { feature_subtype: "Reichsstrasse", name: "Reichsstrasse-3",
	display_name: "Reichsstraße 2", wiki_path: { wiki_key: "reichsstrasse-2" } } }), "wiki:reichsstrasse-2");
assert.strictEqual(schluessel({ properties: { feature_subtype: "Pfad", name: "Goblinpfad" } }), "name:Pfad:Goblinpfad",
	"eine rohe Nutzlast ohne display_name faellt auf name zurueck");

console.log("weg-gruppenschluessel-echter-name.test.js: ok");

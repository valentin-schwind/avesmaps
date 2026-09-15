"use strict";
// Der Gruppenschluessel der Karte bildet denselben Weg wie der Wege-Editor (Entwurf 2026-09-14 §3.2) -- seit 15.09.2026 ueber den
// ECHTEN NAMEN (Owner: „die selektion soll ausdrücklich über den namen - nicht über die wiki-zuweisung erfolgen").
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

// Die echten Teile: der Schluessel der Karte, der Namensleser der Infobox (ohne den Maschinennamen-Test -- den faehrt
// js/pages/__tests__/wege-gruppe-gleicher-name.test.js mit) und das Modell.
const ctx = {};
vm.createContext(ctx);
vm.runInContext(lies("js", "pages", "wege-editor-model.js"), ctx);
vm.runInContext(schneide(lies("js", "map-features", "map-features-path-domain.js"), "getPathTitleName"), ctx);
vm.runInContext(schneide(lies("js", "map-features", "path-einschraenkung.js"), "avesmapsWegGruppenSchluessel"), ctx);
const schluessel = (p) => vm.runInContext("avesmapsWegGruppenSchluessel", ctx)(p);
const model = require(path.join(WURZEL, "js", "pages", "wege-editor-model.js"));

const normalisiert = (id, maschine, extra) => ({ properties: Object.assign({
	public_id: id, feature_subtype: "Strasse", name: maschine, display_name: "Alte Straße", original_name: "Alte Straße" }, extra || {}) });
const k1 = schluessel(normalisiert("a", "Strasse-17"));
const k2 = schluessel(normalisiert("b", "Strasse-18"));
assert.strictEqual(k1, k2, "zwei Abschnitte derselben unzugewiesenen Strasse bilden EINE Gruppe: " + k1 + " / " + k2);
assert.strictEqual(k1, model.wpGroupKeyOf({ public_id: "a", feature_subtype: "Strasse", name: "Alte Straße", echter_name: "Alte Straße" }),
	"und dieselbe Gruppe wie im Wege-Editor (paths-editor.php schickt den echten Namen als echter_name)");

// 🔴 Owner 15.09.2026: die Wiki-Zuweisung trennt nicht mehr -- und die Wegart auch nicht.
assert.strictEqual(schluessel(normalisiert("c", "Reichsstrasse-3", { feature_subtype: "Reichsstrasse", display_name: "Alte Straße",
	wiki_path: { wiki_key: "alte-strasse", name: "Alte Straße" } })), k1, "mit Wiki-Zuweisung und anderer Wegart derselbe Weg");

// 💣 Nie properties.name: ohne display_name/original_name hat der Weg fuer die Karte keinen echten Namen. Im Browser setzt
// normalizeRoutePathFeature display_name immer -- eine rohe Nutzlast ist hier nur die Gegenprobe gegen einen Rueckfall auf `name`.
assert.strictEqual(schluessel({ properties: { public_id: "g", feature_subtype: "Pfad", name: "Goblinpfad" } }), "abschnitt:g",
	"eine rohe Nutzlast ohne display_name faellt NICHT auf name zurueck");

console.log("weg-gruppenschluessel-echter-name.test.js: ok");

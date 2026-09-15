"use strict";
// Eine leer gewordene Liste bleibt `[]` (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.2).
// AUSGEFUEHRT: applyPathFeatureResponse (der Live-Merge) wird aus map-features-path-lifecycle.js geschnitten.
// Aus der Wurzel: node js/map-features/__tests__/weg-weitere-leere-liste.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt nicht gefunden: " + anfang);
	return text.slice(a, e);
};

// ---- 1. Der Befund: ein FEHLENDER Schluessel ueberlebt den Merge, ein leeres Array nicht --------------------
const kontext = vm.createContext({
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	getPathPublicId: (p) => p.properties.public_id,
	getPathDisplayName: (p) => p.properties.display_name,
	avesmapsWegEinschraenkungNeuRechnen: () => {},
	updatePathLayerGeometry: () => {},
	updatePathLayerStyle: () => {},
	refreshPathLayerPopup: () => {},
	refreshPlannerAfterFeatureChange: () => {},
});
vm.runInContext(schneide(lies("js/map-features/map-features-path-lifecycle.js"),
	"function applyPathFeatureResponse(path, feature) {", "\nfunction removePathFeature"), kontext);
const merge = vm.runInContext("applyPathFeatureResponse", kontext);

const bp = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const lokal = () => ({ id: "rs-7", geometry: { coordinates: [[0, 0], [1, 0]] },
	properties: { public_id: "rs-7", display_name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", wiki_path_weitere: [bp] } });
const delta = (weitere) => {
	const properties = { public_id: "rs-7", display_name: "Reichsstraße 2", feature_subtype: "Reichsstrasse" };
	if (weitere !== undefined) { properties.wiki_path_weitere = weitere; }
	return { id: "rs-7", geometry: { coordinates: [[0, 0], [1, 0]] }, properties };
};

const alt = lokal();
merge(alt, delta(undefined));
assert.strictEqual(alt.properties.wiki_path_weitere.length, 1,
	"Voraussetzung des Befunds: ein fehlender Schluessel ueberschreibt beim Spread-Merge nichts");

const neu = lokal();
merge(neu, delta([]));
assert.ok(Array.isArray(neu.properties.wiki_path_weitere) && neu.properties.wiki_path_weitere.length === 0,
	"ein leeres Array aus dem Delta ueberschreibt die alte Liste -- deshalb schreibt der Server `[]`");

// ---- 2. Jeder JS-Leser liest `[]` als „keine“ ----------------------------------------------------------------
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
assert.deepStrictEqual(M.wpWeitereNamen({ wiki_path_weitere: [] }), []);
assert.strictEqual(M.wpWegPasstZurSuche({ name: "Reichsstraße 2", wiki_path_weitere: [] }, "bären"), false);
const A = require(path.join(WURZEL, "js/map-features/weg-auswahl.js"));
assert.strictEqual(A.avesmapsWegTraegtWeiteren({ wiki_path_weitere: [] }, "b-renpfad"), false);
const K = require(path.join(WURZEL, "js/ui/wiki-weitere-kasten.js"));
assert.deepStrictEqual(K.avesmapsWikiWeitereZuordnungen([{ public_id: "rs-7", label: "A", wiki_path_weitere: [] }], "ganze Straße"), []);

// ---- 3. Der Server schreibt `[]` (die Ausfuehrung prueft path-weitere-test.php; hier die Rueckbau-Probe) -------
const php = lies("api/_internal/wiki/path-weitere.php").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(!/unset\(\$properties\[AVESMAPS_WIKI_PATH_WEITERE_FELD\]\)/.test(php),
	"avesmapsWikiPathWeitereEntfernen loescht die leere Liste wieder -- der Live-Abgleich anderer Editoren behielte den Artikel");

console.log("weg-weitere-leere-liste.test.js: ok");

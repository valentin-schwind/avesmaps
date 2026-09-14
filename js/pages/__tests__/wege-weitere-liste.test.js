"use strict";
// Wege-Editor-Liste: weitere Zuweisungen und stabile Nummerierung (Entwurf 2026-09-14 §2.4, §4).
// Aus der Wurzel: node js/pages/__tests__/wege-weitere-liste.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../wege-editor-model.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");

// 1. Sortierung: Rundungsrauschen kippt keinen Gleichstand, die Kennung entscheidet.
const zeile = (id, x, y) => ({ public_id: id, name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", bbox: [x, y, 0, 0] });
const reihenfolge = (ways) => M.wpGroupWays(ways)[0].segments.map((s) => s.public_id);
assert.deepStrictEqual(reihenfolge([zeile("b", 10.0004, 5), zeile("a", 10.0001, 5)]), ["a", "b"]);
assert.deepStrictEqual(reihenfolge([zeile("b", 10.0001, 5), zeile("a", 10.0004, 5)]), ["a", "b"],
	"dieselbe Reihenfolge, egal welcher der beiden Werte minimal groesser ist -- Spalten und Geometrie weichen um <= 0,001 ab");
assert.deepStrictEqual(reihenfolge([zeile("a", 11, 5), zeile("z", 9, 5)]), ["z", "a"], "echte Unterschiede sortieren weiter");
assert.deepStrictEqual(reihenfolge([zeile("a", 9, 7), zeile("z", 9, 5)]), ["z", "a"], "bei gleichem x entscheidet y");

// 2. Weitere Namen und Suche
const way = { name: "Reichsstraße 2", wiki_path_weitere: [{ wiki_key: "b-renpfad", name: "Bärenpfad" }, { wiki_key: "x", name: "" }, null] };
assert.deepStrictEqual(M.wpWeitereNamen(way), ["Bärenpfad", "x"], "ohne Namen der Schluessel, kaputte Eintraege fallen weg");
assert.deepStrictEqual(M.wpWeitereNamen({ name: "Pfad" }), []);
assert.strictEqual(M.wpWegPasstZurSuche(way, "bären"), true, "die Suche findet den Abschnitt ueber den weiteren Namen");
assert.strictEqual(M.wpWegPasstZurSuche(way, "reichs"), true);
assert.strictEqual(M.wpWegPasstZurSuche(way, "geron"), false);
assert.strictEqual(M.wpWegPasstZurSuche(way, ""), true);

// 3. Verdrahtung (Kommentare entfernt, sonst trifft die Suche die Warnung statt des Codes)
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const editor = ohneKommentare(lies("js/pages/wege-editor.js"));
const rumpf = (quelle, kopf) => {
	const start = quelle.indexOf(kopf);
	assert.ok(start >= 0, kopf + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1);
	}
	throw new Error("Rumpf nicht geschlossen: " + kopf);
};
assert.ok(rumpf(editor, "function matchesFilters(way)").includes("wpWegPasstZurSuche(way, state.query)"), "die Suche nutzt wpWegPasstZurSuche");
assert.ok(rumpf(editor, "function segmentRow(way, index, group)").includes("wpWeitereNamen(way)"), "die Abschnittszeile nennt die weiteren Namen");
const php = lies("api/edit/map/paths-editor.php");
assert.ok(php.includes("require_once __DIR__ . '/../../_internal/wiki/path-weitere.php';"));
assert.ok(/'wiki_path_weitere'\s*=>\s*array_map\(/.test(php), "die Liste schickt wiki_path_weitere mit");

console.log("wege-weitere-liste.test.js: ok");

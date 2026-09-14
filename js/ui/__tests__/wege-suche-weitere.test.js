"use strict";
// Spotlight: ein Abschnitt gehoert auch zum Eintrag seiner weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.4).
// Aus der Wurzel: node js/ui/__tests__/wege-suche-weitere.test.js
//
// 🪤 Arrays aus dem vm-Kontext tragen einen FREMDEN Array-Prototyp -- deepStrictEqual gegen ein Host-Array
// faellt bei zeichengleichem Inhalt. Deshalb werden sie vor dem Vergleich in den Testkontext kopiert (`[...x]`).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8").replace(/\r\n/g, "\n");
const schneide = (name) => {
	const treffer = quelle.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, name + " nicht gefunden");
	return treffer[0] + "\n";
};

const kontext = {
	Map, String, Array,
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	getPathTitleName: (p) => (p.properties.wiki_path && p.properties.wiki_path.name) || p.properties.display_name || "",
	getPathDisplayName: (p) => p.properties.display_name || "",
	getSpotlightPathTypeLabel: (p, subtype) => subtype,
	normalizeSpotlightSearchText: (wert) => String(wert || "").toLowerCase(),
	extendSpotlightBounds: () => null,
	getSpotlightPathBounds: () => null,
	getPathPublicId: (p) => p.properties.public_id,
	pathData: [],
};
vm.createContext(kontext);
vm.runInContext(schneide("getSpotlightPathGroupKey") + schneide("getSpotlightPathGroupKeyForPath") + schneide("buildSpotlightPathEntries"), kontext);

const weg = (id, subtype, haupt, weitere) => ({ properties: { public_id: id, feature_subtype: subtype, display_name: haupt.name,
	wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: "https://x/" + haupt.key }, wiki_path_weitere: weitere } });
const rs = { key: "reichsstrasse-2", name: "Reichsstraße 2" };
const bpEintrag = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/b-renpfad" };
kontext.pathData = [
	weg("rs-7", "Reichsstrasse", rs, [bpEintrag]),      // traegt den Baerenpfad zusaetzlich, steht ZUERST
	weg("bp-1", "Pfad", { key: "b-renpfad", name: "Bärenpfad" }, []),
	weg("rs-6", "Reichsstrasse", rs, [{ wiki_key: "geronsgang", name: "Geronsgang", wiki_url: "https://x/geronsgang" }]),
];
const liste = (x) => [...x];
const eintraege = Array.from(vm.runInContext("buildSpotlightPathEntries()", kontext));
const nach = (id) => eintraege.find((e) => e.id === id);

assert.deepStrictEqual(liste(nach("path:wiki:reichsstrasse-2").publicIds), ["rs-7", "rs-6"]);
const bp = nach("path:wiki:b-renpfad");
assert.deepStrictEqual(liste(bp.paths.map((p) => p.properties.public_id)), ["bp-1", "rs-7"], "der Baerenpfad umfasst seinen Traeger");
assert.deepStrictEqual(liste(bp.publicIds), ["bp-1"], "Traeger stehen NICHT in publicIds (first writer wins)");
assert.strictEqual(bp.subtype, "Pfad", "der Wegtyp kommt von den eigenen Abschnitten, nicht vom zuerst gelesenen Traeger");
const geron = nach("path:wiki:geronsgang");
assert.ok(geron && geron.name === "Geronsgang" && geron.subtype === "Reichsstrasse", "ein Artikel NUR aus weiteren Zuweisungen bekommt einen Eintrag");
assert.deepStrictEqual(liste(geron.publicIds), []);

// Die Aufloesung von Servertreffern: wiki_key zuerst
const ohne = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const aufloesen = ohne(schneide("resolveBackendSpotlightEntries"));
const lookup = ohne(schneide("getSpotlightSearchLookup"));
assert.ok(/byPathWikiKey\.set\(/.test(lookup) && lookup.includes('"path:wiki:"'), "der Index kennt Wegeintraege nach Artikel");
assert.ok(aufloesen.indexOf("byPathWikiKey.get(") >= 0 && aufloesen.indexOf("byPathWikiKey.get(") < aufloesen.indexOf("byPublicId.get("),
	"ein Wegtreffer mit wiki_key wird VOR der Kennungssuche ueber den Artikel aufgeloest");

console.log("wege-suche-weitere.test.js: ok");

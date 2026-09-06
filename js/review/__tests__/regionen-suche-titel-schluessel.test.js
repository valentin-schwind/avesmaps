// Die Suche im Regionen-Reiter des WikiSync-Panels findet eine Region auch unter ihrem
// ARTIKELTITEL, ihren Synonymen und ihrem Schluessel -- nicht nur unter dem Infobox-Namen.
//
// Der Fall (Owner 06.09.2026): „Südperricum" traegt im Wiki |Name=Perricumer Land. Die Zeile
// stand als „Perricumer Land" im Reiter „Platziert", und wer „Südperricum" tippte, sah nichts --
// der Filter verglich nur name, art, region_parent und affiliation_staat. Owner: „titel und
// synonyme in die suche, wichtig ist der key".
//
// 🔴 Die Suche steht an ZWEI Stellen (Liste und Typ-Filter-Zaehler); beide muessen dasselbe
// Praedikat fragen, sonst zaehlt der Typ-Filter andere Treffer, als die Liste zeigt. Deshalb
// wird hier nicht nur das Praedikat gefahren, sondern BEIDE Aufrufer -- gegen die echte Datei
// in einer vm-Sandbox, nicht gegen eine abgeschriebene Kopie der Regel.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/regionen-suche-titel-schluessel.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "review-region-sync.js"), "utf8");

// Das Modul haengt beim Laden Zuhoerer ans Dokument und ruft attachFilterMenu -- Attrappen ohne
// Proxy, damit ein Bezeichner, den es nicht gibt, wirklich wirft (die Lehre aus 34aeeba23).
let filterWert = "";
const document = {
	addEventListener() {},
	getElementById(id) {
		return id === "region-sync-filter" ? { value: filterWert } : null;
	},
};
const sandbox = {
	console,
	fetch: () => Promise.reject(new Error("kein Netz im Test")),
	document,
	window: {},
	attachFilterMenu() {},
	SOURCE_FILTER_OPTIONS: [],
	getItemSourceCategory: () => "",
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-region-sync.js" });

let checks = 0;

// ---- Das Praedikat ----------------------------------------------------------------------------
const regionRowMatchesSearch = sandbox.regionRowMatchesSearch;
assert.strictEqual(typeof regionRowMatchesSearch, "function", "regionRowMatchesSearch ist geladen");
checks++;

// Die Zeile, wie der Endpunkt sie fuer Suedperricum liefert.
const suedperricum = {
	wiki_key: "s-dperricum",
	title: "Südperricum",
	name: "Perricumer Land",
	synonyms: ["Südperricum"],
	art: "Mischregion",
	continent: "Aventurien",
	region_parent: "Mittelaventurien: Perricum",
	affiliation_staat: "Mittelreich, Markgrafschaft Perricum",
	wiki_url: "https://de.wiki-aventurica.de/wiki/S%C3%BCdperricum",
};

assert.strictEqual(regionRowMatchesSearch(suedperricum, "südperricum"), true, "der Artikeltitel trifft");
assert.strictEqual(regionRowMatchesSearch(suedperricum, "s-dperricum"), true, "der Schluessel trifft (Owner: wichtig ist der key)");
assert.strictEqual(regionRowMatchesSearch(suedperricum, "perricumer"), true, "der Name trifft weiterhin");
assert.strictEqual(regionRowMatchesSearch(suedperricum, "mischregion"), true, "die Art trifft weiterhin");
assert.strictEqual(regionRowMatchesSearch(suedperricum, "mittelaventurien"), true, "die Oberregion trifft weiterhin");
assert.strictEqual(regionRowMatchesSearch(suedperricum, "markgrafschaft"), true, "der Staat trifft weiterhin");
assert.strictEqual(regionRowMatchesSearch(suedperricum, "nordperricum"), false, "was nirgends steht, trifft nicht");
checks += 7;

// 🪤 Titel und Synonym EINZELN: der Parser legt den Artikeltitel auch in die Synonyme, sobald er
// vom Namen abweicht -- an der Zeile oben traegt also das Synonym mit, und ein gestrichenes
// `row.title` fiele nicht auf (Mutationsprobe 06.09.2026, ueberlebt). Hier kann nur der Titel treffen:
const nurTitel = { wiki_key: "k", title: "Südperricum", name: "Perricumer Land", synonyms: [], art: "" };
assert.strictEqual(regionRowMatchesSearch(nurTitel, "südperricum"), true, "der Titel trifft auch ohne Synonym");
// ... und hier nur das Synonym:
const mitSynonym = { wiki_key: "k", title: "K", name: "N", synonyms: ["Perricumer Lande"], art: "" };
assert.strictEqual(regionRowMatchesSearch(mitSynonym, "lande"), true, "ein Synonym trifft auch ohne Titel");
checks += 2;

// Gross/klein ist egal, und der Suchtext kommt ungetrimmt aus dem Feld.
assert.strictEqual(regionRowMatchesSearch(suedperricum, "SÜDPERRICUM"), true, "Grossschreibung im Suchtext");
checks++;

// ⚠️ Eine ALTE Zeile ohne title/synonyms (Server noch nicht nachgezogen, oder eine map-only-Zeile,
// die nur name/wiki_key traegt) darf nicht werfen und trifft weiter ueber den Namen.
const alt = { name: "Perricumer Land", wiki_key: "", art: "", region_parent: "", continent: "Aventurien", map_only: true };
assert.strictEqual(regionRowMatchesSearch(alt, "perricumer"), true, "alte Zeile: Name trifft");
assert.strictEqual(regionRowMatchesSearch(alt, "südperricum"), false, "alte Zeile: kein Phantomtreffer");
assert.strictEqual(regionRowMatchesSearch({ name: "X", synonyms: "kein array" }, "x"), true, "synonyms als Nicht-Liste wirft nicht");
checks += 3;

// Leerer Suchtext trifft alles -- das ist der Zustand vor dem ersten Tastendruck.
assert.strictEqual(regionRowMatchesSearch(alt, ""), true, "leer trifft alles");
assert.strictEqual(regionRowMatchesSearch(alt, "   "), true, "nur Leerzeichen ebenso");
checks += 2;

// ---- Aufrufer 1: die Liste (regionRowMatchesFilters) --------------------------------------------
// Liest den Suchtext aus dem Feld -- ueber die Dokument-Attrappe oben.
filterWert = "Südperricum";
assert.strictEqual(sandbox.regionRowMatchesFilters(suedperricum), true,
	"die Liste findet Suedperricum ueber den Artikeltitel");
filterWert = "s-dperricum";
assert.strictEqual(sandbox.regionRowMatchesFilters(suedperricum), true,
	"die Liste findet Suedperricum ueber den Schluessel");
filterWert = "Nordperricum";
assert.strictEqual(sandbox.regionRowMatchesFilters(suedperricum), false,
	"die Liste zeigt keinen Phantomtreffer");
checks += 3;

// ---- Aufrufer 2: der Typ-Filter-Zaehler (regionTypeOptions) --------------------------------------
// `regionSyncData` ist ein top-level `let` des Moduls: von aussen nur ueber ein zweites Skript im
// selben Kontext erreichbar (gemeinsamer globaler Lexikalraum), nicht ueber `sandbox.regionSyncData`.
sandbox.__zeilen = [suedperricum, { ...alt, art: "Wald", name: "Nordperricumer Forst" }];
vm.runInContext("regionSyncData = { missing: __zeilen, matched: [], ambiguous: [] };", sandbox);

// 🪤 Ein Array aus dem vm-Kontext traegt einen FREMDEN Array-Prototyp; deepStrictEqual gegen ein
// Host-Array faellt dann bei zeichengleichem Inhalt. Array.from (im Host gerufen) baut ein Host-Array.
const artenZaehler = () => Array.from(sandbox.regionTypeOptions(), (o) => [o.value, o.count]).sort();
filterWert = "Südperricum";
assert.deepStrictEqual(artenZaehler(), [["Mischregion", 1]], "der Typ-Filter zaehlt den Titel-Treffer -- und nur ihn");
filterWert = "s-dperricum";
assert.deepStrictEqual(artenZaehler(), [["Mischregion", 1]], "der Typ-Filter zaehlt den Schluessel-Treffer");
filterWert = "perricum";
assert.deepStrictEqual(artenZaehler(), [["Mischregion", 1], ["Wald", 1]],
	"beide Zeilen tragen 'perricum' irgendwo -- beide Arten zaehlen");
filterWert = "";
checks += 3;

// ---- Ein Praedikat, nicht zwei Abschriften --------------------------------------------------------
// 💣 Vor dem Umbau stand dieselbe Feldliste zweimal in der Datei. Wer eine Stelle nachzieht und die
// andere nicht, bekommt einen Typ-Filter, der andere Treffer zaehlt, als die Liste zeigt.
const abschriften = source.match(/\[\s*row\.name\s*,\s*row\.art\s*,\s*row\.region_parent/g) || [];
assert.strictEqual(abschriften.length, 0,
	"die alte Feldliste [row.name, row.art, row.region_parent, ...] steht noch in der Datei -- "
	+ "beide Aufrufer muessen regionRowMatchesSearch fragen");
checks++;

console.log(`regionen-suche-titel-schluessel: ${checks} Zusicherungen bestanden`);

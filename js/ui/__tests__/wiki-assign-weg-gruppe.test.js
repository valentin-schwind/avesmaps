"use strict";
// Die Rumpf- und Textbauer fuer die GANZE Strasse (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6).
// Aus der Wurzel: node js/ui/__tests__/wiki-assign-weg-gruppe.test.js
const assert = require("assert");
const W = require("../wiki-assign-weg.js");

// Ohne Liste: der Rumpf wie bisher, zeichengleich
assert.deepStrictEqual(W.avesmapsWikiAssignWegZuweisungsKoerper("reichsstrasse-2", "rs-7"),
	{ action: "assign_to", wiki_key: "reichsstrasse-2", public_id: "rs-7", dry_run: false, confirm: "apply" });
assert.ok(!("public_ids" in W.avesmapsWikiAssignWegZuweisungsKoerper("reichsstrasse-2", "rs-7", ["rs-7"])),
	"ein einzelner Abschnitt bekommt keine public_ids -- er ist kein Gruppenschreiben");

// Mit Liste: der Anker vorn, keine Dubletten
assert.deepStrictEqual(W.avesmapsWikiAssignWegZuweisungsKoerper(" reichsstrasse-2 ", "rs-7", ["rs-6", "rs-7", " rs-8 ", "rs-6", ""]),
	{ action: "assign_to", wiki_key: "reichsstrasse-2", public_id: "rs-7", dry_run: false, confirm: "apply", public_ids: ["rs-7", "rs-6", "rs-8"] });
assert.deepStrictEqual(W.avesmapsWikiAssignWegGruppenIds("rs-7", ["rs-6", "rs-7"]), ["rs-7", "rs-6"]);
assert.strictEqual(W.avesmapsWikiAssignWegGruppenIds("rs-7", null), null);
assert.strictEqual(W.avesmapsWikiAssignWegGruppenIds("rs-7", ["rs-7", " rs-7 "]), null);

// Loesen der ganzen Strasse: public_ids, ohne Trockenlauf-Rueckfrage
assert.deepStrictEqual(W.avesmapsWikiAssignWegLoesenKoerper("rs-7", ["rs-6", "rs-7", "rs-8"]),
	{ action: "clear_assign", public_id: "rs-7", public_ids: ["rs-7", "rs-6", "rs-8"], dry_run: false, confirm: "apply" });
assert.deepStrictEqual(W.avesmapsWikiAssignWegLoesenKoerper("rs-7", []).public_ids, ["rs-7"], "zur Not genau der Anker");
assert.ok(!("single_segment" in W.avesmapsWikiAssignWegLoesenKoerper("rs-7", ["rs-6", "rs-7"])), "single_segment und public_ids schliessen sich aus (§9.6)");

// Die EINE Frage nennt Name, Zahl und Folge
const frage = W.avesmapsWikiAssignWegGruppeLoesenFrage("Reichsstraße 2", 10);
assert.ok(frage.includes("„Reichsstraße 2“") && frage.includes("allen 10 Abschnitten") && frage.includes("zerfällt"), frage);

console.log("wiki-assign-weg-gruppe.test.js: ok");

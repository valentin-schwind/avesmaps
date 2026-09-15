"use strict";
// Die Rumpf- und Textbauer fuer die GANZE Strasse (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6) und -- seit
// Lieferung 2 (Owner 15.09.2026: „Je Zeile bearbeitbar") -- fuer EINE Zeile des Kastens „Wiki-Weg" der ganzen Strasse.
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

// ---- Lieferung 2: EINE Zeile schreibt GENAU ihre Abschnitte --------------------------------------------------------------
assert.deepStrictEqual(W.avesmapsWikiAssignWegZeilenIds([" rs-9 ", "rs-3", "rs-9", "", null]), ["rs-9", "rs-3"], "getrimmt, ohne Dubletten, Reihenfolge der Zeile");
assert.deepStrictEqual(W.avesmapsWikiAssignWegZeilenIds(null), []);
// 💣 public_ids AUCH bei EINEM Abschnitt: ohne Liste gilt der Namens-Match des Servers, und der traefe jeden gleichnamigen Abschnitt
// der Strasse -- genau die Abschnitte der ANDEREN Zeilen.
assert.deepStrictEqual(W.avesmapsWikiAssignWegZeileZuweisungsKoerper("reichsstrasse-2", ["rs-9"]),
	{ action: "assign_to", wiki_key: "reichsstrasse-2", public_id: "rs-9", dry_run: false, confirm: "apply", public_ids: ["rs-9"] });
assert.deepStrictEqual(W.avesmapsWikiAssignWegZeileZuweisungsKoerper(" via ", ["rs-2", "rs-18", "rs-2"]),
	{ action: "assign_to", wiki_key: "via", public_id: "rs-2", dry_run: false, confirm: "apply", public_ids: ["rs-2", "rs-18"] }, "der erste Abschnitt der Zeile ist der Anker");
assert.deepStrictEqual(W.avesmapsWikiAssignWegZeileLoesenKoerper(["rs-3"]),
	{ action: "clear_assign", public_id: "rs-3", public_ids: ["rs-3"], dry_run: false, confirm: "apply" });
assert.deepStrictEqual(W.avesmapsWikiAssignWegZeileLoesenKoerper(["rs-3", "rs-4"]).public_ids, ["rs-3", "rs-4"]);

// Die Frage vor dem Entfernen nennt Name, Zahl der Abschnitte DIESER Zeile und die Folge
const ganz = W.avesmapsWikiAssignWegZeileLoesenFrage("Reichsstraße 2", 10, 10);
assert.ok(ganz.includes("„Reichsstraße 2“") && ganz.includes("allen 10 Abschnitten") && ganz.includes("zerfällt"), ganz);
const teil = W.avesmapsWikiAssignWegZeileLoesenFrage("Reichsstraße 2", 49, 67);
assert.ok(teil.includes("49 der 67 Abschnitte") && teil.includes("nicht mehr zur Straße") && !teil.includes("allen"), teil);
const einer = W.avesmapsWikiAssignWegZeileLoesenFrage("Via Ferra", 1, 67);
assert.ok(einer.includes("1 der 67 Abschnitte") && einer.includes("Dieser Abschnitt bekommt"), einer);
assert.ok(W.avesmapsWikiAssignWegZeileLoesenFrage("X", 3).includes("allen 3 Abschnitten"), "ohne Gesamtzahl gilt die Zeile als ganze Strasse");

// Die Rueckfragen fuer „gemischte Strasse -- auf alle N schreiben?" aus Lieferung 1 entfallen: jede Zeile schreibt nur ihre Abschnitte.
assert.ok(!("avesmapsWikiAssignWegGruppeZuweisenFrage" in W), "die Zuweisen-Rueckfrage der gemischten Strasse ist gefallen");
assert.ok(!("avesmapsWikiAssignWegGruppeLoesenFrage" in W), "die Entfernen-Frage der ganzen Strasse ist in der Zeilenfrage aufgegangen");

console.log("wiki-assign-weg-gruppe.test.js: ok");

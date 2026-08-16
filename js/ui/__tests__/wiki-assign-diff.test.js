// Die reine Diff-Rechnung der Sync-Vorschau (Aufgabe 2, Entwurf §6). Testcode aus dem Brief
// woertlich uebernommen -- er ist die Abnahme, kein Vorschlag.
const assert = require("assert");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");

const felder = [
	{ wiki: "name", karte: "name", label: "Name" },
	{ wiki: "art", karte: "settlement_type", label: "Art" },
	{ wiki: "einwohner", karte: "einwohner", label: "Einwohner" },
	{ wiki: "oberhaupt", karte: "oberhaupt", label: "Herrscher" },
];

// 💣 Was ohnehin gleich ist, steht NICHT in der Liste -- in einem Kasten voller Haekchen sucht man
// sonst die eine Zeile, die zaehlt.
const gleich = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "metropole", einwohner: "12.000", oberhaupt: "" },
	{ name: "Havena", art: "metropole", einwohner: "12.000", oberhaupt: "" }, []);
assert.deepStrictEqual(gleich, []);

const d = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "grossstadt", einwohner: "14.200", oberhaupt: "Growin" },
	{ name: "Havena (Stadt)", art: "metropole", einwohner: "12.000", oberhaupt: "" },
	["einwohner"]);
const nach = Object.fromEntries(d.map((z) => [z.karte, z]));

// Eine gewoehnliche Aenderung ist vorangehakt.
assert.strictEqual(nach.name.gehakt, true);
assert.strictEqual(nach.settlement_type.gehakt, true);

// 🔴 Von Hand gesetzt: gelistet, MARKIERT, aber NICHT gehakt.
assert.strictEqual(nach.einwohner.gehakt, false);
assert.ok(String(nach.einwohner.grund).includes("Hand"), nach.einwohner.grund);

// 🔴 Das Wiki sagt nichts, die Karte schon: das ist der Fall "Geloescht" der grossen
// Uebernahme-Vorschau -- gelistet, aber NIE vorangehakt.
assert.strictEqual(nach.oberhaupt.gehakt, false);
assert.strictEqual(nach.oberhaupt.neu, "");

// In dieser Fixture unterscheiden sich ALLE vier Felder -- also genau vier Zeilen, keine fuenfte.
assert.strictEqual(d.length, 4);
assert.deepStrictEqual(d.map((z) => z.karte), ["name", "settlement_type", "einwohner", "oberhaupt"]);
console.log("wiki-assign-diff: alle Zusicherungen erfuellt");

// 🔴 Eigene Zusicherung (Schnittstelle #2 aus der Aufgabe, nicht im Brief-Test): eine Feldzeile mit
// `karte: ""` ist eine ANZEIGE-Zeile ohne Ziel -- sie kann per Definition nichts uebernehmen und
// darf deshalb NIE in der Diff-Liste stehen, auch wenn ihr Wiki-Wert vom (nicht vorhandenen)
// Kartenwert abweicht. So tragen die Kraftlinien ihre vier Wiki-Felder (js/ui/wiki-assign-registry.js).
const felderMitAnzeige = felder.concat([{ wiki: "staerke", karte: "", label: "Stärke" }]);
const mitAnzeige = avesmapsWikiAssignDiff(felderMitAnzeige,
	{ name: "Havena", settlement_type: "grossstadt", einwohner: "14.200", oberhaupt: "Growin" },
	{ name: "Havena (Stadt)", art: "metropole", einwohner: "12.000", oberhaupt: "", staerke: "kontinental" },
	["einwohner"]);
assert.strictEqual(mitAnzeige.length, 4, "eine Anzeige-Zeile (karte: \"\") ist in der Diff-Liste gelandet");
assert.ok(mitAnzeige.every((z) => z.karte !== ""), "eine Zeile ohne Kartenziel steht in der Diff-Liste");
console.log("wiki-assign-diff: Anzeige-Zeile (karte: \"\") bleibt aussen vor");

// Die vier neuen Protokoll-Aktionen des innerorts-Praedikats (Task 2, Bedenken 4 -- "Client-
// Etiketten fuer die neuen Protokollaktionen (take_off_map, put_on_map, set_innerorts,
// innerorts_endgueltig_entfernen) fehlen ... Task 3/4") im Aenderungsverlauf
// (js/review/review-panels-change-log.js). Entwurf 2026-09-26-innerorts-praedikat-design.md
// §4.1/§4.2/§6.3, §4.4 ("Rueckgaengig ohne Sonderfall" -- deshalb kein eigener undo_-Eintrag noetig,
// der generische Rueckfall traegt).
//
// 🔴 Geprueft wird die ECHTE Funktion in einer vm-Sandbox (dieselbe Rezeptur wie
// change-log-collection-labels.test.js), nicht eine abgeschriebene Tabelle.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-innerorts-labels.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "review-panels-change-log.js"), "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-panels-change-log.js" });

const formatChangeAction = sandbox.formatChangeAction;
assert.strictEqual(typeof formatChangeAction, "function", "die echte Funktion ist geladen");

const labels = {
	take_off_map: formatChangeAction("take_off_map"),
	put_on_map: formatChangeAction("put_on_map"),
	set_innerorts: formatChangeAction("set_innerorts"),
	innerorts_endgueltig_entfernen: formatChangeAction("innerorts_endgueltig_entfernen"),
};

Object.entries(labels).forEach(([action, label]) => {
	assert.notStrictEqual(label, action, `${action} hat eine Beschriftung, keinen rohen Aktionsnamen`);
	assert.ok(label.length > 0, `${action} ist nicht leer beschriftet`);
});

// Alle vier lesen sich verschieden -- vier verschiedene Handlungen, vier verschiedene Zeilen.
const werte = Object.values(labels);
assert.strictEqual(new Set(werte).size, werte.length, "keine zwei der vier Aktionen lesen sich gleich");

// 💣 "Von der Karte nehmen" ist NICHT "Objekt gelöscht" -- genau die Unterscheidung, die §4.1 fordert
// ("die neue Kachel ist nicht rot -- sie ist umkehrbar"), sonst läse sich der Änderungsverlauf für
// beide Gesten gleich, obwohl eine davon eine Stätte hinterlässt und die andere nicht.
assert.notStrictEqual(labels.take_off_map, formatChangeAction("delete_feature"),
	"„Von der Karte nehmen“ liest sich nicht wie eine Löschung");
assert.ok(!labels.take_off_map.includes("gelöscht"), "und behauptet auch textlich keine Löschung");

// „Rückgängig" braucht KEINEN Sonderfall (Spec §4.4) -- der generische undo_-Rückfall greift.
assert.strictEqual(formatChangeAction("undo_take_off_map"), `Rückgängig: ${labels.take_off_map}`,
	"Rückgängig von „Von der Karte nehmen“ ohne eigenen Tabelleneintrag");
assert.strictEqual(formatChangeAction("undo_put_on_map"), `Rückgängig: ${labels.put_on_map}`);
assert.strictEqual(formatChangeAction("undo_set_innerorts"), `Rückgängig: ${labels.set_innerorts}`);
assert.strictEqual(
	formatChangeAction("undo_innerorts_endgueltig_entfernen"),
	`Rückgängig: ${labels.innerorts_endgueltig_entfernen}`,
);

// Der Bestand bleibt, wie er war.
assert.strictEqual(formatChangeAction("delete_feature"), "Objekt gelöscht", "delete_feature unverändert");

console.log("change-log-innerorts-labels ok");

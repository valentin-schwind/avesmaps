// Wie eine Löschung in Kartensammlung, Abenteuern und Natur & Waren im Änderungsprotokoll heißt
// (Befund A16, Stufe 1).
//
// 💣 Ohne Beschriftung fällt formatChangeAction auf den rohen Aktionsnamen zurück. In der Liste stünde
// dann „delete_lore_place" — wahr, aber weder deutsch noch eine Antwort. Der PHP-Test daneben prüft,
// dass die vier Namen in dieser Datei VORKOMMEN; hier wird gefragt, was die echte Funktion
// tatsächlich zurückgibt — eine Beschriftung in der falschen Tabelle bestünde die erste Prüfung und
// diese nicht.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, nicht eine abgeschriebene Kopie der Tabelle:
// ein Stub, der die geprüfte Funktion ersetzt, zertifiziert den Stub.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-collection-labels.test.js

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

// ---- Die vier Aktionen aus A16 Stufe 1 -----------------------------------------------------------

const labels = {
	delete_citymap: formatChangeAction("delete_citymap"),
	delete_adventure: formatChangeAction("delete_adventure"),
	delete_lore_place: formatChangeAction("delete_lore_place"),
	suppress_lore_place: formatChangeAction("suppress_lore_place"),
};

Object.entries(labels).forEach(([action, label]) => {
	assert.notStrictEqual(label, action, `${action} hat eine Beschriftung, keinen rohen Aktionsnamen`);
	assert.ok(label.length > 0, `${action} ist nicht leer beschriftet`);
});

// 💣 Die beiden Vorkommen-Zeilen dürfen NICHT gleich lauten. Ein Wiki-Ort wird zum Grabstein und lässt
// sich mit „Ort wieder aufnehmen" zurückholen; ein manueller ist weg. Ob es einen Weg zurück gibt, ist
// genau die Frage, für die A16 existiert — steht die Antwort nur im after_json, beantwortet die Liste
// sie nie, denn die zeigt ausschließlich diese Beschriftung.
assert.notStrictEqual(
	labels.delete_lore_place,
	labels.suppress_lore_place,
	"Grabstein und harte Löschung lesen sich unterschiedlich",
);

// ⚠️ Und die Karte muss von einem Kartenobjekt unterscheidbar bleiben: „Objekt gelöscht" ist die Zeile
// eines gelöschten Ortes/Weges (delete_feature) und steht in derselben Liste.
assert.notStrictEqual(
	labels.delete_citymap,
	formatChangeAction("delete_feature"),
	"eine Karte der Kartensammlung liest sich nicht wie ein gelöschtes Kartenobjekt",
);

// Der Bestand bleibt, wie er war -- diese Datei fasst eine gemeinsame Tabelle an.
assert.strictEqual(formatChangeAction("delete_feature"), "Objekt gelöscht", "delete_feature unverändert");
assert.strictEqual(formatChangeAction("report_approved"), "Meldung angenommen", "A4 unverändert");
assert.strictEqual(formatChangeAction("move_label"), "Label verschoben", "und der Alltagsfall auch");

// ⚠️ Ein unbekannter Name wird weiterhin durchgereicht statt verschluckt.
assert.strictEqual(formatChangeAction("delete_everything"), "delete_everything", "Unbekanntes bleibt sichtbar");

console.log("change-log-collection-labels ok");

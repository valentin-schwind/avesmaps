// Der Uebergang zwischen Weg und Gelaende bekommt einen NAMEN, und der haengt an der Richtung:
// „Abgangspunkt" wo die Reise die Strasse verlaesst, „Anschlusspunkt" wo sie auf sie trifft.
// Owner-Entscheid 15.08.2026.
//
// 💣 WAS DER REISENDE HEUTE SIEHT, IST „Markierung". normalizeNodeName macht aus `__wp_anchor_7`
// zuerst „Kreuzung", und formatRoutePlanNodeName zeigt „Kreuzung" als „Markierung". Zwei
// Umbenennungen hintereinander, und die sichtbare ist die zweite -- wer nur die erste sucht,
// findet den falschen Ort.
//
// 🔴 DIE BENENNUNG LAEUFT NACH cleanRoutePlanNoiseEntries. Jene Funktion entscheidet an
// isRoutePlanMarkerName(open.endName), ob eine Etappe geschlossen wird; wer vorher umbenennt,
// aendert die Aggregation -- und genau die haelt Weg und Gelaende ueberhaupt auseinander.
//
// Lauf: node js/routing/__tests__/abgangspunkt-label.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };
// 🪤 Die ECHTE Normalisierung, nicht die verkuerzte aus dem Nachbartest: ohne den
// `__wp_anchor_`-Zweig erkennt isRoutePlanMarkerName den Ausstiegsknoten nicht, und der Test
// pruefte den Fall, den es zu pruefen gilt, gerade nicht.
global.normalizeNodeName = (name) => String(name || "")
	.replace(/Kreuzung-\d+/i, "Kreuzung")
	.replace(/__wp_anchor_\d+/i, "Kreuzung");
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.THRESHOLD = 0.5;
global.tr = (key, fallback) => fallback;

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../route-plan.js"), "utf8"), {
	filename: path.join(__dirname, "../route-plan.js"),
});
assert.strictEqual(SYNTHETIC_ROUTE_TYPE, "Querfeldein", "die Konstante muss stimmen, sonst prueft der Test nichts");

const strasse = (startName, endName) => ({ type: "Strasse", startName, endName });
const quer = (startName, endName) => ({ type: "Querfeldein", startName, endName });

// ---- A: Weg -> Gelaende = Abgangspunkt ---------------------------------------------------
let entries = nameRoutePlanTransferPoints([
	strasse("Salmingen", "__wp_anchor_3"),
	quer("__wp_anchor_3", "Kartenpunkt (504.530, 501.076)"),
]);
assert.strictEqual(entries[0].endName, "Abgangspunkt", "die Strasse endet am Abgangspunkt");
assert.strictEqual(entries[1].startName, "Abgangspunkt", "und das Gelaende beginnt dort");
assert.strictEqual(entries[0].startName, "Salmingen", "der echte Ort bleibt unangetastet");
assert.strictEqual(entries[1].endName, "Kartenpunkt (504.530, 501.076)", "und der Kartenpunkt auch");

// ---- B: Gelaende -> Weg = Anschlusspunkt --------------------------------------------------
entries = nameRoutePlanTransferPoints([
	quer("Kartenpunkt (504.530, 501.076)", "__wp_anchor_3"),
	strasse("__wp_anchor_3", "Salmingen"),
]);
assert.strictEqual(entries[0].endName, "Anschlusspunkt", "das Gelaende endet am Anschlusspunkt");
assert.strictEqual(entries[1].startName, "Anschlusspunkt", "und die Strasse beginnt dort");

// ---- C: eine anonyme Kreuzung ZWISCHEN zwei Landetappen bleibt, wie sie war ---------------
entries = nameRoutePlanTransferPoints([
	strasse("Salmingen", "Kreuzung-2468"),
	strasse("Kreuzung-2468", "Tarnelfurt"),
]);
assert.strictEqual(entries[0].endName, "Kreuzung-2468", "ohne Querfeldein daneben wird nichts umbenannt");

// ---- D: ein echter ORT am Uebergang behaelt seinen Namen ----------------------------------
entries = nameRoutePlanTransferPoints([
	strasse("Salmingen", "Tarnelfurt"),
	quer("Tarnelfurt", "Kartenpunkt (504.530, 501.076)"),
]);
assert.strictEqual(entries[0].endName, "Tarnelfurt", "ein Ort ist kein Abgangspunkt");
assert.strictEqual(entries[1].startName, "Tarnelfurt", "und bleibt es auf beiden Seiten");

// ---- E: eine einzelne Querfeldein-Etappe bleibt unberuehrt --------------------------------
entries = nameRoutePlanTransferPoints([quer("Salmingen", "Kartenpunkt (504.530, 501.076)")]);
assert.strictEqual(entries[0].startName, "Salmingen", "nichts zu benennen");
assert.strictEqual(entries.length, 1, "und nichts hinzugekommen");

// ---- F: drei Etappen, Weg -> Gelaende -> Weg: beide Namen in EINER Liste ------------------
entries = nameRoutePlanTransferPoints([
	strasse("Salmingen", "__wp_anchor_3"),
	quer("__wp_anchor_3", "__wp_anchor_4"),
	strasse("__wp_anchor_4", "Tarnelfurt"),
]);
assert.strictEqual(entries[0].endName, "Abgangspunkt", "hinunter von der Strasse");
assert.strictEqual(entries[1].startName, "Abgangspunkt", "dieselbe Stelle, andere Etappe");
assert.strictEqual(entries[1].endName, "Anschlusspunkt", "und wieder hinauf");
assert.strictEqual(entries[2].startName, "Anschlusspunkt", "dieselbe Stelle, andere Etappe");

// ---- G: die Eingabe wird nicht veraendert -------------------------------------------------
const original = [strasse("Salmingen", "__wp_anchor_3"), quer("__wp_anchor_3", "Ziel")];
nameRoutePlanTransferPoints(original);
assert.strictEqual(original[0].endName, "__wp_anchor_3", "die uebergebene Liste bleibt unberuehrt");

console.log("abgangspunkt-label.test.js: OK");

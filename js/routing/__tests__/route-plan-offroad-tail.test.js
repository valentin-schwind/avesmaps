// „Hierher reisen": die Querfeldein-Schluss-Etappe darf NICHT verschwinden.
//
// 💣 DER FALL KONNTE VORHER NICHT AUFTRETEN, und deshalb kannte ihn niemand. Eine Route endete
// immer an einem ORT. Seit dem Rechtsklick endet sie an einem beliebigen Kartenpunkt, und der heisst
// „Markierung" — genau der Name, an dem `cleanRoutePlanNoiseEntries` die Schluss-Etappe in die
// vorige absorbiert, um kein „... -> Kreuzung" anzuzeigen.
//
// Live gemessen an Rovik -> Kartenpunkt (2026-08-01), VOR der Reparatur: die Querfeldein-Etappe
// verschwand in einer Flussweg-Etappe. Die wurde dadurch 24,76 statt 19,66 Meilen lang, und ihr
// Anstieg von 498 Schritt sah aus, als stamme er von einem Fluss. Zwanzig Zeilen weiter oben steht
// die Regel schon — „nie mit einer andersartigen Etappe verschmelzen, sonst versteckt sie sich z.B.
// unter 'Flussweg'" —, nur galt sie fuer die Mitte der Liste und nicht fuer ihr Ende.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
// 🪤 Ohne dieses Global waere `entry.type === SYNTHETIC_ROUTE_TYPE` immer falsch und der Test
// pruefte den Fallback statt der Regel. Der Wert stammt aus js/config.js und wird hier festgenagelt.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../route-plan.js"), "utf8"), {
	filename: path.join(__dirname, "../route-plan.js"),
});
assert.strictEqual(SYNTHETIC_ROUTE_TYPE, "Querfeldein", "die Konstante muss stimmen, sonst prueft der Test nichts");

const entry = (type, endName, distance, segmentIndexes) => ({
	type, endName, distance, travelTime: distance / 4, restTime: 0,
	startName: "Anfang", segmentLabel: "", flowState: null, segmentIndexes,
});

// ---- der Fall, der es ausloeste ----------------------------------------------------------------
const withOffroadTail = cleanRoutePlanNoiseEntries([
	entry("Flussweg", "Skarsten", 19.66, [0, 1]),
	entry("Querfeldein", "Markierung", 5.1, [2]),
]);
assert.strictEqual(withOffroadTail.length, 2, "die Querfeldein-Etappe bleibt eine eigene Etappe");
assert.strictEqual(withOffroadTail[1].type, "Querfeldein", "und behaelt ihre Art");
assert.deepStrictEqual(withOffroadTail[1].segmentIndexes, [2], "mit ihrem eigenen Segment");
assert.strictEqual(withOffroadTail[0].distance, 19.66, "die Flussweg-Etappe waechst NICHT um 5,1 Meilen");

// ---- und die Regel, die es vorher gab, gilt weiter -----------------------------------------------
// Eine gewoehnliche Schluss-Etappe an einer anonymen Kreuzung wird nach wie vor absorbiert; ohne das
// stuende „... -> Kreuzung-1577" im Reiseplan.
const withCrossingTail = cleanRoutePlanNoiseEntries([
	entry("Strasse", "Gareth", 10, [0]),
	entry("Strasse", "Kreuzung-1577", 2, [1]),
]);
assert.strictEqual(withCrossingTail.length, 1, "eine gewoehnliche Kreuzungs-Schluss-Etappe wird weiterhin absorbiert");
assert.deepStrictEqual(withCrossingTail[0].segmentIndexes, [0, 1], "und ihre Segmente wandern mit");

// Zwei Querfeldein-Etappen hintereinander duerfen sehr wohl verschmelzen -- die Ausnahme gilt der
// Vermischung mit einer ANDEREN Art, nicht dem Querfeldein an sich.
const twoOffroad = cleanRoutePlanNoiseEntries([
	entry("Querfeldein", "Kreuzung-1", 3, [0]),
	entry("Querfeldein", "Markierung", 2, [1]),
]);
assert.strictEqual(twoOffroad.length, 1, "zwei Querfeldein-Etappen bleiben eine");
assert.strictEqual(twoOffroad[0].distance, 5, "und ihre Laengen addieren sich");

// Eine Querfeldein-Schluss-Etappe, die an einem echten ORT endet, war nie betroffen -- sie wird
// regulaer abgeschlossen, nicht absorbiert.
const offroadToPlace = cleanRoutePlanNoiseEntries([
	entry("Flussweg", "Skarsten", 19.66, [0]),
	entry("Querfeldein", "Rovik", 5.1, [1]),
]);
assert.strictEqual(offroadToPlace.length, 2, "an einem echten Ort war die Etappe immer schon sichtbar");

console.log("route-plan-offroad-tail: OK");

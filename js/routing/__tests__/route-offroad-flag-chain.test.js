// Der `offroad`-Schalter muss durch ZWEI Feldlisten, sonst kommt der Vermerk nie an.
//
// 💣 GEFUNDEN AM LIVELAUF, NICHT IM CODE. Die Etappenzeile entsteht nicht aus
// `buildRoutePlanEntries`, sondern aus dessen Ergebnis ueber `buildRouteSteps` (route-result.js) und
// `buildRoutePlanViewModel` (route-view-model.js) -- und BEIDE bauen ihr Objekt aus einer
// ausdruecklichen Feldliste. Ein Feld, das in einer der beiden fehlt, verschwindet lautlos: der
// Eintrag trug `offroad: true`, die gerenderte Zeile hatte den Vermerk nicht, und nichts hat sich
// beschwert.
//
// ⚠️ Genau dieselbe Falle steht schon einmal in der Kette: `flow_state` musste durch beide Listen.
// Wer ein drittes Feld ergaenzt, ergaenzt es an DREI Stellen (Etappe, Schritt, Ansichtsmodell).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.tr = (key, fallback) => fallback;
global.calculateScaledDistance = () => 0;

// Die Etappen sind hier die EINGABE, nicht die Regel: geprueft wird, was die beiden Feldlisten mit
// ihnen machen. Deshalb ein Stub -- er steht vor dem Laden, und keine der beiden Dateien definiert
// eine eigene Fassung, die ihn ueberschreiben koennte.
global.buildRoutePlanEntries = () => ([
	{ type: "Strasse", startName: "Gareth", endName: "Kreuzung-1", segmentLabel: "", flowState: null,
		distance: 10, travelTime: 2.5, segmentIndexes: [0], offroad: false },
	{ type: "Querfeldein", startName: "Kreuzung-1", endName: "Markierung", segmentLabel: "", flowState: null,
		distance: 5.1, travelTime: 4.86, segmentIndexes: [1], offroad: true },
]);

for (const file of ["../route-result.js", "../route-view-model.js"]) {
	const absolutePath = path.join(__dirname, file);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
}

// ---- Liste 1: die Etappe wird ein Schritt --------------------------------------------------------
const steps = buildRouteSteps([], [], {});
assert.strictEqual(steps.length, 2, "zwei Schritte");
assert.strictEqual(steps[1].offroad, true, "der Schalter ueberlebt buildRouteSteps");
assert.strictEqual(steps[0].offroad, false, "und eine gewoehnliche Etappe traegt ihn nicht");

// ---- Liste 2: der Schritt wird ein Anzeige-Eintrag -----------------------------------------------
const viewModel = buildRoutePlanViewModel({ summary: {}, steps }, ["Gareth", "Kreuzung-1", "Markierung"], []);
assert.strictEqual(viewModel.planEntries[1].offroad, true, "und ueberlebt das Ansichtsmodell");
assert.strictEqual(viewModel.planEntries[0].offroad, false, "beide Richtungen");

// ⚠️ Strikt `=== true`: ein fehlendes Feld darf `false` ergeben, niemals `undefined`. Sonst
// entscheidet die Anzeige spaeter ueber einen Wert, den niemand gesetzt hat.
const bare = buildRoutePlanViewModel({ summary: {}, steps: [{ type: "Strasse" }] }, [], []);
assert.strictEqual(bare.planEntries[0].offroad, false, "ohne das Feld ist es false, nicht undefined");

console.log("route-offroad-flag-chain: OK");

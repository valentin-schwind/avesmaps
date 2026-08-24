const assert = require("assert");
const fs = require("fs");
const path = require("path");

// „Max. Namen" ist nur bedienbar, wenn „Kurvenbeschriftung" angehakt ist (Owner 24.08.2026).
//
// 🔴 ZWEI Bedingungen verschiedener Art:
//   - OHNE FLAECHE gibt es keine Mittelachse -- weder Haken noch Zahl sind bedienbar.
//   - MIT Flaeche, aber Haken AUS: die Zahl sagt „hoechstens so viele Namen auf der Kurve", und es
//     gibt keine Kurve. Ein Regler, der eine Zahl fuer etwas Abgeschaltetes stellt, sieht aus wie
//     eine Einstellung und ist keine.
//
// ⚠️ Der WERT bleibt dabei stehen -- im Browser gemessen: 3 vor dem Abhaken, 3 danach, 3 nach dem
// Wiederanhaken. Ein Regler, der beim Sperren auf 1 zurueckspringt, verloere die Einstellung beim
// blossen Ab- und Wiederanhaken.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/label-maxnamen-riegel.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const skript = fs.readFileSync(path.join(wurzel, "js/review/review-labels.js"), "utf8");

// ---- A. Die Regel, AUSGEFUEHRT --------------------------------------------------------------
const vonR = skript.indexOf("function labelCurveMaxBedienbar(");
assert.ok(vonR >= 0, "die Regel steht als eigene Funktion da");
const labelCurveMaxBedienbar = new Function(
	skript.slice(vonR, skript.indexOf("\n}", vonR) + 2) + "; return labelCurveMaxBedienbar;"
)();

assert.strictEqual(labelCurveMaxBedienbar(true, true), true, "Flaeche und Haken: bedienbar");
assert.strictEqual(labelCurveMaxBedienbar(true, false), false, "Haken aus: gesperrt");
assert.strictEqual(labelCurveMaxBedienbar(false, true), false, "ohne Flaeche: gesperrt");
assert.strictEqual(labelCurveMaxBedienbar(false, false), false, "beides nicht: gesperrt");
// ⚠️ Und sie liefert einen Wahrheitswert, keinen Wahrheitswert-Ersatz -- `undefined && true` waere
// `undefined`, und `disabled = !undefined` ist zufaellig richtig, sagt aber nichts.
assert.strictEqual(labelCurveMaxBedienbar(undefined, undefined), false, "fehlende Angaben: gesperrt");

// ---- B. Der Riegel haengt am HAKEN, nicht nur am Oeffnen ---------------------------------------
// Ohne den Zuhoerer wirkt die Regel nur beim Oeffnen, und wer den Haken setzt, findet die Zahl
// weiter gesperrt.
assert.ok(/event\.target\.id === "label-edit-curve"[\s\S]{0,160}syncLabelCurveMaxControls\(\)/.test(skript),
	"ein change am Haken zieht die Bedienelemente nach");

// ---- C. 💣 DER WERT WIRD NICHT ZURUECKGESETZT ---------------------------------------------------
// Der Sperrer darf `value` nicht anfassen. Sonst verliert ein Ab- und Wiederanhaken die Zahl.
const vonS = skript.indexOf("function syncLabelCurveMaxControls(");
assert.ok(vonS >= 0, "der Sperrer steht als eigene Funktion da");
const rumpfS = skript.slice(vonS, skript.indexOf("\n}", vonS));
assert.ok(!/\.value\s*=/.test(rumpfS),
	"der Sperrer setzt keinen Wert -- stumm, aber gemerkt");

// ---- D. Beide Ausgaenge von syncLabelCurveControls sind bedient --------------------------------
// 🪤 Die Funktion kehrt im flaechenlosen Fall FRUEH zurueck. Ein Nachziehen nur am Ende liesse
// „Max. Namen" dort beim vorigen Label bedienbar stehen.
const vonC = skript.indexOf("function syncLabelCurveControls(");
const rumpfC = skript.slice(vonC, skript.indexOf("\n}", vonC));
const treffer = (rumpfC.match(/syncLabelCurveMaxControls\(\)/g) || []).length;
assert.strictEqual(treffer, 2,
	"beide Ausgaenge ziehen nach (frueher Ausstieg und Ende), gefunden: " + treffer);

// ---- E. Und der Grund steht da ------------------------------------------------------------------
// ⚠️ Ein wirkungsloses Bedienelement ohne Begruendung ist schlimmer als keins -- dieselbe Regel,
// die zwei Funktionen weiter oben schon fuer die fehlende Flaeche gilt.
assert.ok(/Kurvenbeschriftung“ anhaken/.test(skript),
	"der gesperrte Regler sagt, was zu tun ist");

console.log("label-maxnamen-riegel: alle Zusicherungen gruen");
